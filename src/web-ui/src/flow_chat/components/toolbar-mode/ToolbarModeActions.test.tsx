// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearanceCompiler } from '@/infrastructure/appearance/compiler/AppearanceCompiler';
import { AppearanceRegistry } from '@/infrastructure/appearance/registry/AppearanceRegistry';
import { APPEARANCE_SCHEMA_VERSION, type AppearancePackage } from '@/infrastructure/appearance/types';
import { ToolbarMode } from './ToolbarMode';
import { toolbarModeAppearanceDescriptor } from './ToolbarMode.appearance';
import { ScrollToLatestBar } from '../ScrollToLatestBar';
import { ScrollToTurnHeaderButton } from '../ScrollToTurnHeaderButton';
import { scrollToLatestBarAppearanceDescriptor } from '../ScrollToLatestBar.appearance';
import { scrollToTurnHeaderButtonAppearanceDescriptor } from '../ScrollToTurnHeaderButton.appearance';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  expanded: false,
  pending: false,
  toggle: vi.fn(async () => {}),
  disable: vi.fn(async () => {}),
  drag: vi.fn(async () => {}),
  anchor: null as HTMLButtonElement | null,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('./ToolbarModeContext', () => ({ useToolbarModeContext: () => ({
  isToolbarMode: true, isExpanded: mocks.expanded,
  toggleExpanded: mocks.toggle, disableToolbarMode: mocks.disable,
  toolbarState: { hasPendingConfirmation: mocks.pending, pendingToolId: 'tool-1' },
}) }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ startDragging: mocks.drag }) }));
vi.mock('@/infrastructure/runtime', () => ({ isMacOSDesktopRuntime: () => false }));
vi.mock('@/infrastructure/contexts/WorkspaceContext', () => ({ useCurrentWorkspace: () => ({ workspacePath: '/repo' }) }));
vi.mock('../session-menu', () => ({
  SessionMenu: () => null,
  useFlowChatSessions: () => ({ sessionTitle: 'Session', activeSession: { dialogTurns: [{ status: 'processing' }] } }),
}));
vi.mock('../voice/RealtimeVoiceCallContext', () => ({ useRealtimeVoiceCall: () => ({ phase: 'idle', end: vi.fn() }) }));
vi.mock('../voice/ConversationModeSurface', () => ({ ConversationModeSurface: () => null }));
vi.mock('@/app/scenes/session/ChatPane', () => ({ default: () => null }));
vi.mock('@/infrastructure/appearance/runtime/AppearanceOverlayHost', () => ({ getAppearanceOverlayHost: () => document.body }));
vi.mock('@/shared/utils/useAnchoredPopoverPosition', () => ({
  useAnchoredPopoverPosition: ({ open, anchorRef }: { open: boolean; anchorRef: React.RefObject<HTMLButtonElement | null> }) => {
    if (!open) return null;
    mocks.anchor = anchorRef.current;
    return { top: 40, left: 80, placement: 'bottom' };
  },
}));

describe('toolbar icon actions and legacy Appearance hooks', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.expanded = false;
    mocks.pending = false;
    mocks.anchor = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll('[data-test-legacy-style]').forEach(node => node.remove());
    document.documentElement.removeAttribute('data-openbitfun-appearance');
    document.documentElement.removeAttribute('data-openbitfun-appearance-revision');
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('dispatches confirm, reject and stop once and keeps controls out of window dragging', async () => {
    const confirm = vi.fn();
    const reject = vi.fn();
    const cancel = vi.fn();
    window.addEventListener('toolbar-tool-confirm', confirm);
    window.addEventListener('toolbar-tool-reject', reject);
    window.addEventListener('toolbar-cancel-task', cancel);
    try {
      mocks.pending = true;
      act(() => root.render(<ToolbarMode />));
      for (const action of ['confirm', 'reject']) {
        const icon = container.querySelector(`.toolbar-btn--${action} svg`)!;
        act(() => {
          icon.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          icon.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
      }
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(reject).toHaveBeenCalledTimes(1);
      expect((confirm.mock.calls[0][0] as CustomEvent).detail).toEqual({ toolId: 'tool-1' });
      expect((reject.mock.calls[0][0] as CustomEvent).detail).toEqual({ toolId: 'tool-1' });
      expect(mocks.drag).not.toHaveBeenCalled();
      mocks.pending = false;
      act(() => root.render(<ToolbarMode />));
      act(() => container.querySelector<HTMLButtonElement>('.toolbar-btn--cancel-compact')!.click());
      expect(cancel).toHaveBeenCalledTimes(1);
      await act(async () => container.querySelector<HTMLButtonElement>('.toolbar-btn--overflow')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('.toolbar-btn--expand')!.click());
      expect(mocks.toggle).toHaveBeenCalledTimes(1);
      expect(mocks.disable).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('toolbar-tool-confirm', confirm);
      window.removeEventListener('toolbar-tool-reject', reject);
      window.removeEventListener('toolbar-cancel-task', cancel);
    }
  });

  it('anchors the overflow menu to its button and preserves outside dismissal', () => {
    mocks.expanded = true;
    act(() => root.render(<ToolbarMode />));
    const trigger = container.querySelector<HTMLButtonElement>('.openbitfun-toolbar-mode__overflow-trigger')!;
    act(() => trigger.querySelector('svg')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(mocks.anchor).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = document.querySelector('.openbitfun-toolbar-mode__overflow-menu')!;
    act(() => vi.advanceTimersByTime(0));
    act(() => menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('matches old package part rules against the actual migrated controls', () => {
    mocks.expanded = true;
    act(() => root.render(<>
      <ToolbarMode />
      <ScrollToLatestBar visible onClick={vi.fn()} />
      <ScrollToTurnHeaderButton visible onClick={vi.fn()} />
    </>));
    const pkg: AppearancePackage = {
      schema: 'openbitfun.appearance', schemaVersion: APPEARANCE_SCHEMA_VERSION,
      id: 'test.toolbar-scroll', name: 'Toolbar and scroll controls', version: '1.0.0', mode: 'dark',
      components: {
        'toolbar-mode': { parts: { overflowTrigger: { states: { expanded: { opacity: { kind: 'number', value: 0.41 } } } } } },
        'scroll-to-latest-bar': { parts: { button: { base: { opacity: { kind: 'number', value: 0.42 } } } } },
        'scroll-to-turn-header-button': { parts: { button: { base: { opacity: { kind: 'number', value: 0.43 } } } } },
      },
    };
    const serialized = JSON.stringify(pkg);
    const restored = JSON.parse(serialized) as AppearancePackage;
    const registry = new AppearanceRegistry()
      .registerComponent(toolbarModeAppearanceDescriptor)
      .registerComponent(scrollToLatestBarAppearanceDescriptor)
      .registerComponent(scrollToTurnHeaderButtonAppearanceDescriptor);
    const snapshot = new AppearanceCompiler(registry).compile(restored, 1);
    expect(JSON.stringify(restored)).toBe(serialized);
    document.documentElement.setAttribute('data-openbitfun-appearance', snapshot.id);
    document.documentElement.setAttribute('data-openbitfun-appearance-revision', String(snapshot.revision));
    const style = document.createElement('style');
    style.dataset.testLegacyStyle = '';
    style.textContent = snapshot.cssText;
    document.head.appendChild(style);
    for (const [selector, opacity] of [
      ['.openbitfun-toolbar-mode__overflow-trigger', '0.41'],
      ['.scroll-to-latest-bar__btn', '0.42'],
      ['.scroll-to-turn-header-trigger__btn', '0.43'],
    ]) {
      const button = container.querySelector(selector)!;
      expect(button.getAttribute('data-openbitfun-component')).toBe('icon-button');
      const rule = Array.from(style.sheet!.cssRules).find(candidate =>
        candidate instanceof CSSStyleRule && candidate.style.opacity === opacity,
      ) as CSSStyleRule | undefined;
      expect(rule).toBeDefined();
      expect(document.querySelector(rule!.selectorText)).toBe(button);
    }
  });
});
