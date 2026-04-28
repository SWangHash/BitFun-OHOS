import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Bot,
  CheckCircle,
  Download,
  ExternalLink,
  FileJson,
  PackageCheck,
  Save,
  Search,
  Terminal,
} from 'lucide-react';
import { Button, Input, Select, Textarea } from '@/component-library';
import {
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageSection,
} from './common';
import {
  ACPClientAPI,
  type AcpClientInfo,
  type AcpClientPermissionMode,
  type AcpClientRequirementProbe,
  type AcpRequirementProbeItem,
} from '../../api/service-api/ACPClientAPI';
import { useNotification } from '@/shared/notification-system';
import { createLogger } from '@/shared/utils/logger';
import './AcpAgentsConfig.scss';

const log = createLogger('AcpAgentsConfig');

interface AcpClientConfig {
  name?: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  autoStart: boolean;
  readonly: boolean;
  permissionMode: AcpClientPermissionMode;
}

interface AcpClientConfigFile {
  acpClients: Record<string, AcpClientConfig>;
}

interface AcpClientPreset {
  id: string;
  name: string;
  description: string;
  version?: string;
  command: string;
  args: string[];
}

const PRESETS: AcpClientPreset[] = [
  {
    id: 'opencode',
    name: 'opencode',
    description: 'AI coding agent with native ACP support.',
    command: 'opencode',
    args: ['acp'],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Claude Code connected through the Zed ACP adapter.',
    command: 'npx',
    args: ['--yes', '@zed-industries/claude-code-acp@latest'],
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex CLI connected through the Zed ACP adapter.',
    command: 'npx',
    args: ['--yes', '@zed-industries/codex-acp@latest'],
  },
];

const PRESET_BY_ID = new Map(PRESETS.map(preset => [preset.id, preset]));

function defaultConfigForPreset(preset: AcpClientPreset): AcpClientConfig {
  return {
    name: preset.name,
    command: preset.command,
    args: preset.args,
    env: {},
    enabled: preset.id === 'opencode',
    autoStart: false,
    readonly: false,
    permissionMode: 'ask',
  };
}

function normalizeConfigValue(value: unknown): AcpClientConfigFile {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawClients = (
    candidate.acpClients && typeof candidate.acpClients === 'object' && !Array.isArray(candidate.acpClients)
  )
    ? candidate.acpClients as Record<string, unknown>
    : candidate;

  const acpClients: Record<string, AcpClientConfig> = {};
  for (const [id, rawConfig] of Object.entries(rawClients)) {
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
      continue;
    }

    const item = rawConfig as Record<string, unknown>;
    const command = typeof item.command === 'string' ? item.command.trim() : '';
    if (!command) {
      continue;
    }

    acpClients[id] = {
      name: typeof item.name === 'string' ? item.name : undefined,
      command,
      args: Array.isArray(item.args) ? item.args.map(String) : [],
      env: normalizeEnvObject(item.env),
      enabled: item.enabled !== false,
      autoStart: item.autoStart === true,
      readonly: item.readonly === true,
      permissionMode: normalizePermissionMode(item.permissionMode),
    };
  }

  return { acpClients };
}

function normalizeEnvObject(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, envValue]) => [key, String(envValue)])
  );
}

function normalizePermissionMode(value: unknown): AcpClientPermissionMode {
  return value === 'allow_once' || value === 'reject_once' ? value : 'ask';
}

function formatConfig(config: AcpClientConfigFile): string {
  return JSON.stringify(config, null, 2);
}

function parseEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of value.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(`Invalid env line: ${line}`);
    }
    env[line.slice(0, separator).trim()] = line.slice(separator + 1);
  }
  return env;
}

function formatEnv(env: Record<string, string>): string {
  return Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n');
}

function requirementTone(item?: AcpRequirementProbeItem): 'ok' | 'error' | 'muted' {
  if (!item) return 'muted';
  return item.installed ? 'ok' : 'error';
}

function RequirementPill({
  icon,
  item,
  label,
  installedText,
  missingText,
}: {
  icon: React.ReactNode;
  item?: AcpRequirementProbeItem;
  label: string;
  installedText: string;
  missingText: string;
}) {
  if (!item) return null;
  const titleParts = [
    item.name,
    item.path,
    item.version,
    item.error,
  ].filter(Boolean);
  return (
    <span
      className={`bitfun-acp-agents__requirement is-${requirementTone(item)}`}
      title={titleParts.join('\n')}
    >
      {icon}
      <span>{label}</span>
      <span>{item.installed ? installedText : missingText}</span>
    </span>
  );
}

type RegistryFilter = 'all' | 'installed' | 'not_installed';

const AcpAgentsConfig: React.FC = () => {
  const { t } = useTranslation('settings/acp-agents');
  const { error: notifyError, success: notifySuccess } = useNotification();
  const jsonEditorRef = useRef<HTMLTextAreaElement>(null);

  const [config, setConfig] = useState<AcpClientConfigFile>({ acpClients: {} });
  const [clients, setClients] = useState<AcpClientInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonConfig, setJsonConfig] = useState('');
  const [envDrafts, setEnvDrafts] = useState<Record<string, string>>({});
  const [requirementProbes, setRequirementProbes] = useState<AcpClientRequirementProbe[]>([]);
  const [downloadingAdapterClientId, setDownloadingAdapterClientId] = useState<string | null>(null);
  const [registrySearch, setRegistrySearch] = useState('');
  const [registryFilter, setRegistryFilter] = useState<RegistryFilter>('all');

  const clientsById = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);
  const probesById = useMemo(
    () => new Map(requirementProbes.map(probe => [probe.id, probe])),
    [requirementProbes]
  );
  const customClientRows = useMemo(() => {
    const ids = new Set<string>([
      ...Object.keys(config.acpClients),
      ...clients.map(client => client.id),
    ]);

    return Array.from(ids)
      .filter(id => !PRESET_BY_ID.has(id))
      .sort((a, b) => a.localeCompare(b));
  }, [clients, config.acpClients]);

  const registryPresets = useMemo(() => {
    const search = registrySearch.trim().toLowerCase();
    return PRESETS.filter(preset => {
      const probe = probesById.get(preset.id);
      const configured = Boolean(config.acpClients[preset.id] || clientsById.has(preset.id));
      const installed = configured && probe?.runnable === true;
      if (registryFilter === 'installed' && !installed) return false;
      if (registryFilter === 'not_installed' && installed) return false;
      if (!search) return true;
      return [
        preset.name,
        preset.id,
        preset.description,
        preset.command,
        ...preset.args,
      ].join(' ').toLowerCase().includes(search);
    });
  }, [clientsById, config.acpClients, probesById, registryFilter, registrySearch]);

  const visibleCustomClientRows = useMemo(() => {
    const search = registrySearch.trim().toLowerCase();
    return customClientRows.filter(clientId => {
      const clientConfig = config.acpClients[clientId];
      const clientInfo = clientsById.get(clientId);
      const requirementProbe = probesById.get(clientId);
      const installed = clientConfig?.enabled !== false && requirementProbe?.runnable === true;
      if (registryFilter === 'installed' && !installed) return false;
      if (registryFilter === 'not_installed' && installed) return false;
      if (!search) return true;
      return [
        clientId,
        clientConfig?.name,
        clientInfo?.name,
        clientConfig?.command,
        ...(clientConfig?.args ?? []),
      ].filter(Boolean).join(' ').toLowerCase().includes(search);
    });
  }, [clientsById, config.acpClients, customClientRows, probesById, registryFilter, registrySearch]);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const [rawConfig, nextClients, nextRequirementProbes] = await Promise.all([
        ACPClientAPI.loadJsonConfig(),
        ACPClientAPI.getClients(),
        ACPClientAPI.probeClientRequirements(),
      ]);
      const parsed = normalizeConfigValue(JSON.parse(rawConfig || '{}'));
      setConfig(parsed);
      setJsonConfig(formatConfig(parsed));
      setEnvDrafts(
        Object.fromEntries(
          Object.entries(parsed.acpClients).map(([clientId, clientConfig]) => [
            clientId,
            formatEnv(clientConfig.env),
          ])
        )
      );
      setClients(nextClients);
      setRequirementProbes(nextRequirementProbes);
      setDirty(false);
    } catch (error) {
      log.error('Failed to load ACP agent config', error);
      notifyError(error instanceof Error ? error.message : String(error), {
        title: t('notifications.loadFailed'),
      });
    } finally {
      setLoading(false);
    }
  }, [notifyError, t]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const handleAcpClientsChanged = () => {
      void loadConfig();
    };
    window.addEventListener('bitfun:acp-clients-changed', handleAcpClientsChanged);
    return () => {
      window.removeEventListener('bitfun:acp-clients-changed', handleAcpClientsChanged);
    };
  }, [loadConfig]);

  const patchClientConfig = (clientId: string, patch: Partial<AcpClientConfig>) => {
    setConfig(prev => {
      const preset = PRESET_BY_ID.get(clientId);
      const current = prev.acpClients[clientId] ??
        (preset ? defaultConfigForPreset(preset) : undefined);
      if (!current) return prev;

      const next = {
        acpClients: {
          ...prev.acpClients,
          [clientId]: {
            ...current,
            ...patch,
          },
        },
      };
      setJsonConfig(formatConfig(next));
      return next;
    });
    setDirty(true);
  };

  const mergeEnvDrafts = (baseConfig: AcpClientConfigFile): AcpClientConfigFile => ({
    acpClients: Object.fromEntries(
      Object.entries(baseConfig.acpClients).map(([clientId, clientConfig]) => [
        clientId,
        {
          ...clientConfig,
          env: envDrafts[clientId] !== undefined
            ? parseEnvText(envDrafts[clientId])
            : clientConfig.env,
        },
      ])
    ),
  });

  const saveConfig = async (nextConfig = config, options: { mergeEnvDrafts?: boolean } = {}) => {
    try {
      setSaving(true);
      const configToSave = options.mergeEnvDrafts === false
        ? nextConfig
        : mergeEnvDrafts(nextConfig);
      await ACPClientAPI.saveJsonConfig(formatConfig(configToSave));
      const [nextClients, nextRequirementProbes] = await Promise.all([
        ACPClientAPI.getClients(),
        ACPClientAPI.probeClientRequirements(),
      ]);
      setClients(nextClients);
      setRequirementProbes(nextRequirementProbes);
      setConfig(configToSave);
      setJsonConfig(formatConfig(configToSave));
      setDirty(false);
      notifySuccess(t('notifications.saveSuccess'));
    } catch (error) {
      log.error('Failed to save ACP agent config', error);
      notifyError(error instanceof Error ? error.message : String(error), {
        title: t('notifications.saveFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const saveJsonConfig = async () => {
    try {
      const parsed = normalizeConfigValue(JSON.parse(jsonConfig));
      await saveConfig(parsed, { mergeEnvDrafts: false });
      setConfig(parsed);
      setEnvDrafts(
        Object.fromEntries(
          Object.entries(parsed.acpClients).map(([clientId, clientConfig]) => [
            clientId,
            formatEnv(clientConfig.env),
          ])
        )
      );
      setShowJsonEditor(false);
    } catch (error) {
      notifyError(error instanceof Error ? error.message : String(error), {
        title: t('notifications.invalidJson'),
      });
    }
  };

  const predownloadAdapter = async (clientId: string) => {
    try {
      setDownloadingAdapterClientId(clientId);
      await ACPClientAPI.predownloadClientAdapter({ clientId });
      setRequirementProbes(await ACPClientAPI.probeClientRequirements());
      notifySuccess(t('notifications.predownloadSuccess'));
    } catch (error) {
      log.error('Failed to predownload ACP adapter', { clientId, error });
      notifyError(error instanceof Error ? error.message : String(error), {
        title: t('notifications.predownloadFailed'),
      });
    } finally {
      setDownloadingAdapterClientId(null);
    }
  };

  const installPreset = async (preset: AcpClientPreset) => {
    const nextConfig = {
      acpClients: {
        ...config.acpClients,
        [preset.id]: {
          ...defaultConfigForPreset(preset),
          enabled: true,
        },
      },
    };
    setEnvDrafts(prev => ({
      ...prev,
      [preset.id]: '',
    }));
    await saveConfig(nextConfig, { mergeEnvDrafts: false });
  };

  const permissionOptions = useMemo(() => [
    { value: 'ask', label: t('permissionMode.ask') },
    { value: 'allow_once', label: t('permissionMode.allowOnce') },
    { value: 'reject_once', label: t('permissionMode.rejectOnce') },
  ], [t]);

  return (
    <ConfigPageLayout className="bitfun-acp-agents">
      <ConfigPageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        extra={(
          <div className="bitfun-acp-agents__header-actions">
            <Button
              variant="secondary"
              size="small"
              onClick={() => window.open('https://zed.dev/docs/agent-client-protocol', '_blank', 'noopener,noreferrer')}
            >
              {t('actions.learnMore')}
              <ExternalLink size={14} />
            </Button>
            <Button
              variant="secondary"
              size="small"
              onClick={() => setShowJsonEditor(prev => !prev)}
            >
              <FileJson size={14} />
              {showJsonEditor ? t('actions.closeJson') : t('actions.editJson')}
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={() => { void saveConfig(); }}
              disabled={!dirty}
              isLoading={saving}
            >
              <Save size={14} />
              {t('actions.save')}
            </Button>
          </div>
        )}
      />

      <ConfigPageContent>
        {showJsonEditor && (
          <ConfigPageSection
            title={t('json.title')}
            description={t('json.description')}
          >
            <Textarea
              ref={jsonEditorRef}
              className="bitfun-acp-agents__json-textarea"
              value={jsonConfig}
              onChange={(event) => {
                setJsonConfig(event.target.value);
                setDirty(true);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                event.preventDefault();
                const target = event.currentTarget;
                const start = target.selectionStart ?? 0;
                const end = target.selectionEnd ?? 0;
                const nextValue = jsonConfig.slice(0, start) + '  ' + jsonConfig.slice(end);
                setJsonConfig(nextValue);
                setDirty(true);
                requestAnimationFrame(() => {
                  jsonEditorRef.current?.focus();
                  jsonEditorRef.current?.setSelectionRange(start + 2, start + 2);
                });
              }}
              rows={16}
              spellCheck={false}
            />
            <div className="bitfun-acp-agents__json-actions">
              <Button variant="secondary" size="small" onClick={() => setJsonConfig(formatConfig(config))}>
                {t('actions.revert')}
              </Button>
              <Button variant="primary" size="small" onClick={() => { void saveJsonConfig(); }} isLoading={saving}>
                {t('actions.saveJson')}
              </Button>
            </div>
          </ConfigPageSection>
        )}

        <ConfigPageSection title={t('registry.title')} description={t('registry.description')}>
          <div className="bitfun-acp-agents__registry-toolbar">
            <Input
              className="bitfun-acp-agents__registry-search"
              value={registrySearch}
              onChange={(event) => setRegistrySearch(event.target.value)}
              placeholder={t('registry.searchPlaceholder')}
              prefix={<Search size={16} />}
              size="medium"
              variant="outlined"
            />
            <div className="bitfun-acp-agents__registry-tabs" role="tablist" aria-label={t('registry.filterLabel')}>
              {([
                ['all', t('registry.filters.all')],
                ['installed', t('registry.filters.installed')],
                ['not_installed', t('registry.filters.notInstalled')],
              ] as const).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  className={`bitfun-acp-agents__registry-tab${registryFilter === filter ? ' is-active' : ''}`}
                  onClick={() => setRegistryFilter(filter)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="bitfun-acp-agents__empty">{t('clients.loading')}</div>
          ) : registryPresets.length === 0 && visibleCustomClientRows.length === 0 ? (
            <div className="bitfun-acp-agents__empty">{t('registry.empty')}</div>
          ) : (
            <div className="bitfun-acp-agents__registry-list">
              {registryPresets.map(preset => {
                const clientConfig = config.acpClients[preset.id] ?? defaultConfigForPreset(preset);
                const requirementProbe = probesById.get(preset.id);
                const configured = Boolean(config.acpClients[preset.id] || clientsById.has(preset.id));
                const runnable = requirementProbe?.runnable === true;
                const installed = configured && runnable;
                const adapterMissing = Boolean(requirementProbe?.adapter && !requirementProbe.adapter.installed);
                const toolMissing = Boolean(requirementProbe?.tool && !requirementProbe.tool.installed);
                const canPredownload = adapterMissing && !toolMissing;
                const downloadingAdapter = downloadingAdapterClientId === preset.id;

                return (
                  <div key={preset.id} className={`bitfun-acp-agents__registry-card${installed ? ' is-installed' : ''}`}>
                    <div className="bitfun-acp-agents__registry-main">
                      <span className="bitfun-acp-agents__registry-icon">
                        <Bot size={20} />
                      </span>
                      <div className="bitfun-acp-agents__registry-copy">
                        <div className="bitfun-acp-agents__registry-title-row">
                          <span className="bitfun-acp-agents__registry-name">{preset.name}</span>
                          {preset.version && (
                            <span className="bitfun-acp-agents__registry-version">{preset.version}</span>
                          )}
                        </div>
                        <p className="bitfun-acp-agents__registry-description">{preset.description}</p>
                        <div className="bitfun-acp-agents__registry-footer">
                          <div className="bitfun-acp-agents__registry-requirements">
                            <RequirementPill
                              icon={<Terminal size={12} />}
                              item={requirementProbe?.tool}
                              label={t('requirements.tool')}
                              installedText={t('requirements.installed')}
                              missingText={t('requirements.missing')}
                            />
                            <RequirementPill
                              icon={<PackageCheck size={12} />}
                              item={requirementProbe?.adapter}
                              label={t('requirements.adapter')}
                              installedText={t('requirements.installed')}
                              missingText={t('requirements.missing')}
                            />
                          </div>
                          <div className="bitfun-acp-agents__registry-confirmation">
                            <span className="bitfun-acp-agents__registry-confirmation-label">
                              {t('fields.permissionMode')}
                            </span>
                            <Select
                              className="bitfun-acp-agents__registry-confirmation-select"
                              options={permissionOptions}
                              value={clientConfig.permissionMode}
                              onChange={(value) => patchClientConfig(preset.id, {
                                permissionMode: normalizePermissionMode(value),
                              })}
                              size="small"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bitfun-acp-agents__registry-side">
                      {installed ? (
                        <span className="bitfun-acp-agents__registry-installed">
                          <CheckCircle size={14} />
                          {t('registry.installed')}
                        </span>
                      ) : runnable ? (
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => { void installPreset(preset); }}
                          isLoading={saving}
                          disabled={saving}
                        >
                          <Download size={14} />
                          {t('actions.install')}
                        </Button>
                      ) : canPredownload ? (
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => { void predownloadAdapter(preset.id); }}
                          isLoading={downloadingAdapter}
                          disabled={downloadingAdapter}
                        >
                          <Download size={14} />
                          {t('actions.predownloadAcp')}
                        </Button>
                      ) : (
                        <span className="bitfun-acp-agents__registry-missing">
                          <AlertCircle size={14} />
                          {toolMissing ? t('registry.cliRequired') : t('registry.notInstalled')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {visibleCustomClientRows.map(clientId => {
                const clientInfo = clientsById.get(clientId);
                const clientConfig = config.acpClients[clientId];
                if (!clientConfig) return null;

                const requirementProbe = probesById.get(clientId);
                const runnable = requirementProbe?.runnable === true;
                const installed = clientConfig.enabled !== false && runnable;
                const adapterMissing = Boolean(requirementProbe?.adapter && !requirementProbe.adapter.installed);
                const toolMissing = Boolean(requirementProbe?.tool && !requirementProbe.tool.installed);
                const canPredownload = adapterMissing && !toolMissing;
                const downloadingAdapter = downloadingAdapterClientId === clientId;
                const displayName = clientConfig.name || clientInfo?.name || clientId;

                return (
                  <div
                    key={clientId}
                    className="bitfun-acp-agents__registry-card"
                  >
                    <div className="bitfun-acp-agents__registry-main">
                      <span className="bitfun-acp-agents__registry-icon">
                        <Bot size={20} />
                      </span>
                      <div className="bitfun-acp-agents__registry-copy">
                        <div className="bitfun-acp-agents__registry-title-row">
                          <span className="bitfun-acp-agents__registry-name">{displayName}</span>
                        </div>
                        <p className="bitfun-acp-agents__registry-description bitfun-acp-agents__registry-command">
                          {[clientConfig.command, ...clientConfig.args].join(' ')}
                        </p>
                        <div className="bitfun-acp-agents__registry-footer">
                          <div className="bitfun-acp-agents__registry-requirements">
                            <RequirementPill
                              icon={<Terminal size={12} />}
                              item={requirementProbe?.tool}
                              label={t('requirements.tool')}
                              installedText={t('requirements.installed')}
                              missingText={t('requirements.missing')}
                            />
                            <RequirementPill
                              icon={<PackageCheck size={12} />}
                              item={requirementProbe?.adapter}
                              label={t('requirements.adapter')}
                              installedText={t('requirements.installed')}
                              missingText={t('requirements.missing')}
                            />
                          </div>
                          <div className="bitfun-acp-agents__registry-confirmation">
                            <span className="bitfun-acp-agents__registry-confirmation-label">
                              {t('fields.permissionMode')}
                            </span>
                            <Select
                              className="bitfun-acp-agents__registry-confirmation-select"
                              options={permissionOptions}
                              value={clientConfig.permissionMode}
                              onChange={(value) => patchClientConfig(clientId, {
                                permissionMode: normalizePermissionMode(value),
                              })}
                              size="small"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="bitfun-acp-agents__registry-side">
                      {installed ? (
                        <span className="bitfun-acp-agents__registry-installed">
                          <CheckCircle size={14} />
                          {t('registry.installed')}
                        </span>
                      ) : canPredownload ? (
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => { void predownloadAdapter(clientId); }}
                          isLoading={downloadingAdapter}
                          disabled={downloadingAdapter}
                        >
                          <Download size={14} />
                          {t('actions.predownloadAcp')}
                        </Button>
                      ) : (
                        <span className="bitfun-acp-agents__registry-missing">
                          <AlertCircle size={14} />
                          {toolMissing ? t('registry.cliRequired') : t('registry.notInstalled')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ConfigPageSection>
      </ConfigPageContent>
    </ConfigPageLayout>
  );
};

export default AcpAgentsConfig;
