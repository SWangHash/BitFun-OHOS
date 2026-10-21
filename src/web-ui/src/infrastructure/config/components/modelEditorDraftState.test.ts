import { describe, expect, it } from 'vitest';
import type { AIModelConfig, ReasoningConfig } from '../types';
import { modelEditorDraftSnapshot, type ModelEditorDraftModel } from './modelEditorDraftState';

const reasoning: ReasoningConfig = {
  catalog: { source: 'auto' },
  presets: [],
};

function config(overrides: Partial<AIModelConfig> = {}): Partial<AIModelConfig> {
  return {
    name: 'Provider',
    provider: 'openai',
    base_url: 'https://example.test/v1',
    api_key: 'fixture-key',
    enabled: true,
    auth: { type: 'api_key' },
    ...overrides,
  };
}

function model(overrides: Partial<ModelEditorDraftModel> = {}): ModelEditorDraftModel {
  return {
    configId: 'model-1',
    modelName: 'model-1',
    category: 'general_chat',
    contextWindow: 128_000,
    reasoning,
    ...overrides,
  };
}

describe('modelEditorDraftSnapshot', () => {
  it('keeps an untouched new-provider form clean', () => {
    const initial = modelEditorDraftSnapshot(config({ id: undefined }), [model({ configId: undefined })]);
    const current = modelEditorDraftSnapshot(config({ id: undefined }), [model({ configId: undefined })]);

    expect(current).toBe(initial);
  });

  it('ignores model presentation order but detects editable changes', () => {
    const first = model({ configId: 'a', modelName: 'alpha' });
    const second = model({ configId: 'b', modelName: 'beta' });
    const initial = modelEditorDraftSnapshot(config(), [first, second]);

    expect(modelEditorDraftSnapshot(config(), [second, first])).toBe(initial);
    expect(modelEditorDraftSnapshot(config({ base_url: 'https://other.test/v1' }), [first, second]))
      .not.toBe(initial);
    expect(modelEditorDraftSnapshot(config(), [first, { ...second, contextWindow: 256_000 }]))
      .not.toBe(initial);
  });
});
