import { describe, expect, it } from 'vitest';
import type { AIModelConfig } from '../types';
import { hasAvailableAIModel } from './useAvailableAIModels';

const model = (
  enabled: boolean,
  capabilities: AIModelConfig['capabilities'] = ['text_chat'],
): AIModelConfig => ({
  name: 'Test model',
  provider: 'openai',
  base_url: 'https://example.com',
  model_name: 'test-model',
  enabled,
  category: 'general_chat',
  capabilities,
});

describe('hasAvailableAIModel', () => {
  it('requires an enabled text-chat model', () => {
    expect(hasAvailableAIModel(undefined)).toBe(false);
    expect(hasAvailableAIModel([])).toBe(false);
    expect(hasAvailableAIModel([model(false)])).toBe(false);
    expect(hasAvailableAIModel([model(false), model(true)])).toBe(true);
    expect(hasAvailableAIModel([model(true, ['speech_recognition'])])).toBe(false);
  });
});
