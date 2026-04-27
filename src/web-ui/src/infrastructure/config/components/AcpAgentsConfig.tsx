import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  CheckCircle,
  Clock,
  FileJson,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  XCircle,
} from 'lucide-react';
import { Button, IconButton, Input, Select, Switch, Textarea } from '@/component-library';
import {
  ConfigCollectionItem,
  ConfigPageContent,
  ConfigPageHeader,
  ConfigPageLayout,
  ConfigPageSection,
} from './common';
import { ACPClientAPI, type AcpClientInfo, type AcpClientPermissionMode } from '../../api/service-api/ACPClientAPI';
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
  command: string;
  args: string[];
}

const PRESETS: AcpClientPreset[] = [
  {
    id: 'opencode',
    name: 'opencode',
    command: 'opencode',
    args: ['acp'],
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    command: 'npx',
    args: ['--yes', '@zed-industries/claude-code-acp@latest'],
  },
  {
    id: 'codex',
    name: 'Codex',
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

function parseArgsText(value: string): string[] {
  return value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function formatArgs(args: string[]): string {
  return args.join('\n');
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

function statusTone(status?: AcpClientInfo['status']): 'ok' | 'pending' | 'error' | 'muted' {
  if (status === 'running') return 'ok';
  if (status === 'starting') return 'pending';
  if (status === 'failed') return 'error';
  return 'muted';
}

function StatusIcon({ status }: { status?: AcpClientInfo['status'] }) {
  if (status === 'running') return <CheckCircle size={13} />;
  if (status === 'starting') return <Clock size={13} />;
  if (status === 'failed') return <XCircle size={13} />;
  return <Square size={13} />;
}

const AcpAgentsConfig: React.FC = () => {
  const { t } = useTranslation('settings/acp-agents');
  const { error: notifyError, success: notifySuccess } = useNotification();
  const jsonEditorRef = useRef<HTMLTextAreaElement>(null);

  const [config, setConfig] = useState<AcpClientConfigFile>({ acpClients: {} });
  const [clients, setClients] = useState<AcpClientInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [jsonConfig, setJsonConfig] = useState('');
  const [envDrafts, setEnvDrafts] = useState<Record<string, string>>({});
  const [operationClientId, setOperationClientId] = useState<string | null>(null);

  const clientsById = useMemo(() => new Map(clients.map(client => [client.id, client])), [clients]);
  const clientRows = useMemo(() => {
    const ids = new Set<string>([
      ...PRESETS.map(preset => preset.id),
      ...Object.keys(config.acpClients),
      ...clients.map(client => client.id),
    ]);

    return Array.from(ids).sort((a, b) => {
      const presetA = PRESETS.findIndex(preset => preset.id === a);
      const presetB = PRESETS.findIndex(preset => preset.id === b);
      if (presetA !== -1 || presetB !== -1) {
        return (presetA === -1 ? Number.MAX_SAFE_INTEGER : presetA) -
          (presetB === -1 ? Number.MAX_SAFE_INTEGER : presetB);
      }
      return a.localeCompare(b);
    });
  }, [clients, config.acpClients]);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const [rawConfig, nextClients] = await Promise.all([
        ACPClientAPI.loadJsonConfig(),
        ACPClientAPI.getClients(),
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

  const applyPreset = (preset: AcpClientPreset) => {
    setEnvDrafts(prev => ({
      ...prev,
      [preset.id]: '',
    }));
    patchClientConfig(preset.id, {
      ...defaultConfigForPreset(preset),
      enabled: true,
    });
    setExpandedClientId(preset.id);
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
      const nextClients = await ACPClientAPI.getClients();
      setClients(nextClients);
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

  const runClientOperation = async (
    clientId: string,
    operation: 'start' | 'stop' | 'restart',
  ) => {
    try {
      setOperationClientId(clientId);
      if (operation === 'start') {
        await ACPClientAPI.startClient({ clientId });
      } else if (operation === 'stop') {
        await ACPClientAPI.stopClient({ clientId });
      } else {
        await ACPClientAPI.restartClient({ clientId });
      }
      setClients(await ACPClientAPI.getClients());
    } catch (error) {
      log.error('ACP client operation failed', { clientId, operation, error });
      notifyError(error instanceof Error ? error.message : String(error), {
        title: t('notifications.operationFailed'),
      });
    } finally {
      setOperationClientId(null);
    }
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

        <ConfigPageSection
          title={t('presets.title')}
          description={t('presets.description')}
        >
          <div className="bitfun-acp-agents__preset-grid">
            {PRESETS.map(preset => {
              const configured = Boolean(config.acpClients[preset.id] || clientsById.has(preset.id));
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`bitfun-acp-agents__preset${configured ? ' is-configured' : ''}`}
                  onClick={() => applyPreset(preset)}
                >
                  <Bot size={16} />
                  <span className="bitfun-acp-agents__preset-name">{preset.name}</span>
                  <span className="bitfun-acp-agents__preset-command">
                    {[preset.command, ...preset.args].join(' ')}
                  </span>
                </button>
              );
            })}
          </div>
        </ConfigPageSection>

        <ConfigPageSection
          title={t('clients.title')}
          description={t('clients.description')}
          extra={(
            <IconButton
              variant="ghost"
              size="small"
              onClick={() => { void loadConfig(); }}
              disabled={loading}
              tooltip={t('actions.refresh')}
            >
              <RefreshCw size={14} />
            </IconButton>
          )}
        >
          {loading ? (
            <div className="bitfun-acp-agents__empty">{t('clients.loading')}</div>
          ) : clientRows.length === 0 ? (
            <div className="bitfun-acp-agents__empty">{t('clients.empty')}</div>
          ) : (
            <div className="bitfun-acp-agents__client-list">
              {clientRows.map(clientId => {
                const preset = PRESET_BY_ID.get(clientId);
                const clientInfo = clientsById.get(clientId);
                const clientConfig = config.acpClients[clientId] ??
                  (preset ? defaultConfigForPreset(preset) : undefined);
                if (!clientConfig) return null;

                const status = clientInfo?.status ?? (clientConfig.enabled ? 'configured' : 'stopped');
                const running = status === 'running' || status === 'starting';
                const busy = operationClientId === clientId;

                return (
                  <ConfigCollectionItem
                    key={clientId}
                    label={clientConfig.name || clientInfo?.name || clientId}
                    expanded={expandedClientId === clientId}
                    onToggle={() => setExpandedClientId(prev => prev === clientId ? null : clientId)}
                    badge={(
                      <span className={`bitfun-acp-agents__status is-${statusTone(status)}`}>
                        <StatusIcon status={status} />
                        {t(`status.${status}`)}
                      </span>
                    )}
                    control={(
                      <div className="bitfun-acp-agents__client-actions">
                        <Switch
                          size="small"
                          checked={clientConfig.enabled}
                          onChange={(event) => patchClientConfig(clientId, { enabled: event.currentTarget.checked })}
                        />
                        <IconButton
                          variant="ghost"
                          size="small"
                          onClick={() => applyPreset(preset ?? {
                            id: clientId,
                            name: clientConfig.name || clientId,
                            command: clientConfig.command,
                            args: clientConfig.args,
                          })}
                          tooltip={t('actions.restorePreset')}
                        >
                          <RotateCcw size={13} />
                        </IconButton>
                        {running ? (
                          <IconButton
                            variant="ghost"
                            size="small"
                            onClick={() => { void runClientOperation(clientId, 'stop'); }}
                            disabled={busy}
                            tooltip={t('actions.stop')}
                          >
                            <Square size={13} />
                          </IconButton>
                        ) : (
                          <IconButton
                            variant="ghost"
                            size="small"
                            onClick={() => { void runClientOperation(clientId, 'start'); }}
                            disabled={busy || !clientConfig.enabled || dirty}
                            tooltip={dirty ? t('actions.saveBeforeStart') : t('actions.start')}
                          >
                            <Play size={13} />
                          </IconButton>
                        )}
                      </div>
                    )}
                    details={(
                      <div className="bitfun-acp-agents__client-details">
                        <Input
                          label={t('fields.name')}
                          value={clientConfig.name || ''}
                          onChange={(event) => patchClientConfig(clientId, { name: event.target.value || undefined })}
                          size="small"
                          variant="outlined"
                        />
                        <Input
                          label={t('fields.command')}
                          value={clientConfig.command}
                          onChange={(event) => patchClientConfig(clientId, { command: event.target.value })}
                          size="small"
                          variant="outlined"
                        />
                        <Textarea
                          label={t('fields.args')}
                          value={formatArgs(clientConfig.args)}
                          onChange={(event) => patchClientConfig(clientId, { args: parseArgsText(event.target.value) })}
                          rows={3}
                          spellCheck={false}
                        />
                        <Textarea
                          label={t('fields.env')}
                          value={envDrafts[clientId] ?? formatEnv(clientConfig.env)}
                          onChange={(event) => {
                            const value = event.target.value;
                            setEnvDrafts(prev => ({
                              ...prev,
                              [clientId]: value,
                            }));
                            try {
                              patchClientConfig(clientId, { env: parseEnvText(value) });
                            } catch (error) {
                              notifyError(error instanceof Error ? error.message : String(error), {
                                title: t('notifications.invalidEnv'),
                              });
                            }
                          }}
                          rows={3}
                          spellCheck={false}
                        />
                        <div className="bitfun-acp-agents__client-options">
                          <Switch
                            label={t('fields.autoStart')}
                            checked={clientConfig.autoStart}
                            onChange={(event) => patchClientConfig(clientId, { autoStart: event.currentTarget.checked })}
                            size="small"
                          />
                          <Switch
                            label={t('fields.readonly')}
                            checked={clientConfig.readonly}
                            onChange={(event) => patchClientConfig(clientId, { readonly: event.currentTarget.checked })}
                            size="small"
                          />
                          <Select
                            label={t('fields.permissionMode')}
                            options={permissionOptions}
                            value={clientConfig.permissionMode}
                            onChange={(value) => patchClientConfig(clientId, {
                              permissionMode: normalizePermissionMode(value),
                            })}
                            size="small"
                          />
                        </div>
                      </div>
                    )}
                  />
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
