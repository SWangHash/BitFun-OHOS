/**
 * Recovers keys whose keydown the browser reported without a usable key code.
 *
 * Chromium reports `keyCode` 229 for keydown events that belong to an IME session
 * (ArkWeb on HarmonyOS keeps that session open for hardware keyboards as well),
 * and some hosts report 0 for keys they do not map. xterm.js gives up on both
 * codes before it looks at the key itself, so the terminal never emits a PTY byte
 * for them: an arrow key delivered that way is silently dropped instead of moving
 * through shell history, which makes the press look dead and the next press look
 * like the first one that worked.
 *
 * `event.key` still identifies the physical key, so the sequence xterm would have
 * produced is rebuilt here and sent through the normal `onData` path.
 *
 * The same key code is also reported while an input method is composing, and there
 * the key belongs to the method: its arrow keys move through the candidate list,
 * so an `isComposing` event keeps the existing IME passthrough instead of gaining a
 * cursor sequence nobody asked the PTY for.
 */

/** Key codes xterm refuses to translate (`evaluateKeyboardEvent` bails out early). */
const UNMAPPED_KEY_CODES: ReadonlySet<number> = new Set([0, 229]);

/** Cursor keys that share the DECCKM prefix switching between `CSI` and `SS3`. */
const CURSOR_KEY_FINALS: Readonly<Record<string, string>> = {
  ArrowUp: 'A',
  ArrowDown: 'B',
  ArrowRight: 'C',
  ArrowLeft: 'D',
  Home: 'H',
  End: 'F',
};

/** Keys whose sequence does not depend on DECCKM. */
const FIXED_SEQUENCES: Readonly<Record<string, string>> = {
  Insert: '\x1b[2~',
  Delete: '\x1b[3~',
  PageUp: '\x1b[5~',
  PageDown: '\x1b[6~',
};

export interface UnmappedKeydownContext {
  /** DECCKM (CSI ? 1 h): a full-screen app asked for `ESC O` cursor keys. */
  applicationCursorKeys: boolean;
}

type UnmappedKeydownEvent = Pick<
  KeyboardEvent,
  'key' | 'keyCode' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'isComposing'
>;

/**
 * Return the sequence for a keydown xterm cannot translate, or null when this
 * event is not one of those keys.
 *
 * Modified presses are left alone on purpose: their sequences differ per
 * modifier (CSI 1;2H and friends), and a plain pass-through press must not be
 * turned into a different command. Shift+Arrow is xterm's scrollback gesture.
 */
export function resolveUnmappedKeydownSequence(
  event: UnmappedKeydownEvent,
  context: UnmappedKeydownContext,
): string | null {
  if (!UNMAPPED_KEY_CODES.has(event.keyCode)) {
    return null;
  }

  // Composing keys belong to the input method, which reaches this key code as
  // well. Rebuilding a cursor sequence for them would move the terminal cursor or
  // scroll history while the user is only picking a candidate.
  if (event.isComposing) {
    return null;
  }

  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
    return null;
  }

  const fixed = FIXED_SEQUENCES[event.key];
  if (fixed) {
    return fixed;
  }

  const final = CURSOR_KEY_FINALS[event.key];
  if (!final) {
    return null;
  }

  return `${context.applicationCursorKeys ? '\x1bO' : '\x1b['}${final}`;
}
