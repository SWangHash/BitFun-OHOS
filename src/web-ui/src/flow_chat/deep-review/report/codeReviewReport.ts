import type { ReviewTeamRunManifest } from '@/shared/services/reviewTeamService';
import type { ReviewCoverageSourceLabelKey } from './reviewCoverageSource';

export { buildCodeReviewReliabilityNotices } from './reliabilityNotices';
export {
  buildCodeReviewReportSections,
  getDefaultExpandedCodeReviewSectionIds,
} from './reportSections';
export {
  DEFAULT_CODE_REVIEW_MARKDOWN_LABELS,
  formatCodeReviewReportMarkdown,
} from './markdown';
export {
  DEFAULT_REVIEW_COVERAGE_SOURCE_LABELS,
  formatReviewCoverageSource,
  resolveReviewCoverageSourceLabelKey,
} from './reviewCoverageSource';
export type { ReviewCoverageSourceLabelKey } from './reviewCoverageSource';

export type ReviewRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ReviewAction = 'approve' | 'approve_with_suggestions' | 'request_changes' | 'block';
export type ReviewMode = 'standard' | 'deep';
export type ReviewEvidenceStatus = 'complete' | 'limited' | 'stale' | 'failed';
export type ReviewIssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ReviewIssueCertainty = 'confirmed' | 'likely' | 'possible';
export type ReviewPacketStatusSource = 'reported' | 'inferred' | 'missing';
export type ReviewSectionId =
  | 'summary'
  | 'issues'
  | 'remediation'
  | 'strengths'
  | 'coverage';
export type RemediationGroupId = 'must_fix' | 'should_improve' | 'needs_decision' | 'verification';
export type StrengthGroupId =
  | 'architecture'
  | 'maintainability'
  | 'tests'
  | 'security'
  | 'performance'
  | 'user_experience'
  | 'other';

export interface CodeReviewSummary {
  overall_assessment?: string;
  risk_level?: ReviewRiskLevel;
  recommended_action?: ReviewAction;
  confidence_note?: string;
}

export interface CodeReviewIssue {
  severity?: ReviewIssueSeverity;
  certainty?: ReviewIssueCertainty;
  category?: string;
  file?: string;
  line?: number | null;
  title?: string;
  description?: string;
  suggestion?: string | null;
  source_reviewer?: string;
  validation_note?: string;
}

const REVIEW_ISSUE_SEVERITIES = new Set<ReviewIssueSeverity>([
  'critical',
  'high',
  'medium',
  'low',
  'info',
]);
const REVIEW_ISSUE_CERTAINTIES = new Set<ReviewIssueCertainty>([
  'confirmed',
  'likely',
  'possible',
]);

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Normalize one untrusted issue while preserving every valid field. */
export function normalizeCodeReviewIssue(value: unknown): CodeReviewIssue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const severity = typeof raw.severity === 'string' &&
    REVIEW_ISSUE_SEVERITIES.has(raw.severity as ReviewIssueSeverity)
    ? raw.severity as ReviewIssueSeverity
    : undefined;
  const certainty = typeof raw.certainty === 'string' &&
    REVIEW_ISSUE_CERTAINTIES.has(raw.certainty as ReviewIssueCertainty)
    ? raw.certainty as ReviewIssueCertainty
    : undefined;
  const suggestion = raw.suggestion === null
    ? null
    : optionalString(raw.suggestion);
  const line = raw.line === null || (typeof raw.line === 'number' && Number.isInteger(raw.line))
    ? raw.line
    : undefined;

  return {
    ...(severity ? { severity } : {}),
    ...(certainty ? { certainty } : {}),
    ...(optionalString(raw.category) !== undefined ? { category: raw.category as string } : {}),
    ...(optionalString(raw.file) !== undefined ? { file: raw.file as string } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(optionalString(raw.title) !== undefined ? { title: raw.title as string } : {}),
    ...(optionalString(raw.description) !== undefined
      ? { description: raw.description as string }
      : {}),
    ...(suggestion !== undefined ? { suggestion } : {}),
    ...(optionalString(raw.source_reviewer) !== undefined
      ? { source_reviewer: raw.source_reviewer as string }
      : {}),
    ...(optionalString(raw.validation_note) !== undefined
      ? { validation_note: raw.validation_note as string }
      : {}),
  };
}

/** Normalize the issue list at persisted/model-result boundaries. */
export function normalizeCodeReviewIssues(value: unknown): CodeReviewIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(normalizeCodeReviewIssue)
    .filter((issue): issue is CodeReviewIssue => issue !== null);
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeCodeReviewReportSections(value: unknown): CodeReviewReportSectionsData | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const normalized: CodeReviewReportSectionsData = {};
  const executiveSummary = normalizeStringArray(raw.executive_summary);
  const coverageNotes = normalizeStringArray(raw.coverage_notes);
  if (executiveSummary) {
    normalized.executive_summary = executiveSummary;
  }
  if (coverageNotes) {
    normalized.coverage_notes = coverageNotes;
  }

  const rawRemediationGroups = raw.remediation_groups;
  if (
    rawRemediationGroups &&
    typeof rawRemediationGroups === 'object' &&
    !Array.isArray(rawRemediationGroups)
  ) {
    const groups = rawRemediationGroups as Record<string, unknown>;
    const remediationGroups: NonNullable<CodeReviewReportSectionsData['remediation_groups']> = {};
    for (const id of ['must_fix', 'should_improve', 'verification'] as const) {
      const entries = normalizeStringArray(groups[id]);
      if (entries) {
        remediationGroups[id] = entries;
      }
    }
    if (Array.isArray(groups.needs_decision)) {
      remediationGroups.needs_decision = groups.needs_decision
        .map(normalizeDecisionEntry)
        .filter((entry): entry is DecisionContext => entry !== null);
    }
    normalized.remediation_groups = remediationGroups;
  }

  const rawStrengthGroups = raw.strength_groups;
  if (
    rawStrengthGroups &&
    typeof rawStrengthGroups === 'object' &&
    !Array.isArray(rawStrengthGroups)
  ) {
    const groups = rawStrengthGroups as Record<string, unknown>;
    const strengthGroups: NonNullable<CodeReviewReportSectionsData['strength_groups']> = {};
    for (const id of [
      'architecture',
      'maintainability',
      'tests',
      'security',
      'performance',
      'user_experience',
      'other',
    ] as const) {
      const entries = normalizeStringArray(groups[id]);
      if (entries) {
        strengthGroups[id] = entries;
      }
    }
    normalized.strength_groups = strengthGroups;
  }

  return normalized;
}

/** Preserve the report shape while replacing untrusted nested values with safe DTOs. */
export function normalizeCodeReviewReportData(value: unknown): CodeReviewReportData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('summary' in value)) {
    return null;
  }

  const report = value as CodeReviewReportData;
  const normalizedReport: CodeReviewReportData = {
    ...report,
    issues: normalizeCodeReviewIssues(report.issues),
  };
  const reportSections = normalizeCodeReviewReportSections(report.report_sections);
  if (reportSections) {
    normalizedReport.report_sections = reportSections;
  } else {
    delete normalizedReport.report_sections;
  }
  return normalizedReport;
}

export interface CodeReviewReviewer {
  name: string;
  specialty: string;
  status: string;
  summary: string;
  partial_output?: string;
  packet_id?: string;
  packet_status_source?: ReviewPacketStatusSource;
  issue_count?: number;
  covered_files?: string[];
  retry_scope_files?: string[];
  unresolved_files?: string[];
  capacity_reason?: string;
  provider_capacity_reason?: string;
  queue_skip_reason?: string;
}

export interface CodeReviewReportSectionsData {
  executive_summary?: string[];
  remediation_groups?: Partial<Record<RemediationGroupId, (string | DecisionContext)[]>>;
  strength_groups?: Partial<Record<StrengthGroupId, string[]>>;
  coverage_notes?: string[];
}

/**
 * Structured decision context for `needs_decision` remediation items.
 * Falls back to a plain string when the AI returns a legacy format.
 */
export interface DecisionContext {
  question: string;
  plan: string;
  options?: string[];
  tradeoffs?: string;
  recommendation?: number;
}

/** Normalize an untrusted `needs_decision` entry to a DecisionContext object. */
export function normalizeDecisionEntry(entry: unknown): DecisionContext | null {
  if (typeof entry === 'string') {
    const text = entry.trim();
    return text ? { question: text, plan: text } : null;
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const raw = entry as Record<string, unknown>;
  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  const plan = typeof raw.plan === 'string' ? raw.plan.trim() : '';
  if (!question || !plan) {
    return null;
  }

  const options = Array.isArray(raw.options)
    ? raw.options
        .filter((option): option is string => typeof option === 'string')
        .map((option) => option.trim())
        .filter(Boolean)
    : undefined;
  const tradeoffs = typeof raw.tradeoffs === 'string' && raw.tradeoffs.trim()
    ? raw.tradeoffs.trim()
    : undefined;
  const recommendation = typeof raw.recommendation === 'number' &&
    Number.isInteger(raw.recommendation)
    ? raw.recommendation
    : undefined;

  return {
    question,
    plan,
    ...(options?.length ? { options } : {}),
    ...(tradeoffs ? { tradeoffs } : {}),
    ...(recommendation !== undefined ? { recommendation } : {}),
  };
}

export interface CodeReviewReportData {
  schema_version?: number;
  schemaVersion?: number;
  summary?: CodeReviewSummary;
  issues?: CodeReviewIssue[];
  positive_points?: string[];
  review_mode?: ReviewMode;
  review_scope?: string;
  reviewers?: CodeReviewReviewer[];
  remediation_plan?: string[];
  report_sections?: CodeReviewReportSectionsData;
  reliability_signals?: CodeReviewReliabilitySignal[];
  evidence_status?: ReviewEvidenceStatus;
}

export interface ReviewReportGroup<TId extends string = string> {
  id: TId;
  items: string[];
}

export interface ReviewIssueStats {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface ReviewReviewerStats {
  total: number;
  completed: number;
  degraded: number;
}

export interface ReviewReportSections {
  executiveSummary: string[];
  remediationGroups: Array<ReviewReportGroup<RemediationGroupId>>;
  strengthGroups: Array<ReviewReportGroup<StrengthGroupId>>;
  coverageNotes: string[];
  issueStats: ReviewIssueStats;
  reviewerStats: ReviewReviewerStats;
}

export type ReviewReliabilityNoticeKind =
  | 'context_pressure'
  | 'compression_preserved'
  | 'cache_hit'
  | 'cache_miss'
  | 'concurrency_limited'
  | 'partial_reviewer'
  | 'target_evidence_limited'
  | 'reduced_scope'
  | 'retry_guidance'
  | 'skipped_reviewers'
  | 'token_budget_limited'
  | 'user_decision';

export type ReviewReliabilityNoticeSeverity = 'info' | 'warning' | 'action';
export type ReviewReliabilitySignalSource = 'runtime' | 'manifest' | 'report' | 'inferred';

export interface ReviewReliabilityNotice {
  kind: ReviewReliabilityNoticeKind;
  severity: ReviewReliabilityNoticeSeverity;
  count?: number;
  source?: ReviewReliabilitySignalSource;
  detail?: string;
}

export interface CodeReviewReliabilitySignal {
  kind: ReviewReliabilityNoticeKind;
  severity?: ReviewReliabilityNoticeSeverity;
  count?: number;
  source?: ReviewReliabilitySignalSource;
  detail?: string;
}

export interface CodeReviewReportMarkdownLabels {
  titleStandard: string;
  titleDeep: string;
  executiveSummary: string;
  reviewDecision: string;
  riskLevel: string;
  recommendedAction: string;
  evidenceStatus: string;
  scope: string;
  issues: string;
  noIssues: string;
  remediationPlan: string;
  strengths: string;
  reliabilitySignals: string;
  coverageNotes: string;
  validation: string;
  suggestion: string;
  source: string;
  noItems: string;
  coverageSourceLabels: Record<ReviewCoverageSourceLabelKey, string>;
  groupTitles: Record<RemediationGroupId | StrengthGroupId, string>;
  reliabilityNoticeLabels: Record<ReviewReliabilityNoticeKind, string>;
}

export interface CodeReviewReportMarkdownOptions {
  runManifest?: ReviewTeamRunManifest;
}

const RETRYABLE_CAPACITY_REASONS = new Set([
  'provider_rate_limit',
  'provider_concurrency_limit',
  'retry_after',
  'launch_batch_blocked',
  'temporary_overload',
]);

export type DeepReviewRetryableSliceSourceStatus = 'partial_timeout' | 'capacity_skipped';

export interface DeepReviewRetryableSlice {
  sourcePacketId: string;
  reviewerId: string;
  reviewerName: string;
  sourceStatus: DeepReviewRetryableSliceSourceStatus;
  coveredFiles: string[];
  retryScopeFiles: string[];
  retryTimeoutSeconds: number;
  capacityReason?: string;
}

function nonEmpty(values?: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function reviewerStringArray(
  reviewer: CodeReviewReviewer,
  keys: Array<keyof CodeReviewReviewer | string>,
): string[] {
  const raw = reviewer as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = raw[String(key)];
    if (!Array.isArray(value)) {
      continue;
    }
    return nonEmpty(value.map((item) => (typeof item === 'string' ? item : undefined)));
  }
  return [];
}

function reviewerString(
  reviewer: CodeReviewReviewer,
  keys: Array<keyof CodeReviewReviewer | string>,
): string | undefined {
  const raw = reviewer as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = raw[String(key)];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function findWorkPacket(
  runManifest: ReviewTeamRunManifest,
  packetId: string,
  reviewerId: string,
) {
  return runManifest.workPackets?.find((packet) => (
    packet.packetId === packetId && packet.subagentId === reviewerId
  ));
}

function retryTimeoutSecondsForPacket(sourceTimeoutSeconds: number): number | null {
  if (!Number.isFinite(sourceTimeoutSeconds) || sourceTimeoutSeconds <= 1) {
    return null;
  }
  return Math.max(1, Math.min(sourceTimeoutSeconds - 1, Math.floor(sourceTimeoutSeconds / 2)));
}

function isRetryableCapacityReviewer(reviewer: CodeReviewReviewer): string | null {
  if (reviewer.status !== 'capacity_skipped') {
    return null;
  }

  const terminalReason = reviewerString(reviewer, ['queue_skip_reason', 'queueSkipReason']);
  if (terminalReason && !RETRYABLE_CAPACITY_REASONS.has(terminalReason)) {
    return null;
  }

  const capacityReason = terminalReason ??
    reviewerString(reviewer, [
      'capacity_reason',
      'capacityReason',
      'provider_capacity_reason',
      'providerCapacityReason',
    ]);
  return capacityReason && RETRYABLE_CAPACITY_REASONS.has(capacityReason)
    ? capacityReason
    : null;
}

export function extractDeepReviewRetryableSlices(
  report: CodeReviewReportData,
  runManifest?: ReviewTeamRunManifest,
): DeepReviewRetryableSlice[] {
  if (report.review_mode !== 'deep' || !runManifest?.workPackets?.length) {
    return [];
  }

  const slices: DeepReviewRetryableSlice[] = [];
  for (const reviewer of report.reviewers ?? []) {
    const sourceStatus = reviewer.status === 'partial_timeout'
      ? 'partial_timeout'
      : reviewer.status === 'capacity_skipped'
        ? 'capacity_skipped'
        : null;
    if (!sourceStatus) {
      continue;
    }

    const capacityReason = isRetryableCapacityReviewer(reviewer);
    if (sourceStatus === 'capacity_skipped' && !capacityReason) {
      continue;
    }

    const sourcePacketId = reviewer.packet_id?.trim();
    if (!sourcePacketId) {
      continue;
    }
    const reviewerId = reviewerString(reviewer, ['subagent_id', 'subagentId']) ??
      sourcePacketId.split(':')[1]?.split(':')[0]?.trim() ??
      '';
    if (!reviewerId) {
      continue;
    }

    const packet = findWorkPacket(runManifest, sourcePacketId, reviewerId);
    const packetFiles = nonEmpty(packet?.assignedScope.files ?? []);
    if (!packet || packetFiles.length <= 1) {
      continue;
    }

    const retryScopeFiles = reviewerStringArray(reviewer, [
      'retry_scope_files',
      'retryScopeFiles',
      'unresolved_files',
      'unresolvedFiles',
    ]);
    if (retryScopeFiles.length === 0 || retryScopeFiles.length >= packetFiles.length) {
      continue;
    }

    const packetFileSet = new Set(packetFiles);
    if (retryScopeFiles.some((file) => !packetFileSet.has(file))) {
      continue;
    }

    const retryScopeSet = new Set(retryScopeFiles);
    const coveredFiles = reviewerStringArray(reviewer, ['covered_files', 'coveredFiles'])
      .filter((file) => packetFileSet.has(file) && !retryScopeSet.has(file));
    const normalizedCoveredFiles = coveredFiles.length > 0
      ? coveredFiles
      : packetFiles.filter((file) => !retryScopeSet.has(file));

    const retryTimeoutSeconds = retryTimeoutSecondsForPacket(packet.timeoutSeconds);
    if (!retryTimeoutSeconds) {
      continue;
    }

    slices.push({
      sourcePacketId,
      reviewerId,
      reviewerName: reviewer.name || packet.displayName || reviewerId,
      sourceStatus,
      coveredFiles: normalizedCoveredFiles,
      retryScopeFiles,
      retryTimeoutSeconds,
      ...(capacityReason ? { capacityReason } : {}),
    });
  }

  return slices;
}

export function buildDeepReviewRetryPrompt(slices: DeepReviewRetryableSlice[]): string {
  const retryTasks = slices.map((slice) => ({
    subagent_type: slice.reviewerId,
    retry: true,
    timeout_seconds: slice.retryTimeoutSeconds,
    retry_coverage: {
      source_packet_id: slice.sourcePacketId,
      source_status: slice.sourceStatus,
      ...(slice.capacityReason ? { capacity_reason: slice.capacityReason } : {}),
      covered_files: slice.coveredFiles,
      retry_scope_files: slice.retryScopeFiles,
    },
  }));

  return [
    'Retry only the listed incomplete strict review coverage in this same session.',
    'Use the Task tool once for each retry task below. Do not retry files outside retry_scope_files.',
    'After these retry tasks finish, run ReviewJudge and submit an updated code review report with honest coverage notes.',
    '',
    '<deep_review_retry_tasks>',
    JSON.stringify(retryTasks, null, 2),
    '</deep_review_retry_tasks>',
  ].join('\n');
}
