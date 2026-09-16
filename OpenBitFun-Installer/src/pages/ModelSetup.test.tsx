// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ModelSetup } from './ModelSetup';
import { PROVIDER_TEMPLATES, createModelConfigFromTemplate } from '../data/modelProviders';
import type { InstallOptions, RemoteModelInfo } from '../types/installer';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key }),
}));
const initial: InstallOptions = {
  installPath: 'D:\\OpenBitFun', desktopShortcut: false, startMenu: true,
  launchAfterInstall: false, appLanguage: 'en-US', themePreference: 'system', modelConfig: null,
};
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let changed = vi.fn();
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  changed = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});
async function render(options = initial, previewOnly = false) {
  await act(async () => root.render(<ModelSetup previewOnly={previewOnly} options={options} setOptions={changed}
    onSkip={vi.fn()} onNext={vi.fn()} onTestConnection={vi.fn()} />));
}
function trigger(label: string) {
  return container.querySelector<HTMLButtonElement>(`button[role="combobox"][aria-label="${label}"]`)!;
}
function option(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    .find(item => item.getAttribute('aria-label') === label)!;
}

it('uses the shared popup for provider selection and restores focus after Escape', async () => {
  await render();
  const provider = trigger('model.providerLabel');
  expect(provider.closest('[data-openbitfun-component="select"]')).not.toBeNull();
  await act(async () => provider.click());
  expect(document.querySelector('[data-openbitfun-component="select-popup"]')).not.toBeNull();
  await act(async () => option('model.customProvider').click());
  expect(trigger('model.form.provider')).not.toBeNull();
  expect(changed.mock.lastCall![0](initial).modelConfig.provider).toBe('custom');
  await act(async () => trigger('model.form.provider').click());
  await act(async () => option('model.formats.responsesApi').click());
  expect(changed.mock.lastCall![0](initial).modelConfig.format).toBe('responses');
  await act(async () => provider.click());
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(document.querySelector('[data-openbitfun-component="select-popup"]')).toBeNull();
  expect(document.activeElement).toBe(provider);
});

it('retains endpoint notes and applies the selected endpoint format', async () => {
  const template = Object.values(PROVIDER_TEMPLATES).find(item => (item.baseUrlOptions?.length ?? 0) > 1)!;
  await render({ ...initial, modelConfig: createModelConfigFromTemplate(template, null) });
  await act(async () => trigger('model.endpointPreset').click());
  const endpoint = template.baseUrlOptions![1];
  const label = endpoint.noteKey?.split('.').pop() || endpoint.format.toUpperCase();
  const item = option(label);
  expect(item.textContent).toContain(label);
  await act(async () => item.click());
  const config = changed.mock.lastCall![0](initial).modelConfig;
  expect(config.baseUrl).toBe(endpoint.url);
  expect(config.format).toBe(endpoint.format);
});

it('keeps the model popup open while loading and lets the returned model be selected', async () => {
  let resolve!: (models: RemoteModelInfo[]) => void;
  mocks.invoke.mockReturnValue(new Promise<RemoteModelInfo[]>(done => { resolve = done; }));
  const modelConfig = { ...createModelConfigFromTemplate(PROVIDER_TEMPLATES.deepseek, null), apiKey: 'test-key' };
  await render({ ...initial, modelConfig });
  await act(async () => trigger('model.form.modelSelection').click());
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-openbitfun-component="select-popup"]')).not.toBeNull();
  await act(async () => resolve([{ id: 'new-remote-model' }]));
  await act(async () => option('new-remote-model').click());
  expect(changed.mock.lastCall![0](initial).modelConfig.modelName).toBe('new-remote-model');
});

it('keeps native preview from fetching remote models', async () => {
  const modelConfig = { ...createModelConfigFromTemplate(PROVIDER_TEMPLATES.deepseek, null), apiKey: 'test-key' };
  await render({ ...initial, modelConfig }, true);
  await act(async () => trigger('model.form.modelSelection').click());
  expect(document.querySelector('[data-openbitfun-component="select-popup"]')).not.toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalled();
});
