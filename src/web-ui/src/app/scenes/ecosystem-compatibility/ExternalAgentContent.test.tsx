// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globalEventBus } from '@/infrastructure/event-bus';
import { MCP_CONFIG_CHANGED } from '@/infrastructure/mcp/configEvents';
import type { ExternalSourceCatalogSnapshot } from '@/infrastructure/api/service-api/ExternalSourcesAPI';
import { buildEcosystemProductRuntimes, type EcosystemProductId } from './ecosystemCompatibilityModel';

const mocks = vi.hoisted(() => ({
  getInstructions: vi.fn(), openScene: vi.fn(), openDestination: vi.fn(), openNativeSkills: vi.fn(),
  deleteSkill: vi.fn(), loadMcp: vi.fn(), saveMcp: vi.fn(), mutateHook: vi.fn(), getSkills: vi.fn(), validateSkill: vi.fn(), addSkill: vi.fn(), getHooks: vi.fn(), getHookCatalog: vi.fn(),
  planHook: vi.fn(), applyHook: vi.fn(), planMcp: vi.fn(), applyMcp: vi.fn(), refresh: vi.fn(),
  workspacePath: '/project', remote: false, peer: false, skillImportVersion: 0,
}));
vi.mock('@/app/stores/sceneStore', () => ({ useSceneStore: { getState: () => ({ openScene: mocks.openScene }) } }));
vi.mock('@/app/scenes/settings/settingsStore', () => ({ useSettingsStore: { getState: () => ({ openDestination: mocks.openDestination }) } }));
vi.mock('@/app/scenes/skills/skillsSceneStore', () => ({ useSkillsSceneStore: { getState: () => ({ openNativeSkills: mocks.openNativeSkills }) } }));
vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, formatNumber: String }) }));
vi.mock('@/infrastructure/contexts/WorkspaceContext', () => ({ useCurrentWorkspace: () => ({
  workspacePath: mocks.workspacePath, workspace: { workspaceKind: mocks.remote ? 'remote' : 'normal' },
}) }));
vi.mock('@/infrastructure/peer-device/peerDeviceContextState', () => ({ usePeerDeviceModeOptional: () => ({ peerMode: { active: mocks.peer } }) }));
vi.mock('@/infrastructure/runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('@/infrastructure/api/service-api/ConfigAPI', () => ({ configAPI: {
  getSkillScanReport: async (...args: unknown[]) => ({ skills: await mocks.getSkills(...args), diagnostics: [], importOperationsVersion: mocks.skillImportVersion }), validateSkillPath: mocks.validateSkill, addSkill: mocks.addSkill, deleteSkill: mocks.deleteSkill,
} }));
vi.mock('@/infrastructure/api/service-api/ExternalHooksAPI', () => ({ externalHooksAPI: {
  getImportSnapshot: mocks.getHooks, getCatalog: mocks.getHookCatalog, planImport: mocks.planHook, applyImport: mocks.applyHook, mutateImport: mocks.mutateHook,
} }));
vi.mock('@/infrastructure/api/service-api/ExternalSourcesAPI', () => ({ externalSourcesAPI: {
  planMcpImport: mocks.planMcp, applyMcpImport: mocks.applyMcp,
} }));
vi.mock('@/infrastructure/api/service-api/InstructionSourcesAPI', () => ({ instructionSourcesAPI: { getCatalog: mocks.getInstructions } }));
vi.mock('@/infrastructure/api/service-api/MCPAPI', () => ({ MCPAPI: { loadMCPJsonConfig: mocks.loadMcp, saveMCPJsonConfig: mocks.saveMcp } }));
vi.mock('@openbitfun/ui', () => {
  const Wrapper = ({ children }: React.PropsWithChildren) => <div>{children}</div>;
  return {
    Input: ({ size: _size, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
    Checkbox: ({ size: _size, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => <input type="checkbox" {...props} />,
    Button: ({ children, disabled, onClick, 'aria-label': label }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button disabled={disabled} onClick={onClick} aria-label={label}>{children}</button>,
    Select: ({ value, options, onValueChange, disabled }: { value: string; options: Array<{ value: string; label: string }>; onValueChange: (value: string) => void; disabled?: boolean }) => <select value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
    SearchField: ({ value, onChange }: React.InputHTMLAttributes<HTMLInputElement>) => <input value={value} onChange={onChange} />,
    Dialog: ({ open, children, onOpenChange }: React.PropsWithChildren<{ open: boolean; onOpenChange: (open: boolean) => void }>) => open ? <div role="dialog"><button onClick={() => onOpenChange(false)}>close</button>{children}</div> : null,
    DialogClose: () => null, DialogFooter: Wrapper, DialogHeader: Wrapper, DialogHeading: Wrapper, DialogTitle: Wrapper, DialogBody: Wrapper,
    Icon: () => <span data-icon="true" />,
    IconButton: ({ icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode }) => <button {...props}>{icon}</button>,
    ScrollArea: Wrapper, LoadingState: Wrapper, OverflowText: Wrapper, StatusPill: Wrapper,
  };
});
import ExternalAgentContent from './ExternalAgentContent';

function fixture() {
  const sources = ['codex', 'claude-code'].map((ecosystemId) => ({
    stableKey: ecosystemId, record: { ecosystemId, key: { providerId: `${ecosystemId}.mcp`, sourceId: 'user' },
      displayName: ecosystemId, location: `/${ecosystemId}`, scope: 'user_global', health: 'available', diagnostics: [] },
  }));
  const snapshot = { generation: 1, discoveryPending: false, sources, commands: [],
    hostCapabilities: { canMutatePolicy: true, canManageSources: true, canApproveRuntime: true },
    integrationPolicy: { status: 'compatible', effective: { enabled: true, ecosystems: Object.fromEntries(['codex', 'claude-code'].map(id => [id, { capabilities: { mcp: 'discover_only', subagent: 'auto', command: 'auto' } }])) }, registeredEcosystems: [] },
    mcpServers: sources.map((source) => ({ candidateId: source.stableKey, definition: {
      id: { source: source.record.key, localId: 'docs' }, name: `${source.stableKey}-MCP`, transport: 'local_stdio',
      staticStatus: { state: 'ready' }, environmentKeys: [], headerNames: [], commandPreview: 'docs-server',
    } })),
  } as unknown as ExternalSourceCatalogSnapshot;
  const skills = ['codex', 'claude-code', 'openbitfun'].map((sourceId) => ({
    key: sourceId, sourceId, sourceSlot: sourceId, sourceLabel: sourceId, name: `${sourceId}-Skill`,
    path: `/${sourceId}/skills/demo`, dirName: sourceId === 'openbitfun' ? 'native' : 'demo',
    level: 'user', isBuiltin: false, description: 'Skill description',
  }));
  const hookSources = ['codex', 'claude-code'].map((ecosystemId) => ({ ecosystemId,
    key: { providerId: `${ecosystemId}.hooks`, sourceId: 'user' }, displayName: `${ecosystemId}-Hooks`,
    scope: 'user_global', locationHint: `/${ecosystemId}/settings.json`, health: 'available',
  }));
  const hooks = { schemaVersion: 1, revision: 'r1', imports: [], diagnostics: [], catalog: {
    discoveryPending: false, sources: hookSources, providers: [], diagnostics: [], failedProviderIds: [],
    entries: hookSources.map((source) => ({ source: source.key, stableKey: source.ecosystemId, nativeEvent: 'Stop', handlerKind: 'command', matcher: { kind: 'any' } })),
  } };
  const plan = { schemaVersion: 1, planFingerprint: 'v1', items: sources.map((source) => ({
    candidateId: source.stableKey, disposition: 'eligible', displayName: source.stableKey, proposedNativeId: 'docs', transport: 'local_stdio',
  })) };
  const hookPlan = { schemaVersion: 1, source: hookSources[0], disposition: 'import', behaviorVersion: 'v1', planFingerprint: 'h1', skipped: [],
    handlers: [{ stableKey: 'stop-hook', event: 'Stop', command: 'echo reviewed-command', dependencies: [] }],
  };
  return { snapshot, skills, hooks, plan, hookPlan };
}

describe('external agent content and explicit import boundary', () => {
  let root: Root;
  let container: HTMLDivElement;
  let data: ReturnType<typeof fixture>;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.resetAllMocks();
    localStorage.clear();
    mocks.remote = false; mocks.peer = false; mocks.workspacePath = '/project'; mocks.skillImportVersion = 0;
    data = fixture();
    mocks.getInstructions.mockResolvedValue({ schemaVersion: 1, entries: [], failedEcosystems: [] });
    mocks.getSkills.mockImplementation(async () => [...data.skills]);
    mocks.getHooks.mockResolvedValue(data.hooks);
    mocks.getHookCatalog.mockResolvedValue(data.hooks.catalog);
    mocks.planMcp.mockResolvedValue(data.plan);
    mocks.planHook.mockResolvedValue(data.hookPlan);
    mocks.validateSkill.mockResolvedValue({ valid: true });
    mocks.addSkill.mockImplementation(async () => {
      data.skills.push({ ...data.skills[0], key: 'imported-copy', sourceId: 'openbitfun', sourceSlot: 'openbitfun', path: '/native/skills/demo' });
      return 'ok';
    });
    mocks.deleteSkill.mockImplementation(async () => { data.skills = data.skills.filter((skill) => skill.key !== 'imported-copy'); mocks.getSkills.mockImplementation(async () => [...data.skills]); return 'ok'; });
    mocks.saveMcp.mockResolvedValue({ runtimeApplied: true });
    mocks.loadMcp.mockResolvedValue({ fingerprint: 'native-v1', jsonConfig: JSON.stringify({ mcpServers: { docs: { command: 'docs-server', _openbitfunImport: { sourceCandidateId: 'codex', behaviorVersion: 'v1' } }, keep: { command: 'keep' } } }) });
    mocks.mutateHook.mockResolvedValue(data.hooks);
    mocks.applyMcp.mockResolvedValue({ outcome: { status: 'applied' } });
    mocks.applyHook.mockResolvedValue({ outcome: { kind: 'applied', snapshot: data.hooks } });
    mocks.refresh.mockResolvedValue(undefined);
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
  async function render(product: EcosystemProductId = 'codex', catalogFailed = false) {
    const runtime = buildEcosystemProductRuntimes(data.snapshot, []).find((entry) => entry.spec.id === product)!;
    await act(async () => root.render(<ExternalAgentContent key={`${product}:${mocks.workspacePath}`} runtime={runtime} snapshot={data.snapshot} catalogFailed={catalogFailed} onRefresh={mocks.refresh} />));
  }
  async function click(label: string, kind?: string) {
    if (kind && !container.querySelector(`[data-import-kind="${kind}"]`)) await expand(kind);
    const region = kind ? container.querySelector(`[data-import-kind="${kind}"][data-import-discovered="true"]`)! : container;
    const button = Array.from(region.querySelectorAll('button')).find((candidate) => candidate.textContent === label);
    expect(button, label).toBeDefined();
    await act(async () => button!.click());
  }

  async function expand(kind: string) {
    const trigger = container.querySelector<HTMLButtonElement>(`[data-content-group="${kind}"] button[aria-expanded]`)!;
    if (trigger.getAttribute('aria-expanded') !== 'true') await act(async () => trigger.click());
  }

  it('keeps copy management on imported rows without category management links', async () => {
    data.plan.items[0].disposition = 'already_imported';
    await render();
    expect(container.textContent).not.toContain('content.manageNative');
    await click('content.manageCopy', 'mcp');
    expect(mocks.openDestination).toHaveBeenCalledWith({ pageId: 'tools.mcp' });
    expect(mocks.openScene).toHaveBeenCalledWith('settings');
  });

  it('shows instruction ownership, scope and path matching without copy controls', async () => {
    mocks.getInstructions.mockResolvedValue({ schemaVersion: 1, failedEcosystems: [], entries: [
      { ecosystemId: 'codex', name: 'Codex user rules', path: '/user/AGENTS.md', scope: 'user', pathPatterns: [] },
      { ecosystemId: 'claude-code', name: 'Claude path rule', path: '/project/.claude/rules/api.md', scope: 'project', pathPatterns: ['src/**/*.ts'] },
      { ecosystemId: 'shared', name: 'AGENTS.md', path: '/project/AGENTS.md', scope: 'project', pathPatterns: [] },
    ] });
    await render(); await expand('instruction');
    expect(container.textContent).toContain('Codex user rules');
    expect(container.textContent).toContain('content.instructions.shared');
    expect(container.textContent).not.toContain('Claude path rule');
    const rows = container.querySelectorAll('[data-import-kind="instruction"]');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute('data-import-state')).toBe('discovered');
      expect(row.querySelector('input[type="checkbox"]')).toBeNull();
      expect(row.textContent).not.toContain('content.prepareImport');
      expect(row.textContent).not.toContain('content.undo');
    }
    await render('claude-code'); await expand('instruction');
    await click('content.view', 'instruction');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('src/**/*.ts');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('content.instructions.conditional');
    expect(mocks.applyMcp).not.toHaveBeenCalled();
  });

  it.each(['remote', 'peer'] as const)('does not substitute local instruction sources on a %s surface', async (surface) => {
    mocks[surface] = true;
    await render(); await expand('instruction');
    expect(mocks.getInstructions).not.toHaveBeenCalled();
    expect(container.querySelector('[data-import-kind="instruction"]')?.getAttribute('data-import-state')).toBe('discoveryUnavailable');
    expect(container.textContent).toContain('content.instructions.unsupportedHost');
  });

  it('shows a legacy host failure and recovers instruction discovery on refresh', async () => {
    mocks.getInstructions.mockRejectedValueOnce(new Error('Unknown command'));
    await render(); await expand('instruction');
    expect(container.querySelector('[data-import-kind="instruction"]')?.getAttribute('data-import-state')).toBe('discoveryUnavailable');
    const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="content.refresh"]')!;
    await act(async () => refresh.click());
    expect(container.querySelector('[data-import-kind="instruction"]')?.getAttribute('data-import-state')).toBe('notDetected');
  });

  it('clears a local instruction detail when switching to a peer', async () => {
    mocks.getInstructions.mockResolvedValue({ schemaVersion: 1, failedEcosystems: [], entries: [
      { ecosystemId: 'codex', name: 'Local rules', path: '/private/local/AGENTS.md', scope: 'user', pathPatterns: [] },
    ] });
    await render(); await expand('instruction'); await click('content.view', 'instruction');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('/private/local/AGENTS.md');
    mocks.peer = true;
    await render();
    expect(container.textContent).not.toContain('/private/local/AGENTS.md');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.getInstructions).toHaveBeenCalledTimes(1);
  });

  it.each(['single', 'batch'])('binds the %s Skill import to its reviewed package and reports stale content', async (mode) => {
    mocks.skillImportVersion = 3;
    mocks.validateSkill.mockResolvedValue({ valid: true, importPreview: {
      fingerprint: 'reviewed-package', fileCount: 2, name: 'fresh-name', description: 'Fresh description',
    } });
    mocks.addSkill.mockRejectedValue(new Error('skill_import_stale: package changed'));
    await render();
    if (mode === 'single') await click('content.prepareImport', 'skill');
    else await click('content.importAll');
    expect(mocks.validateSkill).toHaveBeenCalledWith(data.skills[0].path, { sourceKey: data.skills[0].key, workspacePath: '/project' });
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('content.reviewedPackage');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('fresh-name');
    expect(mocks.addSkill).not.toHaveBeenCalled();
    await click('content.confirm');
    expect(mocks.addSkill).toHaveBeenCalledWith(expect.objectContaining({ expectedSourceFingerprint: 'reviewed-package', sourceKey: data.skills[0].key }));
    expect(mocks.validateSkill).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(mode === 'single' ? 'content.skillStale' : 'content.batchState.stale');
  });

  it('does not silently downgrade when a host advertising reviewed imports omits the preview', async () => {
    mocks.skillImportVersion = 3;
    await render(); await click('content.prepareImport', 'skill');
    expect(container.textContent).toContain('content.previewFailed');
    expect(mocks.addSkill).not.toHaveBeenCalled();
  });

  it('reviews a full agent batch once and copies only that agent after confirmation', async () => {
    mocks.skillImportVersion = 1;
    await render();
    await click('content.importAll');
    expect(mocks.addSkill).not.toHaveBeenCalled();
    expect(mocks.applyMcp).not.toHaveBeenCalled();
    expect(mocks.applyHook).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('echo reviewed-command');
    await click('content.confirm');
    expect(mocks.addSkill).toHaveBeenCalledTimes(1);
    expect(mocks.addSkill.mock.calls[0][0].sourceKey).toBe(data.skills[0].key);
    expect(mocks.applyMcp.mock.calls[0][2]).toEqual([{ candidateId: 'codex' }]);
    expect(mocks.applyHook).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('content.batchResults');
  });

  it('groups the review by type and advances progress only when an operation settles', async () => {
    mocks.skillImportVersion = 1;
    let finishMcp!: (value: unknown) => void;
    let failSkill!: (error: Error) => void;
    mocks.applyMcp.mockImplementation(() => new Promise((resolve) => { finishMcp = resolve; }));
    mocks.addSkill.mockImplementation(() => new Promise((_resolve, reject) => { failSkill = reject; }));
    await render(); await click('content.importAll');
    const dialog = container.querySelector('[role="dialog"]')!;
    expect([...dialog.querySelectorAll('.ecosystem-compatibility__batch-group')].map((group) => group.getAttribute('aria-label'))).toEqual(['capabilities.skill', 'capabilities.mcp', 'capabilities.hook']);
    expect(dialog.querySelector('progress')).toBeNull();
    await click('content.confirm');
    const progress = dialog.querySelector('progress')!;
    expect(progress.max).toBe(3); expect(progress.value).toBe(0);
    await act(async () => finishMcp({ outcome: { status: 'applied' } }));
    expect(progress.value).toBe(1);
    expect(dialog.textContent).toContain('content.batchPending');
    await act(async () => failSkill(new Error('Copy permission denied')));
    expect(progress.value).toBe(3);
    expect(dialog.textContent).toContain('Copy permission denied');
    expect(dialog.textContent).toContain('content.batchState.failed');
    expect(dialog.textContent).not.toContain('content.batchPending');
  });

  it('starts with compact categories and mounts only the expanded category', async () => {
    await render();
    expect(container.querySelectorAll('[data-content-group]').length).toBeGreaterThan(2);
    expect(container.querySelectorAll('[data-import-kind]')).toHaveLength(0);
    const overview = container.querySelector('.ecosystem-compatibility__content-overview')!;
    expect(overview.querySelectorAll('[role="columnheader"]')).toHaveLength(3);
    expect(overview.textContent).toContain('import.columns.state');
    expect(overview.querySelector('[data-content-group="skill"] [data-icon]')).not.toBeNull();
    expect(overview.querySelector('[data-content-group="skill"]')?.textContent).toContain('import.states.discoverySupported');
    expect(overview.querySelector('[data-content-group="account"] button')).toBeNull();
    await expand('skill');
    expect(container.textContent).toContain('codex-Skill');
    expect(container.textContent).not.toContain('codex-MCP');
    await expand('mcp');
    expect(container.textContent).not.toContain('codex-Skill');
    expect(container.textContent).toContain('codex-MCP');
  });

  it('shows only the selected agent’s content and makes no import on discovery or inspection', async () => {
    await render();
    await expand('skill'); expect(container.textContent).toContain('codex-Skill'); await expand('hook'); expect(container.textContent).toContain('codex-Hooks'); await expand('mcp'); expect(container.textContent).toContain('codex-MCP');
    expect(container.textContent).not.toContain('claude-code-Skill'); expect(container.textContent).not.toContain('claude-code-MCP'); expect(container.textContent).not.toContain('claude-code-Hooks'); expect(container.textContent).not.toContain('openbitfun-Skill');
    await click('content.view', 'mcp');
    expect(container.textContent).toContain('docs-server');
    expect(mocks.applyMcp).not.toHaveBeenCalled(); expect(mocks.addSkill).not.toHaveBeenCalled(); expect(mocks.applyHook).not.toHaveBeenCalled();
    await render('claude-code');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    await expand('skill'); expect(container.textContent).not.toContain('codex-Skill'); expect(container.textContent).toContain('claude-code-Skill');
  });

  it('requires a second explicit confirmation and sends only the selected MCP candidate', async () => {
    mocks.applyMcp.mockImplementationOnce(async () => {
      mocks.planMcp.mockResolvedValue({
        ...data.plan,
        items: data.plan.items.map((item) => item.candidateId === 'codex'
          ? { ...item, disposition: 'already_imported' }
          : item),
      });
      return { outcome: { status: 'applied' } };
    });
    await render(); await click('content.prepareImport', 'mcp');
    expect(mocks.applyMcp).not.toHaveBeenCalled();
    await click('content.confirm');
    expect(mocks.applyMcp).toHaveBeenCalledWith('/project', data.plan, [{ candidateId: 'codex' }]);
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('imported');
  });

  it('cancels without copying and rejects an updated MCP plan until reviewed again', async () => {
    await render(); await click('content.prepareImport', 'mcp'); await click('content.cancel');
    expect(mocks.applyMcp).not.toHaveBeenCalled();
    const refreshed = { ...data.plan, planFingerprint: 'v2', items: [{ ...data.plan.items[0], disposition: 'unavailable' }] };
    mocks.applyMcp.mockResolvedValueOnce({ outcome: { status: 'stale', refreshedPlan: refreshed } });
    await click('content.prepareImport', 'mcp'); await click('content.confirm');
    expect(container.textContent).toContain('content.stale');
    const confirm = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'content.confirm');
    expect(confirm?.disabled).toBe(true);
    expect(mocks.applyMcp).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['single', 'notification'], ['single', 'refresh'], ['batch', 'notification'], ['batch', 'refresh'],
  ])('reconciles a %s MCP import deleted in native management through %s', async (mode, trigger) => {
    mocks.skillImportVersion = 3;
    mocks.planMcp.mockImplementation(async () => structuredClone(data.plan));
    mocks.applyMcp.mockImplementation(async () => {
      data.plan.items[0].disposition = 'already_imported';
      return { outcome: { status: 'applied' } };
    });
    await render();
    if (mode === 'single') await click('content.prepareImport', 'mcp');
    else await click('content.importAll');
    await click('content.confirm');
    if (mode === 'batch') await click('content.close');
    await expand('mcp');
    const row = () => container.querySelector('[data-import-kind="mcp"]')!;
    expect(row().getAttribute('data-import-state')).toBe('imported');
    const calls = mocks.planMcp.mock.calls.length;
    const generation = data.snapshot.generation;
    data.plan.items[0].disposition = 'eligible';
    if (trigger === 'notification') {
      await act(async () => globalEventBus.emit(MCP_CONFIG_CHANGED, { surfaceId: 'local' }));
    } else {
      const refresh = container.querySelector<HTMLButtonElement>('button[aria-label="content.refresh"]')!;
      await act(async () => refresh.click());
    }
    expect(data.snapshot.generation).toBe(generation);
    expect(mocks.planMcp.mock.calls.length).toBeGreaterThan(calls);
    expect(row().getAttribute('data-import-state')).toBe('ready');
    expect(row().textContent).toContain('content.prepareImport');
    expect(row().textContent).not.toContain('content.undo');
    expect(row().textContent).not.toContain('content.manageCopy');
    expect(mocks.saveMcp).not.toHaveBeenCalled();
  });

  it('ignores changes on another host and old MCP plan responses after deletion', async () => {
    data.plan.items[0].disposition = 'already_imported';
    mocks.planMcp.mockImplementation(async () => structuredClone(data.plan));
    await render(); await expand('mcp');
    const calls = mocks.planMcp.mock.calls.length;
    await act(async () => globalEventBus.emit(MCP_CONFIG_CHANGED, { surfaceId: 'another-device' }));
    expect(mocks.planMcp).toHaveBeenCalledTimes(calls);
    const stale = structuredClone(data.plan);
    let finish!: (plan: typeof data.plan) => void;
    mocks.planMcp.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => globalEventBus.emit(MCP_CONFIG_CHANGED, { surfaceId: 'local' }));
    data.plan.items[0].disposition = 'eligible';
    await act(async () => globalEventBus.emit(MCP_CONFIG_CHANGED, { surfaceId: 'local' }));
    await act(async () => finish(stale));
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('ready');
  });

  it('does not offer another import when the native MCP read-back fails after saving', async () => {
    await render(); await click('content.prepareImport', 'mcp');
    mocks.planMcp.mockRejectedValue(new Error('Native configuration unavailable'));
    await click('content.confirm');
    const row = container.querySelector('[data-import-kind="mcp"]')!;
    expect(mocks.applyMcp).toHaveBeenCalledOnce();
    expect(row.getAttribute('data-import-state')).toBe('unavailable');
    expect(row.textContent).not.toContain('content.prepareImport');
    expect(row.textContent).not.toContain('content.undo');
  });

  it('copies a selected Skill only after validation, target review and confirmation', async () => {
    await render(); await click('content.prepareImport', 'skill');
    expect(mocks.validateSkill).toHaveBeenCalledWith('/codex/skills/demo'); expect(mocks.addSkill).not.toHaveBeenCalled();
    await click('content.confirm');
    expect(mocks.addSkill).toHaveBeenCalledWith({ sourcePath: '/codex/skills/demo', level: 'user', workspacePath: '/project' });
  });

  it('locks the reviewed Skill target while a confirmed copy is running', async () => {
    let finish: (value: string) => void = () => {};
    mocks.addSkill.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await render(); await click('content.prepareImport', 'skill'); await click('content.confirm');
    expect(container.querySelector<HTMLSelectElement>('[role="dialog"] select')?.disabled).toBe(true);
    await act(async () => finish('ok'));
  });

  it('withdraws import actions when the latest external catalog read failed', async () => {
    await render();
    await render('codex', true); await expand('mcp');
    const row = container.querySelector('[data-import-kind="mcp"]');
    expect(row?.getAttribute('data-import-state')).toBe('discoveryUnavailable');
    expect(row?.textContent).not.toContain('content.prepareImport');
    expect(mocks.applyMcp).not.toHaveBeenCalled();
  });

  it('blocks same-directory Skill collisions without claiming the native item was imported', async () => {
    data.skills[2].dirName = 'demo';
    await render(); await click('content.prepareImport', 'skill');
    expect(container.textContent).toContain('content.targetExists');
    await click('content.confirm'); expect(mocks.addSkill).not.toHaveBeenCalled();
    expect(container.querySelector('[data-import-kind="skill"]')?.getAttribute('data-import-state')).not.toBe('imported');
  });

  it('reviews a unique invocation name for a same-name Skill and displays actual import errors', async () => {
    mocks.skillImportVersion = 2;
    data.skills[2].dirName = 'demo';
    mocks.addSkill.mockRejectedValueOnce(new Error('Skill target already exists with different content'));
    await render(); await click('content.prepareImport', 'skill');
    expect(container.querySelector<HTMLInputElement>('[role="dialog"] input')?.value).toBe('demo-codex');
    expect(container.querySelector('[role="dialog"]')?.textContent?.match(/Skill description/g)).toHaveLength(1);
    await click('content.confirm');
    expect(mocks.addSkill.mock.calls[0][0].targetName).toBe('demo-codex');
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('content.skillNameConflict');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('imports only checked rows and can undo the selected committed copy as a batch', async () => {
    mocks.skillImportVersion = 1;
    mocks.addSkill.mockImplementation(async () => {
      data.skills.push(Object.assign({ ...data.skills[0], key: 'imported-copy', sourceId: 'openbitfun', sourceSlot: 'openbitfun', path: '/native/skills/demo' }, {
        importOrigin: { schemaVersion: 1, importId: 'selected-copy', sourceKey: 'codex', sourcePath: '/codex/skills/demo', sourceId: 'codex', sourceLabel: 'Codex', sourceSlot: 'codex', fingerprint: 'copy' },
      }));
      return 'ok';
    });
    data.skills.push({ ...data.skills[0], key: 'second-skill', name: 'second-skill', dirName: 'second', path: '/codex/skills/second' });
    await render(); await expand('skill');
    const check = container.querySelector<HTMLInputElement>('[data-import-kind="skill"] input[type="checkbox"]')!;
    await act(async () => check.click());
    await click('content.importSelected'); await click('content.confirm');
    expect(mocks.addSkill).toHaveBeenCalledTimes(1);
    expect(mocks.addSkill.mock.calls[0][0].sourceKey).toBe('codex');
    await click('content.close');
    await click('content.undoSelected');
    expect(mocks.deleteSkill).not.toHaveBeenCalled();
    let finishUndo!: (value: string) => void;
    mocks.deleteSkill.mockImplementation(() => new Promise((resolve) => { finishUndo = resolve; }));
    await click('content.confirmUndo');
    expect(container.querySelector('progress')?.value).toBe(0);
    await act(async () => finishUndo('ok'));
    expect(container.querySelector('progress')?.value).toBe(1);
    expect(mocks.deleteSkill).toHaveBeenCalledTimes(1);
    expect(mocks.deleteSkill.mock.calls[0][0].expectedImportId).toBe('selected-copy');
    expect(container.textContent).toContain('content.batchUndoState.removed');
  });

  it('shows the exact Hook commands and applies only the reviewed external source', async () => {
    await render(); await click('content.prepareImport', 'hook');
    expect(mocks.planHook).toHaveBeenCalledWith('/project', data.hookPlan.source.key);
    expect(container.textContent).toContain('echo reviewed-command'); expect(mocks.applyHook).not.toHaveBeenCalled();
    await click('content.confirm'); expect(mocks.applyHook).toHaveBeenCalledWith('/project', data.hookPlan);
  });

  it('rejects a Hook preview for a different agent instead of showing or applying it', async () => {
    mocks.planHook.mockResolvedValue({ ...data.hookPlan, source: data.hooks.catalog.sources[1] });
    await render(); await click('content.prepareImport', 'hook');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('content.previewFailed');
    expect(mocks.applyHook).not.toHaveBeenCalled();
  });

  it.each(['pi', 'dsh'] as const)('keeps %s hook declarations visible without copy actions', async (product) => {
    const ecosystemId = product === 'dsh' ? 'deepseek-harness' : 'pi';
    data.hooks.catalog.sources[0].ecosystemId = ecosystemId;
    await render(product); await expand('hook');
    const row = container.querySelector('[data-import-kind="hook"]')!;
    expect(row.getAttribute('data-import-state')).toBe('discovered');
    expect(row.textContent).toContain('content.hookDiscoveryOnly');
    expect(row.textContent).not.toContain('content.prepareImport');
    expect(container.querySelector('[data-content-group="hook"]')?.textContent).not.toContain('content.importCategory');
    expect(mocks.planHook).not.toHaveBeenCalled();
  });

  it('retains discovery but gates flat-file skill import on legacy hosts', async () => {
    Object.assign(data.skills[0], { entryFile: 'demo.md' });
    await render(); await expand('skill');
    const row = container.querySelector('[data-import-kind="skill"]')!;
    expect(row.getAttribute('data-import-state')).toBe('importUnsupported');
    expect(row.textContent).toContain('content.skillImportUnsupported');
    expect(row.textContent).not.toContain('content.prepareImport');
  });

  it('distinguishes a disabled scan from a legacy snapshot without policy facts', async () => {
    data.snapshot.integrationPolicy.effective.enabled = false;
    await render(); await expand('mcp');
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('discoveryDisabled');
    Object.assign(data.snapshot.integrationPolicy, { effective: undefined });
    await render();
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('discoveryUnavailable');
  });

  it('shows direct command availability independently of copy import and same-name selection', async () => {
    data.snapshot.hostCapabilities.canExecuteExternalAssets = true;
    data.snapshot.commands = [{ candidateId: 'command-1', definition: {
      id: { source: data.snapshot.sources[1].record.key, localId: 'review' }, name: 'review',
      description: 'Review changes', contentVersion: 'v1', availability: { state: 'available' },
    } }];
    await render('claude-code'); await expand('command');
    const row = () => container.querySelector('[data-import-kind="command"]')!;
    expect(row().getAttribute('data-import-state')).toBe('available');
    expect(row().textContent).toContain('content.directUse.available');
    expect(row().textContent).not.toContain('content.prepareImport');
    data.snapshot.commandConflicts = [{ conflictKey: 'review', commandName: 'review', candidates: [] }];
    await render('claude-code');
    expect(row().getAttribute('data-import-state')).toBe('conflict');
    data.snapshot.commandConflicts[0].selectedCandidateId = 'command-1';
    await render('claude-code');
    expect(row().getAttribute('data-import-state')).toBe('available');
    data.snapshot.integrationPolicy.effective.ecosystems['claude-code'].capabilities.command = 'discover_only';
    await render('claude-code');
    expect(row().getAttribute('data-import-state')).toBe('disabled');
  });

  it('shows unknown usage for a legacy host without execution capability facts', async () => {
    data.snapshot.commands = [{ definition: {
      id: { source: data.snapshot.sources[1].record.key, localId: 'review' }, name: 'review',
      description: '', contentVersion: 'v1', availability: { state: 'available' },
    } }];
    await render('claude-code'); await expand('command');
    expect(container.querySelector('[data-import-kind="command"]')?.getAttribute('data-import-state')).toBe('discovered');
    expect(container.textContent).toContain('content.directUse.unknown');
  });

  it('reports failed discovery instead of missing content even with a cached candidate', async () => {
    await render('codex', true); await expand('mcp');
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('discoveryUnavailable');
    expect(container.querySelector('[data-import-kind="mcp"]')?.textContent).not.toContain('content.prepareImport');
  });

  it('does not label an imported MCP copy as connected or usable', async () => {
    data.plan.items[0].disposition = 'already_imported';
    await render(); await expand('mcp');
    const row = container.querySelector('[data-import-kind="mcp"]')!;
    expect(row.getAttribute('data-import-state')).toBe('imported');
    expect(row.textContent).toContain('content.mcpImportedDescription');
    expect(row.textContent).not.toContain('import.states.available');
  });

  it.each(['remote', 'peer'] as const)('keeps %s source previews but gates unsupported imports without a local fallback', async (surface) => {
    mocks[surface] = true;
    mocks.skillImportVersion = 3;
    await render(); await expand('skill');
    expect(container.textContent).toContain('codex-Skill');
    expect(container.textContent).not.toContain('content.prepareImport');
    expect(container.textContent).not.toContain('content.manageNative');
    expect(mocks.validateSkill).not.toHaveBeenCalled();
    expect(mocks.planMcp).not.toHaveBeenCalled(); expect(mocks.getHooks).not.toHaveBeenCalled();
    expect(mocks.getHookCatalog).toHaveBeenCalledWith('/project', false);
    expect(mocks.addSkill).not.toHaveBeenCalled(); expect(mocks.applyMcp).not.toHaveBeenCalled();
  });

  it('can cancel undo, then removes only the imported MCP copy after confirmation', async () => {
    data.plan.items[0].disposition = 'already_imported';
    await render(); await click('content.undo', 'mcp');
    expect(container.textContent).toContain('content.undoWarning');
    expect(mocks.saveMcp).not.toHaveBeenCalled();
    await click('content.cancel');
    expect(mocks.saveMcp).not.toHaveBeenCalled();
    await click('content.undo', 'mcp'); await click('content.confirmUndo');
    expect(mocks.saveMcp).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mocks.saveMcp.mock.calls[0][0])).toEqual({ mcpServers: { keep: { command: 'keep' } } });
    expect(mocks.saveMcp.mock.calls[0][1]).toBe('native-v1');
  });

  it('releases the UI after undo commits while the refreshed import plan is still pending', async () => {
    data.plan.items[0].disposition = 'already_imported';
    await render(); await click('content.undo', 'mcp');
    let finishPlan!: (plan: typeof data.plan) => void;
    mocks.planMcp.mockImplementationOnce(() => new Promise(resolve => { finishPlan = resolve; }));
    await click('content.confirmUndo');
    expect(mocks.saveMcp).toHaveBeenCalledTimes(1);
    const view = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-import-kind="mcp"] button')).find(button => button.textContent === 'content.view');
    expect(view?.disabled).toBe(false);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    data.plan.items[0].disposition = 'eligible';
    await act(async () => { finishPlan(data.plan); });
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('ready');
  });

  it('retains import state after a failed undo and requires a new review', async () => {
    data.plan.items[0].disposition = 'already_imported';
    mocks.saveMcp.mockRejectedValue(new Error('stale'));
    await render(); await click('content.undo', 'mcp'); await click('content.confirmUndo');
    expect(container.textContent).toContain('content.undoFailed');
    expect(container.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('stale');
    expect(container.querySelector('[data-import-kind="mcp"]')?.getAttribute('data-import-state')).toBe('imported');
    expect(mocks.saveMcp).toHaveBeenCalledTimes(1);
  });

  it('remembers the exact imported Skill across agent switches and allows reimport after undo', async () => {
    await render(); await click('content.prepareImport', 'skill'); await click('content.confirm');
    await render('claude-code'); await render();
    await click('content.undo', 'skill');
    expect(container.textContent).toContain('content.nativeCopy');
    expect(mocks.deleteSkill).not.toHaveBeenCalled();
    await click('content.confirmUndo');
    expect(mocks.deleteSkill).toHaveBeenCalledWith({ skillKey: 'imported-copy', workspacePath: '/project' });
    expect(container.querySelector('[data-import-kind="skill"]')?.getAttribute('data-import-state')).toBe('ready');
  });

  it('removes only the selected Hook import using its reviewed revision', async () => {
    const imported = { ...data.hooks, imports: [{ importId: 'codex-hook-copy', source: data.hookPlan.source, enabled: true, behaviorVersion: 'v1', state: 'current' }] };
    mocks.getHooks.mockResolvedValue(imported);
    await render(); await click('content.undo', 'hook');
    expect(mocks.mutateHook).not.toHaveBeenCalled();
    await click('content.confirmUndo');
    expect(mocks.mutateHook).toHaveBeenCalledWith('/project', 'r1', { kind: 'remove', importId: 'codex-hook-copy' });
  });

  it('ignores a pending preview when the user switches to another agent', async () => {
    let resolve: (value: { valid: boolean }) => void = () => {};
    mocks.validateSkill.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    await render(); await click('content.prepareImport', 'skill'); await render('claude-code');
    await act(async () => resolve({ valid: true }));
    expect(container.querySelector('[role="dialog"]')).toBeNull(); expect(container.textContent).not.toContain('/codex/skills/demo'); expect(mocks.addSkill).not.toHaveBeenCalled();
  });
});
