/**
 * Transcript assembly for HarmonyOS speech recognition.
 *
 * `speechRecognizer` results are clause-scoped snapshots: `isFinal` marks the
 * final result of the clause currently being recognized, and the results before
 * it are successive takes of that same clause that may insert, drop, or replace
 * characters anywhere inside it. A non-final snapshot therefore *replaces* the
 * clause; only a final snapshot is committed to the transcript. Concatenating
 * snapshots instead of replacing them repeats every take of the clause, which is
 * exactly what a prefix-overlap heuristic does when the engine revises the middle
 * of a sentence.
 *
 * This module owns the platform-independent part of that assembly and stays free
 * of platform imports so `src/apps/ohos/tests/speech-transcript.test.cjs` can
 * exercise it.
 *
 * It mirrors `src/web-ui/src/flow_chat/components/voice/voiceTranscript.ts`: the
 * host is the only place that assembles clauses, and the composer renders the
 * transcript it receives.
 */

const CJK_RANGE_STARTS: number[] = [0x3000, 0x3040, 0x3400, 0x4e00, 0xac00, 0xf900, 0xff00];
const CJK_RANGE_ENDS: number[] = [0x303f, 0x30ff, 0x4dbf, 0x9fff, 0xd7af, 0xfaff, 0xffef];

function isCjkCodePoint(code: number): boolean {
  for (let i = 0; i < CJK_RANGE_STARTS.length; i++) {
    if (code >= CJK_RANGE_STARTS[i] && code <= CJK_RANGE_ENDS[i]) {
      return true;
    }
  }
  return false;
}

function isSpaceCode(code: number): boolean {
  if (code === 0x20 || code === 0x00a0 || code === 0x3000 || code === 0x200b || code === 0xfeff) {
    return true;
  }
  if (code >= 0x09 && code <= 0x0d) {
    return true;
  }
  return code >= 0x2000 && code <= 0x200a;
}

function isAsciiWordCharacter(code: number): boolean {
  return (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a);
}

function isPrintableAscii(code: number): boolean {
  return code >= 0x21 && code <= 0x7e;
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
  return isPrintableAscii(previous.charCodeAt(0)) && isAsciiWordCharacter(next.charCodeAt(0));
}

/**
 * Collapse engine whitespace into composer-ready text.
 *
 * Spaces are kept only where at least one side is non-CJK, so `hello world`
 * survives while `因 都 在想` and `过 。` join up.
 */
export function normalizeRecognizedText(text: string): string {
  if (text.length === 0) {
    return '';
  }
  let output: string = '';
  let pendingSpace: boolean = false;
  let previous: string = '';
  for (let i = 0; i < text.length; i++) {
    const character: string = text.charAt(i);
    const code: number = text.charCodeAt(i);
    if (isSpaceCode(code)) {
      if (output.length > 0) {
        pendingSpace = true;
      }
      continue;
    }
    if (pendingSpace) {
      const dropSpace: boolean = previous.length > 0 &&
        isCjkCodePoint(previous.charCodeAt(0)) &&
        isCjkCodePoint(code);
      if (!dropSpace) {
        output += ' ';
      }
      pendingSpace = false;
    }
    output += character;
    previous = character;
  }
  return output.trim();
}

/**
 * Render the committed transcript plus the clause still being recognized.
 *
 * `clause` is the latest take of the current clause and replaces every earlier
 * take of it. Engines that re-send the whole session instead of one clause are
 * recognized by the snapshot already starting with the committed text.
 */
export function buildTranscript(committed: string, clause: string): string {
  const base: string = normalizeRecognizedText(committed);
  const pending: string = normalizeRecognizedText(clause);
  if (pending.length === 0) {
    return base;
  }
  if (base.length === 0) {
    return pending;
  }
  if (pending.startsWith(base)) {
    return pending;
  }
  const separator: string = needsWordSpace(base.charAt(base.length - 1), pending.charAt(0)) ? ' ' : '';
  return `${base}${separator}${pending}`;
}
