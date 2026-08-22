import { useEffect, useState } from 'react';
import { configManager } from '../services/ConfigManager';
import type { AIModelConfig } from '../types';

export type AvailableAIModelStatus = 'loading' | 'available' | 'unavailable';

export function hasAvailableAIModel(
  models: AIModelConfig[] | null | undefined,
): boolean {
  return Array.isArray(models) && models.some(model => (
    model?.enabled === true
    && Array.isArray(model.capabilities)
    && model.capabilities.includes('text_chat')
  ));
}

export function useAvailableAIModels(): AvailableAIModelStatus {
  const [status, setStatus] = useState<AvailableAIModelStatus>('loading');

  useEffect(() => {
    let cancelled = false;
    let loadVersion = 0;

    const load = () => {
      const version = ++loadVersion;
      void configManager.getConfig<AIModelConfig[]>('ai.models').then(models => {
        if (cancelled || version !== loadVersion) return;
        setStatus(hasAvailableAIModel(models) ? 'available' : 'unavailable');
      });
    };

    load();
    const unwatch = configManager.watch('ai.models', load);

    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  return status;
}
