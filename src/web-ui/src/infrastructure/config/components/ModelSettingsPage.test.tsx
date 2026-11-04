// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIModelConfig } from '../types';
import type { SubscriptionAccount } from '@/infrastructure/api/service-api/AIApi';
import { i18nService } from '@/infrastructure/i18n';
import { activateSurface, resetDeviceSurfaceForTest } from '@/infrastructure/peer-device/deviceSurface';

const mocks = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  watchers: new Map<string, () => void>(),
  configChanged: (_path: string) => {},
  getConfig: vi.fn(), getOptionalConfig: vi.fn(), getConfigs: vi.fn(), updateConfig: vi.fn(), setConfig: vi.fn(),
  listAccounts: vi.fn(), listModels: vi.fn(), testConnection: vi.fn(),
  notification: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock('../services/ConfigManager', () => ({
  ConfigConflictError: class ConfigConflictError extends Error {},
  configManager: {
    hasCachedConfig: (path: string) => path in mocks.values,
    getCachedConfig: (path: string) => mocks.values[path],
    getConfig: mocks.getConfig, getOptionalConfig: mocks.getOptionalConfig, getConfigs: mocks.getConfigs,
    updateConfig: mocks.updateConfig, setConfig: mocks.setConfig,
    watch: (path: string, listener: () => void) => {
      mocks.watchers.set(path, listener);
      return () => { mocks.watchers.delete(path); };
    },
    onConfigChange: (listener: (path: string) => void) => { mocks.configChanged = listener; return () => {}; },
  },
}));
vi.mock('@/infrastructure/api', () => ({
  aiApi: {
    getModelCatalog: async () => ({ models: [], provider_catalog: { providers: [] } }),
    getModelsDevCatalogStatus: async () => { throw new Error('Unavailable'); },
    onModelCatalogUpdated: () => () => {},
    listSubscriptionAccounts: mocks.listAccounts,
    listModelsByConfig: mocks.listModels,
    testAIConfigConnection: mocks.testConnection,
  },
  systemAPI: {},
}));
vi.mock('@/shared/notification-system', () => ({ useNotification: () => mocks.notification, notificationService: mocks.notification }));
vi.mock('@/shared/utils/logger', () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('@/infrastructure/runtime', () => ({ isTauriRuntime: () => false }));
vi.mock('@/infrastructure/peer-device/peerModeFlag', () => ({ isPeerDeviceModeActive: () => false }));
vi.mock('@/infrastructure/peer-device/peerDeviceContextState', () => ({ usePeerDeviceModeOptional: () => null }));
vi.mock('@/infrastructure/peer-device/deviceSurface', async importOriginal => ({ ...await importOriginal<typeof import('@/infrastructure/peer-device/deviceSurface')>(), getActiveSurfaceScope: () => ({ isCurrent: () => true, assertCurrent: () => {}, key: (value: string) => value }) }));
vi.mock('./ReasoningConfigPanel', () => ({ default: () => null }));
vi.mock('./LocalModelManagerInline', () => ({ default: () => <div data-testid="local-model-manager" /> }));
import ModelSettingsPage from './ModelSettingsPage';

const model = (id: string, overrides: Partial<AIModelConfig> = {}): AIModelConfig => ({
  id, name: 'Provider', model_name: id, provider: 'openai', base_url: 'https://example.test/v1', api_key: 'fixture-key',
  enabled: true, category: 'general_chat', capabilities: ['text_chat', 'function_calling'], context_window: 128000,
  metadata: { provider_instance_id: 'connection-a' }, ...overrides,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const copy = (key: string) => String(i18nService.getI18nInstance().t(key, { ns: 'settings/models' }));
const button = (text: string, parent: ParentNode = document) => [...parent.querySelectorAll<HTMLButtonElement>('button')]
  .find(element => element.textContent === text || element.getAttribute('aria-label') === text)!;
const byTestId = <T extends HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`)!;
const click = (element: HTMLElement) => act(async () => element.click());
const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => act(async () => {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('model settings edits', () => {
  let root: Root;
  let host: HTMLDivElement;
  beforeAll(async () => {
    await Promise.all(['settings/models', 'settings/default-model', 'components'].map(name => i18nService.loadNamespace(name)));
  });
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    mocks.watchers.clear();
    resetDeviceSurfaceForTest();
    mocks.values = {
      'ai.models': [
        model('alpha', { custom_headers: { 'X-Model': 'alpha' }, custom_request_body: '{"temperature":0.2}', recommended_for: ['code'], metadata: { provider_instance_id: 'connection-a', user_tags: ['reasoning'], independent: 'alpha' } }),
        model('beta', { custom_headers: { 'X-Model': 'beta' }, skip_ssl_verify: true, custom_request_body: '{"temperature":0.8}', recommended_for: ['titles'], metadata: { provider_instance_id: 'connection-a', user_tags: ['quick'], independent: 'beta' } }),
      ],
      'ai.default_models': { primary: 'beta', fast: 'alpha', image_understanding: null, speech_recognition: null },
      'ai.proxy': { enabled: false, url: '', username: '', password: '' },
      'ai.stream_idle_timeout_secs': null,
      'ai.stream_ttft_timeout_secs': null,
    };
    mocks.getConfig.mockImplementation(async path => mocks.values[path]);
    mocks.getOptionalConfig.mockImplementation(async path => mocks.values[path]);
    mocks.getConfigs.mockImplementation(async paths => Object.fromEntries(paths.map((path: string) => [path, mocks.values[path]])));
    mocks.updateConfig.mockImplementation(async (path, update) => {
      const saved = update(structuredClone(mocks.values[path]));
      mocks.values[path] = saved;
      return saved;
    });
    mocks.listAccounts.mockResolvedValue([]);
    mocks.listModels.mockResolvedValue([{ id: 'free-model', routing: { format: 'openai', base_url: 'https://opencode.ai/zen/v1', request_url: 'https://opencode.ai/zen/v1/chat/completions' } }]);
    mocks.testConnection.mockResolvedValue({ success: true, message: 'Connected' });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
  const render = () => act(async () => root.render(<ModelSettingsPage />));
  const openProvider = () => click(button('Provider', document.querySelector('.bitfun-model-settings__provider-connections')!));
  const save = () => click(byTestId('settings-model-save-btn'));
  const openCustom = async () => {
    await click(byTestId('ai-model-add-provider-btn'));
    await click(byTestId('settings-model-custom-config-btn'));
    await type(byTestId<HTMLInputElement>('settings-model-provider-name-input'), 'New provider');
  };

  it.each(['ai.models', 'ai.proxy.url', 'ai.stream_idle_timeout_secs', 'ai.stream_ttft_timeout_secs', 'surface'])(
    'invalidates displayed and pending connection results after %s changes', async changed => {
      await render();
      const testButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
        .filter(item => item.getAttribute('aria-label') === copy('actions.test'));
      await click(testButtons()[0]);
      expect(host.querySelector('[data-testid="settings-model-test-status"][data-status="success"]')).not.toBeNull();
      const pending = deferred<{ success: boolean; message: string }>();
      mocks.testConnection.mockReturnValueOnce(pending.promise);
      await click(testButtons()[1]);
      expect(host.querySelector('[data-status="testing"]')).not.toBeNull();
      await act(async () => {
        if (changed === 'surface') activateSurface('peer-b');
        else {
          if (changed === 'ai.models') {
            mocks.values['ai.models'] = (mocks.values['ai.models'] as AIModelConfig[])
              .map(item => ({ ...item, base_url: 'https://edited.test/v1' }));
          }
          mocks.configChanged(changed);
          mocks.watchers.get(changed)?.();
        }
      });
      expect(host.querySelector('[data-testid="settings-model-test-status"]')).toBeNull();
      if (changed === 'ai.models') {
        await openProvider();
        expect(byTestId<HTMLInputElement>('settings-model-base-url-input').value).toBe('https://edited.test/v1');
      }
      await act(async () => pending.resolve({ success: true, message: 'Late result' }));
      expect(host.querySelector('[data-testid="settings-model-test-status"]')).toBeNull();
    },
  );

  it('changes a connection without copying its first model request parameters or annotations to siblings', async () => {
    const original = structuredClone(mocks.values['ai.models'] as AIModelConfig[]);
    await render();
    expect(mocks.getConfig).not.toHaveBeenCalled();
    expect(mocks.getConfigs).not.toHaveBeenCalled();
    await openProvider();
    expect(byTestId('settings-model-provider-readonly').textContent).toBe('Provider');
    expect(byTestId('settings-model-provider-name-input')).toBeNull();
    await type(byTestId<HTMLInputElement>('settings-model-base-url-input'), 'https://changed.test/v1');
    await save();
    const saved = mocks.values['ai.models'] as AIModelConfig[];
    for (const [index, item] of saved.entries()) {
      expect(item.base_url).toBe('https://changed.test/v1');
      expect(item.custom_headers).toEqual(original[index].custom_headers);
      expect(item.custom_request_body).toBe(original[index].custom_request_body);
      expect(item.skip_ssl_verify).toBe(original[index].skip_ssl_verify ?? false);
      expect(item.metadata).toEqual(original[index].metadata);
      expect(item.recommended_for).toEqual(original[index].recommended_for);
    }
    expect(mocks.updateConfig.mock.calls[0][2]).toEqual({ expectedValue: original });
  });

  it('edits request options for one provider model and rejects a duplicate name before saving', async () => {
    await render(); await openProvider();
    const advancedBefore = byTestId('settings-model-advanced-toggle').querySelector('[aria-expanded]')?.getAttribute('aria-expanded');
    const editBeta = () => click(document.querySelector('[data-testid="settings-model-selected-row"][data-model-name="beta"] [data-testid="settings-model-capsule-edit"]')!);
    await editBeta();
    await type(document.querySelector<HTMLTextAreaElement>('textarea')!, '{"temperature":0.9}');
    await click(button(copy('actions.cancel'), document.querySelector('[role="dialog"]')!));
    expect(byTestId('settings-model-advanced-toggle').querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe(advancedBefore);
    await editBeta();
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('{"temperature":0.8}');
    await type(byTestId<HTMLInputElement>('settings-model-name-input'), 'alpha');
    await save();
    expect(mocks.notification.warning).toHaveBeenCalledWith(copy('messages.duplicateModelNameUnderProvider'));
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    await type(byTestId<HTMLInputElement>('settings-model-name-input'), 'beta');
    expect(document.querySelector('textarea')).not.toBeNull();
    await type(document.querySelector<HTMLTextAreaElement>('textarea')!, '{"temperature":0.5}');
    await save(); await save();
    const saved = mocks.values['ai.models'] as AIModelConfig[];
    expect(saved.map(item => item.custom_request_body)).toEqual(['{"temperature":0.2}', '{"temperature":0.5}']);
  });

  it('merges a new connection into the latest model list and allocates an unused identity', async () => {
    await render(); await openCustom();
    await save();
    expect(document.querySelector('[role="dialog"] [data-bitfun-part="fieldStatus"]')).not.toBeNull();
    expect(byTestId('settings-model-api-key-input').getAttribute('aria-invalid')).toBe('true');
    expect(mocks.updateConfig).not.toHaveBeenCalled();
    await type(byTestId<HTMLInputElement>('settings-model-api-key-input'), 'new-key');
    await click(byTestId('settings-model-add-custom-btn'));
    await type(byTestId<HTMLInputElement>('settings-model-manual-name-input'), 'shared-name');
    await act(async () => byTestId('settings-model-manual-name-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(byTestId('settings-model-manual-name-input')).toBeNull();
    expect(byTestId('settings-model-capsule-edit')?.textContent).toBe('shared-name');
    const concurrent = model('shared-name', { name: 'Other connection', metadata: { provider_instance_id: 'other' } });
    mocks.values['ai.models'] = [...mocks.values['ai.models'] as AIModelConfig[], concurrent];
    await save();
    const saved = mocks.values['ai.models'] as AIModelConfig[];
    expect(saved).toContainEqual(concurrent);
    expect(saved).toHaveLength(4);
    expect(new Set(saved.map(item => item.id)).size).toBe(4);
    expect(saved.at(-1)?.name).toBe('New provider');
    expect(saved.at(-1)?.context_window).toBe(300000);
    expect(mocks.updateConfig.mock.calls[0][2]).toBeUndefined();
  });

  it('prioritizes defaults and searches their roles and user tags without loading defaults twice', async () => {
    await render();
    const cards = () => [...document.querySelectorAll('[data-testid="settings-model-row"]')].map(item => item.getAttribute('data-model-name'));
    expect(cards()).toEqual(['beta', 'alpha']);
    await type(document.querySelector<HTMLInputElement>('.bitfun-model-settings__pool-toolbar input')!, 'quick');
    expect(cards()).toEqual(['beta']);
    const role = String(i18nService.getI18nInstance().t('core.fast.label', { ns: 'settings/default-model' }));
    await type(document.querySelector<HTMLInputElement>('.bitfun-model-settings__pool-toolbar input')!, role);
    expect(cards()).toEqual(['alpha']);
    await type(document.querySelector<HTMLInputElement>('.bitfun-model-settings__pool-toolbar input')!, 'no-such-model');
    await click(button(copy('pool.clearFilter')));
    expect(cards()).toEqual(['beta', 'alpha']);
  });

  it('opens per-model connection details inside the provider manager', async () => {
    await render();
    await click(button(copy('pool.manageConnections')));
    await click(document.querySelector('.bitfun-model-settings__provider-group-toggle')!);
    const row = document.querySelector('[role="dialog"] [data-testid="settings-model-row"]')!;
    await click(row.querySelector<HTMLButtonElement>('.bitfun-collection-item__details-toggle')!);
    expect(row.querySelector('[data-bitfun-part="modelDetails"]')?.textContent).toContain('https://example.test/v1');
    expect(row.querySelector('[aria-expanded="true"]')).not.toBeNull();
  });

  it('uses the public Zen credential for discovery and saves an anonymous free-model connection', async () => {
    await render(); await openCustom();
    await type(byTestId<HTMLInputElement>('settings-model-base-url-input'), 'https://opencode.ai/zen/v1');
    await click(byTestId('settings-model-select'));
    expect(mocks.listModels).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'public' }));
    await click(byTestId('settings-model-option'));
    await click(button(copy('actions.done')));
    await save();
    const saved = (mocks.values['ai.models'] as AIModelConfig[]).at(-1)!;
    expect(saved).toMatchObject({ name: 'New provider', model_name: 'free-model', api_key: 'public' });
  });

  it('keeps subscription identity together with a separate management action', async () => {
    mocks.values['ai.models'] = [model('alpha', { auth: { type: 'subscription', provider: 'codex' } })];
    await render();
    await click(button('Provider'));
    const account = byTestId('settings-model-subscription-account');
    expect(account.children).toHaveLength(2);
    expect(account.querySelector('.bitfun-model-settings__subscription-account-heading')?.textContent)
      .toContain(copy('subscriptionAuth.accountUnavailable'));
    const manage = button(copy('subscriptionAuth.manageAccount'), account);
    expect(manage.parentElement?.className).toBe('bitfun-model-settings__subscription-account-actions');
    await click(manage);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });

  it('refreshes subscription accounts on focus and ignores an older response after a failed newer refresh', async () => {
    await render();
    const stale = deferred<SubscriptionAccount[]>();
    mocks.listAccounts.mockReturnValueOnce(stale.promise).mockRejectedValueOnce(new Error('Offline'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(document.body.textContent).toContain(copy('acquisition.loadFailed'));
    await act(async () => stale.resolve([]));
    expect(document.body.textContent).toContain(copy('acquisition.loadFailed'));
    expect(document.querySelectorAll('[data-testid="settings-model-row"]')).toHaveLength(2);
    mocks.listAccounts.mockResolvedValueOnce([]);
    await click(button(copy('messages.retry')));
    expect(document.body.textContent).not.toContain(copy('acquisition.loadFailed'));
  });
});
