/**
 * Ledger contract of the ohos-qt-skills skill.
 *
 * Mirrors `assets/templates/migration/ohos/*` and `scripts/phase_gate.py` of the
 * built-in skill. Keep these constants aligned when the skill evolves; the
 * parser reports missing/extra columns instead of failing.
 */

import type { LedgerRow, MigrationPhaseId, MigrationStatus } from './types';

/** Name (and install directory) of the built-in migration skill. */
export const MIGRATION_SKILL_NAME = 'ohos-qt-skills';

/** Relative location of the ledgers under an application root. */
export const LEDGER_DIR_SEGMENTS = ['migration', 'ohos'] as const;

/**
 * Gate order of `phase_gate.PHASES`. Phases 1-5 are the base Qt migration;
 * `features` (selection, activation and capability features) only opens after
 * `diagnostics`, and `validation` also runs the selected verification features.
 * Mirrors the skill's `scripts/vocab.py` PHASES.
 */
export const MIGRATION_PHASES: readonly MigrationPhaseId[] = [
  'environment',
  'inventory',
  'decisions',
  'tasks',
  'diagnostics',
  'features',
  'validation',
];

/** The one ledger that records each phase's progress (skill SKILL.md section 2). */
export const PHASE_LEDGERS: Readonly<Record<MigrationPhaseId, string>> = {
  environment: 'environment.tsv',
  inventory: 'inventory.tsv',
  decisions: 'decisions.tsv',
  tasks: 'tasks.tsv',
  diagnostics: 'diagnostics.tsv',
  features: 'features.tsv',
  validation: 'validation.tsv',
};

/** Ledgers shared by several phases; listed under references. */
export const SUPPORTING_LEDGERS = ['device-runs.tsv'] as const;

/**
 * Column order of every ledger, as in the skill's `assets/templates/migration/ohos/`
 * (meanings: `assets/ledger-columns.tsv`). A ledger whose header differs was
 * written by an older skill: the skill refuses it, and so does the panel (it is
 * reported, not partially rendered).
 */
export const LEDGER_TSV_HEADERS: Record<string, readonly string[]> = {
  // One row per environment item, written only by env_probe.py.
  'environment.tsv': ['id', 'item', 'path', 'version', 'detail', 'status', 'issue', 'command_env'],
  'inventory.tsv': ['id', 'category', 'location', 'cause', 'found_by', 'disposition', 'target_behavior'],
  // A plain question/answer store; owner: user | agent-default, empty until answered.
  'decisions.tsv': ['id', 'question', 'answer', 'owner'],
  'tasks.tsv': ['id', 'task', 'inventory_ids', 'validation_ids', 'status', 'evidence'],
  // One row per problem; location is "<stage>: <detail>"; status open | fixed | blocked.
  'diagnostics.tsv': ['id', 'location', 'symptom', 'cause', 'reproduce', 'fix', 'status'],
  // External-feature hook rows (`scripts/feature_predicates.py` ADOPTION_FIELDS); the user's
  // answers about a feature are in `notes`, it links to no other ledger.
  // The host phase follows from kind (capability: features, verification: validation); the package is the
  // registry.tsv package_path of feature_id. exit_gate holds the last failed exit attempt (empty after a first-try pass).
  'features.tsv': ['id', 'feature_id', 'kind', 'status', 'attempts', 'current_step', 'entry_gate', 'exit_gate', 'notes'],
  // One row, the application HAP's latest result (batch_checks.py hap_check.py step, device_run.py --record).
  'device-runs.tsv': ['id', 'hap', 'status', 'evidence'],
  'validation.tsv': ['id', 'scenario', 'steps', 'expected', 'status', 'evidence'],
};

/** Pipeline stages a diagnostics `location` starts with (`vocab.STAGES`). */
export const DIAGNOSTIC_STAGES = ['environment', 'configure', 'build', 'deploy', 'package', 'sign', 'device', 'manual'] as const;
/** `decisions.tsv` owner of an answer the runtime chose because nobody answered in time. */
export const AGENT_DEFAULT_OWNER = 'agent-default';
/** Phases an external feature may hook into (`feature_hooks.HOOK_POINTS`). */
export const FEATURE_HOOK_PHASES: readonly MigrationPhaseId[] = ['features', 'validation'];
/** Feature packages live in the skill's `features/` directory. */
export const FEATURE_REGISTRY_FILE = 'registry.tsv';
export const FEATURE_HOOK_FILE = 'hook.json';
/** Private per-feature work directory: `<migration root>/features/<FEAT id>/`. */
export const FEATURE_WORKDIR_SEGMENT = 'features';

export const LEDGER_TSV_FILES = Object.keys(LEDGER_TSV_HEADERS);

/** Documents keep only what no ledger holds (the porting contract became STATE.md's Scope table). */
export const LEDGER_DOCUMENT_FILES = ['STATE.md', 'report.md'] as const;
/**
 * `device-runs.tsv` status (`vocab.DEVICE_RUN_STATUSES`): hap-failed (hap_check.py failed), checked
 * (passed, not run yet), no-device (passed, no connected device), run (passed on the device).
 * `run` and `no-device` satisfy the gates (`vocab.DEVICE_RUN_DONE`).
 */
export const DEVICE_RUN_STATUSES = ['hap-failed', 'checked', 'no-device', 'run'] as const;
export const DEVICE_RUN_DONE: ReadonlySet<string> = new Set(['run', 'no-device']);

export const ALL_LEDGER_FILES: readonly string[] = [...LEDGER_DOCUMENT_FILES, ...LEDGER_TSV_FILES];

/** A ledger written with another column layout (an older skill version). */
export function isLegacyLayout(parsed: { header: string[]; missingColumns: string[]; extraColumns: string[] } | undefined): boolean {
  return !!parsed && parsed.header.length > 0 && (parsed.missingColumns.length > 0 || parsed.extraColumns.length > 0);
}

/**
 * Paths inside the skill itself (install directory or shipped templates). They
 * contain a `migration/ohos/STATE.md` template that must never be mistaken for
 * an application ledger.
 */
export function isSkillAssetPath(path: string | undefined): boolean {
  const text = path ?? '';
  return /[\\/]assets[\\/]templates(?:[\\/]|$)/i.test(text)
    || /[\\/]skills[\\/]\.system(?:[\\/]|$)/i.test(text)
    || /[\\/]builtin_skills(?:[\\/]|$)/i.test(text)
    || new RegExp(`[\\\\/]${MIGRATION_SKILL_NAME}[\\\\/](?:assets|scripts|references|features|agents|upstream-kb)(?:[\\\\/]|$)`, 'i').test(text);
}

/** Scripts whose execution indicates an active migration step. */
export const MIGRATION_SCRIPT_NAMES = [
  'init_migration.py',
  'validate_ledgers.py',
  'batch_checks.py',
  'record_diagnostic.py',
  'sync_knowledge.py',
  'mark_knowledge_used.py',
  'phase_gate.py',
  'scan_qt_api_gap.py',
  'gate_state.py',
  'next_step.py',
  // Environment, build and preflight tooling.
  'env_probe.py',
  'env_smoke.py',
  'hvigor_build.py',
  'template_patch.py',
  'hap_check.py',
  'deploy_qt_libs.py',
  'device_run.py',
  'preflight_build_files.py',
  'closure.py',
  'ledger.py',
  'known_issues.py',
  // External feature hooks.
  'feature_hooks.py',
  'feature_gate.py',
  'feature_register.py',
  // Dependency inventory tool shipped in upstream-kb/knowledge/portgraph/.
  'portgraph.py',
] as const;

/** Same notion as `phase_gate.non_placeholder`. */
export function isPlaceholder(value: string | undefined): boolean {
  const text = (value ?? '').trim().replace(/^`|`$/g, '').trim().toLowerCase();
  return !text || ['todo', 'tbd', 'n/a', 'none', 'unknown', 'unclassified', '-'].includes(text);
}

const DONE_STATUSES = new Set([
  'passed', 'verified', 'accepted', 'accepted-limitation', 'not-applicable', 'resolved', 'fixed',
  'done', 'complete', 'completed', 'approved', 'present', 'ok',
  // Explicitly waived work: the gate accepts it, so it no longer blocks progress.
  'skipped', 'waived', 'deferred-approved', 'degraded-approved',
]);
const DOING_STATUSES = new Set(['in-progress', 'in_progress', 'running', 'doing', 'active', 'started', 'implementing']);
const PENDING_STATUSES = new Set(['planned', 'not-run', 'pending', 'todo', 'open', 'proposed', 'queued']);
const BLOCKED_STATUSES = new Set(['blocked', 'deferred', 'escalated', 'needs-decision', 'waiting']);
const ERROR_STATUSES = new Set(['failed', 'fail', 'timeout', 'error', 'invalid', 'rejected-by-gate']);

export function normalizeStatus(raw: string | undefined): MigrationStatus {
  const value = (raw ?? '').trim().replace(/^`|`$/g, '').trim().toLowerCase();
  if (!value) return 'pending';
  if (DONE_STATUSES.has(value)) return 'done';
  if (DOING_STATUSES.has(value)) return 'doing';
  if (value === 'ready') return 'ready';
  if (PENDING_STATUSES.has(value)) return 'pending';
  if (BLOCKED_STATUSES.has(value)) return 'blocked';
  if (ERROR_STATUSES.has(value)) return 'error';
  return 'unknown';
}

/** A decisions.tsv answer; `none` is a real answer, only empty/TODO is unanswered. */
export function decisionAnswer(row: LedgerRow | undefined): string {
  const answer = (row?.answer ?? '').trim();
  return /^(todo|tbd)?$/i.test(answer) ? '' : answer;
}

/**
 * Status of one ledger row, by the rules of its ledger (the same word means
 * different things in different ledgers, e.g. diagnostics `open` is a problem).
 */
export function ledgerRowStatus(ledger: string, row: LedgerRow): MigrationStatus {
  const raw = (row.status ?? '').trim().replace(/^`|`$/g, '').trim().toLowerCase();
  switch (ledger) {
    case 'environment.tsv':
      // warn does not block the gate (e.g. no device); it is flagged separately.
      if (raw === 'ok' || raw === 'fixed' || raw === 'warn') return 'done';
      if (raw === 'error' || raw === 'missing') return 'error';
      return raw ? 'unknown' : 'pending';
    case 'decisions.tsv':
      return decisionAnswer(row) ? 'done' : 'pending';
    case 'diagnostics.tsv':
      // accepted-limitation: the user accepted the problem unfixed.
      if (raw === 'fixed' || raw === 'accepted-limitation') return 'done';
      if (raw === 'blocked') return 'blocked';
      if (raw === 'open') return 'error';
      return raw ? 'unknown' : 'error';
    case 'device-runs.tsv':
      if (DEVICE_RUN_DONE.has(raw)) return 'done';
      if (raw === 'checked') return 'pending';
      if (raw === 'hap-failed') return 'error';
      return raw ? 'unknown' : 'pending';
    default:
      return normalizeStatus(row.status);
  }
}

/** STATE.md progress-table labels → gate phases. */
export function phaseIdFromLabel(label: string | undefined): MigrationPhaseId | undefined {
  const text = (label ?? '').toLowerCase();
  if (!text || isPlaceholder(text)) return undefined;
  // The template names the phase id in backticks: "Tasks (`tasks`, tasks.tsv)"; each phase id is also
  // its ledger's name, so a label without backticks is matched by that word.
  for (const match of text.matchAll(/`([a-z]+)`/g)) {
    const id = MIGRATION_PHASES.find((phase) => phase === match[1]);
    if (id) return id;
  }
  if (/environment/.test(text)) return 'environment';
  if (/inventory/.test(text)) return 'inventory';
  if (/decision/.test(text)) return 'decisions';
  if (/feature/.test(text)) return 'features';
  if (/task/.test(text)) return 'tasks';
  if (/diagnos/.test(text)) return 'diagnostics';
  if (/validat/.test(text)) return 'validation';
  return undefined;
}
