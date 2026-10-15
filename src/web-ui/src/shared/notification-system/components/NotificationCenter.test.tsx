// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRecord } from '../types';
import {
  useAllLoadingNotifications,
  useAllProgressNotifications,
  useCenterOpen,
  useNotificationHistory,
} from '../hooks/useNotificationState';
import { NotificationCenter } from './NotificationCenter';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../hooks/useNotificationState', () => ({
  useAllLoadingNotifications: vi.fn(),
  useAllProgressNotifications: vi.fn(),
  useCenterOpen: vi.fn(),
  useNotificationHistory: vi.fn(),
}));

vi.mock('../services/NotificationService', () => ({
  notificationService: {
    clearHistory: vi.fn(),
    deleteFromHistory: vi.fn(),
    markAllAsRead: vi.fn(),
    markAsRead: vi.fn(),
    toggleCenter: vi.fn(),
  },
}));

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({
    formatDate: () => '12:00',
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}:${String(options.count)}` : key,
  }),
}));

vi.mock('@/component-library', () => ({
  Modal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) => (
    isOpen ? <>{children}</> : null
  ),
  Search: ({
    inputTestId,
    onChange,
    value,
  }: {
    inputTestId?: string;
    onChange: (value: string) => void;
    value: string;
  }) => (
    <input
      data-testid={inputTestId}
      value={value}
      onChange={event => onChange(event.target.value)}
    />
  ),
}));

const makeNotification = (
  id: string,
  overrides: Partial<NotificationRecord> = {},
): NotificationRecord => ({
  id,
  message: `Message ${id}`,
  read: true,
  status: 'completed',
  timestamp: Date.now(),
  title: `Title ${id}`,
  type: 'info',
  variant: 'toast',
  ...overrides,
});

describe('NotificationCenter', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    vi.mocked(useCenterOpen).mockReturnValue(true);
    vi.mocked(useNotificationHistory).mockReturnValue([
      makeNotification('first'),
      makeNotification('second'),
    ]);
    vi.mocked(useAllProgressNotifications).mockReturnValue([]);
    vi.mocked(useAllLoadingNotifications).mockReturnValue([]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it('keeps only the most recently selected notification expanded', () => {
    act(() => root.render(<NotificationCenter />));

    const first = container.querySelector<HTMLElement>('[data-notification-id="first"]');
    const second = container.querySelector<HTMLElement>('[data-notification-id="second"]');

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="notification-item-expand-first"]')?.click();
    });
    expect(first?.classList.contains('is-expanded')).toBe(true);
    expect(second?.classList.contains('is-expanded')).toBe(false);
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="notification-item-expand-first"]',
    )?.title).toBe('common:actions.collapse');

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="notification-item-expand-second"]')?.click();
    });
    expect(first?.classList.contains('is-expanded')).toBe(false);
    expect(second?.classList.contains('is-expanded')).toBe(true);
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="notification-item-expand-first"]',
    )?.title).toBe('common:actions.expand');
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="notification-item-expand-second"]',
    )?.title).toBe('common:actions.collapse');
  });

  it('shows per-category counts and keeps the all count stable across filters', () => {
    vi.mocked(useNotificationHistory).mockReturnValue([
      makeNotification('error-1', { type: 'error' }),
      makeNotification('error-2', { type: 'error' }),
      makeNotification('warning-1', { type: 'warning' }),
      makeNotification('info-1', { type: 'info' }),
      makeNotification('success-1', { type: 'success' }),
    ]);

    const getFilterText = (testId: string): string =>
      container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.textContent ?? '';

    act(() => root.render(<NotificationCenter />));

    expect(getFilterText('notification-filter-all')).toBe('components:notificationCenter.filters.all:5');
    expect(getFilterText('notification-filter-error')).toBe('components:notificationCenter.filters.error:2');
    expect(getFilterText('notification-filter-warning')).toBe('components:notificationCenter.filters.warning:1');
    expect(getFilterText('notification-filter-info')).toBe('components:notificationCenter.filters.info:2');

    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="notification-filter-error"]')?.click();
    });

    expect(getFilterText('notification-filter-all')).toBe('components:notificationCenter.filters.all:5');
  });

  it('keeps raw diagnostic metadata separate from translated notification text', () => {
    const rawError = 'The pull request contains no reviewable changed files.';
    vi.mocked(useNotificationHistory).mockReturnValue([{
      ...makeNotification('raw'), message: 'translated notification',
      metadata: { diagnostics: 'category=review', rawError },
    }]);
    act(() => root.render(<NotificationCenter />));
    expect(container.querySelector('[data-notification-id="raw"]')
      ?.getAttribute('data-notification-diagnostics')).toBe(`category=review\nraw_error=${rawError}`);
  });
});
