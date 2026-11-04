import { openCodeApiKey, isOpenCodeZenApiKeyConfig, isOpenCodeApiKeyConfig, isOpenCodeZenOAuth, openCodeZenModels, resolveOpenCodeModelRoute, savedOpenCodeApiKeyRoute } from './openCodeApiKeyRouting';
import { OverflowText,
  Button,
  Capsule,
  Card,
  CardHeader,
  CardFooter,
  FieldGroup,
  Disclosure,
  StatusPill,
  Combobox,
  Icon,
  IconButton,
  Input,
  NumberInput,
  SearchField,
  Select,
  Switch,
  Textarea,
  Tooltip,
  ScrollArea,
  type ComboboxOption,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeaderLeading,
  DialogHeaderActions,
  DialogHeading,
  DialogTitle,
  ConfirmDialog,
} from '@bitfun/ui';
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Wifi, AlertTriangle, BookOpen, EyeOff, FolderOpen, Loader, Plug } from 'lucide-react';
import {
  AIModelConfig as AIModelConfigType,
  ProxyConfig,
  ModelCategory,
  ModelCapability,
  DefaultModels,
  ReasoningCatalogBinding,
  ReasoningCatalogProjection,
  ReasoningConfig,
} from '../types';
import { configManager, ConfigConflictError } from '../services/ConfigManager';
import { getModelTags, getModelUserTags, preserveModelAnnotations } from '../services/modelTags';
import { useConfigSeed } from '../hooks/useConfigSeed';
import { endpointPresetsForFormat, findSelectedEndpointPreset, remapBaseUrlForFormat, resolveRequestUrl, previewRequestUrl } from './modelRequestUrl';
import { getCapabilitiesByCategory, getEffectiveModelCapabilities, resolveModelCategory } from '../services/modelCategory';
import {
  allocateModelConfigId,
  countModelConfigReferences,
  getModelDisplayName,
  getProviderDisplayName,
  getProviderGroupKey,
  getProviderInstanceId,
  getProviderTemplateId,
  PROVIDER_INSTANCE_METADATA_KEY,
  removeProviderModelConfigs,
} from '../services/modelConfigs';
import { resolveProviderTemplates } from '../services/builtinProviderCatalog';
import { normalizeProviderBaseUrl } from '../services/providerCatalog';
import {
  canonicalReasoningConfig,
  cloneReasoningConfig,
  validateReasoningConfig,
} from '../utils/reasoningPresets';
import { aiApi, systemAPI } from '@/infrastructure/api';
import type {
  SubscriptionAccount,
  SubscriptionLoginMethod,
} from '@/infrastructure/api/service-api/AIApi';
import type { ProviderRegion } from '@/shared/types';
import type { SubscriptionProvider } from '../types';
import { useNotification } from '@/shared/notification-system';
import {
  ConfigActionBar,
  ConfigFieldStatus,
  ConfigEmptyState,
  ConfigCollectionItem,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageContent,
  ConfigPageSection,
  ConfigPageRow,
  ConfigRetryState,
} from './common';
import {
  useSettingsDraft,
} from '@/infrastructure/config/settingsDraftRegistry';
import {
  configsNeedingAutoTest,
  stableJson,
} from './modelConnectionTestPlan';
import { modelEditorDraftSnapshot } from './modelEditorDraftState';
import DefaultModelConfig from './DefaultModelConfig';
import ModelTagsField from './ModelTagsField';
import { ModelDiscoveryPicker } from './ModelDiscoveryPicker';
import { ModelPoolCardActions } from './ModelPoolCardActions';
import { getSubscriptionAccountState } from './subscriptionAccountState';
import { getModelEditorRequestSettings, prepareModelEditorRequestSettingsForSave, updateModelEditorRequestSettings, type ModelEditorRequestSettings } from './modelEditorRequestSettings';
import ReasoningConfigPanel, { type ReasoningConfigApplyResult } from './ReasoningConfigPanel';
import { createLogger } from '@/shared/utils/logger';
import { translateConnectionTestMessage } from '@/shared/utils/aiConnectionTestMessages';
import { i18nService } from '@/infrastructure/i18n';
import { isTauriRuntime } from '@/infrastructure/runtime';
import { isPeerDeviceModeActive } from '@/infrastructure/peer-device/peerModeFlag';
import { usePeerDeviceModeOptional } from '@/infrastructure/peer-device/peerDeviceContextState';
import { getActiveSurfaceScope, onSurfaceActivated } from '@/infrastructure/peer-device/deviceSurface';
import { LONG_CONTEXT_WARNING_THRESHOLD_TOKENS } from '@/shared/constants/modelContext';
import {
  preferredSubscriptionLoginMethod,
  settleSubscriptionLoginStart,
  subscriptionLoginRequiresLocalDevice,
  SubscriptionLoginCoordinator,
  type SubscriptionLoginOperation,
} from './subscriptionLoginCoordinator';
import { ModelDiscoveryCoordinator } from './modelDiscoveryCoordinator';
import LocalModelManagerInline from './LocalModelManagerInline';
import './ModelSettingsPage.scss';

const log = createLogger('ModelSettings');
const MODELS_DEV_DOWNLOAD_URL = 'https://models.dev/api.json';

/** Rows the preset picker shows before the user searches or expands the list. */
const COLLAPSED_PROVIDER_COUNT = 6;

/**
 * Provider id for the local AI model service (Ollama). It is the only built-in
 * provider that needs download/pause/refresh management in the model
 * selection form, and the only one that does not require an API key.
 */
const LOCAL_MODEL_PROVIDER_ID = 'ollama';

function isLocalModelProvider(providerId?: string | null): boolean {
  return !!providerId && providerId === LOCAL_MODEL_PROVIDER_ID;
}

/**
 * True when base_url points at the local Ollama endpoint the inline manager
 * actually queries (localhost:11434). The inline panel manages Ollama models
 * through localhost:11434 regardless of the configured base_url, so it must
 * hide when the user repoints the API URL elsewhere (e.g. an invalid or
 * non-local address) to avoid showing a stale download list.
 */
function isLocalOllamaEndpointActive(baseUrl?: string): boolean {
  const normalized = normalizeProviderBaseUrl(baseUrl || '').toLowerCase().replace(/\/+$/, '');
  return normalized === 'http://localhost:11434/v1'
    || normalized === 'http://127.0.0.1:11434/v1';
}

interface RemoteModelOption {
  id: string;
  display_name?: string;
  routing?: { format: string; base_url: string; request_url: string };
}

interface SelectedModelDraft {
  key: string;
  configId?: string;
  modelName: string;
  manualRequestFormat?: string;
  category: ModelCategory;
  contextWindow: number;
  contextWindowEdited?: boolean;
  maxTokens?: number;
  reasoning: ReasoningConfig;
  userTags?: string[];
  requestSettings: ModelEditorRequestSettings;
  reasoningProjectionCatalog?: ReasoningCatalogBinding;
  reasoningProjectionSnapshot?: {
    catalog: ReasoningCatalogBinding;
    projection?: ReasoningCatalogProjection | null;
  };
}

interface ProviderGroup {
  key: string;
  providerName: string;
  providerId?: string;
  models: AIModelConfigType[];
}

interface SubscriptionLoginPanelState {
  provider: SubscriptionProvider;
  method?: SubscriptionLoginMethod;
  authorizationUrl: string;
  userCode?: string | null;
  deadlineMs?: number;
  status: 'starting' | 'pending' | 'cancelling' | 'failed';
  error?: string;
}

interface SubscriptionLogoutRequest {
  account: SubscriptionAccount;
  affectedModels: AIModelConfigType[];
}

interface ModelDeleteRequest {
  kind: 'model';
  config: AIModelConfigType;
  modelIds: string[];
  referenceCount: number;
}

interface ProviderDeleteRequest {
  kind: 'provider';
  groupKey: string;
  providerName: string;
  modelIds: string[];
  modelCount: number;
  referenceCount: number;
  discardsRetainedDraft: boolean;
}

type DeleteRequest = ModelDeleteRequest | ProviderDeleteRequest;

interface PendingEditorOpen {
  open: () => void;
}

interface ActiveConnectionTest {
  token: symbol;
  signature: string;
}

const SUBSCRIPTION_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function subscriptionLoginCancelledError(): Error {
  const error = new Error('Login cancelled');
  error.name = 'SubscriptionLoginCancelled';
  return error;
}

function createModelDraft(
  modelName: string,
  baseConfig?: Partial<AIModelConfigType>,
  overrides?: Partial<SelectedModelDraft>
): SelectedModelDraft {
  const trimmedModelName = modelName.trim();
  const reasoning = overrides?.reasoning ?? canonicalReasoningConfig(baseConfig as AIModelConfigType);

  return {
    key: overrides?.key ?? overrides?.configId ?? baseConfig?.id ?? trimmedModelName,
    configId: overrides?.configId ?? baseConfig?.id,
    modelName: trimmedModelName,
    userTags: overrides?.userTags,
    requestSettings: overrides?.requestSettings ?? getModelEditorRequestSettings(baseConfig),
    manualRequestFormat: overrides?.manualRequestFormat ?? baseConfig?.provider,
    category: overrides?.category ?? baseConfig?.category ?? 'general_chat',
    contextWindow: overrides?.contextWindow ?? baseConfig?.context_window ?? 300000,
    maxTokens: overrides?.maxTokens ?? baseConfig?.max_tokens,
    reasoning,
    reasoningProjectionCatalog: overrides?.reasoningProjectionCatalog ?? reasoning.catalog,
  };
}

function reasoningCatalogBindingsEqual(
  left?: ReasoningCatalogBinding,
  right?: ReasoningCatalogBinding,
): boolean {
  return JSON.stringify(left ?? { source: 'auto' }) === JSON.stringify(right ?? { source: 'auto' });
}

function uniqModelNames(modelNames: string[]): string[] {
  return Array.from(new Set(modelNames.map(name => name.trim()).filter(Boolean)));
}

function modelNameLookupKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Trim, optionally collapse to single selection, then dedupe so one provider
 * instance cannot list the same logical model twice.
 */
function normalizeProviderModelNameList(
  modelNames: string[],
  singleSelection: boolean
): string[] {
  let list = uniqModelNames(modelNames);
  if (singleSelection) {
    list = list.slice(0, 1);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const resolved = raw.trim();
    if (!resolved) continue;
    const key = modelNameLookupKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

function parseOptionalPositiveIntegerInput(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function generateProviderInstanceId(): string {
  return `provider_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}


/** Last line of defense: same logical model name once per save; prefer draft tied to an existing config id. */
function dedupeSelectedModelDraftsByModelName(drafts: SelectedModelDraft[]): SelectedModelDraft[] {
  const out: SelectedModelDraft[] = [];
  for (const draft of drafts) {
    const k = modelNameLookupKey(draft.modelName);
    const i = out.findIndex(d => modelNameLookupKey(d.modelName) === k);
    if (i < 0) {
      out.push(draft);
      continue;
    }
    const prev = out[i];
    out[i] = !prev.configId && draft.configId ? draft : prev;
  }
  return out;
}

function hasHttpUrlScheme(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeComparableString(value: string | undefined): string {
  return (value || '').trim();
}

function modelDraftHasUnsavedChanges(
  draft: SelectedModelDraft,
  persistedModels: AIModelConfigType[],
): boolean {
  const persisted = draft.configId
    ? persistedModels.find(model => model.id === draft.configId)
    : undefined;

  if (!persisted) return true;

  return (
    normalizeComparableString(draft.modelName) !== normalizeComparableString(persisted.model_name) ||
    (isOpenCodeApiKeyConfig(persisted) && draft.manualRequestFormat !== persisted.provider) ||
    draft.category !== (persisted.category ?? 'general_chat') ||
    draft.contextWindow !== (persisted.context_window || 300000) ||
    draft.maxTokens !== persisted.max_tokens ||
    (draft.userTags !== undefined && stableJson(draft.userTags) !== stableJson(getModelUserTags(persisted))) ||
    stableJson(draft.requestSettings) !== stableJson(getModelEditorRequestSettings(persisted)) ||
    stableJson(draft.reasoning) !== stableJson(canonicalReasoningConfig(persisted))
  );
}

function getPoolProviderKey(model: AIModelConfigType): string {
  return model.auth?.type === 'subscription' ? `subscription:${model.auth.provider}` : `api:${getProviderDisplayName(model)}`;
}

const ModelSettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation('settings/models');
  const { t: tDefault } = useTranslation('settings/default-model');
  const { t: tComponents } = useTranslation('components');
  const peerDevice = usePeerDeviceModeOptional();
  const connectionTestSupported = !peerDevice?.peerMode.active
    || peerDevice.currentPeerCapabilities?.hostKind !== 'cli';
  const modelSeed = useConfigSeed(['ai.models', 'ai.default_models']);
  const proxySeed = useConfigSeed(['ai.proxy']);
  const timeoutSeed = useConfigSeed(['ai.stream_idle_timeout_secs', 'ai.stream_ttft_timeout_secs']);
  const initialProxy = proxySeed.get<ProxyConfig | null>('ai.proxy', null) ?? { enabled: false, url: '', username: '', password: '' };
  const initialIdle = timeoutSeed.get<number | null>('ai.stream_idle_timeout_secs', null);
  const initialTtft = timeoutSeed.get<number | null>('ai.stream_ttft_timeout_secs', null);
  const [poolDefaults, setPoolDefaults] = useState<DefaultModels>(modelSeed.get<DefaultModels | null>('ai.default_models', null) ?? { primary: null, fast: null, image_understanding: null, speech_recognition: null });
  const [aiModels, setAiModels] = useState<AIModelConfigType[]>(modelSeed.get('ai.models', []));
  const editorModelsSnapshot = React.useRef<AIModelConfigType[]>([]);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryProvider, setLibraryProvider] = useState('');
  const [libraryCapability, setLibraryCapability] = useState<ModelCapability | ''>('');
  const [connectionState, setConnectionState] = useState<Record<'proxy' | 'timeouts', 'loading' | 'ready' | 'error'>>({ proxy: proxySeed.loaded ? 'ready' : 'loading', timeouts: timeoutSeed.loaded ? 'ready' : 'loading' });
  const [isConfigLoading, setIsConfigLoading] = useState(!modelSeed.loaded);
  const [configLoadError, setConfigLoadError] = useState(false);
  const [modelCatalog, setModelCatalog] = useState<Awaited<ReturnType<typeof aiApi.getModelCatalog>> | null>(null);
  const [modelsDevStatus, setModelsDevStatus] = useState<Awaited<ReturnType<typeof aiApi.getModelsDevCatalogStatus>> | null>(null);
  const [modelsDevStatusAvailable, setModelsDevStatusAvailable] = useState(true);
  const [isRefreshingModelsDev, setIsRefreshingModelsDev] = useState(false);
  const [showModelsDevDetails, setShowModelsDevDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const [editingConfig, setEditingConfig] = useState<Partial<AIModelConfigType> | null>(null);
  const [editingTargetKey, setEditingTargetKey] = useState<string | null>(null);
  const [editorBaseline, setEditorBaseline] = useState<{ targetKey: string; snapshot: string } | null>(null);
  const [draftCloseConfirmOpen, setDraftCloseConfirmOpen] = useState(false);
  const [draftConflictConfirmOpen, setDraftConflictConfirmOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingConfigs, setTestingConfigs] = useState<Record<string, boolean>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedProviderGroupKeys, setExpandedProviderGroupKeys] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string } | null>>({});
  const notification = useNotification();

  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  const [creationMode, setCreationMode] = useState<'selection' | 'form' | null>(null);
  const [providerQuery, setProviderQuery] = useState('');
  const [showAllProviders, setShowAllProviders] = useState(false);

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>(initialProxy);

  const [savedProxyConfig, setSavedProxyConfig] = useState<ProxyConfig>(initialProxy);

  const [streamIdleTimeoutInput, setStreamIdleTimeoutInput] = useState(initialIdle == null ? '' : String(initialIdle));
  const [streamTtftTimeoutInput, setStreamTtftTimeoutInput] = useState(initialTtft == null ? '' : String(initialTtft));
  const [savedStreamTimeouts, setSavedStreamTimeouts] = useState({ idle: initialIdle == null ? '' : String(initialIdle), ttft: initialTtft == null ? '' : String(initialTtft) });
  const [isStreamTimeoutSaving, setIsStreamTimeoutSaving] = useState(false);
  const [isProxySaving, setIsProxySaving] = useState(false);
  const [streamTimeoutSaveError, setStreamTimeoutSaveError] = useState<string | null>(null);
  const [proxySaveError, setProxySaveError] = useState<string | null>(null);
  const streamTimeoutSavingRef = React.useRef(false);
  const proxySavingRef = React.useRef(false);
  const [remoteModelOptions, setRemoteModelOptions] = useState<RemoteModelOption[]>([]);
  const [isFetchingRemoteModels, setIsFetchingRemoteModels] = useState(false);
  const [remoteModelsError, setRemoteModelsError] = useState<string | null>(null);
  const [hasAttemptedRemoteFetch, setHasAttemptedRemoteFetch] = useState(false);
  const [selectedModelDrafts, setSelectedModelDrafts] = useState<SelectedModelDraft[]>([]);
  const [showModelValidation, setShowModelValidation] = useState(false);
  useEffect(() => { setShowModelValidation(false); }, [editingTargetKey, isEditing]);

  const [editingProviderModelIds, setEditingProviderModelIds] = useState<Set<string>>(new Set());
  const providerIdentityLocked = !!editingConfig?.id || editingProviderModelIds.size > 0;
  const configuredProvider = aiModels.find(model => editingConfig?.id
    ? model.id === editingConfig.id : editingProviderModelIds.has(model.id || ''));
  const [modelPanelDraftKey, setModelPanelDraftKey] = useState<string | null>(null);
  const modelPanelInitialRef = React.useRef<{ draft: SelectedModelDraft; advancedOpen: boolean } | null>(null);
  const modelCapsuleRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const returnModelFocusKeyRef = React.useRef<string | null>(null);
  const [manualModelInput, setManualModelInput] = useState('');
  const [isAddingCustomModel, setIsAddingCustomModel] = useState(false);
  const manualModelInputActiveRef = React.useRef(false);
  const manualModelAddButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const [reasoningPanelDraftKey, setReasoningPanelDraftKey] = useState<string | null>(null);
  const reasoningPanelInitialRef = React.useRef<Pick<
    SelectedModelDraft,
    'key' | 'reasoning' | 'reasoningProjectionCatalog' | 'reasoningProjectionSnapshot'
  > | null>(null);
  useEffect(() => {
    const draftKey = returnModelFocusKeyRef.current;
    if (isEditing && !modelPanelDraftKey && !reasoningPanelDraftKey && draftKey) {
      modelCapsuleRefs.current.get(draftKey)?.focus();
      returnModelFocusKeyRef.current = null;
    }
  }, [isEditing, modelPanelDraftKey, reasoningPanelDraftKey]);
  const [subscriptionAccounts, setSubscriptionAccounts] = useState<SubscriptionAccount[]>([]);
  const subscriptionRefreshesRef = React.useRef(new Set<SubscriptionProvider>());
  const [refreshingSubscriptionProviders, setRefreshingSubscriptionProviders] = useState<ReadonlySet<SubscriptionProvider>>(new Set());
  const [isLoadingSubscriptions, setIsLoadingSubscriptions] = useState(true);
  const [subscriptionLoadError, setSubscriptionLoadError] = useState(false);
  const [showProviderManager, setShowProviderManager] = useState(false);
  const [showTagSyncNotice, setShowTagSyncNotice] = useState(false);
  const [showSubscriptionManager, setShowSubscriptionManager] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [loggingInProvider, setLoggingInProvider] = useState<SubscriptionProvider | null>(null);
  const [subscriptionLoginPanel, setSubscriptionLoginPanel] = useState<SubscriptionLoginPanelState | null>(null);
  const [subscriptionLoginClock, setSubscriptionLoginClock] = useState(() => Date.now());
  const [subscriptionLogoutRequest, setSubscriptionLogoutRequest] = useState<SubscriptionLogoutRequest | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null);
  const modelDiscoveryRef = React.useRef(new ModelDiscoveryCoordinator());
  const editorSavingRef = React.useRef(false);
  const pendingEditorOpenRef = React.useRef<PendingEditorOpen | null>(null);
  const activeConnectionTestsRef = React.useRef<Record<string, ActiveConnectionTest>>({});
  useEffect(() => {
    const invalidate = () => {
      activeConnectionTestsRef.current = {};
      setTestingConfigs({});
      setTestResults({});
    };
    const unsubscribeConfig = configManager.onConfigChange(path => {
      if (!path || path === 'ai' || [
        'ai.models', 'ai.proxy', 'ai.stream_idle_timeout_secs', 'ai.stream_ttft_timeout_secs',
      ].some(owner => path === owner || path.startsWith(`${owner}.`))) invalidate();
    });
    const unsubscribeSurface = onSurfaceActivated(invalidate);
    return () => {
      unsubscribeConfig();
      unsubscribeSurface();
      activeConnectionTestsRef.current = {};
    };
  }, []);


  const requestFormatOptions = useMemo(
    () => [
      { label: 'OpenAI (chat/completions)', value: 'openai' },
      { label: 'OpenAI (responses)', value: 'responses' },
      { label: 'Anthropic (messages)', value: 'anthropic' },
      { label: 'Gemini (generateContent)', value: 'gemini' },
      { label: 'Gemini Code Assist (cloudcode-pa)', value: 'gemini-code-assist' },
    ],
    []
  );
  const requestFormatLabelMap = useMemo(
    () => Object.fromEntries(
      requestFormatOptions.map(option => [String(option.value), option.label])
    ) as Record<string, string>,
    [requestFormatOptions]
  );

  const categoryOptions = useMemo<ComboboxOption[]>(
    () => [
      { label: t('category.general_chat'), value: 'general_chat' },
      { label: t('category.multimodal'), value: 'multimodal' },
      { label: t('category.speech_recognition'), value: 'speech_recognition' },
    ],
    [t]
  );

  const parsedStreamIdleTimeout = useMemo(
    () => parseOptionalPositiveIntegerInput(streamIdleTimeoutInput),
    [streamIdleTimeoutInput]
  );
  const parsedStreamTtftTimeout = useMemo(
    () => parseOptionalPositiveIntegerInput(streamTtftTimeoutInput),
    [streamTtftTimeoutInput]
  );
  const isStreamIdleTimeoutInvalid = parsedStreamIdleTimeout === undefined;
  const isStreamTtftTimeoutInvalid = parsedStreamTtftTimeout === undefined;
  const isStreamTimeoutInvalid = isStreamIdleTimeoutInvalid || isStreamTtftTimeoutInvalid;
  const isProxyDirty = stableJson(proxyConfig) !== stableJson(savedProxyConfig);
  const isStreamTimeoutDirty = streamIdleTimeoutInput !== savedStreamTimeouts.idle
    || streamTtftTimeoutInput !== savedStreamTimeouts.ttft;

  const getCustomRequestBodyTrimHint = useCallback((provider?: string): string => {
    switch (provider) {
      case 'responses':
        return t('advancedSettings.customRequestBody.trimHintResponses');
      case 'anthropic':
        return t('advancedSettings.customRequestBody.trimHintAnthropic');
      case 'gemini':
        return t('advancedSettings.customRequestBody.trimHintGemini');
      case 'openai':
      default:
        return t('advancedSettings.customRequestBody.trimHintOpenAI');
    }
  }, [t]);

  const getCustomRequestBodyModeHint = useCallback((provider?: string, mode?: string | null): string => {
    return mode === 'trim'
      ? getCustomRequestBodyTrimHint(provider)
      : t('advancedSettings.customRequestBody.modeMergeHint');
  }, [getCustomRequestBodyTrimHint, t]);

  const loadModelCatalog = useCallback(async () => {
    const scope = getActiveSurfaceScope();
    try {
      const catalog = await aiApi.getModelCatalog();
      if (!scope.isCurrent()) return;
      setModelCatalog(catalog);
    } catch (error) {
      if (!scope.isCurrent()) return;
      log.warn('Failed to load model reasoning catalog', { error });
    }
  }, []);

  const loadModelsDevStatus = useCallback(async () => {
    const scope = getActiveSurfaceScope();
    try {
      const status = await aiApi.getModelsDevCatalogStatus();
      if (!scope.isCurrent()) return;
      setModelsDevStatus(status);
      setModelsDevStatusAvailable(true);
    } catch (error) {
      if (!scope.isCurrent()) return;
      setModelsDevStatusAvailable(false);
      log.warn('Failed to load models.dev catalog status', { error });
    }
  }, []);

  const handleRefreshModelsDev = useCallback(async () => {
    const scope = getActiveSurfaceScope();
    setShowModelsDevDetails(true);
    setIsRefreshingModelsDev(true);
    try {
      const result = await aiApi.refreshModelsDevCatalogNow();
      if (!scope.isCurrent()) return;
      setModelsDevStatus(result.status);
      await loadModelCatalog();
      notification.success(
        result.outcome === 'updated'
          ? t('modelsDevCatalog.refreshSuccess')
          : result.outcome === 'throttled'
            ? t('modelsDevCatalog.refreshThrottled')
            : t('modelsDevCatalog.alreadyCurrent'),
      );
    } catch (error) {
      if (!scope.isCurrent()) return;
      log.warn('Failed to refresh models.dev catalog', { error });
      notification.error(t('modelsDevCatalog.refreshFailed'));
      await loadModelsDevStatus();
    } finally {
      if (scope.isCurrent()) setIsRefreshingModelsDev(false);
    }
  }, [loadModelCatalog, loadModelsDevStatus, notification, t]);

  const loadConfig = useCallback(async (forceRefresh = false) => {
    const scope = getActiveSurfaceScope();
    setIsConfigLoading(!modelSeed.loaded);
    setConfigLoadError(false);
    try {
      const [models, defaults] = await Promise.all([
        configManager.getConfig<AIModelConfigType[]>('ai.models', { requireLoaded: true, forceRefresh }),
        configManager.getOptionalConfig<DefaultModels>('ai.default_models'),
      ]);
      const values = { 'ai.models': models, 'ai.default_models': defaults };
      if (scope.isCurrent()) {
        setAiModels(values['ai.models'] as AIModelConfigType[] ?? []);
        setPoolDefaults(values['ai.default_models'] as DefaultModels ?? { primary: null, fast: null, image_understanding: null, speech_recognition: null });
      }
    } catch (error) {
      if (!scope.isCurrent()) return;
      log.error('Failed to load model configuration', error);
      setConfigLoadError(true);
    } finally {
      if (scope.isCurrent()) setIsConfigLoading(false);
    }
  }, [modelSeed.loaded]);

  const loadConnectionSection = useCallback(async (section: 'proxy' | 'timeouts') => {
    const scope = getActiveSurfaceScope();
    setConnectionState(state => ({ ...state, [section]: 'loading' }));
    try {
      if (section === 'proxy') {
        const proxy = await configManager.getOptionalConfig<ProxyConfig>('ai.proxy');
        if (!scope.isCurrent()) return;
        const value = proxy || { enabled: false, url: '', username: '', password: '' };
        setProxyConfig(value);
        setSavedProxyConfig(value);
      } else {
        const [idleSeconds, ttftSeconds] = await Promise.all([
          configManager.getOptionalConfig<number | null>('ai.stream_idle_timeout_secs'),
          configManager.getOptionalConfig<number | null>('ai.stream_ttft_timeout_secs'),
        ]);
        if (!scope.isCurrent()) return;
        const idle = idleSeconds == null ? '' : String(idleSeconds);
        const ttft = ttftSeconds == null ? '' : String(ttftSeconds);
        setStreamIdleTimeoutInput(idle);
        setStreamTtftTimeoutInput(ttft);
        setSavedStreamTimeouts({ idle, ttft });
      }
      setConnectionState(state => ({ ...state, [section]: 'ready' }));
    } catch (error) {
      if (!scope.isCurrent()) return;
      log.error('Failed to load model connection settings', { section, error });
      setConnectionState(state => ({ ...state, [section]: 'error' }));
    }
  }, []);

  useEffect(() => {
    if (!modelSeed.loaded) void loadConfig();
    if (!proxySeed.loaded) void loadConnectionSection('proxy');
    if (!timeoutSeed.loaded) void loadConnectionSection('timeouts');
    void loadModelCatalog();
    void loadModelsDevStatus();
    return aiApi.onModelCatalogUpdated(() => {
      void loadModelCatalog();
      void loadModelsDevStatus();
    });
  }, [loadConfig, loadConnectionSection, loadModelCatalog, loadModelsDevStatus, modelSeed.loaded, proxySeed.loaded, timeoutSeed.loaded]);

  const subscriptionAccountsReadRef = React.useRef(0);
  const refreshSubscriptionAccounts = useCallback(async () => {
    const requestId = ++subscriptionAccountsReadRef.current;
    const scope = getActiveSurfaceScope();
    const isCurrent = () => scope.isCurrent() && requestId === subscriptionAccountsReadRef.current;
    setIsLoadingSubscriptions(true);
    setSubscriptionLoadError(false);
    try {
      const items = await aiApi.listSubscriptionAccounts();
      if (isCurrent()) setSubscriptionAccounts(items);
    } catch (error) {
      if (!isCurrent()) return;
      setSubscriptionLoadError(true);
      log.warn('Failed to load subscription accounts', { error });
    } finally {
      if (isCurrent()) setIsLoadingSubscriptions(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => { void refreshSubscriptionAccounts(); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      subscriptionAccountsReadRef.current += 1;
    };
  }, [refreshSubscriptionAccounts]);

  useEffect(() => {
    const refresh = () => { void loadConfig(); };
    const stopModels = configManager.watch('ai.models', refresh);
    const stopDefaults = configManager.watch('ai.default_models', refresh);
    return () => { stopModels(); stopDefaults(); };
  }, [loadConfig]);

  useEffect(() => {
    if (!subscriptionLoginPanel || subscriptionLoginPanel.status !== 'pending') return;
    setSubscriptionLoginClock(Date.now());
    const timer = window.setInterval(() => setSubscriptionLoginClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [subscriptionLoginPanel]);

  // Provider options with translations (must be at top level, before any conditional returns)
  const providerTemplates = useMemo(
    () => resolveProviderTemplates(modelCatalog?.provider_catalog),
    [modelCatalog?.provider_catalog],
  );
  const providerOrder = useMemo(
    () => Object.values(providerTemplates)
      .sort((left, right) => (left.displayOrder ?? 999) - (right.displayOrder ?? 999))
      .map(provider => provider.id),
    [providerTemplates],
  );
  // A Chinese UI leads with mainland providers, every other UI leads with the
  // international ones. Both keep the full list, only the order changes.
  const preferredProviderRegion: ProviderRegion = i18n.language.toLowerCase().startsWith('zh') ? 'cn' : 'global';
  const providers = useMemo(() => {
    const regionRank = (region: ProviderRegion) => {
      if (region === 'any') return 0;
      return region === preferredProviderRegion ? 1 : 2;
    };

    // Dynamically get translated name and description
    return Object.values(providerTemplates)
      .map(provider => {
        const localizedName = t(`providers.${provider.id}.name`);
        const localizedDescription = t(`providers.${provider.id}.description`);
        return {
          ...provider,
          name: localizedName,
          description: localizedDescription,
          // Keeps the catalog's English name searchable while a CJK locale renders the localized one.
          searchText: [provider.id, provider.name, localizedName, localizedDescription, ...provider.models]
            .join(' ')
            .toLowerCase(),
        };
      })
      .sort((left, right) => (
        regionRank(left.region ?? 'any') - regionRank(right.region ?? 'any')
        || (left.displayOrder ?? 999) - (right.displayOrder ?? 999)
        || left.name.localeCompare(right.name)
      ));
  }, [preferredProviderRegion, providerTemplates, t]);

  const normalizedProviderQuery = providerQuery.trim().toLowerCase();
  const matchedProviders = useMemo(() => (
    normalizedProviderQuery
      ? providers.filter(provider => provider.searchText.includes(normalizedProviderQuery))
      : providers
  ), [normalizedProviderQuery, providers]);
  // Searching always reveals every hit; only the resting list stays short.
  const canToggleProviderList = !normalizedProviderQuery
    && matchedProviders.length > COLLAPSED_PROVIDER_COUNT;
  const isProviderListCollapsed = canToggleProviderList && !showAllProviders;
  const visibleProviders = isProviderListCollapsed
    ? matchedProviders.slice(0, COLLAPSED_PROVIDER_COUNT)
    : matchedProviders;

  // Current template with translations (must be at top level, before any conditional returns)
  const currentTemplate = useMemo(() => {
    if (!selectedProviderId) return null;
    const template = providerTemplates[selectedProviderId];
    if (!template) return null;
    // Dynamically get translated name, description, and baseUrlOptions notes
    return {
      ...template,
      name: t(`providers.${template.id}.name`),
      description: t(`providers.${template.id}.description`),
      baseUrlOptions: template.baseUrlOptions?.map(opt => ({
        ...opt,
        note: t(`providers.${template.id}.urlOptions.${opt.note}`, { defaultValue: opt.note })
      }))
    };
  }, [providerTemplates, selectedProviderId, t]);

  // True when the selected provider does not require an API key (e.g. local
  // Ollama). Hides the auth/api_key rows and unlocks model discovery without
  // a key. Also gates the inline local-model download/pause/refresh panel.
  const isNoApiKeyProvider = currentTemplate?.requiresApiKey === false;
  const isLocalModelProviderSelected = isLocalModelProvider(selectedProviderId);
  // The inline panel only shows when the configured base_url still points at
  // the local Ollama endpoint; repointing the API URL hides the panel so a
  // stale download list does not persist for a non-Ollama / invalid URL.
  const showLocalModelManager = isLocalModelProviderSelected
    && isLocalOllamaEndpointActive(editingConfig?.base_url);

  const missingModelFields = {
    name: !editingConfig?.name?.trim(),
    baseUrl: !editingConfig?.base_url?.trim(),
    apiKey: editingConfig?.auth?.type !== 'subscription'
      && currentTemplate?.requiresApiKey !== false
      && !openCodeApiKey(editingConfig || {}),
    model: selectedModelDrafts.length === 0 || selectedModelDrafts.some(draft => !draft.modelName.trim()),
  };

  const missingModelFieldLabels = [
    missingModelFields.name && t('form.configName'),
    missingModelFields.baseUrl && t('form.baseUrl'),
    missingModelFields.apiKey && t('form.apiKey'),
    missingModelFields.model && t('form.modelName'),
  ].filter((field): field is string => typeof field === 'string');
  const modelValidationMessage = missingModelFieldLabels.length === 0 ? null : t('messages.missingFields', {
    fields: missingModelFieldLabels.length > 1
      ? `${missingModelFieldLabels.slice(0, -1).join(t('messages.fieldSeparator'))}${t('messages.lastFieldSeparator')}${missingModelFieldLabels.at(-1)}`
      : missingModelFieldLabels[0],
  });

  const currentEditorSnapshot = useMemo(() => (
    editingConfig ? modelEditorDraftSnapshot(editingConfig, selectedModelDrafts) : null
  ), [editingConfig, selectedModelDrafts]);
  const editorBaselineTargetKey = editingTargetKey ?? 'new-provider';
  const editingModalHasUnsavedChanges = (isAddingCustomModel && !!manualModelInput.trim())
    || (currentEditorSnapshot !== null
      && editorBaseline?.targetKey === editorBaselineTargetKey
      && currentEditorSnapshot !== editorBaseline.snapshot);

  useEffect(() => {
    if (!isEditing || !currentEditorSnapshot) return;
    setEditorBaseline(current => (
      current?.targetKey === editorBaselineTargetKey
        ? current
        : { targetKey: editorBaselineTargetKey, snapshot: currentEditorSnapshot }
    ));
  }, [currentEditorSnapshot, editorBaselineTargetKey, isEditing]);

  const createDraftsFromConfigs = (configs: AIModelConfigType[]) => (
    configs.map(config => createModelDraft(config.model_name, config, {
      configId: config.id,
      contextWindow: config.context_window || 300000,
      maxTokens: config.max_tokens,
      reasoning: canonicalReasoningConfig(config),
    }))
  );

  const resetRemoteModelDiscovery = useCallback(() => {
    setRemoteModelOptions([]);
    setIsFetchingRemoteModels(false);
    setRemoteModelsError(null);
    setHasAttemptedRemoteFetch(false);
    setModelPickerOpen(false);
    modelDiscoveryRef.current.reset();
  }, []);

  const modelDiscoverySurface = peerDevice?.peerMode.active ? peerDevice.peerMode.deviceId : 'local';
  useEffect(() => {
    const coordinator = modelDiscoveryRef.current;
    resetRemoteModelDiscovery();
    return () => coordinator.reset();
  }, [modelDiscoverySurface, resetRemoteModelDiscovery]);
  const syncSelectedModelDrafts = (
    modelNames: string[],
    baseConfig?: Partial<AIModelConfigType>,
    singleSelection = false
  ) => {
    const nextModelNames = normalizeProviderModelNameList(
      modelNames,
      singleSelection
    );

    const pinnedRowId =
      singleSelection && baseConfig?.id ? String(baseConfig.id) : undefined;

    setSelectedModelDrafts(prevDrafts =>
      nextModelNames.map(modelName => {
        const lookupKey = modelNameLookupKey(modelName);
        const existingDraft = prevDrafts.find(
          draft => modelNameLookupKey(draft.modelName) === lookupKey
        );

        if (existingDraft) {
          const configId = pinnedRowId ?? existingDraft.configId;
          return {
            ...existingDraft,
            modelName,
            configId,
            key: configId ?? modelName,
          };
        }

        const draftBaseConfig = baseConfig
          ? { ...baseConfig, max_tokens: undefined }
          : undefined;

        const catalogModel = selectedProviderId
          ? modelCatalog?.provider_catalog?.providers
              .find(provider => provider.id === selectedProviderId)
              ?.models.find(model => model.id === modelName)
          : undefined;
        return createModelDraft(modelName, draftBaseConfig, {
          configId: pinnedRowId,
          contextWindow: catalogModel?.limits?.context,
          // New selections start as text generation; existing model edits retain their category.
          category: pinnedRowId ? (baseConfig?.category ?? 'general_chat') : 'general_chat',
        });
      })
    );

    setEditingConfig(prev => {
      if (!prev) return prev;

      const nextPrimaryModel = nextModelNames[0] || '';
      const providerName = currentTemplate?.name || prev.name || '';
      const oldAutoName = prev.model_name ? `${providerName} - ${prev.model_name}` : '';
      const isAutoGenerated = !prev.name || prev.name === oldAutoName || prev.name === providerName;

      return {
        ...prev,
        model_name: nextPrimaryModel,
        request_url: resolveRequestUrl(
          prev.base_url || currentTemplate?.baseUrl || '',
          prev.provider || currentTemplate?.format || 'openai',
          nextPrimaryModel
        ),
        name: isAutoGenerated ? providerName : prev.name
      };
    });
  };

  const updateModelDraft = (draftKey: string, updates: Partial<SelectedModelDraft>) => {
    setSelectedModelDrafts(prevDrafts => prevDrafts.map(draft => (
      draft.key === draftKey ? { ...draft, ...updates } : draft
    )));
  };

  const resolveDraftCatalogEntry = (draft: SelectedModelDraft) => (
    modelCatalog?.models.find(model => (
      model.id === draft.configId
      || model.id === editingConfig?.id
      || (
        model.model_name === draft.modelName
        && model.provider === (editingConfig?.provider || 'openai')
        && model.base_url === editingConfig?.base_url
      )
    ))
  );

  const resolveDraftReasoningProjection = (draft: SelectedModelDraft) => {
    const snapshot = draft.reasoningProjectionSnapshot;
    if (snapshot && reasoningCatalogBindingsEqual(draft.reasoning.catalog, snapshot.catalog)) {
      return snapshot.projection ?? undefined;
    }
    if (reasoningCatalogBindingsEqual(draft.reasoning.catalog, draft.reasoningProjectionCatalog)) {
      return resolveDraftCatalogEntry(draft)?.reasoning;
    }
    return undefined;
  };

  const modelPanelDraft = selectedModelDrafts.find(draft => draft.key === modelPanelDraftKey);
  const singleModelEditorDraft = modelPanelDraft || (editingConfig?.id ? selectedModelDrafts[0] : undefined);
  const openModelPanel = (draft: SelectedModelDraft) => {
    modelPanelInitialRef.current = {
      draft,
      advancedOpen: showAdvancedSettings,
    };
    setModelPanelDraftKey(draft.key);
    setShowModelValidation(false);
    const settings = draft.requestSettings;
    setShowAdvancedSettings(
      !!settings.skip_ssl_verify
      || settings.custom_request_body_mode === 'trim'
      || !!settings.custom_request_body?.trim()
      || Object.keys(settings.custom_headers || {}).length > 0,
    );
  };

  const returnToProviderEditor = () => {
    returnModelFocusKeyRef.current = modelPanelDraftKey;
    setShowAdvancedSettings(modelPanelInitialRef.current?.advancedOpen ?? false);
    setModelPanelDraftKey(null);
    modelPanelInitialRef.current = null;
    setShowModelValidation(false);
  };

  const finishModelPanel = () => {
    if (!modelPanelDraft) return;
    setShowModelValidation(true);
    const modelName = modelPanelDraft.modelName.trim();
    if (!modelName) {
      notification.warning(t('messages.missingFields', { fields: t('form.modelName') }));
      return;
    }
    if (selectedModelDrafts.some(draft => draft.key !== modelPanelDraft.key
      && modelNameLookupKey(draft.modelName) === modelNameLookupKey(modelName))) {
      notification.warning(t('messages.duplicateModelNameUnderProvider'));
      return;
    }
    if (modelPanelDraft.contextWindow < 32000) {
      notification.warning(t('messages.contextWindowTooSmall'));
      return;
    }
    updateModelDraft(modelPanelDraft.key, { modelName });
    returnToProviderEditor();
  };

  const cancelModelPanel = () => {
    const initial = modelPanelInitialRef.current;
    if (initial && initial.draft.key === modelPanelDraftKey) {
      updateModelDraft(initial.draft.key, initial.draft);
    }
    returnToProviderEditor();
  };

  const removeSelectedModelDraft = (modelName: string) => {
    const remainingModelNames = selectedModelDrafts
      .filter(draft => draft.modelName !== modelName)
      .map(draft => draft.modelName);

    syncSelectedModelDrafts(remainingModelNames, editingConfig || undefined, !!editingConfig?.id);
  };

  const startManualModelDraft = () => {
    setModelPickerOpen(false);
    setManualModelInput('');
    manualModelInputActiveRef.current = true;
    setIsAddingCustomModel(true);
  };

  const cancelManualModelDraft = () => {
    manualModelInputActiveRef.current = false;
    setIsAddingCustomModel(false);
    setManualModelInput('');
  };

  const addManualModelDraft = () => {
    if (!manualModelInputActiveRef.current || isEditorSaving) return;
    // Enter unmounts the input and may also trigger blur; apply the draft only once.
    cancelManualModelDraft();
    const trimmedModelName = manualModelInput.trim();
    if (!trimmedModelName) return;

    const alreadyInDrafts = selectedModelDrafts.some(
      draft => modelNameLookupKey(draft.modelName) === modelNameLookupKey(trimmedModelName)
    );

    if (alreadyInDrafts) {
      notification.info(t('providerSelection.modelAlreadyInList'));
      return;
    }

    const nextModelNames = editingConfig?.id
      ? [trimmedModelName]
      : uniqModelNames([
        ...selectedModelDrafts.map(draft => draft.modelName),
        trimmedModelName,
      ]);

    syncSelectedModelDrafts(nextModelNames, editingConfig || undefined, !!editingConfig?.id);
  };

  const buildModelDiscoveryConfig = (config: Partial<AIModelConfigType>): AIModelConfigType | null => {
    const resolvedBaseUrl = (config.base_url || currentTemplate?.baseUrl || '').trim();
    const resolvedProvider = (config.provider || currentTemplate?.format || 'openai').trim();
    const resolvedAuth = config.auth || { type: 'api_key' };
    const resolvedApiKey = openCodeApiKey({ ...config, base_url: resolvedBaseUrl });
    const resolvedModelName = (
      config.model_name ||
      selectedModelDrafts[0]?.modelName ||
      currentTemplate?.models[0] ||
      'model-discovery'
    ).trim();

    // CLI-backed auth (Codex/Gemini) resolves the bearer token at request time
    // from `~/.codex` or `~/.gemini`, so we must NOT gate discovery on the
    // user pasting an API key. Only the legacy `api_key` mode requires it.
    // No-key providers (e.g. local Ollama) skip the API key requirement entirely.
    const requiresApiKey = resolvedAuth.type === 'api_key'
      && currentTemplate?.requiresApiKey !== false;
    if (!resolvedBaseUrl || !resolvedProvider || (requiresApiKey && !resolvedApiKey)) {
      return null;
    }

    return {
      id: config.id || 'model_discovery',
      name: config.name || 'Model Discovery',
      provider: resolvedProvider,
      api_key: resolvedApiKey,
      base_url: resolvedBaseUrl,
      request_url: config.request_url || resolveRequestUrl(resolvedBaseUrl, resolvedProvider, resolvedModelName),
      model_name: resolvedModelName,
      context_window: config.context_window || 300000,
      max_tokens: config.max_tokens,
      temperature: config.temperature,
      top_p: config.top_p,
      enabled: config.enabled ?? true,
      category: config.category || 'general_chat',
      capabilities: config.capabilities || ['text_chat'],
      recommended_for: config.recommended_for || [],
      metadata: config.metadata || {},
      inline_think_in_text: config.inline_think_in_text ?? true,
      reasoning: canonicalReasoningConfig(config),
      custom_headers: config.custom_headers,
      custom_headers_mode: config.custom_headers_mode,
      skip_ssl_verify: config.skip_ssl_verify ?? false,
      custom_request_body: config.custom_request_body,
      custom_request_body_mode: config.custom_request_body_mode,
      auth: resolvedAuth,
    };
  };

  const buildModelDiscoverySignature = (config: AIModelConfigType): string => JSON.stringify({
    provider: config.provider,
    base_url: config.base_url,
    api_key: config.api_key,
    model_name: config.model_name,
    inline_think_in_text: config.inline_think_in_text ?? true,
    skip_ssl_verify: config.skip_ssl_verify ?? false,
    custom_headers_mode: config.custom_headers_mode || null,
    custom_headers: config.custom_headers || null,
    custom_request_body: config.custom_request_body || null,
    custom_request_body_mode: config.custom_request_body_mode || null,
    auth: config.auth || { type: 'api_key' },
  });

  const fetchRemoteModels = async (config: Partial<AIModelConfigType> | null, force = false) => {
    if (!config) return;
    const discoveryConfig = buildModelDiscoveryConfig(config);
    if (!discoveryConfig) {
      setRemoteModelOptions([]);
      setRemoteModelsError(t('providerSelection.fillApiKeyBeforeFetch'));
      setHasAttemptedRemoteFetch(true);
      return;
    }
    const coordinator = modelDiscoveryRef.current;
    const scope = getActiveSurfaceScope();
    const operation = coordinator.begin(scope.key(buildModelDiscoverySignature(discoveryConfig)), force);
    if (!operation) return;
    const subscription = discoveryConfig.auth?.type === 'subscription';
    setIsFetchingRemoteModels(true);
    setRemoteModelsError(null);
    setHasAttemptedRemoteFetch(true);
    let succeeded = false;
    try {
      let remoteModels: RemoteModelOption[];
      if (isOpenCodeZenOAuth(discoveryConfig)) {
        const account = await aiApi.refreshSubscriptionAccount('opencode');
        if (!scope.isCurrent() || !coordinator.isCurrent(operation)) return;
        setSubscriptionAccounts(current => current.map(item => item.provider === 'opencode' ? account : item));
        remoteModels = openCodeZenModels(account.api_offerings ?? []);
      } else {
        remoteModels = await aiApi.listModelsByConfig(discoveryConfig);
      }
      if (!scope.isCurrent() || !coordinator.isCurrent(operation)) return;
      const dedupedModels = remoteModels.filter((model, index, arr) => (
        !!model.id && arr.findIndex(item => item.id === model.id) === index
      ));
      setRemoteModelOptions(dedupedModels);
      if (dedupedModels.length === 0) {
        setRemoteModelsError(t(subscription
          ? 'providerSelection.subscriptionFetchEmpty'
          : 'providerSelection.fetchEmptyFallback'));
        return;
      }
      succeeded = true;
    } catch (error) {
      if (!scope.isCurrent() || !coordinator.isCurrent(operation)) return;
      log.warn('Failed to fetch remote model list', { error });
      setRemoteModelOptions([]);
      setRemoteModelsError(t(subscription
        ? 'providerSelection.subscriptionFetchFailed'
        : 'providerSelection.fetchFailedFallback'));
    } finally {
      if (coordinator.complete(operation, succeeded) && scope.isCurrent()) setIsFetchingRemoteModels(false);
    }
  };

  const handleModelSelectionOpenChange = (isOpen: boolean) => {
    setModelPickerOpen(isOpen);
    if (!isOpen || !editingConfig || isFetchingRemoteModels) return;
    const authType = editingConfig.auth?.type ?? 'api_key';
    const providerNeedsApiKey = currentTemplate?.requiresApiKey !== false;
    if (authType === 'api_key' && providerNeedsApiKey && !openCodeApiKey(editingConfig)) return;
    if (hasAttemptedRemoteFetch) return;
    if (remoteModelOptions.length > 0) return;
    void fetchRemoteModels(editingConfig);
  };

  // Stable callback for the inline local-model manager to notify the form that
  // the downloaded model set changed (pull completed / refreshed). The ref
  // always reads the latest editingConfig + fetchRemoteModels so the callback
  // identity stays stable and does not re-trigger the panel's event listeners.
  const handleLocalModelsChangedRef = React.useRef<() => void>(() => {});
  handleLocalModelsChangedRef.current = () => {
    resetRemoteModelDiscovery();
    if (editingConfig) {
      void fetchRemoteModels(editingConfig);
    }
  };
  const handleLocalModelsChanged = useCallback(() => {
    handleLocalModelsChangedRef.current();
  }, []);

  const requestEditorOpen = useCallback((targetKey: string, open: () => void) => {
    const matchesSuspendedDraft = editingTargetKey === targetKey
      || (targetKey === 'new-provider' && editingTargetKey?.startsWith('new-provider:'));
    if (!isEditing && editingConfig && editingModalHasUnsavedChanges) {
      if (matchesSuspendedDraft) {
        setIsEditing(true);
        return;
      }
      pendingEditorOpenRef.current = { open };
      setDraftConflictConfirmOpen(true);
      return;
    }
    open();
  }, [editingConfig, editingModalHasUnsavedChanges, editingTargetKey, isEditing]);


  const handleCreateNew = () => {
    requestEditorOpen('new-provider', () => {
      editorModelsSnapshot.current = structuredClone(aiModels);
      setEditorBaseline(null);
      resetRemoteModelDiscovery();
      setSelectedModelDrafts([]);
      setEditingProviderModelIds(new Set());
      setShowApiKey(false);
      setSelectedProviderId(null);
      setProviderQuery('');
      setShowAllProviders(false);
      setEditingTargetKey(null);
      setCreationMode('selection');
    });
  };

  const handleImportFromSubscription = useCallback((
    account: SubscriptionAccount,
  ) => {
    const targetKey = `new-provider:subscription:${account.provider}:default`;
    requestEditorOpen(targetKey, () => {
      editorModelsSnapshot.current = structuredClone(aiModels);
      setEditorBaseline(null);
      resetRemoteModelDiscovery();
      setShowApiKey(false);
      setSelectedProviderId(null);
      setEditingTargetKey(targetKey);
      setEditingConfig({
        name: account.display_label,
        provider: account.suggested_format,
        base_url: account.provider === 'opencode' ? 'https://opencode.ai/zen/v1' : account.suggested_base_url,
        // Leave request_url + model_name empty so the user must pick a model
        // from the live list. We never inject a hard-coded default slug.
        request_url: '',
        api_key: '',
        model_name: '',
        enabled: true,
        context_window: 300000,
        category: 'general_chat',
        capabilities: getCapabilitiesByCategory('general_chat'),
        recommended_for: [],
        metadata: {},
        inline_think_in_text: true,
        auth: {
          type: 'subscription',
          provider: account.provider,
        },
      });
      setSelectedModelDrafts([]);
      setEditingProviderModelIds(new Set());
      setShowAdvancedSettings(false);
      setCreationMode('form');
      setIsEditing(true);
    });
  }, [aiModels, requestEditorOpen, resetRemoteModelDiscovery]);

  const loginCoordinatorRef = React.useRef(new SubscriptionLoginCoordinator());
  const subscriptionLoginMountedRef = React.useRef(true);

  const pollSubscriptionLogin = useCallback(async (
    operation: SubscriptionLoginOperation,
    deadline: number,
  ) => {
    while (Date.now() < deadline) {
      if (!loginCoordinatorRef.current.isCurrent(operation)) {
        throw subscriptionLoginCancelledError();
      }
      const snapshot = await aiApi.getSubscriptionLoginStatus(
        operation.provider,
        operation.sessionId,
      );
      if (snapshot.session_id !== operation.sessionId) {
        throw new Error('Subscription login status returned a mismatched session');
      }
      if (snapshot.status === 'authorized') {
        return snapshot;
      }
      if (snapshot.status === 'failed' || snapshot.status === 'cancelled') {
        throw new Error(snapshot.error || `Login ${snapshot.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error('Login timed out');
  }, []);

  // Cancel any in-flight subscription login when the page unmounts so the
  // backend loopback server / device poll does not linger.
  useEffect(() => {
    const coordinator = loginCoordinatorRef.current;
    subscriptionLoginMountedRef.current = true;
    return () => {
      subscriptionLoginMountedRef.current = false;
      const pending = coordinator.current();
      if (pending && !pending.cancelled) {
        coordinator.requestCancel(pending.provider);
        // Cancel immediately when the backend placeholder already exists;
        // `settleSubscriptionLoginStart` retries after start returns to cover
        // the opposite command-order race.
        void aiApi.cancelSubscriptionLogin(pending.provider, pending.sessionId).catch(() => {});
      }
    };
  }, []);

  const handleSubscriptionLogin = useCallback(async (provider: SubscriptionProvider) => {
    if ((!isTauriRuntime() || isPeerDeviceModeActive()) && subscriptionLoginRequiresLocalDevice(provider)) {
      notification.error(t('subscriptionAuth.peerLoginRequiresLocalDevice'));
      return;
    }
    // The settings surface intentionally permits one authorization flow at a
    // time. This prevents a stale provider poll/finally block from clearing a
    // newer provider's state or leaving an undiscoverable backend session.
    const operation = loginCoordinatorRef.current.begin(provider);
    if (!operation) return;
    const requestedMethod = preferredSubscriptionLoginMethod(
      provider,
      isTauriRuntime() && !isPeerDeviceModeActive(),
    );
    setLoggingInProvider(provider);
    setSubscriptionLoginPanel({
      provider,
      method: requestedMethod,
      authorizationUrl: '',
      status: 'starting',
    });
    try {
      const started = await aiApi.startSubscriptionLogin(
        provider,
        operation.sessionId,
        requestedMethod,
      );
      const settlement = await settleSubscriptionLoginStart(
        loginCoordinatorRef.current,
        operation,
        () => aiApi.cancelSubscriptionLogin(provider, operation.sessionId),
      );
      if (settlement.cleanupError) {
        log.warn('Failed to cancel subscription login after start settled', {
          provider,
          error: String(settlement.cleanupError),
        });
      }
      if (!settlement.shouldContinue) {
        throw subscriptionLoginCancelledError();
      }
      if (started.session_id !== operation.sessionId) {
        throw new Error('Subscription login start returned a mismatched session');
      }
      // Older backends ignore the new method request and omit `method` in the
      // response. Infer their actual flow from the returned device code so a
      // new UI never shows device instructions for a legacy browser login.
      const actualMethod = started.method || (started.user_code ? 'device' : 'browser');
      // Authorization time starts after the provider has returned its URL or
      // device code; callback binding/device-code acquisition does not consume
      // the user's five-minute completion window.
      const deadlineMs = Date.now() + SUBSCRIPTION_LOGIN_TIMEOUT_MS;
      setSubscriptionLoginPanel({
        provider,
        method: actualMethod,
        authorizationUrl: started.authorization_url,
        userCode: started.user_code,
        deadlineMs,
        status: 'pending',
      });
      if (started.authorization_url) {
        try {
          await systemAPI.openExternal(started.authorization_url);
        } catch (openError) {
          // Keep polling: the backend login session is already running. Surface
          // the URL so the user can open it manually (relative URLs / opener
          // policy failures must not abort an otherwise valid login).
          log.warn('Failed to open subscription authorization URL', {
            provider,
            url: started.authorization_url,
            error: String(openError),
          });
          notification.info(
            t('subscriptionAuth.openUrlManually', { url: started.authorization_url }),
          );
        }
      }
      if (!loginCoordinatorRef.current.isCurrent(operation)) {
        throw subscriptionLoginCancelledError();
      }
      if (started.user_code) {
        notification.info(t('subscriptionAuth.userCodeHint', { code: started.user_code }));
      }
      await pollSubscriptionLogin(operation, deadlineMs);
      if (!loginCoordinatorRef.current.isCurrent(operation)) {
        throw subscriptionLoginCancelledError();
      }
      await refreshSubscriptionAccounts();
      if (!loginCoordinatorRef.current.isCurrent(operation)) {
        throw subscriptionLoginCancelledError();
      }
      setSubscriptionLoginPanel(null);
      notification.success(t('subscriptionAuth.loginSuccess'));
    } catch (e) {
      if ((e as Error).name === 'SubscriptionLoginCancelled' || operation.cancelled) {
        // `startSubscriptionLogin` may reject instead of returning after an
        // early cancellation. Mark that invocation settled and retry the
        // idempotent backend cancellation so no placeholder/session survives.
        if (!operation.startSettled && loginCoordinatorRef.current.owns(operation)) {
          loginCoordinatorRef.current.markStartSettled(operation);
        }
        let authorizationAlreadyCompleted = false;
        try {
          await aiApi.cancelSubscriptionLogin(provider, operation.sessionId);
        } catch (cancelError) {
          log.warn('Failed to finish subscription login cancellation', {
            provider,
            error: String(cancelError),
          });
        }
        try {
          // The backend cancellation command is a commit barrier. Refreshing
          // now truthfully surfaces the narrow case where authorization had
          // already crossed its commit boundary before the user cancelled.
          const accounts = await aiApi.listSubscriptionAccounts();
          if (subscriptionLoginMountedRef.current) {
            setSubscriptionAccounts(accounts);
          }
          authorizationAlreadyCompleted = accounts.some((account) => (
            account.provider === provider && account.connected
          ));
        } catch (refreshError) {
          log.warn('Failed to refresh subscription accounts after cancellation', {
            provider,
            error: String(refreshError),
          });
        }
        if (
          loginCoordinatorRef.current.owns(operation)
          && subscriptionLoginMountedRef.current
        ) {
          setSubscriptionLoginPanel(null);
          notification.info(t(
            authorizationAlreadyCompleted
              ? 'subscriptionAuth.loginCompletedBeforeCancel'
              : 'subscriptionAuth.loginCancelled',
          ));
        }
      } else {
        // Status/start failures can occur while the backend runner is still
        // active. Await the session-scoped cancellation barrier before freeing
        // the coordinator slot or presenting retry UI.
        if (!operation.startSettled && loginCoordinatorRef.current.owns(operation)) {
          loginCoordinatorRef.current.markStartSettled(operation);
        }
        try {
          await aiApi.cancelSubscriptionLogin(provider, operation.sessionId);
        } catch (cancelError) {
          log.warn('Failed to stop subscription login after an operation error', {
            provider,
            sessionId: operation.sessionId,
            error: String(cancelError),
          });
        }
        if (
          loginCoordinatorRef.current.isCurrent(operation)
          && subscriptionLoginMountedRef.current
        ) {
          setSubscriptionLoginPanel({
            provider,
            method: requestedMethod,
            authorizationUrl: '',
            userCode: undefined,
            status: 'failed',
            error: String(e),
          });
          notification.error(t('subscriptionAuth.loginFailed', { error: String(e) }));
        }
      }
    } finally {
      if (loginCoordinatorRef.current.complete(operation)) {
        if (subscriptionLoginMountedRef.current) {
          setLoggingInProvider(null);
        }
      }
    }
  }, [notification, pollSubscriptionLogin, refreshSubscriptionAccounts, t]);

  const handleCancelSubscriptionLogin = useCallback(async (provider: SubscriptionProvider) => {
    const operation = loginCoordinatorRef.current.requestCancel(provider);
    if (!operation) return;
    // Keep the coordinator slot and loading state reserved until the start
    // command has settled and any backend session has been cancelled.
    setSubscriptionLoginPanel((current) => (
      current?.provider === provider
        ? { ...current, status: 'cancelling' }
        : current
    ));
    // This first attempt makes cancellation responsive if the backend has
    // installed its placeholder. The start-settlement path retries, because
    // desktop command scheduling can deliver this request first.
    try {
      await aiApi.cancelSubscriptionLogin(provider, operation.sessionId);
    } catch (e) {
      log.warn('cancel_subscription_login failed', { error: String(e) });
    }
  }, []);

  const handleOpenSubscriptionAuthorization = useCallback(async (url: string) => {
    if (!url) return;
    try {
      await systemAPI.openExternal(url);
    } catch (error) {
      log.warn('Failed to open subscription authorization URL from pending card', {
        url,
        error: String(error),
      });
      notification.info(t('subscriptionAuth.openUrlManually', { url }));
    }
  }, [notification, t]);

  const handleCopySubscriptionCode = useCallback(async (code: string) => {
    try {
      await systemAPI.setClipboard(code);
      notification.success(t('subscriptionAuth.codeCopied'));
    } catch (error) {
      log.warn('Failed to copy subscription device code', { error: String(error) });
      notification.error(t('subscriptionAuth.copyCodeFailed'));
    }
  }, [notification, t]);

  const requestSubscriptionLogout = useCallback((account: SubscriptionAccount) => {
    const affectedModels = aiModels.filter((model) => (
      model.auth?.type === 'subscription' && model.auth.provider === account.provider
    ));
    setSubscriptionLogoutRequest({ account, affectedModels });
  }, [aiModels]);

  const confirmSubscriptionLogout = useCallback(async () => {
    const request = subscriptionLogoutRequest;
    if (!request) return;
    try {
      const result = await aiApi.logoutSubscriptionAccount(request.account.provider);
      // Metadata removal is the source of truth for connection state. Reflect
      // it immediately, then refresh before presenting either outcome notice.
      setSubscriptionAccounts((current) => current.map((account) => (
        account.provider === request.account.provider
          ? {
              ...account,
              connected: false,
              account: null,
              expires_at: null,
              reauthentication_required: false,
              vault_unavailable: false,
            }
          : account
      )));
      await refreshSubscriptionAccounts();
      setSubscriptionLogoutRequest(null);
      if (result.cleanup_pending) {
        log.warn('Subscription logout completed with credential cleanup pending', {
          provider: request.account.provider,
          warning: result.warning,
        });
        notification.warning(t('subscriptionAuth.logoutCleanupPending'));
      } else {
        notification.success(t('subscriptionAuth.logoutSuccess'));
      }
    } catch (e) {
      notification.error(t('subscriptionAuth.logoutFailed', { error: String(e) }));
    }
  }, [notification, refreshSubscriptionAccounts, subscriptionLogoutRequest, t]);

  const handleSubscriptionRefresh = useCallback(async (provider: SubscriptionProvider) => {
    if (subscriptionRefreshesRef.current.has(provider)) return;
    subscriptionRefreshesRef.current.add(provider);
    setRefreshingSubscriptionProviders(new Set(subscriptionRefreshesRef.current));
    const scope = getActiveSurfaceScope();
    try {
      await aiApi.refreshSubscriptionAccount(provider);
      if (!scope.isCurrent() || !subscriptionLoginMountedRef.current) return;
      await refreshSubscriptionAccounts();
      if (!scope.isCurrent() || !subscriptionLoginMountedRef.current) return;
      notification.success(t('subscriptionAuth.refreshSuccess'));
    } catch (e) {
      if (scope.isCurrent() && subscriptionLoginMountedRef.current) {
        notification.error(t('subscriptionAuth.refreshFailed', { error: String(e) }));
      }
    } finally {
      subscriptionRefreshesRef.current.delete(provider);
      if (subscriptionLoginMountedRef.current) {
        setRefreshingSubscriptionProviders(new Set(subscriptionRefreshesRef.current));
      }
    }
  }, [notification, refreshSubscriptionAccounts, t]);


  const handleSelectProvider = (providerId: string) => {
    const template = providerTemplates[providerId];
    if (!template) return;
    resetRemoteModelDiscovery();
    setShowApiKey(false);
    setSelectedProviderId(providerId);
    setEditorBaseline(null);
    setEditingTargetKey(`new-provider:${providerId}`);

    // Dynamically get translated name
    const providerName = t(`providers.${template.id}.name`);

    setEditingConfig({
      name: providerName,
      base_url: template.baseUrl,
      request_url: '',
      api_key: '',
      model_name: '',
      provider: template.format,
      enabled: true,
      context_window: 300000,
      category: 'general_chat',
      capabilities: getCapabilitiesByCategory('general_chat'),
      recommended_for: [],
      metadata: {},
      inline_think_in_text: true,
    });
    // Provider templates supply available choices, never an implicit selection.
    setSelectedModelDrafts([]);
    setEditingProviderModelIds(new Set());
    setShowAdvancedSettings(false);
    setCreationMode('form');
    setIsEditing(true);
  };


  const handleSelectCustom = () => {
    resetRemoteModelDiscovery();
    setEditingProviderModelIds(new Set());
    setShowApiKey(false);
    setSelectedProviderId(null);
    setEditorBaseline(null);
    setEditingTargetKey('new-provider:custom');
    setEditingConfig({
      name: '',
      base_url: 'https://open.bigmodel.cn/api/paas/v4',
      request_url: resolveRequestUrl('https://open.bigmodel.cn/api/paas/v4', 'openai'),
      api_key: '',
      model_name: '',
      provider: 'openai',
      enabled: true,
      context_window: 300000,
      category: 'general_chat',
      capabilities: getCapabilitiesByCategory('general_chat'),
      recommended_for: [],
      metadata: {},
      inline_think_in_text: true,
    });
    setSelectedModelDrafts([]);
    setShowAdvancedSettings(false);
    setCreationMode('form');
    setIsEditing(true);
  };

  const handleEditProvider = (config: AIModelConfigType) => {
    const providerName = getProviderDisplayName(config);
    const providerGroupKey = getProviderGroupKey(config);
    const targetKey = `provider:${providerGroupKey}`;
    requestEditorOpen(targetKey, () => {
      editorModelsSnapshot.current = structuredClone(aiModels);
      setEditorBaseline(null);
      resetRemoteModelDiscovery();
      setShowApiKey(false);

      const configuredProviderModels = aiModels
        .filter(model => getProviderGroupKey(model) === providerGroupKey)
        .sort((a, b) => a.model_name.localeCompare(b.model_name));
      const providerTemplateId = getProviderTemplateId(config);
      setEditingProviderModelIds(new Set(
        configuredProviderModels
          .map(model => model.id)
          .filter((id): id is string => !!id)
      ));
      setSelectedProviderId(providerTemplateId || null);
      setEditingTargetKey(targetKey);
      setEditingConfig({
        name: providerName,
        base_url: config.base_url,
        request_url: resolveRequestUrl(config.base_url, config.provider || 'openai'),
        api_key: config.api_key || '',
        model_name: '',
        provider: config.provider,
        enabled: true,
        context_window: config.context_window || 300000,
        max_tokens: config.max_tokens,
        category: config.category || 'general_chat',
        capabilities: config.capabilities || getCapabilitiesByCategory(config.category || 'general_chat'),
        recommended_for: config.recommended_for || [],
        metadata: config.metadata || {},
        inline_think_in_text: config.inline_think_in_text ?? true,
        custom_headers: config.custom_headers,
        custom_headers_mode: config.custom_headers_mode,
        skip_ssl_verify: config.skip_ssl_verify ?? false,
        custom_request_body: config.custom_request_body,
        custom_request_body_mode: config.custom_request_body_mode,
        auth: config.auth || { type: 'api_key' },
      });
      setSelectedModelDrafts(createDraftsFromConfigs(configuredProviderModels));
      setShowAdvancedSettings(
        !!config.skip_ssl_verify ||
        config.custom_request_body_mode === 'trim' ||
        (!!config.custom_request_body && config.custom_request_body.trim() !== '') ||
        (!!config.custom_headers && Object.keys(config.custom_headers).length > 0)
      );
      setCreationMode('form');
      setIsEditing(true);
    });
  };

  const handleEdit = (config: AIModelConfigType) => {
    const targetKey = `model:${config.id || `${config.provider}:${config.base_url}:${config.model_name}`}`;
    requestEditorOpen(targetKey, () => {
      editorModelsSnapshot.current = structuredClone(aiModels);
      setEditorBaseline(null);
      resetRemoteModelDiscovery();
      setEditingProviderModelIds(new Set());
      setShowApiKey(false);
      setEditingTargetKey(targetKey);
      setSelectedProviderId(getProviderTemplateId(config) || null);
      setEditingConfig({ ...config, name: getProviderDisplayName(config) });
      setSelectedModelDrafts([
        createModelDraft(config.model_name, config, {
          contextWindow: config.context_window || 300000,
          maxTokens: config.max_tokens,
          reasoning: canonicalReasoningConfig(config),
        })
      ]);

      const hasCustomHeaders = !!config.custom_headers && Object.keys(config.custom_headers).length > 0;
      const hasCustomBody = !!config.custom_request_body && config.custom_request_body.trim() !== '';
      setShowAdvancedSettings(
        hasCustomHeaders ||
        hasCustomBody ||
        config.custom_request_body_mode === 'trim' ||
        !!config.skip_ssl_verify
      );
      setIsEditing(true);
    });
  };

  const runConfigConnectionTest = useCallback(async (config: AIModelConfigType) => {
    const configId = config.id;
    if (!configId || !connectionTestSupported) return;

    const scope = getActiveSurfaceScope();
    const signature = stableJson(config);
    const activeTest = activeConnectionTestsRef.current[configId];
    if (activeTest?.signature === signature) return;

    const token = Symbol(configId);
    activeConnectionTestsRef.current[configId] = { token, signature };
    setTestingConfigs(previous => ({ ...previous, [configId]: true }));
    setTestResults(previous => ({ ...previous, [configId]: null }));

    try {
      const result = await aiApi.testAIConfigConnection(config);
      if (!scope.isCurrent() || activeConnectionTestsRef.current[configId]?.token !== token) return;

      const baseMessage = result.success ? t('messages.testSuccess') : t('messages.testFailed');
      let message = baseMessage + (result.response_time_ms ? ` (${result.response_time_ms}ms)` : '');
      const localizedMessage = translateConnectionTestMessage(result.message_code, t);

      if (localizedMessage) {
        message += `\n${localizedMessage}`;
      }
      if (result.error_details) {
        message += result.success
          ? `\n${result.error_details}`
          : `\n${t('messages.errorDetails')}: ${result.error_details}`;
      }

      setTestResults(previous => ({
        ...previous,
        [configId]: { success: result.success, message },
      }));
    } catch (error) {
      if (!scope.isCurrent() || activeConnectionTestsRef.current[configId]?.token !== token) return;
      const message = `${t('messages.testFailed')}\n${t('messages.errorDetails')}: ${error}`;
      setTestResults(previous => ({
        ...previous,
        [configId]: { success: false, message },
      }));
      log.warn('Model connection test failed', { configId, error });
    } finally {
      if (scope.isCurrent() && activeConnectionTestsRef.current[configId]?.token === token) {
        delete activeConnectionTestsRef.current[configId];
        setTestingConfigs(previous => ({ ...previous, [configId]: false }));
      }
    }
  }, [connectionTestSupported, t]);

  const handleSave = async (): Promise<boolean> => {
    const scope = getActiveSurfaceScope();
    if (editorSavingRef.current) return false;

    if (!editingConfig) return false;
    if (providerIdentityLocked && !configuredProvider) {
      notification.error(t('messages.providerRemoved'));
      return false;
    }
    const providerConfig = configuredProvider ? { ...editingConfig, name: getProviderDisplayName(configuredProvider), auth: configuredProvider.auth || { type: 'api_key' as const } } : editingConfig;
    setShowModelValidation(true);
    if (modelValidationMessage) return false;

    editorSavingRef.current = true;
    setIsEditorSaving(true);
    try {
      const providerName = providerConfig.name?.trim() || '';
      const baseUrl = providerConfig.base_url?.trim() || '';
      if (!hasHttpUrlScheme(baseUrl)) {
        notification.warning(t('messages.invalidBaseUrlScheme'));
        return false;
      }
      const draftsToSave = dedupeSelectedModelDraftsByModelName(selectedModelDrafts)
        .map(draft => ({ ...draft, modelName: draft.modelName.trim() }));
      if (draftsToSave.length !== selectedModelDrafts.length) {
        notification.warning(t('messages.duplicateModelNameUnderProvider'));
        return false;
      }
      if (draftsToSave.some(draft => draft.contextWindow < 32000)) {
        notification.warning(t('messages.contextWindowTooSmall'));
        return false;
      }
      const reasoningValidationResults = draftsToSave.map(draft => ({
        modelName: draft.modelName,
        reasoning: draft.reasoning,
        projectionCatalog: draft.reasoningProjectionCatalog,
        snapshotCatalog: draft.reasoningProjectionSnapshot?.catalog,
        generatedPresetIds: resolveDraftReasoningProjection(draft)?.presets
          ?.filter(preset => preset.source !== 'model_config')
          .map(preset => preset.id) ?? [],
      })).map(entry => ({
        ...entry,
        validationError: validateReasoningConfig(entry.reasoning, entry.generatedPresetIds),
      }));
      if (reasoningValidationResults.some(entry => entry.validationError !== null)) {
        notification.warning(t('messages.invalidReasoningPresets'));
        return false;
      }
      const existingProviderInstanceId = getProviderInstanceId(providerConfig);
      const isProviderGroupEdit = !providerConfig.id && editingProviderModelIds.size > 0;
      const providerInstanceId = existingProviderInstanceId || generateProviderInstanceId();
      const providerGroupModelIds = isProviderGroupEdit
        ? editingProviderModelIds
        : new Set<string>();
      const allocatedConfigIds = new Set(
        aiModels
          .map(model => model.id?.trim())
          .filter((id): id is string => Boolean(id))
      );
      let apiKeyModels = remoteModelOptions;
      const zenOAuth = isOpenCodeZenOAuth(providerConfig);
      const routeConfig = providerConfig;
      if (zenOAuth && apiKeyModels.length === 0) {
        const scope = getActiveSurfaceScope();
        const account = await aiApi.refreshSubscriptionAccount('opencode');
        if (!scope.isCurrent()) return false;
        apiKeyModels = openCodeZenModels(account.api_offerings ?? []);
      }
      if (isOpenCodeApiKeyConfig(providerConfig) && apiKeyModels.length === 0) {
        const scope = getActiveSurfaceScope();
        const discoveryConfig = buildModelDiscoveryConfig(providerConfig);
        if (!discoveryConfig) throw new Error(t('providerSelection.fillApiKeyBeforeFetch'));
        apiKeyModels = await aiApi.listModelsByConfig(discoveryConfig);
        if (!scope.isCurrent()) return false;
      }
      let configsToSave: AIModelConfigType[] = draftsToSave.map((draft) => {
        const id = providerConfig.id
          || draft.configId
          || allocateModelConfigId(draft.modelName, allocatedConfigIds);
        allocatedConfigIds.add(id);
        const apiKeyRoute = resolveOpenCodeModelRoute(routeConfig, draft.modelName, apiKeyModels);
        if ((zenOAuth || isOpenCodeApiKeyConfig(routeConfig)) && !apiKeyRoute
          && apiKeyModels.some(model => model.id === draft.modelName.trim())) {
          throw new Error(t('providerSelection.modelRoutingUnavailable'));
        }
        const existingModel = isOpenCodeApiKeyConfig(providerConfig)
          ? aiModels.find(model => model.id === (draft.configId || providerConfig.id)
            && model.model_name === draft.modelName && model.base_url === baseUrl)
          : undefined;
        const format = apiKeyRoute?.format
          || (isOpenCodeApiKeyConfig(routeConfig) ? draft.manualRequestFormat : undefined)
          || existingModel?.provider || providerConfig.provider || 'openai';
        const modelBaseUrl = apiKeyRoute?.base_url || baseUrl;
        return {
          id,
          name: providerName,
          base_url: modelBaseUrl,
          request_url: apiKeyRoute?.request_url || resolveRequestUrl(
            modelBaseUrl,
            format,
            draft.modelName
          ),
          api_key: openCodeApiKey(providerConfig),
          model_name: draft.modelName,
          provider: format,
          enabled: providerConfig.enabled ?? true,
          context_window: draft.contextWindow,
          max_tokens: draft.maxTokens,
          category: resolveModelCategory(draft.modelName, draft.category, format),
          capabilities: getCapabilitiesByCategory(resolveModelCategory(draft.modelName, draft.category, format)),
          recommended_for: providerConfig.recommended_for || [],
          metadata: {
            ...(aiModels.find(model => model.id === id)?.metadata || providerConfig.metadata || {}),
            [PROVIDER_INSTANCE_METADATA_KEY]: providerInstanceId,
          },
          reasoning: draft.reasoning,
          ...prepareModelEditorRequestSettingsForSave(draft.requestSettings),
          auth: providerConfig.auth || { type: 'api_key' },
        };
      });
      let previousModelsBeforeSave: AIModelConfigType[] = [];
      const updatedModels = await configManager.updateConfig<AIModelConfigType[]>('ai.models', current => {
        previousModelsBeforeSave = current;
        if (providerConfig.id) {
          if (!current.some(model => model.id === providerConfig.id)) {
            throw new Error('The model was removed while it was being edited');
          }
          return current.map(model => model.id === providerConfig.id
            ? { ...model, ...preserveModelAnnotations(model, configsToSave[0], draftsToSave[0].userTags) } : model);
        }
        if (isProviderGroupEdit) {
          return [
            ...current.filter(model => !providerGroupModelIds.has(model.id || '')),
            ...configsToSave.map((config, index) => ({
              ...current.find(model => model.id === config.id),
              ...preserveModelAnnotations(current.find(model => model.id === config.id), config, draftsToSave[index].userTags),
            })),
          ];
        }
        const occupiedIds = new Set(current.flatMap(model => model.id ? [model.id] : []));
        configsToSave = configsToSave.map(config => {
          const id = allocateModelConfigId(config.model_name, occupiedIds);
          occupiedIds.add(id);
          return { ...config, id };
        });
        return [...current, ...configsToSave.map((config, index) => preserveModelAnnotations(undefined, config, draftsToSave[index].userTags))];
      }, providerIdentityLocked ? { expectedValue: editorModelsSnapshot.current } : undefined);
      scope.assertCurrent('finish model edit');
      const configsToAutoTest = configsNeedingAutoTest(
        previousModelsBeforeSave,
        configsToSave,
        isProviderGroupEdit
      );
      setAiModels(updatedModels);
      // The host reconciles default selectors using model capabilities.


      setIsEditing(false);
      setEditingConfig(null);
      setModelPanelDraftKey(null);
      modelPanelInitialRef.current = null;
      setCreationMode(null);
      setSelectedProviderId(null);
      setEditingProviderModelIds(new Set());
      setSelectedModelDrafts([]);
      setEditingTargetKey(null);
      editorModelsSnapshot.current = structuredClone(aiModels);
      setEditorBaseline(null);
      setDraftCloseConfirmOpen(false);
      setDraftConflictConfirmOpen(false);


      if (connectionTestSupported) {
        void (async () => {
          for (const config of configsToAutoTest) {
            await runConfigConnectionTest(config);
          }
        })();
      } else if (configsToAutoTest.length > 0) {
        notification.info(t('messages.testUnsupportedOnHost'));
      }
      return true;
    } catch (error) {
      if (!scope.isCurrent()) return false;
      log.error('Failed to save config', error);
      if (error instanceof ConfigConflictError) await loadConfig(true);
      if (!scope.isCurrent()) return false;
      notification.error(t(error instanceof ConfigConflictError ? 'messages.configConflict' : 'messages.saveFailed'));
      return false;
    } finally {
      editorSavingRef.current = false;
      setIsEditorSaving(false);
    }
  };

  const closeEditingModal = () => {
    resetRemoteModelDiscovery();
    setSelectedModelDrafts([]);
    cancelManualModelDraft();
    returnModelFocusKeyRef.current = null;
    setEditingProviderModelIds(new Set());
    setShowApiKey(false);
    setIsEditing(false);
    setEditingConfig(null);
    setModelPanelDraftKey(null);
    modelPanelInitialRef.current = null;
    setCreationMode(null);
    setSelectedProviderId(null);
    setEditingTargetKey(null);
    setEditorBaseline(null);
    setProviderQuery('');
    setShowAllProviders(false);
    setReasoningPanelDraftKey(null);
    setDraftCloseConfirmOpen(false);
    setDraftConflictConfirmOpen(false);
    pendingEditorOpenRef.current = null;
    reasoningPanelInitialRef.current = null;
  };

  const inspectModelReferenceCount = async (modelIds: string[]): Promise<number> => {
    const [defaultModels, taskModels, agentModelDefaults] = await Promise.all([
      configManager.getConfig<unknown>('ai.default_models'),
      configManager.getConfig<unknown>('ai.task_models'),
      configManager.getConfig<unknown>('ai.agent_model_defaults'),
    ]);
    const ids = new Set(modelIds);
    return [defaultModels, taskModels, agentModelDefaults]
      .reduce<number>((count, value) => count + countModelConfigReferences(value, ids), 0);
  };

  const requestDelete = async (config: AIModelConfigType) => {
    if (!config.id) return;
    try {
      const referenceCount = await inspectModelReferenceCount([config.id]);
      setDeleteRequest({ kind: 'model', config, modelIds: [config.id], referenceCount });
    } catch (error) {
      log.error('Failed to inspect model references before deletion', { configId: config.id, error });
      notification.error(t('messages.referenceCheckFailed'));
    }
  };

  const requestProviderDelete = async (group: ProviderGroup) => {
    const modelIds = group.models
      .map(model => model.id)
      .filter((id): id is string => !!id);
    try {
      const referenceCount = await inspectModelReferenceCount(modelIds);
      setDeleteRequest({
        kind: 'provider',
        groupKey: group.key,
        providerName: group.providerName,
        modelIds,
        modelCount: group.models.length,
        referenceCount,
        discardsRetainedDraft: editingModalHasUnsavedChanges
          && editingTargetKey === `provider:${group.key}`,
      });
    } catch (error) {
      log.error('Failed to inspect provider model references before deletion', {
        providerGroupKey: group.key,
        error,
      });
      notification.error(t('messages.providerReferenceCheckFailed'));
    }
  };

  const handleDelete = async () => {
    const request = deleteRequest;
    if (!request) return;
    let deletedModelIds = request.modelIds;
    try {
      const updatedModels = await configManager.updateConfig<AIModelConfigType[]>(
        'ai.models',
        (current) => {
          if (request.kind === 'provider') {
            const result = removeProviderModelConfigs(current, request.groupKey);
            deletedModelIds = result.removed
              .map(model => model.id)
              .filter((id): id is string => !!id);
            return result.remaining;
          }
          return current.filter(model => model.id !== request.config.id);
        },
      );
      const deletedIdSet = new Set(deletedModelIds);
      deletedIdSet.forEach(id => {
        delete activeConnectionTestsRef.current[id];
      });
      setTestingConfigs(current => Object.fromEntries(
        Object.entries(current).filter(([id]) => !deletedIdSet.has(id)),
      ));
      setTestResults(current => Object.fromEntries(
        Object.entries(current).filter(([id]) => !deletedIdSet.has(id)),
      ));
      setExpandedIds(current => new Set([...current].filter(id => !deletedIdSet.has(id))));
      if (request.kind === 'provider') {
        if (editingTargetKey === `provider:${request.groupKey}`) {
          closeEditingModal();
        }
      } else if (editingTargetKey === `model:${request.config.id}`) {
        closeEditingModal();
      }
      setAiModels(updatedModels);
      setDeleteRequest(null);
      notification.success(t(
        request.kind === 'provider'
          ? 'messages.providerDeleteSuccess'
          : 'messages.deleteSuccess',
      ));
    } catch (error) {
      log.error(
        request.kind === 'provider' ? 'Failed to delete provider config' : 'Failed to delete model config',
        request.kind === 'provider'
          ? { providerGroupKey: request.groupKey, error }
          : { configId: request.config.id, error },
      );
      notification.error(t(
        request.kind === 'provider'
          ? 'messages.providerDeleteFailed'
          : 'messages.deleteFailed',
      ));
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleProviderGroup = (key: string) => {
    setExpandedProviderGroupKeys(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleTest = async (config: AIModelConfigType) => {
    await runConfigConnectionTest(config);
  };

  const handleToggleEnabled = async (config: AIModelConfigType, enabled: boolean) => {
    if (!config.id) return;

    try {
      const updatedModels = await configManager.updateConfig<AIModelConfigType[]>(
        'ai.models', current => current.map(model => model.id === config.id ? { ...model, enabled } : model)
      );
      setAiModels(updatedModels);
    } catch (error) {
      log.error('Failed to toggle model status', { configId: config.id, enabled, error });
      notification.error(t('messages.saveFailed'));
    }
  };


  const handleSaveProxy = async (): Promise<boolean> => {
    if (!isProxyDirty) return true;
    if (proxySavingRef.current) return false;
    if (proxyConfig.enabled && !proxyConfig.url.trim()) {
      setProxySaveError(t('messages.fillRequired'));
      return false;
    }
    proxySavingRef.current = true;
    setIsProxySaving(true);
    setProxySaveError(null);
    try {
      await configManager.setConfig('ai.proxy', proxyConfig);
      setSavedProxyConfig(proxyConfig);
      setProxySaveError(null);
      notification.success(t('proxy.saveSuccess'));
      return true;
    } catch (error) {
      log.error('Failed to save proxy config', error);
      setProxySaveError(t('messages.saveFailed'));
      notification.error(t('messages.saveFailed'));
      return false;
    } finally {
      proxySavingRef.current = false;
      setIsProxySaving(false);
    }
  };

  const handleSaveStreamTimeouts = async (): Promise<boolean> => {
    if (!isStreamTimeoutDirty) return true;
    if (streamTimeoutSavingRef.current) return false;
    if (isStreamTimeoutInvalid) {
      setStreamTimeoutSaveError(t('streamIdleTimeout.invalid'));
      notification.warning(t('streamIdleTimeout.invalid'));
      return false;
    }

    streamTimeoutSavingRef.current = true;
    setIsStreamTimeoutSaving(true);
    setStreamTimeoutSaveError(null);
    try {
      await Promise.all([
        configManager.setConfig(
          'ai.stream_idle_timeout_secs',
          parsedStreamIdleTimeout ?? null
        ),
        configManager.setConfig(
          'ai.stream_ttft_timeout_secs',
          parsedStreamTtftTimeout ?? null
        ),
      ]);
      setStreamIdleTimeoutInput(
        parsedStreamIdleTimeout != null ? String(parsedStreamIdleTimeout) : ''
      );
      setStreamTtftTimeoutInput(
        parsedStreamTtftTimeout != null ? String(parsedStreamTtftTimeout) : ''
      );
      setSavedStreamTimeouts({
        idle: parsedStreamIdleTimeout != null ? String(parsedStreamIdleTimeout) : '',
        ttft: parsedStreamTtftTimeout != null ? String(parsedStreamTtftTimeout) : '',
      });
      setStreamTimeoutSaveError(null);
      notification.success(t('streamIdleTimeout.saveSuccess'));
      return true;
    } catch (error) {
      log.error('Failed to save stream timeouts', error);
      setStreamTimeoutSaveError(t('messages.saveFailed'));
      notification.error(t('messages.saveFailed'));
      return false;
    } finally {
      streamTimeoutSavingRef.current = false;
      setIsStreamTimeoutSaving(false);
    }
  };

  const preserveEditingDraftAndClose = () => {
    setDraftCloseConfirmOpen(false);
    setIsEditing(false);
  };

  const requestCloseEditingModal = () => {
    if (editorSavingRef.current) return;
    if (editingModalHasUnsavedChanges) {
      setDraftCloseConfirmOpen(true);
      return;
    }
    closeEditingModal();
  };

  const continueEditingCurrentDraft = () => {
    pendingEditorOpenRef.current = null;
    setDraftConflictConfirmOpen(false);
    setIsEditing(true);
  };

  const discardDraftBeforeOpeningPendingEditor = () => {
    const pending = pendingEditorOpenRef.current;
    closeEditingModal();
    pending?.open();
  };

  const cancelPendingEditorOpen = () => {
    pendingEditorOpenRef.current = null;
    setDraftConflictConfirmOpen(false);
  };

  const discardProxyDraft = useCallback(() => {
    setProxyConfig(savedProxyConfig);
    setProxySaveError(null);
  }, [savedProxyConfig]);
  const discardStreamTimeoutDraft = useCallback(() => {
    setStreamIdleTimeoutInput(savedStreamTimeouts.idle);
    setStreamTtftTimeoutInput(savedStreamTimeouts.ttft);
    setStreamTimeoutSaveError(null);
  }, [savedStreamTimeouts]);

  useSettingsDraft({
    id: 'model-stream-timeouts',
    pageId: 'ai.models',
    label: t('streamIdleTimeout.title'),
    dirty: isStreamTimeoutDirty,
    saving: isStreamTimeoutSaving,
    save: handleSaveStreamTimeouts,
    discard: discardStreamTimeoutDraft,
  });
  useSettingsDraft({
    id: 'model-network-proxy',
    pageId: 'ai.models',
    label: tDefault('sections.proxy'),
    dirty: isProxyDirty,
    saving: isProxySaving,
    save: handleSaveProxy,
    discard: discardProxyDraft,
  });
  useSettingsDraft({
    id: 'model-provider-editor',
    pageId: 'ai.models',
    label: editingConfig?.id
      ? t('editModel')
      : getProviderInstanceId(editingConfig)
        ? t('editProvider')
        : t('newProvider'),
    dirty: editingConfig !== null && editingModalHasUnsavedChanges,
    saving: isEditorSaving,
    save: handleSave,
    discard: closeEditingModal,
  });

  const hasSuspendedEditorDraft = !isEditing
    && editingConfig !== null
    && editingModalHasUnsavedChanges;

  const providerGroups = useMemo<ProviderGroup[]>(() => {
    const grouped = aiModels.reduce<Map<string, ProviderGroup>>((map, model) => {
      const groupKey = getProviderGroupKey(model);
      const providerName = getProviderDisplayName(model);
      const existingGroup = map.get(groupKey);
      if (existingGroup) {
        existingGroup.models.push(model);
        return map;
      }

      map.set(groupKey, {
        key: groupKey,
        providerName,
        providerId: getProviderTemplateId(model),
        models: [model],
      });
      return map;
    }, new Map());

    return Array.from(grouped.values()).sort((a, b) => {
      const indexA = a.providerId ? providerOrder.indexOf(a.providerId) : -1;
      const indexB = b.providerId ? providerOrder.indexOf(b.providerId) : -1;

      if (indexA !== indexB) {
        return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
      }

      return a.providerName.localeCompare(b.providerName);
    });
  }, [aiModels, providerOrder]);

  const libraryRoles = useMemo(() => [
    { modelId: poolDefaults.primary, label: tDefault('core.primary.label') },
    { modelId: poolDefaults.fast, label: tDefault('core.fast.label') },
    { modelId: poolDefaults.image_understanding, label: tDefault('optional.capabilities.image_understanding.label') },
    { modelId: poolDefaults.speech_recognition, label: tDefault('optional.capabilities.speech_recognition.label') },
  ], [poolDefaults, tDefault]);
  const libraryProviderOptions = useMemo(() => [...new Map(aiModels.map(model => [
    getPoolProviderKey(model), model.auth?.type === 'subscription'
      ? t(`subscriptionAuth.options.${model.auth.provider}`) : getProviderDisplayName(model),
  ])).entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)), [aiModels, t]);
  const visibleLibraryModels = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    const priority = (model: AIModelConfigType) => model.id === poolDefaults.primary ? 0 : model.id === poolDefaults.fast ? 1 : 2;
    return aiModels.filter(model => {
      if (libraryCapability && !getEffectiveModelCapabilities(model).includes(libraryCapability)) return false;
      if (libraryProvider && getPoolProviderKey(model) !== libraryProvider) return false;
      const roles = libraryRoles.filter(role => role.modelId && role.modelId === model.id).map(role => role.label);
      return !query || [getModelDisplayName(model), model.model_name, getProviderDisplayName(model), ...getModelTags(model), ...roles].join(' ').toLowerCase().includes(query);
    }).sort((a, b) => priority(a) - priority(b));
  }, [aiModels, libraryQuery, libraryCapability, libraryProvider, libraryRoles, poolDefaults]);

  if (creationMode === 'selection') {
    return (
      <ConfigPageLayout className="bitfun-model-settings" data-bitfun-component="model-settings" data-bitfun-part="root" data-bitfun-view="selection">
        <ConfigPageHeader
          title={t('providerSelection.title')}
          subtitle={t('providerSelection.subtitle')}
        />

        <ConfigPageContent className="bitfun-model-settings__content bitfun-model-settings__content--selection">
          <div className="bitfun-model-settings__provider-selection" data-bitfun-component="model-settings" data-bitfun-part="providerSelection">

            <button
              type="button"
              data-testid="settings-model-custom-config-btn"
              data-provider-id="custom"
              className="bitfun-model-settings__custom-option"
              onClick={handleSelectCustom}
            >
              <div className="bitfun-model-settings__custom-option-content" data-bitfun-component="model-settings" data-bitfun-part="customOption">
                <Icon name="settings" size="lg" />
                <div>
                  <div className="bitfun-model-settings__custom-option-title" data-bitfun-component="model-settings" data-bitfun-part="customOptionTitle">{t('providerSelection.customTitle')}</div>
                  <div className="bitfun-model-settings__custom-option-description" data-bitfun-component="model-settings" data-bitfun-part="customOptionDescription">{t('providerSelection.customDescription')}</div>
                </div>
              </div>
            </button>


            <div className="bitfun-model-settings__selection-divider" data-bitfun-component="model-settings" data-bitfun-part="selectionDivider">
              <span>{t('providerSelection.orSelectProvider')}</span>
            </div>


            <SearchField
              leadingIcon={<Icon name="search" size="lg" aria-hidden />}
              size="sm"
              className="bitfun-model-settings__provider-search"
              data-testid="settings-model-provider-search"
              data-bitfun-component="model-settings"
              data-bitfun-part="providerSearch"
              value={providerQuery}
              placeholder={t('providerSelection.searchProviders')}
              aria-label={t('providerSelection.searchProviders')}
              onValueChange={setProviderQuery}
              onSearch={() => {
                const firstMatch = visibleProviders[0];
                if (normalizedProviderQuery && firstMatch) handleSelectProvider(firstMatch.id);
              }}
            />


            <div className="bitfun-model-settings__provider-list" data-bitfun-component="model-settings" data-bitfun-part="providerList">
              {visibleProviders.map(provider => (
                // The help link is a sibling of the select button, not a child:
                // a button may not contain interactive content.
                <div
                  key={provider.id}
                  className="bitfun-model-settings__provider-row"
                  data-bitfun-component="model-settings"
                  data-bitfun-part="providerRow"
                >
                  <button
                    type="button"
                    data-testid="settings-model-provider-option"
                    data-provider-id={provider.id}
                    className="bitfun-model-settings__provider-select"
                    data-bitfun-component="model-settings"
                    data-bitfun-part="providerSelect"
                    onClick={() => handleSelectProvider(provider.id)}
                  >
                    <span className="bitfun-model-settings__provider-name" data-bitfun-component="model-settings" data-bitfun-part="providerName">{provider.name}</span>
                    <span className="bitfun-model-settings__provider-description" data-bitfun-component="model-settings" data-bitfun-part="providerDescription">{provider.description}</span>
                  </button>
                  {provider.helpUrl && (
                    <a
                      href={provider.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bitfun-model-settings__provider-help-link"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        try {
                          await systemAPI.openExternal(provider.helpUrl!);
                        } catch (error) {
                          console.error('[ModelSettings] Failed to open external URL:', error);
                        }
                      }}
                    >
                      <Icon name="arrow-up-right" size="xs" />
                      {t('providerSelection.getApiKey')}
                    </a>
                  )}
                  <Icon name="chevron-right" size="sm" className="bitfun-model-settings__provider-chevron" aria-hidden="true" />
                </div>
              ))}

              {visibleProviders.length === 0 && (
                <div className="bitfun-model-settings__provider-empty" data-bitfun-component="model-settings" data-bitfun-part="providerEmpty">
                  {t('providerSelection.noProviderMatches')}
                </div>
              )}

              {canToggleProviderList && (
                <button
                  type="button"
                  data-testid="settings-model-provider-expand-btn"
                  className="bitfun-model-settings__provider-more"
                  data-bitfun-component="model-settings"
                  data-bitfun-part="providerMore"
                  onClick={() => setShowAllProviders(previous => !previous)}
                >
                  {isProviderListCollapsed
                    ? t('providerSelection.showAllProviders', { count: matchedProviders.length })
                    : t('providerSelection.collapseProviders')}
                  {isProviderListCollapsed ? <Icon name="chevron-down" size="sm" /> : <Icon name="chevron-up" size="sm" />}
                </button>
              )}
            </div>


            <div className="bitfun-model-settings__selection-actions" data-bitfun-component="model-settings" data-bitfun-part="selectionActions">
              <Button variant="fill" size="sm" onClick={() => setCreationMode(null)}>
                {t('actions.cancel')}
              </Button>
            </div>
          </div>
        </ConfigPageContent>
      </ConfigPageLayout>
    );
  }


  const renderEditingForm = () => {
    if (!isEditing || !editingConfig) return null;
    const zenOAuth = isOpenCodeZenOAuth(editingConfig);
    const routeConfig = editingConfig;
    const automaticOpenCodeRouting = zenOAuth || isOpenCodeApiKeyConfig(routeConfig);
    const isProviderScopedEditing = !editingConfig.id && !modelPanelDraft;
    const catalogProvider = selectedProviderId
      ? modelCatalog?.provider_catalog?.providers.find(provider => provider.id === selectedProviderId)
      : undefined;
    const normalizedEditingBaseUrl = editingConfig.base_url
      ? normalizeProviderBaseUrl(editingConfig.base_url)
      : '';
    const selectedEndpointId = catalogProvider?.endpoints
      .filter(endpoint => !editingConfig.provider || endpoint.api_format === editingConfig.provider)
      .sort((left, right) => (
        normalizeProviderBaseUrl(right.base_url).length
        - normalizeProviderBaseUrl(left.base_url).length
      ))
      .find(endpoint => {
        const normalizedEndpoint = normalizeProviderBaseUrl(endpoint.base_url);
        return normalizedEndpoint === normalizedEditingBaseUrl
          || normalizedEndpoint.startsWith(`${normalizedEditingBaseUrl}/`)
          || normalizedEditingBaseUrl.startsWith(`${normalizedEndpoint}/`);
      })?.id;
    const endpointOptions = endpointPresetsForFormat(currentTemplate?.baseUrlOptions, editingConfig.provider || 'openai');
    const selectedEndpoint = findSelectedEndpointPreset(currentTemplate?.baseUrlOptions, editingConfig.base_url || '', editingConfig.provider || 'openai');
    const renderEndpointPicker = () => endpointOptions.length > 0 && (
      <Combobox
        data-testid="settings-model-endpoint-select"
        invalid={showModelValidation && missingModelFields.baseUrl}
        value={selectedEndpoint?.url || ''}
        onValueChange={value => {
          resetRemoteModelDiscovery();
          setEditingConfig(previous => ({
            ...previous,
            base_url: String(value),
            request_url: resolveRequestUrl(String(value), previous?.provider || 'openai'),
          }));
        }}
        placeholder={t('form.baseUrl')}
        options={endpointOptions.map(option => ({ label: option.note || option.url, value: option.url, description: option.url }))}
        size="sm"
      />
    );
    const changeRequestFormat = (provider: string) => {
      resetRemoteModelDiscovery();
      setEditingConfig(previous => {
        if (!previous) return previous;
        const baseUrl = remapBaseUrlForFormat(currentTemplate?.baseUrlOptions, previous.base_url || '', previous.provider || 'openai', provider, currentTemplate?.baseUrl);
        return { ...previous, provider, base_url: baseUrl, request_url: resolveRequestUrl(baseUrl, provider) };
      });
    };
    const catalogModelOptions: ComboboxOption[] = (catalogProvider?.models || [])
      .filter(model => (
        !selectedEndpointId
        || !model.endpoint_ids?.length
        || model.endpoint_ids.includes(selectedEndpointId)
      ))
      .map(model => ({
        label: model.display_name || model.id,
        value: model.id,
        description: model.display_name && model.display_name !== model.id ? model.id : undefined,
        testId: 'settings-model-option',
        testAttributes: {
          'data-model-id': model.id,
          'data-model-name': model.id,
          'data-model-source': model.source,
        },
      }));
    const fetchedOrPresetModelOptions: ComboboxOption[] = remoteModelOptions.length > 0
      ? remoteModelOptions.map(model => ({
          label: model.display_name || model.id,
          value: model.id,
          description: model.display_name && model.display_name !== model.id ? model.id : undefined,
          testId: 'settings-model-option',
          testAttributes: {
            'data-model-id': model.id,
            'data-model-name': model.id,
          },
        }))
      : editingConfig.auth?.type === 'subscription'
        ? []
        : catalogModelOptions.length > 0
        ? catalogModelOptions
        : (currentTemplate?.models || []).map(model => ({
          label: model,
          value: model,
          testId: 'settings-model-option',
          testAttributes: {
            'data-model-id': model,
            'data-model-name': model,
          },
        }));
    const modelFetchHint = isFetchingRemoteModels
      ? t('providerSelection.fetchingModels')
      : remoteModelsError
        ? remoteModelsError
        : remoteModelOptions.length > 0
          ? null
          : fetchedOrPresetModelOptions.length > 0
            ? t('providerSelection.usingPresetModels')
            : hasAttemptedRemoteFetch
              ? t('providerSelection.noPresetModels')
              : null;
    const selectedModelValues = selectedModelDrafts.map(draft => draft.modelName);
    const apiKeyVisibilityLabel = showApiKey ? tComponents('hide') : tComponents('show');
    const apiKeySuffix = (
      <IconButton
        type="button"
        className="bitfun-model-settings__input-visibility-toggle"
        onClick={() => setShowApiKey(prev => !prev)}
        aria-label={apiKeyVisibilityLabel}
        title={apiKeyVisibilityLabel}
        icon={showApiKey ? <EyeOff size={14} /> : <Icon name="eye" size="sm" />}
      />
    );

    const formatReasoningSummary = (
      draft: SelectedModelDraft,
      generatedProjection?: ReasoningCatalogProjection,
    ) => {
      const presetCount = draft.reasoning.presets?.length ?? 0;
      const catalogSource = draft.reasoning.catalog?.source ?? 'auto';
      const catalogLabel = catalogSource === 'models_dev'
        ? t('reasoningPresets.catalogSummary.modelsDev')
        : catalogSource === 'disabled'
          ? t('reasoningPresets.catalogSummary.disabled')
          : t('reasoningPresets.catalogSummary.auto');
      const selected = draft.reasoning.presets?.find(
        preset => preset.id === draft.reasoning.default_preset,
      ) ?? generatedProjection?.presets?.find(
        preset => preset.id === draft.reasoning.default_preset,
      );
      const defaultLabel = draft.reasoning.default_preset
        ? selected?.label?.trim() || selected?.id || draft.reasoning.default_preset
        : t('reasoningPresets.autoShort');
      return presetCount > 0
        ? t('reasoningPresets.summaryWithCustom', {
            source: catalogLabel,
            default: defaultLabel,
            count: presetCount,
          })
        : t('reasoningPresets.summary', {
            source: catalogLabel,
            default: defaultLabel,
          });
    };

    const renderModelField = (
      label: string,
      control: React.ReactElement,
      options: { hint?: string; description?: React.ReactNode; className?: string } = {},
    ) => {
      const labelAction = options.hint ? (
        <Tooltip content={options.hint} placement="top">
          <IconButton
            size="xs"
            variant="quiet"
            aria-label={options.hint}
            icon={<Icon name="info" size="sm" />}
          />
        </Tooltip>
      ) : undefined;

      return (
        <ConfigPageRow
          label={labelAction ? (
            <span className="bitfun-model-settings__inline-header-main">{label}{labelAction}</span>
          ) : label}
          description={options.description}
          className={options.className}
          align="center"
        >
          {control}
        </ConfigPageRow>
      );
    };

    const renderModelFields = (draft: SelectedModelDraft) => {
      const reasoningProjection = resolveDraftReasoningProjection(draft);
      const catalogHasModel = remoteModelOptions.some(model => model.id === draft.modelName.trim());
      const canEditManualRoute = remoteModelOptions.length > 0 && !catalogHasModel && !isFetchingRemoteModels;
      const savedModelId = draft.configId || editingConfig.id;
      const savedModel = savedModelId ? aiModels.find(model => model.id === savedModelId) : undefined;
      const modelRoute = resolveOpenCodeModelRoute(routeConfig, draft.modelName, remoteModelOptions)
        || (!catalogHasModel && !canEditManualRoute ? savedOpenCodeApiKeyRoute(
          { ...routeConfig, id: savedModelId },
          draft.modelName,
          savedModel,
        ) : undefined);
      const manualFormat = draft.manualRequestFormat || editingConfig.provider || 'openai';
      const contextWarning = draft.contextWindowEdited && draft.contextWindow > LONG_CONTEXT_WARNING_THRESHOLD_TOKENS ? (
        <span role="status" id={`model-context-warning-${draft.key}`} className="bitfun-model-settings__warning-inline bitfun-model-settings__context-window-warning">
          <AlertTriangle size={14} />
          <span>{t('form.contextWindowLongWarning')}</span>
        </span>
      ) : undefined;
      const editReasoning = () => {
        reasoningPanelInitialRef.current = {
          key: draft.key,
          reasoning: cloneReasoningConfig(draft.reasoning),
          reasoningProjectionCatalog: draft.reasoningProjectionCatalog,
          reasoningProjectionSnapshot: draft.reasoningProjectionSnapshot,
        };
        setReasoningPanelDraftKey(draft.key);
      };

      return (
        <>
          {automaticOpenCodeRouting && renderModelField(
            t('form.provider'),
            modelRoute ? (
              <span>{requestFormatLabelMap[modelRoute.format] || modelRoute.format}</span>
            ) : canEditManualRoute ? (
              <Select
                aria-label={t('form.provider')}
                value={manualFormat}
                onValueChange={value => updateModelDraft(draft.key, { manualRequestFormat: String(value) })}
                options={requestFormatOptions.filter(option => ['openai', 'responses', 'anthropic'].includes(String(option.value)))}
                size="sm"
              />
            ) : (
              <span>{t(catalogHasModel ? 'providerSelection.modelRoutingUnavailable' : 'providerSelection.modelRoutingPending')}</span>
            ),
          )}
          {renderModelField(
            t('category.label'),
            <Combobox
              aria-label={t('category.label')}
              value={draft.category}
              onValueChange={value => updateModelDraft(draft.key, { category: value as ModelCategory })}
              options={categoryOptions}
              size="sm"
              className="bitfun-model-settings__selected-model-category-select"
            />,
          )}
          {renderModelField(
            t('form.contextWindow'),
            <NumberInput
              aria-label={t('form.contextWindow')}
              aria-describedby={contextWarning ? `model-context-warning-${draft.key}` : undefined}
              className="bitfun-model-settings__selected-model-context-input"
              value={draft.contextWindow}
              formatValue={value => i18nService.formatNumber(value, { useGrouping: true, maximumFractionDigits: 0 })}
              onValueChange={value => updateModelDraft(draft.key, { contextWindow: value, contextWindowEdited: true })}
              min={32000}
              max={2000000}
              step={1000}
              size="sm"
              disableWheel
            />,
            {
              hint: t('form.contextWindowHint'),
              description: contextWarning,
              className: 'bitfun-model-settings__context-window-row',
            },
          )}
          {automaticOpenCodeRouting && (modelRoute || canEditManualRoute) && renderModelField(
            t('form.resolvedUrlLabel'),
            <span className="bitfun-model-settings__resolved-url-value">
              {modelRoute?.request_url || resolveRequestUrl(editingConfig.base_url || '', manualFormat, draft.modelName)}
            </span>,
          )}
          <ModelTagsField
            key={draft.key}
            layout="row"
            tags={draft.userTags ?? getModelUserTags(savedModel ?? {})}
            recommendedTags={savedModel?.recommended_for}
            disabled={isEditorSaving}
            onChange={userTags => updateModelDraft(draft.key, { userTags })}
          />
          <ConfigPageRow
            label={t('reasoningPresets.configTitle')}
            description={formatReasoningSummary(draft, reasoningProjection)}
            align="center"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={editReasoning}
              data-testid="settings-model-reasoning-edit"
            >
              {t('actions.edit')}
            </Button>
          </ConfigPageRow>
        </>
      );
    };

    const renderSelectedModelRows = () => {
      return (
        <div
          className="bitfun-model-settings__selected-models-list"
          data-testid="settings-model-selected-list"
          data-selected-count={selectedModelDrafts.length}
        >
          {selectedModelDrafts.length === 0 && !isAddingCustomModel && (
            <small
              className="bitfun-model-settings__selected-models-empty"
              data-testid="settings-model-selected-list-empty"
              data-selected-count="0"
            >
              {t('providerSelection.noModelsSelected')}
            </small>
          )}
          {selectedModelDrafts.map(draft => (
            <Capsule
              size="xs"
              key={draft.key}
              className="bitfun-model-settings__model-capsule"
              data-testid="settings-model-selected-row"
              data-model-id={draft.modelName}
              data-model-name={draft.modelName}
              data-selected="true"
              data-unsaved={modelDraftHasUnsavedChanges(draft, aiModels) ? 'true' : 'false'}
              action={(
                <Tooltip content={t('providerSelection.removeModel')}>
                  <IconButton
                    className="bitfun-model-settings__model-capsule-dismiss"
                    aria-label={t('providerSelection.removeModelByName', { name: draft.modelName })}
                    data-testid="settings-model-selected-remove-btn"
                    data-model-id={draft.modelName}
                    data-model-name={draft.modelName}
                    size="xs"
                    shape="circle"
                    variant="quiet"
                    onClick={() => removeSelectedModelDraft(draft.modelName)}
                    disabled={isEditorSaving}
                    icon={<Icon name="xmark" size="xs" />}
                  />
                </Tooltip>
              )}
            >
              <Button
                ref={element => {
                  if (element) modelCapsuleRefs.current.set(draft.key, element);
                  else modelCapsuleRefs.current.delete(draft.key);
                }}
                variant="fill"
                size="xs"
                className="bitfun-model-settings__model-capsule-edit"
                data-testid="settings-model-capsule-edit"
                aria-label={t('providerSelection.editModelSettings', { name: draft.modelName })}
                onClick={() => openModelPanel(draft)}
                disabled={isEditorSaving}
              >
                {draft.modelName}
              </Button>
            </Capsule>
          ))}
          {isAddingCustomModel && (
            <Input
              autoFocus
              size="xs"
              shape="pill"
              className="bitfun-model-settings__manual-model-input"
              data-testid="settings-model-manual-name-input"
              aria-label={t('providerSelection.addCustomModel')}
              placeholder={t('providerSelection.inputModelName')}
              value={manualModelInput}
              disabled={isEditorSaving}
              onChange={event => setManualModelInput(event.target.value)}
              onBlur={addManualModelDraft}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key !== 'Enter' && event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                if (event.key === 'Enter') addManualModelDraft();
                else cancelManualModelDraft();
                requestAnimationFrame(() => manualModelAddButtonRef.current?.focus());
              }}
            />
          )}
        </div>
      );
    };

    const authType = editingConfig.auth?.type || 'api_key';
    const authIsSubscription = authType === 'subscription';
    const selectedSubscriptionProvider: SubscriptionProvider | undefined =
      editingConfig.auth?.type === 'subscription' ? editingConfig.auth.provider : undefined;
    const legacyOpenCode = selectedSubscriptionProvider === 'opencode' && !zenOAuth;
    const authSelectValue = legacyOpenCode ? 'subscription:opencode:go' : authIsSubscription ? `subscription:${selectedSubscriptionProvider || 'codex'}` : 'api_key';
    const authOptions: ComboboxOption[] = [
      { value: 'api_key', label: t('subscriptionAuth.options.apiKey') },
      { value: 'subscription:codex', label: t('subscriptionAuth.options.codex') },
      { value: 'subscription:antigravity', label: t('subscriptionAuth.options.antigravity') },
      { value: 'subscription:grok', label: t('subscriptionAuth.options.grok') },
      { value: 'subscription:hermes', label: t('subscriptionAuth.options.hermes') },
      { value: 'subscription:opencode', label: t('subscriptionAuth.options.opencode') },
    ];
    if (legacyOpenCode) authOptions.push({ value: 'subscription:opencode:go', label: t('subscriptionAuth.openCodeRemoved') });
    const matchedSubscription = selectedSubscriptionProvider
      ? subscriptionAccounts.find((account) => account.provider === selectedSubscriptionProvider)
      : undefined;

    const renderAuthRow = () => (
      <ConfigPageRow label={t('subscriptionAuth.label')} align={authIsSubscription ? 'start' : 'center'} wide>
        <div className="bitfun-model-settings__control-stack">
          <Select
            value={authSelectValue}
            onValueChange={(value) => {
              const next = String(value);
              if (next === 'api_key') {
                setEditingConfig(prev => prev ? ({
                  ...prev,
                  api_key: legacyOpenCode ? '' : prev.api_key,
                  auth: { type: 'api_key' },
                }) : prev);
                return;
              }
              const provider = next.split(':')[1] as SubscriptionProvider;
              if (next === 'subscription:opencode:go') return;
              resetRemoteModelDiscovery();
              const account = subscriptionAccounts.find(item => item.provider === provider);
              setEditingConfig(prev => prev ? ({
                ...prev,
                provider: account?.suggested_format || prev.provider,
                base_url: provider === 'opencode' ? 'https://opencode.ai/zen/v1' : account?.suggested_base_url || prev.base_url,
                request_url: '',
                auth: { type: 'subscription', provider },
              }) : prev);
            }}
            options={authOptions}
            size="sm"
          />
          {authIsSubscription && (
            <small className={matchedSubscription?.connected
              ? 'resolved-url__hint bitfun-model-settings__cli-auth-hint'
              : 'resolved-url__hint bitfun-model-settings__cli-auth-hint bitfun-model-settings__json-status--error'}
            >
              {legacyOpenCode ? t('subscriptionAuth.openCodeRemoved') : matchedSubscription?.connected
                ? t('subscriptionAuth.detected', {
                    label: matchedSubscription.display_label,
                    account: matchedSubscription.account || t('subscriptionAuth.unknownAccount'),
                  })
                : t('subscriptionAuth.notConnected', {
                    kind: selectedSubscriptionProvider || 'subscription',
                  })}
            </small>
          )}
        </div>
      </ConfigPageRow>
    );

    const apiKeyRequired = !isOpenCodeZenApiKeyConfig(editingConfig);
    const renderApiKeyRow = (label: string) => (
      <ConfigPageRow label={label} required={apiKeyRequired} align="center" wide>
        <Input
          data-testid="settings-model-api-key-input"
          hideNativePasswordReveal
          invalid={showModelValidation && missingModelFields.apiKey}
          required={apiKeyRequired}
          type={showApiKey ? 'text' : 'password'}
          value={editingConfig.api_key || ''}
          onChange={(e) => {
            resetRemoteModelDiscovery();
            setEditingConfig(prev => ({ ...prev, api_key: e.target.value }));
          }}
          placeholder={t(apiKeyRequired ? 'form.apiKeyPlaceholder' : 'form.openCodeZenApiKeyPlaceholder')}
          trailing={apiKeySuffix}
          size="sm"
        />
      </ConfigPageRow>
    );

    const requestDraft = modelPanelDraft || (editingConfig.id ? selectedModelDrafts[0] : undefined);
    const requestSettings = requestDraft?.requestSettings ?? getModelEditorRequestSettings(editingConfig);
    const updateRequestSettings = (updates: Partial<ModelEditorRequestSettings>) => {
      setSelectedModelDrafts(drafts => updateModelEditorRequestSettings(drafts, updates, requestDraft?.key));
      if (!requestDraft) setEditingConfig(previous => previous ? { ...previous, ...updates } : previous);
    };
    const subscriptionState = getSubscriptionAccountState(matchedSubscription, isLoadingSubscriptions, subscriptionLoadError);
    const subscriptionStatusLabels = {
      loading: t('subscriptionAuth.accountState.loading'),
      loadFailed: t('subscriptionAuth.accountState.loadFailed'),
      unavailable: t('subscriptionAuth.accountState.unavailable'),
      vaultUnavailable: t('subscriptionAuth.vaultUnavailable'),
      reauthenticationRequired: t('subscriptionAuth.reauthenticationRequired'),
      disconnected: t('subscriptionAuth.notSignedIn'),
      refreshRequired: t('subscriptionAuth.accountState.refreshRequired'),
      connected: t('subscriptionAuth.accountState.connected'),
    };
    const renderSingleModelEditor = () => {
      const draft = singleModelEditorDraft;
      if (!draft) return null;

      return (
        <FieldGroup
          data-testid="settings-model-editor"
          className="bitfun-model-settings__single-model-fields"
          appearance="plain"
          dividers={false}
          fieldSurface="filled"
        >
          <ConfigPageRow label={t('form.modelName')} required align="center">
            <Input
              aria-label={t('form.modelName')}
              data-testid="settings-model-name-input"
              required
              invalid={showModelValidation && !draft.modelName.trim()}
              autoFocus={!!modelPanelDraft}
              value={draft.modelName}
              onChange={event => updateModelDraft(draft.key, { modelName: event.target.value })}
              size="sm"
            />
          </ConfigPageRow>
          {renderModelFields(draft)}
        </FieldGroup>
      );
    };

    const renderAdvancedSettings = () => (
      !authIsSubscription && (
        <Disclosure
          data-testid="settings-model-advanced-toggle"
          summary={t('advancedSettings.title')}
          className={isProviderScopedEditing
            ? 'bitfun-model-settings__advanced-settings'
            : 'bitfun-model-settings__single-model-advanced'}
          renderHeader={isProviderScopedEditing ? trigger => (
            <button {...trigger} data-overflow-trigger className="bitfun-model-settings__advanced-settings-trigger">
              <Icon name="chevron-right" size="sm" aria-hidden="true"
                className="bitfun-model-settings__advanced-settings-indicator" />
              <span className="bitfun-model-settings__advanced-settings-heading">
                <OverflowText className="bitfun-model-settings__advanced-settings-title">{t('advancedSettings.title')}</OverflowText>
              </span>
            </button>
          ) : undefined}
          contentInnerClassName="bitfun-model-settings__advanced-settings-content"
          open={showAdvancedSettings}
          onOpenChange={setShowAdvancedSettings}
        >
          {showAdvancedSettings && (
            <FieldGroup appearance="plain" dividers={false} fieldSurface="filled">
              {(editingConfig.provider === 'openai' || editingConfig.provider === 'anthropic') && (
                <ConfigPageRow
                  label={t('advancedSettings.inlineThinkInText.label')}
                  description={t('advancedSettings.inlineThinkInText.hint')}
                  align="center"
                  className="bitfun-model-settings__toggle-row"
                >
                  <Switch
                    checked={requestSettings.inline_think_in_text ?? true}
                    onChange={(e) => updateRequestSettings({ inline_think_in_text: e.target.checked })}
                  />
                </ConfigPageRow>
              )}
              <ConfigPageRow
                label={t('advancedSettings.skipSslVerify.label')}
                description={requestSettings.skip_ssl_verify ? (
                  <span className="bitfun-model-settings__warning-inline">
                    <AlertTriangle size={14} />
                    <span>{t('advancedSettings.skipSslVerify.warning')}</span>
                  </span>
                ) : undefined}
                align="center"
                className="bitfun-model-settings__toggle-row"
              >
                <Switch
                  checked={requestSettings.skip_ssl_verify || false}
                  onChange={(e) => updateRequestSettings({ skip_ssl_verify: e.target.checked })}
                />
              </ConfigPageRow>
              <ConfigPageRow
                label={(
                  <span className="bitfun-model-settings__inline-header">
                    <span className="bitfun-model-settings__inline-header-main">
                      <span>{t('advancedSettings.customHeaders.label')}</span>
                      <Tooltip
                        content={(
                          <span className="bitfun-model-settings__header-tooltip">
                            <span>{t('advancedSettings.customHeaders.hint')}</span>
                            <span>
                              {(requestSettings.custom_headers_mode || 'merge') === 'replace'
                                ? t('advancedSettings.customHeaders.modeReplaceHint')
                                : t('advancedSettings.customHeaders.modeMergeHint')}
                            </span>
                          </span>
                        )}
                        placement="top"
                      >
                        <span
                          className="bitfun-model-settings__inline-header-info"
                          role="button"
                          tabIndex={0}
                          aria-label={t('advancedSettings.customHeaders.hint')}
                        >
                          <Icon name="info" size="sm" />
                        </span>
                      </Tooltip>
                    </span>
                    <span className="bitfun-model-settings__inline-header-actions">
                      <Tooltip content={t('advancedSettings.customHeaders.modeMergeHint')} placement="top">
                        <Button
                          type="button"
                          variant={(requestSettings.custom_headers_mode || 'merge') === 'merge' ? 'fill' : 'outline'}
                          size="sm"
                          className="bitfun-model-settings__mode-button"
                          onClick={() => updateRequestSettings({ custom_headers_mode: 'merge' })}
                        >
                          {t('advancedSettings.customHeaders.modeMerge')}
                        </Button>
                      </Tooltip>
                      <Tooltip content={t('advancedSettings.customHeaders.modeReplaceHint')} placement="top">
                        <Button
                          type="button"
                          variant={requestSettings.custom_headers_mode === 'replace' ? 'fill' : 'outline'}
                          size="sm"
                          className="bitfun-model-settings__mode-button"
                          onClick={() => updateRequestSettings({ custom_headers_mode: 'replace' })}
                        >
                          {t('advancedSettings.customHeaders.modeReplace')}
                        </Button>
                      </Tooltip>
                    </span>
                  </span>
                )}
                multiline
                className="bitfun-model-settings__custom-headers-row"
              >
                <div className="bitfun-model-settings__row-control--stack">
                  <div className="bitfun-model-settings__custom-headers">
                    {Object.entries(requestSettings.custom_headers || {}).map(([key, value], index) => (
                      <div key={index} className="bitfun-model-settings__header-row">
                        <Input
                          value={key}
                          onChange={(e) => { const nh = { ...requestSettings.custom_headers }; const ov = nh[key]; delete nh[key]; if (e.target.value) nh[e.target.value] = ov; updateRequestSettings({ custom_headers: nh }); }}
                          placeholder={t('advancedSettings.customHeaders.keyPlaceholder')}
                          className="bitfun-model-settings__header-key"
                          size="sm"
                        />
                        <Input
                          value={value}
                          onChange={(e) => { const nh = { ...requestSettings.custom_headers }; nh[key] = e.target.value; updateRequestSettings({ custom_headers: nh }); }}
                          placeholder={t('advancedSettings.customHeaders.valuePlaceholder')}
                          className="bitfun-model-settings__header-value"
                          size="sm"
                        />
                        <Tooltip content={t('actions.delete')}>
                          <IconButton
                            aria-label={t('actions.delete')}
                            size="sm"
                            onClick={() => { const nh = { ...requestSettings.custom_headers }; delete nh[key]; updateRequestSettings({ custom_headers: Object.keys(nh).length > 0 ? nh : undefined }); }}
                            icon={<Icon name="xmark" size="sm" />}
                          />
                        </Tooltip>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={() => updateRequestSettings({ custom_headers: { ...requestSettings.custom_headers, '': '' } })} className="bitfun-model-settings__add-header-btn" leadingIcon={<Icon name="plus" size="sm" />}>{t('advancedSettings.customHeaders.addHeader')}</Button>
                  </div>
                </div>
              </ConfigPageRow>
              <ConfigPageRow
                label={(
                  <span className="bitfun-model-settings__inline-header">
                    <span className="bitfun-model-settings__inline-header-main">
                      <span>{t('advancedSettings.customRequestBody.label')}</span>
                      <Tooltip
                        content={(
                          <span className="bitfun-model-settings__header-tooltip">
                            <span>{t('advancedSettings.customRequestBody.hint')}</span>
                            <span>{getCustomRequestBodyModeHint(editingConfig.provider, requestSettings.custom_request_body_mode)}</span>
                          </span>
                        )}
                        placement="top"
                      >
                        <span
                          className="bitfun-model-settings__inline-header-info"
                          role="button"
                          tabIndex={0}
                          aria-label={t('advancedSettings.customRequestBody.hint')}
                        >
                          <Icon name="info" size="sm" />
                        </span>
                      </Tooltip>
                    </span>
                    <span className="bitfun-model-settings__inline-header-actions">
                      <Tooltip content={t('advancedSettings.customRequestBody.modeMergeHint')} placement="top">
                        <Button
                          type="button"
                          variant={(requestSettings.custom_request_body_mode || 'merge') === 'merge' ? 'fill' : 'outline'}
                          size="sm"
                          className="bitfun-model-settings__mode-button"
                          onClick={() => updateRequestSettings({ custom_request_body_mode: 'merge' })}
                        >
                          {t('advancedSettings.customRequestBody.modeMerge')}
                        </Button>
                      </Tooltip>
                      <Tooltip content={getCustomRequestBodyTrimHint(editingConfig.provider)} placement="top">
                        <Button
                          type="button"
                          variant={requestSettings.custom_request_body_mode === 'trim' ? 'fill' : 'outline'}
                          size="sm"
                          className="bitfun-model-settings__mode-button"
                          onClick={() => updateRequestSettings({ custom_request_body_mode: 'trim' })}
                        >
                          {t('advancedSettings.customRequestBody.modeTrim')}
                        </Button>
                      </Tooltip>
                    </span>
                  </span>
                )}
                multiline
                className="bitfun-model-settings__custom-request-body-row"
              >
                <div className="bitfun-model-settings__row-control--stack">
                  <Textarea value={requestSettings.custom_request_body || ''} onChange={(e) => updateRequestSettings({ custom_request_body: e.target.value })} placeholder={t('advancedSettings.customRequestBody.placeholder')} rows={8} style={{ fontFamily: 'var(--bitfun-type-code-md-font-family)', fontSize: 'var(--bitfun-type-code-md-font-size)' }} />
                  {requestSettings.custom_request_body && requestSettings.custom_request_body.trim() !== '' && (() => {
                    try { JSON.parse(requestSettings.custom_request_body); return <small className="bitfun-model-settings__json-status bitfun-model-settings__json-status--success">{t('advancedSettings.customRequestBody.validJson')}</small>; }
                    catch { return <small className="bitfun-model-settings__json-status bitfun-model-settings__json-status--error">{t('advancedSettings.customRequestBody.invalidJson')}</small>; }
                  })()}
                </div>
              </ConfigPageRow>
            </FieldGroup>
          )}
        </Disclosure>
      )
    );

    return (
      <div className={`bitfun-model-settings__form bitfun-model-settings__form--modal${isProviderScopedEditing ? '' : ' bitfun-model-settings__form--single-model'}`} data-bitfun-component="model-settings" data-bitfun-part="form">
        <div className="bitfun-model-settings__form-content" data-bitfun-component="model-settings" data-bitfun-part="formBody">
          {showModelValidation && modelValidationMessage && (
            <ConfigFieldStatus status="error" message={modelValidationMessage} />
          )}
          {isProviderScopedEditing && (
            <ConfigPageSection title={t('editProviderSettingsTitle')} className="bitfun-model-settings__connection-section" bodySurface={false} fieldSurface="filled">
              <div className="bitfun-model-settings__connection-row">
                <ConfigPageRow label={t('form.configName')} required={!providerIdentityLocked} align="center" wide>
                  {providerIdentityLocked
                    ? <OverflowText data-testid="settings-model-provider-readonly">{configuredProvider ? getProviderDisplayName(configuredProvider) : editingConfig.name}</OverflowText>
                    : <Input data-testid="settings-model-provider-name-input" size="sm" required
                        invalid={showModelValidation && missingModelFields.name} value={editingConfig.name || ''}
                        onChange={event => setEditingConfig(previous => ({ ...previous, name: event.target.value }))}
                        placeholder={t('form.configNamePlaceholder')} />}
                </ConfigPageRow>
                {!isNoApiKeyProvider && (providerIdentityLocked
                  ? <ConfigPageRow label={t('subscriptionAuth.label')} align="center"><StatusPill tone="neutral" data-testid="settings-model-auth-readonly">{authOptions.find(option => option.value === authSelectValue)?.label}</StatusPill></ConfigPageRow>
                  : renderAuthRow())}
              </div>
              {authIsSubscription && (
                <ConfigPageRow label={t('subscriptionAuth.accountLabel')} align="center" wide className="bitfun-model-settings__subscription-account-row">
                  <div className="bitfun-model-settings__subscription-account" data-testid="settings-model-subscription-account">
                    <div className="bitfun-model-settings__subscription-account-heading">
                      <OverflowText className="bitfun-model-settings__subscription-account-name">{matchedSubscription?.account || t('subscriptionAuth.accountUnavailable')}</OverflowText>
                      <StatusPill tone={subscriptionState === 'connected' ? 'success' : 'warning'}>{subscriptionStatusLabels[subscriptionState]}</StatusPill>
                    </div>
                    <div className="bitfun-model-settings__subscription-account-actions">
                      <Button size="sm" onClick={() => setShowSubscriptionManager(true)}>{t('subscriptionAuth.manageAccount')}</Button>
                    </div>
                  </div>
                </ConfigPageRow>
              )}
              {!authIsSubscription && <>
                <div className="bitfun-model-settings__connection-row">
                  {!isNoApiKeyProvider && renderApiKeyRow(t('form.apiKey'))}
                  {!automaticOpenCodeRouting && <ConfigPageRow label={t('form.provider')} align="center" wide>
                    <Select data-testid="settings-model-request-format-select" value={editingConfig.provider || 'openai'} onValueChange={value => changeRequestFormat(String(value))} options={requestFormatOptions} size="sm" />
                  </ConfigPageRow>}
                </div>
                <ConfigPageRow label={t('form.baseUrl')} required wide className="bitfun-model-settings__endpoint-row">
                  <div className="bitfun-model-settings__control-stack">
                    <div className="bitfun-model-settings__endpoint-inputs">
                      {renderEndpointPicker()}
                      <Input data-testid="settings-model-base-url-input" type="url" size="sm" required
                        invalid={showModelValidation && missingModelFields.baseUrl} value={editingConfig.base_url || ''}
                        onChange={event => { resetRemoteModelDiscovery(); setEditingConfig(previous => ({ ...previous, base_url: event.target.value, request_url: resolveRequestUrl(event.target.value, previous?.provider || 'openai', previous?.model_name || '') })); }}
                        onFocus={event => event.target.select()}
                        placeholder={currentTemplate?.baseUrl || t('form.baseUrlPlaceholder')} />
                    </div>
                    {editingConfig.base_url && !automaticOpenCodeRouting && <div className="bitfun-model-settings__resolved-url">
                      <span className="bitfun-model-settings__resolved-url-label">{t('form.resolvedUrlLabel')}</span>
                      <span className="bitfun-model-settings__resolved-url-value">{previewRequestUrl(editingConfig.base_url, editingConfig.provider || 'openai', selectedModelDrafts.length === 1 ? selectedModelDrafts[0].modelName : undefined)}</span>
                    </div>}
                  </div>
                </ConfigPageRow>
              </>}
            </ConfigPageSection>
          )}
          {isProviderScopedEditing ? (
            <ConfigPageSection title={t('title')} bodySurface={false} fieldSurface="filled" className="bitfun-model-settings__model-section" extra={
              <div className="bitfun-model-settings__model-selection-actions">
                <ModelDiscoveryPicker open={modelPickerOpen} onOpenChange={handleModelSelectionOpenChange}
                  options={fetchedOrPresetModelOptions.map(option => ({ label: option.label, value: String(option.value) }))}
                  value={selectedModelValues} onValueChange={value => syncSelectedModelDrafts(value, editingConfig, false)}
                  loading={isFetchingRemoteModels} fetched={remoteModelOptions.length > 0} hint={modelFetchHint}
                  error={!!remoteModelsError} invalid={showModelValidation && missingModelFields.model}
                  onRefresh={() => void fetchRemoteModels(editingConfig, true)} />
                <Button ref={manualModelAddButtonRef} data-testid="settings-model-add-custom-btn" variant="fill" size="xs" disabled={isEditorSaving || isAddingCustomModel} onClick={startManualModelDraft}>{t('providerSelection.addCustomModel')}</Button>
              </div>
            }>
              {renderSelectedModelRows()}
              {showLocalModelManager && <LocalModelManagerInline onModelsChanged={handleLocalModelsChanged} />}
            </ConfigPageSection>
          ) : renderSingleModelEditor()}
          {renderAdvancedSettings()}
        </div>
      </div>
    );
  };

  const renderModelCollectionItem = (config: AIModelConfigType, presentation: 'row' | 'card' = 'row') => {
    const isExpanded = expandedIds.has(config.id || '');
    const testResult = config.id ? testResults[config.id] : null;
    const isTesting = config.id ? !!testingConfigs[config.id] : false;
    const providerDisplayName = getProviderDisplayName(config);
    const modelDisplayName = getModelDisplayName(config);
    const modelLabel = config.model_name || modelDisplayName;
    const testStatusLabel = isTesting
      ? t('messages.testing')
      : testResult?.message.split('\n', 1)[0];

    const badge = (
      <>
        {presentation === 'row' && <span
          className="bitfun-model-settings__meta-tag"
          data-bitfun-component="model-settings"
          data-bitfun-part="modelMeta"
        >
          {t(`category.${config.category}`)}
        </span>}
        {(isTesting || testResult) && (
          <span
            data-testid="settings-model-test-status"
            data-config-id={config.id || ''}
            data-model-id={config.model_name}
            data-model-name={config.model_name}
            data-status={isTesting ? 'testing' : testResult?.success ? 'success' : 'error'}
            className={`bitfun-model-settings__status-dot ${isTesting ? 'is-testing' : testResult?.success ? 'is-success' : 'is-error'}`}
            role="status"
            aria-live="polite"
            aria-label={testStatusLabel}
            title={isTesting ? testStatusLabel : testResult?.message}
          />
        )}
      </>
    );

    const details = (
      <div
        className="bitfun-model-settings__details"
        data-bitfun-component="model-settings"
        data-bitfun-part="modelDetails"
      >
        <div className="bitfun-model-settings__details-section">
          <div className="bitfun-model-settings__details-section-title">
            {t('details.basicInfo')}
          </div>
          <div className="bitfun-model-settings__details-grid">
            <div className="bitfun-model-settings__details-item">
              <span className="bitfun-model-settings__details-label">{t('form.configName')}</span>
              <span className="bitfun-model-settings__details-value">{providerDisplayName}</span>
            </div>
            <div className="bitfun-model-settings__details-item">
              <span className="bitfun-model-settings__details-label">{t('details.modelName')}</span>
              <span className="bitfun-model-settings__details-value">{config.model_name}</span>
            </div>
            <div className="bitfun-model-settings__details-item">
              <span className="bitfun-model-settings__details-label">{t('details.contextWindow')}</span>
              <span className="bitfun-model-settings__details-value">{config.context_window != null ? i18nService.formatNumber(config.context_window) : '128,000'}</span>
            </div>
            <div className="bitfun-model-settings__details-item bitfun-model-settings__details-item--wide">
              <span className="bitfun-model-settings__details-label">{t('details.apiUrl')}</span>
              <span className="bitfun-model-settings__details-value">{config.base_url}</span>
            </div>
            {config.capabilities && config.capabilities.length > 0 && (
              <div className="bitfun-model-settings__details-item bitfun-model-settings__details-item--wide">
                <span className="bitfun-model-settings__details-label">{t('details.capabilities')}</span>
                <div className="bitfun-model-settings__details-tags">
                  {config.capabilities.map(capability => (
                    <span key={capability} className="bitfun-model-settings__details-tag">
                      {t(`capabilities.${capability}`, { defaultValue: capability })}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        {testResult && (
          <div className="bitfun-model-settings__details-section">
            <div className="bitfun-model-settings__details-section-title">
              {t('actions.test')}
            </div>
            <div className={`bitfun-model-settings__test-result ${testResult.success ? 'success' : 'error'}`}>
              {testResult.message}
            </div>
          </div>
        )}
      </div>
    );

    const control = (
      <>
        <span className="bitfun-model-settings__model-enable">
          <Switch
            aria-label={t('pool.enableModel', { model: modelLabel })}
            checked={config.enabled}
            onChange={(e) => {
              void handleToggleEnabled(config, e.target.checked);
            }}
          />
        </span>
        <div
          className="bitfun-model-settings__model-actions"
          data-bitfun-component="model-settings"
          data-bitfun-part="modelActions"
        >
          <Tooltip content={connectionTestSupported
            ? t('actions.test')
            : t('messages.testUnsupportedOnHost')}>
            <IconButton
              aria-label={t('actions.test')}
              size="sm"
              loading={isTesting}
              disabled={!connectionTestSupported}
              onClick={() => void handleTest(config)}
              icon={isTesting ? <Loader size={14} /> : <Wifi size={14} />}
            />
          </Tooltip>
          <Tooltip content={t('actions.edit')}>
            <IconButton
              aria-label={t('actions.edit')}
              size="sm"
              onClick={() => handleEdit(config)}
              icon={<Icon name="edit" size="sm" />}
            />
          </Tooltip>
          <Tooltip content={t('actions.delete')}>
            <IconButton
              aria-label={t('actions.delete')}
              tone="danger"
              size="sm"
              onClick={() => void requestDelete(config)}
              icon={<Icon name="delete" size="sm" />}
            />
          </Tooltip>
        </div>
      </>
    );

    if (presentation === 'card') {
      const roles = libraryRoles.filter(role => role.modelId && role.modelId === config.id);
      const roleLabels = new Set(roles.map(role => role.label));
      const tags = getModelTags(config).filter(tag => !roleLabels.has(tag));
      return (
        <div key={config.id} className="bitfun-model-settings__pool-item"
          data-bitfun-component="model-settings" data-bitfun-part="modelItem"
          data-bitfun-state={!config.enabled ? 'disabled' : undefined}
          data-testid="settings-model-row" data-config-id={config.id || ''}
          data-model-id={config.model_name} data-model-name={config.model_name}>
          <Card appearance="subtle" padding="md" gap="sm" className="bitfun-model-settings__pool-card">
            <CardHeader
              className="bitfun-model-settings__pool-card-header"
              contentAlign="start"
              title={(
                <div className="bitfun-model-settings__pool-card-title">
                  <OverflowText>{modelLabel}</OverflowText>
                  {(isTesting || testResult) && badge}
                </div>
              )}
              description={(roles.length > 0 || tags.length > 0) ? (
                <div className="bitfun-model-settings__pool-tags">
                  {roles.map(role => <StatusPill key={role.label} tone="neutral">{role.label}</StatusPill>)}
                  {tags.map(tag => <StatusPill key={tag} tone="neutral">{tag}</StatusPill>)}
                </div>
              ) : undefined}
            />
            <CardFooter align="between" className="bitfun-model-settings__pool-card-footer">
              <OverflowText className="bitfun-model-settings__pool-card-source">
                {providerDisplayName}
              </OverflowText>
              <ModelPoolCardActions
                modelLabel={modelLabel}
                enabled={config.enabled}
                isTesting={isTesting}
                connectionTestSupported={connectionTestSupported}
                onEdit={() => handleEdit(config)}
                onTest={() => void handleTest(config)}
                onDelete={() => void requestDelete(config)}
                onEnabledChange={enabled => void handleToggleEnabled(config, enabled)}
              />
            </CardFooter>
          </Card>
        </div>
      );
    }

    return (
      <ConfigCollectionItem
        key={config.id}
        label={modelLabel}
        badge={badge}
        control={control}
        details={details}
        expanded={isExpanded}
        onToggle={() => config.id && toggleExpanded(config.id)}
        toggleOnRowClick
        disabled={!config.enabled}
        detailsDisabled={false}
        data-testid="settings-model-row"
        data-config-id={config.id || ''}
        data-model-id={config.model_name}
        data-model-name={config.model_name}
        data-bitfun-component="model-settings"
        data-bitfun-part="modelItem"
        data-bitfun-state={[isExpanded && 'expanded', !config.enabled && 'disabled'].filter(Boolean).join(' ') || undefined}
      />
    );
  };

  const renderSubscriptionManager = () => (
    <ConfigPageSection
          title={t('subscriptionAuth.sectionTitle')}
          description={t('subscriptionAuth.sectionDescription')}
          extra={(
            <Tooltip content={t('subscriptionAuth.rescan')}>
              <IconButton
                size="sm"
                onClick={refreshSubscriptionAccounts}
                aria-label={t('subscriptionAuth.rescan')}
                data-testid="subscription-rescan-btn"
                disabled={isLoadingSubscriptions}
                icon={<Icon name="refresh" size="md" className={isLoadingSubscriptions ? 'bitfun-model-settings__spin' : ''} />}
              />
            </Tooltip>
          )}
        >
          <div className="bitfun-model-settings__cli-discovery" data-bitfun-component="model-settings" data-bitfun-part="subscriptionArea">
            {isLoadingSubscriptions && <div role="status">{t('messages.loading')}</div>}
            {subscriptionLoadError && <ConfigRetryState message={t('acquisition.loadFailed')} retryLabel={t('messages.retry')} onRetry={() => void refreshSubscriptionAccounts()} />}
            {subscriptionAccounts.map((account) => {
              const descriptionParts: string[] = [];
              if (account.connected && account.account) {
                descriptionParts.push(account.account);
              }
              if (account.connected && account.expires_at) {
                descriptionParts.push(
                  t('subscriptionAuth.expiresAt', {
                    time: i18nService.formatDate(new Date(account.expires_at * 1000), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }),
                  }),
                );
              } else if (account.connected) {
                descriptionParts.push(t('subscriptionAuth.tokenValid'));
              } else if (account.vault_unavailable) {
                descriptionParts.push(t('subscriptionAuth.vaultUnavailable'));
              } else if (account.reauthentication_required) {
                descriptionParts.push(t('subscriptionAuth.reauthenticationRequired'));
              } else {
                descriptionParts.push(t('subscriptionAuth.notSignedIn'));
              }
              const isRefreshing = refreshingSubscriptionProviders.has(account.provider);
              const isLoggingIn = loggingInProvider === account.provider;
              const anyLoginInProgress = loggingInProvider !== null || isLoadingSubscriptions || subscriptionLoadError;
              const loginPanel = subscriptionLoginPanel?.provider === account.provider
                ? subscriptionLoginPanel
                : null;
              const remainingSeconds = loginPanel?.deadlineMs
                ? Math.max(0, Math.ceil((loginPanel.deadlineMs - subscriptionLoginClock) / 1000))
                : 0;
              const countdown = `${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, '0')}`;
              return (
                <React.Fragment key={account.provider}>
                  <ConfigPageRow
                    label={account.display_label}
                    description={descriptionParts.map((part) => (
                      <span
                        key={part}
                        className="bitfun-model-settings__cli-description-line"
                      >
                        {part}
                      </span>
                    ))}
                    className="bitfun-model-settings__cli-account"
                    align="center"
                  >
                    <div className="bitfun-model-settings__cli-actions">
                      {account.connected ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            loading={isRefreshing}
                            disabled={anyLoginInProgress || isRefreshing}
                            onClick={() => void handleSubscriptionRefresh(account.provider)}
                          >
                            {t('subscriptionAuth.refresh')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={anyLoginInProgress}
                            onClick={() => requestSubscriptionLogout(account)}
                          >
                            {t('subscriptionAuth.logout')}
                          </Button>
                          {(
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={anyLoginInProgress}
                              onClick={() => { handleImportFromSubscription(account); setShowSubscriptionManager(false); }}
                            >
                              {t('subscriptionAuth.import')}
                            </Button>
                          )}
                        </>
                      ) : account.vault_unavailable ? (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={isRefreshing}
                          disabled={anyLoginInProgress || isRefreshing}
                          onClick={() => void handleSubscriptionRefresh(account.provider)}
                        >
                          {t('subscriptionAuth.retryVault')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="primary"
                          loading={isLoggingIn}
                          disabled={anyLoginInProgress}
                          data-testid={`subscription-login-btn-${account.provider}`}
                          onClick={() => void handleSubscriptionLogin(account.provider)}
                        >
                          {t(loginPanel?.status === 'failed'
                            ? 'subscriptionAuth.retryLogin'
                            : 'subscriptionAuth.login')}
                        </Button>
                      )}
                      {isLoggingIn && (
                        <Button
                          size="sm"
                          variant="fill"
                          disabled={loginPanel?.status === 'cancelling'}
                          onClick={() => void handleCancelSubscriptionLogin(account.provider)}
                        >
                          {t('subscriptionAuth.cancel')}
                        </Button>
                      )}
                    </div>
                  </ConfigPageRow>

                  {loginPanel && (
                    <div
                      className={`bitfun-model-settings__subscription-login-panel bitfun-model-settings__subscription-login-panel--${loginPanel.status}`}
                      data-bitfun-component="model-settings"
                      data-bitfun-part="subscriptionPanel"
                      data-bitfun-status={loginPanel.status}
                      role={loginPanel.status === 'failed' ? 'alert' : undefined}
                    >
                      <div className="bitfun-model-settings__subscription-login-summary" data-bitfun-component="model-settings" data-bitfun-part="subscriptionSummary">
                        <strong>
                          {loginPanel.status === 'failed'
                            ? t('subscriptionAuth.loginNeedsRetry')
                            : loginPanel.status === 'cancelling'
                              ? t('subscriptionAuth.loginCancelling')
                              : t('subscriptionAuth.loginPending')}
                        </strong>
                        {loginPanel.status === 'pending' && (
                          <>
                            <span>
                              {t(loginPanel.method === 'browser'
                                ? 'subscriptionAuth.browserInstructions'
                                : 'subscriptionAuth.deviceInstructions')}
                            </span>
                            <span>{t('subscriptionAuth.timeRemaining', { time: countdown })}</span>
                          </>
                        )}
                        {loginPanel.status === 'failed' && loginPanel.error && (
                          <span>{t('subscriptionAuth.loginFailedInline', { error: loginPanel.error })}</span>
                        )}
                      </div>

                      {loginPanel.status === 'pending' && loginPanel.userCode && (
                        <div className="bitfun-model-settings__subscription-code" data-bitfun-component="model-settings" data-bitfun-part="subscriptionCode">
                          <span>{t('subscriptionAuth.verificationCode')}</span>
                          <code>{loginPanel.userCode}</code>
                        </div>
                      )}

                      {loginPanel.status === 'pending' && (
                        <div className="bitfun-model-settings__subscription-login-actions" data-bitfun-component="model-settings" data-bitfun-part="subscriptionActions">
                          {loginPanel.userCode && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleCopySubscriptionCode(loginPanel.userCode!)}
                            >
                              {t('subscriptionAuth.copyCode')}
                            </Button>
                          )}
                          {loginPanel.authorizationUrl && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleOpenSubscriptionAuthorization(loginPanel.authorizationUrl)}
                              leadingIcon={<Icon name="arrow-up-right" size="sm" aria-hidden="true" />}
                            >
                              {t('subscriptionAuth.openAuthorization')}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </ConfigPageSection>
  );

  const streamTtftTimeoutLabel = (
    <span className="bitfun-model-settings__inline-header-main">
      <span>{t('streamTtftTimeout.label')}</span>
      <Tooltip content={t('streamTtftTimeout.hint')} placement="top">
        <span
          className="bitfun-model-settings__inline-header-info"
          role="button"
          tabIndex={0}
          aria-label={t('streamTtftTimeout.hint')}
        >
          <Icon name="info" size="sm" />
        </span>
      </Tooltip>
    </span>
  );

  const streamIdleTimeoutLabel = (
    <span className="bitfun-model-settings__inline-header-main">
      <span>{t('streamIdleTimeout.label')}</span>
      <Tooltip content={t('streamIdleTimeout.hint')} placement="top">
        <span
          className="bitfun-model-settings__inline-header-info"
          role="button"
          tabIndex={0}
          aria-label={t('streamIdleTimeout.hint')}
        >
          <Icon name="info" size="sm" />
        </span>
      </Tooltip>
    </span>
  );
  const reasoningPanelDraft = reasoningPanelDraftKey
    ? selectedModelDrafts.find(draft => draft.key === reasoningPanelDraftKey)
    : undefined;
  const reasoningPanelProjection = reasoningPanelDraft
    ? resolveDraftReasoningProjection(reasoningPanelDraft)
    : undefined;
  const reasoningPanelProjectionRequest = reasoningPanelDraft && editingConfig
    ? {
        provider: editingConfig.provider || 'openai',
        modelName: reasoningPanelDraft.modelName,
        baseUrl: editingConfig.base_url || '',
        contextWindow: reasoningPanelDraft.contextWindow,
        maxTokens: reasoningPanelDraft.maxTokens,
      }
    : undefined;
  const updateReasoningPanelDraft = (result: ReasoningConfigApplyResult) => {
    if (!reasoningPanelDraft) return;
    updateModelDraft(reasoningPanelDraft.key, {
      reasoning: result.reasoning,
      reasoningProjectionCatalog: result.projectionCatalog,
      reasoningProjectionSnapshot: {
        catalog: result.projectionCatalog,
        projection: result.projection,
      },
    });
  };
  const finishReasoningPanel = () => {
    reasoningPanelInitialRef.current = null;
    setReasoningPanelDraftKey(null);
  };
  const cancelReasoningPanel = () => {
    const initial = reasoningPanelInitialRef.current;
    if (reasoningPanelDraft && initial?.key === reasoningPanelDraft.key) {
      updateModelDraft(reasoningPanelDraft.key, {
        reasoning: cloneReasoningConfig(initial.reasoning),
        reasoningProjectionCatalog: initial.reasoningProjectionCatalog,
        reasoningProjectionSnapshot: initial.reasoningProjectionSnapshot,
      });
    }
    finishReasoningPanel();
  };
  const modelsDevSourceLabel = modelsDevStatus
    ? t(`modelsDevCatalog.source.${modelsDevStatus.active_source}`)
    : t('modelsDevCatalog.loading');
  const modelsDevUpdatedAt = modelsDevStatus?.cache_updated_at_ms
    ? i18nService.formatDate(new Date(modelsDevStatus.cache_updated_at_ms), {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : t('modelsDevCatalog.noCache');


  const apiProviderGroups = providerGroups.filter(group => group.models[0].auth?.type !== 'subscription');
  const subscriptionProviderGroups = providerGroups.filter(group => group.models[0].auth?.type === 'subscription');
  const subscriptionModelCount = subscriptionProviderGroups.reduce((count, group) => count + group.models.length, 0);

  return (
    <ConfigPageLayout className="bitfun-model-settings" data-bitfun-component="model-settings" data-bitfun-part="root" data-bitfun-view="settings">
      <ConfigPageHeader title={t('title')} />

      <ConfigPageContent className="bitfun-model-settings__content">
        <ConfigPageSection title={t('sections.acquisition')} id="settings-section-acquisition">
          <ConfigPageRow multiline label={<div className="bitfun-model-settings__import-row"><div className="bitfun-model-settings__import-heading">
              <span>{t('acquisition.api')}</span>
              {!isConfigLoading && !configLoadError && apiProviderGroups.length > 0 && <span className="bitfun-model-settings__pool-caption">
                {t('acquisition.configuredSummary', { providers: i18nService.formatNumber(apiProviderGroups.length), models: i18nService.formatNumber(aiModels.length - subscriptionModelCount) })}
              </span>}
            </div>
            <Button size="sm" data-testid="ai-model-add-provider-btn" onClick={handleCreateNew} disabled={isConfigLoading || configLoadError} leadingIcon={<Icon name="plus" size="sm" />}>{t('actions.addProvider')}</Button></div>}>
            <div className="bitfun-model-settings__provider-connections">
              {apiProviderGroups.map(group => (
                <Capsule className="bitfun-model-settings__provider-connection" key={group.key} size="sm" actionPlacement="reserved" action={(
                  <Tooltip content={t('actions.deleteProvider')} trigger="hover-focus">
                    <IconButton size="xs" shape="circle" variant="quiet" tone="danger"
                      aria-label={`${t('actions.deleteProvider')}: ${group.providerName}`}
                      icon={<Icon name="delete" size="xs" />} onClick={() => void requestProviderDelete(group)} />
                  </Tooltip>
                )}>
                  <Tooltip content={group.models[0].base_url} trigger="hover-focus">
                    <Button size="sm" variant="outline" aria-label={t('acquisition.configureProvider', { provider: group.providerName })}
                      onClick={() => handleEditProvider(group.models[0])}>{group.providerName}</Button>
                  </Tooltip>
                </Capsule>
              ))}
              {apiProviderGroups.length === 0 && <span>{t('acquisition.noneConfigured')}</span>}
            </div>
          </ConfigPageRow>
          <ConfigPageRow multiline label={<div className="bitfun-model-settings__import-row"><div className="bitfun-model-settings__import-heading">
              <span>{t('acquisition.subscriptions')}</span>
              {!isConfigLoading && !configLoadError && subscriptionProviderGroups.length > 0 && <span className="bitfun-model-settings__pool-caption">
                {t('acquisition.importedSummary', { providers: i18nService.formatNumber(subscriptionProviderGroups.length), models: i18nService.formatNumber(subscriptionModelCount) })}
              </span>}
            </div>
            <Button size="sm" onClick={() => setShowSubscriptionManager(true)} leadingIcon={<Icon name="plus" size="sm" />}>{t('acquisition.addSubscription')}</Button></div>}>
            <div className="bitfun-model-settings__provider-connections">
              {subscriptionLoadError && <ConfigRetryState message={t('acquisition.loadFailed')} retryLabel={t('messages.retry')} onRetry={() => void refreshSubscriptionAccounts()} />}
              {subscriptionProviderGroups.map(group => (
                <Capsule className="bitfun-model-settings__provider-connection" key={group.key} size="sm" actionPlacement="reserved" action={(
                  <Tooltip content={t('actions.deleteProvider')} trigger="hover-focus">
                    <IconButton size="xs" shape="circle" variant="quiet" tone="danger"
                      aria-label={`${t('actions.deleteProvider')}: ${group.providerName}`}
                      icon={<Icon name="delete" size="xs" />} onClick={() => void requestProviderDelete(group)} />
                  </Tooltip>
                )}>
                  <Tooltip content={group.models[0].base_url} trigger="hover-focus">
                    <Button size="sm" variant="outline" aria-label={t('acquisition.configureProvider', { provider: group.providerName })}
                      onClick={() => handleEditProvider(group.models[0])}>{group.providerName}</Button>
                  </Tooltip>
                </Capsule>
              ))}
              {subscriptionProviderGroups.length === 0 && !subscriptionLoadError && <span>{t('acquisition.noneImported')}</span>}
              <Button size="sm" variant="text" onClick={() => setShowSubscriptionManager(true)}>{t('subscriptionAuth.manageAccount')}</Button>
            </div>
          </ConfigPageRow>
        </ConfigPageSection>

        <ConfigPageSection
          className="bitfun-model-settings__models-section"
          bodySurface={false}
          title={t('sections.pool')}
          id="settings-section-library"
          extra={<>
            <Tooltip content={t('pool.syncTags')}><IconButton size="sm" variant="quiet" aria-label={t('pool.syncTags')} onClick={() => setShowTagSyncNotice(true)} icon={<Icon name="refresh" size="sm" />} /></Tooltip>
            {modelsDevStatusAvailable && <Tooltip content={t('modelsDevCatalog.fetchCatalog')}><IconButton size="sm" variant="quiet" aria-label={t('modelsDevCatalog.fetchCatalog')} loading={isRefreshingModelsDev} onClick={() => void handleRefreshModelsDev()} icon={<Icon glyph={BookOpen} size="sm" />} /></Tooltip>}
            {aiModels.length > 0 && <Tooltip content={t('pool.manageConnections')}><IconButton size="sm" variant="quiet" aria-label={t('pool.manageConnections')} onClick={() => setShowProviderManager(true)} icon={<Icon glyph={Plug} size="sm" />} /></Tooltip>}
          </>}
        >
          <div className="bitfun-model-settings__pool-slots">
            <DefaultModelConfig compact models={aiModels} defaultModels={poolDefaults} loading={isConfigLoading} disabled={configLoadError} onDefaultModelsChange={setPoolDefaults} />
          </div>
          {hasSuspendedEditorDraft && (
            <ConfigActionBar
              status="unsaved"
              statusMessage={t('draftClose.retainedHint')}
              saveLabel={t('draftClose.continueEditing')}
              discardLabel={t('draftClose.discardDraft')}
              onSave={() => setIsEditing(true)}
              onDiscard={closeEditingModal}
            />
          )}
          {isConfigLoading ? <div role="status">{t('messages.loading')}</div> : configLoadError ? (
            <ConfigRetryState message={t('messages.loadFailedLocked')} retryLabel={t('messages.retry')} onRetry={() => void loadConfig()} />
          ) : <>
          <div className="bitfun-model-settings__pool-toolbar">
            <SearchField size="sm" value={libraryQuery} onValueChange={setLibraryQuery} placeholder={t('pool.search')} aria-label={t('pool.search')} />
            <Select size="sm" value={libraryCapability} aria-label={t('pool.capabilityFilter')}
              onValueChange={value => setLibraryCapability(String(value) as ModelCapability | '')}
              options={[{ value: '', label: t('pool.allCapabilities') }, ...(['text_chat', 'image_understanding', 'speech_recognition', 'function_calling'] as const).map(value => ({ value, label: t(`capabilities.${value}`) }))]} />
            <Select size="sm" value={libraryProvider} aria-label={t('pool.providerFilter')}
              onValueChange={value => setLibraryProvider(String(value))}
              options={[{ value: '', label: t('pool.allProviders') }, ...libraryProviderOptions]} />
          </div>
          {aiModels.length === 0 ? (
            <ConfigEmptyState
              data-bitfun-component="model-settings"
              data-bitfun-part="empty"
              icon={<Wifi size={36} aria-hidden="true" />}
              description={t('empty.noModels')}
              actions={(
                <Button data-testid="settings-model-create-first-config-btn" variant="primary" size="sm" onClick={handleCreateNew} leadingIcon={<Icon name="plus" size="sm" />}>
                  {t('actions.createFirst')}
                </Button>
              )}
            />
          ) : (
            <div className="bitfun-model-settings__pool-grid" data-bitfun-component="model-settings" data-bitfun-part="collection" data-testid="settings-model-list">
              {visibleLibraryModels.map(config => renderModelCollectionItem(config, 'card'))}
              {visibleLibraryModels.length === 0 && <ConfigEmptyState icon={<Wifi aria-hidden="true" />} description={t('pool.noMatches')} actions={<Button size="sm" onClick={() => { setLibraryQuery(''); setLibraryProvider(''); setLibraryCapability(''); }}>{t('pool.clearFilter')}</Button>} />}
            </div>
          )}
          </>}
        </ConfigPageSection>

        <Disclosure summary={t('sections.more')} className="bitfun-model-settings__more-settings" contentInnerClassName="bitfun-model-settings__more-content">
        <ConfigPageSection
          title={t('streamIdleTimeout.title')}
          description={t('streamIdleTimeout.effectiveNextRound')}
        >
          {connectionState.timeouts === 'loading' ? <div role="status">{t('messages.loading')}</div>
            : connectionState.timeouts === 'error' ? <ConfigRetryState message={t('messages.loadFailedLocked')} retryLabel={t('messages.retry')} onRetry={() => void loadConnectionSection('timeouts')} />
            : <>
          <ConfigPageRow
            label={streamTtftTimeoutLabel}
            align="center"
          >
            <Input
              value={streamTtftTimeoutInput}
              onChange={(e) => setStreamTtftTimeoutInput(e.target.value)}
              placeholder={t('streamTtftTimeout.placeholder')}
              size="sm"
              data-testid="model-ttft-timeout-input"
            />
          </ConfigPageRow>
          <ConfigPageRow
            label={streamIdleTimeoutLabel}
            align="center"
          >
            <Input
              value={streamIdleTimeoutInput}
              onChange={(e) => setStreamIdleTimeoutInput(e.target.value)}
              placeholder={t('streamIdleTimeout.placeholder')}
              size="sm"
              data-testid="model-stream-idle-timeout-input"
            />
          </ConfigPageRow>
          <ConfigActionBar
            status={isStreamTimeoutSaving
              ? 'saving'
              : streamTimeoutSaveError
                ? 'error'
                : isStreamTimeoutDirty
                  ? 'unsaved'
                  : 'saved'}
            statusMessage={streamTimeoutSaveError}
            saving={isStreamTimeoutSaving}
            saveDisabled={isStreamTimeoutInvalid || !isStreamTimeoutDirty}
            discardDisabled={!isStreamTimeoutDirty}
            saveLabel={t('streamIdleTimeout.save')}
            onSave={() => void handleSaveStreamTimeouts()}
            onDiscard={discardStreamTimeoutDraft}
          />
          </>}
        </ConfigPageSection>

        <ConfigPageSection
          title={tDefault('sections.proxy')}
          description={t('proxy.enableHint')}
        >
          {connectionState.proxy === 'loading' ? <div role="status">{t('messages.loading')}</div>
            : connectionState.proxy === 'error' ? <ConfigRetryState message={t('messages.loadFailedLocked')} retryLabel={t('messages.retry')} onRetry={() => void loadConnectionSection('proxy')} />
            : <>
          <ConfigPageRow label={t('proxy.enable')} align="center">
            <Switch
              checked={proxyConfig.enabled}
              onChange={(e) => setProxyConfig(prev => ({ ...prev, enabled: e.target.checked }))}
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('proxy.url')} description={t('proxy.urlHint')} align="center">
            <Input
              value={proxyConfig.url}
              onChange={(e) => setProxyConfig(prev => ({ ...prev, url: e.target.value }))}
              placeholder={t('proxy.urlPlaceholder')}
              disabled={!proxyConfig.enabled}
              size="sm"
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('proxy.username')} align="center">
            <Input
              value={proxyConfig.username || ''}
              onChange={(e) => setProxyConfig(prev => ({ ...prev, username: e.target.value }))}
              placeholder={t('proxy.usernamePlaceholder')}
              disabled={!proxyConfig.enabled}
              size="sm"
            />
          </ConfigPageRow>
          <ConfigPageRow label={t('proxy.password')} align="center">
            <Input
              type="password"
              value={proxyConfig.password || ''}
              onChange={(e) => setProxyConfig(prev => ({ ...prev, password: e.target.value }))}
              placeholder={t('proxy.passwordPlaceholder')}
              disabled={!proxyConfig.enabled}
              size="sm"
            />
          </ConfigPageRow>
          <ConfigActionBar
            status={isProxySaving
              ? 'saving'
              : proxySaveError
                ? 'error'
                : isProxyDirty
                  ? 'unsaved'
                  : 'saved'}
            statusMessage={proxySaveError}
            saving={isProxySaving}
            saveDisabled={!isProxyDirty || (proxyConfig.enabled && !proxyConfig.url.trim())}
            discardDisabled={!isProxyDirty}
            saveLabel={t('proxy.save')}
            onSave={() => void handleSaveProxy()}
            onDiscard={discardProxyDraft}
          />
          </>}
        </ConfigPageSection>
        </Disclosure>
      </ConfigPageContent>

      <Dialog open={showProviderManager} onOpenChange={setShowProviderManager} preset="panel">
        <DialogHeader>
          <DialogHeading><DialogTitle>{t('pool.manageConnections')}</DialogTitle></DialogHeading>
          <DialogClose />
        </DialogHeader>
        <DialogBody>
          <ConfigPageSection
            className="bitfun-model-settings__models-section"
            bodySurface={false}
            title={tDefault('sections.providers')}
            extra={(
              <Tooltip content={t('actions.addProvider')}>
                <IconButton
                  aria-label={t('actions.addProvider')}
                  size="sm"
                  onClick={handleCreateNew}
                  icon={<Icon name="plus" size="md" />}
                />
              </Tooltip>
            )}
          >
            {hasSuspendedEditorDraft && (
              <ConfigActionBar
                status="unsaved"
                statusMessage={t('draftClose.retainedHint')}
                saveLabel={t('draftClose.continueEditing')}
                discardLabel={t('draftClose.discardDraft')}
                onSave={() => setIsEditing(true)}
                onDiscard={closeEditingModal}
              />
            )}
            {aiModels.length === 0 ? (
              <ConfigEmptyState
                data-bitfun-component="model-settings"
                data-bitfun-part="empty"
                icon={<Wifi aria-hidden="true" />}
                description={t('empty.noModels')}
                actions={(
                  <Button data-testid="settings-model-create-first-config-btn" variant="primary" size="sm" onClick={handleCreateNew} leadingIcon={<Icon name="plus" size="sm" />}>
                    {t('actions.createFirst')}
                  </Button>
                )}
              />
            ) : (
              <div className="bitfun-model-settings__collection" data-bitfun-component="model-settings" data-bitfun-part="collection" data-testid="settings-model-list">
                {providerGroups.map((group, index) => {
                  const isExpanded = expandedProviderGroupKeys.has(group.key);

                  return (
                    <div
                      key={group.key}
                      className="bitfun-model-settings__provider-group"
                      data-bitfun-component="model-settings"
                      data-bitfun-part="providerGroup"
                      data-bitfun-state={isExpanded ? 'expanded' : undefined}
                    >
                      <div
                        className="bitfun-model-settings__provider-group-header"
                        data-bitfun-component="model-settings"
                        data-bitfun-part="providerGroupHeader"
                        data-expanded={isExpanded ? 'true' : 'false'}
                      >
                        <button
                          type="button"
                          className="bitfun-model-settings__provider-group-toggle"
                          aria-expanded={isExpanded}
                          aria-label={`${tComponents(isExpanded ? 'tooltip.collapse' : 'tooltip.expand')} ${group.providerName}`}
                          data-testid={`model-provider-group-toggle-${index}`}
                          onClick={() => toggleProviderGroup(group.key)}
                        >
                          <Icon
                            name={isExpanded ? 'chevron-down' : 'chevron-right'}
                            size="sm"
                            className="bitfun-model-settings__provider-group-chevron"
                            aria-hidden="true"
                          />
                          <span className="bitfun-model-settings__provider-group-title" data-bitfun-component="model-settings" data-bitfun-part="providerGroupTitle">
                            <span>{group.providerName}</span>
                            <span className="bitfun-model-settings__provider-group-count">{group.models.length}</span>
                            <span className="bitfun-model-settings__meta-tag">
                              {requestFormatLabelMap[group.models[0]?.provider || 'openai'] || (group.models[0]?.provider || 'openai')}
                            </span>
                          </span>
                        </button>
                        <div className="bitfun-model-settings__provider-group-actions" data-bitfun-component="model-settings" data-bitfun-part="providerGroupActions">
                          <Tooltip content={t('actions.edit')}>
                            <IconButton
                              aria-label={t('actions.edit')}
                              size="sm"
                              data-testid={`model-provider-edit-btn-${index}`}
                              onClick={() => handleEditProvider(group.models[0])}
                              icon={<Icon name="edit" size="sm" />}
                            />
                          </Tooltip>
                          <Tooltip content={t('actions.deleteProvider')}>
                            <IconButton
                              aria-label={`${t('actions.deleteProvider')}: ${group.providerName}`}
                              tone="danger"
                              size="sm"
                              data-testid={`model-provider-delete-btn-${index}`}
                              onClick={() => void requestProviderDelete(group)}
                              icon={<Icon name="delete" size="sm" />}
                            />
                          </Tooltip>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="bitfun-model-settings__provider-group-list" data-bitfun-component="model-settings" data-bitfun-part="providerGroupList">
                          {group.models.map(config => renderModelCollectionItem(config))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ConfigPageSection>
        </DialogBody>
      </Dialog>

      <Dialog open={showTagSyncNotice} onOpenChange={setShowTagSyncNotice} preset="panel">
        <DialogHeader><DialogHeading><DialogTitle>{t('pool.syncTags')}</DialogTitle></DialogHeading><DialogClose /></DialogHeader>
        <DialogBody><p>{t('pool.recommendationsUnavailable')}</p></DialogBody>
        <DialogFooter><Button size="sm" variant="primary" onClick={() => setShowTagSyncNotice(false)}>{t('pool.acknowledge')}</Button></DialogFooter>
      </Dialog>
      <Dialog open={showSubscriptionManager} onOpenChange={open => { if (!loggingInProvider) setShowSubscriptionManager(open); }} preset="panel" closeOnPointerOutside={false}>
        <DialogHeader><DialogHeading><DialogTitle>{t('subscriptionAuth.sectionTitle')}</DialogTitle></DialogHeading><DialogClose disabled={!!loggingInProvider} /></DialogHeader>
        <DialogBody>{renderSubscriptionManager()}</DialogBody>
      </Dialog>


      <Dialog
        open={showModelsDevDetails}
        onOpenChange={(nextOpen) => { if (!nextOpen) setShowModelsDevDetails(false); }}
        size="sm"
      >
        <DialogHeader>
          <DialogHeading>
            <DialogTitle>{t('modelsDevCatalog.detailsTitle')}</DialogTitle>
          </DialogHeading>
          <DialogHeaderActions>
            <Tooltip content={t('modelsDevCatalog.refreshNow')}>
              <IconButton size="sm" aria-label={t('modelsDevCatalog.refreshNow')}
                loading={isRefreshingModelsDev} onClick={() => void handleRefreshModelsDev()}
                icon={<Icon name="refresh" size="sm" />} />
            </Tooltip>
            <DialogClose />
          </DialogHeaderActions>
        </DialogHeader>
        <DialogBody inset="none">
        <div className="bitfun-model-settings__catalog-details">
          <ConfigPageRow label={t('modelsDevCatalog.activeSource')} align="center">
            <span className="bitfun-model-settings__catalog-status-value">{modelsDevSourceLabel}</span>
          </ConfigPageRow>
          <ConfigPageRow label={t('modelsDevCatalog.catalogSize')} align="center">
            <span className="bitfun-model-settings__catalog-status-value">
              {modelsDevStatus
                ? t('modelsDevCatalog.catalogSizeValue', {
                    providers: i18nService.formatNumber(modelsDevStatus.provider_count),
                    models: i18nService.formatNumber(modelsDevStatus.reasoning_model_count),
                  })
                : t('modelsDevCatalog.loading')}
            </span>
          </ConfigPageRow>
          <ConfigPageRow label={t('modelsDevCatalog.cacheUpdatedAt')} align="center">
            <span className="bitfun-model-settings__catalog-status-value">{modelsDevUpdatedAt}</span>
          </ConfigPageRow>
          <ConfigPageRow label={t('modelsDevCatalog.cachePath')} align="center" wide>
            <div className="bitfun-model-settings__catalog-path">
              <code><OverflowText>{modelsDevStatus?.cache_path || '—'}</OverflowText></code>
              <Tooltip content={t('modelsDevCatalog.reveal')}>
                <IconButton
                  aria-label={t('modelsDevCatalog.reveal')}
                  size="sm"
                  onClick={() => {
                    void aiApi.revealModelsDevCacheDirectory().catch((error) => {
                      log.warn('Failed to reveal models.dev cache', { error });
                      notification.error(t('modelsDevCatalog.revealFailed'));
                    });
                  }}
                  icon={<FolderOpen size={14} aria-hidden="true" />}
                />
              </Tooltip>
            </div>
          </ConfigPageRow>
          <ConfigPageRow label={t('modelsDevCatalog.revision')} align="center">
            <code className="bitfun-model-settings__catalog-revision">
              <OverflowText>{modelsDevStatus?.revision || '—'}</OverflowText>
            </code>
          </ConfigPageRow>
          <div className="bitfun-model-settings__catalog-offline-help" role="note">
            <Icon name="info" size="sm" aria-hidden="true" />
            <div>
              <strong>{t('modelsDevCatalog.offlineTitle')}</strong>
              <p>{t('modelsDevCatalog.offlineDescription')}</p>
              <div className="bitfun-model-settings__catalog-offline-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void systemAPI.openExternal(MODELS_DEV_DOWNLOAD_URL)}
                  leadingIcon={<Icon name="arrow-up-right" size="sm" aria-hidden="true" />}
                >

                  {t('modelsDevCatalog.downloadOriginal')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void aiApi.revealModelsDevCacheDirectory().catch((error) => {
                      log.warn('Failed to reveal models.dev cache directory', { error });
                      notification.error(t('modelsDevCatalog.revealFailed'));
                    });
                  }}
                  leadingIcon={<FolderOpen size={14} aria-hidden="true" />}
                >

                  {t('modelsDevCatalog.openCacheDirectory')}
                </Button>
              </div>
            </div>
          </div>
        </div>
              </DialogBody>
      </Dialog>

      <Dialog
        open={!!subscriptionLogoutRequest}
        onOpenChange={(nextOpen) => { if (!nextOpen) setSubscriptionLogoutRequest(null); }}
        size="sm"
        closeOnPointerOutside={false}
      >
        <DialogHeader>
          <DialogHeading>
            <DialogTitle>{t('subscriptionAuth.logoutConfirmTitle')}</DialogTitle>
          </DialogHeading>
          <DialogClose />
        </DialogHeader>
        <DialogBody inset="none">
        <div className="bitfun-model-settings__subscription-logout-confirm" data-bitfun-component="model-settings" data-bitfun-part="logoutConfirm">
          <p>
            {subscriptionLogoutRequest?.affectedModels.length
              ? t('subscriptionAuth.logoutAffectedModels', {
                  count: subscriptionLogoutRequest.affectedModels.length,
                })
              : t('subscriptionAuth.logoutNoAffectedModels')}
          </p>
          {!!subscriptionLogoutRequest?.affectedModels.length && (
            <ScrollArea className="bitfun-model-settings__subscription-logout-list">
              <ul>
                {subscriptionLogoutRequest.affectedModels.map((model) => (
                  <li key={model.id}>{model.name} · {model.model_name}</li>
                ))}
              </ul>
            </ScrollArea>
          )}
          <p>{t('subscriptionAuth.logoutConsequence')}</p>
        </div>
              </DialogBody>
        <DialogFooter>{(
          <>
            <Button
              size="sm"
              variant="fill"
              onClick={() => setSubscriptionLogoutRequest(null)}
            >
              {t('subscriptionAuth.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              tone="danger"
              onClick={() => void confirmSubscriptionLogout()}
            >
              {t('subscriptionAuth.confirmLogout')}
            </Button>
          </>
        )}</DialogFooter>
      </Dialog>

      <Dialog
        open={isEditing && !!editingConfig}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !isEditorSaving) {
            if (reasoningPanelDraft) finishReasoningPanel();
            else if (modelPanelDraft) finishModelPanel();
            else requestCloseEditingModal();
          }
        }}
        className="bitfun-model-settings__editor-dialog"
        preset="panel"
      >
        <DialogHeader>
          {modelPanelDraft && !reasoningPanelDraft && <DialogHeaderLeading>
            <IconButton size="sm" variant="quiet" aria-label={t('actions.back')} data-testid="settings-model-back-btn" icon={<Icon name="chevron-left" size="sm" />} onClick={finishModelPanel} />
          </DialogHeaderLeading>}
          <DialogHeading>
            <DialogTitle>{reasoningPanelDraft
          ? t('reasoningPresets.dialogTitle', {
              provider: editingConfig?.name?.trim()
                || currentTemplate?.name
                || editingConfig?.provider
                || '',
              model: reasoningPanelDraft.modelName,
            })
          : modelPanelDraft && editingConfig ? t('modelEditorTitle', {
              model: modelPanelDraft.modelName || t('editModel'),
              provider: getProviderDisplayName(editingConfig),
            }) : editingConfig?.id
            ? editingConfig.model_name || t('editModel')
            : (getProviderInstanceId(editingConfig)
              ? t('editProvider')
              : (currentTemplate ? `${t('newProvider')} - ${currentTemplate.name}` : t('newProvider')))}</DialogTitle>
          </DialogHeading>
          <DialogClose disabled={isEditorSaving} />
        </DialogHeader>
        <DialogBody
          inset="none"
          aria-busy={isEditorSaving}
          {...(isEditorSaving ? { inert: '' } : {})}
        >
        {reasoningPanelDraft ? (
          <ReasoningConfigPanel
            key={reasoningPanelDraft.key}
            value={reasoningPanelDraft.reasoning}
            generatedProjection={reasoningPanelProjection}
            modelsDevReasoningCatalog={modelCatalog?.models_dev_reasoning_catalog}
            projectionRequest={reasoningPanelProjectionRequest}
            requestFormatLabel={reasoningPanelProjectionRequest
              ? requestFormatLabelMap[reasoningPanelProjectionRequest.provider]
                || reasoningPanelProjectionRequest.provider
              : undefined}
            onCancel={cancelReasoningPanel}
            onDraftChange={updateReasoningPanelDraft}
            onApply={(result: ReasoningConfigApplyResult) => {
              updateReasoningPanelDraft(result);
              finishReasoningPanel();
            }}
          />
        ) : renderEditingForm()}
              </DialogBody>
        {!reasoningPanelDraft && (
          <DialogFooter appearance="floating">
            <Button variant="fill" size="sm" onClick={modelPanelDraft ? cancelModelPanel : requestCloseEditingModal} disabled={isEditorSaving}>
              {t('actions.cancel')}
            </Button>
            <Button
              data-testid="settings-model-save-btn"
              variant="primary"
              size="sm"
              onClick={() => modelPanelDraft ? finishModelPanel() : void handleSave()}
              loading={isEditorSaving}
            >
              {t('actions.save')}
            </Button>
          </DialogFooter>
        )}
      </Dialog>
      <ConfirmDialog
        open={draftCloseConfirmOpen}
        onOpenChange={(open) => { if (!open) setDraftCloseConfirmOpen(false); }}
        onConfirm={preserveEditingDraftAndClose}
        onSecondary={closeEditingModal}
        title={t('draftClose.title')}
        message={t('draftClose.message')}
        confirmText={t('draftClose.keepAndClose')}
        secondaryText={t('draftClose.discard')}
        cancelText={t('draftClose.continueEditing')}
        closeOnPointerOutside={false}
        type="warning"
      />
      <ConfirmDialog
        open={draftConflictConfirmOpen}
        onOpenChange={(open) => { if (!open) cancelPendingEditorOpen(); }}
        onConfirm={continueEditingCurrentDraft}
        onSecondary={discardDraftBeforeOpeningPendingEditor}
        title={t('draftConflict.title')}
        message={t('draftConflict.message')}
        confirmText={t('draftConflict.continueDraft')}
        secondaryText={t('draftConflict.discardAndContinue')}
        cancelText={t('draftConflict.cancel')}
        closeOnPointerOutside={false}
        type="warning"
      />
      <ConfirmDialog
        open={!!deleteRequest}
        onOpenChange={(open) => { if (!open) setDeleteRequest(null); }}
        onConfirm={handleDelete}
        title={t(deleteRequest?.kind === 'provider'
          ? 'providerDeleteConfirm.title'
          : 'deleteConfirm.title')}
        message={deleteRequest?.kind === 'provider'
          ? t(deleteRequest.discardsRetainedDraft
            ? 'providerDeleteConfirm.messageWithDraft'
            : 'providerDeleteConfirm.message', {
              name: deleteRequest.providerName,
              modelCount: deleteRequest.modelCount,
              referenceCount: deleteRequest.referenceCount,
            })
          : t('deleteConfirm.message', {
              name: deleteRequest?.config.model_name || '',
              count: deleteRequest?.referenceCount ?? 0,
            })}
        confirmText={t(deleteRequest?.kind === 'provider'
          ? 'providerDeleteConfirm.confirm'
          : 'deleteConfirm.confirm')}
        type="warning"
        confirmDanger
      />
    </ConfigPageLayout>
  );
};

export default ModelSettingsPage;
