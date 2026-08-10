import {
  backgroundTaskScheduler,
  type BackgroundTaskHandle,
  type BackgroundTaskScheduler,
} from '@/shared/utils/backgroundTaskScheduler';
import { createLogger } from '@/shared/utils/logger';
import { startupTrace } from '@/shared/utils/startupTrace';

const log = createLogger('DeferredStartupSystems');

interface DeferredStartupLog {
  debug: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, data?: unknown) => void;
}

interface DeferredStartupTrace {
  markPhase: (phase: string, data?: Record<string, unknown>) => void;
}

export interface DeferredStartupSystemsDependencies {
  scheduler?: Pick<BackgroundTaskScheduler, 'schedule'>;
  log?: DeferredStartupLog;
  trace?: DeferredStartupTrace;
  initializeIdeControl?: () => Promise<void>;
  initializeMcpServers?: () => Promise<void>;
  initializeAcpClients?: () => Promise<void>;
  preloadDeferredRenderers?: () => Promise<void>;
  syncLocalModels?: () => Promise<void>;
}

async function initializeIdeControlDefault(): Promise<void> {
  const { initializeIdeControl } = await import('@/shared/services/ide-control');
  await initializeIdeControl();
}

async function initializeMcpServersDefault(): Promise<void> {
  const { MCPAPI } = await import('@/infrastructure/api/service-api/MCPAPI');
  await MCPAPI.initializeServers();
}

async function initializeAcpClientsDefault(): Promise<void> {
  const { ACPClientAPI } = await import('@/infrastructure/api/service-api/ACPClientAPI');
  await ACPClientAPI.initializeClients();
}

async function preloadDeferredRenderersDefault(): Promise<void> {
  const [
    { preloadMarkdownMathRenderer },
    { preloadTerminalOutputRenderer },
  ] = await Promise.all([
    import('@/component-library/components/Markdown/MarkdownMathRenderer.preload'),
    import('@/tools/terminal/components/TerminalOutputRenderer.preload'),
  ]);

  await Promise.all([
    preloadMarkdownMathRenderer(),
    preloadTerminalOutputRenderer(),
  ]);
}

/**
 * Detect Ollama and sync any downloaded local models into ai.models config
 * so they appear in ModelSelector without needing to open Settings first.
 */
async function syncLocalModelsDefault(): Promise<void> {
  const { localModelApi } = await import('@/infrastructure/api/service-api/LocalModelAPI');
  const { configManager } = await import('@/infrastructure/config/services/ConfigManager');

  const status = await localModelApi.detectService();
  if (!status.available) return;

  const models = await localModelApi.listModels();
  const downloaded = models.filter((m) => m.status === 'downloaded');
  if (downloaded.length === 0) return;

  const existingModels = await configManager.getConfig<any[]>('ai.models') || [];
  const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
  const existingLocalNames = new Set(
    existingModels
      .filter((m: any) => m.base_url === OLLAMA_BASE_URL)
      .map((m: any) => m.model_name),
  );

  const newEntries: any[] = [];
  for (const lm of downloaded) {
    if (existingLocalNames.has(lm.name)) continue;
    newEntries.push({
      id: `local-${lm.name}`,
      name: lm.details.family || lm.name,
      provider: 'openai',
      base_url: OLLAMA_BASE_URL,
      model_name: lm.name,
      context_window: 200000,
      enabled: true,
      category: 'general_chat',
      capabilities: ['text_chat'],
    });
  }

  if (newEntries.length > 0) {
    const updated = [...existingModels, ...newEntries];
    await configManager.setConfig('ai.models', updated);
    configManager.clearCache();
    const { createLogger } = await import('@/shared/utils/logger');
    const log = createLogger('DeferredStartup:local_model_sync');
    log.info('Synced local models to AI model list', { count: newEntries.length });
  }
}

export function scheduleDeferredStartupSystems(
  dependencies: DeferredStartupSystemsDependencies = {}
): BackgroundTaskHandle<void> {
  const scheduler = dependencies.scheduler ?? backgroundTaskScheduler;
  const logger = dependencies.log ?? log;
  const trace = dependencies.trace ?? startupTrace;
  const initializeIdeControl = dependencies.initializeIdeControl ?? initializeIdeControlDefault;
  const initializeMcpServers = dependencies.initializeMcpServers ?? initializeMcpServersDefault;
  const initializeAcpClients = dependencies.initializeAcpClients ?? initializeAcpClientsDefault;
  const preloadDeferredRenderers = dependencies.preloadDeferredRenderers ?? preloadDeferredRenderersDefault;
  const syncLocalModels = dependencies.syncLocalModels ?? syncLocalModelsDefault;

  return scheduler.schedule(async signal => {
    if (signal.aborted) {
      return;
    }

    trace.markPhase('deferred_startup_systems_start');

    const runStep = async (name: string, step: () => Promise<void>) => {
      if (signal.aborted) {
        return;
      }
      try {
        await step();
        logger.debug('Deferred startup system initialized', { system: name });
      } catch (error) {
        logger.error('Deferred startup system failed', { system: name, error });
      }
    };

    await runStep('ide_control', initializeIdeControl);
    await runStep('mcp_servers', initializeMcpServers);
    await runStep('acp_clients', initializeAcpClients);
    await runStep('local_model_sync', syncLocalModels);
    await runStep('renderer_preloads', preloadDeferredRenderers);

    if (!signal.aborted) {
      trace.markPhase('deferred_startup_systems_end');
    }
  }, {
    idle: true,
    priority: 'low',
    inFlightKey: 'startup:deferred-systems',
  });
}
