/**
 * TEMPORARY resize diagnostics for the terminal panel.
 *
 * Added to capture the PTY bytes and buffer state around a panel drag that
 * leaves a stray prompt character ("%") plus a blank line in the terminal.
 * Delete this file and every `#region agent log` block that imports it once the
 * artifact is confirmed fixed.
 */

// #region agent log
const DEBUG_LOG_URL = 'http://127.0.0.1:7469/log';

// Control characters are built from their codes so no regex literal contains a
// raw ESC (which the lint rules reject).
const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const OSC_RE = new RegExp(`${ESCAPE_CHARACTER}\\][^${BELL_CHARACTER}]*(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, 'g');
const CSI_RE = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, 'g');
const ESC_RE = new RegExp(`${ESCAPE_CHARACTER}(?:[@-Z\\\\-_]|\\([A-Za-z0-9]|\\)[A-Za-z0-9])`, 'g');
const ZSH_MARK_SGR_RE = new RegExp(
  `${ESCAPE_CHARACTER}\\[[0-9;]*m%${ESCAPE_CHARACTER}\\[[0-9;]*m`,
);

/** Minimal structural view of an xterm instance, so callers need no import. */
export interface BufferProbeTerminal {
  cols: number;
  rows: number;
  buffer: {
    active: {
      baseY: number;
      cursorX: number;
      cursorY: number;
      getLine(index: number):
        | { translateToString(trimRight?: boolean): string; isWrapped: boolean }
        | undefined;
    };
  };
}

export function logTerminalResize(
  hypothesis: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  try {
    void fetch(DEBUG_LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hypothesis, location, message, data }),
    }).catch(() => {});
  } catch {
    // Diagnostics must never change terminal behavior.
  }
}

/** Escape a raw PTY chunk so control sequences stay readable in the log. */
export function escapeTerminalChunk(value: string, maxLength = 900): string {
  return value
    .slice(0, maxLength)
    .split(ESCAPE_CHARACTER)
    .join('\\e')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

/**
 * Detect zsh's PROMPT_EOL_MARK (default `%B%S%#%s%b`, rendered as an inverted
 * "%") in a raw PTY chunk. Either an SGR-wrapped "%" or a "%" that starts a
 * line matches; both shapes are what a resize-triggered prompt repaint leaves
 * behind.
 */
export function detectZshPromptEolMark(data: string): boolean {
  if (ZSH_MARK_SGR_RE.test(data)) {
    return true;
  }

  const printable = data.replace(OSC_RE, '').replace(CSI_RE, '').replace(ESC_RE, '');
  return printable.split(/\r\n|\r|\n/).some(line => line.trim() === '%');
}

/**
 * Describe the visible tail of the buffer, marking xterm's soft-wrap
 * continuations with "~" so a split prompt line is distinguishable from a real
 * newline in the recorded output.
 */
export function describeVisibleBuffer(terminal: BufferProbeTerminal | null): unknown {
  if (!terminal) {
    return null;
  }

  const buffer = terminal.buffer.active;
  const firstRow = Math.max(0, buffer.baseY + terminal.rows - 14);
  const tail: string[] = [];
  for (let row = firstRow; row < buffer.baseY + terminal.rows; row += 1) {
    const line = buffer.getLine(row);
    if (!line) {
      continue;
    }
    const text = line.translateToString(true);
    if (text.trim().length === 0 && !line.isWrapped) {
      continue;
    }
    tail.push(`${line.isWrapped ? '~' : '|'}${text}`);
  }

  return {
    cols: terminal.cols,
    rows: terminal.rows,
    baseY: buffer.baseY,
    cursor: { x: buffer.cursorX, y: buffer.cursorY },
    tail,
  };
}
// #endregion
