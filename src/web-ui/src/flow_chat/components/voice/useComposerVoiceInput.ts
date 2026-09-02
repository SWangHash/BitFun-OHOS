import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_SPEECH_SAMPLE_RATE,
  LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID,
  speechAPI,
  type SpeechInputSession,
} from '@/infrastructure/api';
import { useAIExperienceSettings } from '@/infrastructure/config/hooks';
import { isOpenHarmonyRuntime, isTauriRuntime } from '@/infrastructure/runtime';
import { useSceneStore } from '@/app/stores/sceneStore';
import { notificationService } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import {
  createVoiceInputRecorder,
  type VoiceInputRecorder,
} from '@/infrastructure/speech/voiceInputAudio';

const log = createLogger('ComposerVoiceInput');

type VoiceInputPhase = 'idle' | 'preparing' | 'recording' | 'transcribing';
export type VoiceInputCompletionMode = 'transcribe' | 'send';
const STARTUP_AUDIO_BUFFER_LIMIT_SECONDS = 5;
const RECORDING_CHUNK_DURATION_MS = 1000;
const LOW_VOLUME_LEVEL_THRESHOLD = 0.002;
const LOW_VOLUME_WARNING_DELAY_MS = 3000;
const DEFAULT_LOCAL_VOICE_MODEL_ID = LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID;

export interface ComposerVoiceInputController {
  enabled: boolean;
  disabled: boolean;
  phase: VoiceInputPhase;
  completionMode: VoiceInputCompletionMode | null;
  audioLevel: number;
  lowVolumeWarning: boolean;
  lowVolumeTooltip: string;
  tooltip: string;
  cancelTooltip: string;
  transcribeTooltip: string;
  sendTooltip: string;
  toggle: () => void;
  cancel: () => void;
  transcribe: () => void;
  transcribeAndSend: () => void;
}

export interface UseComposerVoiceInputOptions {
  activateInput: () => void;
  focusInputSoon: () => void;
  getCurrentText: () => string;
  replaceText: (text: string) => void;
  submitText: (text: string) => Promise<void>;
}

function isMediaCaptureSupported(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function isPermissionDeniedError(error: unknown): boolean {
  const name = error instanceof DOMException || (error && typeof error === 'object' && 'name' in error)
    ? (error as { name?: unknown }).name
    : undefined;
  return name === 'NotAllowedError' || name === 'PermissionDeniedError';
}

function resolveErrorMessage(error: unknown, permissionDenied: string, fallback: string): string {
  if (isPermissionDeniedError(error)) {
    return permissionDenied;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return detail ? `${fallback} (${detail})` : fallback;
}

function isModelMissingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes('speech model is not installed');
}

function isEmptySpeechError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('no speech') || message.includes('no recognized speech') || message.includes('speech not recognized');
}

function estimatePcm16Base64Seconds(pcm16Base64: string, sampleRate: number): number {
  const padding = pcm16Base64.endsWith('==') ? 2 : pcm16Base64.endsWith('=') ? 1 : 0;
  const bytes = Math.max(0, Math.floor((pcm16Base64.length * 3) / 4) - padding);
  return bytes / (sampleRate * 2);
}

function getRecognitionDelta(previous: string, next: string): string {
  if (!previous || next.startsWith(previous)) {
    return previous ? next.slice(previous.length).trim() : next;
  }
  return '';
}

export function useComposerVoiceInput({
  activateInput,
  focusInputSoon,
  getCurrentText,
  replaceText,
  submitText,
}: UseComposerVoiceInputOptions): ComposerVoiceInputController {
  const { t } = useTranslation('flow-chat');
  const { settings: aiExperienceSettings } = useAIExperienceSettings();
  const settings = aiExperienceSettings?.voice_input ?? null;
  const selectedProvider = settings?.provider === 'cloud' ? 'cloud' : 'local';
  const selectedModelId = settings?.model_id || DEFAULT_LOCAL_VOICE_MODEL_ID;
  const [modelInstalled, setModelInstalled] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<VoiceInputPhase>('idle');
  const [completionMode, setCompletionMode] = useState<VoiceInputCompletionMode | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [lowVolumeWarning, setLowVolumeWarning] = useState(false);
  const sessionRef = useRef<SpeechInputSession | null>(null);
  const sessionPromiseRef = useRef<Promise<SpeechInputSession> | null>(null);
  const recorderRef = useRef<VoiceInputRecorder | null>(null);
  const pendingAppendRef = useRef<Promise<void>>(Promise.resolve());
  const appendErrorRef = useRef<unknown>(null);
  const latestAudioLevelRef = useRef(0);
  const audioLevelFrameRef = useRef<number | null>(null);
  const activeRecordingIdRef = useRef(0);
  const bufferedChunksRef = useRef<Array<{ pcm16Base64: string; seconds: number }>>([]);
  const bufferedSecondsRef = useRef(0);
  const cancelRecordingRef = useRef<(() => Promise<void>) | null>(null);
  const recordingLimitTimerRef = useRef<number | null>(null);
  const lowVolumeStartedAtRef = useRef<number | null>(null);
  const microphonePermissionDeniedRef = useRef(false);
  const liveTextRef = useRef('');
  const pendingLiveTextRef = useRef('');
  const liveTextBaseRef = useRef('');
  const liveTextEditedRef = useRef(false);
  const lastRenderedTextRef = useRef('');
  const speechRuntimeSupported = isTauriRuntime() || isOpenHarmonyRuntime();

  const mergeLiveText = useCallback((nextText: string) => {
    const base = liveTextBaseRef.current;
    const current = getCurrentText();
    const previousLive = liveTextRef.current;
    const expectedPrevious = previousLive ? (base ? `${base} ${previousLive}` : previousLive) : base;

    if (previousLive && !current.trim() && lastRenderedTextRef.current.trim()) {
      liveTextBaseRef.current = '';
      liveTextEditedRef.current = true;
      liveTextRef.current = nextText;
      pendingLiveTextRef.current = nextText;
      lastRenderedTextRef.current = '';
      return '';
    }
    if (current.length < lastRenderedTextRef.current.length && current !== lastRenderedTextRef.current) {
      liveTextBaseRef.current = current;
      liveTextEditedRef.current = true;
      liveTextRef.current = nextText;
      pendingLiveTextRef.current = nextText;
      lastRenderedTextRef.current = current;
      return current;
    }
    if (liveTextEditedRef.current) {
      const delta = getRecognitionDelta(previousLive, nextText);
      return current ? (delta ? `${current} ${delta}` : current) : delta;
    }
    if (current === lastRenderedTextRef.current) {
      return base ? `${base} ${nextText}` : nextText;
    }
    if (current === expectedPrevious || (!current && !expectedPrevious)) {
      return base ? `${base} ${nextText}` : nextText;
    }
    // The user edited the composer while recognition was running. Discard the
    // current cumulative result and use it only as the new recognition cursor.
    // The next result will be compared against this cursor, so old speech is
    // never inserted into the edited draft again.
    liveTextBaseRef.current = current;
    liveTextEditedRef.current = true;
    liveTextRef.current = nextText;
    pendingLiveTextRef.current = nextText;
    lastRenderedTextRef.current = current;
    return current;
  }, [getCurrentText]);

  useEffect(() => {
    return speechAPI.onTranscription(event => {
      const session = sessionRef.current;
      if (!session || session.sessionId !== event.sessionId || (phase !== 'recording' && phase !== 'transcribing')) {
        return;
      }
      const nextText = event.text.trim();
      if (!nextText || nextText === pendingLiveTextRef.current) {
        return;
      }
      const mergedText = mergeLiveText(nextText);
      liveTextRef.current = nextText;
      pendingLiveTextRef.current = nextText;
      if (mergedText === getCurrentText() && liveTextEditedRef.current) {
        return;
      }
      activateInput();
      replaceText(mergedText);
      lastRenderedTextRef.current = mergedText;
    });
  }, [activateInput, mergeLiveText, phase, replaceText]);

  const clearRecordingLimitTimer = useCallback(() => {
    if (recordingLimitTimerRef.current !== null) {
      window.clearTimeout(recordingLimitTimerRef.current);
      recordingLimitTimerRef.current = null;
    }
  }, []);

  const openVoiceInputSettings = useCallback(() => {
    // voice-input settings tab is temporarily hidden; open default settings tab.
    useSceneStore.getState().openScene('settings');
  }, []);

  const refreshCapability = useCallback(async () => {
    if (!speechRuntimeSupported) {
      setModelInstalled(null);
      return;
    }
    if (selectedProvider !== 'local') {
      setModelInstalled(false);
      return;
    }
    try {
      const modelResponse = await speechAPI.listModels();
      setModelInstalled(
        modelResponse.models.some(model =>
          model.modelId === selectedModelId &&
          model.state === 'installed'
        ),
      );
    } catch (error) {
      log.warn('Failed to refresh voice input capability', { error });
      setModelInstalled(null);
    }
  }, [selectedModelId, selectedProvider, speechRuntimeSupported]);

  useEffect(() => {
    if (!speechRuntimeSupported) {
      return undefined;
    }
    if (selectedProvider !== 'local') {
      setModelInstalled(false);
      return undefined;
    }
    void refreshCapability();
    const removeModelListener = speechAPI.onModelStatusChanged(status => {
      if (status.modelId === selectedModelId) {
        setModelInstalled(status.state === 'installed');
      }
    });

    return () => {
      removeModelListener();
    };
  }, [refreshCapability, selectedModelId, selectedProvider, speechRuntimeSupported]);

  useEffect(() => () => {
    activeRecordingIdRef.current += 1;
    const session = sessionRef.current;
    const sessionPromise = sessionPromiseRef.current;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    sessionRef.current = null;
    sessionPromiseRef.current = null;
    bufferedChunksRef.current = [];
    bufferedSecondsRef.current = 0;
    lowVolumeStartedAtRef.current = null;
    clearRecordingLimitTimer();
    if (audioLevelFrameRef.current !== null) {
      window.cancelAnimationFrame(audioLevelFrameRef.current);
      audioLevelFrameRef.current = null;
    }
    if (recorder) {
      void recorder.stop().catch(error => {
        log.warn('Failed to stop voice recorder during cleanup', { error });
      });
    }
    if (session) {
      void speechAPI.cancelInputSession(session.sessionId).catch(error => {
        log.warn('Failed to cancel voice input session during cleanup', { error });
      });
    }
    if (sessionPromise) {
      sessionPromise.then(lateSession => {
        if (lateSession.sessionId === session?.sessionId) {
          return;
        }
        return speechAPI.cancelInputSession(lateSession.sessionId).catch(error => {
          log.warn('Failed to cancel late voice input session during cleanup', {
            sessionId: lateSession.sessionId,
            error,
          });
        });
      }).catch(error => {
        log.warn('Voice input session creation failed during cleanup', { error });
      });
    }
  }, [clearRecordingLimitTimer]);

  const updateAudioLevel = useCallback((level: number) => {
    latestAudioLevelRef.current = Math.max(0, Math.min(1, level));
    if (level < LOW_VOLUME_LEVEL_THRESHOLD) {
      const now = performance.now();
      lowVolumeStartedAtRef.current ??= now;
      if (now - lowVolumeStartedAtRef.current >= LOW_VOLUME_WARNING_DELAY_MS) {
        setLowVolumeWarning(true);
      }
    } else {
      lowVolumeStartedAtRef.current = null;
      setLowVolumeWarning(false);
    }
    if (audioLevelFrameRef.current !== null) {
      return;
    }

    audioLevelFrameRef.current = window.requestAnimationFrame(() => {
      audioLevelFrameRef.current = null;
      setAudioLevel(previous =>
        Math.max(0, Math.min(1, previous * 0.35 + latestAudioLevelRef.current * 0.65))
      );
    });
  }, []);

  const appendChunkToSession = useCallback(async (
    session: SpeechInputSession,
    pcm16Base64: string,
  ) => {
    if (sessionRef.current?.sessionId !== session.sessionId) {
      return;
    }
    try {
      await speechAPI.appendAudioChunk(session.sessionId, pcm16Base64);
    } catch (error) {
      appendErrorRef.current = error;
      log.warn('Failed to append voice input chunk', { sessionId: session.sessionId, error });
    }
  }, []);

  const flushBufferedChunks = useCallback((session: SpeechInputSession) => {
    const bufferedChunks = bufferedChunksRef.current;
    bufferedChunksRef.current = [];
    bufferedSecondsRef.current = 0;
    lowVolumeStartedAtRef.current = null;
    setLowVolumeWarning(false);

    for (const chunk of bufferedChunks) {
      pendingAppendRef.current = pendingAppendRef.current
        .catch(() => undefined)
        .then(() => appendChunkToSession(session, chunk.pcm16Base64));
    }
  }, [appendChunkToSession]);

  const attachSession = useCallback((session: SpeechInputSession, recordingId: number) => {
    if (activeRecordingIdRef.current !== recordingId) {
      void speechAPI.cancelInputSession(session.sessionId).catch(error => {
        log.warn('Failed to cancel stale voice input session', { sessionId: session.sessionId, error });
      });
      return;
    }

    sessionRef.current = session;
    setPhase('recording');
    appendErrorRef.current = null;
    flushBufferedChunks(session);
  }, [flushBufferedChunks]);

  const enqueueChunk = useCallback((pcm16Base64: string) => {
    const session = sessionRef.current;
    if (!session) {
      const seconds = estimatePcm16Base64Seconds(pcm16Base64, DEFAULT_SPEECH_SAMPLE_RATE);
      if (bufferedSecondsRef.current + seconds > STARTUP_AUDIO_BUFFER_LIMIT_SECONDS) {
        appendErrorRef.current = new Error('Voice input session took too long to start');
        log.warn('Voice input startup buffer limit exceeded', {
          limitSeconds: STARTUP_AUDIO_BUFFER_LIMIT_SECONDS,
          bufferedSeconds: bufferedSecondsRef.current,
        });
        void cancelRecordingRef.current?.();
        return;
      }
      bufferedChunksRef.current.push({ pcm16Base64, seconds });
      bufferedSecondsRef.current += seconds;
      return;
    }

    pendingAppendRef.current = pendingAppendRef.current
      .catch(() => undefined)
      .then(() => appendChunkToSession(session, pcm16Base64));
  }, [appendChunkToSession]);

  const cancelRecording = useCallback(async () => {
    clearRecordingLimitTimer();
    activeRecordingIdRef.current += 1;
    const session = sessionRef.current;
    const sessionPromise = sessionPromiseRef.current;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    sessionRef.current = null;
    sessionPromiseRef.current = null;
    appendErrorRef.current = null;
    pendingAppendRef.current = Promise.resolve();
    bufferedChunksRef.current = [];
    bufferedSecondsRef.current = 0;
    latestAudioLevelRef.current = 0;
    setAudioLevel(0);
    setCompletionMode(null);
    setPhase('idle');

    if (recorder) {
      await recorder.stop().catch(error => {
        log.warn('Failed to stop voice recorder during cancellation', { error });
      });
    }
    if (session) {
      await speechAPI.cancelInputSession(session.sessionId).catch(error => {
        log.warn('Failed to cancel voice input session', { sessionId: session.sessionId, error });
      });
    }
    if (sessionPromise) {
      sessionPromise.then(lateSession => {
        if (lateSession.sessionId === session?.sessionId) {
          return;
        }
        return speechAPI.cancelInputSession(lateSession.sessionId).catch(error => {
          log.warn('Failed to cancel late voice input session', {
            sessionId: lateSession.sessionId,
            error,
          });
        });
      }).catch(error => {
        log.warn('Voice input session creation failed after cancellation', { error });
      });
    }
  }, [clearRecordingLimitTimer]);

  useEffect(() => {
    cancelRecordingRef.current = cancelRecording;
    return () => {
      if (cancelRecordingRef.current === cancelRecording) {
        cancelRecordingRef.current = null;
      }
    };
  }, [cancelRecording]);

  const stopAndTranscribe = useCallback(async (mode: VoiceInputCompletionMode) => {
    clearRecordingLimitTimer();
    let session = sessionRef.current;
    const sessionPromise = sessionPromiseRef.current;
    const recorder = recorderRef.current;
    if (!recorder || (!session && !sessionPromise)) {
      setPhase('idle');
      return;
    }

    setCompletionMode(mode);
    setPhase('transcribing');
    lowVolumeStartedAtRef.current = null;
    setLowVolumeWarning(false);
    latestAudioLevelRef.current = 0;
    setAudioLevel(0);
    try {
      recorderRef.current = null;
      await recorder.stop();
      if (!session && sessionPromise) {
        session = await sessionPromise;
        attachSession(session, activeRecordingIdRef.current);
      }
      if (!sessionRef.current || !session) {
        throw new Error('Voice input session was not ready');
      }
      await pendingAppendRef.current;
      if (appendErrorRef.current) {
        throw appendErrorRef.current;
      }

      const result = await speechAPI.finishInputSession(session.sessionId);
      const text = result.text.trim() || liveTextRef.current.trim();
      if (text) {
        activateInput();
        const current = getCurrentText();
        const expectedPreview = liveTextRef.current
          ? (liveTextBaseRef.current ? `${liveTextBaseRef.current} ${liveTextRef.current}` : liveTextRef.current)
          : liveTextBaseRef.current;
        const mergedText = liveTextEditedRef.current
          ? (current ? `${current} ${getRecognitionDelta(liveTextRef.current, text)}` : getRecognitionDelta(liveTextRef.current, text))
          : current === expectedPreview
            ? (liveTextBaseRef.current ? `${liveTextBaseRef.current} ${text}` : text)
            : (current ? `${current} ${getRecognitionDelta(liveTextRef.current, text)}` : text);
        replaceText(mergedText);
        if (mode === 'send' && mergedText) {
          await submitText(mergedText);
        } else {
          focusInputSoon();
        }
      } else {
        // An empty recording is a normal result when the user stops without speaking.
      }
    } catch (error) {
      log.error('Voice input transcription failed', { sessionId: session?.sessionId, error });
      if (!isEmptySpeechError(error)) {
        notificationService.error(resolveErrorMessage(
          error,
          t('input.voiceInput.permissionDenied'),
          t('input.voiceInput.failed'),
        ));
      }
      if (session) {
        const sessionId = session.sessionId;
        await speechAPI.cancelInputSession(session.sessionId).catch(cancelError => {
          log.warn('Failed to cancel voice input session after error', {
            sessionId,
            error: cancelError,
          });
        });
      }
    } finally {
      activeRecordingIdRef.current += 1;
      sessionRef.current = null;
      sessionPromiseRef.current = null;
      appendErrorRef.current = null;
      pendingAppendRef.current = Promise.resolve();
      bufferedChunksRef.current = [];
      bufferedSecondsRef.current = 0;
      setCompletionMode(null);
      setPhase('idle');
    }
  }, [activateInput, attachSession, clearRecordingLimitTimer, focusInputSoon, getCurrentText, replaceText, submitText, t]);

  const startRecording = useCallback(async () => {
    if (!settings?.enabled) {
      notificationService.info(t('input.voiceInput.disabled'));
      return;
    }
    if (!speechRuntimeSupported || (!isTauriRuntime() && !isOpenHarmonyRuntime() && !isMediaCaptureSupported())) {
      notificationService.error(t('input.voiceInput.unsupported'));
      return;
    }
    if (settings.provider === 'cloud') {
      notificationService.info(t('input.voiceInput.cloudPending'));
      openVoiceInputSettings();
      return;
    }
    if (microphonePermissionDeniedRef.current) {
      notificationService.info(t('input.voiceInput.permissionDenied'));
      return;
    }

    setPhase('preparing');
    setCompletionMode(null);
    liveTextRef.current = '';
    pendingLiveTextRef.current = '';
    liveTextBaseRef.current = getCurrentText().trim();
    liveTextEditedRef.current = false;
    lastRenderedTextRef.current = liveTextBaseRef.current;
    latestAudioLevelRef.current = 0;
    setAudioLevel(0);
    const recordingId = activeRecordingIdRef.current + 1;
    activeRecordingIdRef.current = recordingId;
    sessionRef.current = null;
    sessionPromiseRef.current = null;
    appendErrorRef.current = null;
    pendingAppendRef.current = Promise.resolve();
    bufferedChunksRef.current = [];
    bufferedSecondsRef.current = 0;
    lowVolumeStartedAtRef.current = null;
    setLowVolumeWarning(false);
    let sessionPromise: Promise<SpeechInputSession> | null = null;
    const startupStartedAt = performance.now();

    try {
      const voiceSettings = settings;
      if (modelInstalled === false) {
        notificationService.warning(t('input.voiceInput.modelMissing'));
        openVoiceInputSettings();
        setPhase('idle');
        return;
      }

      log.debug('Voice input startup requested', { modelInstalled });
      const recorder: VoiceInputRecorder = isOpenHarmonyRuntime()
        ? { stop: async () => {} }
        : await createVoiceInputRecorder({
          targetSampleRate: DEFAULT_SPEECH_SAMPLE_RATE,
          chunkDurationMs: RECORDING_CHUNK_DURATION_MS,
          microphoneDeviceId: voiceSettings.microphone_device_id || undefined,
          onChunk: enqueueChunk,
          onLevel: updateAudioLevel,
          onDeviceEnded: () => {
            if (activeRecordingIdRef.current !== recordingId) return;
            log.warn('Voice input microphone disconnected during recording');
            notificationService.error(t('input.voiceInput.deviceDisconnected'));
            void cancelRecordingRef.current?.();
          },
          onStartupTiming: timing => {
            log.debug('Voice input recorder startup stage completed', timing);
          },
        });
      if (isOpenHarmonyRuntime()) {
        log.debug('Using HarmonyOS native speech recognizer audio capture');
      }
      if (activeRecordingIdRef.current !== recordingId) {
        await recorder.stop().catch(error => {
          log.warn('Failed to stop stale voice recorder', { error });
        });
        return;
      }
      recorderRef.current = recorder;
      recordingLimitTimerRef.current = window.setTimeout(() => {
        if (activeRecordingIdRef.current === recordingId && recorderRef.current) {
          void stopAndTranscribe('transcribe');
        }
      }, voiceSettings.max_recording_seconds * 1000);
      log.debug('Voice input recorder ready', {
        startupMs: Math.round(performance.now() - startupStartedAt),
      });

      const sessionStartedAt = performance.now();
      sessionPromise = speechAPI.startInputSession({
        modelId: voiceSettings.model_id || DEFAULT_LOCAL_VOICE_MODEL_ID,
        language: voiceSettings.default_language,
        sampleRate: DEFAULT_SPEECH_SAMPLE_RATE,
        maxRecordingSeconds: voiceSettings.max_recording_seconds,
      });
      sessionPromiseRef.current = sessionPromise;
      sessionPromise
        .then(session => {
          log.debug('Voice input session ready', {
            sessionMs: Math.round(performance.now() - sessionStartedAt),
            startupMs: Math.round(performance.now() - startupStartedAt),
          });
          attachSession(session, recordingId);
        })
        .catch(async error => {
          if (activeRecordingIdRef.current !== recordingId) {
            return;
          }
          log.error('Failed to create voice input session', { error });
          activeRecordingIdRef.current += 1;
          const activeRecorder = recorderRef.current;
          recorderRef.current = null;
          sessionRef.current = null;
          sessionPromiseRef.current = null;
          bufferedChunksRef.current = [];
          bufferedSecondsRef.current = 0;
          latestAudioLevelRef.current = 0;
          setAudioLevel(0);
          setPhase('idle');
          if (activeRecorder) {
            await activeRecorder.stop().catch(stopError => {
              log.warn('Failed to stop recorder after session creation failure', { error: stopError });
            });
          }
          if (isPermissionDeniedError(error)) {
            microphonePermissionDeniedRef.current = true;
            notificationService.error(t('input.voiceInput.permissionDenied'));
            return;
          }
          if (isModelMissingError(error)) {
            setModelInstalled(false);
            notificationService.warning(t('input.voiceInput.modelMissing'));
            openVoiceInputSettings();
            return;
          }
          notificationService.error(t('input.voiceInput.failed'));
        });
    } catch (error) {
      log.error('Failed to start voice input', { error });
      if (isPermissionDeniedError(error)) {
        microphonePermissionDeniedRef.current = true;
      }
      activeRecordingIdRef.current += 1;
      const session = sessionRef.current as SpeechInputSession | null;
      sessionRef.current = null;
      sessionPromiseRef.current = null;
      bufferedChunksRef.current = [];
      bufferedSecondsRef.current = 0;
      if (session) {
        const sessionId = session.sessionId;
        await speechAPI.cancelInputSession(sessionId).catch(cancelError => {
          log.warn('Failed to cancel voice input session after start failure', {
            sessionId,
            error: cancelError,
          });
        });
      }
      const pendingSessionPromise: Promise<SpeechInputSession> | null = sessionPromise;
      if (pendingSessionPromise) {
        pendingSessionPromise
          .then((lateSession: SpeechInputSession) => speechAPI.cancelInputSession(lateSession.sessionId))
          .catch(sessionError => {
            log.warn('Voice input session creation failed after recorder start failure', {
              error: sessionError,
            });
          });
      }
      if (isModelMissingError(error)) {
        setModelInstalled(false);
        notificationService.warning(t('input.voiceInput.modelMissing'));
        openVoiceInputSettings();
        setPhase('idle');
        return;
      }
      notificationService.error(resolveErrorMessage(
        error,
        t('input.voiceInput.permissionDenied'),
        t('input.voiceInput.failed'),
      ));
      latestAudioLevelRef.current = 0;
      setAudioLevel(0);
      setPhase('idle');
    }
  }, [attachSession, enqueueChunk, getCurrentText, modelInstalled, openVoiceInputSettings, settings, speechRuntimeSupported, stopAndTranscribe, t, updateAudioLevel]);

  const toggle = useCallback(() => {
    if (phase === 'recording') {
      void stopAndTranscribe('transcribe');
      return;
    }
    if (phase !== 'idle') {
      return;
    }
    void startRecording();
  }, [phase, startRecording, stopAndTranscribe]);

  const cancel = useCallback(() => {
    void cancelRecording();
  }, [cancelRecording]);

  const transcribe = useCallback(() => {
    void stopAndTranscribe('transcribe');
  }, [stopAndTranscribe]);

  const transcribeAndSend = useCallback(() => {
    void stopAndTranscribe('send');
  }, [stopAndTranscribe]);

  useEffect(() => {
    if (phase !== 'recording') return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      void cancelRecording();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [cancelRecording, phase]);

  // Keep the idle control clickable when capture is unavailable so the
  // start handler can explain the unsupported state instead of silently
  // presenting a disabled button.
  const disabled = phase === 'recording'
    ? false
    : !settings?.enabled || !speechRuntimeSupported || (!isTauriRuntime() && !isOpenHarmonyRuntime() && !isMediaCaptureSupported()) || phase === 'preparing' || phase === 'transcribing';
  const tooltip = useMemo(() => {
    if (!settings?.enabled) return t('input.voiceInput.disabled');
    if (!speechRuntimeSupported || (!isTauriRuntime() && !isOpenHarmonyRuntime() && !isMediaCaptureSupported())) return t('input.voiceInput.unsupported');
    if (settings.provider === 'cloud') return t('input.voiceInput.cloudPending');
    if (modelInstalled === false) return t('input.voiceInput.modelMissing');
    if (phase === 'preparing') return t('input.voiceInput.preparing');
    if (phase === 'recording') return t('input.voiceInput.stop');
    if (phase === 'transcribing') return t('input.voiceInput.transcribing');
    return t('input.voiceInput.start');
  }, [modelInstalled, phase, settings?.enabled, settings?.provider, speechRuntimeSupported, t]);

  return {
    enabled: settings?.enabled === true && speechRuntimeSupported,
    disabled,
    phase,
    completionMode,
    audioLevel,
    lowVolumeWarning,
    lowVolumeTooltip: t('input.voiceInput.lowVolume'),
    tooltip,
    cancelTooltip: t('input.cancelShortcut'),
    transcribeTooltip: t('input.voiceInput.transcribeOnly'),
    sendTooltip: t('input.voiceInput.transcribeAndSend'),
    toggle,
    cancel,
    transcribe,
    transcribeAndSend,
  };
}
