import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../../../shared/types';

const mocks = vi.hoisted(() => ({
  initializeAI: vi.fn(),
}));

vi.mock('@/infrastructure/api', () => ({
  aiApi: {
    initializeAI: mocks.initializeAI,
  },
}));

import { AIService } from './aiService';

const modelConfig: ModelConfig = {
  id: 'model-1',
  name: 'Test model',
  baseUrl: 'https://example.test',
  apiKey: 'test-key',
  modelName: 'test-model',
  format: 'openai',
};

describe('AIService', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn() });
    vi.stubGlobal('CustomEvent', class CustomEvent<T = unknown> {
      readonly type: string;
      readonly detail?: T;

      constructor(type: string, eventInitDict?: CustomEventInit<T>) {
        this.type = type;
        this.detail = eventInitDict?.detail;
      }
    });
    AIService.reset();
    mocks.initializeAI.mockReset();
  });

  it('propagates initialization failures without showing a startup notification', async () => {
    const rawError = 'Primary model not configured, please configure it in settings';
    mocks.initializeAI.mockRejectedValueOnce(new Error(rawError));

    await expect(AIService.initializeAI(modelConfig)).rejects.toThrow(rawError);
  });
});
