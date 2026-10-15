/**
 * External features (skill hook mechanism) → panel view-model.
 *
 * A feature is a FEAT row of `feature-adoption.tsv`, written only by the
 * skill's `feature_hooks.py` / `feature_gate.py`. The view is generic: it uses
 * the row's lifecycle columns (status, attempts, current_step, entry/exit gate)
 * and, when the feature package can be read, the display metadata of its
 * `hook.json` (title, milestones, max_attempts). Nothing here depends on a
 * particular feature.
 */

import {
  EXTERNAL_FEATURES_SCOPE,
  MIGRATION_PHASES,
  hasLegacyHeader,
  isBootstrapId,
  isPlaceholder,
  normalizeStatus,
} from '../model/ledgerSchema';
import type {
  ExternalFeatureView,
  FeatureGateView,
  FeatureLinkView,
  FeatureMilestoneView,
  FeaturePackageInfo,
  FeatureSelectionView,
  LedgerRow,
  MigrationLedgerInput,
  MigrationPhaseId,
} from '../model/types';

export const ADOPTION_LEDGER = 'feature-adoption.tsv';
/** Same as `feature_predicates.DEFAULT_MAX_ATTEMPTS`. */
export const DEFAULT_FEATURE_MAX_ATTEMPTS = 3;

/** Ledgers searched for ids listed in `capability_ids` / `validation_ids`, in order. */
const LINK_LEDGERS = ['work-queue.tsv', 'inventory.tsv', 'validation.tsv', 'device-runs.tsv', 'decisions.tsv', 'diagnostics.tsv'];

function clean(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  return isPlaceholder(text) ? '' : text;
}

function splitIds(raw: string | undefined): string[] {
  return (raw ?? '').split(/[,;\s]+/).map((entry) => entry.trim()).filter((entry) => entry && !isPlaceholder(entry));
}

export function packageKey(path: string | undefined): string {
  return (path ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

function parseTime(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : undefined;
}

const GATE_RE = /^(READY|BLOCKED)\s+@(\S+)(.*)$/i;
const CLOSED_RE = /^CLOSED\s+(\S+)(?:\s+by\s+(\S+))?(?:\s+@(\S+))?/i;
const UNMET_RE = /\((\d+)\s+unmet:\s*(.*)\)\s*$/i;

/**
 * Parse an `entry_gate` / `exit_gate` cell:
 * `READY @<iso>[ restart| digest=…]`, `BLOCKED @<iso> (N unmet: first)` or
 * `CLOSED <status> by DEC-x @<iso>`.
 */
export function parseFeatureGate(raw: string | undefined): FeatureGateView | undefined {
  const text = (raw ?? '').trim();
  if (!text || isPlaceholder(text)) return undefined;
  const closed = text.match(CLOSED_RE);
  if (closed) {
    return {
      verdict: 'closed',
      raw: text,
      closedStatus: closed[1],
      closedBy: closed[2],
      at: parseTime(closed[3]),
    };
  }
  const gate = text.match(GATE_RE);
  if (!gate) return undefined;
  const rest = gate[3] ?? '';
  const unmet = rest.match(UNMET_RE);
  return {
    verdict: gate[1].toUpperCase() === 'READY' ? 'ready' : 'blocked',
    raw: text,
    at: parseTime(gate[2]),
    unmetCount: unmet ? Number.parseInt(unmet[1], 10) : undefined,
    firstUnmet: unmet ? unmet[2].trim() || undefined : undefined,
    restart: /\brestart\b/i.test(rest) || undefined,
  };
}

function comparable(text: string): string {
  return text.toLowerCase().replace(/[\s\p{P}]+/gu, '');
}

/**
 * Index of the milestone named by `current_step`. The step is free text written
 * by the agent (`feature_hooks.py progress --step`), so besides an exact match
 * it may contain the milestone, be a shortened form of it, or be its number.
 */
export function matchMilestone(milestones: readonly string[], step: string | undefined): number {
  const text = (step ?? '').trim();
  if (!text || milestones.length === 0) return -1;
  const numbered = text.match(/^(?:step\s*)?(\d+)\s*(?:[/／]\s*\d+)?\s*$/i);
  if (numbered) {
    const index = Number.parseInt(numbered[1], 10) - 1;
    return index >= 0 && index < milestones.length ? index : -1;
  }
  const key = comparable(text);
  if (!key) return -1;
  const keys = milestones.map(comparable);
  const exact = keys.indexOf(key);
  if (exact >= 0) return exact;
  // Longest milestone contained in the step wins ("3/4 Integrate: dark mode" -> "Integrate").
  let best = -1;
  keys.forEach((candidate, index) => {
    if (candidate && key.includes(candidate) && (best < 0 || candidate.length > keys[best].length)) best = index;
  });
  if (best >= 0) return best;
  if (key.length >= 2) return keys.findIndex((candidate) => candidate.includes(key));
  return -1;
}

function milestoneViews(milestones: readonly string[], rawStatus: string, step: string | undefined): {
  views: FeatureMilestoneView[];
  matched: boolean;
} {
  const status = rawStatus.trim().toLowerCase();
  if (status === 'passed' || status === 'verified') {
    return { views: milestones.map((label) => ({ label, state: 'done' })), matched: false };
  }
  const index = status === 'in-progress' ? matchMilestone(milestones, step) : -1;
  return {
    views: milestones.map((label, position) => ({
      label,
      state: index < 0 ? 'pending' : position < index ? 'done' : position === index ? 'current' : 'pending',
    })),
    matched: index >= 0,
  };
}

function hostPhaseOf(raw: string): MigrationPhaseId | undefined {
  const text = raw.trim().toLowerCase();
  return MIGRATION_PHASES.find((phase) => phase === text);
}

function findPackage(
  packages: Record<string, FeaturePackageInfo> | undefined,
  row: LedgerRow,
): FeaturePackageInfo | undefined {
  if (!packages) return undefined;
  const byPath = packages[packageKey(row.package_path)];
  if (byPath && clean(row.package_path)) return byPath;
  const featureId = clean(row.feature_id).toLowerCase();
  return featureId ? Object.values(packages).find((entry) => entry.featureId?.toLowerCase() === featureId) : undefined;
}

function linkIndex(input: MigrationLedgerInput): Map<string, FeatureLinkView> {
  const index = new Map<string, FeatureLinkView>();
  for (const ledger of LINK_LEDGERS) {
    for (const row of input.tsv[ledger]?.rows ?? []) {
      const id = (row.id ?? '').trim();
      if (!id || index.has(id)) continue;
      index.set(id, { id, ledger, status: normalizeStatus(row.status), rawStatus: row.status ?? '' });
    }
  }
  return index;
}

/** Rows that stand for an external feature (template placeholders and legacy "none" rows excluded). */
export function featureRows(input: MigrationLedgerInput): LedgerRow[] {
  return (input.tsv[ADOPTION_LEDGER]?.rows ?? []).filter((row) => {
    const id = (row.id ?? '').trim();
    if (!id || isBootstrapId(id) || isPlaceholder(id) || !clean(row.feature_id)) return false;
    return (row.status ?? '').trim().toLowerCase() !== 'not-applicable';
  });
}

/** Host phase of a FEAT row: `host_phase`, else the package's hook, else `features`. */
export function featureHostPhase(row: LedgerRow, input: MigrationLedgerInput): MigrationPhaseId {
  return hostPhaseOf(row.host_phase ?? '')
    ?? hostPhaseOf(findPackage(input.featurePackages, row)?.hookPhase ?? '')
    ?? 'features';
}

export function featureTitle(row: LedgerRow, input: MigrationLedgerInput): string {
  return findPackage(input.featurePackages, row)?.title || clean(row.feature_id) || row.id;
}

// Same rules as the skill's phase_gate.USER_EVIDENCE_RE / NON_ANSWER_RE.
const USER_EVIDENCE_RE = /\buser:\s*\S/i;
const NON_ANSWER_TERMS =
  'time[sd]?[ -]?out|timeout|expired|no (?:response|answer|reply|input)|unanswered|skipp?(?:ed|ing)?'
  + '|超时|未回复|未回答|未作答|没有回复|没有回答|无响应|未响应|无回复';
const NON_ANSWER_RE = new RegExp(
  `(?:askuserquestion|question|prompt|ask(?:ed|ing)?\\b|询问|提问|问题|弹窗)[^.;。；\\n]{0,60}(?:${NON_ANSWER_TERMS})`
  + '|(?:user|用户)\\s*(?:did ?n[o\']t|never|has ?n[o\']t|未|没有|没)\\s*(?:respond|answer|reply|select|choose|回复|回答|作答|选择|响应)'
  + '|no (?:response|answer|reply|input) from (?:the )?user|without (?:a |any )?(?:user )?(?:response|answer|reply|input)'
  + '|skip[- ]and[- ]continue|(?:skill|tool|agent)[\'’]?s? default (?:is|=|applies|applied|used)',
  'i',
);

/** The evidence records a question the user never answered. */
export function isUnansweredEvidence(evidence: string | undefined): boolean {
  return NON_ANSWER_RE.test(evidence ?? '');
}

/** Newest `external-features` decision (the one the skill's gate uses). */
export function buildFeatureSelection(input: MigrationLedgerInput): FeatureSelectionView | undefined {
  const rows = (input.tsv['decisions.tsv']?.rows ?? []).filter((row) =>
    (row.feature_or_scope ?? '').trim().toLowerCase() === EXTERNAL_FEATURES_SCOPE && !isBootstrapId((row.id ?? '').trim()));
  const row = rows[rows.length - 1];
  if (!row) return undefined;
  const evidence = (row.evidence ?? '').trim();
  const unanswered = isUnansweredEvidence(evidence);
  const confirmed = (row.status ?? '').trim().toLowerCase() === 'approved'
    && (row.owner ?? '').trim().toLowerCase() === 'user'
    && USER_EVIDENCE_RE.test(evidence)
    && !unanswered;
  const selected = (row.selected ?? '').split(/[,;\s]+/).map((entry) => entry.trim())
    .filter((entry) => entry && entry.toLowerCase() !== 'none' && !isPlaceholder(entry));
  return { decisionId: (row.id ?? '').trim(), selected, confirmed, unanswered, evidence: evidence || undefined };
}

export function buildExternalFeatures(input: MigrationLedgerInput, working: boolean): ExternalFeatureView[] {
  const parsed = input.tsv[ADOPTION_LEDGER];
  if (!parsed) return [];
  const legacyLedger = !parsed.header.includes('host_phase') && hasLegacyHeader(ADOPTION_LEDGER, parsed.header);
  const links = linkIndex(input);

  return featureRows(input).map((row): ExternalFeatureView => {
    const pkg = findPackage(input.featurePackages, row);
    const rawStatus = (row.status ?? '').trim();
    const status = normalizeStatus(rawStatus);
    const currentStep = clean(row.current_step) || undefined;
    const milestones = milestoneViews(pkg?.milestones ?? [], rawStatus, currentStep);
    const attempts = Number.parseInt(row.attempts ?? '', 10);
    const hostPhaseRaw = clean(row.host_phase) || pkg?.hookPhase || undefined;
    const workdir = input.featureWorkdirs?.[row.id.trim()];
    const ids = [...splitIds(row.capability_ids), ...splitIds(row.validation_ids)];
    return {
      id: row.id.trim(),
      featureId: clean(row.feature_id),
      title: pkg?.title || clean(row.feature_id) || row.id,
      summary: pkg?.summary || undefined,
      kind: clean(row.kind) || pkg?.kind || undefined,
      version: pkg?.version || undefined,
      hostPhase: hostPhaseOf(hostPhaseRaw ?? '') ?? (legacyLedger ? 'features' : undefined),
      hostPhaseRaw,
      status,
      rawStatus,
      running: status === 'doing' && working,
      attempts: Number.isFinite(attempts) && attempts > 0 ? attempts : 0,
      maxAttempts: pkg?.maxAttempts ?? (pkg ? DEFAULT_FEATURE_MAX_ATTEMPTS : undefined),
      currentStep,
      milestones: milestones.views,
      stepMatched: milestones.matched,
      entryGate: parseFeatureGate(row.entry_gate),
      exitGate: parseFeatureGate(row.exit_gate),
      decisionId: clean(row.decision_id) || undefined,
      links: [...new Set(ids)].map((id) => links.get(id) ?? { id, status: 'pending', rawStatus: '' }),
      notes: clean(row.notes) || undefined,
      evidence: clean(row.evidence) || undefined,
      packageResolved: !!pkg,
      playbookPath: pkg?.playbookPath,
      workdir: workdir?.path,
      files: workdir?.files ?? [],
      legacy: legacyLedger || (!clean(row.host_phase) && !!clean(row.playbook_path)),
    };
  });
}
