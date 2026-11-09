import {
  AGENT_DEFAULT_OWNER,
  DIAGNOSTIC_STAGES,
  LEDGER_TSV_HEADERS,
  DEVICE_RUN_DONE,
  MIGRATION_PHASES,
  PHASE_LEDGERS,
  SUPPORTING_LEDGERS,
  decisionAnswer,
  isLegacyLayout,
  isPlaceholder,
  ledgerRowStatus,
  normalizeStatus,
  phaseIdFromLabel,
} from '../model/ledgerSchema';
import type {
  AgentDecisionView,
  DeviceRunView,
  DiagnosticView,
  DocumentRefView,
  LedgerRow,
  MigrationLedgerInput,
  MigrationLiveStatus,
  MigrationPhaseId,
  MigrationSnapshot,
  MigrationStatus,
  ParsedTsv,
  PhaseItemView,
  PhaseNoteView,
  PhaseView,
  StateProgressRow,
} from '../model/types';
import {
  ADOPTION_LEDGER,
  buildExternalFeatures,
  featureHostPhase,
  featureRows,
  featureTitle,
} from './deriveExternalFeatures';

/** A ledger write newer than this marks the migration as "active". */
export const ACTIVE_WRITE_WINDOW_MS = 30_000;

/** A parsed ledger in the current layout; a ledger of an older skill reads as absent (it is reported instead). */
function current(input: MigrationLedgerInput, file: string): ParsedTsv | undefined {
  const parsed = input.tsv[file];
  return parsed && !isLegacyLayout(parsed) ? parsed : undefined;
}

function rows(input: MigrationLedgerInput, file: string): LedgerRow[] {
  return current(input, file)?.rows ?? [];
}

/** Data rows that have an id. */
function meaningfulRows(input: MigrationLedgerInput, file: string): LedgerRow[] {
  return rows(input, file).filter((row) => row.id);
}

function value(row: LedgerRow | undefined, key: string): string {
  const raw = (row?.[key] ?? '').trim();
  return isPlaceholder(raw) ? '' : raw;
}

function splitIds(raw: string | undefined): string[] {
  return (raw ?? '').split(/[,;\s]+/).map((entry) => entry.trim()).filter((entry) => entry && !isPlaceholder(entry));
}

function shorten(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function item(id: string, label: string, status: MigrationStatus, rawStatus: string, detail?: string): PhaseItemView {
  return { id, label: label || id, status, rawStatus, detail: detail || undefined };
}

export function getAppRoot(ledgerRoot: string): string {
  return ledgerRoot.replace(/[\\/]+$/, '').replace(/[\\/]migration[\\/]ohos$/i, '');
}

function baseName(path: string): string | undefined {
  return path.split(/[\\/]+/).filter(Boolean).pop() || undefined;
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

// ------------------------------------------------------------ phase rows

const ENV_NOTICE_TONES: Record<string, NonNullable<PhaseItemView['notice']>['tone']> = {
  warn: 'warning',
  fixed: 'fixed',
  error: 'error',
  missing: 'error',
};

/**
 * Phase 1: one row per environment item (env_probe.py). The right column is
 * always the version; the issue goes on its own line so it never squeezes the
 * item name. warn/fixed rows are done (only error/missing block the gate).
 */
function environmentItems(input: MigrationLedgerInput): PhaseItemView[] {
  return rows(input, 'environment.tsv').filter((row) => row.id).map((row) => {
    const raw = (row.status ?? '').trim();
    const entry = item(row.id, value(row, 'item') || row.id, ledgerRowStatus('environment.tsv', row), raw,
      value(row, 'version'));
    entry.hint = value(row, 'path') || undefined;
    const tone = ENV_NOTICE_TONES[raw.toLowerCase()];
    const issue = value(row, 'issue');
    if (tone && (issue || tone === 'warning')) entry.notice = { tone, text: issue || raw };
    return entry;
  });
}

/**
 * Phase 2: an inventory row is done once a TASK row names it in `inventory_ids`
 * (what the inventory gate checks). Inventory rows have no status: what became
 * of a row is the state of the TASK rows that name it (phase 4).
 */
function inventoryItems(input: MigrationLedgerInput): PhaseItemView[] {
  const named = new Set(rows(input, 'tasks.tsv').flatMap((row) => splitIds(row.inventory_ids)));
  return meaningfulRows(input, 'inventory.tsv').map((row) => {
    const label = [value(row, 'category'), value(row, 'location')].filter(Boolean).join(' · ');
    const detail = [value(row, 'disposition'), value(row, 'target_behavior')].filter(Boolean).join(' · ');
    const tags = [...new Set((row.found_by ?? '').split(';')
      .map((part) => part.split(':')[0].trim().toLowerCase())
      .filter((source) => source && !isPlaceholder(source)))];
    return {
      ...item(row.id, label || row.id, named.has(row.id) ? 'done' : 'pending', '', shorten(detail)),
      tags: tags.length > 0 ? tags : undefined,
    };
  });
}

function isAgentDefault(row: LedgerRow): boolean {
  return value(row, 'owner').toLowerCase() === AGENT_DEFAULT_OWNER;
}

function decisionItem(row: LedgerRow): PhaseItemView {
  const entry = item(row.id, value(row, 'question') || row.id, ledgerRowStatus('decisions.tsv', row),
    decisionAnswer(row) ? 'answered' : 'unanswered', decisionAnswer(row));
  if (isAgentDefault(row) && decisionAnswer(row)) entry.decidedByAgent = true;
  return entry;
}

/** Phase 3: every question (external-feature answers are never decisions.tsv rows). */
function decisionsItems(input: MigrationLedgerInput): PhaseItemView[] {
  return meaningfulRows(input, 'decisions.tsv').map(decisionItem);
}

const LAST_BATCH_RE = /\[last batch ([^\]]+)\]/;

/** Phase 4: TASK rows. */
function tasksItems(input: MigrationLedgerInput): PhaseItemView[] {
  return meaningfulRows(input, 'tasks.tsv').map((row) => {
    const caps = splitIds(row.inventory_ids).length;
    const vals = splitIds(row.validation_ids).length;
    const batch = (row.evidence ?? '').match(LAST_BATCH_RE)?.[1];
    const detail = [caps && `INV ×${caps}`, vals && `VAL ×${vals}`, batch && `batch ${batch}`].filter(Boolean).join(' · ');
    return item(row.id, value(row, 'task') || row.id, ledgerRowStatus('tasks.tsv', row), row.status ?? '', detail);
  });
}

/** Phase 6: the capability FEAT rows (the user's answers are in their notes, shown on the feature cards). */
function featuresItems(input: MigrationLedgerInput): PhaseItemView[] {
  return featurePhaseItems(input, 'features');
}

/** Phase 7: acceptance scenarios, then the verification FEAT rows. */
function validationItems(input: MigrationLedgerInput): PhaseItemView[] {
  return [
    ...meaningfulRows(input, 'validation.tsv').map((row) => item(
      row.id, value(row, 'scenario') || row.id, ledgerRowStatus('validation.tsv', row), row.status ?? '',
      shorten(value(row, 'evidence') || value(row, 'expected')))),
    ...featurePhaseItems(input, 'validation'),
  ];
}

function phaseItems(input: MigrationLedgerInput, phase: MigrationPhaseId): PhaseItemView[] {
  switch (phase) {
    case 'environment':
      return environmentItems(input);
    case 'inventory':
      return inventoryItems(input);
    case 'decisions':
      return decisionsItems(input);
    case 'tasks':
      return tasksItems(input);
    case 'diagnostics':
      // The problems are listed in their own section; the phase shows counts (phaseNotes).
      return [];
    case 'features':
      return featuresItems(input);
    case 'validation':
      return validationItems(input);
    default:
      return [];
  }
}

/** FEAT rows of the external features that hook into `phase`. */
function featurePhaseItems(input: MigrationLedgerInput, phase: MigrationPhaseId): PhaseItemView[] {
  return featureRows(input)
    .filter((row) => featureHostPhase(row, input) === phase)
    .map((row) => item(
      row.id,
      featureTitle(row, input),
      normalizeStatus(row.status),
      row.status ?? '',
      value(row, 'current_step') || value(row, 'kind'),
    ));
}

/** device-runs.tsv status → the phase note shown for it. */
const DEVICE_RUN_NOTES: Record<string, Pick<PhaseNoteView, 'kind' | 'tone'>> = {
  run: { kind: 'deviceRun', tone: 'success' },
  'no-device': { kind: 'noDevice', tone: 'neutral' },
  checked: { kind: 'hapChecked', tone: 'warning' },
  'hap-failed': { kind: 'hapFailed', tone: 'error' },
};

/** Phase 5 facts: problem counts and the application HAP's latest result (device-runs.tsv). */
function phaseNotes(
  phase: MigrationPhaseId,
  diagnostics: DiagnosticView[],
  deviceRun: DeviceRunView | undefined,
): PhaseNoteView[] | undefined {
  if (phase !== 'diagnostics') return undefined;
  const open = diagnostics.filter((entry) => entry.open).length;
  const blocked = diagnostics.filter((entry) => entry.status === 'blocked').length;
  const fixed = diagnostics.filter((entry) => entry.status === 'done').length;
  const notes: PhaseNoteView[] = [{
    kind: 'problems',
    tone: open > 0 ? 'error' : blocked > 0 ? 'warning' : diagnostics.length > 0 ? 'success' : 'neutral',
    values: { open, blocked, fixed },
  }];
  notes.push(DEVICE_RUN_NOTES[deviceRun?.status ?? ''] ?? { kind: 'noHap', tone: 'warning' });
  return notes;
}

// ------------------------------------------------------------ phases and gates

function resolveCurrentPhase(raw: string | undefined): MigrationPhaseId | undefined {
  if (!raw) return undefined;
  const text = raw.replace(/`/g, '').trim().toLowerCase();
  const exact = MIGRATION_PHASES.find((phase) => text === phase || text.startsWith(`${phase} `));
  return exact ?? phaseIdFromLabel(text);
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

/**
 * Phase status is STATE.md's Progress row alone (the skill's gate and ledger
 * scripts keep it current: planned / in-progress / blocked / failed / passed).
 * Whether an agent is working only decides how `in-progress` is drawn.
 */
function buildPhases(
  input: MigrationLedgerInput,
  notesOf: (phase: MigrationPhaseId) => PhaseNoteView[] | undefined,
): PhaseView[] {
  const working = agentWorking(input);
  const progressByPhase = new Map<MigrationPhaseId, StateProgressRow>();
  for (const row of input.state?.progress ?? []) {
    if (row.phaseId && !progressByPhase.has(row.phaseId)) progressByPhase.set(row.phaseId, row);
  }

  return MIGRATION_PHASES.map((phase) => {
    const items = phaseItems(input, phase);
    const done = items.filter((entry) => entry.status === 'done').length;
    const fromState = progressByPhase.get(phase);
    const status: MigrationStatus = fromState && !isPlaceholder(fromState.status) ? normalizeStatus(fromState.status) : 'unknown';
    const ledger = PHASE_LEDGERS[phase];
    return {
      id: phase,
      ledger,
      ledgerPath: input.tsv[ledger] ? joinPath(input.ledgerRoot, ledger) : undefined,
      status,
      rawStatus: fromState?.status,
      done,
      total: items.length,
      items,
      notes: notesOf(phase),
      gate: fromState?.gate,
      paused: status === 'doing' && !working ? true : undefined,
    };
  });
}

/**
 * The migration has ended: the validation phase passed, or the agent ran the
 * validation gate, stopped, and every validation row is closed. A NOT-READY
 * validation gate is then reported next to the result. Whether it ended
 * *verified* is `liveStatus`'s call.
 */
function isFinished(input: MigrationLedgerInput, phases: PhaseView[]): boolean {
  const validation = phases.find((phase) => phase.id === 'validation');
  if (!validation) return false;
  if (validation.status === 'done') return true;
  return !!validation.gate && !agentWorking(input) && allItemsDone(validation);
}

// ------------------------------------------------------------ sections

/** Answers the runtime chose on the user's behalf (`owner=agent-default`). */
function buildAgentDecisions(input: MigrationLedgerInput): AgentDecisionView[] {
  return meaningfulRows(input, 'decisions.tsv')
    .filter((row) => isAgentDefault(row) && decisionAnswer(row))
    .map((row) => ({ id: row.id, question: value(row, 'question') || row.id, answer: decisionAnswer(row) }));
}

/** Logs worth opening in the editor; binaries, directories and command labels are skipped. */
const TEXT_LOG_RE = /\.(log|txt|json|md|tsv|out|err)$/i;
const STAGE_SET = new Set<string>(DIAGNOSTIC_STAGES);

/** `reproduce` is `<command> (cwd <dir>); log: <path>`. */
function splitReproduce(raw: string): { command: string; log?: string } {
  const match = raw.match(/^(.*?)(?:;\s*)?\blog:\s*(.+)$/i);
  if (!match) return { command: raw.trim() };
  return { command: match[1].trim().replace(/;$/, '').trim(), log: match[2].trim() };
}

/** One card per problem: open first, then blocked, then fixed; newest first within each group. */
function buildDiagnostics(input: MigrationLedgerInput, appRoot: string): DiagnosticView[] {
  const views = meaningfulRows(input, 'diagnostics.tsv').map((row): DiagnosticView => {
    const location = value(row, 'location');
    const colon = location.indexOf(':');
    const head = colon >= 0 ? location.slice(0, colon).trim().toLowerCase() : '';
    const stage = STAGE_SET.has(head) ? head : '';
    const where = stage ? location.slice(colon + 1).trim() : location;
    const status = ledgerRowStatus('diagnostics.tsv', row);
    const reproduce = splitReproduce(value(row, 'reproduce'));
    const logPath = reproduce.log ? resolveAgainst(appRoot, reproduce.log) : '';
    const open = status === 'error';
    return {
      id: row.id,
      stage,
      where,
      symptom: value(row, 'symptom'),
      cause: value(row, 'cause'),
      fix: value(row, 'fix'),
      status,
      rawStatus: row.status ?? '',
      open,
      needsCause: open && !value(row, 'cause'),
      reproduce: reproduce.command,
      logPath: TEXT_LOG_RE.test(logPath) ? logPath : undefined,
    };
  });
  const rank = (view: DiagnosticView) => (view.open ? 0 : view.status === 'blocked' ? 1 : 2);
  const order = new Map(views.map((view, index) => [view, index]));
  return [...views].sort((left, right) => rank(left) - rank(right) || order.get(right)! - order.get(left)!);
}

/** The one device-runs.tsv row (the skill rewrites it; the last row wins if a hand edit added more). */
function buildDeviceRun(input: MigrationLedgerInput): DeviceRunView | undefined {
  const runs = meaningfulRows(input, 'device-runs.tsv');
  const row = runs[runs.length - 1];
  return row && {
    id: row.id,
    hap: value(row, 'hap'),
    status: (row.status ?? '').trim().toLowerCase(),
    evidence: value(row, 'evidence'),
  };
}

/** The path part of a device-runs.tsv `hap` cell (`<path> (<bundle>)`). */
function hapPath(cell: string): string {
  return cell.trimEnd().endsWith(')') && cell.includes(' (') ? cell.slice(0, cell.lastIndexOf(' (')).trim() : cell.trim();
}

/** Navigation and delivery documents, in reading order. Package payloads and logs are not listed. */
const DOCUMENT_ORDER = ['report.md', 'STATE.md'];

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
    .filter((name) => current(input, name))
    .map((name): DocumentRefView => ({
      id: `ledger:${name}`,
      kind: 'ledger',
      label: name,
      path: joinPath(input.ledgerRoot, name),
      rows: meaningfulRows(input, name).length,
    }));
  // The deliverable: the application HAP of device-runs.tsv once it passed hap_check.py.
  const run = buildDeviceRun(input);
  const hap = run && (DEVICE_RUN_DONE.has(run.status) || run.status === 'checked') ? hapPath(run.hap) : '';
  const artifacts: DocumentRefView[] = hap
    ? [{ id: 'artifact:hap', kind: 'artifact', label: baseName(hap) ?? hap, path: '', target: hap }]
    : [];
  return [...documents, ...ledgers, ...artifacts];
}

/** Done phases count 1; the others count their share of closed rows (phase 5: no open problem). */
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
  diagnostics: DiagnosticView[],
  deviceRun: DeviceRunView | undefined,
): MigrationLiveStatus {
  // Done only when the application HAP ran on a device; otherwise the migration merely ended.
  if (isFinished(input, phases)) return deviceRun?.status === 'run' ? 'completed' : 'ended';
  if (agentWorking(input)) return 'active';
  const assessment = (input.state?.gate.assessment ?? '').toLowerCase();
  if (
    assessment === 'blocked'
    || diagnostics.some((diagnostic) => diagnostic.status === 'blocked')
    || phases.some((phase) => phase.status === 'blocked')
  ) {
    return 'blocked';
  }
  return 'idle';
}

/** Ledgers written with another column layout (an older skill): reported, not rendered. */
function schemaWarnings(input: MigrationLedgerInput): string[] {
  const warnings: string[] = [];
  for (const [file, parsed] of Object.entries(input.tsv)) {
    if (!parsed || !isLegacyLayout(parsed) || !LEDGER_TSV_HEADERS[file]) continue;
    const detail = [
      parsed.missingColumns.length > 0 && `-${parsed.missingColumns.join(',')}`,
      parsed.extraColumns.length > 0 && `+${parsed.extraColumns.join(',')}`,
    ].filter(Boolean).join(' ');
    warnings.push(`${file} (${detail})`);
  }
  return warnings;
}

/**
 * Pure function: parsed ledgers → panel view-model.
 *
 * This is a display approximation of the skill's phase gates. The authoritative
 * READY/NOT-READY verdict remains `validate_ledgers.py --phase <phase>`.
 */
export function deriveSnapshot(input: MigrationLedgerInput): MigrationSnapshot {
  const gate = input.state?.gate ?? {};
  const scope = input.state?.scope ?? {};
  // The ledger lives in the output container; relative paths resolve against the Qt sources.
  const appRoot = scope.source || getAppRoot(input.ledgerRoot);
  const diagnostics = buildDiagnostics(input, appRoot);
  const deviceRun = buildDeviceRun(input);
  const notesOf = (phase: MigrationPhaseId) => phaseNotes(phase, diagnostics, deviceRun);

  const phases = buildPhases(input, notesOf);
  const finished = isFinished(input, phases);
  const validationGate = phases.find((phase) => phase.id === 'validation')?.gate;

  return {
    ledgerRoot: input.ledgerRoot,
    appRoot,
    header: {
      project: scope.target || baseName(appRoot),
      scope,
      revision: scope.revision,
      // STATE.md alone: the gate advances it and moves back a hand edit that skips phases.
      currentPhase: resolveCurrentPhase(gate.currentPhase),
      currentPhaseRaw: gate.currentPhase,
      nextAction: gate.nextExecutableAction,
      activeAction: input.activeAction,
      overallPercent: overallPercent(phases),
      liveStatus: liveStatus(input, phases, diagnostics, deviceRun),
      lastWriteAt: input.lastWriteAt,
      completedGateNotReady: finished && validationGate?.verdict === 'not-ready' ? validationGate : undefined,
    },
    decisionsByAgent: buildAgentDecisions(input),
    phases,
    diagnostics,
    deviceRun,
    externalFeatures: current(input, ADOPTION_LEDGER) ? buildExternalFeatures(input, agentWorking(input)) : [],
    documents: buildDocuments(input),
    skillInvoked: input.skillInvoked ?? false,
    schemaWarnings: schemaWarnings(input),
  };
}
