/**
 * Barge-in classifier for the HarmonyOS realtime voice call.
 *
 * Recognition keeps running while the system voice speaks so the user can
 * interrupt. That means the recognizer also transcribes the assistant's own
 * playback: without a guard the call would cut itself off on the first echoed
 * clause. This module owns only the decision, never audio or engine state, so
 * `src/apps/ohos/tests/realtime-voice-echo.test.cjs` can exercise every case.
 *
 * Tokens are CJK characters and Latin words. Character-level coverage alone
 * cannot work for English — 26 letters make almost any two sentences overlap —
 * while word-level coverage would erase a one-character Chinese interruption
 * like "停". Tokenizing per script keeps both honest.
 */

/**
 * Barge-in signal for one recognition snapshot.
 *
 * An enum rather than a string-literal type alias: the call site imports this
 * as a value and compares against it, and ArkTS rejects a type-only export that
 * is imported through a normal import.
 */
export enum VoiceSignalKind {
  /** The assistant is hearing its own playback. */
  Echo = 'echo',
  /** Too little text to decide; dropping it is safer than interrupting. */
  Ignore = 'ignore',
  /** The user is interrupting. */
  Speech = 'speech',
}

/**
 * Share of the snapshot's tokens that must appear in the spoken text for it to
 * count as echo. Below this, an interruption may merely reuse a few words the
 * assistant was saying.
 */
const ECHO_COVERAGE_THRESHOLD = 0.6;

function isCjkCode(code: number): boolean {
  // CJK unified ideographs, extension A, compatibility ideographs.
  if (code >= 0x3400 && code <= 0x4dbf) {
    return true;
  }
  if (code >= 0x4e00 && code <= 0x9fff) {
    return true;
  }
  return code >= 0xf900 && code <= 0xfaff;
}

function isKeptCode(code: number): boolean {
  if (code >= 0x30 && code <= 0x39) {
    return true;
  }
  if (code >= 0x61 && code <= 0x7a) {
    return true;
  }
  if (code >= 0x41 && code <= 0x5a) {
    return true;
  }
  return isCjkCode(code);
}

/**
 * Lowercase, drop punctuation and symbols, and collapse every separator to one
 * space. The recognizer may punctuate an echo differently from the spoken text,
 * so both sides are compared in the same reduced form.
 */
export function normalizeForEcho(text: string): string {
  let output: string = '';
  let pendingSpace: boolean = false;
  for (let index = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    if (isKeptCode(code)) {
      if (pendingSpace && output.length > 0) {
        output += ' ';
      }
      pendingSpace = false;
      output += String.fromCharCode(code);
      continue;
    }
    if (output.length > 0) {
      pendingSpace = true;
    }
  }
  return output.toLowerCase();
}

/** Split into CJK single-character tokens and Latin word tokens. */
function tokenize(normalized: string): string[] {
  const tokens: string[] = [];
  let word: string = '';
  for (let index = 0; index < normalized.length; index++) {
    const character: string = normalized.charAt(index);
    if (character === ' ') {
      if (word.length > 0) {
        tokens.push(word);
        word = '';
      }
      continue;
    }
    if (isCjkCode(normalized.charCodeAt(index))) {
      if (word.length > 0) {
        tokens.push(word);
        word = '';
      }
      tokens.push(character);
      continue;
    }
    word += character;
  }
  if (word.length > 0) {
    tokens.push(word);
  }
  return tokens;
}

/** Share of `candidate` tokens present in `reference`, honoring repeats. */
function tokenCoverage(candidate: string[], reference: string[]): number {
  if (candidate.length === 0) {
    return 0;
  }
  const remaining: Map<string, number> = new Map<string, number>();
  for (let index = 0; index < reference.length; index++) {
    const token: string = reference[index];
    const current: number = remaining.get(token) ?? 0;
    remaining.set(token, current + 1);
  }
  let matched: number = 0;
  for (let index = 0; index < candidate.length; index++) {
    const token: string = candidate[index];
    const left: number = remaining.get(token) ?? 0;
    if (left > 0) {
      remaining.set(token, left - 1);
      matched += 1;
    }
  }
  return matched / candidate.length;
}

/**
 * Classify one recognition snapshot against the text currently being spoken.
 * `spokenText` is empty when nothing is playing, which can only report `speech`.
 *
 * A single token needs a full match to count as echo: "停" must interrupt, while
 * a lone syllable the answer itself contains is the assistant hearing itself.
 */
export function classifyVoiceSignal(snapshot: string, spokenText: string): VoiceSignalKind {
  const candidate: string[] = tokenize(normalizeForEcho(snapshot));
  if (candidate.length === 0) {
    return VoiceSignalKind.Ignore;
  }
  const reference: string[] = tokenize(normalizeForEcho(spokenText));
  if (reference.length === 0) {
    return VoiceSignalKind.Speech;
  }
  const coverage: number = tokenCoverage(candidate, reference);
  if (candidate.length === 1) {
    return coverage >= 1 ? VoiceSignalKind.Echo : VoiceSignalKind.Speech;
  }
  return coverage >= ECHO_COVERAGE_THRESHOLD ? VoiceSignalKind.Echo : VoiceSignalKind.Speech;
}
