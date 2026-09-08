// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WeixinLoginProgress } from './WeixinLoginProgress';

vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe('WeChat login progress', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  it('explains a slow long poll without reporting a failed connection', async () => {
    await act(async () => root.render(<WeixinLoginProgress phase="scan" />));
    expect(container.textContent).toContain('botWeixinPolling');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(container.textContent).toContain('botWeixinSyncSlow');
    expect(container.textContent).not.toContain('stateConnected');
  });

  it('updates the phase after phone confirmation and resets stale delay copy', async () => {
    await act(async () => root.render(<WeixinLoginProgress phase="confirm" />));
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(container.textContent).toContain('botWeixinSyncSlow');
    await act(async () => root.render(<WeixinLoginProgress phase="starting" />));
    expect(container.textContent).toContain('botWeixinStarting');
    expect(container.textContent).not.toContain('botWeixinSyncSlow');
    await act(async () => vi.advanceTimersByTime(10_000));
    expect(container.textContent).toContain('botWeixinStartingSlow');
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
  });
});
