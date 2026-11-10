/**
 * Client-side guard against the HarmonyOS call answering itself.
 *
 * The host already rejects synthesized echo before it emits a transcript
 * (`VoiceEchoGuard.ets`), but the two sides can disagree: the host knows what it
 * spoke, this layer knows what the controller asked to speak. Keeping a second,
 * independent check here means a misjudged echo cannot start a task from the
 * assistant's own words — the failure mode where a call keeps announcing "a new
 * BitFun session is being created" forever.
 *
 * Tokenization matches the host so both sides agree on what "the same words"
 * means: CJK characters and Latin words.
 */

const ECHO_COVERAGE_THRESHOLD = 0.7;

function isCjkCode(code: number): boolean {
  if (code >= 0x3400 && code <= 0x4dbf) return true;
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  return code >= 0xf900 && code <= 0xfaff;
}

function isKeptCode(code: number): boolean {
  if (code >= 0x30 && code <= 0x39) return true;
  if (code >= 0x61 && code <= 0x7a) return true;
  if (code >= 0x41 && code <= 0x5a) return true;
  return isCjkCode(code);
}

/** CJK single characters and Latin words, lowercased, punctuation dropped. */
export function normalizeVoiceTokens(text: string): string[] {
  const tokens: string[] = [];
  let word = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (!isKeptCode(code)) {
      if (word) {
        tokens.push(word.toLowerCase());
        word = '';
      }
      continue;
    }
    if (isCjkCode(code)) {
      if (word) {
        tokens.push(word.toLowerCase());
        word = '';
      }
      tokens.push(text.charAt(index));
      continue;
    }
    word += text.charAt(index);
  }
  if (word) tokens.push(word.toLowerCase());
  return tokens;
}

/** Stable key for "the same request was already handled". */
export function voiceTextKey(text: string): string {
  return normalizeVoiceTokens(text).join(' ');
}

function tokenCoverage(candidate: string[], reference: string[]): number {
  if (candidate.length === 0) return 0;
  const remaining = new Map<string, number>();
  for (const token of reference) {
    remaining.set(token, (remaining.get(token) ?? 0) + 1);
  }
  let matched = 0;
  for (const token of candidate) {
    const left = remaining.get(token) ?? 0;
    if (left > 0) {
      remaining.set(token, left - 1);
      matched += 1;
    }
  }
  return matched / candidate.length;
}

/**
 * Whether a completed transcript is mostly made of the words just spoken.
 * A single token needs a full match: "停" must be able to interrupt.
 */
export function isLikelySpokenEcho(text: string, spoken: string): boolean {
  const candidate = normalizeVoiceTokens(text);
  if (candidate.length === 0) return false;
  const reference = normalizeVoiceTokens(spoken);
  if (reference.length === 0) return false;
  const coverage = tokenCoverage(candidate, reference);
  if (candidate.length === 1) return coverage >= 1;
  return coverage >= ECHO_COVERAGE_THRESHOLD;
}
