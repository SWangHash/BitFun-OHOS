import english from '@/locales/en-US/errors.json';

export type ErrorTranslate = (key: string, options?: Record<string, unknown>) => string;

// These are the original BitFun messages carried by existing hosts and saved
// sessions. Match complete messages, including their parameters, rather than
// inferring a user-facing message from an error category or operation.
const templates = Object.entries(english.acpReview);
const exact = new Map(templates.filter(([, value]) => !value.includes('{{')).map(([key, value]) => [value, key]));
exact.set('deep_review_resume_blocked', 'reviewResumeBlocked');
exact.set('review_platform_state_filter_unsupported', 'platformHostStateFilterUnsupported');
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const parameterPattern = /\{\{(\w+)\}\}/g;
const patterns = templates.filter(([, value]) => value.includes('{{')).map(([key, value]) => {
  const parameters: string[] = [];
  let cursor = 0;
  let source = '';
  for (const match of value.matchAll(parameterPattern)) {
    source += escapeRegex(value.slice(cursor, match.index));
    source += match[1] === 'httpStatus' ? '(\\d+)' : '([\\s\\S]*?)';
    parameters.push(match[1]);
    cursor = match.index! + match[0].length;
  }
  source += escapeRegex(value.slice(cursor));
  return {
    key, parameters, expression: new RegExp(`^${source}$`),
    prefix: value.slice(0, value.indexOf('{{')),
    specificity: value.replace(parameterPattern, '').length,
  };
}).sort((left, right) => right.specificity - left.specificity);

// Only prose/cause parameters are translated recursively. Identifiers, paths,
// commands and provider output parameters retain their original values.
const proseParameters = new Set(['detail', 'details', 'error', 'message', 'reason', 'issues', 'warnings', 'step', 'itemLabel', 'capability']);
const parameterLabels = new Map(Object.entries(english.acpReviewParameters).map(([key, value]) => [value, key]));
const labelParameters = new Set(['step', 'phase', 'itemLabel', 'resource', 'repository']);

/** Unwrap only the error envelopes used by Tauri, Peer HostInvoke and JSON-RPC. */
export function acpReviewErrorText(error: unknown): string {
  const seen = new Set<object>();
  const read = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    const candidate = value as {
      originalMessage?: unknown; message?: unknown; originalError?: unknown;
      context?: { originalError?: unknown }; details?: { originalError?: unknown }; data?: unknown;
    };
    for (const nested of [candidate.originalMessage, candidate.context?.originalError,
      candidate.details?.originalError, candidate.originalError, candidate.data, candidate.message]) {
      const text = read(nested);
      if (text !== undefined && text !== '') return text;
    }
    return undefined;
  };
  return read(error) ?? (error == null ? '' : String(error));
}

/** Localize BitFun-authored prose without discarding an unrecognized diagnostic. */
export function acpReviewErrorMessage(error: unknown, t: ErrorTranslate): string {
  if (error && typeof error === 'object' && 'cleanupCause' in error) {
    const cleanup = error as {
      cleanupCause: unknown; cleanupStepDescription?: string;
      childSessionId?: string; cleanupIssues?: string[];
    };
    const step = cleanup.cleanupStepDescription ?? '';
    const label = parameterLabels.get(step);
    return t('errors:acpReview.reviewCleanupIncomplete', {
      detail: acpReviewErrorMessage(cleanup.cleanupCause, t),
      step: label ? t(`errors:acpReviewParameters.${label}`) : step,
      sessionId: cleanup.childSessionId,
      issues: cleanup.cleanupIssues?.map(issue => acpReviewErrorMessage(issue, t)).join(' ') ?? '',
    }).trimEnd();
  }
  const text = acpReviewErrorText(error);
  const translate = (message: string): string => {
    const platform = /^review_platform_error:[^:]+:\s*([\s\S]*)$/.exec(message);
    if (platform) return translate(platform[1]);
    if (message.startsWith('git_unavailable:')) return translate(message.slice('git_unavailable:'.length).trimStart());
    if (message.startsWith('git_repository_untrusted:')) {
      return t('errors:acpReview.platformUntrustedRepository', { path: message.slice('git_repository_untrusted:'.length).trimStart() });
    }
    const key = exact.get(message);
    if (key) return t(`errors:acpReview.${key}`);
    for (const pattern of patterns) {
      if (!message.startsWith(pattern.prefix)) continue;
      const match = pattern.expression.exec(message);
      if (!match) continue;
      const values: Record<string, string> = {};
      pattern.parameters.forEach((parameter, index) => {
        const value = match[index + 1];
        const label = labelParameters.has(parameter) ? parameterLabels.get(value) : undefined;
        values[parameter] = label ? t(`errors:acpReviewParameters.${label}`)
          : parameter === 'warnings' ? value.split('; ').map(translate).join('; ')
          : proseParameters.has(parameter) && value !== message ? translate(value) : value;
      });
      return t(`errors:acpReview.${pattern.key}`, values);
    }
    return message;
  };
  return translate(text);
}

export function isAcpReviewAuthoredError(error: unknown): boolean {
  let matched = false;
  acpReviewErrorMessage(error, () => { matched = true; return ''; });
  return matched;
}
