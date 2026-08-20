/**
 * Local model service API — invokes Tauri commands for local LLM management
 * (Ollama-compatible endpoints).
 */

import { api } from './ApiClient';
import { createTauriCommandError } from '../errors/TauriCommandError';

// --- TypeScript types matching Rust serde (camelCase) output ---

export type LocalModelStatus =
  | 'downloaded'
  | 'undownloaded'
  | 'downloading'
  | 'paused'
  | 'failed';

export interface LocalModelDetails {
  format: string;
  family: string;
  families: string[];
  parameterSize: string;
  quantizationLevel: string;
}

export interface LocalModel {
  name: string;
  type: string;
  status: LocalModelStatus;
  modifiedAt?: string | null;
  size: number;
  completed?: number | null;
  digest?: string | null;
  details: LocalModelDetails;
}

export interface LocalServiceStatus {
  available: boolean;
  port: number;
  serviceName?: string | null;
  version?: string | null;
  models: LocalModel[];
}

export interface LocalModelPullProgress {
  modelName: string;
  status: string;
  digest?: string | null;
  total: number;
  completed: number;
}

const DEFAULT_PORT = 0; // 0 means the backend uses its default (11434)

export class LocalModelAPI {
  /** Detect whether the local model service (Ollama) is running. */
  async detectService(port: number = DEFAULT_PORT): Promise<LocalServiceStatus> {
    try {
      return await api.invoke<LocalServiceStatus>('detect_local_model_service', {
        request: { port },
      });
    } catch (error) {
      throw createTauriCommandError('detect_local_model_service', error, { port });
    }
  }

  /** List all local models with their download status. */
  async listModels(port: number = DEFAULT_PORT): Promise<LocalModel[]> {
    try {
      return await api.invoke<LocalModel[]>('list_local_models', {
        request: { port },
      });
    } catch (error) {
      throw createTauriCommandError('list_local_models', error, { port });
    }
  }

  /**
   * Pull (download) a model. Progress is streamed via the
   * `local-model-pull-progress` Tauri event — listen with `onPullProgress`.
   */
  async pullModel(modelName: string, port: number = DEFAULT_PORT): Promise<void> {
    try {
      await api.invoke('pull_local_model', {
        request: { port, modelName },
      });
    } catch (error) {
      throw createTauriCommandError('pull_local_model', error, { port, modelName });
    }
  }

  /** Pause an in-progress model download. */
  async pauseDownload(modelName: string, port: number = DEFAULT_PORT): Promise<boolean> {
    try {
      return await api.invoke<boolean>('pause_local_model_download', {
        request: { port, modelName },
      });
    } catch (error) {
      throw createTauriCommandError('pause_local_model_download', error, { port, modelName });
    }
  }

  /**
   * Subscribe to pull progress events. Returns an unlisten function.
   * Callers should invoke it on cleanup.
   */
  async onPullProgress(
    handler: (progress: LocalModelPullProgress) => void,
  ): Promise<() => void> {
    return api.listen<LocalModelPullProgress>('local-model-pull-progress', handler);
  }

  /**
   * Subscribe to service-unavailable events. Returns an unlisten function.
   */
  async onServiceUnavailable(
    handler: (payload: { port: number; error: string }) => void,
  ): Promise<() => void> {
    return api.listen<{ port: number; error: string }>(
      'local-model-service-unavailable',
      handler,
    );
  }
}

export const localModelApi = new LocalModelAPI();
