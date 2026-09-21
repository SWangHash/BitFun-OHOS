// @vitest-environment jsdom

import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { AcpManagedProvisioningProgress } from '../../api/service-api/ACPClientAPI';
import { Select as ActualSelect } from '@/component-library/components/Select/Select';
import AcpAgentsConfig from './AcpAgentsConfig';
import {
  availableRemotePresetIds,
  canInstallPresetCli,
  getManualInstallGuide,
  visiblePresetIdsForRuntime,
} from './acpAgentPresetPolicy';

const loadJsonConfigMock = vi.hoisted(() => vi.fn());
const getClientsMock = vi.hoisted(() => vi.fn());
const probeClientRequirementsMock = vi.hoisted(() => vi.fn());
const saveJsonConfigMock = vi.hoisted(() => vi.fn());
const installClientCliMock = vi.hoisted(() => vi.fn());
const cancelClientInstallMock = vi.hoisted(() => vi.fn());
const predownloadClientAdapterMock = vi.hoisted(() => vi.fn());
const onManagedProvisioningProgressMock = vi.hoisted(() => vi.fn());
const listSavedConnectionsMock = vi.hoisted(() => vi.fn());
const notifyErrorMock = vi.hoisted(() => vi.fn());
const notifyInfoMock = vi.hoisted(() => vi.fn());
const notifySuccessMock = vi.hoisted(() => vi.fn());
const translate = (_key: string, options?: Record<string, unknown> & { defaultValue?: string }) => (
  options?.defaultValue ?? _key
);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock('@/component-library', () => ({
  Button: ({
    children,
    disabled,
    isLoading,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    isLoading?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled || isLoading} onClick={onClick}>
      {children}
    </button>
  ),
  IconButton: ({
    children,
    disabled,
    isLoading,
    onClick,
    tooltip: _tooltip,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    children: React.ReactNode;
    isLoading?: boolean;
    tooltip?: React.ReactNode;
  }) => (
    <button type="button" disabled={disabled || isLoading} onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Input: ({
    value,
    onChange,
    placeholder,
  }: {
    value?: string;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    placeholder?: string;
  }) => <input value={value} onChange={onChange} placeholder={placeholder} />,
  Select: ActualSelect,
  Textarea: React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    (props, ref) => <textarea ref={ref} {...props} />,
  ),
}));

vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: translate }) }));

vi.mock('./common', () => ({
  ConfigPageMessage: ({ message }: { message: { text: string } }) => <div>{message.text}</div>,
  ConfigPageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConfigPageHeader: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  ),
  ConfigPageLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  ConfigPageSectionStack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ConfigPageSection: ({
    children,
    title,
    description,
    extra,
  }: {
    children: React.ReactNode;
    title: string;
    description?: string;
    extra?: React.ReactNode;
  }) => (
    <section>
      <div>
        <h2>{title}</h2>
        {extra}
      </div>
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  ),
}));

vi.mock('../../api/service-api/ACPClientAPI', () => ({
  ACPClientAPI: {
    loadJsonConfig: loadJsonConfigMock,
    getClients: getClientsMock,
    probeClientRequirements: probeClientRequirementsMock,
    installClientCli: installClientCliMock,
    cancelClientInstall: cancelClientInstallMock,
    onManagedProvisioningProgress: onManagedProvisioningProgressMock,
    predownloadClientAdapter: predownloadClientAdapterMock,
    saveJsonConfig: saveJsonConfigMock,
  },
}));

vi.mock('../../api/service-api/SystemAPI', () => ({
  systemAPI: {
    openExternal: vi.fn(),
  },
}));

vi.mock('@/features/ssh-remote/sshApi', () => ({
  sshApi: {
    listSavedConnections: listSavedConnectionsMock,
  },
}));

vi.mock('@/shared/notification-system', () => ({
  useNotification: () => ({
    error: notifyErrorMock,
    info: notifyInfoMock,
    success: notifySuccessMock,
  }),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

async function openView(container: HTMLElement, _label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent === 'actions.editJson');
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}

async function selectPermission(container: HTMLElement, value: string): Promise<void> {
  const trigger = container.querySelector<HTMLElement>(
    '[data-bf-part="confirmation"] [role="combobox"]',
  );
  expect(trigger).not.toBeNull();
  await act(async () => trigger!.click());
  const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  expect(options.map(option => option.textContent)).toEqual(['permissionMode.ask', 'permissionMode.allowOnce']);
  const selected = options.find(option => option.textContent === (value === 'ask' ? 'permissionMode.ask' : 'permissionMode.allowOnce'));
  expect(selected).toBeTruthy();
  await act(async () => selected!.click());
}

describe('AcpAgentsConfig', () => {
  let container: HTMLDivElement;
  let root: Root;
  let emitManagedProvisioningProgress: ((progress: AcpManagedProvisioningProgress) => void) | undefined;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    emitManagedProvisioningProgress = undefined;
    localStorage.clear();
    loadJsonConfigMock.mockResolvedValue(JSON.stringify({
      acpClients: {
        opencode: {
          name: 'opencode',
          command: 'opencode',
          args: ['acp'],
          env: {},
          enabled: true,
          readonly: false,
          permissionMode: 'ask',
        },
      },
    }));
    getClientsMock.mockResolvedValue([{
      id: 'opencode',
      name: 'opencode',
      command: 'opencode',
      args: ['acp'],
      enabled: true,
      readonly: false,
      permissionMode: 'ask',
      status: 'configured',
      sessionCount: 0,
      toolName: 'acp__opencode__prompt',
    }]);
    listSavedConnectionsMock.mockResolvedValue([]);
    probeClientRequirementsMock.mockResolvedValue([]);
    saveJsonConfigMock.mockImplementation(async () => {
      window.dispatchEvent(new Event('bitfun:acp-clients-changed'));
    });
    installClientCliMock.mockResolvedValue({ clientId: 'opencode', status: 'cli_installed' });
    cancelClientInstallMock.mockResolvedValue({ clientId: 'opencode', status: 'cancellation_requested' });
    predownloadClientAdapterMock.mockResolvedValue(undefined);
    onManagedProvisioningProgressMock.mockImplementation((callback) => {
      emitManagedProvisioningProgress = callback;
      return () => undefined;
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root.unmount();
      });
    }
    container?.remove();
    vi.clearAllMocks();
  });

  it('limits local HarmonyOS managed setup to verified install recipes', () => {
    expect(canInstallPresetCli({
      isOhos: true,
      presetId: 'kimi-code',
      status: 'not_installed',
      issueKind: 'cli_missing',
      hasConfigEntry: false,
    })).toBe(true);
    expect(canInstallPresetCli({
      isOhos: true,
      presetId: 'qwen-code',
      status: 'not_installed',
      issueKind: 'cli_missing',
      hasConfigEntry: false,
    })).toBe(true);
    expect(canInstallPresetCli({
      isOhos: true,
      presetId: 'codebuddy-code',
      status: 'not_installed',
      issueKind: 'cli_missing',
      hasConfigEntry: false,
    })).toBe(true);
    expect(canInstallPresetCli({
      isOhos: true,
      presetId: 'dsh',
      status: 'not_installed',
      issueKind: 'cli_missing',
      hasConfigEntry: false,
    })).toBe(true);
    for (const presetId of ['claude-code', 'codex']) {
      expect(canInstallPresetCli({
        isOhos: true,
        presetId,
        status: 'not_installed',
        issueKind: 'cli_missing',
        hasConfigEntry: false,
      })).toBe(true);
      expect(canInstallPresetCli({
        isOhos: true,
        presetId,
        status: 'partial',
        issueKind: 'adapter_missing',
        hasConfigEntry: false,
      })).toBe(true);
    }
    expect(canInstallPresetCli({
      isOhos: true,
      presetId: 'kimi-code',
      status: 'ready',
      issueKind: 'none',
      hasConfigEntry: false,
    })).toBe(true);
    expect(canInstallPresetCli({
      isOhos: true,
      presetId: 'opencode',
      status: 'not_installed',
      issueKind: 'cli_missing',
      hasConfigEntry: false,
    })).toBe(false);
    expect(canInstallPresetCli({
      isOhos: true,
      presetId: 'opencode',
      status: 'ready',
      issueKind: 'none',
      hasConfigEntry: false,
    })).toBe(true);
  });

  it('shows only HarmonyOS-supported presets on HarmonyOS', () => {
    const ohosPresetIds = visiblePresetIdsForRuntime(true);
    expect(ohosPresetIds).toEqual([
      'opencode',
      'kimi-code',
      'qwen-code',
      'codebuddy-code',
      'dsh',
      'claude-code',
      'codex',
    ]);

    const desktopPresetIds = visiblePresetIdsForRuntime(false);
    expect(desktopPresetIds).toEqual([
      'opencode',
      'kimi-code',
      'qwen-code',
      'codebuddy-code',
      'dsh',
      'omp',
      'claude-code',
      'codex',
    ]);
  });

  it('keeps the full preset catalog available to remote hosts', () => {
    const remotePresetIds = availableRemotePresetIds();
    expect(remotePresetIds).toEqual([
      'opencode',
      'kimi-code',
      'qwen-code',
      'codebuddy-code',
      'dsh',
      'omp',
      'claude-code',
      'codex',
    ]);
  });

  it('offers the OpenCode installation guide only when its HarmonyOS CLI is missing', () => {
    expect(getManualInstallGuide({
      isOhos: true,
      presetId: 'opencode',
      status: 'not_installed',
    })).toEqual({
      repositoryUrl: 'https://atomgit.com/social4hyq/homebrew-core',
    });
    expect(getManualInstallGuide({
      isOhos: true,
      presetId: 'opencode',
      status: 'ready',
    })).toBeUndefined();
    expect(getManualInstallGuide({
      isOhos: false,
      presetId: 'opencode',
      status: 'not_installed',
    })).toBeUndefined();
  });

  it('keeps empty commands and local overrides when saving JSON', async () => {
    loadJsonConfigMock.mockResolvedValue(JSON.stringify({ acpClients: {
      codex: { command: '', args: ['acp'], localOverride: { command: '', args: ['entry.js'], env: {} } },
    } }));
    await act(async () => { root.render(<AcpAgentsConfig />); });
    await openView(container, 'views.json');
    const editor = container.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(JSON.parse(editor.value).acpClients.codex.command).toBe('');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(editor, `${editor.value}\n`);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const saveButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'actions.saveJson');
    await act(async () => { saveButton!.click(); });
    expect(JSON.parse(saveJsonConfigMock.mock.calls[0][0]).acpClients.codex).toMatchObject({
      command: '', args: ['acp'], localOverride: { command: '', args: ['entry.js'] },
    });
  });

  it.each([
    ['ask', 'ask'],
    ['allow_once', 'allow_once'],
  ])('loads and saves permission mode %s as %s with only supported choices', async (storedMode, expectedMode) => {
    loadJsonConfigMock.mockResolvedValue(JSON.stringify({
      acpClients: {
        opencode: { command: 'opencode', args: ['acp'], permissionMode: storedMode },
      },
    }));

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });

    expect(container.textContent).not.toContain('permissionMode.legacyRejectWarning');
    await selectPermission(container, expectedMode);
    expect(saveJsonConfigMock).not.toHaveBeenCalled();

    await openView(container, 'views.json');
    const editor = container.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        ?.call(editor, `${editor.value}\n`);
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const saveButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'actions.saveJson');
    expect(saveButton?.disabled).toBe(false);
    await act(async () => {
      saveButton!.click();
    });

    const savedConfig = JSON.parse(saveJsonConfigMock.mock.calls[0][0]);
    expect(savedConfig.acpClients.opencode).toMatchObject({
      command: 'opencode', args: ['acp'], permissionMode: expectedMode,
    });
  });

  it.each([
    ['local', true],
    ['json', true],
    ['local', false],
  ])('explicitly applies a legacy permission from %s (wrapped config: %s)', async (view, wrapped) => {
    const legacyClient = {
      command: 'opencode', args: ['acp'], env: { ACP_TEST: 'preserved' }, permissionMode: 'reject_once',
    };
    const otherClient = { command: 'custom-agent', args: [], permissionMode: 'allow_once' };
    const acpClients = { opencode: legacyClient, custom: otherClient };
    loadJsonConfigMock.mockResolvedValue(JSON.stringify(wrapped ? { acpClients } : acpClients));
    saveJsonConfigMock.mockImplementation(async (rawConfig: string) => {
      loadJsonConfigMock.mockResolvedValue(rawConfig);
      window.dispatchEvent(new Event('bitfun:acp-clients-changed'));
    });

    await act(async () => root.render(<AcpAgentsConfig />));
    expect(container.querySelector('[data-bf-part="confirmation"]')?.textContent)
      .toContain('permissionMode.ask');
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain('permissionMode.legacyRejectWarning');
    expect(saveJsonConfigMock).not.toHaveBeenCalled();

    await selectPermission(container, 'ask');
    if (view !== 'local') await openView(container, `views.${view}`);
    expect(saveJsonConfigMock).not.toHaveBeenCalled();

    const applyButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'permissionMode.saveAndApply');
    expect(applyButton?.disabled).toBe(false);
    await act(async () => applyButton!.click());

    expect(saveJsonConfigMock).toHaveBeenCalledTimes(1);
    const savedConfig = JSON.parse(saveJsonConfigMock.mock.calls[0][0]);
    expect(savedConfig.acpClients.opencode).toMatchObject({ ...legacyClient, permissionMode: 'ask' });
    expect(savedConfig.acpClients.custom).toMatchObject(otherClient);
    expect(container.textContent).not.toContain('permissionMode.legacyRejectWarning');
    expect(container.textContent).not.toContain('permissionMode.saveAndApply');

    await act(async () => {
      window.dispatchEvent(new Event('bitfun:acp-clients-changed'));
    });
    expect(container.textContent).not.toContain('permissionMode.legacyRejectWarning');
    expect(saveJsonConfigMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the migration action after a failed save and applies the current selection on retry', async () => {
    loadJsonConfigMock.mockResolvedValue(JSON.stringify({
      acpClients: { opencode: { command: 'opencode', permissionMode: 'reject_once' } },
    }));
    saveJsonConfigMock.mockRejectedValueOnce(new Error('Save failed'));
    await act(async () => root.render(<AcpAgentsConfig />));
    await selectPermission(container, 'allow_once');
    const applyButton = () => Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent === 'permissionMode.saveAndApply');

    await act(async () => applyButton()!.click());
    expect(notifyErrorMock).toHaveBeenCalledWith('Save failed', expect.anything());
    expect(container.textContent).toContain('permissionMode.legacyRejectWarning');
    expect(applyButton()?.disabled).toBe(false);

    await act(async () => applyButton()!.click());
    expect(saveJsonConfigMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(saveJsonConfigMock.mock.calls[1][0]).acpClients.opencode.permissionMode)
      .toBe('allow_once');
    expect(container.textContent).not.toContain('permissionMode.legacyRejectWarning');
  });

  it('probes requirements when opened and does not treat missing probe data as invalid config', async () => {
    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(loadJsonConfigMock).toHaveBeenCalledTimes(1);
    expect(getClientsMock).toHaveBeenCalledTimes(1);
    expect(probeClientRequirementsMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('registry.configInvalid');
  });

  it('does not offer add actions while local requirements are still being detected', async () => {
    loadJsonConfigMock.mockResolvedValue(JSON.stringify({ acpClients: {} }));
    getClientsMock.mockResolvedValue([]);
    probeClientRequirementsMock.mockReturnValue(new Promise(() => undefined));

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });

    expect(container.textContent).toContain('registry.checking');
    expect(container.textContent).not.toContain('actions.add');
    expect(container.textContent).not.toContain('actions.get');
  });

  it('does not retain an installing label after managed provisioning fails', async () => {
    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      emitManagedProvisioningProgress?.({
        clientId: 'opencode',
        stage: 'failed',
        percent: 100,
      });
    });

    expect(container.textContent).not.toContain('provisioning.installing');
  });

  it.each([true, false])('marks an unrunnable configured command as invalid (installed=%s)', async (installed) => {
    probeClientRequirementsMock.mockResolvedValue([
      {
        id: 'opencode',
        tool: {
          name: 'opencode',
          installed,
          path: '/usr/bin/opencode',
          error: 'Process exited with status 1',
        },
        runnable: false,
        notes: ['Process exited with status 1'],
      },
    ]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const opencodeRow = Array.from(
      container.querySelectorAll('.bitfun-acp-agents__registry-row'),
    ).find(row => row.querySelector('.bitfun-acp-agents__registry-name')
      ?.textContent === 'opencode');
    expect(opencodeRow).toBeTruthy();
    expect(opencodeRow!.querySelector('.bitfun-acp-agents__status.is-invalid')).not.toBeNull();
    expect(opencodeRow!.querySelector('.bitfun-acp-agents__capability.is-error')).not.toBeNull();
    expect(opencodeRow!.textContent).toContain(installed ? 'registry.configInvalid' : 'registry.cliMissing');
    expect(opencodeRow!.textContent).toContain('actions.viewError');
    expect(opencodeRow!.textContent).not.toContain('registry.enabled');
  });

  it('shows a configured agent with enabled false as disabled instead of invalid', async () => {
    loadJsonConfigMock.mockResolvedValue(JSON.stringify({
      acpClients: {
        opencode: {
          name: 'opencode',
          command: 'opencode',
          args: ['acp'],
          env: {},
          enabled: false,
          readonly: false,
          permissionMode: 'ask',
        },
      },
    }));
    probeClientRequirementsMock.mockResolvedValue([{
      id: 'opencode',
      tool: {
        name: 'opencode',
        installed: true,
        path: '/usr/bin/opencode',
      },
      runnable: true,
      notes: [],
    }]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const opencodeRow = Array.from(
      container.querySelectorAll('.bitfun-acp-agents__registry-row'),
    ).find(row => row.querySelector('.bitfun-acp-agents__registry-name')
      ?.textContent === 'opencode');
    expect(opencodeRow).toBeTruthy();
    expect(opencodeRow!.querySelector('.bitfun-acp-agents__status.is-disabled')).not.toBeNull();
    expect(opencodeRow!.querySelector('.bitfun-acp-agents__status.is-invalid')).toBeNull();
    expect(opencodeRow!.textContent).toContain('registry.disabled');
    expect(opencodeRow!.textContent).not.toContain('actions.viewError');
  });

  it('renders saved remote servers as global agent rows without override controls', async () => {
    listSavedConnectionsMock.mockResolvedValue([{
      id: 'huawei-server',
      name: 'huawei-server',
      host: '119.8.182.138',
      port: 22,
      username: 'ssh-root',
      authType: { type: 'Password' },
    }]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('huawei-server');
    expect(container.textContent).toContain('ssh-root@119.8.182.138');
    expect(container.textContent).toContain('remote.refreshDetection');
    expect(container.textContent).not.toContain('remote.env');
    expect(probeClientRequirementsMock).toHaveBeenCalledWith({
      remoteConnectionId: 'huawei-server',
      force: undefined,
    });
  });

  it('hides a saved remote server without deleting its SSH connection', async () => {
    listSavedConnectionsMock.mockResolvedValue([{
      id: 'huawei-server',
      name: 'Huawei Server',
      host: '119.8.182.138',
      port: 22,
      username: 'ssh-root',
      authType: { type: 'Password' },
    }]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const hideButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="remote.hideConnection"]'
    );
    expect(hideButton).not.toBeNull();

    await act(async () => {
      hideButton?.click();
      await Promise.resolve();
    });

    expect(listSavedConnectionsMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Huawei Server');
    expect(JSON.parse(localStorage.getItem('bitfun:settings:acp-agents:hidden-remote-connections:v1') || '[]'))
      .toEqual(['huawei-server']);
    expect(container.textContent).toContain('remote.showHiddenConnections');
  });

  it('restores a hidden remote server from the hidden list', async () => {
    localStorage.setItem(
      'bitfun:settings:acp-agents:hidden-remote-connections:v1',
      JSON.stringify(['huawei-server'])
    );
    listSavedConnectionsMock.mockResolvedValue([{
      id: 'huawei-server',
      name: 'Huawei Server',
      host: '119.8.182.138',
      port: 22,
      username: 'ssh-root',
      authType: { type: 'Password' },
    }]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const showHiddenButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('remote.showHiddenConnections'));
    expect(showHiddenButton).not.toBeUndefined();

    await act(async () => {
      showHiddenButton?.click();
      await Promise.resolve();
    });

    const restoreButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="remote.restoreConnection"]'
    );
    expect(restoreButton).not.toBeNull();

    await act(async () => {
      restoreButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(localStorage.getItem('bitfun:settings:acp-agents:hidden-remote-connections:v1'))
      .toBe('[]');
    expect(container.textContent).toContain('Huawei Server');
  });

  it('does not probe hidden remote servers until they are restored', async () => {
    localStorage.setItem(
      'bitfun:settings:acp-agents:hidden-remote-connections:v1',
      JSON.stringify(['huawei-server'])
    );
    listSavedConnectionsMock.mockResolvedValue([{
      id: 'huawei-server',
      name: 'Huawei Server',
      host: '119.8.182.138',
      port: 22,
      username: 'ssh-root',
      authType: { type: 'Password' },
    }]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(probeClientRequirementsMock).not.toHaveBeenCalledWith({
      remoteConnectionId: 'huawei-server',
      force: undefined,
    });
  });

  it('configures a preset adapter when the CLI is ready but the ACP layer is missing', async () => {
    probeClientRequirementsMock.mockResolvedValue([
      {
        id: 'opencode',
        tool: { name: 'opencode', installed: true },
        runnable: true,
        notes: [],
      },
      {
        id: 'claude-code',
        tool: { name: 'claude', installed: true },
        adapter: { name: '@agentclientprotocol/claude-agent-acp', installed: false },
        runnable: false,
        notes: [],
      },
      {
        id: 'codex',
        tool: { name: 'codex', installed: true },
        adapter: { name: '@agentclientprotocol/codex-acp', installed: false },
        runnable: false,
        notes: [],
      },
    ]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const refreshButtons = Array.from(container.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('actions.refresh'));
    expect(refreshButtons.length).toBeGreaterThan(0);

    await act(async () => {
      refreshButtons[0].click();
      await Promise.resolve();
      await Promise.resolve();
    });

    const configureButtons = Array.from(container.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('actions.configureAcp'));
    expect(configureButtons.length).toBeGreaterThan(0);

    await act(async () => {
      configureButtons[configureButtons.length - 1].click();
      await Promise.resolve();
    });

    expect(predownloadClientAdapterMock).toHaveBeenCalledWith({
      clientId: 'codex',
    });
  });

  it('keeps enabled agents stable when adding another preset', async () => {
    const healthyProbes = [
      {
        id: 'opencode',
        tool: { name: 'opencode', installed: true },
        runnable: true,
        notes: [],
      },
      {
        id: 'claude-code',
        tool: { name: 'claude', installed: true },
        adapter: { name: '@agentclientprotocol/claude-agent-acp', installed: true },
        runnable: true,
        notes: [],
      },
      {
        id: 'codex',
        tool: { name: 'codex', installed: true },
        runnable: true,
        notes: [],
      },
    ];
    probeClientRequirementsMock.mockResolvedValue(healthyProbes);
    saveJsonConfigMock.mockImplementation(async () => {
      window.dispatchEvent(new Event('bitfun:acp-clients-changed'));
      loadJsonConfigMock.mockResolvedValue(JSON.stringify({
        acpClients: {
          opencode: {
            name: 'opencode',
            command: 'opencode',
            args: ['acp'],
            env: {},
            enabled: true,
            readonly: false,
            permissionMode: 'ask',
          },
          'claude-code': {
            name: 'Claude Code',
            command: 'npx',
            args: ['--yes', '@agentclientprotocol/claude-agent-acp@latest'],
            env: {},
            enabled: true,
            readonly: false,
            permissionMode: 'ask',
          },
          codex: {
            name: 'Codex',
            command: 'npx',
            args: ['--yes', '@agentclientprotocol/codex-acp@latest'],
            env: {},
            enabled: true,
            readonly: false,
            permissionMode: 'ask',
          },
        },
      }));
    });

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('registry.enabled');

    const addButtons = Array.from(container.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('actions.add'));
    expect(addButtons.length).toBeGreaterThan(0);

    await act(async () => {
      addButtons[addButtons.length - 1].click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(saveJsonConfigMock).toHaveBeenCalled();
    expect(container.textContent).toContain('registry.enabled');
    expect(container.textContent).not.toContain('registry.cliMissing');
    expect(container.textContent).not.toContain('registry.configInvalid');
  });

  it('labels self-managed missing CLIs as config-only before adding', async () => {
    probeClientRequirementsMock.mockResolvedValue([
      {
        id: 'opencode',
        tool: { name: 'opencode', installed: true },
        runnable: true,
        notes: [],
      },
      {
        id: 'omp',
        tool: { name: 'omp', installed: false },
        runnable: false,
        notes: ['omp is not available on PATH'],
      },
    ]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const addConfigButtons = Array.from(container.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('actions.addConfig'));
    expect(addConfigButtons.length).toBeGreaterThan(0);

    await act(async () => {
      addConfigButtons[0].click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(installClientCliMock).not.toHaveBeenCalled();
    expect(saveJsonConfigMock).toHaveBeenCalledWith(expect.stringContaining('"omp"'));
    expect(notifySuccessMock).toHaveBeenCalledWith('notifications.configAddedManualCliRequired');
  });

  it('offers the one-click installer for DeepSeek Harness and launches the bundled profile', async () => {
    probeClientRequirementsMock.mockResolvedValue([
      {
        id: 'dsh',
        tool: { name: 'dsh', installed: false },
        runnable: false,
        notes: ['dsh is not available on PATH'],
      },
    ]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('DeepSeek Harness');
    // Unlike omp, the harness is a plain npm global, so BitFun installs it.
    // The bridge is not a separate adapter — it ships inside BitFun.
    expect(container.textContent).not.toContain('registry.adapterMissing');

    const installButtons = Array.from(container.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('actions.installCli'));
    expect(installButtons.length).toBeGreaterThan(0);

    await act(async () => {
      installButtons[0].click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(installClientCliMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'dsh' }),
    );
  });

  it('adds DeepSeek Harness as a launch of the profile BitFun materializes', async () => {
    probeClientRequirementsMock.mockResolvedValue([
      {
        id: 'dsh',
        tool: { name: 'dsh', installed: true, version: '0.1.0-rc.6' },
        runnable: true,
        notes: [],
      },
    ]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Address the harness row by name: row order is whatever the saved config
    // and the preset list happen to produce, so "the last add button" belongs
    // to some other agent as often as not.
    const harnessRow = Array.from(
      container.querySelectorAll('.bitfun-acp-agents__registry-row'),
    ).find(row => row.querySelector('.bitfun-acp-agents__registry-name')
      ?.textContent === 'DeepSeek Harness');
    expect(harnessRow).toBeTruthy();

    const addButton = Array.from(harnessRow!.querySelectorAll('button'))
      .find(button => button.textContent?.includes('actions.add'));
    expect(addButton).toBeTruthy();

    await act(async () => {
      addButton!.click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The command has to name the profile BitFun materializes; a bare `dsh`
    // would drop the user into the harness's own default composition, which
    // does not speak ACP at all.
    expect(saveJsonConfigMock).toHaveBeenCalledWith(expect.stringContaining('bitfun-acp'));
  });

  it('does not downgrade enabled agents on transient probe timeouts during refresh', async () => {
    probeClientRequirementsMock
      .mockResolvedValueOnce([
        {
          id: 'opencode',
          tool: { name: 'opencode', installed: true },
          runnable: true,
          notes: [],
        },
        {
          id: 'claude-code',
          tool: { name: 'claude', installed: true },
          adapter: { name: '@agentclientprotocol/claude-agent-acp', installed: true },
          runnable: true,
          notes: [],
        },
        {
          id: 'codex',
          tool: { name: 'codex', installed: true },
          runnable: true,
          notes: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'opencode',
          tool: {
            name: 'opencode',
            installed: false,
            error: 'Timed out while checking command',
          },
          runnable: false,
          notes: [],
        },
        {
          id: 'claude-code',
          tool: { name: 'claude', installed: true },
          adapter: { name: '@agentclientprotocol/claude-agent-acp', installed: true },
          runnable: true,
          notes: [],
        },
        {
          id: 'codex',
          tool: { name: 'codex', installed: true },
          runnable: true,
          notes: [],
        },
      ]);

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const refreshButtons = Array.from(container.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('actions.refresh'));
    expect(refreshButtons.length).toBeGreaterThan(0);

    await act(async () => {
      refreshButtons[0].click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('registry.enabled');
    expect(container.textContent).not.toContain('registry.cliMissing');
  });

  it('installs a missing remote preset CLI on that remote server', async () => {
    listSavedConnectionsMock.mockResolvedValue([{
      id: 'huawei-server',
      name: 'huawei-server',
      host: '119.8.182.138',
      port: 22,
      username: 'ssh-root',
      authType: { type: 'Password' },
    }]);
    probeClientRequirementsMock.mockImplementation((options?: { remoteConnectionId?: string }) => {
      if (options?.remoteConnectionId === 'huawei-server') {
        return Promise.resolve([
          {
            id: 'opencode',
            tool: { name: 'opencode', installed: true },
            runnable: true,
            notes: [],
          },
          {
            id: 'claude-code',
            tool: { name: 'claude', installed: true },
            runnable: true,
            notes: [],
          },
          {
            id: 'codex',
            tool: { name: 'codex', installed: false },
            runnable: false,
            notes: [],
          },
        ]);
      }
      return Promise.resolve([]);
    });

    await act(async () => {
      root.render(<AcpAgentsConfig />);
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const installButtons = Array.from(container.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('actions.installCli'));
    expect(installButtons.length).toBeGreaterThan(0);

    await act(async () => {
      installButtons[installButtons.length - 1].click();
      await Promise.resolve();
    });

    expect(installClientCliMock).toHaveBeenCalledWith({
      clientId: 'codex',
      remoteConnectionId: 'huawei-server',
    });
  });
});
