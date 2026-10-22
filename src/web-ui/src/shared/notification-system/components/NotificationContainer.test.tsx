import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '@bitfun/ui';

import type { Notification } from '../types';
import { useActiveNotifications } from '../hooks/useNotificationState';
import { notificationService } from '../services/NotificationService';
import { NotificationContainer } from './NotificationContainer';

vi.mock('../hooks/useNotificationState', () => ({
  useActiveNotifications: vi.fn(),
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../services/NotificationService', () => ({
  notificationService: { dismiss: vi.fn() },
}));

const modalOverlay = vi.hoisted(() => ({ open: false }));

vi.mock('@bitfun/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@bitfun/ui')>()),
  useHasModalOverlay: () => modalOverlay.open,
}));

vi.mock('./ProgressNotification', () => ({
  ProgressNotification: ({ notification }: { notification: Notification }) => (
    <div data-variant="progress">{notification.message}</div>
  ),
}));

vi.mock('./LoadingNotification', () => ({
  LoadingNotification: ({ notification }: { notification: Notification }) => (
    <div data-variant="loading">{notification.message}</div>
  ),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const notification = (variant: Notification['variant'], message: string): Notification => ({
  id: `${variant}-${message}`,
  type: 'info',
  variant,
  title: 'Test',
  message,
  timestamp: 1,
  status: 'active',
});

describe('NotificationContainer', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    modalOverlay.open = false;
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
    });
    globalThis.window = dom.window as unknown as Window & typeof globalThis;
    globalThis.document = dom.window.document;
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    container = document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
    vi.clearAllMocks();
    dom.window.close();
    vi.unstubAllGlobals();
  });

  it('keeps task notifications in the notification center instead of the toast stack', () => {
    vi.mocked(useActiveNotifications).mockReturnValue([
      notification('toast', 'Saved'),
      notification('progress', 'Indexing'),
      notification('loading', 'Connecting'),
    ]);

    act(() => root.render(<NotificationContainer />));

    expect(document.querySelector('.notification-item')?.textContent).toContain('Saved');
    expect(document.querySelector('[data-variant="progress"]')).toBeNull();
    expect(document.querySelector('[data-variant="loading"]')).toBeNull();
  });

  it('keeps silent notifications out of the toast stack', () => {
    vi.mocked(useActiveNotifications).mockReturnValue([notification('silent', 'Background')]);

    act(() => root.render(<NotificationContainer />));

    expect(document.querySelector('.notification-container')).toBeNull();
  });

  it('retains a dismissed toast until its exit motion completes', () => {
    vi.useFakeTimers();
    vi.mocked(useActiveNotifications).mockReturnValue([notification('toast', 'Saved')]);

    act(() => root.render(<NotificationContainer />));
    expect(document.querySelector('.notification-item')?.textContent).toContain('Saved');

    vi.mocked(useActiveNotifications).mockReturnValue([]);
    act(() => root.render(<NotificationContainer />));

    expect(document.querySelector('.notification-container__presence--exiting')).not.toBeNull();
    expect(document.querySelector('.notification-item')?.textContent).toContain('Saved');

    act(() => vi.advanceTimersByTime(140));
    expect(document.querySelector('.notification-container')).toBeNull();
  });

  it('removes focus before making an exiting real notification item inert', () => {
    vi.useFakeTimers();
    vi.mocked(useActiveNotifications).mockReturnValue([{
      ...notification('toast', 'Action required'),
      closable: true,
      actions: [{ label: 'Retry', onClick: vi.fn() }],
    }]);

    act(() => root.render(<NotificationContainer />));
    const action = document.querySelector('.notification-item__actions [data-bitfun-component="button"]') as HTMLButtonElement;
    action.focus();
    expect(document.activeElement).toBe(action);

    vi.mocked(useActiveNotifications).mockReturnValue([]);
    act(() => root.render(<NotificationContainer />));

    const presence = document.querySelector('.notification-container__presence--exiting');
    expect(document.activeElement).not.toBe(action);
    expect(presence?.getAttribute('aria-hidden')).toBe('true');
    expect(presence?.hasAttribute('inert')).toBe(true);
    expect(presence?.querySelector('.notification-item')).not.toBeNull();
  });

  it('dismisses a toast once its duration elapses', () => {
    vi.useFakeTimers();
    const toast = { ...notification('toast', 'Saved'), duration: 1000 };
    vi.mocked(useActiveNotifications).mockReturnValue([toast]);

    act(() => root.render(<NotificationContainer />));

    act(() => vi.advanceTimersByTime(999));
    expect(notificationService.dismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(notificationService.dismiss).toHaveBeenCalledWith(toast.id);
  });

  it('keeps a toast without a duration open until it is dismissed explicitly', () => {
    vi.useFakeTimers();
    const toast = { ...notification('toast', 'Saved'), duration: 0 };
    vi.mocked(useActiveNotifications).mockReturnValue([toast]);

    act(() => root.render(<NotificationContainer />));

    act(() => vi.advanceTimersByTime(60000));
    expect(notificationService.dismiss).not.toHaveBeenCalled();
  });

  it('holds toast expiry while a modal overlay is open and resumes with the remaining time', () => {
    vi.useFakeTimers();
    const toast = { ...notification('toast', 'Saved'), duration: 1000 };
    vi.mocked(useActiveNotifications).mockReturnValue([toast]);

    act(() => root.render(<NotificationContainer />));
    act(() => vi.advanceTimersByTime(400));

    modalOverlay.open = true;
    act(() => root.render(<NotificationContainer />));
    act(() => vi.advanceTimersByTime(5000));
    expect(notificationService.dismiss).not.toHaveBeenCalled();

    modalOverlay.open = false;
    act(() => root.render(<NotificationContainer />));
    act(() => vi.advanceTimersByTime(599));
    expect(notificationService.dismiss).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(notificationService.dismiss).toHaveBeenCalledWith(toast.id);
  });

  it('keeps a modal-time toast close control interactive above the modal', () => {
    vi.useFakeTimers();
    const toast = { ...notification('toast', 'Install failed'), closable: true };
    vi.mocked(useActiveNotifications).mockReturnValue([toast]);

    const render = (modalOpen: boolean) => act(() => root.render(<>
      <NotificationContainer />
      <Dialog open={modalOpen} onOpenChange={() => undefined}>
        <button>Manage ACP</button>
      </Dialog>
    </>));

    render(true);
    const close = document.querySelector<HTMLButtonElement>('[aria-label="actions.close"]');
    expect(close).not.toBeNull();
    expect(close?.closest('[data-bitfun-overlay-layer]')?.hasAttribute('inert')).toBe(false);

    act(() => close?.click());
    expect(notificationService.dismiss).toHaveBeenCalledWith(toast.id);
  });
});
