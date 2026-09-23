import { abilityAccessCtrl, Context, Permissions } from '@kit.AbilityKit';
import { speechRecognizer } from '@kit.CoreSpeechKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import RustModule from 'libbitfun_desktop_lib.so';

const MAX_RECORDING_SECONDS = 8 * 60 * 60;
const MICROPHONE_PERMISSION: Permissions = 'ohos.permission.MICROPHONE';

interface VoiceStartRequest {
  language?: string;
  sampleRate?: number;
  maxRecordingSeconds?: number;
}

interface VoiceSessionRequest {
  sessionId: string;
  pcm16Base64?: string;
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

interface VoiceAppendResult {
  receivedBytes: number;
  receivedSeconds: number;
  limitReached: boolean;
}

export class VoiceInputService {
  private context?: Context;
  private engine?: speechRecognizer.SpeechRecognitionEngine;
  private starting: boolean = false;
  private sessionId: string = '';
  private sequence: number = 0;
  private startedAt: number = 0;
  private stoppedAt: number = 0;
  private maxSeconds: number = MAX_RECORDING_SECONDS;
  private finalText: string = '';
  private partialText: string = '';
  private completed: boolean = false;
  private error: string = '';
  private finishPromise?: Promise<string>;
  private finishResolver?: (value: string) => void;
  private finishRejecter?: (error: Error) => void;
  private durationTimer?: number;
  private finishTimer?: number;

  setContext(context: Context): void {
    this.context = context;
  }

  async start(arg: string): Promise<string> {
    if (this.starting || this.sessionId.length > 0) {
      throw new Error('Voice input is already active');
    }
    const context = this.context;
    if (!context) {
      throw new Error('Voice input service is not bound to a context');
    }
    const request = JSON.parse(arg) as VoiceStartRequest;
    if (request.sampleRate !== undefined && request.sampleRate !== 16000) {
      throw new Error('System speech recognition requires 16000 Hz audio');
    }
    const language = request.language ?? 'auto';
    if (language !== 'auto' && language !== 'zh' && language !== 'zh-CN') {
      throw new Error('System speech recognition supports zh-CN only');
    }
    const seconds = request.maxRecordingSeconds ?? MAX_RECORDING_SECONDS;
    if (!Number.isFinite(seconds) || seconds < 20 || seconds > MAX_RECORDING_SECONDS) {
      throw new Error('Recording duration must be between 20 seconds and 8 hours');
    }
    this.starting = true;
    try {
      await ensureMicrophonePermission(context);
      this.engine = await speechRecognizer.createEngine({
        language: 'zh-CN',
        online: 1,
        extraParams: { 'locate': 'CN', 'recognizerMode': 'long' }
      });
      this.sequence += 1;
      this.sessionId = `voice-${Date.now()}-${this.sequence}`;
      this.maxSeconds = seconds;
      this.finalText = '';
      this.partialText = '';
      this.error = '';
      this.completed = false;
      this.stoppedAt = 0;
      this.startedAt = Date.now();
      this.finishPromise = undefined;
      this.engine.setListener(this.listener());
      this.engine.startListening({
        sessionId: this.sessionId,
        audioInfo: { audioType: 'pcm', sampleRate: 16000, soundChannel: 1, sampleBit: 16 },
        extraParams: { 'recognitionMode': 0, 'maxAudioDuration': seconds * 1000 }
      });
      this.durationTimer = setTimeout(() => {
        const request: VoiceSessionRequest = { sessionId: this.sessionId };
        void this.finish(JSON.stringify(request)).catch(() => {});
      }, seconds * 1000);
      const info: VoiceSessionInfo = {
        sessionId: this.sessionId,
        modelId: 'ohos-system',
        language: 'zh-CN',
        sampleRate: 16000,
        maxRecordingSeconds: seconds
      };
      return JSON.stringify(info);
    } catch (error) {
      this.releaseEngine();
      this.sessionId = '';
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`${error}`);
    } finally {
      this.starting = false;
    }
  }

  async append(arg: string): Promise<string> {
    const request = JSON.parse(arg) as VoiceSessionRequest;
    this.checkSession(request.sessionId);
    if (request.pcm16Base64 && request.pcm16Base64.length > 0) {
      throw new Error('System speech recognition owns microphone capture');
    }
    const result: VoiceAppendResult = {
      receivedBytes: 0,
      receivedSeconds: this.durationSeconds(),
      limitReached: this.completed
    };
    return JSON.stringify(result);
  }

  async finish(arg: string): Promise<string> {
    const request = JSON.parse(arg) as VoiceSessionRequest;
    this.checkSession(request.sessionId);
    if (this.completed) {
      if (this.error.length > 0) {
        throw new Error(this.error);
      }
      return this.result();
    }
    if (this.finishPromise) {
      return this.finishPromise;
    }
    this.stoppedAt = Date.now();
    const promise = new Promise<string>((resolve, reject): void => {
      this.finishResolver = resolve;
      this.finishRejecter = reject;
    });
    this.finishPromise = promise;
    this.finishTimer = setTimeout(() => {
      this.complete('System speech recognition finish timed out');
    }, 10000);
    try {
      this.engine?.finish(this.sessionId);
    } catch (_error) {
      this.complete('System speech recognition finish failed');
    }
    return promise;
  }

  async cancel(arg: string): Promise<string> {
    const request = JSON.parse(arg) as VoiceSessionRequest;
    if (request.sessionId !== this.sessionId) {
      return '';
    }
    const sessionId = this.sessionId;
    this.sessionId = '';
    try {
      this.engine?.cancel(sessionId);
    } catch (_error) {
    }
    this.complete('Voice input cancelled');
    this.finishPromise = undefined;
    return '';
  }

  private listener(): speechRecognizer.RecognitionListener {
    return {
      onStart: (_sessionId: string, _message: string): void => {},
      onEvent: (_sessionId: string, _code: number, _message: string): void => {},
      onResult: (sessionId: string, result: speechRecognizer.SpeechRecognitionResult): void => {
        if (sessionId !== this.sessionId || this.completed) {
          return;
        }
        if (result.isFinal) {
          this.finalText += result.result;
          this.partialText = '';
        } else {
          this.partialText = result.result;
        }
        RustModule.emitSpeechTranscription(sessionId, this.finalText + this.partialText, result.isFinal);
      },
      onComplete: (sessionId: string, _message: string): void => {
        if (sessionId === this.sessionId) {
          this.complete('');
        }
      },
      onError: (sessionId: string, code: number, _message: string): void => {
        if (sessionId === this.sessionId) {
          hilog.error(0x0000, 'BitFunVoiceInput', 'Recognition failed: code=%{public}d', code);
          this.complete(code === 1002200012 ? 'Microphone permission denied' : `Speech recognition failed (${code})`);
        }
      }
    };
  }

  private complete(error: string): void {
    if (this.completed) {
      return;
    }
    this.completed = true;
    this.error = error;
    if (this.stoppedAt === 0) {
      this.stoppedAt = Date.now();
    }
    this.releaseEngine();
    const resolve = this.finishResolver;
    const reject = this.finishRejecter;
    this.finishResolver = undefined;
    this.finishRejecter = undefined;
    if (error.length > 0) {
      reject?.(new Error(error));
    } else {
      resolve?.(this.result());
    }
  }

  private result(): string {
    const result: VoiceTranscriptionResult = {
      text: this.finalText + this.partialText,
      language: 'zh-CN',
      durationMs: (this.stoppedAt || Date.now()) - this.startedAt,
      audioDurationSeconds: this.durationSeconds()
    };
    return JSON.stringify(result);
  }

  private durationSeconds(): number {
    return Math.min(this.maxSeconds, Math.max(0, ((this.stoppedAt || Date.now()) - this.startedAt) / 1000));
  }

  private checkSession(sessionId: string): void {
    if (sessionId.length === 0 || sessionId !== this.sessionId) {
      throw new Error('Voice input session is not active');
    }
  }

  private releaseEngine(): void {
    if (this.durationTimer !== undefined) {
      clearTimeout(this.durationTimer);
      this.durationTimer = undefined;
    }
    if (this.finishTimer !== undefined) {
      clearTimeout(this.finishTimer);
      this.finishTimer = undefined;
    }
    const engine = this.engine;
    this.engine = undefined;
    try {
      engine?.shutdown();
    } catch (_error) {
    }
  }
}

export async function ensureMicrophonePermission(context: Context): Promise<void> {
  const manager = abilityAccessCtrl.createAtManager();
  try {
    const status = await manager.checkAccessToken(context.applicationInfo.accessTokenId, MICROPHONE_PERMISSION);
    if (status === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
      return;
    }
  } catch (_error) {
  }
  const result = await manager.requestPermissionsFromUser(context, [MICROPHONE_PERMISSION]);
  if (result.authResults[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
    return;
  }
  if (result.dialogShownResults?.[0] === false) {
    const status = await manager.requestPermissionOnSetting(context, [MICROPHONE_PERMISSION]);
    if (status[0] === abilityAccessCtrl.GrantStatus.PERMISSION_GRANTED) {
      return;
    }
  }
  throw new Error('Microphone permission denied');
}
