import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, DialogBody, DialogClose, DialogFooter, DialogHeader, DialogHeading, DialogTitle, Icon, IconButton, Input, LoadingState, OverflowText, ScrollArea, SearchField, Select, StatusPill, type IconSource } from '@openbitfun/ui';
import { EcosystemDialog as Dialog } from './EcosystemDialog';
import { EcosystemBatchLayout } from './EcosystemBatchLayout';
import { presentEcosystemContent } from './ecosystemContentPresentation';
import { suggestSkillImportName, importErrorMessage } from './ecosystemSkillImport';
import { applyEcosystemBatchUndo, type BatchUndoEntry, type BatchUndoResult } from './ecosystemBatchUndo';
import { Bot, CircleUserRound, FileText, Package, PawPrint, Server, Webhook, Wrench } from 'lucide-react';
import { useSceneStore } from '@/app/stores/sceneStore';
import { useSettingsStore } from '@/app/scenes/settings/settingsStore';
import { useSkillsSceneStore } from '@/app/scenes/skills/skillsSceneStore';
import { useI18n } from '@/infrastructure/i18n';
import { useNotification } from '@/shared/notification-system';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { usePeerDeviceModeOptional } from '@/infrastructure/peer-device/peerDeviceContextState';
import { globalEventBus } from '@/infrastructure/event-bus';
import { MCP_CONFIG_CHANGED, type MCPConfigChanged } from '@/infrastructure/mcp/configEvents';
import { getActiveSurfaceScope } from '@/infrastructure/peer-device/deviceSurface';
import { isTauriRuntime } from '@/infrastructure/runtime';
import { WorkspaceKind } from '@/shared/types';
import { configAPI } from '@/infrastructure/api/service-api/ConfigAPI';
import { externalSourcesAPI, type ExternalMcpImportPlanV1, type ExternalSourceCatalogSnapshot } from '@/infrastructure/api/service-api/ExternalSourcesAPI';
import { externalHooksAPI, type ExternalHookImportPlan, type ExternalHookImportSnapshot, type ExternalHookSource } from '@/infrastructure/api/service-api/ExternalHooksAPI';
import { instructionSourcesAPI, type InstructionSourceCatalog, type InstructionSourceEntry } from '@/infrastructure/api/service-api/InstructionSourcesAPI';
import type { SkillInfo, SkillLevel, SkillScanDiagnostic, SkillImportPreview } from '@/infrastructure/config/types';
import { getSkillSourceId, isOpenBitFunManagedSkill } from '@/infrastructure/config/skillSourcePresentation';
import { buildEcosystemImportItems, catalogDiscoveryState, type EcosystemImportItem, type EcosystemImportItemKind, type EcosystemProductRuntime } from './ecosystemCompatibilityModel';
import { applyImportUndo, matchesSkillReceipt, prepareHookUndo, prepareMcpUndo, readSkillImportReceipt, rememberSkillImport, type ImportUndoReview } from './ecosystemImportUndo';
import { applyEcosystemBatch, type BatchImportEntry, type BatchImportResult } from './ecosystemBatchImport';

interface ContentItem extends EcosystemImportItem {
  skill?: SkillInfo;
  hookSource?: ExternalHookSource;
  instruction?: InstructionSourceEntry;
}

const CONTENT_ICONS: Record<EcosystemImportItemKind, IconSource> = {
  account: { glyph: CircleUserRound },
  settings: { name: 'settings' },
  command: { name: 'command-mac' },
  tool: { glyph: Wrench },
  subagent: { glyph: Bot },
  skill: { glyph: Package },
  mcp: { glyph: Server },
  hook: { glyph: Webhook },
  instruction: { glyph: FileText },
  memory: { name: 'thinking' },
  plugin: { name: 'extension' },
  pet: { glyph: PawPrint },
};

type Review =
  | { kind: 'mcp'; item: ContentItem; plan: ExternalMcpImportPlanV1 }
  | { kind: 'skill'; item: ContentItem; skill: SkillInfo; level: SkillLevel; targetName?: string; preview?: SkillImportPreview }
  | { kind: 'hook'; item: ContentItem; plan: ExternalHookImportPlan };

interface Props {
  runtime: EcosystemProductRuntime;
  snapshot: ExternalSourceCatalogSnapshot | null;
  catalogFailed: boolean;
  onRefresh: () => Promise<unknown>;
  onSupplementalCounts?: (counts: Record<string, number>) => void;
}

/** An external catalog, never an embedded native manager. Mount separately for each host/workspace/agent. */
export default function ExternalAgentContent({ runtime, snapshot, catalogFailed, onRefresh, onSupplementalCounts }: Props) {
  const contentId = useId();
  const { t, formatNumber } = useI18n('scenes/ecosystem-compatibility');
  const notification = useNotification();
  const { workspace, workspacePath } = useCurrentWorkspace();
  const peer = usePeerDeviceModeOptional();
  const localImportSupported = isTauriRuntime() && !peer?.peerMode.active
    && workspace?.workspaceKind !== WorkspaceKind.Remote;
  const openNativeManagement = (kind: EcosystemImportItemKind) => {
    if (!localImportSupported) return;
    if (kind === 'skill') {
      useSkillsSceneStore.getState().openNativeSkills();
      useSceneStore.getState().openScene('skills');
    } else if (kind === 'mcp' || kind === 'hook') {
      useSettingsStore.getState().openDestination(kind === 'mcp'
        ? { pageId: 'tools.mcp' } : { pageId: 'tools.automation', viewId: 'hooks' });
      useSceneStore.getState().openScene('settings');
    }
  };
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillImportVersion, setSkillImportVersion] = useState(0);
  const [skillDiagnostics, setSkillDiagnostics] = useState<SkillScanDiagnostic[]>([]);
  const [hooks, setHooks] = useState<ExternalHookImportSnapshot | null>(null);
  const [instructionSnapshot, setInstructionSnapshot] = useState<{ workspacePath: typeof workspacePath; catalog: InstructionSourceCatalog | null } | null>(null);
  const instructions = localImportSupported && instructionSnapshot?.workspacePath === workspacePath
    ? instructionSnapshot?.catalog ?? null : null;
  const [loading, setLoading] = useState(true);
  const [loadFailures, setLoadFailures] = useState<string[]>([]);
  const [plan, setPlan] = useState<ExternalMcpImportPlanV1 | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContentItem | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [batch, setBatch] = useState<BatchImportEntry[] | null>(null);
  const [batchSkipped, setBatchSkipped] = useState(0);
  const [batchResults, setBatchResults] = useState<BatchImportResult[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchUndo, setBatchUndo] = useState<BatchUndoEntry[] | null>(null);
  const [batchUndoResults, setBatchUndoResults] = useState<BatchUndoResult[] | null>(null);
  const [undo, setUndo] = useState<{ item: ContentItem; review: ImportUndoReview } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const alive = useRef(false);
  const loadSequence = useRef(0);
  const reviewSequence = useRef(0);
  const mcpPlanSequence = useRef(0);

  const loadSupplemental = useCallback(async (refresh = false) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    const [skillResult, hookResult, instructionResult] = await Promise.allSettled([
      configAPI.getSkillScanReport({ workspacePath: workspacePath || undefined, forceRefresh: refresh }),
      localImportSupported
        ? externalHooksAPI.getImportSnapshot(workspacePath || undefined, refresh)
        : externalHooksAPI.getCatalog(workspacePath || undefined, refresh).then((catalog) => ({
          schemaVersion: 1 as const, revision: '', catalog, imports: [], diagnostics: [],
        })),
      localImportSupported ? instructionSourcesAPI.getCatalog(workspacePath || undefined) : Promise.resolve(null),
    ]);
    if (!alive.current || sequence !== loadSequence.current) return;
    const failures: string[] = [];
    if (skillResult.status === 'fulfilled') {
      setSkills(skillResult.value.skills);
      setSkillImportVersion(skillResult.value.importOperationsVersion ?? 0);
      setSkillDiagnostics(skillResult.value.diagnostics.filter((entry) => entry.sourceId === runtime.spec.ecosystemId));
    } else { setSkills([]); setSkillDiagnostics([]); failures.push('skill'); }
    if (hookResult.status === 'fulfilled') setHooks(hookResult.value);
    else { setHooks(null); failures.push('hook'); }
    setInstructionSnapshot({ workspacePath, catalog: instructionResult.status === 'fulfilled' ? instructionResult.value : null });
    if (instructionResult.status === 'rejected') failures.push('instruction');
    setLoadFailures(failures);
    setLoading(false);
  }, [localImportSupported, runtime.spec.ecosystemId, workspacePath]);

  useEffect(() => {
    alive.current = true;
    void loadSupplemental();
    return () => { alive.current = false; loadSequence.current += 1; reviewSequence.current += 1; };
  }, [loadSupplemental]);

  useEffect(() => {
    if (!hooks?.catalog.discoveryPending) return;
    const timer = window.setTimeout(() => void loadSupplemental(), 1000);
    return () => window.clearTimeout(timer);
  }, [hooks?.catalog.discoveryPending, hooks, loadSupplemental]);

  const items = useMemo<ContentItem[]>(() => {
    const catalog = buildEcosystemImportItems(snapshot, runtime);
    const externalSkills = skills.filter((skill) => !isOpenBitFunManagedSkill(skill)
      && getSkillSourceId(skill) === runtime.spec.ecosystemId);
    const hookSources = hooks?.catalog.sources.filter((source) => source.ecosystemId === runtime.spec.ecosystemId) ?? [];
    const instructionSources = instructions?.entries.filter((source) => source.ecosystemId === runtime.spec.ecosystemId || source.ecosystemId === 'shared') ?? [];
    return catalog.flatMap((item): ContentItem[] => {
      if (item.kind === 'instruction' && instructionSources.length > 0) return instructionSources.map((instruction) => ({
        ...item, id: `instruction:${instruction.scope}:${instruction.path}`, name: instruction.name,
        sourceName: instruction.ecosystemId === 'shared' ? t('content.instructions.shared') : runtime.spec.name,
        sourceLocation: instruction.path, discovered: true, instruction,
      }));
      if (item.kind === 'skill' && externalSkills.length > 0) return externalSkills.map((skill) => ({
        ...item, id: `skill:${skill.key}`, name: skill.name, description: skill.description,
        sourceName: skill.sourceLabel || runtime.spec.name, sourceLocation: skill.path,
        discovered: true, skill,
      }));
      if (item.kind === 'hook' && hookSources.length > 0) return hookSources.map((source) => ({
        ...item, id: `hook:${source.key.providerId}:${source.key.sourceId}`, name: source.displayName,
        sourceName: runtime.spec.name, sourceLocation: source.locationHint,
        discovered: true, hookSource: source,
      }));
      return [item];
    });
  }, [hooks, instructions, runtime, skills, snapshot, t]);

  useEffect(() => {
    if (loading) return;
    const counts: Record<string, number> = {};
    for (const skill of skills) {
      if (isOpenBitFunManagedSkill(skill)) continue;
      const source = getSkillSourceId(skill);
      counts[source] = (counts[source] ?? 0) + 1;
    }
    for (const source of hooks?.catalog.sources ?? []) {
      counts[source.ecosystemId] = (counts[source.ecosystemId] ?? 0) + 1;
    }
    onSupplementalCounts?.(counts);
  }, [hooks, loading, onSupplementalCounts, skills]);

  const hasMcp = items.some((item) => item.kind === 'mcp' && item.discovered);
  const refreshMcpPlan = useCallback(async () => {
    const sequence = ++mcpPlanSequence.current;
    setPlan(null);
    if (!localImportSupported || !hasMcp) { setPlanLoading(false); return; }
    setPlanLoading(true);
    const next = await externalSourcesAPI.planMcpImport(workspacePath || undefined).catch(() => null);
    if (!alive.current || sequence !== mcpPlanSequence.current) return;
    setPlan(next);
    setPlanLoading(false);
  }, [hasMcp, localImportSupported, workspacePath]);
  useEffect(() => {
    void refreshMcpPlan();
    return () => { mcpPlanSequence.current += 1; };
  }, [refreshMcpPlan, snapshot?.generation]);

  useEffect(() => {
    if (!localImportSupported || !hasMcp) return;
    const scope = getActiveSurfaceScope();
    return globalEventBus.on<MCPConfigChanged>(MCP_CONFIG_CHANGED, ({ surfaceId }) => {
      if (scope.isCurrent() && surfaceId === scope.surfaceId) void refreshMcpPlan();
    });
  }, [hasMcp, localImportSupported, refreshMcpPlan]);

  const importedHook = (item: ContentItem) => hooks?.imports.some((entry) => (
    entry.source.key.providerId === item.hookSource?.key.providerId
    && entry.source.key.sourceId === item.hookSource?.key.sourceId
  ));
  const skillCollision = (skill: SkillInfo, level: SkillLevel) => skills.some((entry) => (
    isOpenBitFunManagedSkill(entry) && entry.level === level && entry.dirName === skill.dirName
  ));
  const importedSkill = (item: ContentItem) => {
    if (!localImportSupported || !item.skill) return null;
    const source = item.skill;
    const native = skills.find((entry) => isOpenBitFunManagedSkill(entry)
      && entry.importOrigin?.sourceKey === source.key && entry.importOrigin.sourcePath === source.path);
    if (native?.importOrigin) return { schemaVersion: 1 as const, sourcePath: source.path,
      nativeKey: native.key, nativePath: native.path, level: native.level,
      importId: native.importOrigin.importId };
    const receipt = readSkillImportReceipt(item.skill.path, workspacePath || undefined);
    return receipt && skills.some((entry) => matchesSkillReceipt(entry, receipt)) ? receipt : null;
  };
  const presentation = (item: ContentItem) => {
    let discoveryState: ReturnType<typeof catalogDiscoveryState> = 'notDetected';
    if (item.kind === 'instruction') {
      if (loading) discoveryState = 'checking';
      else if (!localImportSupported || loadFailures.includes('instruction') || !instructions
        || (!item.discovered && instructions.failedEcosystems.some((id) => id === 'shared' || id === runtime.spec.ecosystemId))) {
        discoveryState = 'discoveryUnavailable';
      }
    } else if (item.kind === 'skill' || item.kind === 'hook') {
      const providerFailed = item.kind === 'hook' && hooks?.catalog.providers.some((provider) => (
        provider.ecosystemId === runtime.spec.ecosystemId && hooks.catalog.failedProviderIds.includes(provider.providerId)
      ));
      if (loading || (item.kind === 'hook' && hooks?.catalog.discoveryPending)) discoveryState = 'checking';
      else if (loadFailures.includes(item.kind) || (item.kind === 'skill' && !item.discovered && skillDiagnostics.length > 0) || providerFailed) discoveryState = 'discoveryUnavailable';
    } else discoveryState = catalogDiscoveryState(snapshot, runtime.spec.ecosystemId, item.kind);
    return presentEcosystemContent({
      item, discoveryState, catalogFailed, localImportSupported,
      // MCP copy existence comes from the current native import plan, not a past success.
      imported: (item.kind !== 'mcp' && completed.has(item.id)) || !!importedHook(item) || !!importedSkill(item),
      skillImportSupported: skillImportVersion >= 1 || !item.skill?.entryFile || item.skill.entryFile === 'SKILL.md',
      hookImportSupported: !!item.hookSource && ['claude-code', 'codex'].includes(item.hookSource.ecosystemId),
      planLoading,
      mcpDisposition: plan?.items.find((entry) => entry.candidateId === item.candidateId)?.disposition,
    });
  };
  const contentState = (item: ContentItem) => presentation(item).state;
  const stateDescription = (item: ContentItem, state: string) => {
    if (item.kind === 'instruction' && !localImportSupported) return t('content.instructions.unsupportedHost');
    const { descriptionKey } = presentation(item);
    if (descriptionKey) return t(descriptionKey);
    if (state === 'unavailable') {
      const entry = plan?.items.find((candidate) => candidate.candidateId === item.candidateId);
      const definition = snapshot?.mcpServers?.find((server) => server.candidateId === item.candidateId)?.definition;
      if (definition?.staticStatus?.state === 'disabled_by_source') return t('content.sourceDisabled');
      return entry?.reasonCode === 'external_mcp.import_setup_required' ? t('content.setupRequired') : t('content.importUnavailable');
    }
    return item.description || t('content.externalOnly');
  };

  async function previewSkill(skill: SkillInfo): Promise<SkillImportPreview> {
    const result = await configAPI.validateSkillPath(skill.path, { sourceKey: skill.key, workspacePath: workspacePath || undefined });
    if (!result.valid || !result.importPreview?.fingerprint) throw new Error('Skill import preview is unavailable');
    return result.importPreview;
  }

  async function prepareBatch(group?: EcosystemImportItemKind, selectedOnly = false) {
    if (busy || !localImportSupported) return;
    setBusy(true);
    setNotice(null);
    const candidates = items.filter((item) => item.kind !== 'instruction' && (!group || item.kind === group) && item.discovered && (!selectedOnly || (selected.has(item.id)
      && `${item.name} ${item.description ?? ''} ${item.sourceLocation ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))));
    const entries: BatchImportEntry[] = [];
    try {
      const freshMcpPlan = candidates.some((item) => item.kind === 'mcp')
        ? await externalSourcesAPI.planMcpImport(workspacePath || undefined).catch(() => null) : null;
      for (const item of candidates) {
        if (!alive.current) return;
        if (!presentation(item).canImport) continue;
        if (item.skill && skillImportVersion >= 1) {
          const preview = skillImportVersion >= 3 ? await previewSkill(item.skill).catch(() => null) : undefined;
          if (preview === null) continue;
          const skill = preview ? { ...item.skill, name: preview.name, description: preview.description } : item.skill;
          const level = skill.level === 'project' && workspacePath ? 'project' : 'user';
          const reserved = entries.filter((entry) => entry.kind === 'skill' && entry.level === level)
            .flatMap((entry) => entry.kind === 'skill' ? [entry.targetName ?? entry.skill.name, entry.targetName ?? entry.skill.dirName] : []);
          const targetName = skillImportVersion >= 2 ? suggestSkillImportName(skill, level, skills, reserved) : undefined;
          entries.push({ id: item.id, name: skill.name, kind: 'skill', skill, level, targetName, ...(preview ? { preview } : {}) });
        }
        else if (item.kind === 'mcp' && item.candidateId && freshMcpPlan?.items.some((candidate) =>
          candidate.candidateId === item.candidateId && ['eligible', 'automatic_rename'].includes(candidate.disposition))) {
          entries.push({ id: item.id, name: item.name, kind: 'mcp', candidateId: item.candidateId, plan: freshMcpPlan });
        } else if (item.hookSource) {
          const next = await externalHooksAPI.planImport(workspacePath || undefined, item.hookSource.key).catch(() => null);
          if (next && next.source.ecosystemId === runtime.spec.ecosystemId
            && next.source.key.providerId === item.hookSource.key.providerId
            && next.source.key.sourceId === item.hookSource.key.sourceId
            && next.disposition !== 'unavailable' && next.handlers.length) {
            entries.push({ id: item.id, name: item.name, kind: 'hook', plan: next });
          }
        }
      }
      if (!alive.current) return;
      setBatchSkipped(candidates.length - entries.length);
      setBatchResults(null);
      setBatch(entries);
    } finally { if (alive.current) setBusy(false); }
  }

  async function confirmBatch() {
    if (!batch?.length || busy || !localImportSupported) return;
    setBusy(true);
    setBatchResults([]);
    try {
      await applyEcosystemBatch(batch, workspacePath || undefined, (result) => {
        if (!alive.current) return;
        setBatchResults((current) => [...(current ?? []), result]);
        if (result.status === 'imported' && batch.find((entry) => entry.id === result.id)?.kind !== 'mcp') {
          setCompleted((current) => new Set([...current, result.id]));
        }
      });
      if (alive.current) {
        void refreshMcpPlan();
        void loadSupplemental(true);
        void onRefresh().catch(() => { if (alive.current) setNotice(t('content.refreshAfterImportFailed')); });
      }
    } catch { if (alive.current) setNotice(t('content.refreshAfterImportFailed')); }
    finally { if (alive.current) setBusy(false); }
  }

  async function prepareImport(item: ContentItem) {
    const sequence = ++reviewSequence.current;
    setNotice(null);
    if (!localImportSupported || busy) return;
    setBusy(true);
    try {
      if (item.skill) {
        const preview = skillImportVersion >= 3 ? await previewSkill(item.skill) : undefined;
        const validation = preview || (skillImportVersion >= 1 && item.skill.entryFile && item.skill.entryFile !== 'SKILL.md')
          ? { valid: true } : await configAPI.validateSkillPath(item.skill.path);
        if (!alive.current || sequence !== reviewSequence.current) return;
        if (!validation.valid) { setNotice(t('content.validationFailed')); return; }
        const skill = preview ? { ...item.skill, name: preview.name, description: preview.description } : item.skill;
        const level = skill.level === 'project' && workspacePath ? 'project' : 'user';
        setReview({ kind: 'skill', item: { ...item, name: skill.name, description: skill.description }, skill, level, preview,
          targetName: skillImportVersion >= 2 ? suggestSkillImportName(skill, level, skills) : undefined });
      } else if (item.hookSource) {
        const next = await externalHooksAPI.planImport(workspacePath || undefined, item.hookSource.key);
        if (!alive.current || sequence !== reviewSequence.current) return;
        if (next.source.ecosystemId !== runtime.spec.ecosystemId || next.source.key.providerId !== item.hookSource.key.providerId || next.source.key.sourceId !== item.hookSource.key.sourceId) { setNotice(t('content.previewFailed')); return; }
        setReview({ kind: 'hook', item, plan: next });
      } else if (item.kind === 'mcp' && plan) {
        setReview({ kind: 'mcp', item, plan });
      }
    } catch {
      if (alive.current && sequence === reviewSequence.current) setNotice(t('content.previewFailed'));
    } finally {
      if (alive.current && sequence === reviewSequence.current) setBusy(false);
    }
  }

  async function confirmImport() {
    if (!review || busy || !localImportSupported) return;
    const captured = review;
    setBusy(true);
    setNotice(null);
    try {
      if (captured.kind === 'skill') {
        if (skillImportVersion < 1 && skillCollision(captured.skill, captured.level)) return;
        await configAPI.addSkill({ sourcePath: captured.skill.path, level: captured.level,
          workspacePath: workspacePath || undefined,
          ...(skillImportVersion >= 2 && captured.targetName ? { targetName: captured.targetName } : {}),
          ...(skillImportVersion >= 1 ? { sourceKey: captured.skill.key } : {}),
          ...(captured.preview ? { expectedSourceFingerprint: captured.preview.fingerprint } : {}) });
        // The copy has committed. A failed read-back must not invite a duplicate import.
        const report = await configAPI.getSkillScanReport({ workspacePath: workspacePath || undefined, forceRefresh: true }).catch(() => null);
        if (!alive.current) return;
        const native = report?.skills.find((entry) => isOpenBitFunManagedSkill(entry)
          && !entry.isBuiltin && entry.level === captured.level && entry.dirName === (captured.targetName ?? captured.skill.dirName)
          && !skills.some((existing) => existing.key === entry.key));
        if (native) rememberSkillImport(captured.skill.path, native, workspacePath || undefined);
        if (report) setSkills(report.skills);
      } else if (captured.kind === 'mcp') {
        const candidateId = captured.item.candidateId!;
        const selected = captured.plan.items.find((item) => item.candidateId === candidateId);
        if (!selected || !['eligible', 'automatic_rename'].includes(selected.disposition)) return;
        const result = await externalSourcesAPI.applyMcpImport(workspacePath || undefined, captured.plan, [{ candidateId }]);
        if (!alive.current) return;
        if (result.outcome.status === 'stale') {
          setPlan(result.outcome.refreshedPlan);
          setReview({ ...captured, plan: result.outcome.refreshedPlan });
          setNotice(t('content.stale'));
          return;
        }
      } else {
        if (captured.plan.disposition === 'unavailable' || captured.plan.handlers.length === 0) return;
        const result = await externalHooksAPI.applyImport(workspacePath || undefined, captured.plan);
        if (!alive.current) return;
        if (result.outcome.kind === 'stale') {
          setReview({ ...captured, plan: result.outcome.refreshedPlan });
          setNotice(t('content.stale'));
          return;
        }
        setHooks(result.outcome.snapshot);
      }
      if (!alive.current) return;
      if (captured.kind === 'mcp') void refreshMcpPlan();
      else setCompleted((current) => new Set([...current, captured.item.id]));
      setReview(null);
      setDetail(null);
      notification.success(t('content.importSuccess', { name: captured.item.name }), { duration: 3200 });
      void loadSupplemental(true);
      void onRefresh().catch(() => { if (alive.current) setNotice(t('content.refreshAfterImportFailed')); });
    } catch (error) {
      const reason = importErrorMessage(error);
      const conflict = reason.includes('Skill target already exists with different content') || reason.includes('Skill target belongs to a different import');
      if (alive.current) setNotice(reason.includes('skill_import_stale:') ? t('content.skillStale') : `${t('content.importFailed')} ${conflict ? t('content.skillNameConflict') : reason}`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function prepareUndo(item: ContentItem) {
    if (busy || !localImportSupported) return;
    const sequence = ++reviewSequence.current;
    setBusy(true);
    setNotice(null);
    try {
      const receipt = importedSkill(item);
      const next = item.kind === 'mcp' && item.candidateId ? await prepareMcpUndo(item.candidateId)
        : item.hookSource ? await prepareHookUndo(item.hookSource, workspacePath || undefined)
          : receipt ? { kind: 'skill' as const, target: receipt.nativePath, receipt } : null;
      if (!alive.current || sequence !== reviewSequence.current) return;
      if (!next) { setNotice(t('content.undoUnavailable')); return; }
      setUndo({ item, review: next });
    } catch {
      if (alive.current && sequence === reviewSequence.current) setNotice(t('content.undoFailed'));
    } finally {
      if (alive.current && sequence === reviewSequence.current) setBusy(false);
    }
  }

  async function confirmUndo() {
    if (!undo || busy || !localImportSupported) return;
    const captured = undo;
    setBusy(true);
    setNotice(null);
    try {
      const result = await applyImportUndo(captured.review, workspacePath || undefined);
      if (!alive.current) return;
      setCompleted((current) => { const next = new Set(current); next.delete(captured.item.id); return next; });
      setUndo(null);
      if (result.runtimeApplied) {
        notification.success(t('content.undoSuccess', { name: captured.item.name }), { duration: 3200 });
      } else {
        setNotice(t('content.undoRuntimePending', { name: captured.item.name }));
      }
      // Clear stale imported states immediately, then reload authoritative owners.
      if (captured.review.kind === 'hook') {
        const importId = captured.review.importId;
        setHooks((current) => current ? { ...current, imports: current.imports.filter((entry) => entry.importId !== importId) } : current);
      }
      if (captured.review.kind === 'skill') {
        const nativeKey = captured.review.receipt.nativeKey;
        setSkills((current) => current.filter((entry) => entry.key !== nativeKey));
      }
      if (captured.review.kind === 'mcp') void refreshMcpPlan();
      void loadSupplemental(true);
      void onRefresh().catch(() => { if (alive.current) setNotice(t('content.refreshAfterImportFailed')); });
    } catch (error) {
      if (alive.current) setNotice(`${t('content.undoFailed')} ${importErrorMessage(error)}`);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function prepareBatchUndo(group?: EcosystemImportItemKind, selectedOnly = false) {
    if (busy || !localImportSupported) return;
    setBusy(true); setNotice(null); setBatchUndoResults(null);
    try {
      const entries: BatchUndoEntry[] = [];
      for (const item of items.filter((entry) => (!group || entry.kind === group) && (!selectedOnly || (selected.has(entry.id)
        && `${entry.name} ${entry.description ?? ''} ${entry.sourceLocation ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))) && contentState(entry) === 'imported')) {
        const receipt = importedSkill(item);
        const review = item.kind === 'mcp' && item.candidateId ? await prepareMcpUndo(item.candidateId)
          : item.hookSource ? await prepareHookUndo(item.hookSource, workspacePath || undefined)
            : receipt ? { kind: 'skill' as const, target: receipt.nativePath, receipt } : null;
        if (!alive.current) return;
        if (!review) throw new Error(t('content.undoUnavailable'));
        entries.push({ id: item.id, name: item.name, review });
      }
      setBatchUndo(entries);
    } catch (error) { if (alive.current) setNotice(`${t('content.undoFailed')} ${importErrorMessage(error)}`); }
    finally { if (alive.current) setBusy(false); }
  }

  async function confirmBatchUndo() {
    if (!batchUndo?.length || busy || !localImportSupported) return;
    setBusy(true); setBatchUndoResults([]);
    try {
      await applyEcosystemBatchUndo(batchUndo, workspacePath || undefined, (result) => {
        if (!alive.current) return;
        setBatchUndoResults((current) => [...(current ?? []), result]);
        if (result.status !== 'failed') setCompleted((current) => { const next = new Set(current); next.delete(result.id); return next; });
      });
      if (!alive.current) return;
      setSelected(new Set());
      void loadSupplemental(true);
      void refreshMcpPlan();
      void onRefresh().catch(() => { if (alive.current) setNotice(t('content.refreshAfterImportFailed')); });
    } catch (error) { if (alive.current) setNotice(`${t('content.undoFailed')} ${importErrorMessage(error)}`); }
    finally { if (alive.current) setBusy(false); }
  }

  const reviewMcp = review?.kind === 'mcp' ? review.plan.items.find((entry) => entry.candidateId === review.item.candidateId) : undefined;
  const confirmDisabled = busy || !review || (review.kind === 'mcp'
    ? !reviewMcp || !['eligible', 'automatic_rename'].includes(reviewMcp.disposition)
    : review.kind === 'hook' ? review.plan.disposition === 'unavailable' || review.plan.handlers.length === 0
      : (review.targetName !== undefined && (!/^[a-zA-Z0-9_-]{1,100}$/.test(review.targetName)
        || skills.some((entry) => isOpenBitFunManagedSkill(entry) && entry.level === review.level
          && [entry.dirName.toLowerCase(), entry.name.toLowerCase()].includes(review.targetName!.toLowerCase()))))
        || (skillImportVersion < 1 && skillCollision(review.skill, review.level)));
  const visible = items.filter((item) => item.kind === kind
    && `${item.name} ${item.description ?? ''} ${item.sourceLocation ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  const requestedDetail = review?.item ?? detail;
  const viewed = requestedDetail?.kind === 'instruction'
    ? items.find((item) => item.id === requestedDetail.id && item.discovered) ?? null
    : requestedDetail;
  const mcpDetail = viewed?.kind === 'mcp' ? snapshot?.mcpServers?.find((entry) => entry.candidateId === viewed.candidateId)?.definition : undefined;
  const hookEntries = viewed?.hookSource ? hooks?.catalog.entries.filter((entry) => (
    entry.source.providerId === viewed.hookSource!.key.providerId && entry.source.sourceId === viewed.hookSource!.key.sourceId
  )) ?? [] : [];

  return (
    <section className="ecosystem-compatibility__section" data-external-agent-content={runtime.spec.ecosystemId}>
      <div className="ecosystem-compatibility__section-heading ecosystem-compatibility__section-heading--actions">
        <div><h2>{t('content.title', { name: runtime.spec.name })}</h2><p>{t('content.description')}</p></div>
        <div className="ecosystem-compatibility__import-action">
          {localImportSupported ? <><Button size="sm" variant="primary" disabled={busy || loading || planLoading} onClick={() => void prepareBatch()}>{t('content.importAll')}</Button>
            <Button size="sm" variant="outline" disabled={busy || loading || !items.some((item) => contentState(item) === 'imported')} onClick={() => void prepareBatchUndo()}>{t('content.undoAll')}</Button></> : null}
          <IconButton size="sm" variant="outline" icon={<Icon name="refresh" size="sm" />} aria-label={t('content.refresh')} title={t('content.refresh')} disabled={busy || loading} onClick={() => { setNotice(null); void refreshMcpPlan(); void loadSupplemental(true); void onRefresh().catch(() => { if (alive.current) setNotice(t('content.refreshAfterImportFailed')); }); }} />
        </div>
      </div>
      {notice && !review && !undo && !batch && !batchUndo ? <p className="ecosystem-compatibility__feedback" role="status">{notice}</p> : null}
      {loading ? <LoadingState size="sm">{t('loading')}</LoadingState> : null}
      <div className="ecosystem-compatibility__content-overview" role="table" aria-label={t('content.title', { name: runtime.spec.name })}>
        <div className="ecosystem-compatibility__content-summary ecosystem-compatibility__content-summary--header" role="row">
          <span role="columnheader">{t('import.columns.item')}</span>
          <span role="columnheader">{t('import.columns.source')}</span>
          <span role="columnheader">{t('import.columns.state')}</span>
        </div>
      {Array.from(new Set(items.map((item) => item.kind))).map((group) => {
        const groupItems = items.filter((item) => item.kind === group);
        const representative = groupItems[0];
        const count = groupItems.filter((item) => item.discovered).length;
        const discoverySupported = representative.discoverySupport === 'supported';
        const expandable = discoverySupported || count > 0;
        const expanded = kind === group;
        const groupId = `${contentId}-${group}`;
        const copyActionsSupported = localImportSupported && (group === 'skill' || group === 'mcp'
          || (group === 'hook' && ['claude-code', 'codex'].includes(runtime.spec.ecosystemId)));
        const description = !discoverySupported
          ? t('import.discoveryUnsupportedDescription', { name: runtime.spec.name, type: t(`capabilities.${group}`) })
          : count > 0 ? t('content.groupSummary', { count: formatNumber(count) })
            : stateDescription(representative, contentState(representative));
        return <div key={group} data-content-group={group} role="rowgroup" className="ecosystem-compatibility__content-group">
          <div className="ecosystem-compatibility__content-summary" role="row">
            <span role="cell" className="ecosystem-compatibility__import-item">
              <span className="ecosystem-compatibility__import-item-icon"><Icon {...CONTENT_ICONS[group]} size="md" /></span>
              <span className="ecosystem-compatibility__import-item-copy">
                <strong><OverflowText>{t(`capabilities.${group}`)}</OverflowText></strong>
                <small>{description}</small>
              </span>
            </span>
            <span role="cell">{runtime.spec.name}</span>
            <span role="cell" className="ecosystem-compatibility__content-summary-state">
              <StatusPill tone="neutral">{t(discoverySupported ? 'import.states.discoverySupported' : 'import.states.discoveryUnsupported')}</StatusPill>
              {expandable ? <IconButton size="sm" variant="quiet"
                icon={<Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" />}
                aria-label={t(expanded ? 'content.collapseCategory' : 'content.expandCategory', { type: t(`capabilities.${group}`) })}
                aria-expanded={expanded} aria-controls={groupId}
                onClick={() => { setKind(expanded ? null : group); setSearch(''); setSelected(new Set()); }} /> : null}
            </span>
          </div>
        <div role="row" hidden={!expanded}>
        <div id={groupId} role="cell" aria-colspan={3} className="ecosystem-compatibility__content-expanded">
        {expanded ? <>
      <div className="ecosystem-compatibility__content-filters">
        <SearchField value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('content.search')} aria-label={t('content.search')} />
        {copyActionsSupported ? <Button size="sm" variant="outline" disabled={busy || loading || planLoading} onClick={() => void prepareBatch(group)}>{t('content.importCategory')}</Button> : null}
        {copyActionsSupported ? <>
          <Button size="sm" variant="outline" disabled={busy || !visible.some((item) => selected.has(item.id) && presentation(item).canImport)} onClick={() => void prepareBatch(group, true)}>{t('content.importSelected')}</Button>
          <Button size="sm" variant="outline" disabled={busy || !visible.some((item) => selected.has(item.id) && contentState(item) === 'imported')} onClick={() => void prepareBatchUndo(group, true)}>{t('content.undoSelected')}</Button>
          <span>{t('content.selectedCount', { count: formatNumber(visible.filter((item) => selected.has(item.id)).length) })}</span>
        </> : null}
      </div>
      {group === 'skill' ? skillDiagnostics.map((entry) => <p key={`${entry.path}:${entry.message}`} role="status">{entry.path}: {entry.message}</p>) : null}
      <ScrollArea className="ecosystem-compatibility__content-list" tabIndex={0} aria-label={t(`capabilities.${group}`)}>
      <div className="ecosystem-compatibility__import-table" role="table" aria-label={t('content.title', { name: runtime.spec.name })}>
        <div className="ecosystem-compatibility__import-row ecosystem-compatibility__import-row--header" role="row">
          <span role="columnheader" className="ecosystem-compatibility__selection-cell">{localImportSupported && group !== 'instruction' ? <Checkbox size="sm" aria-label={t('content.selectVisible')} disabled={busy} checked={visible.some((item) => item.discovered) && visible.filter((item) => item.discovered).every((item) => selected.has(item.id))} onChange={(event) => { const checked = event.target.checked; setSelected((current) => { const next = new Set(current); visible.filter((item) => item.discovered).forEach((item) => checked ? next.add(item.id) : next.delete(item.id)); return next; }); }} /> : null}{t('import.columns.item')}</span><span role="columnheader">{t('import.columns.source')}</span><span role="columnheader">{t('content.importStatus')}</span><span role="columnheader">{t('import.columns.action')}</span>
        </div>
        {visible.map((item) => {
          const { state, canImport: importable } = presentation(item);
          return <div key={item.id} className="ecosystem-compatibility__import-row" role="row" data-import-kind={item.kind} data-import-state={state} data-discovery-support={item.discoverySupport} data-import-discovered={item.discovered ? 'true' : 'false'}>
            <span role="cell" className="ecosystem-compatibility__selection-cell">{localImportSupported && item.kind !== 'instruction' && item.discovered ? <Checkbox size="sm" aria-label={t('content.selectItem', { name: item.name })} checked={selected.has(item.id)} disabled={busy} onChange={(event) => { const checked = event.target.checked; setSelected((current) => { const next = new Set(current); if (checked) next.add(item.id); else next.delete(item.id); return next; }); }} /> : null}<span className="ecosystem-compatibility__import-item-copy"><strong><OverflowText>{item.discovered ? item.name : t(`capabilities.${item.kind}`)}</OverflowText></strong><small>{t(`capabilities.${item.kind}`)} · {stateDescription(item, state)}</small></span></span>
            <span role="cell" className="ecosystem-compatibility__import-source"><strong>{item.sourceName}</strong><small>{item.sourceLocation}</small>{item.instruction ? <small>{t(item.instruction.scope === 'user' ? 'content.instructions.user' : 'content.instructions.project')} · {t(item.instruction.pathPatterns.length ? 'content.instructions.conditional' : 'content.instructions.startup')}</small> : null}</span>
            <span role="cell"><StatusPill tone={state === 'imported' ? 'success' : 'neutral'}>{t(state === 'review' ? 'content.reviewRequired' : `import.states.${state}`)}</StatusPill></span>
            <span role="cell" className="ecosystem-compatibility__import-action">
              {item.discovered ? <Button size="sm" variant="text" disabled={busy} aria-label={`${t('content.view')} ${item.name}`} onClick={() => { setNotice(null); setDetail(item); }}>{t('content.view')}</Button> : null}
              {importable ? <Button size="sm" variant="outline" disabled={busy} aria-label={`${t('content.prepareImport')} ${item.name}`} onClick={() => void prepareImport(item)}>{t('content.prepareImport')}</Button> : null}
              {state === 'imported' && localImportSupported && ['skill', 'mcp', 'hook'].includes(item.kind) ? <Button size="sm" variant="text" disabled={busy} onClick={() => openNativeManagement(item.kind)}>{t('content.manageCopy')}</Button> : null}
              {state === 'imported' && localImportSupported ? <Button size="sm" variant="text" disabled={busy} aria-label={`${t('content.undo')} ${item.name}`} onClick={() => void prepareUndo(item)}>{t('content.undo')}</Button> : null}
              {state === 'imported' && item.skill && skillImportVersion >= 1 && !importedSkill(item)?.importId ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void prepareImport(item)}>{t('content.repairSource')}</Button> : null}
            </span>
          </div>;
        })}
      </div>
      {group === 'instruction' && instructions?.failedEcosystems.some((id) => id === 'shared' || id === runtime.spec.ecosystemId) ? <p role="status">{t('content.instructions.partial')}</p> : null}
      {visible.length === 0 ? <p>{t('content.noMatches')}</p> : null}
      </ScrollArea>
        </> : null}
        </div>
        </div>
        </div>;
      })}
      </div>
      <Dialog className="ecosystem-compatibility__batch-dialog" open={batchUndo !== null} onOpenChange={(open) => { if (!open && !busy) { setBatchUndo(null); setNotice(null); } }} size="lg" closeOnPointerOutside={!busy}>
        <DialogHeader><DialogHeading><DialogTitle>{t(batchUndoResults ? busy ? 'content.batchUndoing' : 'content.batchUndoResults' : 'content.batchUndoTitle')}</DialogTitle></DialogHeading>{!busy ? <DialogClose /> : null}</DialogHeader>
        <EcosystemBatchLayout entries={batchUndo ?? []} getKind={(entry) => entry.review.kind} busy={busy} processed={batchUndoResults?.length}
          summary={batchUndoResults ? t('content.batchUndoSummary', {
            removed: formatNumber(batchUndoResults.filter((result) => result.status === 'removed').length),
            pending: formatNumber(batchUndoResults.filter((result) => result.status === 'pending').length),
            failed: formatNumber(batchUndoResults.filter((result) => result.status === 'failed').length),
          }) : t('content.batchUndoWarning', { count: formatNumber(batchUndo?.length ?? 0) })}
          renderEntry={(entry) => {
            const result = batchUndoResults?.find((item) => item.id === entry.id);
            return <section className="ecosystem-compatibility__review-section"><strong>{entry.name}</strong><p className="ecosystem-compatibility__path">{entry.review.target}</p>
              {batchUndoResults ? <StatusPill tone={result?.status === 'removed' ? 'success' : result?.status === 'failed' ? 'danger' : 'neutral'}>{result ? t(`content.batchUndoState.${result.status}`) : t('content.batchPending')}</StatusPill> : null}
              {result?.error ? <p className="ecosystem-compatibility__feedback ecosystem-compatibility__feedback--error">{result.error}</p> : null}
            </section>;
          }}>
          {!batchUndo?.length ? <p>{t('content.undoEmpty')}</p> : null}
          {notice ? <p role="alert" className="ecosystem-compatibility__feedback ecosystem-compatibility__feedback--error">{notice}</p> : null}
        </EcosystemBatchLayout>
        <DialogFooter><Button size="sm" variant="fill" disabled={busy} onClick={() => setBatchUndo(null)}>{t(batchUndoResults ? 'content.close' : 'content.cancel')}</Button>
          {!batchUndoResults ? <Button size="sm" variant="primary" tone="danger" disabled={busy || !batchUndo?.length} loading={busy} onClick={() => void confirmBatchUndo()}>{t('content.confirmUndo')}</Button> : null}
        </DialogFooter>
      </Dialog>
      <Dialog className="ecosystem-compatibility__batch-dialog" open={batch !== null} onOpenChange={(open) => { if (!open && !busy) { setBatch(null); setNotice(null); } }} size="lg" closeOnPointerOutside={!busy}>
        <DialogHeader><DialogHeading><DialogTitle>{t(batchResults ? busy ? 'content.batchImporting' : 'content.batchResults' : 'content.batchTitle')}</DialogTitle></DialogHeading>{!busy ? <DialogClose /> : null}</DialogHeader>
        <EcosystemBatchLayout entries={batch ?? []} getKind={(entry) => entry.kind} busy={busy} processed={batchResults?.length}
          summary={batchResults ? t('content.batchResultSummary', {
            imported: formatNumber(batchResults.filter((result) => result.status === 'imported').length),
            unresolved: formatNumber(batchResults.filter((result) => result.status !== 'imported').length),
            skipped: formatNumber(batchSkipped),
          }) : t('content.batchDescription', { count: formatNumber(batch?.length ?? 0), skipped: formatNumber(batchSkipped) })}
          renderEntry={(entry) => {
            const result = batchResults?.find((item) => item.id === entry.id);
            return <section className="ecosystem-compatibility__review-section"><strong>{entry.name}</strong>
              {batchResults ? <>
                {entry.kind === 'skill' && entry.targetName ? <p>{t('content.importName')}: {entry.targetName}</p> : null}
                <StatusPill tone={result?.status === 'imported' ? 'success' : result?.status === 'failed' ? 'danger' : 'neutral'}>{result ? t(`content.batchState.${result.status}`) : t('content.batchPending')}</StatusPill>
                {result?.error ? <p className="ecosystem-compatibility__feedback ecosystem-compatibility__feedback--error">{result.error}</p> : null}
              </> : <><p>{entry.kind === 'skill' ? t(entry.level === 'project' ? 'content.projectTarget' : 'content.userTarget') : t('content.nativeUserTarget')}</p>
              {entry.kind === 'skill' && entry.targetName ? <p className="ecosystem-compatibility__feedback">{t('content.renameNotice', { name: entry.targetName })}</p> : null}
              {entry.kind === 'skill' ? <p>{entry.skill.path}</p> : entry.kind === 'hook' ? <p>{entry.plan.source.locationHint}</p> : null}
              {entry.kind === 'hook' ? <><p>{t('content.hookWarning')}</p>{entry.plan.handlers.map((handler) => <div key={handler.stableKey}><p>{handler.event}{handler.matcher ? ` · ${handler.matcher}` : ''}</p><pre>{handler.command}</pre>{handler.commandWindows ? <pre>{handler.commandWindows}</pre> : null}{handler.dependencies.map((dependency) => <p key={dependency.kind === 'managed' ? dependency.relativePath : dependency.location}>{dependency.kind === 'managed' ? dependency.relativePath : dependency.location}</p>)}</div>)}{entry.plan.skipped.map((entry) => <p key={entry.reasonCode}>{t('content.skipped', { reason: entry.reasonCode, count: formatNumber(entry.count) })}</p>)}</> : null}
              {entry.kind === 'skill' && entry.preview ? <p>{t('content.reviewedPackage', { count: formatNumber(entry.preview.fileCount) })}</p> : null}
              {entry.kind === 'mcp' ? <p>{t('content.mcpTarget', { name: entry.plan.items.find((item) => item.candidateId === entry.candidateId)?.proposedNativeId ?? entry.name })}</p> : null}
              </>}
            </section>;
          }}>
          {!batch?.length ? <p>{t('content.batchEmpty')}</p> : null}
          {notice ? <p role="status">{notice}</p> : null}
        </EcosystemBatchLayout>
        <DialogFooter><Button size="sm" variant="fill" disabled={busy} onClick={() => setBatch(null)}>{t(batchResults ? 'content.close' : 'content.cancel')}</Button>
          {!batchResults ? <Button size="sm" variant="primary" disabled={busy || !batch?.length} loading={busy} onClick={() => void confirmBatch()}>{t('content.confirm')}</Button> : null}
        </DialogFooter>
      </Dialog>
      <Dialog open={undo !== null} onOpenChange={(open) => { if (!open && !busy) { setUndo(null); setNotice(null); } }} size="md" closeOnPointerOutside={!busy}>
        <DialogHeader><DialogHeading><DialogTitle>{t('content.undoTitle')}</DialogTitle></DialogHeading>{!busy ? <DialogClose /> : null}</DialogHeader>
        <DialogBody>
          {undo ? <div className="ecosystem-compatibility__content-detail">
            <strong className="ecosystem-compatibility__detail-name">{undo.item.name}</strong><p className="ecosystem-compatibility__feedback">{t('content.undoWarning')}</p>
            <section className="ecosystem-compatibility__review-section"><h3>{t('content.nativeCopy')}</h3><p className="ecosystem-compatibility__path">{undo.review.target}</p></section>
            {notice ? <p role="alert" className="ecosystem-compatibility__feedback ecosystem-compatibility__feedback--error">{notice}</p> : null}
          </div> : null}
        </DialogBody>
        <DialogFooter>
          <Button size="sm" variant="fill" disabled={busy} onClick={() => setUndo(null)}>{t('content.cancel')}</Button>
          <Button size="sm" variant="primary" tone="danger" disabled={busy} loading={busy} onClick={() => void confirmUndo()}>{t('content.confirmUndo')}</Button>
        </DialogFooter>
      </Dialog>
      <Dialog open={viewed !== null} onOpenChange={(open) => { if (!open && !busy) { reviewSequence.current += 1; setReview(null); setDetail(null); setNotice(null); } }} size="lg" closeOnPointerOutside={!busy}>
        <DialogHeader><DialogHeading><DialogTitle>{review ? t('content.confirmTitle') : viewed?.name}</DialogTitle></DialogHeading>{!busy ? <DialogClose /> : null}</DialogHeader>
        <DialogBody>
          {viewed ? <div className="ecosystem-compatibility__content-detail">
            <div className="ecosystem-compatibility__detail-heading"><strong className="ecosystem-compatibility__detail-name">{viewed.name}</strong><StatusPill tone="neutral">{runtime.spec.name} · {t(`capabilities.${viewed.kind}`)}</StatusPill></div>
            <section className="ecosystem-compatibility__review-section"><h3>{t('content.sourceLocation')}</h3><p className="ecosystem-compatibility__path">{viewed.sourceLocation}</p></section>
            {viewed.description ? <section className="ecosystem-compatibility__review-section"><h3>{t('content.descriptionLabel')}</h3><p>{viewed.description}</p></section> : null}
            {stateDescription(viewed, contentState(viewed)) !== viewed.description ? <p className="ecosystem-compatibility__feedback">{stateDescription(viewed, contentState(viewed))}</p> : null}
            {viewed.instruction ? <><p>{t('content.instructions.description')}</p><dl className="ecosystem-compatibility__metadata">
              <dt>{t('content.instructions.scope')}</dt><dd>{t(viewed.instruction.scope === 'user' ? 'content.instructions.user' : 'content.instructions.project')}</dd>
              <dt>{t('content.instructions.application')}</dt><dd>{t(viewed.instruction.pathPatterns.length ? 'content.instructions.conditional' : 'content.instructions.startup')}</dd>
              {viewed.instruction.pathPatterns.length ? <><dt>{t('content.instructions.patterns')}</dt><dd>{viewed.instruction.pathPatterns.join(', ')}</dd></> : null}
            </dl></> : null}
            {mcpDetail ? <dl className="ecosystem-compatibility__metadata"><dt>{t('content.transport')}</dt><dd>{mcpDetail.transport}</dd><dt>{t('content.command')}</dt><dd>{mcpDetail.commandPreview ?? mcpDetail.remoteUrlPreview ?? '—'}</dd><dt>{t('content.environmentKeys')}</dt><dd>{mcpDetail.environmentKeys?.join(', ') || '—'}</dd><dt>{t('content.headerNames')}</dt><dd>{mcpDetail.headerNames?.join(', ') || '—'}</dd></dl> : null}
            {hookEntries.map((entry) => <p key={entry.stableKey}>{entry.nativeEvent} · {entry.handlerKind}{entry.matcher.kind === 'pattern' ? ` · ${entry.matcher.display}` : ''}</p>)}
            {review ? <>
              <p className="ecosystem-compatibility__feedback">{t('content.copyWarning')}</p>
              {review.kind === 'mcp' ? <p>{t('content.mcpTarget', { name: reviewMcp?.proposedNativeId ?? review.item.name })}</p> : null}
              {review.kind === 'skill' ? <>
                {review.preview ? <p>{t('content.reviewedPackage', { count: formatNumber(review.preview.fileCount) })}</p> : null}
                <div className="ecosystem-compatibility__target-field"><label htmlFor={`${contentId}-scope`}>{t('content.targetScope')}</label><Select id={`${contentId}-scope`} size="sm" disabled={busy} value={review.level} onValueChange={(value) => { setNotice(null); const level = value as SkillLevel; setReview({ ...review, level, targetName: skillImportVersion >= 2 ? suggestSkillImportName(review.skill, level, skills) : undefined }); }} options={[{ value: 'user', label: t('content.userTarget') }, ...(workspacePath ? [{ value: 'project', label: t('content.projectTarget') }] : [])]} /></div>
                {skillImportVersion >= 2 ? <div className="ecosystem-compatibility__target-field"><label htmlFor={`${contentId}-name`}>{t('content.importName')}</label><Input id={`${contentId}-name`} size="sm" disabled={busy} value={review.targetName ?? review.skill.dirName} onChange={(event) => { setNotice(null); setReview({ ...review, targetName: event.target.value }); }} /></div> : null}
                {review.targetName ? <p className="ecosystem-compatibility__feedback">{t('content.renameNotice', { name: review.targetName })}</p> : null}
                {review.targetName !== undefined && confirmDisabled && !busy ? <p role="alert" className="ecosystem-compatibility__feedback ecosystem-compatibility__feedback--error">{t('content.invalidImportName')}</p> : null}
                {skillCollision(review.skill, review.level) && skillImportVersion < 2 ? <p role="alert" className="ecosystem-compatibility__feedback">{t(skillImportVersion >= 1 ? 'content.targetRepair' : 'content.targetExists')}</p> : null}
              </> : null}
              {review.kind === 'hook' ? <>
                <p>{t('content.hookWarning')}</p>
                {review.plan.handlers.map((handler) => <section key={handler.stableKey}><h4>{handler.event}{handler.matcher ? ` · ${handler.matcher}` : ''}</h4><pre>{handler.command}</pre>{handler.commandWindows ? <pre>{handler.commandWindows}</pre> : null}{handler.dependencies.map((dependency) => <p key={dependency.kind === 'managed' ? dependency.relativePath : dependency.location}>{dependency.kind === 'managed' ? dependency.relativePath : dependency.location}</p>)}</section>)}
                {review.plan.skipped.map((entry) => <p key={entry.reasonCode}>{t('content.skipped', { reason: entry.reasonCode, count: formatNumber(entry.count) })}</p>)}
              </> : null}
              {notice ? <p role="alert" className="ecosystem-compatibility__feedback ecosystem-compatibility__feedback--error">{notice}</p> : null}
            </> : null}
          </div> : null}
        </DialogBody>
        {review ? <DialogFooter>
          <Button size="sm" variant="fill" disabled={busy} onClick={() => { setReview(null); setDetail(null); setNotice(null); }}>{t('content.cancel')}</Button>
          <Button size="sm" variant="primary" disabled={confirmDisabled} loading={busy} onClick={() => void confirmImport()}>{t('content.confirm')}</Button>
        </DialogFooter> : null}
      </Dialog>
    </section>
  );
}
