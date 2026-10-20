/**
 * The prompt a shell currently owns is live state, not history.
 *
 * A reattached terminal replays the recorded output, and that replay would
 * rebuild the prompt too. The rebuilt prompt is laid out for the width the
 * replay writes at, while the shell's line editor still believes the prompt
 * occupies the rows it drew — so the repaint the shell sends for the resize
 * that follows reattachment lands one row off and leaves the rebuilt copy
 * behind. The reported screen showed a stray prompt character plus stacked
 * copies of the prompt after moving the terminal tab.
 *
 * The shell integration already delimits the prompt with its own marks
 * (`ESC]633;A` before it, `ESC]633;B` after it), so the replay payload can drop
 * that span and leave the prompt to the shell that is about to redraw it.
 *
 * This is only correct when the shell will actually repaint — a reattachment
 * that changes the terminal geometry always does, because the panel sends the
 * PTY a resize and the kernel raises SIGWINCH. Callers must check that.
 */

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);

const PROMPT_START_RE = new RegExp(
  `${ESCAPE_CHARACTER}\\]633;A(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`,
  'g',
);
const PROMPT_END_RE = new RegExp(
  `${ESCAPE_CHARACTER}\\]633;B(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`,
  'g',
);

function lastPromptStartIndex(data: string): number {
  PROMPT_START_RE.lastIndex = 0;
  let last = -1;
  let match = PROMPT_START_RE.exec(data);
  while (match) {
    last = match.index;
    match = PROMPT_START_RE.exec(data);
  }
  return last;
}

/**
 * Remove the trailing prompt region from a replay payload.
 *
 * `data` holds the replay chunks in order. Only the last chunk carrying a prompt
 * start mark is considered, and the span is dropped only when its end mark is in
 * the same chunk and nothing but line breaks follows it — a prompt that crosses a
 * chunk boundary, or one followed by more output, is left alone. Shells without
 * integration never match, so their replay is returned unchanged.
 */
export function dropShellOwnedPromptRegion(data: string[]): string[] {
  for (let index = data.length - 1; index >= 0; index -= 1) {
    const chunk = data[index];
    const start = lastPromptStartIndex(chunk);
    if (start < 0) {
      continue;
    }

    PROMPT_END_RE.lastIndex = 0;
    PROMPT_END_RE.lastIndex = start + 1;
    const endMatch = PROMPT_END_RE.exec(chunk);
    if (!endMatch) {
      return data;
    }

    const afterEnd = chunk.slice(endMatch.index + endMatch[0].length);
    if (afterEnd.replace(/[\r\n]/g, '').length > 0) {
      return data;
    }

    const trimmed = [...data];
    trimmed[index] = chunk.slice(0, start) + afterEnd;
    return trimmed;
  }

  return data;
}
