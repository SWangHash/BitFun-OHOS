// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentProfileConfigItem, ModeSkillInfo } from '@/infrastructure/config/types';
import { notificationService } from '@/shared/notification-system';
import AssistantDefaultsPage from './AssistantDefaultsPage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getAgentProfileConfig: vi.fn(),
  getModeSkillConfigs: vi.fn(),
  resetAgentProfileConfig: vi.fn(),
  resetModeSkillSelection: vi.fn(),
}));

vi.mock('@/infrastructure/api/service-api/ConfigAPI', () => ({
  configAPI: {
    getAgentProfileConfig: mocks.getAgentProfileConfig,
    getModeSkillConfigs: mocks.getModeSkillConfigs,
    resetAgentProfileConfig: mocks.resetAgentProfileConfig,
    resetModeSkillSelection: mocks.resetModeSkillSelection,
    setAgentProfileConfig: vi.fn(),
    setModeSkillDisabled: vi.fn(),
  },
}));
vi.mock('@/infrastructure/api/service-api/MCPAPI', () => ({
  MCPAPI: { getServers: () => Promise.resolve([]) },
}));
vi.mock('@/infrastructure/api/service-api/ToolAPI', () => ({
  toolAPI: { getAllToolsInfo: () => Promise.resolve([]) },
}));
vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/notification-system', () => ({
  notificationService: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../nurseryStore', () => ({ useNurseryStore: () => ({ openGallery: vi.fn() }) }));
vi.mock('@/infrastructure/peer-device/peerDeviceContextState', () => ({
  usePeerDeviceModeOptional: () => undefined,
}));
vi.mock('@/infrastructure/event-bus', () => ({ globalEventBus: { emit: vi.fn() } }));
vi.mock('@bitfun/ui', () => {
  const Wrapper = ({ children }: React.PropsWithChildren) => <div>{children}</div>;
  return {
    Alert: Wrapper,
    Button: ({ children, leadingIcon: _leadingIcon, loading: _loading, ...props }:
      React.ButtonHTMLAttributes<HTMLButtonElement> & { leadingIcon?: React.ReactNode; loading?: boolean }) => (
      <button type="button" {...props}>{children}</button>
    ),
    Dialog: Wrapper,
    DialogBody: Wrapper,
    DialogClose: () => null,
    DialogDescription: Wrapper,
    DialogHeader: Wrapper,
    DialogHeaderActions: Wrapper,
    DialogHeading: Wrapper,
    DialogTitle: Wrapper,
    Empty: Wrapper,
    Field: Wrapper,
    FieldGroup: Wrapper,
    FieldRow: Wrapper,
    FormSection: Wrapper,
    Icon: () => null,
    IconButton: ({ icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
      <button type="button" {...props}>{icon}</button>
    ),
    NumberBadge: Wrapper,
    OverflowText: Wrapper,
    PageHeader: Wrapper,
    ScrollArea: Wrapper,
    SearchField: ({ onValueChange: _onValueChange, onClear: _onClear, clearLabel: _clearLabel, leadingIcon: _leadingIcon, value, ...props }:
      React.InputHTMLAttributes<HTMLInputElement> & {
        onValueChange?: unknown;
        onClear?: unknown;
        clearLabel?: unknown;
        leadingIcon?: React.ReactNode;
      }) => <input value={value} readOnly {...props} />,
    SegmentedControl: () => null,
    Spinner: () => null,
    StatusPill: Wrapper,
    Switch: ({ checked, disabled, onChange }: {
      checked?: boolean;
      disabled?: boolean;
      onChange?: () => void;
    }) => (
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} />
    ),
    Tooltip: Wrapper,
  };
});

const assistantProfile: AgentProfileConfigItem = {
  profile_id: 'Claw',
  enabled_tools: ['read_file'],
  default_tools: ['read_file'],
};

function buildSkill(effectiveEnabled: boolean): ModeSkillInfo {
  return {
    key: 'user::home.agents::review',
    name: 'review',
    description: 'Reviews pending changes',
    path: '/skills/review',
    level: 'user',
    sourceSlot: 'home.agents',
    dirName: 'review',
    isBuiltin: false,
    defaultEnabled: true,
    globallyEnabled: true,
    effectiveEnabled,
    disabledByMode: !effectiveEnabled,
    selectedForRuntime: effectiveEnabled,
    stateReason: effectiveEnabled ? 'custom_user_default_enabled' : 'disabled_by_user_override',
  } as ModeSkillInfo;
}

describe('Assistant defaults reset', () => {
  let container: HTMLDivElement;
  let root: Root;
  let skillEnabled: boolean;

  // Waiting on the handler's promise chain rather than a timer keeps the
  // assertion deterministic: act() flushes React work, not the awaited calls.
  async function drainPendingWork() {
    for (let turn = 0; turn < 10; turn += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  }

  async function renderPage() {
    await act(async () => { root.render(<AssistantDefaultsPage />); });
    await drainPendingWork();
  }

  function resetButton(): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>('[data-testid="assistant-defaults-reset-btn"]');
    expect(button).not.toBeNull();
    return button!;
  }

  function skillSwitches(): HTMLInputElement[] {
    return [...container.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
  }

  beforeEach(() => {
    skillEnabled = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(notificationService.error).mockClear();
    mocks.getAgentProfileConfig.mockReset().mockResolvedValue({ ...assistantProfile });
    mocks.getModeSkillConfigs.mockReset().mockImplementation(() => Promise.resolve([buildSkill(skillEnabled)]));
    mocks.resetAgentProfileConfig.mockReset().mockImplementation(() => {
      skillEnabled = true;
      return Promise.resolve('ok');
    });
    mocks.resetModeSkillSelection.mockReset().mockImplementation(() => {
      skillEnabled = true;
      return Promise.resolve('ok');
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('restores Skill defaults together with tool defaults', async () => {
    await renderPage();
    expect(skillSwitches()).toHaveLength(1);
    expect(skillSwitches()[0].checked).toBe(false);

    await act(async () => { resetButton().click(); });
    await drainPendingWork();

    expect(mocks.resetAgentProfileConfig).toHaveBeenCalledWith('Claw');
    expect(mocks.resetModeSkillSelection).toHaveBeenCalledWith({ modeId: 'Claw' });
    expect(skillSwitches()[0].checked).toBe(true);
  });

  it('leaves Skill overrides in place when the tool reset fails', async () => {
    mocks.resetAgentProfileConfig.mockReset().mockRejectedValue(new Error('reset failed'));

    await renderPage();
    await act(async () => { resetButton().click(); });
    await drainPendingWork();

    expect(mocks.resetModeSkillSelection).not.toHaveBeenCalled();
    expect(skillSwitches()[0].checked).toBe(false);
    expect(notificationService.error).toHaveBeenCalled();
  });
});
