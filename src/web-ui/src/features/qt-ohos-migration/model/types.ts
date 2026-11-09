/**
 * View-model types for the qt-harmonyos-migration progress panel.
 *
 * The skill persists its state in `<container>/migration/ohos/` (STATE.md + TSV
 * ledgers). These types describe the parsed ledgers and the derived snapshot
 * rendered by `MigrationProgressPanel`. The panel is strictly read-only.
 */

export type MigrationPhaseId =
  | 'environment'
  | 'inventory'
  | 'decisions'
  | 'tasks'
  | 'features'
  | 'diagnostics'
  | 'validation';

/** Normalized status used for icons, colors and `data-bitfun-status`. */
export type MigrationStatus =
  | 'done'
  | 'doing'
  | 'ready'
  | 'pending'
  | 'blocked'
  | 'error'
  | 'unknown';

/**
 * `completed`: the migration ended and the application HAP ran on a device (device-runs.tsv `run`);
 * `ended`: the migration ended without that proof (no device, or the HAP never ran) — not shown as done.
 */
export type MigrationLiveStatus = 'active' | 'blocked' | 'completed' | 'ended' | 'idle';

export type LedgerRow = Record<string, string>;

export interface ParsedTsv {
  header: string[];
  rows: LedgerRow[];
  missingColumns: string[];
  extraColumns: string[];
}

export type MigrationGateVerdict = 'ready' | 'not-ready';

/** A phase's latest gate verdict: the Gate cell of its STATE.md Progress row. */
export interface MigrationGateResult {
  phase: MigrationPhaseId;
  verdict: MigrationGateVerdict;
  /** Epoch ms when the verdict was produced, when known. */
  at?: number;
  /** The first unmet condition (STATE.md keeps only that one; `unmetCount` has the total). */
  unmet: string[];
  unmetCount: number;
  /** `validate_ledgers.py` reported INVALID ledgers (never counted as passed). */
  invalid?: boolean;
}

export interface StateGate {
  assessment?: string;
  currentPhase?: string;
  completionTier?: string;
  nextExecutableAction?: string;
}

export interface StateProgressRow {
  phase: string;
  phaseId?: MigrationPhaseId;
  status: string;
  /** The Gate column, written by the gate scripts. */
  gate?: MigrationGateResult;
}

/** STATE.md "Scope and target" table (what the porting contract used to hold). */
export interface StateScope {
  /** Application target: the TARGET name of the authoritative build file (library `lib<target>.so`). */
  target?: string;
  /** Qt source root (the ledger lives in the output container, not in the sources). */
  source?: string;
  /** HarmonyOS output project (a subdirectory of the output container, next to `migration/`). */
  outputProject?: string;
  /** Source revision (and dirty paths) at the start of the migration. */
  revision?: string;
}

/** STATE.md keeps only what no ledger holds: the scope, the gate fields and the Progress status per phase. */
export interface ParsedStateMd {
  scope: StateScope;
  gate: StateGate;
  progress: StateProgressRow[];
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
  /** Script currently executed by the agent, from tool events. */
  activeAction?: string;
  /** Whether the skill was invoked in the current app run. */
  skillInvoked?: boolean;
  /** The migration agent session is currently running (PROCESSING / FINISHING). */
  sessionRunning?: boolean;
  /** Metadata of the external feature packages referenced by features.tsv, by package_path. */
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

export type FeatureGateVerdict = 'ready' | 'not-ready';

/** Parsed `entry_gate` (last entry verdict) / `exit_gate` (last failed exit attempt) column of features.tsv. */
export interface FeatureGateView {
  verdict: FeatureGateVerdict;
  raw: string;
  at?: number;
  unmetCount?: number;
  firstUnmet?: string;
  /** Entry gate re-entered with `--restart`. */
  restart?: boolean;
}

export type FeatureMilestoneState = 'done' | 'current' | 'pending';

export interface FeatureMilestoneView {
  label: string;
  state: FeatureMilestoneState;
}

/** When the user gave an answer recorded in a FEAT row's notes. */
export type FeatureAnswerContext = 'activate' | 'retry' | 'close';

/** One `user answer: …` entry of a FEAT row's `notes` (written by feature_hooks.py / feature_gate.py). */
export interface FeatureAnswerView {
  context: FeatureAnswerContext;
  text: string;
  /** `closed <status>` entries: the status the feature was closed with. */
  status?: string;
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
  /** The user's answers about this feature (selection, retry, close), oldest first. */
  answers: FeatureAnswerView[];
  notes?: string;
  /** Package metadata could be read. */
  packageResolved: boolean;
  playbookPath?: string;
  workdir?: string;
  files: FeatureWorkdirFile[];
}

export interface PhaseItemView {
  id: string;
  label: string;
  status: MigrationStatus;
  rawStatus: string;
  detail?: string;
  /**
   * Decision rows only: nobody answered in time and the runtime chose the
   * recommended option (`owner=agent-default`).
   */
  decidedByAgent?: boolean;
  /** Short labels shown next to the row (e.g. inventory `found_by` sources). */
  tags?: string[];
  /** Tooltip of the version (environment: the item's path). */
  hint?: string;
  /**
   * A finding shown on its own line under the row (environment `issue`):
   * `warning` = `warn`, usable but risky (does not block the gate); `fixed` =
   * env_probe found the problem and repaired it; `error` = `error`/`missing`.
   */
  notice?: { tone: 'warning' | 'fixed' | 'error'; text: string };
}

/**
 * A one-line fact a phase card shows above its rows. `problems`: open / blocked
 * / fixed counts of diagnostics.tsv; the rest is the device-runs.tsv status of
 * the application HAP: `deviceRun` (run), `noDevice` (no-device: no connected
 * device, no run required), `hapChecked` (checked: not run yet), `hapFailed`
 * (hap-failed) and `noHap` (no row yet).
 */
export interface PhaseNoteView {
  kind: 'problems' | 'deviceRun' | 'noDevice' | 'hapChecked' | 'hapFailed' | 'noHap';
  tone: 'neutral' | 'success' | 'warning' | 'error';
  values?: Record<string, number>;
}

export interface PhaseView {
  id: MigrationPhaseId;
  /** File name of the phase's own ledger (one ledger per phase). */
  ledger: string;
  /** Absolute path of that ledger when it exists. */
  ledgerPath?: string;
  /** STATE.md Progress status of the phase (`unknown` without a Progress row). */
  status: MigrationStatus;
  rawStatus?: string;
  done: number;
  total: number;
  items: PhaseItemView[];
  /** Phase facts shown above the rows (diagnostics: problem counts and the latest device run). */
  notes?: PhaseNoteView[];
  /** Latest gate verdict of this phase (its STATE.md Progress Gate cell). */
  gate?: MigrationGateResult;
  /**
   * `doing` while no agent is working on it: render statically, not as a
   * spinner — a spinner reads as "the agent is running".
   */
  paused?: boolean;
}

/**
 * A question nobody answered in time, so the runtime chose the recommended
 * option (`owner=agent-default`). Shown so the user can see and overrule it.
 */
export interface AgentDecisionView {
  id: string;
  question: string;
  answer?: string;
}

/** One problem of `diagnostics.tsv` (one row per problem; passing batches write nothing). */
export interface DiagnosticView {
  id: string;
  /** Pipeline stage: the part of `location` before ':' (vocab.STAGES). */
  stage: string;
  /** The rest of `location`: step, file:line or component. */
  where: string;
  symptom: string;
  cause: string;
  fix: string;
  /** `open` → error, `blocked` → blocked, `fixed` → done. */
  status: MigrationStatus;
  rawStatus: string;
  /** Not fixed yet (open). */
  open: boolean;
  /** Open without a cause: the next batch refuses to start until it is written. */
  needsCause: boolean;
  /** Command and cwd of `reproduce` (before `; log:`). */
  reproduce: string;
  /** Only set when `reproduce` names a text log the editor can open. */
  logPath?: string;
}

/** The one `device-runs.tsv` row: the application HAP's latest result. */
export interface DeviceRunView {
  id: string;
  hap: string;
  /** hap-failed | checked | no-device | run (`DEVICE_RUN_STATUSES`). */
  status: string;
  evidence: string;
}

/**
 * A migration document (report.md, STATE.md), a supporting ledger shared by
 * several phases (device-runs.tsv) or the deliverable (the application HAP of
 * device-runs.tsv once it passed hap_check.py).
 */
export interface DocumentRefView {
  id: string;
  kind: 'document' | 'ledger' | 'artifact';
  label: string;
  /** What a click opens; empty for an artifact (a binary file). */
  path: string;
  /** Data rows of a ledger. */
  rows?: number;
  /** Artifacts: the file path. */
  target?: string;
}

export interface MigrationHeaderView {
  project?: string;
  /** STATE.md Scope table. */
  scope: StateScope;
  revision?: string;
  currentPhase?: MigrationPhaseId;
  currentPhaseRaw?: string;
  nextAction?: string;
  activeAction?: string;
  overallPercent: number;
  liveStatus: MigrationLiveStatus;
  lastWriteAt?: number;
  /** Migration has ended (completed or ended) but the validation gate's last verdict is NOT-READY. */
  completedGateNotReady?: MigrationGateResult;
}

export interface MigrationSnapshot {
  ledgerRoot: string;
  appRoot: string;
  header: MigrationHeaderView;
  /** Decisions the agent made for the user after a question went unanswered. */
  decisionsByAgent: AgentDecisionView[];
  phases: PhaseView[];
  diagnostics: DiagnosticView[];
  /** The application HAP's latest result (device-runs.tsv), if a HAP was checked yet. */
  deviceRun?: DeviceRunView;
  /** External features activated through the hook mechanism (features.tsv). */
  externalFeatures: ExternalFeatureView[];
  documents: DocumentRefView[];
  skillInvoked: boolean;
  /** Ledgers whose header is not the current skill's (an older migration): `file: detail`. */
  schemaWarnings: string[];
}
