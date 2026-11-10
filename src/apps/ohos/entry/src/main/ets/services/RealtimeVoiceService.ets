import { Context } from '@kit.AbilityKit';
import { audio } from '@kit.AudioKit';
import { speechRecognizer, textToSpeech } from '@kit.CoreSpeechKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import RustModule from 'libbitfun_desktop_lib.so';
import { buildTranscript, normalizeRecognizedText } from './SpeechTranscript';
import { classifyVoiceSignal, VoiceSignalKind } from './VoiceEchoGuard';
import { ensureMicrophonePermission } from './VoiceInputService';

/**
 * HarmonyOS client-side realtime voice call.
 *
 * The desktop provider hosts recognition, dialogue, and synthesis in one
 * service. HarmonyOS has no equivalent hosted provider, so this service owns
 * the two halves the system does provide — on-device `speechRecognizer` for
 * input and `textToSpeech` for output — and reports them through the same
 * `speech://realtime-event` schema the desktop provider emits. The web-ui
 * controller therefore keeps one event contract: dialogue and task routing stay
 * on the client (`VoiceCall` -> Agent task), never in this file.
 *
 * Recognition never stops between utterances. `recognizerMode: 'long'` segments
 * speech with VAD and reports each segment as a final result; a `isLast` result
 * means the engine itself finished, so the service reopens it and the call
 * continues.
 *
 * Barge-in is intentionally limited: speech synthesis is audible, so feeding
 * microphone frames back into the recognizer while it speaks would make the
 * assistant transcribe itself and cut its own answer. Capture keeps running for
 * the particle meter but recognition input is paused until playback ends.
 */

const REALTIME_DOMAIN: number = 0x0000;
const REALTIME_TAG: string = 'BitFunRealtimeVoice';
const AUDIO_CHUNK_BYTES = 1280;
const HALF_AUDIO_CHUNK_BYTES = 640;
const DEFAULT_LANGUAGE = 'zh-CN';
const ENGINE_VAD_BEGIN = 2000;
const ENGINE_VAD_END = 3000;
const ENGINE_MAX_AUDIO_DURATION = 8 * 60 * 60 * 1000;
const LEVEL_INTERVAL_FRAMES = 2;
const TTS_POLL_INTERVAL_MS = 250;
const TTS_MAX_WAIT_MS = 120000;
/**
 * `CreateEngineParams.online` selects the engine build: 0 is the online engine,
 * 1 is the on-device one (the value is inverted from the field name).
 */
const TTS_ONLINE_ENGINE = 0;
const TTS_OFFLINE_ENGINE = 1;
/** `CreateEngineParams.person`: 0 is the female voice, 1 the male voice. */
const TTS_PERSON = 0;

interface RealtimeStartRequest {
  language?: string;
}

interface RealtimeSpeakRequest {
  text?: string;
}

/**
 * Mirrors the web-ui `SpeechRealtimeEvent` payload. `audioLevel` uses -1 for
 * "not a level event" so the object shape stays constant for ArkTS.
 */
interface RealtimeEventPayload {
  sessionId: string;
  kind: string;
  text: string;
  audioLevel: number;
}

export class RealtimeVoiceService {
  private context?: Context;
  private sessionId: string = '';
  private language: string = DEFAULT_LANGUAGE;
  private engine?: speechRecognizer.SpeechRecognitionEngine;
  private capturer?: audio.AudioCapturer;
  private listening: boolean = false;
  private reading: boolean = false;
  /**
   * Identity of the active capture loop. Reopening recognition replaces the
   * capturer, and an older loop still blocked in `read()` must not keep
   * draining the new capturer: start() and every restart bump this counter.
   */
  private captureGeneration: number = 0;
  private recognitionReady: boolean = false;
  private pendingAudio: Uint8Array = new Uint8Array(0);
  private clauseCommitted: string = '';
  private utteranceActive: boolean = false;
  private frameCounter: number = 0;
  private ttsEngine?: textToSpeech.TextToSpeechEngine;
  private ttsSpeaking: boolean = false;
  /** Text currently being synthesized, used to reject self-echo transcripts. */
  private ttsCurrentText: string = '';
  /** Request id of the utterance in flight; callbacks for older ids are ignored. */
  private ttsRequestId: string = '';
  private ttsPollTimer?: number;
  private ttsUtteranceCounter: number = 0;
  private ttsWaitStartedAt: number = 0;
  private idCounter: number = 0;
  private lastRestartAt: number = 0;

  async start(arg: string): Promise<string> {
    await this.stopInternal(false);
    const context = this.context;
    if (!context) {
      throw new Error('Realtime voice service is not bound to a context');
    }
    await ensureMicrophonePermission(context);
    const request: RealtimeStartRequest = JSON.parse(arg);
    this.language = this.resolveLanguage(request.language);
    this.sessionId = this.newSessionId();
    this.clauseCommitted = '';
    this.utteranceActive = false;
    this.frameCounter = 0;
    this.pendingAudio = new Uint8Array(0);
    this.recognitionReady = false;
    this.listening = true;
    try {
      await this.openRecognition();
    } catch (err) {
      const failErr: Error = this.toError(err);
      hilog.error(REALTIME_DOMAIN, REALTIME_TAG, 'realtime voice start failed: %{public}s',
        failErr.message);
      await this.stopInternal(true);
      throw failErr;
    }
    this.emit('connected', '', -1);
    this.emit('ready', '', -1);
    hilog.info(REALTIME_DOMAIN, REALTIME_TAG, 'realtime voice ready: session=%{public}s',
      this.sessionId);
    return JSON.stringify({ sessionId: this.sessionId });
  }

  async speak(arg: string): Promise<string> {
    const request: RealtimeSpeakRequest = JSON.parse(arg);
    const rawText: string = request.text ?? '';
    const text: string = rawText.trim();
    if (this.sessionId.length === 0 || text.length === 0) {
      return '';
    }
    const sessionId: string = this.sessionId;
    try {
      const engine: textToSpeech.TextToSpeechEngine = await this.ensureTtsEngine();
      if (this.sessionId !== sessionId) {
        return '';
      }
      this.ttsUtteranceCounter += 1;
      const utteranceId: string = `realtime-${this.sessionId}-${this.ttsUtteranceCounter}`;
      this.ttsRequestId = utteranceId;
      this.ttsSpeaking = true;
      this.ttsCurrentText = text;
      this.ttsWaitStartedAt = Date.now();
      this.emit('assistant_audio_started', '', -1);
      hilog.info(REALTIME_DOMAIN, REALTIME_TAG,
        'realtime speech: session=%{public}s utterance=%{public}s chars=%{public}d',
        this.sessionId, utteranceId, text.length);
      engine.speak(text, { requestId: utteranceId });
      this.watchSpeechCompletion(engine, sessionId, utteranceId);
    } catch (err) {
      this.ttsSpeaking = false;
      const message: string = this.toError(err).message;
      hilog.error(REALTIME_DOMAIN, REALTIME_TAG,
        'realtime speech synthesis failed: session=%{public}s error=%{public}s',
        sessionId, message);
      this.emit('error', message, -1);
    }
    return '';
  }

  stopSpeechNow(_arg: string): Promise<string> {
    this.stopSpeech(false);
    return Promise.resolve('');
  }

  async stop(_arg: string): Promise<string> {
    hilog.info(REALTIME_DOMAIN, REALTIME_TAG, 'realtime voice stop requested: session=%{public}s',
      this.sessionId);
    await this.stopInternal(true);
    return '';
  }

  setContext(context: Context): void {
    this.context = context;
  }

  private async openRecognition(): Promise<void> {
    const engine: speechRecognizer.SpeechRecognitionEngine = await speechRecognizer.createEngine({
      language: this.language,
      online: 1,
      extraParams: {
        locate: 'CN',
        recognizerMode: 'long'
      }
    });
    this.engine = engine;
    engine.setListener(this.buildRecognitionListener());
    this.capturer = await this.createCapturer();
    engine.startListening({
      sessionId: this.sessionId,
      audioInfo: {
        audioType: 'pcm',
        sampleRate: 16000,
        soundChannel: 1,
        sampleBit: 16
      },
      extraParams: {
        recognitionMode: 1,
        vadBegin: ENGINE_VAD_BEGIN,
        vadEnd: ENGINE_VAD_END,
        maxAudioDuration: ENGINE_MAX_AUDIO_DURATION
      }
    });
    const capturer: audio.AudioCapturer | undefined = this.capturer;
    if (capturer) {
      await capturer.start();
    }
    this.reading = true;
    this.captureGeneration += 1;
    this.captureLoop(this.sessionId, this.captureGeneration);
  }

  /**
   * Reopen recognition after the engine reports `isLast`. A finished engine does
   * not keep the call alive, and the user should not have to restart the call to
   * keep talking.
   */
  private async restartRecognition(): Promise<void> {
    const sessionId: string = this.sessionId;
    if (!this.listening) {
      return;
    }
    // An engine that reports `isLast` repeatedly would reopen in a tight loop
    // and starve recognition; keep one restart per half second.
    const now: number = Date.now();
    if (now - this.lastRestartAt < 500) {
      hilog.warn(REALTIME_DOMAIN, REALTIME_TAG,
        'skipping rapid recognition restart: session=%{public}s', sessionId);
      return;
    }
    this.lastRestartAt = now;
    await this.releaseRecognition();
    if (!this.listening || this.sessionId !== sessionId) {
      return;
    }
    this.recognitionReady = false;
    this.pendingAudio = new Uint8Array(0);
    try {
      await this.openRecognition();
      hilog.info(REALTIME_DOMAIN, REALTIME_TAG,
        'realtime recognition reopened: session=%{public}s', sessionId);
    } catch (err) {
      if (this.sessionId !== sessionId) {
        return;
      }
      const message: string = this.toError(err).message;
      hilog.error(REALTIME_DOMAIN, REALTIME_TAG,
        'realtime recognition reopen failed: session=%{public}s error=%{public}s',
        sessionId, message);
      this.emit('error', message, -1);
      await this.stopInternal(false);
    }
  }

  private buildRecognitionListener(): speechRecognizer.RecognitionListener {
    return {
      onStart: (sessionId: string, eventMessage: string): void => {
        hilog.info(REALTIME_DOMAIN, REALTIME_TAG,
          'recognition onStart: session=%{public}s message=%{public}s', sessionId, eventMessage);
        if (sessionId !== this.sessionId) {
          return;
        }
        this.recognitionReady = true;
        this.flushPendingAudio(false);
      },
      onEvent: (sessionId: string, eventCode: number, eventMessage: string): void => {
        hilog.info(REALTIME_DOMAIN, REALTIME_TAG,
          'recognition onEvent: session=%{public}s code=%{public}d message=%{public}s',
          sessionId, eventCode, eventMessage);
      },
      onResult: (sessionId: string, result: speechRecognizer.SpeechRecognitionResult): void => {
        if (sessionId !== this.sessionId) {
          return;
        }
        this.handleResult(result);
      },
      onComplete: (sessionId: string, eventMessage: string): void => {
        hilog.info(REALTIME_DOMAIN, REALTIME_TAG,
          'recognition onComplete: session=%{public}s message=%{public}s',
          sessionId, eventMessage);
      },
      onError: (sessionId: string, errorCode: number, errorMessage: string): void => {
        if (sessionId !== this.sessionId) {
          return;
        }
        const message: string = errorMessage.length > 0
          ? errorMessage
          : `Realtime voice recognition failed (${errorCode})`;
        hilog.error(REALTIME_DOMAIN, REALTIME_TAG,
          'recognition onError: session=%{public}s code=%{public}d message=%{public}s',
          sessionId, errorCode, message);
        this.emit('error', message, -1);
        this.stopInternal(false);
      }
    };
  }

  private handleResult(result: speechRecognizer.SpeechRecognitionResult): void {
    const snapshot: string = normalizeRecognizedText(result.result);
    const isFinal: boolean = result.isFinal;
    const engineFinished: boolean = result.isLast;
    hilog.info(REALTIME_DOMAIN, REALTIME_TAG,
      'recognition onResult: isFinal=%{public}d isLast=%{public}d rawText=%{public}s',
      isFinal ? 1 : 0, engineFinished ? 1 : 0, result.result);
    if (snapshot.length > 0 && this.ttsSpeaking) {
      // Playback is audible and capture keeps running so the user can interrupt.
      // The echo guard separates the assistant hearing itself from a real
      // barge-in; only the latter stops the answer.
      const signal: VoiceSignalKind = classifyVoiceSignal(snapshot, this.ttsCurrentText);
      if (signal === VoiceSignalKind.Echo) {
        hilog.info(REALTIME_DOMAIN, REALTIME_TAG,
          'dropped synthesized echo: rawText=%{public}s', result.result);
      } else if (signal === VoiceSignalKind.Speech) {
        hilog.info(REALTIME_DOMAIN, REALTIME_TAG,
          'barge-in detected, stopping playback: rawText=%{public}s', result.result);
        this.stopSpeech(true);
        // The frame that proved the interruption is not transcribed: a marginal
        // match must not leak into the new task description. Recognition revises
        // the clause on the following result.
        this.utteranceActive = true;
        this.emit('user_speech_started', '', -1);
      }
    } else if (snapshot.length > 0) {
      if (!this.utteranceActive) {
        this.utteranceActive = true;
        this.emit('user_speech_started', '', -1);
      }
      const transcript: string = buildTranscript(this.clauseCommitted, snapshot);
      if (isFinal) {
        this.clauseCommitted = '';
        this.utteranceActive = false;
        this.emit('user_transcript_completed', transcript, -1);
      } else {
        this.emit('user_transcript_delta', transcript, -1);
      }
    }
    if (engineFinished) {
      this.utteranceActive = false;
      this.clauseCommitted = '';
      if (this.listening) {
        void this.restartRecognition();
      }
    }
  }

  private async captureLoop(sessionId: string, generation: number): Promise<void> {
    while (this.reading && this.sessionId === sessionId && this.captureGeneration === generation) {
      const capturer: audio.AudioCapturer | undefined = this.capturer;
      if (!capturer) {
        break;
      }
      try {
        const buffer: ArrayBuffer = await capturer.read(AUDIO_CHUNK_BYTES, true);
        if (!this.reading || this.sessionId !== sessionId || this.captureGeneration !== generation) {
          break;
        }
        this.frameCounter += 1;
        const level: number = this.audioLevel(buffer);
        // Frames reach the recognizer even while the system voice speaks:
        // barge-in depends on it, and the echo guard rejects self-transcripts.
        this.writeAudioBuffer(sessionId, buffer);
        if (this.frameCounter % LEVEL_INTERVAL_FRAMES === 0) {
          this.emit('user_audio_level', '', level);
        }
      } catch (err) {
        if (this.sessionId !== sessionId || this.captureGeneration !== generation) {
          break;
        }
        if (this.ttsSpeaking) {
          // Playback can momentarily starve the capture path. Losing the call
          // because of a transient read error would be worse than a dropped frame.
          hilog.warn(REALTIME_DOMAIN, REALTIME_TAG,
            'audio capture read failed during playback: session=%{public}s error=%{public}s',
            sessionId, this.toError(err).message);
          await this.delay(50);
          continue;
        }
        const message: string = this.toError(err).message;
        hilog.error(REALTIME_DOMAIN, REALTIME_TAG,
          'realtime audio capture failed: session=%{public}s error=%{public}s', sessionId, message);
        this.emit('error', `Microphone capture failed: ${message}`, -1);
        await this.stopInternal(false);
        break;
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve();
      }, ms);
    });
  }

  /** Peak-normalized PCM16 loudness (0-255) for the call particle meter. */
  private audioLevel(buffer: ArrayBuffer): number {    if (buffer.byteLength < 2 || buffer.byteLength % 2 !== 0) {
      return 0;
    }
    const samples: Int16Array = new Int16Array(buffer);
    let sum: number = 0;
    for (let index = 0; index < samples.length; index++) {
      const value: number = samples[index];
      sum += value * value;
    }
    const rms: number = Math.sqrt(sum / samples.length);
    const level: number = Math.round(rms / 128);
    return level > 255 ? 255 : level;
  }

  private writeAudioBuffer(sessionId: string, buffer: ArrayBuffer): void {
    const engine: speechRecognizer.SpeechRecognitionEngine | undefined = this.engine;
    if (!engine || buffer.byteLength === 0) {
      return;
    }
    const incoming: Uint8Array = new Uint8Array(buffer);
    const data: Uint8Array = new Uint8Array(this.pendingAudio.length + incoming.length);
    data.set(this.pendingAudio, 0);
    data.set(incoming, this.pendingAudio.length);
    let offset: number = 0;
    if (this.recognitionReady) {
      while (offset + AUDIO_CHUNK_BYTES <= data.length) {
        engine.writeAudio(sessionId, data.subarray(offset, offset + AUDIO_CHUNK_BYTES));
        offset += AUDIO_CHUNK_BYTES;
      }
    }
    this.pendingAudio = data.slice(offset);
  }

  private flushPendingAudio(finalFlush: boolean): void {
    const engine: speechRecognizer.SpeechRecognitionEngine | undefined = this.engine;
    if (!engine || this.pendingAudio.length === 0 || this.sessionId.length === 0) {
      return;
    }
    let offset: number = 0;
    while (offset + AUDIO_CHUNK_BYTES <= this.pendingAudio.length) {
      engine.writeAudio(this.sessionId, this.pendingAudio.subarray(offset, offset + AUDIO_CHUNK_BYTES));
      offset += AUDIO_CHUNK_BYTES;
    }
    const remainder: number = this.pendingAudio.length - offset;
    if (remainder === HALF_AUDIO_CHUNK_BYTES) {
      engine.writeAudio(this.sessionId,
        this.pendingAudio.subarray(offset, offset + HALF_AUDIO_CHUNK_BYTES));
      offset += HALF_AUDIO_CHUNK_BYTES;
    } else if (finalFlush && remainder > 0) {
      const padded: Uint8Array = new Uint8Array(HALF_AUDIO_CHUNK_BYTES);
      padded.set(this.pendingAudio.subarray(offset), 0);
      engine.writeAudio(this.sessionId, padded);
      offset = this.pendingAudio.length;
    }
    this.pendingAudio = offset >= this.pendingAudio.length
      ? new Uint8Array(0)
      : this.pendingAudio.slice(offset);
  }

  private async ensureTtsEngine(): Promise<textToSpeech.TextToSpeechEngine> {
    const existing: textToSpeech.TextToSpeechEngine | undefined = this.ttsEngine;
    if (existing !== undefined) {
      return existing;
    }
    let engine: textToSpeech.TextToSpeechEngine;
    try {
      engine = await textToSpeech.createEngine({
        language: this.language,
        person: TTS_PERSON,
        online: TTS_ONLINE_ENGINE
      });
    } catch (err) {
      hilog.warn(REALTIME_DOMAIN, REALTIME_TAG,
        'online speech synthesis unavailable, falling back to the on-device engine: %{public}s',
        this.toError(err).message);
      engine = await textToSpeech.createEngine({
        language: this.language,
        person: TTS_PERSON,
        online: TTS_OFFLINE_ENGINE
      });
    }
    // Completion callbacks only arrive for an engine with a listener.
    engine.setListener(this.buildSpeakListener());
    this.ttsEngine = engine;
    return engine;
  }

  private buildSpeakListener(): textToSpeech.SpeakListener {
    return {
      onStart: (requestId: string, response: textToSpeech.StartResponse): void => {
        hilog.info(REALTIME_DOMAIN, REALTIME_TAG, 'speech started: %{public}s', requestId);
      },
      onComplete: (requestId: string, response: textToSpeech.CompleteResponse): void => {
        hilog.info(REALTIME_DOMAIN, REALTIME_TAG, 'speech completed: %{public}s', requestId);
        this.finishSpeaking(requestId);
      },
      onStop: (requestId: string, response: textToSpeech.StopResponse): void => {
        // Our own stop() already reported the interruption to the web-ui.
        hilog.info(REALTIME_DOMAIN, REALTIME_TAG, 'speech stopped: %{public}s', requestId);
      },
      onError: (requestId: string, errorCode: number, errorMessage: string): void => {
        hilog.error(REALTIME_DOMAIN, REALTIME_TAG,
          'speech failed: id=%{public}s code=%{public}d message=%{public}s',
          requestId, errorCode, errorMessage);
        this.finishSpeaking(requestId);
      }
    };
  }

  /** Report the end of one utterance exactly once, whichever signal arrives first. */
  private finishSpeaking(requestId: string): void {
    if (!this.ttsSpeaking || requestId !== this.ttsRequestId) {
      return;
    }
    this.clearTtsPollTimer();
    this.ttsSpeaking = false;
    this.ttsCurrentText = '';
    this.ttsRequestId = '';
    this.emit('assistant_audio_completed', '', -1);
  }

  /**
   * Completion is driven by the engine listener; the poll is only a fallback for
   * a dropped callback. Both paths go through `finishSpeaking`, so a late
   * callback cannot emit a second completion.
   */
  private watchSpeechCompletion(
    engine: textToSpeech.TextToSpeechEngine,
    sessionId: string,
    requestId: string
  ): void {
    this.clearTtsPollTimer();
    this.ttsPollTimer = setInterval(() => {
      if (this.sessionId !== sessionId) {
        this.clearTtsPollTimer();
        return;
      }
      let busy: boolean = false;
      try {
        busy = engine.isBusy();
      } catch (_err) {
        busy = false;
      }
      if (!busy || Date.now() - this.ttsWaitStartedAt > TTS_MAX_WAIT_MS) {
        this.finishSpeaking(requestId);
      }
    }, TTS_POLL_INTERVAL_MS);
  }

  private stopSpeech(emitCompletion: boolean): void {
    this.clearTtsPollTimer();
    const engine: textToSpeech.TextToSpeechEngine | undefined = this.ttsEngine;
    const wasSpeaking: boolean = this.ttsSpeaking;
    this.ttsSpeaking = false;
    this.ttsCurrentText = '';
    this.ttsRequestId = '';
    if (engine) {
      try {
        engine.stop();
      } catch (_err) {
      }
    }
    if (wasSpeaking && emitCompletion) {
      this.emit('assistant_audio_completed', '', -1);
    }
  }

  private clearTtsPollTimer(): void {
    if (this.ttsPollTimer !== undefined) {
      clearInterval(this.ttsPollTimer);
      this.ttsPollTimer = undefined;
    }
  }

  private async stopInternal(emitClosed: boolean): Promise<void> {
    const sessionId: string = this.sessionId;
    this.listening = false;
    this.reading = false;
    this.stopSpeech(false);
    await this.releaseRecognition();
    this.releaseTtsEngine();
    this.clauseCommitted = '';
    this.utteranceActive = false;
    this.recognitionReady = false;
    this.pendingAudio = new Uint8Array(0);
    this.sessionId = '';
    if (emitClosed && sessionId.length > 0) {
      this.emitForSession(sessionId, 'closed', '', -1);
    }
  }

  private async releaseRecognition(): Promise<void> {
    const engine: speechRecognizer.SpeechRecognitionEngine | undefined = this.engine;
    const sessionId: string = this.sessionId;
    this.engine = undefined;
    this.captureGeneration += 1;
    this.recognitionReady = false;
    this.pendingAudio = new Uint8Array(0);
    await this.releaseCapturer();
    if (engine && sessionId.length > 0) {
      try {
        engine.cancel(sessionId);
      } catch (_err) {
      }
      try {
        engine.shutdown();
      } catch (_err) {
      }
    }
  }

  private releaseTtsEngine(): void {
    const engine: textToSpeech.TextToSpeechEngine | undefined = this.ttsEngine;
    this.ttsEngine = undefined;
    if (!engine) {
      return;
    }
    try {
      engine.shutdown();
    } catch (_err) {
    }
  }

  private async releaseCapturer(): Promise<void> {
    const capturer: audio.AudioCapturer | undefined = this.capturer;
    this.capturer = undefined;
    if (!capturer) {
      return;
    }
    try {
      await capturer.stop();
    } catch (_err) {
    }
    try {
      await capturer.release();
    } catch (_err) {
    }
  }

  private async createCapturer(): Promise<audio.AudioCapturer> {
    try {
      return await audio.createAudioCapturer(
        this.capturerOptions(audio.SourceType.SOURCE_TYPE_VOICE_RECOGNITION));
    } catch (_err) {
      return await audio.createAudioCapturer(this.capturerOptions(audio.SourceType.SOURCE_TYPE_MIC));
    }
  }

  private capturerOptions(source: audio.SourceType): audio.AudioCapturerOptions {
    return {
      streamInfo: {
        samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_16000,
        channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
        encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
      },
      capturerInfo: {
        source: source,
        capturerFlags: 0
      }
    };
  }

  private emit(kind: string, text: string, audioLevel: number): void {
    this.emitForSession(this.sessionId, kind, text, audioLevel);
  }

  private emitForSession(sessionId: string, kind: string, text: string, audioLevel: number): void {
    if (sessionId.length === 0) {
      return;
    }
    const payload: RealtimeEventPayload = {
      sessionId: sessionId,
      kind: kind,
      text: text,
      audioLevel: audioLevel
    };
    try {
      RustModule.emitRealtimeVoiceEvent(sessionId, JSON.stringify(payload));
    } catch (err) {
      hilog.error(REALTIME_DOMAIN, REALTIME_TAG,
        'failed to emit realtime voice event: kind=%{public}s error=%{public}s',
        kind, `${err}`);
    }
  }

  /** The engine rejects "auto" and other non-BCP-47 values. */
  private resolveLanguage(language?: string): string {
    if (language === undefined || language === null || language.length === 0 || language === 'auto') {
      return DEFAULT_LANGUAGE;
    }
    return language;
  }

  private newSessionId(): string {
    this.idCounter += 1;
    return `realtime-${Date.now()}-${this.idCounter}`;
  }

  private toError(err: Object): Error {
    if (err instanceof Error && err.message.length > 0) {
      return err;
    }
    try {
      return new Error(JSON.stringify(err));
    } catch (_jsonErr) {
      return new Error(`${err}`);
    }
  }
}
