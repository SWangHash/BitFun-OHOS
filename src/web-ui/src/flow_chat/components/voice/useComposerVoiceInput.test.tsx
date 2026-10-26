/**
 * @vitest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useComposerVoiceInput,
  type ComposerVoiceInputController,
} from './useComposerVoiceInput';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  finishText: 'Transcribed request',
  voiceInputSettings: {
    enabled: true,
    provider: 'local',
    model_id: 'sensevoice-test-model',
    default_language: 'auto',
    max_recording_seconds: 60,
    microphone_device_id: '',
  },
  recorderStop: vi.fn(async () => undefined),
  listModels: vi.fn(),
  finishInputSession: vi.fn(),
  cancelInputSession: vi.fn(async () => undefined),
  downloadModel: vi.fn(),
  cancelModelDownload: vi.fn(async () => undefined),
  modelStatusListener: undefined as ((status: Record<string, unknown>) => void) | undefined,
  transcriptionListener: undefined as
    | ((event: { sessionId: string; text: string; isFinal: boolean }) => void)
    | undefined,
  notificationInfo: vi.fn(),
  notificationError: vi.fn(),
}));

vi.mock('@/infrastructure/api', () => ({
  DEFAULT_SPEECH_SAMPLE_RATE: 16000,
  LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID: 'sensevoice-test-model',
  speechAPI: {
    listModels: mocks.listModels,
    onModelStatusChanged: vi.fn((listener: (status: Record<string, unknown>) => void) => {
      mocks.modelStatusListener = listener;
      return () => undefined;
    }),
    onModelProgress: vi.fn(() => () => undefined),
    onTranscription: vi.fn((
      listener: (event: { sessionId: string; text: string; isFinal: boolean }) => void,
    ) => {
      mocks.transcriptionListener = listener;
      return () => undefined;
    }),
    downloadModel: mocks.downloadModel,
    cancelModelDownload: mocks.cancelModelDownload,
    startInputSession: vi.fn(async () => ({ sessionId: 'voice-session-1' })),
    appendAudioChunk: vi.fn(async () => undefined),
    finishInputSession: mocks.finishInputSession,
    cancelInputSession: mocks.cancelInputSession,
  },
}));

vi.mock('@/infrastructure/config/hooks', () => ({
  useAIExperienceSettings: () => ({
    settings: {
      voice_input: mocks.voiceInputSettings,
    },
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/infrastructure/runtime', () => ({
  isTauriRuntime: () => true,
  isOpenHarmonyRuntime: () => false,
}));

vi.mock('@/app/stores/sceneStore', () => ({
  useSceneStore: {
    getState: () => ({ openScene: vi.fn() }),
  },
}));

vi.mock('@/app/scenes/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ openDestination: vi.fn() }),
  },
}));

vi.mock('@/shared/notification-system', () => ({
  notificationService: {
    info: mocks.notificationInfo,
    warning: vi.fn(),
    error: mocks.notificationError,
  },
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/infrastructure/speech/voiceInputAudio', () => ({
  createVoiceInputRecorder: vi.fn(async () => ({
    stop: mocks.recorderStop,
  })),
}));

interface ProbeProps {
  focusInputSoon: () => void;
  getCurrentText: () => string;
  insertText: (text: string) => string | null;
  replaceText: (text: string) => void;
  onController: (controller: ComposerVoiceInputController) => void;
}

function Probe({ onController, ...options }: ProbeProps) {
  const controller = useComposerVoiceInput(options);
  useEffect(() => onController(controller), [controller, onController]);
  return null;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function speechModel(
  modelId: string,
  state: 'installed' | 'not_installed',
  expectedBytes = 1,
) {
  return {
    modelId,
    displayName: modelId === 'qwen-test-model' ? 'Qwen test' : 'SenseVoice test',
    provider: 'test',
    version: 'test',
    description: 'Test speech model',
    languages: ['auto', 'en'],
    state,
    installedBytes: state === 'installed' ? expectedBytes : 0,
    expectedBytes,
  };
}

describe('useComposerVoiceInput transcription', () => {
  let host: HTMLDivElement;
  let root: Root;
  let controller: ComposerVoiceInputController | undefined;
  let focusInputSoon: ReturnType<typeof vi.fn>;
  let insertText: ReturnType<typeof vi.fn>;
  let getCurrentText: ReturnType<typeof vi.fn>;
  let replaceText: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mocks.voiceInputSettings = {
      enabled: true,
      provider: 'local',
      model_id: 'sensevoice-test-model',
      default_language: 'auto',
      max_recording_seconds: 60,
      microphone_device_id: '',
    };
    mocks.listModels.mockReset();
    mocks.listModels.mockImplementation(async () => ({
      models: [speechModel('sensevoice-test-model', 'installed')],
    }));
    mocks.finishText = 'Transcribed request';
    mocks.finishInputSession.mockImplementation(async () => ({
      text: mocks.finishText,
      language: 'en',
      durationMs: 12,
      audioDurationSeconds: 1,
    }));
    mocks.recorderStop.mockClear();
    mocks.finishInputSession.mockClear();
    mocks.cancelInputSession.mockClear();
    mocks.downloadModel.mockReset();
    mocks.downloadModel.mockImplementation(async () => ({
      modelId: 'sensevoice-test-model',
      displayName: 'SenseVoice test',
      provider: 'test',
      version: 'test',
      description: 'Test speech model',
      languages: ['auto', 'en'],
      state: 'installed',
      installedBytes: 165 * 1024 * 1024,
      expectedBytes: 165 * 1024 * 1024,
    }));
    mocks.cancelModelDownload.mockClear();
    mocks.modelStatusListener = undefined;
    mocks.transcriptionListener = undefined;
    mocks.notificationInfo.mockClear();
    mocks.notificationError.mockClear();
    focusInputSoon = vi.fn();
    insertText = vi.fn(() => 'Existing draft Transcribed request');
    getCurrentText = vi.fn(() => 'Existing draft');
    replaceText = vi.fn();
    controller = undefined;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root.render(
        <Probe
          focusInputSoon={focusInputSoon}
          getCurrentText={getCurrentText}
          insertText={insertText}
          replaceText={replaceText}
          onController={(next) => { controller = next; }}
        />,
      );
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  async function startRecording() {
    await act(async () => {
      controller?.toggle();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(controller?.phase).toBe('recording');
  }

  it('inserts the transcript into the draft when recording stops', async () => {
    await startRecording();

    await act(async () => {
      controller?.transcribe();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(insertText).toHaveBeenCalledWith('Transcribed request');
    expect(focusInputSoon).toHaveBeenCalledOnce();
    expect(controller?.phase).toBe('idle');
  });

  it('does not touch the draft or notify when recognition is empty', async () => {
    mocks.finishText = '   ';
    await startRecording();

    await act(async () => {
      controller?.transcribe();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(insertText).not.toHaveBeenCalled();
    expect(mocks.notificationInfo).not.toHaveBeenCalled();
    expect(controller?.phase).toBe('idle');
  });

  it('appends live recognition to a draft that keeps its trailing whitespace', async () => {
    let composerValue = 'Existing draft ';
    getCurrentText.mockImplementation(() => composerValue);
    replaceText.mockImplementation((text: string) => {
      composerValue = text;
    });

    await startRecording();

    await act(async () => {
      mocks.transcriptionListener?.({
        sessionId: 'voice-session-1',
        text: 'spoken words',
        isFinal: false,
      });
      await Promise.resolve();
    });

    expect(replaceText).toHaveBeenLastCalledWith('Existing draft spoken words');
  });

  async function emitTranscription(text: string) {
    await act(async () => {
      mocks.transcriptionListener?.({
        sessionId: 'voice-session-1',
        text,
        isFinal: false,
      });
      await Promise.resolve();
    });
  }

  function useLaggingComposer(initialDraft = '') {
    let composerValue = initialDraft;
    let laggingValue = initialDraft;
    getCurrentText.mockImplementation(() => laggingValue);
    replaceText.mockImplementation((text: string) => {
      laggingValue = composerValue;
      composerValue = text;
    });
    return {
      read: () => composerValue,
      readState: () => laggingValue,
    };
  }

  it('renders streaming snapshots without spaces while the composer state lags', async () => {
    const composer = useLaggingComposer();
    await startRecording();

    for (const snapshot of ['因', '因都', '因都在想', '因都在想法实现', '因都在想法实现这 个功能']) {
      await emitTranscription(snapshot);
    }

    expect(composer.read()).toBe('因都在想法实现这个功能');
    expect(composer.read()).not.toContain(' ');
    expect(composer.readState()).not.toContain(' ');
  });

  it('renders the reported HarmonyOS snapshot stream without fragment spaces', async () => {
    const composer = useLaggingComposer();
    await startRecording();

    for (const snapshot of [
      '因 都 在想',
      '因 都 在想 法 实现这 个功能',
      '因 都 在想 法 实现这 公 员。',
    ]) {
      await emitTranscription(snapshot);
    }

    expect(composer.read()).toBe('因都在想法实现这公员。');
  });

  it('keeps only the latest take of a clause instead of repeating every take', async () => {
    const composer = useLaggingComposer();
    await startRecording();

    for (const snapshot of [
      '增强',
      '增强的',
      '增强的有',
      '增强的有增强的',
      '增强的有增强的有增强的。',
    ]) {
      await emitTranscription(snapshot);
    }

    expect(composer.read()).toBe('增强的有增强的有增强的。');
  });

  it('replaces revised recognition instead of appending it twice', async () => {
    const composer = useLaggingComposer('帮我写');
    await startRecording();

    await emitTranscription('今天天气不错');
    await emitTranscription('今天天气很好');

    expect(composer.read()).toBe('帮我写今天天气很好');
  });

  it('keeps the reshape of a finished transcript free of duplicated speech', async () => {
    const composer = useLaggingComposer();
    mocks.finishText = '今天天气不错我们去公园吧';
    await startRecording();

    await emitTranscription('今天天气不错');
    await act(async () => {
      controller?.transcribe();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(composer.read()).toBe('今天天气不错我们去公园吧');
  });

  it('keeps a user edit and appends only the speech that is still missing', async () => {
    let composerValue = 'Existing draft';
    getCurrentText.mockImplementation(() => composerValue);
    replaceText.mockImplementation((text: string) => {
      composerValue = text;
    });
    await startRecording();

    await emitTranscription('你好世界');
    expect(composerValue).toBe('Existing draft你好世界');

    composerValue = 'Existing draft你好世界！';
    await emitTranscription('你好世界今天下雨了');

    expect(composerValue).toBe('Existing draft你好世界！今天下雨了');
  });

  it('keeps the idle control actionable when microphone capture is unavailable', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });
    await act(async () => {
      root.render(
        <Probe
          focusInputSoon={focusInputSoon}
          getCurrentText={getCurrentText}
          insertText={insertText}
          replaceText={replaceText}
          onController={(next) => { controller = next; }}
        />,
      );
      await Promise.resolve();
    });

    expect(controller?.disabled).toBe(false);
    await act(async () => {
      controller?.toggle();
      await Promise.resolve();
    });

    expect(controller?.phase).toBe('idle');
    expect(mocks.notificationError).toHaveBeenCalledWith('input.voiceInput.unsupported');
  });

  it('downloads a missing local model in place and continues into recording', async () => {
    await act(async () => {
      mocks.modelStatusListener?.({
        modelId: 'sensevoice-test-model',
        displayName: 'SenseVoice test',
        provider: 'test',
        version: 'test',
        description: 'Test speech model',
        languages: ['auto', 'en'],
        state: 'not_installed',
        installedBytes: 0,
        expectedBytes: 165 * 1024 * 1024,
      });
      await Promise.resolve();
    });

    await act(async () => {
      controller?.toggle();
      await Promise.resolve();
    });
    expect(controller?.phase).toBe('setup');
    expect(controller?.setupMessage).toBe('input.voiceInput.setupRequired');

    await act(async () => {
      controller?.installAndStart();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.downloadModel).toHaveBeenCalledWith('sensevoice-test-model');
    expect(controller?.phase).toBe('recording');
  });

  it('dismisses a stale setup prompt when the selected model becomes installed', async () => {
    await act(async () => {
      mocks.modelStatusListener?.(speechModel(
        'sensevoice-test-model',
        'not_installed',
        165 * 1024 * 1024,
      ));
      await Promise.resolve();
    });

    await act(async () => {
      controller?.toggle();
      await Promise.resolve();
    });
    expect(controller?.phase).toBe('setup');

    await act(async () => {
      mocks.modelStatusListener?.(speechModel(
        'sensevoice-test-model',
        'installed',
        165 * 1024 * 1024,
      ));
      await Promise.resolve();
    });

    expect(controller?.phase).toBe('idle');
  });

  it('ignores an old model query that completes after the selected model query', async () => {
    mocks.listModels.mockImplementationOnce(async () => ({
      models: [speechModel('qwen-test-model', 'installed', 838 * 1024 * 1024)],
    }));
    mocks.voiceInputSettings = {
      ...mocks.voiceInputSettings,
      model_id: 'qwen-test-model',
    };
    await act(async () => {
      root.render(
        <Probe
          focusInputSoon={focusInputSoon}
          getCurrentText={getCurrentText}
          insertText={insertText}
          replaceText={replaceText}
          onController={(next) => { controller = next; }}
        />,
      );
      await Promise.resolve();
    });

    const oldSenseVoiceQuery = createDeferred<{ models: ReturnType<typeof speechModel>[] }>();
    const currentQwenQuery = createDeferred<{ models: ReturnType<typeof speechModel>[] }>();
    mocks.listModels
      .mockImplementationOnce(() => oldSenseVoiceQuery.promise)
      .mockImplementationOnce(() => currentQwenQuery.promise);

    mocks.voiceInputSettings = {
      ...mocks.voiceInputSettings,
      model_id: 'sensevoice-test-model',
    };
    await act(async () => {
      root.render(
        <Probe
          focusInputSoon={focusInputSoon}
          getCurrentText={getCurrentText}
          insertText={insertText}
          replaceText={replaceText}
          onController={(next) => { controller = next; }}
        />,
      );
    });

    mocks.voiceInputSettings = {
      ...mocks.voiceInputSettings,
      model_id: 'qwen-test-model',
    };
    await act(async () => {
      root.render(
        <Probe
          focusInputSoon={focusInputSoon}
          getCurrentText={getCurrentText}
          insertText={insertText}
          replaceText={replaceText}
          onController={(next) => { controller = next; }}
        />,
      );
    });

    await act(async () => {
      currentQwenQuery.resolve({
        models: [speechModel('qwen-test-model', 'installed', 838 * 1024 * 1024)],
      });
      await currentQwenQuery.promise;
    });
    await act(async () => {
      oldSenseVoiceQuery.resolve({
        models: [speechModel('sensevoice-test-model', 'not_installed', 165 * 1024 * 1024)],
      });
      await oldSenseVoiceQuery.promise;
    });

    await startRecording();
    expect(controller?.phase).toBe('recording');
  });
});
