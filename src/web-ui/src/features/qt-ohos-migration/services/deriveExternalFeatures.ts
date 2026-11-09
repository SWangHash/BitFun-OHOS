/**
 * External features (skill hook mechanism) → panel view-model.
 *
 * A feature is a FEAT row of `features.tsv`, written only by the
 * skill's `feature_hooks.py` / `feature_gate.py`. The view is generic: it uses
 * the row's lifecycle columns (status, attempts, current_step, entry/exit gate)
 * and, when the feature package can be read, the display metadata of its
 * `hook.json` (title, milestones, max_attempts). The user's answers about a
 * feature live in the row's `notes`; a FEAT row links to no other ledger.
 * Nothing here depends on a particular feature.
 */

import {
  MIGRATION_PHASES,
  isPlaceholder,
  normalizeStatus,
} from '../model/ledgerSchema';
import type {
  ExternalFeatureView,
  FeatureAnswerView,
  FeatureGateView,
  FeatureMilestoneView,
  FeaturePackageInfo,
  LedgerRow,
  MigrationLedgerInput,
  MigrationPhaseId,
} from '../model/types';

export const ADOPTION_LEDGER = 'features.tsv';
/** Same as `feature_predicates.DEFAULT_MAX_ATTEMPTS`. */
export const DEFAULT_FEATURE_MAX_ATTEMPTS = 3;

function clean(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  return isPlaceholder(text) ? '' : text;
}

export function packageKey(path: string | undefined): string {
  return (path ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').toLowerCase();
}

function parseTime(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : undefined;
}

const GATE_RE = /^(READY|NOT-READY)\s+@(\S+)(.*)$/i;
const UNMET_RE = /\((\d+)\s+unmet:\s*(.*)\)\s*$/i;

/**
 * Parse an `entry_gate` / `exit_gate` cell: `READY @<iso>[ restart]` or
 * `NOT-READY @<iso> (N unmet: first)`. `exit_gate` only ever holds the last
 * failed exit attempt (empty when the first attempt passed).
 */
export function parseFeatureGate(raw: string | undefined): FeatureGateView | undefined {
  const text = (raw ?? '').trim();
  if (!text || isPlaceholder(text)) return undefined;
  const gate = text.match(GATE_RE);
  if (!gate) return undefined;
  const rest = gate[3] ?? '';
  const unmet = rest.match(UNMET_RE);
  return {
    verdict: gate[1].toUpperCase() === 'READY' ? 'ready' : 'not-ready',
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
  const featureId = clean(row.feature_id).toLowerCase();
  return featureId ? Object.values(packages).find((entry) => entry.featureId?.toLowerCase() === featureId) : undefined;
}

/** Rows that stand for an external feature (template placeholders excluded). */
export function featureRows(input: MigrationLedgerInput): LedgerRow[] {
  return (input.tsv[ADOPTION_LEDGER]?.rows ?? []).filter((row) => {
    const id = (row.id ?? '').trim();
    if (!id || isPlaceholder(id) || !clean(row.feature_id)) return false;
    return (row.status ?? '').trim().toLowerCase() !== 'not-applicable';
  });
}

/** The phase each feature kind hooks into (the skill's `feature_predicates.HOST_PHASES`). */
const KIND_HOST_PHASES: Readonly<Record<string, MigrationPhaseId>> = {
  capability: 'features',
  verification: 'validation',
};

/** Host phase of a FEAT row: from its kind, else the package's hook, else `features`. */
export function featureHostPhase(row: LedgerRow, input: MigrationLedgerInput): MigrationPhaseId {
  return KIND_HOST_PHASES[clean(row.kind).toLowerCase()]
    ?? hostPhaseOf(findPackage(input.featurePackages, row)?.hookPhase ?? '')
    ?? 'features';
}

export function featureTitle(row: LedgerRow, input: MigrationLedgerInput): string {
  return findPackage(input.featurePackages, row)?.title || clean(row.feature_id) || row.id;
}

const ANSWER_RE = /^(activated|attempts reset|closed\s+([\w-]+))\b.*?:\s*user answer:\s*(.+)$/i;

/**
 * The user's answers recorded in a FEAT row's `notes`. The scripts append
 * `; `-separated entries: `activated @<ts>: user answer: …` (feature_hooks.py
 * activate), `attempts reset @<ts>: user answer: …` (feature_gate.py exit
 * --answer) and `closed <status>: user answer: …` (feature_hooks.py close).
 */
export function featureAnswers(notes: string | undefined): FeatureAnswerView[] {
  return (notes ?? '').split(/;\s+/).flatMap((entry): FeatureAnswerView[] => {
    const match = entry.trim().match(ANSWER_RE);
    if (!match || !match[3].trim()) return [];
    const head = match[1].toLowerCase();
    if (head === 'activated') return [{ context: 'activate', text: match[3].trim() }];
    if (head === 'attempts reset') return [{ context: 'retry', text: match[3].trim() }];
    return [{ context: 'close', text: match[3].trim(), status: match[2] }];
  });
}

export function buildExternalFeatures(input: MigrationLedgerInput, working: boolean): ExternalFeatureView[] {
  const parsed = input.tsv[ADOPTION_LEDGER];
  if (!parsed) return [];

  return featureRows(input).map((row): ExternalFeatureView => {
    const pkg = findPackage(input.featurePackages, row);
    const rawStatus = (row.status ?? '').trim();
    const status = normalizeStatus(rawStatus);
    const currentStep = clean(row.current_step) || undefined;
    const milestones = milestoneViews(pkg?.milestones ?? [], rawStatus, currentStep);
    const attempts = Number.parseInt(row.attempts ?? '', 10);
    const hostPhaseRaw = KIND_HOST_PHASES[clean(row.kind).toLowerCase()] || pkg?.hookPhase || undefined;
    const workdir = input.featureWorkdirs?.[row.id.trim()];
    return {
      id: row.id.trim(),
      featureId: clean(row.feature_id),
      title: pkg?.title || clean(row.feature_id) || row.id,
      summary: pkg?.summary || undefined,
      kind: clean(row.kind) || pkg?.kind || undefined,
      version: pkg?.version || undefined,
      hostPhase: hostPhaseOf(hostPhaseRaw ?? ''),
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
      answers: featureAnswers(row.notes),
      notes: clean(row.notes) || undefined,
      packageResolved: !!pkg,
      playbookPath: pkg?.playbookPath,
      workdir: workdir?.path,
      files: workdir?.files ?? [],
    };
  });
}
