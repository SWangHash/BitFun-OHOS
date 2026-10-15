/**
 * View-model types for the qt-harmonyos-migration progress panel.
 *
 * The skill persists its state in `<app>/migration/ohos/` (STATE.md + TSV
 * ledgers). These types describe the parsed ledgers and the derived snapshot
 * rendered by `MigrationProgressPanel`. The panel is strictly read-only.
 */

export type MigrationPhaseId =
  | 'baseline'
  | 'inventory'
  | 'contract'
  | 'pilot'
  | 'implementation'
  | 'features'
  | 'diagnostics'
  | 'handoff';

/** Normalized status used for icons, colors and `data-bitfun-status`. */
export type MigrationStatus =
  | 'done'
  | 'doing'
  | 'ready'
  | 'pending'
  | 'blocked'
  | 'error'
  | 'unknown';

export type MigrationLiveStatus = 'active' | 'blocked' | 'completed' | 'idle';

export type LedgerRow = Record<string, string>;

export interface ParsedTsv {
  header: string[];
  rows: LedgerRow[];
  missingColumns: string[];
  extraColumns: string[];
}

export type MigrationGateVerdict = 'ready' | 'blocked';

/** A phase-gate verdict, from gate stdout (tool events) or `STATE.md` "Last gate". */
export interface MigrationGateResult {
  phase: MigrationPhaseId;
  verdict: MigrationGateVerdict;
  /** Epoch ms when the verdict was produced, when known. */
  at?: number;
  /** Unmet conditions (stdout lists all; STATE.md keeps only the first). */
  unmet: string[];
  unmetCount: number;
  /** `validate_ledgers.py` reported INVALID ledgers (never counted as passed). */
  invalid?: boolean;
  tool?: string;
  source: 'stdout' | 'state';
}

export interface StateGate {
  assessment?: string;
  currentPhase?: string;
  completionTier?: string;
  lastUpdated?: string;
  lastCompletedAction?: string;
  nextExecutableAction?: string;
  /** Parsed `- Last gate:` line written by the skill's gate scripts. */
  lastGate?: MigrationGateResult;
}

export interface StateProgressRow {
  phase: string;
  phaseId?: MigrationPhaseId;
  status: string;
  evidence: string;
}

export interface StateDecisionRow {
  id: string;
  item: string;
  evidence: string;
  ownerStatus: string;
  nextAction: string;
}

export interface ParsedStateMd {
  gate: StateGate;
  progress: StateProgressRow[];
  scope: Record<string, string>;
  decisions: StateDecisionRow[];
}

export interface LedgerDocument {
  path: string;
  exists: boolean;
  text?: string;
  modified?: number;
  size?: number;
}

/** Raw ledger inputs consumed by `deriveSnapshot`. */
export interface MigrationLedgerInput {
  ledgerRoot: string;
  state?: ParsedStateMd;
  tsv: Partial<Record<string, ParsedTsv>>;
  documents: Record<string, LedgerDocument>;
  /** Most recent modification time (ms) across all ledger files. */
  lastWriteAt?: number;
  /**
   * The ledger's parent directory is a HarmonyOS project (AppScope/hvigor
   * files), i.e. the ledger was created inside the converted output project.
   */
  appRootIsOhosProject?: boolean;
  /** Script currently executed by the agent, from tool events. */
  activeAction?: string;
  /** Whether the skill was invoked in the current app run. */
  skillInvoked?: boolean;
  /** The migration agent session is currently running (PROCESSING / FINISHING). */
  sessionRunning?: boolean;
  /** Gate verdicts parsed from tool output in this app run, per phase. */
  gates?: Partial<Record<MigrationPhaseId, MigrationGateResult>>;
  /** Metadata of the external feature packages referenced by feature-adoption.tsv, by package_path. */
  featurePackages?: Record<string, FeaturePackageInfo>;
  /** Files of each feature's private work directory (`<root>/features/<FEAT>/`), by FEAT id. */
  featureWorkdirs?: Record<string, FeatureWorkdirInfo>;
  now?: number;
}

/**
 * Display metadata of an external feature package (`features/<pkg>/hook.json`
 * plus its `registry.tsv` row). Every field is optional: the panel renders a
 * feature from its ledger row alone when the package cannot be read.
 */
export interface FeaturePackageInfo {
  /** `registry.tsv` / `hook.json` feature_id. */
  featureId?: string;
  /** Absolute path of the package directory. */
  path?: string;
  title?: string;
  summary?: string;
  kind?: string;
  version?: string;
  hookPhase?: string;
  /** Display-only steps (`hook.json` milestones) matched against `current_step`. */
  milestones: string[];
  maxAttempts?: number;
  /** Playbook file of the package, when it exists. */
  playbookPath?: string;
}

export interface FeatureWorkdirFile {
  name: string;
  path: string;
}

export interface FeatureWorkdirInfo {
  path: string;
  files: FeatureWorkdirFile[];
}

export type FeatureGateVerdict = 'ready' | 'blocked' | 'closed';

/** Parsed `entry_gate` / `exit_gate` column of feature-adoption.tsv. */
export interface FeatureGateView {
  verdict: FeatureGateVerdict;
  raw: string;
  at?: number;
  unmetCount?: number;
  firstUnmet?: string;
  /** Entry gate re-entered with `--restart`. */
  restart?: boolean;
  /** `CLOSED <status> by <decision>`. */
  closedStatus?: string;
  closedBy?: string;
}

export type FeatureMilestoneState = 'done' | 'current' | 'pending';

export interface FeatureMilestoneView {
  label: string;
  state: FeatureMilestoneState;
}

export interface FeatureLinkView {
  id: string;
  status: MigrationStatus;
  rawStatus: string;
  /** Ledger the id was found in; undefined when it is not recorded anywhere yet. */
  ledger?: string;
}

/** One external feature (FEAT row) registered through the skill's hook mechanism. */
export interface ExternalFeatureView {
  id: string;
  featureId: string;
  title: string;
  summary?: string;
  kind?: string;
  version?: string;
  hostPhase?: MigrationPhaseId;
  hostPhaseRaw?: string;
  status: MigrationStatus;
  rawStatus: string;
  /** In progress and the agent is working right now. */
  running: boolean;
  attempts: number;
  maxAttempts?: number;
  currentStep?: string;
  milestones: FeatureMilestoneView[];
  /** `currentStep` matches one of the milestones (else it is shown on its own). */
  stepMatched: boolean;
  entryGate?: FeatureGateView;
  exitGate?: FeatureGateView;
  decisionId?: string;
  links: FeatureLinkView[];
  notes?: string;
  evidence?: string;
  /** Package metadata could be read. */
  packageResolved: boolean;
  playbookPath?: string;
  workdir?: string;
  files: FeatureWorkdirFile[];
  /** Row written before the hook mechanism (playbook_path header). */
  legacy: boolean;
}

export interface PhaseItemView {
  id: string;
  label: string;
  status: MigrationStatus;
  rawStatus: string;
  detail?: string;
  /**
   * Inventory rows only: the capability's own migration state. The row is
   * "done" for the inventory phase once it is recorded; the capability is
   * migrated later (implementation/handoff), shown as a separate tag.
   */
  migration?: 'pending' | 'doing' | 'done' | 'blocked';
}

export interface PhaseView {
  id: MigrationPhaseId;
  /** File name of the phase's own ledger (one ledger per phase). */
  ledger: string;
  /** Absolute path of that ledger when it exists. */
  ledgerPath?: string;
  status: MigrationStatus;
  statusSource: 'state' | 'ledger' | 'gate';
  rawStatus?: string;
  evidence?: string;
  done: number;
  total: number;
  items: PhaseItemView[];
  /** Latest gate verdict for this phase (stdout or STATE.md, newest wins). */
  gate?: MigrationGateResult;
  /**
   * `doing` while no agent is working on it: render statically, not as a
   * spinner — a spinner reads as "the agent is running".
   */
  paused?: boolean;
}

export interface PendingDecisionView {
  id: string;
  question: string;
  options?: string;
  impact?: string;
  owner?: string;
  status: MigrationStatus;
  rawStatus: string;
  source: 'decisions.tsv' | 'STATE.md';
}

/**
 * `problem`: something went wrong (failed / timeout / blocked / resolved, or
 * not yet classified). `receipt`: a passing batch or bootstrap-style record.
 */
export type DiagnosticKind = 'problem' | 'receipt';

export interface DiagnosticView {
  id: string;
  kind: DiagnosticKind;
  /** Problem that is not fixed yet (failed / timeout / blocked / unclassified). */
  open: boolean;
  phase: string;
  category: string;
  signature: string;
  rootCause: string;
  attempts: number;
  status: MigrationStatus;
  rawStatus: string;
  recurrence: string;
  /** Only set when `log_path` names a text log the editor can open. */
  logPath?: string;
  /** `fix_or_next_action`: the applied fix for a resolved problem, else the next step. */
  nextAction: string;
  unclassified: boolean;
  /**
   * Receipt only: earlier failed attempts (attempts - 1) that have no problem
   * row of their own, i.e. the failure was overwritten instead of recorded.
   */
  unrecordedFailures: number;
}

/**
 * A migration document (STATE.md, report.md, ...) or a supporting ledger
 * shared by several phases (baseline.tsv, ...) that exists on disk.
 */
export interface DocumentRefView {
  id: string;
  kind: 'document' | 'ledger';
  label: string;
  path: string;
  /** Data rows of a ledger. */
  rows?: number;
}

export interface KnowledgeRefView {
  id: string;
  sourcePath: string;
  snapshotPath?: string;
  modified?: string;
  action?: string;
}

export interface MigrationHeaderView {
  project?: string;
  revision?: string;
  assessment?: string;
  completionTier?: string;
  currentPhase?: MigrationPhaseId;
  currentPhaseRaw?: string;
  lastUpdated?: string;
  lastCompletedAction?: string;
  nextAction?: string;
  activeAction?: string;
  overallPercent: number;
  liveStatus: MigrationLiveStatus;
  lastWriteAt?: number;
  /** Migration is completed but the handoff gate's last verdict is BLOCKED. */
  completedGateBlocked?: MigrationGateResult;
}

/**
 * The user's external-feature selection: the newest `decisions.tsv` row with
 * `feature_or_scope=external-features`. `unconfirmed` mirrors the skill gate
 * (`phase_gate.user_approved`): not owner=user + approved + "user: ..." evidence,
 * or evidence recording a question that was never answered (timeout/skip).
 */
export interface FeatureSelectionView {
  decisionId: string;
  /** Selected feature ids; empty when the user chose none. */
  selected: string[];
  confirmed: boolean;
  /** The evidence says the question timed out / was skipped / got no reply. */
  unanswered: boolean;
  evidence?: string;
}

export interface MigrationSnapshot {
  ledgerRoot: string;
  appRoot: string;
  header: MigrationHeaderView;
  decisionsPending: PendingDecisionView[];
  phases: PhaseView[];
  diagnostics: DiagnosticView[];
  /** External features activated through the hook mechanism (feature-adoption.tsv). */
  externalFeatures: ExternalFeatureView[];
  /** The user's external-feature selection decision, when one is recorded. */
  featureSelection?: FeatureSelectionView;
  documents: DocumentRefView[];
  knowledge: KnowledgeRefView[];
  skillInvoked: boolean;
  schemaWarnings: string[];
}
