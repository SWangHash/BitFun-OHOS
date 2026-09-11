use crate::diagnostics::TransportDiagnostics;
use std::collections::VecDeque;
use std::fmt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

type ExportFn<T> = dyn Fn(Vec<T>) -> bool + Send + Sync + 'static;

struct QueueItem<T> {
    record: T,
    bytes: usize,
}

struct QueueState<T> {
    queue: VecDeque<QueueItem<T>>,
    retained_records: usize,
    retained_bytes: usize,
    in_flight_batches: usize,
    flush_requested: bool,
    closed: bool,
}

impl<T> Default for QueueState<T> {
    fn default() -> Self {
        Self {
            queue: VecDeque::new(),
            retained_records: 0,
            retained_bytes: 0,
            in_flight_batches: 0,
            flush_requested: false,
            closed: false,
        }
    }
}

struct SchedulerShared<T> {
    name: &'static str,
    state: Mutex<QueueState<T>>,
    wake: Condvar,
    drained: Condvar,
    max_records: usize,
    max_bytes: usize,
    max_batch_records: usize,
    max_batch_bytes: usize,
    delay: Duration,
    export: Arc<ExportFn<T>>,
    diagnostics: Arc<TransportDiagnostics>,
    dropped: AtomicU64,
    exported_batches: AtomicU64,
    export_failures: AtomicU64,
}

pub(crate) struct BoundedBatchScheduler<T> {
    shared: Arc<SchedulerShared<T>>,
    workers: Mutex<Vec<JoinHandle<()>>>,
    shutdown: AtomicBool,
}

impl<T: Send + 'static> fmt::Debug for BoundedBatchScheduler<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BoundedBatchScheduler")
            .field("name", &self.shared.name)
            .field("snapshot", &self.snapshot())
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct SchedulerSnapshot {
    pub retained_records: u64,
    pub retained_bytes: u64,
    pub in_flight_batches: u64,
    pub export_failures: u64,
}

impl<T: Send + 'static> BoundedBatchScheduler<T> {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        name: &'static str,
        worker_count: usize,
        max_records: usize,
        max_bytes: usize,
        max_batch_records: usize,
        max_batch_bytes: usize,
        delay: Duration,
        diagnostics: Arc<TransportDiagnostics>,
        export: Arc<ExportFn<T>>,
    ) -> Arc<Self> {
        let scheduler = Arc::new(Self {
            shared: Arc::new(SchedulerShared {
                name,
                state: Mutex::new(QueueState::default()),
                wake: Condvar::new(),
                drained: Condvar::new(),
                max_records,
                max_bytes,
                max_batch_records,
                max_batch_bytes,
                delay,
                export,
                diagnostics,
                dropped: AtomicU64::new(0),
                exported_batches: AtomicU64::new(0),
                export_failures: AtomicU64::new(0),
            }),
            workers: Mutex::new(Vec::new()),
            shutdown: AtomicBool::new(false),
        });
        let mut workers = scheduler
            .workers
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for index in 0..worker_count.max(1) {
            let shared = scheduler.shared.clone();
            workers.push(
                std::thread::Builder::new()
                    .name(format!("bitfun-otel-{name}-{index}"))
                    .spawn(move || worker_loop(shared))
                    .expect("telemetry worker thread must start"),
            );
        }
        drop(workers);
        scheduler
    }

    pub(crate) fn try_enqueue(&self, record: T, estimated_bytes: usize) -> bool {
        let Ok(mut state) = self.shared.state.try_lock() else {
            self.record_drop(1);
            return false;
        };
        if state.closed
            || state.retained_records >= self.shared.max_records
            || state.retained_bytes.saturating_add(estimated_bytes) > self.shared.max_bytes
        {
            drop(state);
            self.record_drop(1);
            return false;
        }
        state.retained_records += 1;
        state.retained_bytes += estimated_bytes;
        state.queue.push_back(QueueItem {
            record,
            bytes: estimated_bytes,
        });
        if state.queue.len() >= self.shared.max_batch_records {
            self.shared.wake.notify_all();
        } else {
            self.shared.wake.notify_one();
        }
        true
    }

    pub(crate) fn force_flush(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let mut state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.flush_requested = true;
        self.shared.wake.notify_all();
        while state.retained_records != 0 {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return false;
            }
            let (next, wait) = self
                .shared
                .drained
                .wait_timeout(state, remaining)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state = next;
            if wait.timed_out() && state.retained_records != 0 {
                return false;
            }
        }
        state.flush_requested = false;
        true
    }

    pub(crate) fn cancel_and_discard(&self) {
        let mut state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.closed = true;
        let queued_records = state.queue.len();
        let queued_bytes = state.queue.iter().map(|item| item.bytes).sum::<usize>();
        state.queue.clear();
        state.retained_records = state.retained_records.saturating_sub(queued_records);
        state.retained_bytes = state.retained_bytes.saturating_sub(queued_bytes);
        drop(state);
        self.record_drop(queued_records as u64);
        self.shared.wake.notify_all();
        self.shared.drained.notify_all();
    }

    pub(crate) fn shutdown(&self, timeout: Duration, graceful: bool) -> bool {
        if self.shutdown.swap(true, Ordering::AcqRel) {
            return true;
        }
        let flushed = !graceful || self.force_flush(timeout);
        self.cancel_and_discard();
        let workers = std::mem::take(
            &mut *self
                .workers
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        );
        for worker in workers {
            let _ = worker.join();
        }
        flushed
    }

    pub(crate) fn snapshot(&self) -> SchedulerSnapshot {
        let state = self
            .shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        SchedulerSnapshot {
            retained_records: state.retained_records as u64,
            retained_bytes: state.retained_bytes as u64,
            in_flight_batches: state.in_flight_batches as u64,
            export_failures: self.shared.export_failures.load(Ordering::Relaxed),
        }
    }

    fn record_drop(&self, count: u64) {
        if count == 0 {
            return;
        }
        self.shared.dropped.fetch_add(count, Ordering::Relaxed);
        self.shared.diagnostics.locally_dropped(count);
    }
}

fn worker_loop<T: Send + 'static>(shared: Arc<SchedulerShared<T>>) {
    loop {
        let (batch, batch_bytes) = {
            let mut state = shared
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            while state.queue.is_empty() && !state.closed {
                state = shared
                    .wake
                    .wait(state)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            if state.closed && state.queue.is_empty() {
                return;
            }
            if !state.flush_requested && state.queue.len() < shared.max_batch_records {
                let (next, _) = shared
                    .wake
                    .wait_timeout(state, shared.delay)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                state = next;
                if state.closed && state.queue.is_empty() {
                    return;
                }
            }

            let mut batch = Vec::with_capacity(shared.max_batch_records);
            let mut batch_bytes = 0usize;
            while batch.len() < shared.max_batch_records {
                let Some(front) = state.queue.front() else {
                    break;
                };
                if !batch.is_empty()
                    && batch_bytes.saturating_add(front.bytes) > shared.max_batch_bytes
                {
                    break;
                }
                let item = state.queue.pop_front().expect("front exists");
                batch_bytes += item.bytes;
                batch.push(item.record);
            }
            state.in_flight_batches += 1;
            (batch, batch_bytes)
        };

        let batch_len = batch.len();
        let exported = (shared.export)(batch);
        if exported {
            shared.exported_batches.fetch_add(1, Ordering::Relaxed);
        } else {
            shared.export_failures.fetch_add(1, Ordering::Relaxed);
        }
        let mut state = shared
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.in_flight_batches = state.in_flight_batches.saturating_sub(1);
        state.retained_records = state.retained_records.saturating_sub(batch_len);
        state.retained_bytes = state.retained_bytes.saturating_sub(batch_bytes);
        if state.retained_records == 0 {
            shared.drained.notify_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn queue_limits_include_in_flight_records_and_release_capacity() {
        let diagnostics = Arc::new(TransportDiagnostics::default());
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let scheduler = BoundedBatchScheduler::new(
            "bounded-test",
            1,
            3,
            30,
            1,
            10,
            Duration::from_secs(60),
            diagnostics.clone(),
            Arc::new(move |batch: Vec<u64>| {
                started_tx.send(batch[0]).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
                true
            }),
        );

        let enqueue_deadline = Instant::now() + Duration::from_secs(1);
        while !scheduler.try_enqueue(1, 10) {
            assert!(
                Instant::now() < enqueue_deadline,
                "first record should enqueue after worker startup contention clears"
            );
            std::thread::yield_now();
        }
        assert_eq!(started_rx.recv_timeout(Duration::from_secs(1)).unwrap(), 1);
        let enqueue_deadline = Instant::now() + Duration::from_secs(1);
        while !scheduler.try_enqueue(2, 10) {
            assert!(
                Instant::now() < enqueue_deadline,
                "second record should enqueue after worker lock contention clears"
            );
            std::thread::yield_now();
        }
        assert!(scheduler.try_enqueue(3, 10));
        assert!(!scheduler.try_enqueue(4, 10));
        let snapshot = scheduler.snapshot();
        assert_eq!(snapshot.retained_records, 3);
        assert_eq!(snapshot.retained_bytes, 30);
        assert_eq!(diagnostics.snapshot().locally_dropped, 1);

        for _ in 0..3 {
            release_tx.send(()).unwrap();
        }
        assert!(scheduler.force_flush(Duration::from_secs(2)));
        assert_eq!(scheduler.snapshot().retained_records, 0);
        assert!(scheduler.shutdown(Duration::from_secs(1), false));
    }

    #[test]
    fn second_worker_exports_while_first_batch_is_blocked() {
        let diagnostics = Arc::new(TransportDiagnostics::default());
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Arc::new(Mutex::new(release_rx));
        let scheduler = BoundedBatchScheduler::new(
            "parallel-test",
            2,
            4,
            40,
            1,
            10,
            Duration::from_secs(60),
            diagnostics,
            Arc::new(move |batch: Vec<u64>| {
                let value = batch[0];
                started_tx.send(value).unwrap();
                if value == 1 {
                    release_rx.lock().unwrap().recv().unwrap();
                }
                true
            }),
        );

        let enqueue_deadline = Instant::now() + Duration::from_secs(1);
        while !scheduler.try_enqueue(1, 10) {
            assert!(
                Instant::now() < enqueue_deadline,
                "first record should enqueue after worker startup contention clears"
            );
            std::thread::yield_now();
        }
        assert_eq!(started_rx.recv_timeout(Duration::from_secs(1)).unwrap(), 1);
        assert!(scheduler.try_enqueue(2, 10));
        assert_eq!(started_rx.recv_timeout(Duration::from_secs(1)).unwrap(), 2);
        release_tx.send(()).unwrap();
        assert!(scheduler.force_flush(Duration::from_secs(2)));
        assert!(scheduler.shutdown(Duration::from_secs(1), false));
    }
}
