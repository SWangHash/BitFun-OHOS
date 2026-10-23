/**
 * The prompt a shell currently owns is live state, not history.
 *
 * A reattached terminal replays the recorded output, and that replay would rebuild
 * the prompt too. The rebuilt prompt is laid out for the width the replay writes at,
 * while the shell's line editor still believes the prompt occupies the rows it drew,
 * so the repaint the shell sends for the resize that follows reattachment lands on
 * another row and leaves the rebuilt copy behind. The reported screen showed a stray
 * prompt marker plus stacked copies of the prompt after moving the terminal.
 *
 * One copy is not the whole problem: a shell redraws its prompt for every resize it
 * is told about, and every redraw is recorded, so a session that has been resized
 * before carries several prompt copies in its transcript. In the live session they
 * overwrite each other through relative cursor motion; replayed at another geometry
 * they can each land on their own row. Dropping only the last copy therefore leaves
 * the earlier ones on screen, which is the shape users still reported.
 *
 * The shell integration already delimits the whole live region: `ESC]633;D` marks
 * the end of a command, and everything the shell writes after it belongs to the
 * prompt it is displaying (prompt marks, the `PROMPT_SP` marker, the line editor's
 * own drawing). The replay payload can drop that entire region and leave the prompt
 * to the shell that is about to redraw it.
 *
 * This is only correct when the shell will actually repaint — a reattachment that
 * changes the terminal geometry always does, because the panel sends the PTY a
 * resize and the kernel raises SIGWINCH. Callers must check that.
 */

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);

/** OSC payload terminator: BEL, or the two-character string terminator. */
const OSC_TERMINATOR = `(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`;

const PROMPT_START = `${ESCAPE_CHARACTER}\\]633;A${OSC_TERMINATOR}`;
const PROMPT_END = `${ESCAPE_CHARACTER}\\]633;B${OSC_TERMINATOR}`;
const COMMAND_OUTPUT_START = `${ESCAPE_CHARACTER}\\]633;C${OSC_TERMINATOR}`;
const COMMAND_FINISHED =
  `${ESCAPE_CHARACTER}\\]633;D(?:;[^${BELL_CHARACTER}${ESCAPE_CHARACTER}]*)?${OSC_TERMINATOR}`;

function lastMatchEnd(pattern: string, text: string): number {
  const regex = new RegExp(pattern, 'g');
  let last = -1;
  let match = regex.exec(text);
  while (match) {
    last = match.index + match[0].length;
    match = regex.exec(text);
  }
  return last;
}

function lastMatchStart(pattern: string, text: string): number {
  const regex = new RegExp(pattern, 'g');
  let last = -1;
  let match = regex.exec(text);
  while (match) {
    last = match.index;
    match = regex.exec(text);
  }
  return last;
}

/**
 * Start of the prompt region that follows the last finished command, or -1 when the
 * recording does not end at a prompt.
 *
 * The tail only counts as a prompt region when it contains a prompt start mark: a
 * transcript whose last command-finished mark is followed by nothing the shell drew
 * is left untouched.
 */
function promptRegionStart(text: string): number {
  const commandFinishedEnd = lastMatchEnd(COMMAND_FINISHED, text);
  if (commandFinishedEnd < 0) {
    return -1;
  }

  // A command in flight ends the recording in its output, not at a prompt; nothing
  // will repaint, so its bytes must survive.
  if (lastMatchEnd(COMMAND_OUTPUT_START, text) > commandFinishedEnd) {
    return -1;
  }

  if (lastMatchEnd(PROMPT_START, text) <= commandFinishedEnd) {
    return -1;
  }

  return commandFinishedEnd;
}

/**
 * Start of the last prompt span when the recording has no command marks (shells
 * without integration, or a transcript from an older integration). The span is only
 * dropped when nothing but line breaks follows its end mark.
 */
function trailingPromptSpanStart(text: string): number {
  const start = lastMatchStart(PROMPT_START, text);
  if (start < 0) {
    return -1;
  }

  const end = new RegExp(PROMPT_END).exec(text.slice(start));
  if (!end) {
    return -1;
  }

  const afterEnd = text.slice(start + end.index + end[0].length);
  if (afterEnd.replace(/[\r\n]/g, '').length > 0) {
    return -1;
  }

  return start;
}

/** Cut the joined payload at `cut`, keeping one entry per chunk so callers can map back. */
function truncateChunks(data: string[], cut: number): string[] {
  let consumed = 0;
  return data.map((chunk) => {
    const chunkStart = consumed;
    consumed += chunk.length;
    if (chunkStart >= cut) {
      return '';
    }
    return consumed <= cut ? chunk : chunk.slice(0, cut - chunkStart);
  });
}

/**
 * Remove the prompt region the shell still owns from a replay payload.
 *
 * `data` holds the replay chunks in order. The chunks are read as one payload —
 * a shell integration mark can straddle a chunk boundary — and every prompt copy in
 * the trailing region is dropped, because the shell redraws the prompt once for the
 * resize that follows the reattachment. Shells without integration fall back to
 * dropping a single trailing prompt span.
 */
export function dropShellOwnedPromptRegion(data: string[]): string[] {
  if (data.length === 0) {
    return data;
  }

  const text = data.join('');
  const promptRegion = promptRegionStart(text);
  if (promptRegion >= 0) {
    return truncateChunks(data, promptRegion);
  }

  const trailingSpan = trailingPromptSpanStart(text);
  if (trailingSpan >= 0) {
    return truncateChunks(data, trailingSpan);
  }

  return data;
}
