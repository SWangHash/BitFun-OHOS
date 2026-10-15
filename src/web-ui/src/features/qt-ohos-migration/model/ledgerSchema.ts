/**
 * Ledger contract of the qt-harmonyos-migration skill.
 *
 * Mirrors `assets/templates/migration/ohos/*` and `scripts/phase_gate.py` of the
 * built-in skill. Keep these constants aligned when the skill evolves; the
 * parser reports missing/extra columns instead of failing.
 */

import type { MigrationPhaseId, MigrationStatus } from './types';

export const MIGRATION_SKILL_NAME = 'qt-harmonyos-migration';

/** Relative location of the ledgers under an application root. */
export const LEDGER_DIR_SEGMENTS = ['migration', 'ohos'] as const;

export const MIGRATION_PHASES: readonly MigrationPhaseId[] = [
  'baseline',
  'inventory',
  'contract',
  'pilot',
  'implementation',
  'features',
  'diagnostics',
  'handoff',
];

/** The one ledger that records each phase's progress (skill SKILL.md section 2). */
export const PHASE_LEDGERS: Readonly<Record<MigrationPhaseId, string>> = {
  baseline: 'environment.tsv',
  inventory: 'inventory.tsv',
  contract: 'decisions.tsv',
  pilot: 'pilot.tsv',
  implementation: 'work-queue.tsv',
  features: 'feature-adoption.tsv',
  diagnostics: 'diagnostics.tsv',
  handoff: 'validation.tsv',
};

/** Ledgers shared by several phases; listed under references. */
export const SUPPORTING_LEDGERS = ['baseline.tsv', 'package-manifest.tsv', 'device-runs.tsv'] as const;

export const LEDGER_TSV_HEADERS: Record<string, readonly string[]> = {
  'environment.tsv': ['id', 'category', 'name', 'value', 'version_or_revision', 'source_or_path', 'status', 'last_verified_at', 'evidence'],
  'baseline.tsv': ['id', 'kind', 'platform', 'revision', 'command_or_scenario', 'exit_code', 'result', 'status', 'evidence', 'run_at'],
  'inventory.tsv': ['id', 'category', 'source_location', 'source_kind', 'current_behavior', 'ohos_constraint', 'prerequisites', 'scan_scope', 'scan_evidence', 'disposition', 'target_behavior', 'files', 'risk', 'status', 'evidence', 'validation_id'],
  'work-queue.tsv': ['id', 'capability', 'category', 'prerequisites', 'inputs', 'owner', 'status', 'attempts', 'next_action', 'change_refs', 'change_hashes', 'evidence', 'validation_ids'],
  'decisions.tsv': ['id', 'phase', 'question', 'options', 'selected', 'impact', 'owner', 'approved_at', 'feature_or_scope', 'affected_ids', 'status', 'evidence'],
  'diagnostics.tsv': ['id', 'build_or_device_run_id', 'phase', 'category', 'first_causal_signature', 'root_cause', 'attempts', 'command', 'tree_or_environment_hash', 'log_path', 'fix_or_next_action', 'affected_ids', 'evidence', 'status', 'recurrence'],
  'pilot.tsv': ['id', 'build_or_device_run_id', 'phase', 'category', 'first_causal_signature', 'root_cause', 'attempts', 'command', 'tree_or_environment_hash', 'log_path', 'fix_or_next_action', 'affected_ids', 'evidence', 'status', 'recurrence'],
  // External-feature hook rows (`scripts/feature_predicates.py` ADOPTION_FIELDS).
  'feature-adoption.tsv': ['id', 'feature_id', 'kind', 'host_phase', 'package_path', 'package_sha256', 'decision_id', 'status', 'attempts', 'current_step', 'entry_gate', 'exit_gate', 'source_fingerprint', 'capability_ids', 'validation_ids', 'notes', 'evidence'],
  'package-manifest.tsv': ['id', 'package_revision', 'entry_path', 'artifact_type', 'origin', 'expected', 'present', 'sha256', 'abi', 'needed_or_plugin', 'contract_check', 'status', 'evidence'],
  'device-runs.tsv': ['id', 'device_class', 'redacted_device', 'package_revision', 'install_result', 'launch_result', 'process_result', 'ui_or_render_result', 'log_result', 'scenario_ids', 'status', 'evidence', 'run_at'],
  'validation.tsv': ['id', 'scenario', 'platform', 'command_or_steps', 'expected', 'result', 'status', 'reviewer', 'negative_control', 'evidence'],
  'knowledge-manifest.tsv': ['baseline_manifest_sha256', 'source_revision', 'source_path', 'source_sha256', 'skill_snapshot_path', 'skill_snapshot_sha256', 'snapshot_path', 'snapshot_sha256', 'used', 'modified', 'action', 'last_synced_at'],
};

/**
 * Columns newer skill templates append. They are not required, so ledgers
 * created before the column existed do not raise schema warnings.
 */
export const LEDGER_TSV_OPTIONAL_HEADERS: Record<string, readonly string[]> = {
  'work-queue.tsv': ['inventory_ids'],
};

/**
 * Older headers the skill still reads (ledgers created before a schema
 * change). A ledger that carries every legacy column raises no schema warning.
 */
export const LEDGER_TSV_LEGACY_HEADERS: Record<string, readonly string[]> = {
  'feature-adoption.tsv': ['id', 'feature_id', 'playbook_path', 'playbook_sha256', 'status', 'capability_ids', 'validation_ids', 'decision_id', 'notes', 'evidence'],
};

export function hasLegacyHeader(file: string, header: readonly string[]): boolean {
  const legacy = LEDGER_TSV_LEGACY_HEADERS[file];
  return !!legacy && legacy.every((column) => header.includes(column));
}

/** `decisions.tsv` scope of the user's external-feature selection. */
export const EXTERNAL_FEATURES_SCOPE = 'external-features';
/** Phases an external feature may hook into (`feature_hooks.HOOK_POINTS`). */
export const FEATURE_HOOK_PHASES: readonly MigrationPhaseId[] = ['features', 'handoff'];
/** Feature packages live in the skill's `features/` directory. */
export const FEATURE_REGISTRY_FILE = 'registry.tsv';
export const FEATURE_HOOK_FILE = 'hook.json';
/** Private per-feature work directory: `<migration root>/features/<FEAT id>/`. */
export const FEATURE_WORKDIR_SEGMENT = 'features';

export const LEDGER_TSV_FILES = Object.keys(LEDGER_TSV_HEADERS);

export const LEDGER_DOCUMENT_FILES = ['STATE.md', 'assessment.md', 'PORTING_CONTRACT.md', 'report.md'] as const;

export const ALL_LEDGER_FILES: readonly string[] = [...LEDGER_DOCUMENT_FILES, ...LEDGER_TSV_FILES];

/** Knowledge-manifest actions that mean the page is not part of this run. */
export const INACTIVE_KNOWLEDGE_ACTIONS = new Set([
  'source-removed',
  'not-selected',
  'retired-from-skill-baseline',
  'excluded-by-policy',
]);

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
  'queue_status.py',
  'phase_gate.py',
  'ledger_query.py',
  'scan_qt_api_gap.py',
  'gate_state.py',
  'next_step.py',
  // External feature hooks.
  'feature_hooks.py',
  'feature_gate.py',
  'feature_register.py',
  // Dependency inventory tool shipped in upstream-kb/knowledge/portgraph/.
  'portgraph.py',
] as const;

/** Rows created by `init_migration.py` as receipts, not application evidence. */
export function isBootstrapId(id: string | undefined): boolean {
  return (id ?? '').toUpperCase().includes('-BOOT-');
}

/** Same notion as `phase_gate.non_placeholder`. */
export function isPlaceholder(value: string | undefined): boolean {
  const text = (value ?? '').trim().replace(/^`|`$/g, '').trim().toLowerCase();
  return !text || ['todo', 'tbd', 'n/a', 'none', 'unknown', 'unclassified', '-'].includes(text);
}

const DONE_STATUSES = new Set([
  'passed', 'verified', 'accepted', 'accepted-limitation', 'not-applicable', 'resolved',
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

/** STATE.md progress-table labels → gate phases. */
export function phaseIdFromLabel(label: string | undefined): MigrationPhaseId | undefined {
  const text = (label ?? '').toLowerCase();
  if (!text || isPlaceholder(text)) return undefined;
  // Current templates name the phase id in backticks: "Pilot verification (`pilot`, pilot.tsv)".
  for (const match of text.matchAll(/`([a-z]+)`/g)) {
    const id = MIGRATION_PHASES.find((phase) => phase === match[1]);
    if (id) return id;
  }
  if (/environment/.test(text)) return 'baseline';
  if (/baseline|kb snapshot|knowledge/.test(text)) return 'baseline';
  if (/inventory|compatib/.test(text)) return 'inventory';
  if (/contract|feasib|assessment/.test(text)) return 'contract';
  if (/pilot/.test(text)) return 'pilot';
  if (/harmonyos feature|feature adapt|feature adoption/.test(text)) return 'features';
  if (/capability|queue|implement|slice/.test(text)) return 'implementation';
  if (/diagnos/.test(text)) return 'diagnostics';
  if (/handoff|verification|validat|deliver/.test(text)) return 'handoff';
  return undefined;
}
