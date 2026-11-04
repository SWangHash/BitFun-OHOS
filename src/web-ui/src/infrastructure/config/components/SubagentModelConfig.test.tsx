// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubagentModelConfig from './SubagentModelConfig';

const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), openScene: vi.fn(), error: vi.fn(), t: (key: string) => key }));
vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: mocks.t }) }));
vi.mock('@/shared/notification-system', () => ({ useNotification: () => ({ error: mocks.error }) }));
vi.mock('@/app/stores/sceneStore', () => ({ useSceneStore: (select: (state: unknown) => unknown) => select({ openScene: mocks.openScene }) }));
vi.mock('../services/ConfigManager', () => ({ configManager: {
  getConfig: mocks.get,
  setConfig: mocks.save, watch: () => () => {},
} }));
vi.mock('./ModelSelectPresentation', () => ({ useModelSelectPresentation: () => ({
  buildModelOption: (model: { id: string }) => ({ value: model.id, label: model.id }),
}) }));
vi.mock('./common', () => ({
  ConfigPageRow: ({ label, children }: React.PropsWithChildren<{ label: React.ReactNode }>) => <div>{label}{children}</div>,
  ConfigRetryState: ({ message, retryLabel, onRetry, loading }: {
    message: string; retryLabel: string; onRetry: () => void; loading: boolean;
  }) => <div role="alert">{message}<button data-testid="subagent-retry" onClick={onRetry} disabled={loading}>{retryLabel}</button></div>,
}));
vi.mock('@/component-library', () => ({ IconButton: ({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button onClick={onClick}>{children}</button> }));
vi.mock('@bitfun/ui', () => ({ Combobox: ({ options, value, onValueChange, disabled }: {
  options: Array<{ value: string; label: string }>; value: string; onValueChange: (value: string) => void; disabled: boolean;
}) => <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));

describe('subagent model settings', () => {
  let container: HTMLDivElement;
  let root: Root;
  const loadedConfig = async (path: string) => path === 'ai.models'
    ? [{ id: 'custom', enabled: true, capabilities: ['text_chat'] }]
    : { subagents: { default: { kind: 'fixed', model_id: 'custom' } } };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.get.mockImplementation(loadedConfig);
    mocks.save.mockResolvedValue(undefined);
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });

  it('preserves the selected model, saves inherit or a fixed model, and opens agent customization', async () => {
    await act(async () => root.render(<SubagentModelConfig />));
    const select = container.querySelector('select')!;
    expect(select.value).toBe('custom');
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => { select.value = 'inherit'; Simulate.change(select); });
    expect(mocks.save).toHaveBeenLastCalledWith('ai.agent_model_defaults.subagents.default', { kind: 'inherit' });
    await act(async () => { select.value = 'custom'; Simulate.change(select); });
    expect(mocks.save).toHaveBeenLastCalledWith('ai.agent_model_defaults.subagents.default', { kind: 'fixed', model_id: 'custom' });
    await act(async () => container.querySelector('button')!.click());
    expect(mocks.openScene).toHaveBeenCalledWith('agents');
  });

  it.each(['ai.models', 'ai.agent_model_defaults'])('requires a successful %s read and allows retry without saving fallback values', async failedPath => {
    mocks.get.mockImplementation(async (path: string) => {
      if (path === failedPath) throw new Error('Host unavailable');
      return loadedConfig(path);
    });
    await act(async () => root.render(<SubagentModelConfig />));
    expect(mocks.get).toHaveBeenCalledWith(failedPath, { requireLoaded: true });
    expect(container.querySelector('select')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('subagentModels.loadFailed');
    expect(mocks.save).not.toHaveBeenCalled();

    mocks.get.mockImplementation(loadedConfig);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="subagent-retry"]')!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('select')?.value).toBe('custom');
    expect(container.querySelector('select')?.disabled).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
