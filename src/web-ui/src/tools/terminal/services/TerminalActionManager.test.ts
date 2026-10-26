// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return { handlers };
});

vi.mock('@/infrastructure/event-bus', () => ({
  globalEventBus: {
    on: (event: string, handler: (payload: unknown) => void) => {
      const set = mocks.handlers.get(event) ?? new Set();
      set.add(handler);
      mocks.handlers.set(event, set);
      return () => {
        set.delete(handler);
      };
    },
    emit: (event: string, payload: unknown) => {
      mocks.handlers.get(event)?.forEach((handler) => handler(payload));
    },
  },
}));

vi.mock('@/shared/utils/textSelection', () => ({
  readTextFromClipboard: vi.fn(async () => ''),
}));

vi.mock('@/infrastructure/i18n', () => ({
  i18nService: { t: (key: string) => key },
}));

vi.mock('@xterm/xterm', () => ({ Terminal: class {} }));

import { ContextType, type TerminalContext } from '@/shared/context-menu-system/types/context.types';
import { TerminalMenuProvider } from '@/shared/context-menu-system/providers/TerminalMenuProvider';
import { terminalActionManager, registerTerminalActions } from './TerminalActionManager';

function pressShortcut(label: string, target: Element): boolean {
  const parts = label.split('+').map((part) => part.trim().toLowerCase());
  const key = parts[parts.length - 1];
  return target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      ctrlKey: parts.includes('ctrl'),
      shiftKey: parts.includes('shift'),
      altKey: parts.includes('alt'),
      metaKey: parts.includes('meta') || parts.includes('cmd'),
      bubbles: true,
      cancelable: true,
    }),
  );
}

function terminalContext(): TerminalContext {
  return {
    type: ContextType.TERMINAL,
    terminalId: 'terminal-1',
    hasSelection: false,
  };
}

describe('terminal select-all shortcut', () => {
  let target: HTMLElement;
  let terminal: { selectAll: ReturnType<typeof vi.fn>; getSelection: () => string; paste: () => void; modes: Record<string, never> };

  beforeEach(() => {
    mocks.handlers.clear();

    const container = document.createElement('div');
    container.setAttribute('data-terminal-id', 'terminal-1');
    target = document.createElement('span');
    container.appendChild(target);
    document.body.appendChild(container);

    terminal = { selectAll: vi.fn(), getSelection: () => '', paste: vi.fn(), modes: {} };
    registerTerminalActions('terminal-1', { getTerminal: () => terminal as never });
  });

  afterEach(() => {
    terminalActionManager.destroy();
    document.body.innerHTML = '';
  });

  it('advertises a shortcut that really selects all', async () => {
    const items = await new TerminalMenuProvider().getMenuItems(terminalContext());
    const selectAll = items.find((item) => item.id === 'terminal-select-all');

    expect(selectAll?.shortcut).toBe('Ctrl+Shift+A');

    pressShortcut(selectAll!.shortcut!, target);

    expect(terminal.selectAll).toHaveBeenCalledTimes(1);
  });

  it('leaves Ctrl+A to the shell instead of selecting the scrollback', () => {
    const notPrevented = pressShortcut('Ctrl+A', target);

    expect(terminal.selectAll).not.toHaveBeenCalled();
    expect(notPrevented).toBe(true);
  });
});
