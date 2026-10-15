import {
  INACTIVE_KNOWLEDGE_ACTIONS,
  MIGRATION_PHASES,
  PHASE_LEDGERS,
  SUPPORTING_LEDGERS,
  hasLegacyHeader,
  isBootstrapId,
  isPlaceholder,
  normalizeStatus,
  phaseIdFromLabel,
} from '../model/ledgerSchema';
import type {
  DiagnosticView,
  DocumentRefView,
  KnowledgeRefView,
  LedgerRow,
  MigrationGateResult,
  MigrationLedgerInput,
  MigrationLiveStatus,
  MigrationPhaseId,
  MigrationSnapshot,
  MigrationStatus,
  PendingDecisionView,
  PhaseItemView,
  PhaseView,
} from '../model/types';
import {
  ADOPTION_LEDGER,
  buildExternalFeatures,
  buildFeatureSelection,
  featureHostPhase,
  featureRows,
  featureTitle,
} from './deriveExternalFeatures';

/** A ledger write newer than this marks the migration as "active". */
export const ACTIVE_WRITE_WINDOW_MS = 30_000;

function rows(input: MigrationLedgerInput, file: string): LedgerRow[] {
  return input.tsv[file]?.rows ?? [];
}

function meaningfulRows(input: MigrationLedgerInput, file: string): LedgerRow[] {
  return rows(input, file).filter((row) => row.id && !isBootstrapId(row.id));
}

function value(row: LedgerRow, key: string): string {
  const raw = row[key] ?? '';
  return isPlaceholder(raw) ? '' : raw;
}

function item(id: string, label: string, rawStatus: string, detail?: string): PhaseItemView {
  return { id, label: label || id, status: normalizeStatus(rawStatus), rawStatus, detail: detail || undefined };
}

export function getAppRoot(ledgerRoot: string): string {
  return ledgerRoot.replace(/[\\/]+$/, '').replace(/[\\/]migration[\\/]ohos$/i, '');
}

function baseName(path: string): string | undefined {
  return path.split(/[\\/]+/).filter(Boolean).pop() || undefined;
}

/**
 * Title fallback when STATE.md has no project name. A ledger created inside
 * the HarmonyOS output project (e.g. `<repo>/project/migration/ohos`) is named
 * after the directory that contains that project, not after the output folder.
 */
function fallbackProjectName(appRoot: string, appRootIsOhosProject?: boolean): string | undefined {
  if (appRootIsOhosProject) {
    const segments = appRoot.split(/[\\/]+/).filter(Boolean);
    const parent = segments[segments.length - 2];
    if (parent && !/^[A-Za-z]:$/.test(parent)) return parent;
  }
  return baseName(appRoot);
}

function separatorOf(path: string): string {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function joinPath(base: string, relative: string): string {
  const sep = separatorOf(base);
  return `${base.replace(/[\\/]+$/, '')}${sep}${relative.replace(/^[\\/]+/, '')}`;
}

function isAbsolutePath(path: string): boolean {
  return /^([A-Za-z]:[\\/]|\/|\\\\)/.test(path);
}

function resolveAgainst(appRoot: string, path: string): string {
  const clean = path.trim().replace(/^`|`$/g, '');
  return isAbsolutePath(clean) ? clean : joinPath(appRoot, clean);
}

function aggregateStatus(items: PhaseItemView[]): MigrationStatus {
  if (items.length === 0) return 'pending';
  if (items.every((entry) => entry.status === 'done')) return 'done';
  if (items.some((entry) => entry.status === 'error')) return 'error';
  if (items.some((entry) => entry.status === 'blocked')) return 'blocked';
  if (items.some((entry) => entry.status === 'done' || entry.status === 'doing')) return 'doing';
  return 'pending';
}

function migrationState(rawStatus: string): NonNullable<PhaseItemView['migration']> {
  const status = normalizeStatus(rawStatus);
  if (status === 'done') return 'done';
  if (status === 'doing') return 'doing';
  if (status === 'blocked' || status === 'error') return 'blocked';
  return 'pending';
}

/**
 * The inventory phase closes once every gap is recorded (scan evidence and a
 * linked validation row), not once it is migrated. The row's `status` column
 * is the capability's migration state, closed in later phases, and is shown
 * as a separate tag.
 */
function inventoryItems(input: MigrationLedgerInput): PhaseItemView[] {
  return meaningfulRows(input, 'inventory.tsv').map((row) => {
    const detail = [value(row, 'disposition'), value(row, 'risk') && `risk=${value(row, 'risk')}`]
      .filter(Boolean)
      .join(' · ');
    const recorded = !!value(row, 'validation_id') && !!(value(row, 'scan_evidence') || value(row, 'evidence'));
    const rawStatus = row.status ?? '';
    return {
      ...item(row.id, value(row, 'category') || value(row, 'source_location') || row.id, rawStatus, detail),
      status: recorded ? 'done' : 'pending',
      migration: migrationState(rawStatus),
    };
  });
}

function decisionItems(input: MigrationLedgerInput): PhaseItemView[] {
  return meaningfulRows(input, 'decisions.tsv').map((row) =>
    item(row.id, value(row, 'question') || row.id, row.status ?? '', value(row, 'selected')));
}

function implementationItems(input: MigrationLedgerInput): PhaseItemView[] {
  const queue = meaningfulRows(input, 'work-queue.tsv');
  const doneIds = new Set(queue.filter((row) => normalizeStatus(row.status) === 'done').map((row) => row.id));
  return queue.map((row) => {
    const entry = item(row.id, value(row, 'capability') || row.id, row.status ?? '', value(row, 'next_action'));
    const raw = (row.status ?? '').trim().toLowerCase();
    if (raw === 'planned' || raw === 'ready') {
      const prerequisites = (row.prerequisites ?? '')
        .split(',')
        .map((prerequisite) => prerequisite.trim())
        .filter((prerequisite) => prerequisite && prerequisite.toLowerCase() !== 'none');
      if (prerequisites.every((prerequisite) => doneIds.has(prerequisite))) {
        entry.status = 'ready';
      }
    }
    const attempts = Number.parseInt(row.attempts ?? '', 10);
    if (Number.isFinite(attempts) && attempts > 0) {
      entry.detail = [entry.detail, `×${attempts}`].filter(Boolean).join(' · ');
    }
    return entry;
  });
}

function isPilotRow(row: LedgerRow): boolean {
  return (row.phase ?? '').trim().toLowerCase() === 'pilot';
}

/**
 * Attempt rows of the pilot (`pilot.tsv`) or of the build loop
 * (`diagnostics.tsv`). Ledgers created before `pilot.tsv` existed kept pilot
 * attempts in `diagnostics.tsv` with `phase=pilot`; they still count as pilot.
 */
function attemptRows(input: MigrationLedgerInput, pilot: boolean): LedgerRow[] {
  const legacy = meaningfulRows(input, 'diagnostics.tsv').filter((row) => isPilotRow(row) === pilot);
  return pilot ? [...legacy, ...meaningfulRows(input, 'pilot.tsv')] : legacy;
}

function diagnosticItems(input: MigrationLedgerInput, pilot: boolean): PhaseItemView[] {
  return attemptRows(input, pilot)
    .map((row) => item(
      row.id,
      value(row, 'first_causal_signature') || value(row, 'category') || row.id,
      row.status ?? '',
      value(row, 'category'),
    ));
}

function phaseItems(input: MigrationLedgerInput, phase: MigrationPhaseId): PhaseItemView[] {
  switch (phase) {
    case 'baseline':
      return rows(input, 'environment.tsv').filter((row) => row.id).map((row) =>
        item(row.id, value(row, 'name') || row.id, row.status ?? '', value(row, 'value')));
    case 'inventory':
      return inventoryItems(input);
    case 'contract':
      return decisionItems(input);
    case 'pilot':
      return diagnosticItems(input, true);
    case 'implementation':
      return implementationItems(input);
    case 'features':
      return featurePhaseItems(input, 'features');
    case 'diagnostics':
      return diagnosticItems(input, false);
    case 'handoff':
      return [
        ...meaningfulRows(input, 'validation.tsv').map((row) =>
          item(row.id, value(row, 'scenario') || row.id, row.status ?? '', value(row, 'platform'))),
        ...featurePhaseItems(input, 'handoff'),
      ];
    default:
      return [];
  }
}

/**
 * FEAT rows of the external features that hook into `phase` (legacy rows and
 * rows without a host phase belong to `features`). Legacy "no feature
 * selected" template rows still count for the features phase.
 */
function featurePhaseItems(input: MigrationLedgerInput, phase: MigrationPhaseId): PhaseItemView[] {
  const selected = new Set(featureRows(input));
  return rows(input, ADOPTION_LEDGER)
    .filter((row) => row.id && !isBootstrapId(row.id))
    .filter((row) => (selected.has(row) ? featureHostPhase(row, input) === phase : phase === 'features'))
    .map((row) => item(
      row.id,
      selected.has(row) ? featureTitle(row, input) : value(row, 'feature_id') || row.id,
      row.status ?? '',
      value(row, 'current_step') || value(row, 'kind') || value(row, 'playbook_path'),
    ));
}

function resolveCurrentPhase(raw: string | undefined): MigrationPhaseId | undefined {
  if (!raw) return undefined;
  const text = raw.replace(/`/g, '').trim().toLowerCase();
  const exact = MIGRATION_PHASES.find((phase) => text === phase || text.startsWith(`${phase} `));
  return exact ?? phaseIdFromLabel(text);
}

/** Newest gate verdict per phase: stdout of this app run vs. STATE.md "Last gate". */
export function collectGates(input: MigrationLedgerInput): Partial<Record<MigrationPhaseId, MigrationGateResult>> {
  const gates: Partial<Record<MigrationPhaseId, MigrationGateResult>> = { ...(input.gates ?? {}) };
  const fromState = input.state?.gate.lastGate;
  if (fromState) {
    const live = gates[fromState.phase];
    // Equal / unknown times prefer stdout: it carries the full unmet list.
    if (!live || (fromState.at !== undefined && (live.at === undefined || fromState.at > live.at + 1_000))) {
      gates[fromState.phase] = fromState;
    }
  }
  return gates;
}

/**
 * Phase the agent is working on. A READY gate for (or past) the phase named in
 * STATE.md means the agent has moved on even if STATE.md was not updated yet.
 */
export function effectiveCurrentPhase(
  fromState: MigrationPhaseId | undefined,
  gates: Partial<Record<MigrationPhaseId, MigrationGateResult>>,
): MigrationPhaseId | undefined {
  let latestReady: MigrationGateResult | undefined;
  for (const gate of Object.values(gates)) {
    if (gate?.verdict !== 'ready') continue;
    if (!latestReady || (gate.at ?? 0) > (latestReady.at ?? 0)
      || ((gate.at ?? 0) === (latestReady.at ?? 0)
        && MIGRATION_PHASES.indexOf(gate.phase) > MIGRATION_PHASES.indexOf(latestReady.phase))) {
      latestReady = gate;
    }
  }
  if (!latestReady) return fromState;
  const passedIndex = MIGRATION_PHASES.indexOf(latestReady.phase);
  const next = MIGRATION_PHASES[Math.min(passedIndex + 1, MIGRATION_PHASES.length - 1)];
  if (!fromState) return next;
  return MIGRATION_PHASES.indexOf(fromState) <= passedIndex ? next : fromState;
}

/** An agent is working right now: running session, gate script or fresh write. */
function agentWorking(input: MigrationLedgerInput): boolean {
  const now = input.now ?? Date.now();
  return !!(input.sessionRunning || input.activeAction
    || (input.lastWriteAt && now - input.lastWriteAt < ACTIVE_WRITE_WINDOW_MS));
}

function allItemsDone(phase: PhaseView): boolean {
  return phase.total > 0 && phase.done === phase.total;
}

function buildPhases(
  input: MigrationLedgerInput,
  currentPhase: MigrationPhaseId | undefined,
  gates: Partial<Record<MigrationPhaseId, MigrationGateResult>>,
): PhaseView[] {
  const working = agentWorking(input);
  const currentIndex = currentPhase ? MIGRATION_PHASES.indexOf(currentPhase) : -1;
  // Gates are cumulative: a READY gate also proves every phase before it.
  const lastReadyIndex = Math.max(-1, ...MIGRATION_PHASES
    .filter((phase) => gates[phase]?.verdict === 'ready')
    .map((phase) => MIGRATION_PHASES.indexOf(phase)));
  const progressByPhase = new Map<MigrationPhaseId, { status: string; evidence: string }>();
  for (const row of input.state?.progress ?? []) {
    if (row.phaseId && !progressByPhase.has(row.phaseId)) {
      progressByPhase.set(row.phaseId, { status: row.status, evidence: row.evidence });
    }
  }

  return MIGRATION_PHASES.map((phase) => {
    const items = phaseItems(input, phase);
    const done = items.filter((entry) => entry.status === 'done').length;
    const fromState = progressByPhase.get(phase);
    const stateStatus = fromState && !isPlaceholder(fromState.status) ? normalizeStatus(fromState.status) : undefined;
    const gate = gates[phase];
    let status: MigrationStatus;
    let statusSource: PhaseView['statusSource'];
    if (stateStatus && stateStatus !== 'unknown') {
      status = stateStatus;
      statusSource = 'state';
    } else {
      status = aggregateStatus(items);
      statusSource = 'ledger';
    }
    if (status !== 'done' && MIGRATION_PHASES.indexOf(phase) <= lastReadyIndex) {
      // The gate script is authoritative; STATE.md may lag behind it.
      status = 'done';
      statusSource = 'gate';
    }
    if (
      status !== 'done' && statusSource === 'state' && currentIndex > MIGRATION_PHASES.indexOf(phase)
      && items.length > 0 && done === items.length
    ) {
      // The agent moved past this phase and its ledger rows are all closed;
      // STATE.md's Progress row simply was not updated.
      status = 'done';
      statusSource = 'ledger';
    }
    if (working && phase === currentPhase && (status === 'pending' || status === 'ready')) {
      status = 'doing';
    }
    const ledger = PHASE_LEDGERS[phase];
    return {
      id: phase,
      ledger,
      ledgerPath: input.tsv[ledger] ? joinPath(input.ledgerRoot, ledger) : undefined,
      status,
      statusSource,
      rawStatus: fromState?.status,
      evidence: fromState && !isPlaceholder(fromState.evidence) ? fromState.evidence : undefined,
      done,
      total: items.length,
      items,
      gate,
      paused: status === 'doing' && !working ? true : undefined,
    };
  });
}

/**
 * Finished migration: the skill's final completion tier, no agent working,
 * and handoff either passed or with every deliverable row closed. A BLOCKED
 * handoff gate is then reported next to the result instead of keeping the
 * phases "in progress" forever.
 */
function isCompleted(input: MigrationLedgerInput, phases: PhaseView[]): boolean {
  const tier = (input.state?.gate.completionTier ?? '').toLowerCase();
  if (!tier.includes('behavior-verified')) return false;
  const handoff = phases.find((phase) => phase.id === 'handoff');
  if (!handoff) return false;
  if (handoff.status === 'done') return true;
  return !agentWorking(input) && allItemsDone(handoff);
}

/**
 * First phase that is still open. Phases run in order, so STATE.md's
 * "Current phase" cannot be trusted when it points past an open phase (an
 * agent hand-edited it). Legacy phases with neither a Progress row nor ledger
 * rows carry no evidence either way and are not treated as open.
 */
function firstOpenPhase(phases: PhaseView[]): MigrationPhaseId | undefined {
  return phases.find((phase) => (
    phase.status !== 'done' && (phase.statusSource === 'state' || phase.total > 0)
  ))?.id;
}

function closeCompletedPhases(phases: PhaseView[]): PhaseView[] {
  return phases.map((phase) => (
    phase.status !== 'done' && (allItemsDone(phase) || phase.total === 0)
      ? { ...phase, status: 'done', statusSource: 'ledger', paused: undefined }
      : phase
  ));
}

function buildPendingDecisions(input: MigrationLedgerInput): PendingDecisionView[] {
  const pending: PendingDecisionView[] = [];
  const seen = new Set<string>();
  for (const row of meaningfulRows(input, 'decisions.tsv')) {
    const status = normalizeStatus(row.status);
    const awaitingUser = (row.owner ?? '').trim().toLowerCase() === 'user' && !value(row, 'approved_at');
    if (status === 'done' || !awaitingUser) continue;
    seen.add(row.id);
    pending.push({
      id: row.id,
      question: value(row, 'question') || row.id,
      options: value(row, 'options') || undefined,
      impact: value(row, 'impact') || undefined,
      owner: value(row, 'owner') || undefined,
      status,
      rawStatus: row.status ?? '',
      source: 'decisions.tsv',
    });
  }
  for (const row of input.state?.decisions ?? []) {
    if (isPlaceholder(row.id) || isPlaceholder(row.item) || seen.has(row.id) || isBootstrapId(row.id)) continue;
    const ownerStatus = row.ownerStatus.toLowerCase();
    if (/\b(approved|closed|resolved|done|passed|accepted|not-applicable)\b/.test(ownerStatus)) continue;
    pending.push({
      id: row.id,
      question: row.item,
      owner: row.ownerStatus || undefined,
      status: /blocked/.test(ownerStatus) ? 'blocked' : 'pending',
      rawStatus: row.ownerStatus,
      source: 'STATE.md',
    });
  }
  return pending;
}

/** Raw statuses that mean a problem was met (fixed or not). */
const PROBLEM_STATUSES = new Set(['failed', 'timeout', 'blocked', 'resolved', 'open', 'error']);
const OPEN_PROBLEM_STATUSES = new Set(['failed', 'timeout', 'blocked', 'open', 'error']);
/** Logs worth opening in the editor; binaries, directories and command labels are skipped. */
const TEXT_LOG_RE = /[\\/][^\\/]+\.(log|txt|json|md|tsv|out|err)$/i;

function splitIds(raw: string | undefined): string[] {
  return (raw ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
}

function buildDiagnostics(input: MigrationLedgerInput, appRoot: string): DiagnosticView[] {
  // Chronological: pilot attempts precede the build loop.
  const source = [...attemptRows(input, true), ...attemptRows(input, false)];
  const isProblem = (row: LedgerRow) => {
    const raw = (row.status ?? '').trim().toLowerCase();
    return PROBLEM_STATUSES.has(raw)
      || /^unclassified$/i.test((row.category ?? '').trim())
      || /^unclassified$/i.test((row.first_causal_signature ?? '').trim());
  };
  const problemRows = source.filter(isProblem);

  const views = source.map((row): DiagnosticView => {
    const attempts = Number.parseInt(row.attempts ?? '', 10);
    const logRaw = value(row, 'log_path');
    const logPath = logRaw ? resolveAgainst(appRoot, logRaw) : '';
    const signature = (row.first_causal_signature ?? '').trim();
    const rawStatus = (row.status ?? '').trim().toLowerCase();
    const unclassified = /^unclassified$/i.test(signature) || /^unclassified$/i.test(row.category ?? '');
    const problem = isProblem(row);
    let unrecordedFailures = 0;
    if (!problem && Number.isFinite(attempts) && attempts > 1) {
      const first = splitIds(row.affected_ids)[0];
      const runId = (row.build_or_device_run_id ?? '').trim();
      const recorded = problemRows.filter((other) =>
        (first && splitIds(other.affected_ids)[0] === first)
        || (runId && (other.build_or_device_run_id ?? '').trim() === runId)).length;
      unrecordedFailures = Math.max(0, attempts - 1 - recorded);
    }
    return {
      id: row.id,
      kind: problem ? 'problem' : 'receipt',
      open: problem && (OPEN_PROBLEM_STATUSES.has(rawStatus) || (unclassified && rawStatus !== 'resolved')),
      phase: value(row, 'phase'),
      category: value(row, 'category'),
      signature: isPlaceholder(signature) ? '' : signature,
      rootCause: value(row, 'root_cause'),
      attempts: Number.isFinite(attempts) ? attempts : 0,
      status: normalizeStatus(row.status),
      rawStatus: row.status ?? '',
      recurrence: value(row, 'recurrence'),
      logPath: TEXT_LOG_RE.test(logPath) ? logPath : undefined,
      nextAction: value(row, 'fix_or_next_action'),
      unclassified,
      unrecordedFailures,
    };
  });
  // Open problems first, then fixed problems, then receipts; newest first within each group.
  const rank = (view: DiagnosticView) => (view.kind === 'receipt' ? 2 : view.open ? 0 : 1);
  const order = new Map(views.map((view, index) => [view, index]));
  return [...views].sort((left, right) => rank(left) - rank(right) || order.get(right)! - order.get(left)!);
}

/** Navigation and handoff documents, in reading order. Package payloads and logs are not listed. */
const DOCUMENT_ORDER = ['report.md', 'STATE.md', 'PORTING_CONTRACT.md', 'assessment.md'];

function buildDocuments(input: MigrationLedgerInput): DocumentRefView[] {
  const documents = Object.entries(input.documents)
    .filter(([name, doc]) => doc.exists && name.toLowerCase().endsWith('.md'))
    .sort(([left], [right]) => {
      const rank = (name: string) => {
        const index = DOCUMENT_ORDER.indexOf(name);
        return index < 0 ? DOCUMENT_ORDER.length : index;
      };
      return rank(left) - rank(right) || left.localeCompare(right);
    })
    .map(([name, doc]): DocumentRefView => ({ id: `doc:${name}`, kind: 'document', label: name, path: doc.path }));
  const ledgers = SUPPORTING_LEDGERS
    .filter((name) => input.tsv[name])
    .map((name): DocumentRefView => ({
      id: `ledger:${name}`,
      kind: 'ledger',
      label: name,
      path: joinPath(input.ledgerRoot, name),
      rows: meaningfulRows(input, name).length,
    }));
  return [...documents, ...ledgers];
}

function buildKnowledge(input: MigrationLedgerInput): KnowledgeRefView[] {
  return rows(input, 'knowledge-manifest.tsv')
    .filter((row) => (row.used ?? '').trim().toLowerCase() === 'yes')
    .filter((row) => !INACTIVE_KNOWLEDGE_ACTIONS.has((row.action ?? '').trim().toLowerCase()))
    .filter((row) => value(row, 'source_path'))
    .map((row) => ({
      id: row.source_path,
      sourcePath: row.source_path,
      snapshotPath: value(row, 'snapshot_path') || undefined,
      modified: value(row, 'modified') || undefined,
      action: value(row, 'action') || undefined,
    }));
}

function overallPercent(phases: PhaseView[]): number {
  if (phases.length === 0) return 0;
  const sum = phases.reduce((total, phase) => {
    if (phase.status === 'done') return total + 1;
    if (phase.total === 0) return total;
    return total + phase.done / phase.total;
  }, 0);
  return Math.round((sum / phases.length) * 100);
}

function liveStatus(
  input: MigrationLedgerInput,
  phases: PhaseView[],
  decisions: PendingDecisionView[],
  diagnostics: DiagnosticView[],
): MigrationLiveStatus {
  if (isCompleted(input, phases)) return 'completed';
  if (agentWorking(input)) return 'active';
  const assessment = (input.state?.gate.assessment ?? '').toLowerCase();
  if (
    assessment === 'blocked'
    || decisions.some((decision) => decision.status === 'blocked')
    || diagnostics.some((diagnostic) => diagnostic.status === 'blocked')
    || phases.some((phase) => phase.status === 'blocked')
  ) {
    return 'blocked';
  }
  return 'idle';
}

function schemaWarnings(input: MigrationLedgerInput): string[] {
  const warnings: string[] = [];
  for (const [file, parsed] of Object.entries(input.tsv)) {
    if (parsed && parsed.header.length > 0 && parsed.missingColumns.length > 0 && !hasLegacyHeader(file, parsed.header)) {
      warnings.push(`${file}: ${parsed.missingColumns.join(', ')}`);
    }
  }
  return warnings;
}

/**
 * Pure function: parsed ledgers → panel view-model.
 *
 * This is a display approximation of the skill's phase gates. The authoritative
 * READY/BLOCKED verdict remains `validate_ledgers.py --phase <phase>`.
 */
export function deriveSnapshot(input: MigrationLedgerInput): MigrationSnapshot {
  const appRoot = getAppRoot(input.ledgerRoot);
  const gate = input.state?.gate ?? {};
  const scope = input.state?.scope ?? {};
  const gates = collectGates(input);
  let currentPhase = effectiveCurrentPhase(resolveCurrentPhase(gate.currentPhase), gates);
  let builtPhases = buildPhases(input, currentPhase, gates);
  if (currentPhase && !isCompleted(input, builtPhases)) {
    const open = firstOpenPhase(builtPhases);
    if (open && MIGRATION_PHASES.indexOf(open) < MIGRATION_PHASES.indexOf(currentPhase)) {
      currentPhase = open;
      builtPhases = buildPhases(input, currentPhase, gates);
    }
  }
  const completed = isCompleted(input, builtPhases);
  const phases = completed ? closeCompletedPhases(builtPhases) : builtPhases;
  const handoffGate = gates.handoff;
  const decisionsPending = buildPendingDecisions(input);
  const diagnostics = buildDiagnostics(input, appRoot);

  const scopeValue = (pattern: RegExp): string | undefined => {
    const key = Object.keys(scope).find((candidate) => pattern.test(candidate.toLowerCase()));
    const raw = key ? scope[key] : undefined;
    return raw && !isPlaceholder(raw) ? raw : undefined;
  };

  return {
    ledgerRoot: input.ledgerRoot,
    appRoot,
    header: {
      project: scopeValue(/project|repositor/) ?? fallbackProjectName(appRoot, input.appRootIsOhosProject),
      revision: scopeValue(/revision/),
      assessment: gate.assessment,
      completionTier: gate.completionTier,
      currentPhase,
      currentPhaseRaw: gate.currentPhase,
      lastUpdated: gate.lastUpdated,
      lastCompletedAction: gate.lastCompletedAction,
      nextAction: gate.nextExecutableAction,
      activeAction: input.activeAction,
      overallPercent: overallPercent(phases),
      liveStatus: liveStatus(input, phases, decisionsPending, diagnostics),
      lastWriteAt: input.lastWriteAt,
      completedGateBlocked: completed && handoffGate?.verdict === 'blocked' ? handoffGate : undefined,
    },
    decisionsPending,
    phases,
    diagnostics,
    externalFeatures: buildExternalFeatures(input, agentWorking(input)),
    featureSelection: buildFeatureSelection(input),
    documents: buildDocuments(input),
    knowledge: buildKnowledge(input),
    skillInvoked: input.skillInvoked ?? false,
    schemaWarnings: schemaWarnings(input),
  };
}
