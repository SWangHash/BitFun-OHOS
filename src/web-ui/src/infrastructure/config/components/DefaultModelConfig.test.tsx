// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DefaultModelConfig from './DefaultModelConfig';
import type { AIModelConfig } from '../types';

const mocks = vi.hoisted(() => ({
  getConfigs: vi.fn(),
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  watchers: new Map<string, () => void>(),
  success: vi.fn(),
  error: vi.fn(),
  t: (key: string) => key,
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
vi.mock('../services/ConfigManager', () => ({ configManager: {
  getConfigs: mocks.getConfigs,
  getConfig: mocks.getConfig,
  setConfig: mocks.setConfig,
  watch: (path: string, callback: () => void) => {
    mocks.watchers.set(path, callback);
    return () => mocks.watchers.delete(path);
  },
} }));
vi.mock('@/shared/notification-system', () => ({ notificationService: {
  success: mocks.success,
  error: mocks.error,
} }));
vi.mock('./ModelSelectPresentation', () => ({
  useModelSelectPresentation: () => ({
    buildModelOption: (model: { id: string; model_name: string }) => ({
      label: model.model_name,
      value: model.id,
    }),
  }),
}));
vi.mock('@bitfun/ui', () => ({
  Combobox: ({ onValueChange, options, triggerTestId, value }: {
    onValueChange: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    triggerTestId?: string;
    value: string;
  }) => (
    <select data-testid={triggerTestId} value={value} onChange={event => onValueChange(event.currentTarget.value)}>
      <option value="" />
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
  Icon: () => null,
  IconButton: () => null,
  Tooltip: ({ children }: React.PropsWithChildren) => <>{children}</>,
  Spinner: () => <span data-testid="spinner" />,
}));
vi.mock('./common', () => ({
  ConfigEmptyState: ({ description }: { description: React.ReactNode }) => <div>{description}</div>,
  ConfigPageRow: ({ children, label }: React.PropsWithChildren<{ label: React.ReactNode }>) => (
    <label>{label}{children}</label>
  ),
}));

const models: AIModelConfig[] = [
  {
    id: 'model-a', name: 'Provider', provider: 'openai', api_key: '', base_url: 'https://example.test/v1',
    model_name: 'Alpha', enabled: true, category: 'general_chat', capabilities: ['text_chat'],
  },
  {
    id: 'model-b', name: 'Provider', provider: 'openai', api_key: '', base_url: 'https://example.test/v1',
    model_name: 'Beta', enabled: true, category: 'general_chat', capabilities: ['text_chat'],
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}

describe('DefaultModelConfig', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    mocks.watchers.clear();
    mocks.getConfigs.mockResolvedValue({
      'ai.models': models,
      'ai.default_models': { primary: 'model-a' },
    });
    mocks.getConfig.mockResolvedValue({ primary: 'model-b' });
    mocks.setConfig.mockResolvedValue(undefined);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('keeps loaded selectors visible during a background refresh', async () => {
    await act(async () => root.render(<DefaultModelConfig />));
    const refresh = deferred<Record<string, unknown>>();
    mocks.getConfigs.mockReturnValueOnce(refresh.promise);

    await act(async () => {
      mocks.watchers.get('ai.models')?.();
      await Promise.resolve();
    });

    expect(host.querySelector('[data-testid="spinner"]')).toBeNull();
    expect((host.querySelector('[data-testid="default-primary-model-select"]') as HTMLSelectElement).value)
      .toBe('model-a');
    await act(async () => refresh.resolve({
      'ai.models': models,
      'ai.default_models': { primary: 'model-a' },
    }));
  });

  it('echoes a default selection immediately and writes only that slot', async () => {
    await act(async () => root.render(<DefaultModelConfig />));
    const write = deferred<void>();
    mocks.setConfig.mockReturnValueOnce(write.promise);
    const select = host.querySelector('[data-testid="default-primary-model-select"]') as HTMLSelectElement;

    await act(async () => {
      select.value = 'model-b';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(select.value).toBe('model-b');
    expect(mocks.setConfig).toHaveBeenCalledWith('ai.default_models.primary', 'model-b');
    await act(async () => write.resolve());
    expect(mocks.getConfig).toHaveBeenCalledWith('ai.default_models');
    expect(select.value).toBe('model-b');
  });
  it('uses the page snapshot without another read and reports confirmed defaults to the page', async () => {
    const onDefaultModelsChange = vi.fn();
    await act(async () => root.render(<DefaultModelConfig compact models={models}
      defaultModels={{ primary: 'model-a', fast: null, image_understanding: null, speech_recognition: null }}
      loading={false} onDefaultModelsChange={onDefaultModelsChange} />));
    expect(mocks.getConfigs).not.toHaveBeenCalled();
    expect(mocks.watchers.size).toBe(0);
    const select = host.querySelector('[data-testid="default-primary-model-select"]') as HTMLSelectElement;
    await act(async () => { select.value = 'model-b'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onDefaultModelsChange).toHaveBeenCalledWith(expect.objectContaining({ primary: 'model-b' }));
  });

});
