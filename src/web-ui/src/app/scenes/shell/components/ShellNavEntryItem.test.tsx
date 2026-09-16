// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import ShellNavEntryItem from './ShellNavEntryItem';
import type { ShellEntry } from '../hooks/shellEntryTypes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('keeps opening, quick actions and the context menu independent in a two-line entry', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onOpen = vi.fn(async () => undefined);
  const quickAction = vi.fn();
  const onContext = vi.fn();
  const entry = { sessionId: 'shell-1', name: 'Development', cwd: '/srv/project', isRunning: true } as ShellEntry;
  try {
    act(() => root.render(<ShellNavEntryItem
      entry={entry} isActive showSavedBadge={false}
      startupCommandBadgeLabel="Command" savedBadgeLabel="Saved"
      quickAction={{ icon: '×', title: 'Stop', onClick: quickAction }}
      getEntryMenuItems={() => [{ id: 'stop', label: 'Stop' }]}
      onOpen={onOpen} onOpenContextMenu={onContext}
    />));
    const primary = container.querySelector<HTMLButtonElement>('[data-openbitfun-part="trigger"]')!;
    const stop = container.querySelector<HTMLButtonElement>('[aria-label="Stop"]')!;
    expect(container.querySelector('button button')).toBeNull();
    expect(primary.textContent).toContain('/srv/project');
    expect(primary.getAttribute('aria-current')).toBe('page');
    act(() => primary.click());
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(entry);
    act(() => {
      stop.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      stop.click();
    });
    expect(quickAction).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    act(() => primary.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 70, clientY: 90 })));
    expect(onContext).toHaveBeenCalledTimes(1);
    expect(onContext.mock.calls[0][2]).toEqual({ entry });
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
