// @vitest-environment jsdom

import React, { act } from 'react';
import type { Context, Options } from 'modern-screenshot';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceCompiler } from '@/infrastructure/appearance/compiler/AppearanceCompiler';
import { AppearanceRegistry } from '@/infrastructure/appearance/registry/AppearanceRegistry';
import { APPEARANCE_SCHEMA_VERSION, type AppearancePackage } from '@/infrastructure/appearance/types';
import type { DialogTurn, ModelRound } from '../../types/flow-chat';
import { ExportImageButton } from './ExportImageButton';
import { ModelRoundItem } from './ModelRoundItem';
import { exportImageAppearanceDescriptor } from './ExportImageButton.appearance';
import { modelRoundItemAppearanceDescriptor } from './ModelRoundItem.appearance';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  store: vi.fn(() => ({ sessions: new Map() })),
  copyText: vi.fn(() => 'Full transcript'),
  clipboard: vi.fn(async (_text: string) => undefined),
  error: vi.fn(),
  createContext: vi.fn(),
  captureCanvas: vi.fn(),
  destroyContext: vi.fn(),
  loading: vi.fn(),
  updateProgress: vi.fn(),
  dismissProgress: vi.fn(),
  savePng: vi.fn(),
  notifyExportSuccess: vi.fn(),
  drawImage: vi.fn(),
  revealing: false,
  anchor: null as HTMLButtonElement | null,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/infrastructure/i18n', () => {
  const translate = (key: string, params?: Record<string, unknown>) => params ? `${key} ${JSON.stringify(params)}` : key;
  return {
    i18nService: { t: translate, formatDate: () => '10/23 12:00', formatNumber: String },
    useI18n: () => ({ t: translate, formatDate: () => '12:00' }),
  };
});
vi.mock('../../store/FlowChatStore', () => ({
  FlowChatStore: { getInstance: () => ({ getState: mocks.store }) },
}));
vi.mock('@/shared/notification-system', () => ({
  notificationService: { error: mocks.error, warning: vi.fn(), success: vi.fn(), loading: mocks.loading },
}));
vi.mock('@/shared/utils/useAnchoredPopoverPosition', () => ({
  useAnchoredPopoverPosition: ({ open, anchorRef }: {
    open: boolean; anchorRef: React.RefObject<HTMLButtonElement | null>;
  }) => {
    if (!open) return null;
    mocks.anchor = anchorRef.current;
    return { top: 80, left: 100, placement: 'top' };
  },
}));
vi.mock('@/infrastructure/appearance/runtime/AppearanceOverlayHost', () => ({
  getAppearanceOverlayHost: () => document.body,
}));
vi.mock('@/infrastructure/api', () => ({ workspaceAPI: {} }));
vi.mock('modern-screenshot', () => ({
  createContext: mocks.createContext, domToCanvas: mocks.captureCanvas, destroyContext: mocks.destroyContext,
}));
vi.mock('../../utils/saveExportedPng', () => ({
  savePngBlob: mocks.savePng,
  notifyPngExportSuccess: mocks.notifyExportSuccess,
}));
vi.mock('../FlowTextBlock', () => ({ FlowTextBlock: () => <span>Answer</span> }));
vi.mock('../FlowToolCard', () => ({ FlowToolCard: () => null }));
vi.mock('../../tool-cards/ModelThinkingDisplay', async () => {
  const { Icon } = await import('@bitfun/ui');
  return {
    ModelThinkingDisplay: () => <Icon name="thinking" size="sm" style={{ color: 'rgb(51, 51, 51)' }} />,
  };
});
vi.mock('../subagent/SubagentProjectionView', () => ({ SubagentProjectionView: () => null }));
vi.mock('./ForkSessionButton', () => ({ ForkSessionButton: () => null }));
vi.mock('./FlowChatContext', () => ({
  useFlowChatContext: () => ({ sessionId: 'session-1', allowTranscriptExport: true }),
}));
vi.mock('../../hooks/TypewriterRevealGate', () => ({
  TypewriterRevealGateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../hooks/typewriterRevealGateContext', () => ({
  useCreateTypewriterRevealGate: () => ({ isAnyRevealing: mocks.revealing }),
}));
vi.mock('../../utils/dialogTurnCopy', () => ({ buildDialogTurnCopyText: mocks.copyText }));

const round: ModelRound = {
  id: 'round-1', index: 0, startTime: 1, status: 'completed',
  isStreaming: false, isComplete: true,
  items: [{ id: 'text-1', type: 'text', timestamp: 1, status: 'completed', content: 'Answer', isStreaming: false }],
};

// This package uses the pre-migration component/part/state names on disk.
const legacyPackage: AppearancePackage = {
  schema: 'bitfun.appearance', schemaVersion: APPEARANCE_SCHEMA_VERSION,
  id: 'test.message-actions', name: 'Message actions', version: '1.0.0', mode: 'dark',
  components: {
    'model-round-item': { parts: {
      root: { base: { opacity: { kind: 'number', value: 0.9 } } },
      retryToggle: { base: { opacity: { kind: 'number', value: 0.6 } } },
      action: { states: { copied: { opacity: { kind: 'number', value: 0.8 } } } },
    } },
    'export-image': { parts: {
      trigger: { states: { exporting: { opacity: { kind: 'number', value: 0.7 } } } },
    } },
  },
};

function compileLegacyPackage() {
  const serialized = JSON.stringify(legacyPackage);
  const restored = JSON.parse(serialized) as AppearancePackage;
  const registry = new AppearanceRegistry()
    .registerComponent(modelRoundItemAppearanceDescriptor)
    .registerComponent(exportImageAppearanceDescriptor);
  const snapshot = new AppearanceCompiler(registry).compile(restored, 1);
  expect(JSON.stringify(restored)).toBe(serialized);
  document.documentElement.setAttribute('data-bitfun-appearance', snapshot.id);
  document.documentElement.setAttribute('data-bitfun-appearance-revision', String(snapshot.revision));
  const style = document.createElement('style');
  style.textContent = snapshot.cssText;
  document.head.appendChild(style);
  return style;
}

function expectCompiledRuleMatches(style: HTMLStyleElement, element: Element, opacity: string) {
  const rule = Array.from(style.sheet!.cssRules).find(candidate =>
    candidate instanceof CSSStyleRule && candidate.style.opacity === opacity,
  ) as CSSStyleRule | undefined;
  expect(rule).toBeDefined();
  expect(document.querySelector(rule!.selectorText)).toBe(element);
}

describe('message copy and image export controls', () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.revealing = false;
    mocks.anchor = null;
    mocks.copyText.mockReturnValue('Full transcript');
    mocks.store.mockReturnValue({ sessions: new Map() });
    const actualCapture = await vi.importActual<typeof import('modern-screenshot')>('modern-screenshot');
    mocks.createContext.mockReset().mockImplementation(actualCapture.createContext);
    mocks.destroyContext.mockReset().mockImplementation(actualCapture.destroyContext);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: mocks.clipboard } });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.head.querySelectorAll('style').forEach(style => style.remove());
    document.documentElement.removeAttribute('data-bitfun-appearance');
    document.documentElement.removeAttribute('data-bitfun-appearance-revision');
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('anchors the export menu to the button and retains inside/outside and Escape handling', () => {
    act(() => root.render(<ExportImageButton turnId="turn-1" />));
    const trigger = container.querySelector<HTMLButtonElement>('.model-round-item__export-btn')!;
    act(() => trigger.click());
    expect(mocks.anchor).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.export-image-menu')).not.toBeNull();
    act(() => trigger.querySelector('[data-bitfun-part="icon"]')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.export-image-menu')).toBeNull();
    act(() => trigger.click());
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.querySelector('.export-image-menu')).toBeNull();
  });

  it.each(['exportImage.collapsedThinking', 'exportImage.expandedThinking'])(
    'retains pending feedback and recovers after a missing Turn through %s', async label => {
      const style = compileLegacyPackage();
      act(() => root.render(<ExportImageButton turnId="missing-turn" />));
      const trigger = container.querySelector<HTMLButtonElement>('.model-round-item__export-btn')!;
      act(() => trigger.click());
      const action = Array.from(document.querySelectorAll<HTMLButtonElement>('.export-image-menu button'))
        .find(button => button.textContent === label)!;
      act(() => action.click());
      expect(trigger.disabled).toBe(true);
      expect(trigger.querySelector('.spinning')).not.toBeNull();
      expect(trigger.getAttribute('data-loading')).toBe('false');
      expectCompiledRuleMatches(style, trigger, '0.7');
      act(() => trigger.click());
      expect(document.querySelector('.export-image-menu')).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(50));
      expect(mocks.store).toHaveBeenCalledTimes(1);
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith('flow-chat:exportImage.dialogNotFound');
      expect(trigger.disabled).toBe(false);
      expect(trigger.querySelector('.spinning')).toBeNull();
    },
  );

  async function startImageExport(expandThinking = false, deferThinkingIcon = false, height = 600) {
    const iconDataUrl = `data:image/png;base64,${'B'.repeat(120)}`;
    const png = new Blob(['png'], { type: 'image/png' });
    const turn: DialogTurn = {
      id: 'review-turn', sessionId: 'review-session', startTime: 1, status: 'completed',
      modelRounds: [{
        ...round,
        items: [
          ...round.items,
          ...[1, 2].map(index => ({
            id: `thinking-${index}`, type: 'thinking' as const, timestamp: index + 1,
            status: 'completed' as const, content: 'Inspecting the code', isStreaming: false,
          })),
        ],
      }],
    };
    mocks.store.mockReturnValue({
      sessions: new Map([['review-session', { title: 'Code review', dialogTurns: [turn] }]]),
    });
    mocks.loading.mockReturnValue({
      id: 'image-export', updateMessage: mocks.updateProgress, cancel: mocks.dismissProgress,
    });
    const canvas = document.createElement('canvas');
    mocks.captureCanvas.mockReset().mockImplementation(async (capture: Context<HTMLElement>) => {
      expect(capture.node.isConnected).toBe(true);
      await capture.onCloneEachNode?.(capture.node);
      await capture.onCloneNode?.(capture.node);
      await capture.onEmbedNode?.(capture.node);
      await capture.onCreateForeignObjectSvg?.(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
      canvas.width = Math.floor(capture.width * capture.scale);
      canvas.height = Math.floor(capture.height * capture.scale);
      return canvas;
    });
    mocks.savePng.mockReset().mockResolvedValue({ filePath: '/downloads/review.png', downloaded: false });
    const pendingThinkingImages: (() => void)[] = [];
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      removeAttribute() {}
      set src(value: string) {
        if (deferThinkingIcon && value.startsWith('data:image/svg+xml')) {
          pendingThinkingImages.push(() => this.onload?.());
          return;
        }
        queueMicrotask(() => this.onload?.());
      }
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.getAttribute('data-bitfun-name') === 'thinking') {
        return { left: 24, top: 80, width: 16, height: 16 } as DOMRect;
      }
      return this.classList.contains('export-content__logo-placeholder')
        ? { left: 24, top: 24, width: 32, height: 32 } as DOMRect
        : { left: 0, top: 0, width: 800, height } as DOMRect;
    });
    const context = {
      drawImage: mocks.drawImage, save: vi.fn(), restore: vi.fn(),
      fillRect: vi.fn(), fillStyle: '', globalCompositeOperation: 'source-over',
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(iconDataUrl);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(png));

    act(() => root.render(<ExportImageButton turnId="review-turn" />));
    const trigger = container.querySelector<HTMLButtonElement>('.model-round-item__export-btn')!;
    act(() => trigger.click());
    const action = Array.from(document.querySelectorAll<HTMLButtonElement>('.export-image-menu button'))
      .find(button => button.textContent === (expandThinking
        ? 'exportImage.expandedThinking' : 'exportImage.collapsedThinking'))!;
    act(() => action.click());
    await act(async () => vi.advanceTimersByTimeAsync(50));
    return { trigger, png, iconDataUrl, context, canvas, pendingThinkingImages };
  }

  async function renderForCapture() {
    await act(async () => vi.advanceTimersByTimeAsync(400));
    await act(async () => vi.dynamicImportSettled());
    await act(async () => vi.advanceTimersByTimeAsync(20));
  }

  it('captures once, preserves thinking artwork, encodes once and releases the bitmap and render', async () => {
    const { trigger, png, iconDataUrl, context, canvas } = await startImageExport();
    let capturedIcons: HTMLElement[] = [];
    const actualCapture = await vi.importActual<typeof import('modern-screenshot')>('modern-screenshot');
    mocks.createContext.mockImplementationOnce(async (node: HTMLElement, options: Options) => {
      capturedIcons = Array.from(node.querySelectorAll<HTMLElement>('[data-bitfun-name="thinking"]'));
      return actualCapture.createContext(node, options);
    });
    await renderForCapture();

    expect(capturedIcons).toHaveLength(2);
    for (const icon of capturedIcons) {
      expect(icon.style.getPropertyValue('mask-image')).toBe('none');
      expect(icon.style.getPropertyValue('-webkit-mask-image')).toBe('none');
      expect(icon.style.backgroundColor).toBe('transparent');
      expect(icon.style.backgroundImage).toContain(iconDataUrl);
    }
    expect(vi.mocked(HTMLCanvasElement.prototype.toDataURL).mock.calls.filter(([type]) => type === 'image/png'))
      .toHaveLength(1);
    expect(context.globalCompositeOperation).toBe('source-in');
    expect(context.fillStyle).toBe('rgb(51, 51, 51)');
    expect(context.fillRect).toHaveBeenCalledExactlyOnceWith(0, 0, 32, 32);
    expect(mocks.captureCanvas).toHaveBeenCalledOnce();
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 'image/png');
    expect(mocks.drawImage).toHaveBeenLastCalledWith(expect.any(Object), 48, 48, 64, 64);
    expect(mocks.savePng).toHaveBeenCalledExactlyOnceWith(png, 'Code review_10-23-12-00.png');
    expect(mocks.notifyExportSuccess).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.updateProgress.mock.calls.map(call => call[0])).toEqual([
      'exportImage.preparing', 'exportImage.preparing', 'exportImage.loadingImages',
      'exportImage.generating', 'exportImage.encoding', 'exportImage.saving',
    ]);
    expect(mocks.dismissProgress).toHaveBeenCalledOnce();
    expect(mocks.destroyContext).toHaveBeenCalledOnce();
    expect(document.querySelector('iframe')).toBeNull();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(document.querySelector('#export-image-wrapper')).toBeNull();
    expect(trigger.disabled).toBe(false);
  });

  it('holds ownership on timeout, aborts resource requests and discards a late capture before allowing retry', async () => {
    const { trigger, canvas } = await startImageExport();
    let finishCapture!: (canvas: HTMLCanvasElement) => void;
    mocks.captureCanvas.mockImplementationOnce(() => new Promise<HTMLCanvasElement>(resolve => { finishCapture = resolve; }));
    await renderForCapture();
    const capture = mocks.captureCanvas.mock.calls[0][0] as Context<HTMLElement>;
    await act(async () => vi.advanceTimersByTimeAsync(capture.timeout));

    expect(capture.fetch.requestInit?.signal?.aborted).toBe(true);
    expect(mocks.updateProgress).toHaveBeenLastCalledWith('exportImage.stopping');
    expect(mocks.captureCanvas).toHaveBeenCalledOnce();
    expect(mocks.savePng).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(trigger.disabled).toBe(true);
    expect(capture.node.isConnected).toBe(true);
    act(() => trigger.click());
    expect(document.querySelector('.export-image-menu')).toBeNull();
    await expect(capture.onCloneEachNode?.(capture.node)).rejects.toThrow('timed out');

    canvas.width = 1600;
    canvas.height = 1200;
    await act(async () => finishCapture(canvas));
    expect(mocks.savePng).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('exportImage.timedOut'));
    expect(mocks.notifyExportSuccess).not.toHaveBeenCalled();
    expect(mocks.destroyContext).toHaveBeenCalledOnce();
    expect(mocks.dismissProgress).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(document.querySelector('#export-image-wrapper')).toBeNull();
    expect(trigger.disabled).toBe(false);
    act(() => trigger.click());
    expect(document.querySelector('.export-image-menu')).not.toBeNull();
  });

  it.each(['error', 'timeout'] as const)(
    'preserves original icons and continues capture after icon rasterization %s',
    async failure => {
      const { trigger, png, canvas, pendingThinkingImages } = await startImageExport(false, failure === 'timeout');
      if (failure === 'error') {
        vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementationOnce(() => {
          throw new DOMException('Canvas is tainted', 'SecurityError');
        });
      }
      let capturedIcons: HTMLElement[] = [];
      let finishCapture!: (canvas: HTMLCanvasElement) => void;
      mocks.captureCanvas.mockImplementationOnce((capture: Context<HTMLElement>) => {
        expect(capture.node.isConnected).toBe(true);
        capturedIcons = Array.from(capture.node.querySelectorAll<HTMLElement>('[data-bitfun-name="thinking"]'));
        return new Promise<HTMLCanvasElement>(resolve => { finishCapture = resolve; });
      });
      await renderForCapture();
      if (failure === 'timeout') {
        await act(async () => vi.advanceTimersByTimeAsync(15_000));
      }

      expect(mocks.captureCanvas).toHaveBeenCalledOnce();
      expect(capturedIcons).toHaveLength(2);
      for (const icon of capturedIcons) {
        expect(icon.style.getPropertyValue('mask-image')).toContain('data:image/svg+xml');
        expect(icon.style.backgroundImage).toBe('');
      }
      const originalStyles = capturedIcons.map(icon => icon.style.cssText);
      if (failure === 'timeout') {
        expect(pendingThinkingImages).toHaveLength(1);
        await act(async () => { pendingThinkingImages.forEach(load => load()); });
        expect(capturedIcons.map(icon => icon.style.cssText)).toEqual(originalStyles);
        expect(HTMLCanvasElement.prototype.toDataURL).not.toHaveBeenCalledWith('image/png');
      }
      canvas.width = 1600;
      canvas.height = 1200;
      await act(async () => finishCapture(canvas));
      await act(async () => vi.advanceTimersByTimeAsync(20));

      expect(mocks.savePng).toHaveBeenCalledExactlyOnceWith(png, 'Code review_10-23-12-00.png');
      expect(mocks.error).not.toHaveBeenCalled();
      expect(document.querySelector('#export-image-wrapper')).toBeNull();
      expect(trigger.disabled).toBe(false);
    },
  );

  it.each([12_000, 500_000])('sizes the first capture for height %i and positions the logo using the actual bitmap', async height => {
    await startImageExport(true, false, height);
    await renderForCapture();
    const capture = mocks.captureCanvas.mock.calls[0][0] as Context<HTMLElement>;
    const outputWidth = Math.floor(capture.width * capture.scale);
    const outputHeight = Math.floor(capture.height * capture.scale);
    expect(mocks.captureCanvas).toHaveBeenCalledOnce();
    expect(capture.scale).toBeLessThan(2);
    expect(outputWidth * outputHeight).toBeLessThanOrEqual(16_777_216);
    expect(Math.max(outputWidth, outputHeight)).toBeLessThanOrEqual(32_768);
    expect(capture.timeout).toBeGreaterThan(30_000);
    expect(capture.timeout).toBeLessThanOrEqual(120_000);
    expect(mocks.drawImage).toHaveBeenLastCalledWith(expect.any(Object),
      24 * outputWidth / capture.width, 24 * outputHeight / capture.height,
      32 * outputWidth / capture.width, 32 * outputHeight / capture.height);
    expect(mocks.savePng).toHaveBeenCalledOnce();
  });

  it('yields a browser task while cloning so queued work can run', async () => {
    const { canvas } = await startImageExport();
    let finishCapture!: (canvas: HTMLCanvasElement) => void;
    mocks.captureCanvas.mockImplementationOnce(() => new Promise<HTMLCanvasElement>(resolve => { finishCapture = resolve; }));
    await renderForCapture();
    const capture = mocks.captureCanvas.mock.calls[0][0] as Context<HTMLElement>;
    let queuedWorkRan = false;
    let cloneStepFinished = false;
    setTimeout(() => { queuedWorkRan = true; }, 0);
    const cloneStep = Promise.resolve(capture.onCloneEachNode?.(capture.node)).then(() => { cloneStepFinished = true; });
    await Promise.resolve();
    expect(cloneStepFinished).toBe(false);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await cloneStep;
    expect(queuedWorkRan).toBe(true);
    canvas.width = 1600;
    canvas.height = 1200;
    await act(async () => finishCapture(canvas));
    await act(async () => vi.advanceTimersByTimeAsync(20));
    expect(mocks.savePng).toHaveBeenCalledOnce();
  });

  it.each([
    ['capture', 'Image decoding failed'],
    ['size', 'exportImage.contentSizeUnavailable'],
    ['canvas', 'exportImage.canvasUnavailable'],
    ['encoding', 'exportImage.pngEncodingFailed'],
  ] as const)('reports the %s failure with a localized known reason or the original external error', async (failure, reason) => {
    const { trigger, canvas } = await startImageExport(false, false, failure === 'size' ? 0 : 600);
    if (failure === 'capture') {
      mocks.captureCanvas.mockRejectedValueOnce(new Error('Image decoding failed'));
    } else if (failure === 'canvas') {
      canvas.width = canvas.height = 0;
      mocks.captureCanvas.mockResolvedValueOnce(canvas);
    } else if (failure === 'encoding') {
      vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(callback => callback(null));
    }
    await renderForCapture();
    expect(mocks.captureCanvas).toHaveBeenCalledTimes(failure === 'size' ? 0 : 1);
    expect(mocks.savePng).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(`exportImage.exportFailedWithReason ${JSON.stringify({ reason })}`);
    expect(mocks.destroyContext).toHaveBeenCalledTimes(failure === 'size' ? 0 : 1);
    expect(mocks.dismissProgress).toHaveBeenCalledOnce();
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('#export-image-wrapper')).toBeNull();
    expect(trigger.disabled).toBe(false);
  });

  it('discards PNG encoding that finishes after the deadline instead of saving it', async () => {
    const { trigger, png, canvas } = await startImageExport();
    let finishEncoding!: BlobCallback;
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation(callback => { finishEncoding = callback; });
    await renderForCapture();
    const capture = mocks.captureCanvas.mock.calls[0][0] as Context<HTMLElement>;
    await act(async () => vi.advanceTimersByTimeAsync(capture.timeout));
    expect(trigger.disabled).toBe(true);
    expect(mocks.savePng).not.toHaveBeenCalled();
    await act(async () => finishEncoding(png));
    expect(mocks.savePng).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('exportImage.timedOut'));
    expect(mocks.destroyContext).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(trigger.disabled).toBe(false);
  });

  it.each(['full', 'result'] as const)('copies %s once and keeps legacy appearance on the copied button', async scope => {
    const style = compileLegacyPackage();
    act(() => root.render(<ModelRoundItem round={round} turnId="turn-1" isLastRound isTurnComplete />));
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="model-round-copy-btn"]')!;
    expectCompiledRuleMatches(style, container.querySelector('[data-testid="chat-assistant-message"]')!, '0.9');
    act(() => trigger.click());
    expect(mocks.anchor).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await act(async () => document.querySelector<HTMLButtonElement>(`[data-testid="model-round-copy-${scope}"]`)!.click());
    expect(mocks.copyText).toHaveBeenCalledExactlyOnceWith('turn-1', scope, expect.any(Object));
    expect(mocks.clipboard).toHaveBeenCalledExactlyOnceWith('Full transcript');
    expect(document.querySelector('[data-testid="model-round-copy-menu"]')).toBeNull();
    expectCompiledRuleMatches(style, trigger, '0.8');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(trigger.classList.contains('copied')).toBe(false);
  });

  it('keeps copy disabled and outside the tab order while typewriter output is catching up', () => {
    mocks.revealing = true;
    act(() => root.render(<ModelRoundItem round={round} turnId="turn-1" isLastRound isTurnComplete />));
    const trigger = container.querySelector<HTMLButtonElement>('[data-testid="model-round-copy-btn"]')!;
    expect(trigger.disabled).toBe(true);
    expect(trigger.tabIndex).toBe(-1);
    act(() => trigger.click());
    expect(document.querySelector('[data-testid="model-round-copy-menu"]')).toBeNull();
  });

  it('expands a failed attempt and copies its diagnostic without changing the history state', async () => {
    const withHistory: ModelRound = {
      ...round,
      attempts: [
        {
          id: 'attempt-1', index: 0, status: 'failed', items: [],
          diagnostic: {
            attemptId: 'attempt-1', attemptIndex: 0,
            category: 'transient_request_error', rawError: 'Request timed out',
          },
        },
        { id: 'attempt-2', index: 1, status: 'completed', items: round.items },
      ],
    };
    act(() => root.render(<ModelRoundItem round={withHistory} turnId="turn-1" isLastRound isTurnComplete />));
    const historyToggle = container.querySelector<HTMLButtonElement>('.model-round-item__retry-toggle')!;
    expect(historyToggle.getAttribute('data-bitfun-component')).toBe('button');
    expect(historyToggle.querySelector('[data-overflow-behavior]')).toBeNull();
    expectCompiledRuleMatches(compileLegacyPackage(), historyToggle, '0.6');
    act(() => historyToggle.click());
    const toggle = container.querySelector<HTMLButtonElement>('.model-round-item__attempt-diagnostic-toggle')!;
    act(() => toggle.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.textContent).toContain('Request timed out');
    const copy = container.querySelector<HTMLButtonElement>('.model-round-item__attempt-diagnostic-copy')!;
    await act(async () => copy.click());
    expect(mocks.clipboard).toHaveBeenCalledExactlyOnceWith('Request timed out');
    expect(copy.getAttribute('data-bitfun-state')).toBe('copied');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    act(() => toggle.click());
    expect(container.querySelector('.model-round-item__attempt-diagnostic-details')).toBeNull();
    expect(container.querySelector('.model-round-item__retry-attempt')).not.toBeNull();
    act(() => historyToggle.click());
    expect(container.querySelector('.model-round-item__retry-attempt')).toBeNull();
  });
});
