import { buildTranscript, normalizeRecognizedText } from './SpeechTranscript';

/**
 * Assemble realtime-call transcripts from recognizer results.
 *
 * The platform engine revises one clause at a time (`isFinal` marks the end of
 * that clause) while the session itself keeps running for the whole call. Two
 * properties of that contract are what the call needs, and mixing them into one
 * string is what produced the reported symptoms:
 *
 * - The clause being recognized is replaced by each intermediate take. Appending
 *   intermediates repeats them; only `isFinal` closes a clause.
 * - A session can report text that already contains earlier clauses, and it can
 *   keep doing so after a sentence was submitted. Whatever was submitted must be
 *   removed from the front, otherwise the next sentence starts with the previous
 *   one ("the new text was added on top of the earlier text").
 *
 * `submitted` is the text already emitted as `user_transcript_completed` for
 * this engine session. `committed` is the finalized part of the sentence being
 * built, and `partial` is the latest take of the clause still being recognized.
 *
 * Kept free of platform imports so `src/apps/ohos/tests/
 * realtime-voice-transcript.test.cjs` can exercise it.
 */
export class VoiceTranscriptAssembler {
  private submitted: string = '';
  private committed: string = '';
  private partial: string = '';

  /** Forget everything. Call when a new engine session starts. */
  reset(): void {
    this.submitted = '';
    this.committed = '';
    this.partial = '';
  }

  /** Start a new sentence in the same engine session. */
  resetUtterance(): void {
    this.committed = '';
    this.partial = '';
  }

  /** Sentence shown to the user and submitted on silence. */
  display(): string {
    return buildTranscript(this.committed, this.partial);
  }

  /**
   * Fold one recognizer result into the sentence being built and return the
   * updated display text.
   */
  apply(rawText: string, isFinal: boolean): string {
    const text: string = normalizeRecognizedText(rawText);
    if (text.length === 0) {
      return this.display();
    }
    const remaining: string = this.stripSubmitted(text);
    if (remaining.trim().length === 0) {
      // Everything in this take was already submitted: the session is echoing
      // the sentence it just finished instead of reporting new speech.
      return this.display();
    }
    if (isFinal) {
      this.committed = buildTranscript(this.committed, remaining);
      this.partial = '';
    } else {
      this.partial = remaining;
    }
    return this.display();
  }

  /**
   * Take the finished sentence and remember it as submitted for this engine
   * session, so a session-wide cumulative result cannot repeat it.
   */
  takeSentence(): string {
    const sentence: string = this.display();
    this.committed = '';
    this.partial = '';
    if (sentence.length > 0) {
      this.submitted = buildTranscript(this.submitted, sentence);
    }
    return sentence;
  }

  /**
   * Remove text this engine session already delivered. Only a *longer* result
   * that starts with the submitted text is a cumulative session snapshot: a
   * clause-scoped result never contains it, and an identical result is the user
   * repeating the sentence, which must not be swallowed.
   */
  private stripSubmitted(text: string): string {
    const submitted: string = this.submitted;
    if (submitted.length === 0 || text.length <= submitted.length) {
      return text;
    }
    if (!text.startsWith(submitted)) {
      return text;
    }
    return text.slice(submitted.length);
  }
}
