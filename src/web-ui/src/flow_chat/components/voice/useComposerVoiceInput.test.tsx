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
  recorderStop: vi.fn(async () => undefined),
  createVoiceInputRecorder: vi.fn(),
  startInputSession: vi.fn(async () => ({ sessionId: 'voice-session-1' })),
  finishInputSession: vi.fn(),
  cancelInputSession: vi.fn(async () => undefined),
  notificationInfo: vi.fn(),
  notificationError: vi.fn(),
}));

vi.mock('@/infrastructure/api', () => ({
  DEFAULT_SPEECH_SAMPLE_RATE: 16000,
  LOCAL_SENSEVOICE_SMALL_INT8_MODEL_ID: 'sensevoice-test-model',
  speechAPI: {
    listModels: vi.fn(async () => ({
      models: [{
        modelId: 'sensevoice-test-model',
        displayName: 'SenseVoice test',
        provider: 'test',
        version: 'test',
        description: 'Test speech model',
        languages: ['auto', 'en'],
        state: 'installed',
        installedBytes: 1,
        expectedBytes: 1,
      }],
    })),
    onModelStatusChanged: vi.fn(() => () => undefined),
    onTranscription: vi.fn(() => () => undefined),
    startInputSession: mocks.startInputSession,
    appendAudioChunk: vi.fn(async () => undefined),
    finishInputSession: mocks.finishInputSession,
    cancelInputSession: mocks.cancelInputSession,
  },
}));

vi.mock('@/infrastructure/config/hooks', () => ({
  useAIExperienceSettings: () => ({
    settings: {
      voice_input: {
        enabled: true,
        provider: 'local',
        model_id: 'sensevoice-test-model',
        default_language: 'auto',
        max_recording_seconds: 60,
        microphone_device_id: '',
      },
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
    getState: () => ({ setActiveTab: vi.fn() }),
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
  createVoiceInputRecorder: mocks.createVoiceInputRecorder,
}));

interface ProbeProps {
  activateInput: () => void;
  focusInputSoon: () => void;
  getCurrentText: () => string;
  replaceText: (text: string) => void;
  submitText: (text: string) => Promise<void>;
  onController: (controller: ComposerVoiceInputController) => void;
}

function Probe({ onController, ...options }: ProbeProps) {
  const controller = useComposerVoiceInput(options);
  useEffect(() => onController(controller), [controller, onController]);
  return null;
}

describe('useComposerVoiceInput completion modes', () => {
  let host: HTMLDivElement;
  let root: Root;
  let controller: ComposerVoiceInputController | undefined;
  let activateInput: ReturnType<typeof vi.fn>;
  let focusInputSoon: ReturnType<typeof vi.fn>;
  let replaceText: ReturnType<typeof vi.fn>;
  let submitText: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  const currentText = 'Existing draft';

  beforeEach(async () => {
    mocks.finishText = 'Transcribed request';
    mocks.finishInputSession.mockImplementation(async () => ({
      text: mocks.finishText,
      language: 'en',
      durationMs: 12,
      audioDurationSeconds: 1,
    }));
    mocks.recorderStop.mockClear();
    mocks.createVoiceInputRecorder.mockReset();
    mocks.createVoiceInputRecorder.mockResolvedValue({ stop: mocks.recorderStop });
    mocks.startInputSession.mockClear();
    mocks.finishInputSession.mockClear();
    mocks.cancelInputSession.mockClear();
    mocks.notificationInfo.mockClear();
    mocks.notificationError.mockClear();
    activateInput = vi.fn();
    focusInputSoon = vi.fn();
    replaceText = vi.fn();
    submitText = vi.fn(async () => undefined);
    controller = undefined;
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root.render(
        <Probe
          activateInput={activateInput}
          focusInputSoon={focusInputSoon}
          getCurrentText={() => currentText}
          replaceText={replaceText}
          submitText={submitText}
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

  it('inserts the transcript without sending in transcribe-only mode', async () => {
    await startRecording();

    await act(async () => {
      controller?.transcribe();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replaceText).toHaveBeenCalledWith('Existing draft Transcribed request');
    expect(focusInputSoon).toHaveBeenCalledOnce();
    expect(submitText).not.toHaveBeenCalled();
  });

  it('submits the replaced transcript in transcribe-and-send mode', async () => {
    await startRecording();

    await act(async () => {
      controller?.transcribeAndSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(activateInput).toHaveBeenCalledOnce();
    expect(replaceText).toHaveBeenCalledWith('Existing draft Transcribed request');
    expect(submitText).toHaveBeenCalledWith('Existing draft Transcribed request');
    expect(focusInputSoon).not.toHaveBeenCalled();
  });

  it('does not submit the existing draft when recognition is empty', async () => {
    mocks.finishText = '   ';
    await startRecording();

    await act(async () => {
      controller?.transcribeAndSend();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replaceText).not.toHaveBeenCalledWith('');
    expect(submitText).not.toHaveBeenCalled();
    expect(mocks.notificationInfo).not.toHaveBeenCalled();
  });

  it('reports microphone permission denial without entering recording', async () => {
    mocks.createVoiceInputRecorder.mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { name: 'NotAllowedError' }),
    );
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });

    await act(async () => {
      controller?.toggle();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller?.phase).toBe('idle');
    expect(mocks.notificationError).toHaveBeenCalledOnce();
    expect(mocks.notificationError.mock.calls[0][0]).not.toContain('Recording');
    expect(mocks.startInputSession).not.toHaveBeenCalled();
  });
});
