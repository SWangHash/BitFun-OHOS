/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ComposerVoiceInputBar,
  ComposerVoiceInputButton,
  ComposerVoiceStopButton,
} from './ComposerVoiceInputButton';
import type { ComposerVoiceInputController } from './useComposerVoiceInput';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function createController(
  overrides: Partial<ComposerVoiceInputController> = {},
): ComposerVoiceInputController {
  return {
    enabled: true,
    disabled: false,
    phase: 'recording',
    audioLevel: 0,
    lowVolumeWarning: false,
    downloadProgress: null,
    setupMessage: 'Set up voice input',
    setupActionLabel: 'Install',
    setupCancelTooltip: 'Cancel setup',
    tooltip: 'Stop recording',
    statusLabel: 'Recording, click the microphone to stop',
    toggle: vi.fn(),
    installAndStart: vi.fn(),
    dismissSetup: vi.fn(),
    transcribe: vi.fn(),
    ...overrides,
  };
}

describe('ComposerVoiceInput', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render(node: React.ReactElement) {
    await act(async () => {
      root.render(node);
    });
  }

  it('keeps the idle microphone control in the composer actions', async () => {
    await render(<ComposerVoiceInputButton controller={createController({ phase: 'idle' })} />);

    expect(container.querySelector('.bitfun-chat-input__voice-control-shell')).toBeTruthy();
    expect(container.querySelector('.bitfun-chat-input__voice-bar')).toBeNull();
  });

  it('leaves the composer start actions empty while recording', async () => {
    await render(<ComposerVoiceInputButton controller={createController()} />);

    expect(container.querySelector('[data-bitfun-component="composer-voice-input"]')).toBeNull();
  });

  it('renders the recording status below the composer as plain centered text', async () => {
    await render(<ComposerVoiceInputBar controller={createController()} />);

    const bar = container.querySelector<HTMLElement>('.bitfun-chat-input__voice-bar');

    expect(bar).toBeTruthy();
    expect(bar?.dataset.bitfunPart).toBe('root');
    expect(bar?.dataset.bitfunPhase).toBe('recording');
    expect(bar?.dataset.bitfunState).toBe('active');
    expect(container.textContent).toBe('Recording, click the microphone to stop');
    expect(container.querySelector('[data-bitfun-part="status"]')).toBeTruthy();
    expect(container.querySelector('.bitfun-chat-input__voice-pill')).toBeNull();
    expect(container.querySelector('.bitfun-chat-input__voice-pill-timeline')).toBeNull();
    expect(container.querySelector('[data-bitfun-action="stop"]')).toBeNull();
  });

  it('marks the status bar when no voice is detected', async () => {
    await render(
      <ComposerVoiceInputBar controller={createController({ lowVolumeWarning: true })} />,
    );

    expect(
      container.querySelector<HTMLElement>('.bitfun-chat-input__voice-bar')?.dataset.bitfunState,
    ).toBe('active low-volume');
  });

  it('renders nothing below the composer when voice input is inactive', async () => {
    await render(<ComposerVoiceInputBar controller={createController({ phase: 'idle' })} />);

    expect(container.querySelector('.bitfun-chat-input__voice-bar')).toBeNull();
  });

  it('renders the stop control in the composer trailing slot while recording', async () => {
    await render(<ComposerVoiceStopButton controller={createController()} />);

    const action = container.querySelector<HTMLElement>('[data-bitfun-action="stop"]');

    expect(action).toBeTruthy();
    expect(action?.classList.contains('bitfun-chat-input__voice-stop-action')).toBe(true);
    expect(action?.dataset.bitfunPart).toBe('action');
    expect(action?.querySelector('button')).toMatchObject({
      dataset: expect.objectContaining({
        bitfunRole: 'composer-action',
        bitfunShape: 'circle',
        bitfunVariant: 'primary',
      }),
    });
  });

  it('stops and transcribes when the stop microphone is clicked', async () => {
    const controller = createController();
    await render(<ComposerVoiceStopButton controller={controller} />);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-bitfun-action="stop"] button')?.click();
    });

    expect(controller.transcribe).toHaveBeenCalledOnce();
  });

  it('shows the live meter in the stop control instead of a static microphone', async () => {
    await render(<ComposerVoiceStopButton controller={createController()} />);

    const meter = container.querySelector<HTMLElement>('.bitfun-chat-input__voice-live-meter');

    expect(meter).toBeTruthy();
    expect(meter?.dataset.bitfunPart).toBe('liveMeter');
    expect(meter?.querySelectorAll('.bitfun-chat-input__voice-live-meter-bar')).toHaveLength(3);
    expect(container.querySelector('[data-bitfun-component="icon"]')).toBeNull();
  });

  it('scales the live meter bars with the microphone level', async () => {
    const readBarHeights = () =>
      Array.from(container.querySelectorAll<HTMLElement>('.bitfun-chat-input__voice-live-meter-bar'))
        .map(bar => Number.parseFloat(bar.style.height));

    await render(<ComposerVoiceStopButton controller={createController({ audioLevel: 0 })} />);
    const quiet = readBarHeights();

    await render(<ComposerVoiceStopButton controller={createController({ audioLevel: 0.5 })} />);
    const loud = readBarHeights();

    expect(quiet).toHaveLength(3);
    quiet.forEach((height, index) => {
      expect(loud[index]).toBeGreaterThan(height);
    });
  });

  it('renders no stop control outside the recording phase', async () => {
    await render(<ComposerVoiceStopButton controller={createController({ phase: 'transcribing' })} />);

    expect(container.querySelector('[data-bitfun-action="stop"]')).toBeNull();
  });
});
