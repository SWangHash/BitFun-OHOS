// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { savePanelRatio, STORAGE_KEYS } from '../../layout/panelConfig';
import { storage } from '@/shared/utils/storageAdapter';
import { sessionPaneLayoutStore } from './sessionPaneLayoutStore';

const mocks = vi.hoisted(() => {
  const state = {
    layout: {
      rightPanelWidth: 400,
      rightPanelCollapsed: false,
      bottomTerminalPanelHeight: 300,
      bottomTerminalPanelCollapsed: true,
      chatCollapsed: false,
      centerPanelCollapsed: false,
    },
  };
  return {
    state,
    updateRightPanelWidth: vi.fn((width: number) => {
      state.layout.rightPanelWidth = width;
    }),
    updateBottomTerminalPanelHeight: vi.fn(),
  };
});

vi.mock('../../hooks/useApp', () => ({
  useApp: () => ({
    state: mocks.state,
    updateRightPanelWidth: mocks.updateRightPanelWidth,
    updateBottomTerminalPanelHeight: mocks.updateBottomTerminalPanelHeight,
    toggleRightPanel: vi.fn(),
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./ChatPane', () => ({ default: () => <div /> }));
vi.mock('./BottomTerminalPane', () => ({ default: () => <div /> }));
vi.mock('./AuxPane', async () => {
  const { forwardRef } = await import('react');
  return { default: forwardRef(() => <div />) };
});
vi.mock('./sessionPanelLayout', () => ({
  collapseSessionBottomTerminalPane: vi.fn(),
  expandSessionAuxPane: vi.fn(),
  expandSessionBottomTerminalPane: vi.fn(),
}));
vi.mock('@/tools/terminal/services/terminalPanelPreferenceService', () => ({
  getCachedTerminalPanelPosition: () => 'right',
  onTerminalPanelPositionChange: () => vi.fn(),
  refreshTerminalPanelPosition: async () => undefined,
}));

import SessionScene from './SessionScene';

describe('SessionScene proportional right panel sizing', () => {
  let container: HTMLDivElement;
  let root: Root;
  let viewportWidth = 1000;
  let sessionWidth = 900;
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    viewportWidth = 1000;
    sessionWidth = 900;
    mocks.state.layout.rightPanelWidth = 400;
    mocks.state.layout.chatCollapsed = false;
    mocks.state.layout.rightPanelCollapsed = false;
    sessionPaneLayoutStore.setState({ displayMode: 'split' });
    mocks.updateRightPanelWidth.mockClear();
    mocks.updateBottomTerminalPanelHeight.mockClear();
    savePanelRatio(STORAGE_KEYS.RIGHT_PANEL_RATIO, 0.4);
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      get: () => viewportWidth,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get() {
        return (this as HTMLElement).dataset.testid === 'session-scene' ? sessionWidth : 0;
      },
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    storage.removeItem(STORAGE_KEYS.RIGHT_PANEL_RATIO);
    if (originalInnerWidth) Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    } else {
      delete (HTMLElement.prototype as Partial<HTMLElement>).offsetWidth;
    }
  });

  const render = async () => {
    await act(async () => root.render(<SessionScene />));
    await act(async () => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  };

  it('scales 400px at 1000px to 800px at 2000px and back to 400px', async () => {
    await render();
    expect(mocks.updateRightPanelWidth).not.toHaveBeenCalled();

    viewportWidth = 2000;
    sessionWidth = 1900;
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(mocks.updateRightPanelWidth).toHaveBeenLastCalledWith(800);

    await act(async () => root.render(<SessionScene />));
    mocks.updateRightPanelWidth.mockClear();
    viewportWidth = 1000;
    sessionWidth = 900;
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(mocks.updateRightPanelWidth).toHaveBeenLastCalledWith(400);
  });

  it('applies overlay only to the side pane and keeps editor mode as the main content surface', async () => {
    sessionPaneLayoutStore.setState({ displayMode: 'overlay' });
    await render();
    expect(container.querySelector('[data-testid="session-scene"]')?.classList.contains('bitfun-session-scene--overlay')).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-testid="session-right-pane-resizer"]')?.style.right).toBe('400px');
    expect(container.querySelector('[data-testid="session-chat-pane"]')).not.toBeNull();
    mocks.state.layout.chatCollapsed = true;
    await render();
    expect(container.querySelector('[data-testid="session-scene"]')?.classList.contains('bitfun-session-scene--overlay')).toBe(false);
    expect(container.querySelector('[data-testid="session-aux-pane"]')?.classList.contains('bitfun-session-scene__aux-pane--editor-mode')).toBe(true);
    expect(sessionPaneLayoutStore.getState().displayMode).toBe('overlay');
  });
});
