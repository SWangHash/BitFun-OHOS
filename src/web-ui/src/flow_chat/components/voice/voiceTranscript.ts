/**
 * Composer voice-input transcript rendering.
 *
 * Streaming hosts push *snapshots*, not deltas, and each host owns one way of
 * assembling them: HarmonyOS `speechRecognizer` reports clause-scoped results,
 * and the ArkTS host commits a clause on `isFinal` and replaces it before that.
 * The composer therefore renders exactly the snapshot it receives — `draft +
 * transcript`. It must never append a delta or guess how snapshots relate to
 * each other: appending `${current} ${delta}` turns one sentence into
 * space-separated fragments, and a prefix-overlap heuristic repeats every take
 * of a clause whose middle the engine revised.
 *
 * Every snapshot is normalized first: HarmonyOS speech results can separate
 * Chinese tokens with spaces (`因 都 在想`), which must never reach the composer.
 */

const CJK_RANGES: readonly (readonly [number, number])[] = [
  [0x3000, 0x303f], // CJK punctuation and ideographic space
  [0x3040, 0x30ff], // Hiragana and Katakana
  [0x3400, 0x4dbf], // CJK unified ideographs extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xac00, 0xd7af], // Hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xff00, 0xffef], // Fullwidth forms
];

function isCjkCodePoint(codePoint: number): boolean {
  for (const [start, end] of CJK_RANGES) {
    if (codePoint >= start && codePoint <= end) {
      return true;
    }
  }
  return false;
}

function isSpaceCharacter(character: string): boolean {
  return /^\s$/u.test(character) || character === '\u200b' || character === '\ufeff';
}

/**
 * Whether two adjacent segments are separate Latin words.
 *
 * Chinese takes no separating space; only two Latin word boundaries do, which
 * keeps `帮我写一个函数` + `实现排序` intact and `write` + `tests` readable.
 */
function needsWordSpace(previous: string, next: string): boolean {
  if (previous.length === 0 || next.length === 0) {
    return false;
  }
  return /^[\x21-\x7e]$/.test(previous) && /^[A-Za-z0-9]$/.test(next);
}

/**
 * Collapse engine whitespace into composer-ready text.
 *
 * Spaces are kept only where at least one side is non-CJK, so `hello world`
 * survives while `因 都 在想` and `过 。` join up.
 */
export function normalizeSpeechText(text: string): string {
  if (!text) {
    return '';
  }
  let output = '';
  let pendingSpace = false;
  let previous = '';
  for (const character of Array.from(text)) {
    if (isSpaceCharacter(character)) {
      pendingSpace = output.length > 0;
      continue;
    }
    if (pendingSpace) {
      const dropSpace = previous.length > 0
        && isCjkCodePoint(previous.codePointAt(0) ?? 0)
        && isCjkCodePoint(character.codePointAt(0) ?? 0);
      if (!dropSpace) {
        output += ' ';
      }
      pendingSpace = false;
    }
    output += character;
    previous = character;
  }
  return output;
}

/**
 * Join the composer draft with a transcript.
 */
export function joinDraftAndSpeech(draft: string, speech: string): string {
  const spoken = normalizeSpeechText(speech);
  const trimmedDraft = draft.trimEnd();
  if (trimmedDraft.length === 0) {
    return spoken;
  }
  if (spoken.length === 0) {
    return trimmedDraft;
  }
  const separator = needsWordSpace(
    trimmedDraft.charAt(trimmedDraft.length - 1),
    spoken.charAt(0),
  ) ? ' ' : '';
  return `${trimmedDraft}${separator}${spoken}`;
}

/**
 * Take the transcript a host snapshot describes.
 *
 * The host assembles clauses and sends the cumulative transcript, so the latest
 * snapshot is authoritative — including when it is shorter, because a revised
 * clause can legitimately drop characters. An empty snapshot never clears text
 * that is already on screen.
 */
export function takeTranscriptSnapshot(current: string, snapshot: string): string {
  const next = normalizeSpeechText(snapshot);
  return next.length > 0 ? next : normalizeSpeechText(current);
}
