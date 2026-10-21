import type {
  AIModelConfig,
  ModelCategory,
  ReasoningConfig,
} from '../types';
import { stableJson } from './modelConnectionTestPlan';

export interface ModelEditorDraftModel {
  configId?: string;
  modelName: string;
  manualRequestFormat?: string;
  category: ModelCategory;
  contextWindow: number;
  maxTokens?: number;
  reasoning: ReasoningConfig;
}

/** Canonical editor state used to detect changes since the dialog was opened. */
export function modelEditorDraftSnapshot(
  config: Partial<AIModelConfig>,
  models: readonly ModelEditorDraftModel[],
): string {
  const normalizedModels = models
    .map(model => ({
      configId: model.configId ?? null,
      modelName: model.modelName.trim(),
      manualRequestFormat: model.manualRequestFormat ?? null,
      category: model.category,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens ?? null,
      reasoning: model.reasoning,
    }))
    .sort((left, right) => (
      `${left.configId ?? ''}\0${left.modelName}`
        .localeCompare(`${right.configId ?? ''}\0${right.modelName}`)
    ));

  return stableJson({
    name: config.name?.trim() ?? '',
    provider: config.provider?.trim() || 'openai',
    baseUrl: config.base_url?.trim() ?? '',
    apiKey: config.api_key ?? '',
    enabled: config.enabled ?? true,
    auth: config.auth ?? { type: 'api_key' },
    inlineThinkInText: config.inline_think_in_text ?? true,
    customHeaders: config.custom_headers ?? {},
    customHeadersMode: config.custom_headers_mode ?? null,
    skipSslVerify: config.skip_ssl_verify ?? false,
    customRequestBody: config.custom_request_body ?? '',
    customRequestBodyMode: config.custom_request_body_mode ?? null,
    models: normalizedModels,
  });
}
