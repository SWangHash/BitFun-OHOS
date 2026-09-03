import { abilityAccessCtrl, Context, Permissions } from '@kit.AbilityKit';
import { audio } from '@kit.AudioKit';
import { speechRecognizer } from '@kit.CoreSpeechKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import RustModule from 'libbitfun_desktop_lib.so';

const VOICE_DOMAIN: number = 0x0000;
const VOICE_TAG: string = 'BitFunVoiceInput';
const MICROPHONE_PERMISSION: Permissions = 'ohos.permission.MICROPHONE';
const AUDIO_CHUNK_BYTES = 1280;
const DEFAULT_LANGUAGE = 'zh-CN';
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_MAX_RECORDING_SECONDS = 8 * 60 * 60;
const MAX_RECORDING_SECONDS = 8 * 60 * 60;
const ENGINE_VAD_BEGIN = 2000;
const ENGINE_VAD_END = 3000;
const ENGINE_MAX_AUDIO_DURATION = 8 * 60 * 60 * 1000;

interface VoiceStartRequest {
  language?: string;
  sampleRate?: number;
  maxRecordingSeconds?: number;
  modelId?: string;
}

interface VoiceSessionInfo {
  sessionId: string;
  modelId: string;
  language: string;
  sampleRate: number;
  maxRecordingSeconds: number;
}

interface VoiceTranscriptionResult {
  text: string;
  language: string;
  durationMs: number;
  audioDurationSeconds: number;
}

interface VoiceAppendRequest {
  sessionId: string;
  pcm16Base64: string;
}

interface VoiceAppendResult {
  receivedBytes: number;
  receivedSeconds: number;
  limitReached: boolean;
}

function appendRecognitionSegment(existing: string, incoming: string): string {
  const current = existing.trim();
  const next = incoming.trim();
  if (next.length === 0) {
    return current;
  }
  if (current.length === 0 || next === current || next.indexOf(current) === 0) {
    return next.length >= current.length ? next : current;
  }
  if (current.indexOf(next) === 0 || (next.length > 1 && current.endsWith(next))) {
    return current;
  }
  const maxOverlap: number = Math.min(current.length, next.length);
  for (let overlap = maxOverlap; overlap > 1; overlap -= 1) {
    if (current.slice(current.length - overlap) === next.slice(0, overlap)) {
      return `${current}${next.slice(overlap)}`;
    }
  }
  return `${current}${next}`;
}

/**
 * HarmonyOS system speech input service.
 *
 * Wraps the on-device `speechRecognizer` engine and `AudioCapturer` into the
 * start/append/finish/cancel Promise contract used by the desktop speech_*
 * Tauri commands. The ArkTS side owns audio capture and recognition; the
 * frontend-supplied PCM chunks in `append` are intentionally discarded because
 * the system engine captures audio itself.
 */
export class VoiceInputService {
  private context?: Context;
  private engine?: speechRecognizer.SpeechRecognitionEngine;
  private capturer?: audio.AudioCapturer;
  private sessionId: string = '';
  private language: string = DEFAULT_LANGUAGE;
  private sampleRate: number = DEFAULT_SAMPLE_RATE;
  private maxRecordingSeconds: number = DEFAULT_MAX_RECORDING_SECONDS;
  private listening: boolean = false;
  private reading: boolean = false;
  private recognitionReady: boolean = false;
  private idCounter: number = 0;
  private startedAt: number = 0;
  private capturedSeconds: number = 0;
  private pendingAudio: Uint8Array = new Uint8Array(0);
  private finalText: string = '';
  private partialText: string = '';
  private finishedResult: string = '';
  private finishedSessionId: string = '';
  private finishedError: string = '';
  private hasFinishedResult: boolean = false;
  private finishResolver: ((result: string) => void) | null = null;
  private finishRejecter: ((error: Error) => void) | null = null;
  private maxDurationTimer?: number;

  async start(arg: string): Promise<string> {
    await this.cancelInternal(false);
    hilog.info(VOICE_DOMAIN, VOICE_TAG, 'start begin: arg=%{public}s', arg);
    const context = this.context;
    if (!context) {
      throw new Error('Voice input service is not bound to a context');
    }
    await ensureMicrophonePermission(context);
    const req: VoiceStartRequest = JSON.parse(arg);
    this.language = this.resolveLanguage(req.language);
    this.sampleRate = req.sampleRate ?? DEFAULT_SAMPLE_RATE;
    this.maxRecordingSeconds = Math.min(
      Math.max(1, req.maxRecordingSeconds ?? DEFAULT_MAX_RECORDING_SECONDS),
      MAX_RECORDING_SECONDS
    );
    const modelId: string = req.modelId ?? 'ohos-system';
    this.sessionId = this.newSessionId();
    this.finalText = '';
    this.partialText = '';
    this.finishedResult = '';
    this.finishedSessionId = '';
    this.finishedError = '';
    this.hasFinishedResult = false;
    this.finishResolver = null;
    this.finishRejecter = null;
    this.capturedSeconds = 0;
    this.pendingAudio = new Uint8Array(0);
    this.recognitionReady = false;
    this.startedAt = Date.now();
    try {
      this.engine = await speechRecognizer.createEngine({
        language: this.language,
        online: 1,
        extraParams: {
          locate: 'CN',
          recognizerMode: 'long'
        }
      });
      this.engine.setListener(this.buildRecognitionListener());
      this.capturer = await this.createCapturer();
      this.engine.startListening({
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
      await this.capturer.start();
      this.listening = true;
      this.reading = true;
      this.captureLoop(this.sessionId);
    } catch (err) {
      const failErr: Error = this.toError(err);
      hilog.error(VOICE_DOMAIN, VOICE_TAG, 'voice input start failed: %{public}s', failErr.message);
      await this.cancelInternal(true);
      throw failErr;
    }
    const info: VoiceSessionInfo = {
      sessionId: this.sessionId,
      modelId: modelId,
      language: this.language,
      sampleRate: this.sampleRate,
      maxRecordingSeconds: this.maxRecordingSeconds
    };
    return JSON.stringify(info);
  }

  async append(arg: string): Promise<string> {
    const req: VoiceAppendRequest = JSON.parse(arg);
    if (req.sessionId !== this.sessionId || !this.listening) {
      throw new Error('Voice input session is not active');
    }
    const receivedBytes: number = this.estimateBase64Bytes(req.pcm16Base64);
    const receivedSeconds: number = this.sampleRate > 0
      ? receivedBytes / (this.sampleRate * 2)
      : 0;
    this.capturedSeconds += receivedSeconds;
    const limitReached: boolean = this.capturedSeconds >= this.maxRecordingSeconds;
    const result: VoiceAppendResult = {
      receivedBytes: receivedBytes,
      receivedSeconds: receivedSeconds,
      limitReached: limitReached
    };
    return JSON.stringify(result);
  }

  async finish(arg: string): Promise<string> {
    const sessionId: string = JSON.parse(arg).sessionId as string;
    if (this.hasFinishedResult) {
      if (sessionId !== this.finishedSessionId) {
        throw new Error('Voice input session is not active');
      }
      const result: string = this.finishedResult;
      const errorMessage = this.finishedError;
      this.clearFinishedResult();
      this.releaseEngine();
      if (errorMessage.length > 0) {
        throw new Error(errorMessage);
      }
      return result;
    }
    const engine = this.engine;
    if (!engine || sessionId !== this.sessionId) {
      throw new Error('Voice input session is not active');
    }
    const resultPromise: Promise<string> = new Promise<string>((resolve, reject): void => {
      this.finishResolver = resolve;
      this.finishRejecter = reject;
    });
    await this.releaseCapturer();
    this.flushPendingAudio();
    try {
      engine.finish(sessionId);
    } catch (err) {
      const error = this.toError(err);
      this.finishResolver = null;
      this.finishRejecter = null;
      throw error;
    }
    const resultJson: string = await resultPromise;
    this.releaseEngine();
    return resultJson;
  }

  async cancel(_arg: string): Promise<string> {
    await this.cancelInternal(false);
    return '';
  }

  private buildRecognitionListener(): speechRecognizer.RecognitionListener {
    return {
      onStart: (sessionId: string, eventMessage: string): void => {
        hilog.info(VOICE_DOMAIN, VOICE_TAG,
          'recognition onStart: session=%{public}s message=%{public}s', sessionId, eventMessage);
        if (sessionId !== this.sessionId) {
          return;
        }
        this.recognitionReady = true;
        hilog.info(VOICE_DOMAIN, VOICE_TAG,
          'recognition ready: session=%{public}s pendingAudioBytes=%{public}d',
          sessionId, this.pendingAudio.length);
        this.flushPendingAudio();
        this.maxDurationTimer = setTimeout(() => {
          void this.finishAfterLimit();
        }, this.maxRecordingSeconds * 1000);
      },
      onEvent: (sessionId: string, eventCode: number, eventMessage: string): void => {
        hilog.info(VOICE_DOMAIN, VOICE_TAG,
          'recognition onEvent: session=%{public}s code=%{public}d message=%{public}s',
          sessionId, eventCode, eventMessage);
      },
      onResult: (sessionId: string, result: speechRecognizer.SpeechRecognitionResult): void => {
        if (sessionId !== this.sessionId) {
          return;
        }
        const text: string = result.result.trim();
        hilog.info(VOICE_DOMAIN, VOICE_TAG,
          'recognition onResult: session=%{public}s isFinal=%{public}d isLast=%{public}d rawText=%{public}s',
          sessionId, result.isFinal ? 1 : 0, result.isLast ? 1 : 0, text);
        if (text.length > 0) {
          const isFinal: boolean = result.isFinal || result.isLast;
          if (isFinal) {
            this.finalText = appendRecognitionSegment(this.finalText, text);
            this.partialText = '';
          } else {
            this.partialText = text;
          }
          const displayText: string = appendRecognitionSegment(this.finalText, this.partialText);
          hilog.info(VOICE_DOMAIN, VOICE_TAG,
            'recognition merged: session=%{public}s finalText=%{public}s partialText=%{public}s displayText=%{public}s',
            sessionId, this.finalText, this.partialText, displayText);
          RustModule.emitSpeechTranscription(
            this.sessionId,
            displayText,
            isFinal
          );
        }
        if (result.isLast) {
          hilog.info(VOICE_DOMAIN, VOICE_TAG,
            'recognition result isLast: session=%{public}s finalText=%{public}s partialText=%{public}s',
            sessionId, this.finalText, this.partialText);
          this.resolveFinish();
        }
      },
      onComplete: (sessionId: string, eventMessage: string): void => {
        hilog.info(VOICE_DOMAIN, VOICE_TAG,
          'recognition onComplete: session=%{public}s message=%{public}s finalText=%{public}s partialText=%{public}s',
          sessionId, eventMessage, this.finalText, this.partialText);
        if (sessionId !== this.sessionId) {
          return;
        }
        this.resolveFinish();
      },
      onError: (sessionId: string, errorCode: number, errorMessage: string): void => {
        hilog.error(VOICE_DOMAIN, VOICE_TAG,
          'recognition onError: session=%{public}s code=%{public}d message=%{public}s',
          sessionId, errorCode, errorMessage);
        if (sessionId !== this.sessionId) {
          return;
        }
        const error: Error = new Error(errorMessage.length > 0
          ? errorMessage
          : `Voice input failed (${errorCode})`);
        this.listening = false;
        this.reading = false;
        if (this.finishRejecter) {
          const rejecter = this.finishRejecter;
          this.finishRejecter = null;
          this.finishResolver = null;
          rejecter(error);
        } else {
          this.finishedSessionId = sessionId;
          this.finishedError = error.message;
          this.hasFinishedResult = true;
          this.finishedResult = '';
        }
        this.releaseCapturer();
        this.releaseEngine();
      }
    };
  }

  private resolveFinish(): void {
    this.listening = false;
    this.reading = false;
    const resolvedText: string = appendRecognitionSegment(this.finalText, this.partialText);
    this.finalText = resolvedText;
    this.partialText = '';
    const result: VoiceTranscriptionResult = {
      text: resolvedText,
      language: this.language,
      durationMs: Date.now() - this.startedAt,
      audioDurationSeconds: this.capturedSeconds
    };
    const resultJson: string = JSON.stringify(result);
    hilog.info(VOICE_DOMAIN, VOICE_TAG,
      'recognition finished: session=%{public}s text=%{public}s durationMs=%{public}d audioSeconds=%{public}f',
      this.sessionId, resolvedText, result.durationMs, result.audioDurationSeconds);
    this.finishedResult = resultJson;
    this.finishedSessionId = this.sessionId;
    this.finishedError = '';
    this.hasFinishedResult = true;
    if (this.finishResolver) {
      const resolver = this.finishResolver;
      this.finishResolver = null;
      this.finishRejecter = null;
      resolver(resultJson);
    }
    this.releaseCapturer();
  }

  private async captureLoop(sessionId: string): Promise<void> {
    while (this.reading && this.sessionId === sessionId) {
      const capturer = this.capturer;
      if (!capturer) {
        break;
      }
      try {
        const buffer = await capturer.read(AUDIO_CHUNK_BYTES, true);
        if (!this.reading || this.sessionId !== sessionId) {
          break;
        }
        this.writeAudioBuffer(sessionId, buffer);
      } catch (err) {
        hilog.error(VOICE_DOMAIN, VOICE_TAG,
          'audio capture failed: session=%{public}s error=%{public}s', sessionId, this.toError(err).message);
        await this.cancelInternal(true);
        break;
      }
    }
  }

  private writeAudioBuffer(sessionId: string, buffer: ArrayBuffer): void {
    const engine = this.engine;
    if (!engine || buffer.byteLength === 0) {
      return;
    }
    const incoming: Uint8Array = new Uint8Array(buffer);
    const data: Uint8Array = new Uint8Array(this.pendingAudio.length + incoming.length);
    data.set(this.pendingAudio, 0);
    data.set(incoming, this.pendingAudio.length);
    let offset = 0;
    if (this.recognitionReady) {
      while (offset + AUDIO_CHUNK_BYTES <= data.length) {
        engine.writeAudio(sessionId, data.subarray(offset, offset + AUDIO_CHUNK_BYTES));
        offset += AUDIO_CHUNK_BYTES;
      }
    }
    this.pendingAudio = data.slice(offset);
    if (this.pendingAudio.length > 0 && !this.recognitionReady) {
      hilog.info(VOICE_DOMAIN, VOICE_TAG,
        'audio buffered before recognition ready: session=%{public}s bytes=%{public}d',
        sessionId, this.pendingAudio.length);
    }
  }

  private flushPendingAudio(): void {
    const engine = this.engine;
    if (!engine || this.pendingAudio.length === 0 || this.sessionId.length === 0) {
      return;
    }
    let offset = 0;
    while (offset + AUDIO_CHUNK_BYTES <= this.pendingAudio.length) {
      engine.writeAudio(this.sessionId, this.pendingAudio.subarray(offset, offset + AUDIO_CHUNK_BYTES));
      offset += AUDIO_CHUNK_BYTES;
    }
    if (offset < this.pendingAudio.length) {
      engine.writeAudio(this.sessionId, this.pendingAudio.subarray(offset));
    }
    this.pendingAudio = new Uint8Array(0);
  }

  private clearFinishedResult(): void {
    this.hasFinishedResult = false;
    this.finishedResult = '';
    this.finishedSessionId = '';
    this.finishedError = '';
  }

  private async createCapturer(): Promise<audio.AudioCapturer> {
    try {
      return await audio.createAudioCapturer(this.capturerOptions(audio.SourceType.SOURCE_TYPE_VOICE_RECOGNITION));
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

  private async finishAfterLimit(): Promise<void> {
    if (!this.listening || this.sessionId.length === 0) {
      return;
    }
    hilog.info(VOICE_DOMAIN, VOICE_TAG, 'voice input reached maximum duration');
    try {
      await this.finish(JSON.stringify({ sessionId: this.sessionId }));
    } catch (err) {
      hilog.error(VOICE_DOMAIN, VOICE_TAG, 'voice input max-duration finish failed: %{public}s', this.toError(err).message);
      await this.cancelInternal(true);
    }
  }

  private clearMaxDurationTimer(): void {
    if (this.maxDurationTimer !== undefined) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = undefined;
    }
  }

  private async cancelInternal(_notifyError: boolean): Promise<void> {
    this.clearMaxDurationTimer();
    const engine = this.engine;
    const sessionId = this.sessionId;
    this.listening = false;
    this.reading = false;
    this.recognitionReady = false;
    this.pendingAudio = new Uint8Array(0);
    const rejecter = this.finishRejecter;
    this.finishResolver = null;
    this.finishRejecter = null;
    if (rejecter) {
      rejecter(new Error('Voice input cancelled'));
    }
    await this.releaseCapturer();
    if (engine && sessionId.length > 0) {
      try {
        engine.cancel(sessionId);
      } catch (_err) {
      }
    }
    this.releaseEngine();
  }

  private async releaseCapturer(): Promise<void> {
    this.clearMaxDurationTimer();
    const capturer = this.capturer;
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

  private releaseEngine(): void {
    const engine = this.engine;
    this.engine = undefined;
    this.sessionId = '';
    this.recognitionReady = false;
    this.pendingAudio = new Uint8Array(0);
    if (!engine) {
      return;
    }
    try {
      engine.shutdown();
    } catch (_err) {
    }
  }

  setContext(context: Context): void {
    this.context = context;
  }

  /**
   * Map the frontend-provided language to a value accepted by the system
   * speechRecognizer. The engine rejects "auto" (and other non-BCP-47 values)
   * with code 1002200001 "Asr CreateEngineParams is wrong!", so normalize to
   * the default concrete language.
   */
  private resolveLanguage(language?: string): string {
    if (language === undefined || language === null || language.length === 0 || language === 'auto') {
      return DEFAULT_LANGUAGE;
    }
    return language;
  }

  private newSessionId(): string {
    this.idCounter += 1;
    return `voice-${Date.now()}-${this.idCounter}`;
  }

  private estimateBase64Bytes(base64: string): number {
    if (base64.length === 0) {
      return 0;
    }
    let padding = 0;
    if (base64.endsWith('==')) {
      padding = 2;
    } else if (base64.endsWith('=')) {
      padding = 1;
    }
    const decoded: number = Math.floor((base64.length * 3) / 4);
    return decoded > padding ? decoded - padding : 0;
  }

  private toError(err: Object): Error {
    if (err instanceof Error && err.message.length > 0) {
      return err;
    }
    const business = err as BusinessError;
    if (business && business.message && business.message.length > 0) {
      return new Error(business.message);
    }
    try {
      return new Error(JSON.stringify(err));
    } catch (_jsonErr) {
      return new Error(`${err}`);
    }
  }
}

/**
 * Request microphone permission from the user. Must be called from an
 * ability context (the EntryAbility registers the ArkTS bridge with the
 * ability context attached so the service can request permissions on demand).
 */
export async function ensureMicrophonePermission(context: Context): Promise<void> {
  const atManager = abilityAccessCtrl.createAtManager();
  const tokenId = context.applicationInfo.accessTokenId;
  let currentStatus: abilityAccessCtrl.GrantStatus | undefined;
  try {
    currentStatus = await atManager.checkAccessToken(tokenId, MICROPHONE_PERMISSION);
  } catch (err) {
    // A failed status lookup must not prevent the user-facing permission request.
    hilog.warn(VOICE_DOMAIN, VOICE_TAG, 'microphone permission check failed: %{public}s', `${err}`);
  }
  if (currentStatus === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
    return;
  }
  let needSettingFallback: boolean = false;
  try {
    const result = await atManager.requestPermissionsFromUser(context, [MICROPHONE_PERMISSION]);
    if (result.authResults.length > 0 &&
      result.authResults[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
      return;
    }
    // dialogShownResults tells us whether the system actually showed a
    // permission dialog. When it is true the user just denied in a visible
    // dialog, so calling requestPermissionOnSetting immediately would pop a
    // second, confusing dialog. When it is false the permission was already
    // permanently denied (or cannot be prompted via pop-up), so we fall back
    // to the settings sheet to give the user another chance.
    const dialogShown: boolean = result.dialogShownResults !== undefined &&
      result.dialogShownResults.length > 0 &&
      result.dialogShownResults[0] === true;
    needSettingFallback = !dialogShown;
  } catch (err) {
    hilog.warn(VOICE_DOMAIN, VOICE_TAG, 'microphone permission prompt failed: %{public}s', `${err}`);
  }
  if (needSettingFallback) {
    try {
      const settingResult = await atManager.requestPermissionOnSetting(context, [MICROPHONE_PERMISSION]);
      if (settingResult.length > 0 &&
        settingResult[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
        return;
      }
    } catch (err) {
      hilog.warn(VOICE_DOMAIN, VOICE_TAG, 'microphone permission settings failed: %{public}s', `${err}`);
    }
  }
  throw new Error('Microphone permission denied');
}
