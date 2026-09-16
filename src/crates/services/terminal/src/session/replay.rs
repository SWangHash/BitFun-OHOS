//! Terminal replay history.
//!
//! This stores enough PTY output context for frontend recovery without trying
//! to serialize an xterm.js buffer.  Each data chunk is tagged with the PTY
//! dimensions that were active when the backend received it.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

/// One replay step for rebuilding a frontend terminal instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerminalReplayEvent {
    /// Terminal columns active for this replay step.
    pub cols: u16,
    /// Terminal rows active for this replay step.
    pub rows: u16,
    /// Raw terminal data to write after applying the dimensions.
    #[serde(default)]
    pub data: String,
}

impl TerminalReplayEvent {
    pub fn resize_marker(cols: u16, rows: u16) -> Self {
        Self {
            cols,
            rows,
            data: String::new(),
        }
    }

    pub fn data(cols: u16, rows: u16, data: String) -> Self {
        Self { cols, rows, data }
    }

    fn is_resize_marker(&self) -> bool {
        self.data.is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReplayPage {
    pub data: String,
    pub next_offset: u64,
    pub cursor: u64,
    pub truncated: bool,
    pub history_size: usize,
    pub cols: u16,
    pub rows: u16,
}

/// Bounded replay history for one terminal session.
#[derive(Debug, Clone)]
pub struct TerminalReplayHistory {
    events: VecDeque<TerminalReplayEvent>,
    total_bytes: u64,
    max_bytes: usize,
    max_events: usize,
}

impl Default for TerminalReplayHistory {
    fn default() -> Self {
        Self {
            events: VecDeque::new(),
            total_bytes: 0,
            max_bytes: Self::DEFAULT_MAX_BYTES,
            max_events: Self::DEFAULT_MAX_EVENTS,
        }
    }
}

impl TerminalReplayHistory {
    /// Default maximum output payload retained for replay: 4 MiB.
    pub const DEFAULT_MAX_BYTES: usize = 4 * 1024 * 1024;
    /// Maximum event count retained for replay.
    pub const DEFAULT_MAX_EVENTS: usize = 2_000;

    pub fn record_output(&mut self, cols: u16, rows: u16, data: &str) {
        if data.is_empty() {
            return;
        }

        self.total_bytes = self.total_bytes.saturating_add(data.len() as u64);

        // Keep contiguous output with identical PTY dimensions in one event so
        // replay applies geometry only at real resize boundaries.
        match self.events.back_mut() {
            Some(last) if last.cols == cols && last.rows == rows => {
                last.data.push_str(data);
            }
            _ => self
                .events
                .push_back(TerminalReplayEvent::data(cols, rows, data.to_string())),
        }

        self.trim();
    }

    pub fn record_resize(&mut self, cols: u16, rows: u16) {
        // A resize marker carries no data; it exists only so the frontend can
        // apply the new geometry before the next output chunk.
        match self.events.back_mut() {
            Some(last) if last.cols == cols && last.rows == rows => {}
            Some(last) if last.is_resize_marker() => {
                last.cols = cols;
                last.rows = rows;
            }
            _ => self
                .events
                .push_back(TerminalReplayEvent::resize_marker(cols, rows)),
        }

        self.trim();
    }

    pub fn replace_events(&mut self, events: Vec<TerminalReplayEvent>) {
        self.total_bytes = events.iter().map(|event| event.data.len() as u64).sum();
        self.events = events.into();
        self.trim();
    }

    pub fn events(&self) -> Vec<TerminalReplayEvent> {
        self.events.iter().cloned().collect()
    }

    pub fn data(&self) -> String {
        self.events
            .iter()
            .map(|event| event.data.as_str())
            .collect()
    }

    /// Monotonic UTF-8 byte cursor, including output evicted from replay.
    pub fn cursor(&self) -> u64 {
        self.total_bytes
    }

    /// Returns a UTF-8 safe page and explicitly reports a cursor gap.
    pub fn read_after(&self, after: u64, max_bytes: usize) -> (String, u64, bool) {
        let start = self.total_bytes.saturating_sub(self.size_bytes() as u64);
        let requested = after.max(start).min(self.total_bytes);
        let mut skip = (requested - start) as usize;
        let mut data = String::new();
        let mut next = requested;
        let mut remaining = max_bytes.max(4);
        for event in &self.events {
            if skip >= event.data.len() {
                skip -= event.data.len();
                continue;
            }
            let mut offset = skip;
            while !event.data.is_char_boundary(offset) {
                offset += 1;
            }
            next += (offset - skip) as u64;
            skip = 0;
            let mut end = offset.saturating_add(remaining).min(event.data.len());
            while !event.data.is_char_boundary(end) {
                end -= 1;
            }
            data.push_str(&event.data[offset..end]);
            next += (end - offset) as u64;
            remaining -= end - offset;
            if end < event.data.len() || remaining == 0 {
                break;
            }
        }
        (data, next, after < start || after > self.total_bytes)
    }

    pub fn page(&self, after: u64, max_bytes: usize, cols: u16, rows: u16) -> TerminalReplayPage {
        let (data, next_offset, truncated) = self.read_after(after, max_bytes);
        TerminalReplayPage {
            data,
            next_offset,
            cursor: self.cursor(),
            truncated,
            history_size: self.size_bytes(),
            cols,
            rows,
        }
    }

    pub fn clear(&mut self) {
        self.events.clear();
    }

    pub fn size_bytes(&self) -> usize {
        self.events.iter().map(|event| event.data.len()).sum()
    }

    fn trim(&mut self) {
        while self.events.len() > self.max_events {
            self.events.pop_front();
        }

        let mut total_size = self.size_bytes();
        while total_size > self.max_bytes && !self.events.is_empty() {
            let excess = total_size - self.max_bytes;
            if let Some(oldest) = self.events.front_mut() {
                if oldest.data.len() > excess {
                    let mut cut = excess;
                    while !oldest.data.is_char_boundary(cut) {
                        cut += 1;
                    }
                    oldest.data.drain(..cut);
                    total_size -= cut;
                } else if let Some(oldest) = self.events.pop_front() {
                    total_size -= oldest.data.len();
                }
            }
        }

        while self.events.len() > 1
            && self
                .events
                .front()
                .map(TerminalReplayEvent::is_resize_marker)
                .unwrap_or(false)
        {
            // Dropping old output can leave a leading resize-only event. Remove
            // it so a restored terminal does not treat pure geometry as content.
            self.events.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_coalesced_output_retains_utf8_tail_and_reports_gap() {
        let mut history = TerminalReplayHistory::default();
        history.max_bytes = 8;
        history.record_output(80, 24, "abcdefgh你好世界");
        assert_eq!(history.data(), "世界");
        let (data, cursor, truncated) = history.read_after(0, 4);
        assert_eq!(data, "世");
        assert_eq!(cursor, 17);
        assert!(truncated);
        assert_eq!(history.read_after(cursor, 4), ("界".into(), 20, false));
    }

    #[test]
    fn coalesces_output_with_matching_dimensions() {
        let mut history = TerminalReplayHistory::default();

        history.record_output(80, 24, "hello");
        history.record_output(80, 24, " world");

        assert_eq!(
            history.events(),
            vec![TerminalReplayEvent::data(80, 24, "hello world".to_string())]
        );
    }

    #[test]
    fn keeps_dimension_changes_in_order() {
        let mut history = TerminalReplayHistory::default();

        history.record_output(80, 24, "a");
        history.record_resize(100, 30);
        history.record_output(100, 30, "b");

        assert_eq!(
            history.events(),
            vec![
                TerminalReplayEvent::data(80, 24, "a".to_string()),
                TerminalReplayEvent::data(100, 30, "b".to_string()),
            ]
        );
    }

    #[test]
    fn coalesces_consecutive_resize_markers() {
        let mut history = TerminalReplayHistory::default();

        history.record_output(80, 24, "a");
        history.record_resize(90, 25);
        history.record_resize(100, 30);

        assert_eq!(
            history.events(),
            vec![
                TerminalReplayEvent::data(80, 24, "a".to_string()),
                TerminalReplayEvent::resize_marker(100, 30),
            ]
        );
    }
}
