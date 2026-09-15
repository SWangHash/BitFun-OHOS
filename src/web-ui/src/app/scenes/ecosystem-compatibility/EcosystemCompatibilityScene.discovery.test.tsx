// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExternalSourceCatalogSnapshot, ExternalMcpImportPlanV1 } from '@/infrastructure/api/service-api/ExternalSourcesAPI';
import { catalogDiscoveryState } from './ecosystemCompatibilityModel';

const mocks = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  planMcpImport: vi.fn<() => Promise<ExternalMcpImportPlanV1>>(),
  applyMcpImport: vi.fn(),
  ownerSurface: null as string | null,
  selectedProductId: 'codex',
  setOwnerSurface: vi.fn(),
  workspacePath: '/workspace',
  peerDeviceId: '',
  skills: [] as Array<Record<string, unknown>>,
  t: (key: string, values?: Record<string, unknown>) => key === 'header.checksSummary' ? `assets:${values?.assetCount}` : key,
}));
vi.mock('@/infrastructure/api/service-api/ExternalSourcesAPI', () => ({ externalSourcesAPI: mocks }));
vi.mock('@/infrastructure/api/service-api/ACPClientAPI', () => ({ ACPClientAPI: { getClients: async () => [] } }));
vi.mock('@/infrastructure/contexts/WorkspaceContext', () => ({ useCurrentWorkspace: () => ({ workspacePath: mocks.workspacePath, workspace: { workspaceKind: 'normal', sshHost: 'localhost' } }) }));
vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: mocks.t, formatNumber: String }) }));
vi.mock('@/infrastructure/peer-device/peerDeviceContextState', () => ({ usePeerDeviceModeOptional: () => mocks.peerDeviceId ? ({ peerMode: { active: true, deviceId: mocks.peerDeviceId } }) : null }));
vi.mock('@/shared/notification-system', () => ({ useNotification: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('./ecosystemCompatibilityStore', () => ({
  useEcosystemCompatibilityStore: (select: (value: unknown) => unknown) => select({
    selectedProductId: mocks.selectedProductId, ownerSurface: mocks.ownerSurface, setOwnerSurface: mocks.setOwnerSurface,
  }),
}));
vi.mock('@openbitfun/ui', async () => {
  const { createElement } = await import('react');
  const Wrapper = ({ children }: { children?: React.ReactNode }) => createElement('div', null, children);
  return {
    ...Object.fromEntries(['LoadingState', 'NavigationPanel', 'NavigationPanelBody', 'NavigationPanelContent',
      'NavigationPanelFooter', 'NavigationPanelHeader', 'NavigationPanelItem', 'NavigationPanelSection',
      'OverflowText', 'ScrollArea', 'SearchField', 'Select', 'StatusPill', 'Switch', 'Textarea', 'DialogBody', 'DialogFooter', 'DialogHeader', 'DialogHeading', 'DialogTitle'].map((name) => [name, Wrapper])),
    IconButton: ({ icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode }) => createElement('button', props, icon),
    Checkbox: ({ size: _size, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => createElement('input', { type: 'checkbox', ...props }),
    Icon: () => null, DialogClose: () => null,
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => open ? createElement('div', null, children) : null,
    Button: ({ children, onClick, disabled, 'aria-label': label }: React.ButtonHTMLAttributes<HTMLButtonElement>) => createElement('button', { onClick, disabled, 'aria-label': label }, children),
  };
});

vi.mock('@/infrastructure/runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('@/infrastructure/api/service-api/ConfigAPI', () => ({ configAPI: { getSkillScanReport: async () => ({ skills: mocks.skills, diagnostics: [] }) } }));
vi.mock('@/infrastructure/api/service-api/ExternalHooksAPI', () => ({ externalHooksAPI: {
  getCatalog: async () => ({ sources: [], entries: [], providers: [], failedProviderIds: [], discoveryPending: false }),
  getImportSnapshot: async () => ({ catalog: { sources: [], entries: [], providers: [], failedProviderIds: [], discoveryPending: false }, imports: [] }),
} }));

import EcosystemCompatibilityScene from './EcosystemCompatibilityScene';

function snapshot(enabled: boolean, pending = false, discovered = false): ExternalSourceCatalogSnapshot {
  const source = { providerId: 'codex.mcp', sourceId: 'user' };
  return {
    generation: discovered ? 2 : 1, discoveryPending: pending,
    hostCapabilities: { canMutatePolicy: true, canManageSources: true, canApproveRuntime: true },
    integrationPolicy: {
      status: 'compatible', registeredEcosystems: [],
      effective: { enabled, ecosystems: { codex: { capabilities: { mcp: 'ask_before_use', subagent: 'ask_before_use' } } } },
    },
    commands: [],
    sources: discovered ? [{ stableKey: 'codex:user', record: {
      key: source, ecosystemId: 'codex', displayName: 'Codex', location: '<user>/config.toml',
      health: 'available', diagnostics: [],
    } }] : [],
    mcpServers: discovered ? [{ candidateId: 'codex:mcp:docs', definition: { id: { source }, name: 'Docs MCP' } }] : [],
  } as unknown as ExternalSourceCatalogSnapshot;
}

describe('compatibility discovery lifecycle', () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.getSnapshot.mockReset();
    mocks.ownerSurface = null;
    mocks.selectedProductId = 'codex';
    mocks.setOwnerSurface.mockImplementation((owner) => { mocks.ownerSurface = owner; });
    mocks.setOwnerSurface.mockClear();
    mocks.planMcpImport.mockResolvedValue({ schemaVersion: 1, planFingerprint: 'plan', items: [] });
    mocks.applyMcpImport.mockReset();
    mocks.workspacePath = '/workspace';
    mocks.peerDeviceId = '';
    mocks.skills = [];
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function renderMcp() {
    await act(async () => root.render(<EcosystemCompatibilityScene />));
    const trigger = container.querySelector<HTMLButtonElement>('[data-content-group="mcp"] button[aria-expanded]');
    if (trigger?.getAttribute('aria-expanded') === 'false') await act(async () => trigger.click());
  }

  it('shows disabled discovery and its settings action instead of claiming no MCP exists', async () => {
    mocks.getSnapshot.mockResolvedValue(snapshot(false));
    await renderMcp();
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('discoveryDisabled');
    const action = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'discovery.manageAction');
    expect(action).toBeDefined();
    await act(async () => action!.click());
    expect(mocks.setOwnerSurface).toHaveBeenCalledWith('external-sources');
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(mocks.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('collects the completed MCP scan without requiring a manual refresh', async () => {
    mocks.getSnapshot.mockResolvedValueOnce(snapshot(true, true)).mockResolvedValue(snapshot(true, false, true));
    await renderMcp();
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('checking');
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-discovered')).toBe('true');
    expect(container.textContent).toContain('Docs MCP');
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    expect(mocks.getSnapshot).toHaveBeenCalledTimes(2);
    expect(mocks.getSnapshot).toHaveBeenLastCalledWith('/workspace', false);
  });

  it('ignores a late scan from the previous workspace', async () => {
    let resolveOld: (value: ExternalSourceCatalogSnapshot) => void = () => {};
    mocks.getSnapshot.mockResolvedValueOnce(snapshot(true, true)).mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    await renderMcp();
    await act(async () => vi.advanceTimersByTimeAsync(300));
    mocks.workspacePath = '/other-workspace';
    mocks.getSnapshot.mockResolvedValue(snapshot(false));
    await renderMcp();
    await act(async () => resolveOld(snapshot(true, false, true)));
    expect(container.textContent).not.toContain('Docs MCP');
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('discoveryDisabled');
  });

  it('drops local catalog content immediately when switching to a peer on the same path', async () => {
    mocks.getSnapshot.mockResolvedValueOnce(snapshot(true, false, true));
    await renderMcp();
    expect(container.textContent).toContain('Docs MCP');
    let resolvePeer: (value: ExternalSourceCatalogSnapshot) => void = () => {};
    mocks.getSnapshot.mockImplementationOnce(() => new Promise((resolve) => { resolvePeer = resolve; }));
    mocks.peerDeviceId = 'peer-host';
    await renderMcp();
    expect(container.textContent).not.toContain('Docs MCP');
    await act(async () => resolvePeer(snapshot(true)));
    expect(container.textContent).not.toContain('Docs MCP');
    expect(mocks.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it('distinguishes capability policy, failed reads and a completed empty scan', () => {
    const value = snapshot(true);
    expect(catalogDiscoveryState(value, 'codex', 'mcp')).toBe('notDetected');
    value.integrationPolicy.effective.ecosystems.codex.capabilities.mcp = 'disabled';
    expect(catalogDiscoveryState(value, 'codex', 'mcp')).toBe('discoveryDisabled');
    value.integrationPolicy.status = 'incompatible_schema';
    expect(catalogDiscoveryState(value, 'codex', 'mcp')).toBe('discoveryUnavailable');
  });

  it('keeps content-only ecosystems usable without promising an unavailable ACP runtime', async () => {
    mocks.selectedProductId = 'pi';
    mocks.getSnapshot.mockResolvedValue(snapshot(true));
    await renderMcp();
    expect(container.querySelector('[data-external-agent-content="pi"]')).not.toBeNull();
    expect(container.textContent).not.toContain('run.description');
    expect(container.textContent).not.toContain('run.openManager');
    expect(container.textContent).not.toContain('header.notAvailable');
  });

  it('counts external Skills once, preserves their summary in settings, and drops it on host changes', async () => {
    mocks.skills = [
      { key: 'project::codex::sample', name: 'sample', sourceId: 'codex', sourceSlot: 'codex', path: '/workspace/.codex/skills/sample' },
      { key: 'project::openbitfun::sample', name: 'sample', sourceId: 'openbitfun', sourceSlot: 'openbitfun', path: '/workspace/.openbitfun/skills/sample', importOrigin: { sourceId: 'codex' } },
    ];
    mocks.getSnapshot.mockResolvedValue(snapshot(true, false, true));
    await renderMcp();
    expect(container.textContent).toContain('assets:2');
    expect(container.textContent).toContain('host.local');
    expect(container.textContent).not.toContain('host.remote');
    mocks.ownerSurface = 'external-sources';
    await act(async () => root.render(<EcosystemCompatibilityScene />));
    expect(container.textContent).toContain('assets:2');
    mocks.peerDeviceId = 'different-host';
    mocks.getSnapshot.mockResolvedValue(snapshot(true));
    await act(async () => root.render(<EcosystemCompatibilityScene />));
    expect(container.textContent).toContain('assets:0');
  });
});
