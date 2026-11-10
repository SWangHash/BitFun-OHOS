// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivacyStatus } from '@/infrastructure/api/service-api/PrivacyAPI';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(), accept: vi.fn(), enterNotAccepted: vi.fn(),
  showGateWindow: vi.fn(), hideStartupOverlay: vi.fn(),
}));
vi.mock('@/infrastructure/api/service-api/PrivacyAPI', async original => ({
  ...await original<typeof import('@/infrastructure/api/service-api/PrivacyAPI')>(),
  privacyAPI: { ...mocks, getStatus: mocks.initialize, applyCollectionPolicy: mocks.initialize },
}));
vi.mock('@/infrastructure/runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('@/app/startup/startupOverlay', () => ({ hideStartupOverlay: mocks.hideStartupOverlay }));
vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, currentLanguage: 'zh-CN', formatDate: String }),
}));
vi.mock('./PrivacyDocument', () => ({ PrivacyDocument: ({ content }: { content: string }) => <p>{content}</p> }));

import { PrivacyProvider } from './PrivacyContext';
import { PrivacyGate } from './PrivacyGate';

const choice: PrivacyStatus = {
  enabled: true, lifecycleState: 'choice_required', effectiveMode: 'privacy_not_accepted',
  releaseReady: true, hasUnreadUpdate: false,
  policy: { consentVersion: '4', changeType: 'editorial', effectiveAt: '2026-07-30T00:00:00Z',
    updatedAt: '2026-08-21T00:00:00Z', locale: 'zh-CN', documentSha256: 'policy-hash', content: 'Privacy statement' },
};

describe('first launch privacy presentation', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: false }));
    mocks.initialize.mockResolvedValue(choice);
    mocks.accept.mockResolvedValue({ ...choice, lifecycleState: 'full', effectiveMode: 'full' });
    mocks.enterNotAccepted.mockResolvedValue({ ...choice, lifecycleState: 'privacy_not_accepted' });
    mocks.hideStartupOverlay.mockResolvedValue(undefined);
    mocks.showGateWindow.mockResolvedValue(undefined);
    container = document.createElement('div'); document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll('[data-bitfun-overlay-host]').forEach(node => node.remove());
    container.remove(); vi.unstubAllGlobals();
  });
  const render = async () => act(async () => root.render(
    <PrivacyProvider><PrivacyGate><span>Workbench</span></PrivacyGate></PrivacyProvider>,
  ));

  it('shows the first-launch statement after asynchronous initialization without blocking the workbench', async () => {
    let resolve!: (status: PrivacyStatus) => void;
    mocks.initialize.mockImplementation(() => new Promise(value => { resolve = value; }));
    await render();
    expect(container.textContent).toContain('Workbench');
    expect(document.querySelector('[data-bitfun-component="privacy-gate"][data-bitfun-part="document"]')).toBeNull();
    await act(async () => resolve(choice));
    expect(document.querySelector('[data-bitfun-component="privacy-gate"][data-bitfun-part="document"]')?.textContent).toContain('Privacy statement');
    expect(mocks.initialize).toHaveBeenCalledOnce();
    expect(mocks.hideStartupOverlay).toHaveBeenCalledOnce();
    expect(mocks.showGateWindow).toHaveBeenCalledOnce();
    expect(mocks.accept).not.toHaveBeenCalled();
  });

  it.each(['full', 'privacy_not_accepted'] as const)('preserves the saved %s choice without showing first-launch consent again', async lifecycleState => {
    mocks.initialize.mockResolvedValue({ ...choice, lifecycleState,
      effectiveMode: lifecycleState === 'full' ? 'full' : 'privacy_not_accepted' });
    await render();
    expect(document.querySelector('[data-bitfun-component="privacy-gate"][data-bitfun-part="document"]')).toBeNull();
    expect(mocks.showGateWindow).not.toHaveBeenCalled();
  });

  it('saves the displayed policy only after the user checks consent and agrees', async () => {
    await render();
    const agree = document.querySelector<HTMLButtonElement>('[data-testid="privacy-accept"]')!;
    expect(agree.disabled).toBe(true);
    await act(async () => document.querySelector<HTMLInputElement>('[data-testid="privacy-consent-checkbox"]')!.click());
    expect(agree.disabled).toBe(false);
    await act(async () => agree.click());
    expect(mocks.accept).toHaveBeenCalledExactlyOnceWith({ policyUpdatedAt: choice.policy!.updatedAt,
      consentVersion: '4', documentSha256: 'policy-hash', locale: 'zh-CN' });
    expect(mocks.enterNotAccepted).not.toHaveBeenCalled();
  });

  it('records refusal while keeping the workbench available', async () => {
    await render();
    const refuse = [...document.querySelectorAll('button')].find(button => button.textContent === 'privacy.gateDisagree')!;
    await act(async () => refuse.click());
    expect(mocks.enterNotAccepted).toHaveBeenCalledExactlyOnceWith('zh-CN');
    expect(mocks.accept).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Workbench');
  });

  it('surfaces initialization failure and offers retry', async () => {
    mocks.initialize.mockRejectedValueOnce(new Error('Host unavailable'));
    await render();
    expect(document.body.textContent).toContain('privacy.gateRetry');
    expect(mocks.showGateWindow).toHaveBeenCalled();
    const retry = [...document.querySelectorAll('button')].find(button => button.textContent === 'privacy.gateRetry')!;
    await act(async () => retry.click());
    expect(document.querySelector('[data-bitfun-component="privacy-gate"][data-bitfun-part="document"]')?.textContent).toContain('Privacy statement');
  });
});
