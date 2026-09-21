// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SceneTopBar from './SceneTopBar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const sceneState = vi.hoisted(() => ({ openTabs: [{}] as unknown[], selectTab: vi.fn(), closeTab: vi.fn() }));
const startDragging = vi.hoisted(() => vi.fn(async () => {}));
const runtimeState = vi.hoisted(() => ({ usesHostWindowControls: false }));
const stylesheet = readFileSync(
  resolve(process.cwd(), 'src/app/components/SceneTopBar/SceneTopBar.scss'),
  'utf8',
);

vi.mock('@/app/components/WindowControls', () => ({ WindowControls: () => <button>Window controls</button> }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ startDragging }) }));
vi.mock('@/infrastructure/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/infrastructure/runtime')>();
  return {
    ...actual,
    usesHostWindowControls: () => runtimeState.usesHostWindowControls,
  };
});
vi.mock('../../stores/sceneStore', () => ({ useSceneStore: (selector: (state: typeof sceneState) => unknown) => selector(sceneState) }));
vi.mock('../SceneBar/SceneBar', async () => {
  const { TabGroup } = await import('@bitfun/ui');
  return {
    default: () => <TabGroup
      value="0"
      onValueChange={sceneState.selectTab}
      items={sceneState.openTabs.map((_, index) => ({
        value: String(index),
        label: <span>Scene {index}</span>,
        endAction: <button onClick={sceneState.closeTab} aria-label={`Close scene ${index}`}>
          <svg><path d="M0 0L1 1" /></svg>
        </button>,
      }))}
    />,
  };
});
vi.mock('./SceneChrome', () => ({
  SceneChromeHost: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>
    <button><svg><path d="M0 0L1 1" /></svg>Scene action</button>
    <input aria-label="Scene search" />
    <div contentEditable suppressContentEditableWarning><span>Editable title</span></div>
  </div>,
}));

describe('SceneTopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('__TAURI_INTERNALS__', {
      invoke: vi.fn(),
      metadata: { currentWindow: { label: 'main' } },
    });
    sceneState.openTabs = [{}];
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reclaims the left gutter and extends the divider through the remaining right gap', () => {
    expect(stylesheet).not.toContain('border-block-end: 0;');
    expect(stylesheet).toContain(
      'inset-block-end: calc(0px - var(--bitfun-border-width-default));',
    );
    expect(stylesheet).toContain('width: var(--bitfun-space-4);');
    expect(stylesheet).toContain('margin-inline-start: calc(0px - var(--bitfun-space-4));');
    expect(stylesheet).toContain('inset-inline-start: 100%;');
  });

  it('composes the public Toolbar without changing scene actions or window interaction boundaries', () => {
    sceneState.openTabs = [{}];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const maximize = vi.fn();
    try {
      act(() => root.render(<SceneTopBar onMinimize={vi.fn()} onMaximize={maximize} onClose={vi.fn()} />));
      const toolbar = host.querySelector('[data-bitfun-component="toolbar"]')!;
      expect(toolbar.getAttribute('data-bitfun-part')).toBe('topBar');
      expect(toolbar.getAttribute('data-size')).toBe('md');
      expect(toolbar.getAttribute('data-bordered')).toBe('true');
      expect(toolbar.querySelector(':scope > [data-bitfun-part="leading"] [role="tablist"]')).not.toBeNull();
      const trailing = toolbar.querySelector(':scope > [data-bitfun-part="trailing"]')!;
      const actions = trailing.querySelector('[data-bitfun-part="sceneActions"]')!;
      const controls = trailing.querySelector('[data-bitfun-part="controls"]')!;
      expect(actions.nextElementSibling).toBe(controls);
      expect(controls.querySelector('button')).not.toBeNull();
      act(() => toolbar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      expect(maximize).toHaveBeenCalledOnce();
      act(() => toolbar.querySelector('[data-bitfun-part="sceneActions"] button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
      expect(maximize).toHaveBeenCalledOnce();
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it('removes the divider when no scene tabs are open', () => {
    sceneState.openTabs = [];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      act(() => root.render(<SceneTopBar />));
      expect(host.querySelector('[data-bitfun-component="toolbar"]')?.getAttribute('data-bordered'))
        .toBe('false');
    } finally {
      act(() => root.unmount());
      host.remove();
      sceneState.openTabs = [{}];
    }
  });

  describe('window gestures', () => {
    let host: HTMLDivElement;
    let root: Root;
    const maximize = vi.fn();

    beforeEach(() => {
      host = document.createElement('div');
      document.body.append(host);
      root = createRoot(host);
    });

    afterEach(() => {
      act(() => root.unmount());
      host.remove();
    });

    function renderBar(tabCount = 1, isMaximized = false) {
      sceneState.openTabs = Array.from({ length: tabCount }, () => ({}));
      act(() => root.render(<SceneTopBar onMinimize={vi.fn()} onMaximize={maximize} onClose={vi.fn()} isMaximized={isMaximized} />));
      return host.querySelector<HTMLElement>('[data-bitfun-component="toolbar"]')!;
    }

    async function mouseDown(target: Element, options: MouseEventInit = {}) {
      await act(async () => {
        target.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, button: 0, detail: 1, ...options,
        }));
        await vi.dynamicImportSettled();
      });
    }

    function doubleClick(target: Element) {
      act(() => target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2, cancelable: true })));
    }

    async function pointerMove(clientX: number, clientY: number) {
      await act(async () => {
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX, clientY }));
        await vi.dynamicImportSettled();
      });
    }

    it.each([0, 1, 2, 8])('allows dragging and maximizing empty chrome with %i open tabs', async tabCount => {
      const toolbar = renderBar(tabCount);
      const tabList = toolbar.querySelector('[role="tablist"]')!;
      const leading = toolbar.querySelector(':scope > [data-bitfun-part="leading"]')!;
      expect(leading.children).toHaveLength(1);
      expect(leading.firstElementChild).toBe(tabList);

      for (const target of [toolbar, leading, tabList]) {
        await mouseDown(target);
        doubleClick(target);
      }
      expect(startDragging).toHaveBeenCalledTimes(3);
      expect(maximize).toHaveBeenCalledTimes(3);
    });

    it('keeps the single tab label draggable and updates the boundary when another tab opens or closes', async () => {
      const toolbar = renderBar();
      const label = () => toolbar.querySelector('[role="tab"] [data-bitfun-part="label"] span')!;
      await mouseDown(label());
      doubleClick(label());
      expect(startDragging).toHaveBeenCalledOnce();
      expect(maximize).toHaveBeenCalledOnce();

      renderBar(2);
      await mouseDown(label());
      doubleClick(label());
      expect(startDragging).toHaveBeenCalledOnce();
      expect(maximize).toHaveBeenCalledOnce();

      renderBar(1);
      await mouseDown(label());
      doubleClick(label());
      expect(startDragging).toHaveBeenCalledTimes(2);
      expect(maximize).toHaveBeenCalledTimes(2);
    });

    it('leaves multi-tab labels and item padding to tab interaction', async () => {
      const toolbar = renderBar(2);
      const tab = toolbar.querySelector<HTMLButtonElement>('[role="tab"][data-bitfun-value="1"]')!;
      for (const target of [tab, tab.querySelector('span')!, tab.closest('[data-bitfun-part="item"]')!]) {
        await mouseDown(target);
        doubleClick(target);
      }
      act(() => tab.click());
      expect(sceneState.selectTab).toHaveBeenCalledWith('1');
      expect(startDragging).not.toHaveBeenCalled();
      expect(maximize).not.toHaveBeenCalled();
    });

    it.each([1, 2])('excludes close buttons, nested SVGs, scene actions and editable fields with %i tabs', async tabCount => {
      const toolbar = renderBar(tabCount);
      for (const target of toolbar.querySelectorAll('button:not([role="tab"]), svg, path, input, [contenteditable] span')) {
        await mouseDown(target);
        doubleClick(target);
      }
      act(() => toolbar.querySelector<HTMLButtonElement>('[aria-label="Close scene 0"]')!.click());
      expect(sceneState.closeTab).toHaveBeenCalledOnce();
      expect(startDragging).not.toHaveBeenCalled();
      expect(maximize).not.toHaveBeenCalled();
    });

    it('uses click detail to preserve double-click maximize without blocking separate drags', async () => {
      const toolbar = renderBar(2);
      await mouseDown(toolbar);
      await mouseDown(toolbar, { detail: 2 });
      doubleClick(toolbar);
      expect(startDragging).toHaveBeenCalledOnce();
      expect(maximize).toHaveBeenCalledOnce();

      await mouseDown(toolbar, { detail: 1 });
      expect(startDragging).toHaveBeenCalledTimes(2);
    });

    it('ignores middle/right buttons and gestures already handled by descendants', async () => {
      const toolbar = renderBar(2);
      await mouseDown(toolbar, { button: 1 });
      await mouseDown(toolbar, { button: 2 });
      const tabList = toolbar.querySelector('[role="tablist"]')!;
      tabList.addEventListener('mousedown', event => event.preventDefault());
      tabList.addEventListener('dblclick', event => event.preventDefault());
      await mouseDown(tabList);
      doubleClick(tabList);
      expect(startDragging).not.toHaveBeenCalled();
      expect(maximize).not.toHaveBeenCalled();
    });

    it('does not expose native window gestures in a browser runtime', async () => {
      vi.stubGlobal('__TAURI_INTERNALS__', undefined);
      const toolbar = renderBar(2);
      await mouseDown(toolbar);
      doubleClick(toolbar);
      expect(startDragging).not.toHaveBeenCalled();
      expect(maximize).not.toHaveBeenCalled();
    });

    it('keeps a plain click on maximized chrome inert instead of restoring the window', async () => {
      const toolbar = renderBar(2, true);
      await mouseDown(toolbar);
      // No pointer movement: native drag must never start, so the maximized
      // window is not restored by a bare toolbar click.
      expect(startDragging).not.toHaveBeenCalled();
      await mouseDown(toolbar, { detail: 1 });
      expect(startDragging).not.toHaveBeenCalled();
    });

    it('starts dragging a maximized window only after the pointer crosses the movement threshold', async () => {
      const toolbar = renderBar(2, true);
      await mouseDown(toolbar);
      await pointerMove(3, 3);
      expect(startDragging).not.toHaveBeenCalled();
      await pointerMove(7, 3);
      expect(startDragging).toHaveBeenCalledOnce();
      // Listeners are torn down after the drag starts; further movement must
      // not start a second drag.
      await pointerMove(30, 30);
      expect(startDragging).toHaveBeenCalledOnce();
    });

    it('releases the pending maximized gesture on pointerup without dragging', async () => {
      const toolbar = renderBar(2, true);
      await mouseDown(toolbar);
      act(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
      await pointerMove(20, 20);
      expect(startDragging).not.toHaveBeenCalled();
    });

    it('still maximizes by double-click while maximized', async () => {
      const toolbar = renderBar(2, true);
      doubleClick(toolbar);
      expect(maximize).toHaveBeenCalledOnce();
      expect(startDragging).not.toHaveBeenCalled();
    });
  });

  it('reserves the host chrome corner instead of in-app controls on the OpenHarmony host', () => {
    runtimeState.usesHostWindowControls = true;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      // Mirrors the AppLayout OHOS wiring: maximize stays for the double-click
      // gesture while minimize/close are withheld from the in-app chrome.
      act(() => root.render(<SceneTopBar onMaximize={vi.fn()} />));
      const toolbar = host.querySelector('[data-bitfun-component="toolbar"]')!;
      expect(toolbar.querySelector('[data-bitfun-part="hostControls"]')).not.toBeNull();
      expect(toolbar.querySelector('[data-bitfun-part="controls"]')).toBeNull();
      expect(stylesheet).toContain('&--host');
      expect(stylesheet).toContain('width: 96px;');
    } finally {
      runtimeState.usesHostWindowControls = false;
      act(() => root.unmount());
      host.remove();
    }
  });
});
