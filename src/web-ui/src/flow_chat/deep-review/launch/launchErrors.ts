import { acpReviewErrorKey, acpReviewErrorMessage, acpReviewErrorText } from '@/shared/ai-errors/acpReviewErrors';
import { classifyLaunchError } from '../../utils/deepReviewExperience';

export type DeepReviewLaunchStep =
  | 'prepare_review_team'
  | 'create_child_session'
  | 'open_aux_pane'
  | 'send_start_message';

export interface FailedDeepReviewCleanupResult {
  cleanupCompleted: boolean;
  cleanupIssues: string[];
}

export interface DeepReviewLaunchError extends Error {
  launchErrorCategory?: string;
  launchErrorActions?: string[];
  launchErrorMessageKey?: string;
  launchErrorStep?: string;
  originalMessage?: string;
  childSessionId?: string;
  cleanupCompleted?: boolean;
  cleanupIssues?: string[];
  cleanupCause?: unknown;
  cleanupStepDescription?: string;
}

export function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return 'Review failed to start';
}

export function isSessionMissingError(error: unknown): boolean {
  const message = normalizeErrorMessage(error).toLowerCase();
  return message.includes('session does not exist') || message.includes('not found');
}

function describeLaunchStep(step: DeepReviewLaunchStep): string {
  switch (step) {
    case 'prepare_review_team':
      return 'checking review coverage';
    case 'create_child_session':
      return 'creating the Review session';
    case 'open_aux_pane':
      return 'preparing the Review session';
    case 'send_start_message':
      return 'starting the Review run';
    default:
      return 'launching Review';
  }
}

export function createDeepReviewLaunchError(
  launchStep: DeepReviewLaunchStep,
  originalError: unknown,
  childSessionId?: string,
  cleanupResult?: FailedDeepReviewCleanupResult,
): DeepReviewLaunchError {
  const classified = classifyLaunchError(launchStep, originalError);
  const friendlyError = new Error(normalizeErrorMessage(originalError)) as DeepReviewLaunchError;

  friendlyError.launchErrorCategory = classified.category;
  friendlyError.launchErrorActions = classified.actions;
  const originalKey = originalError && typeof originalError === 'object' && 'launchErrorMessageKey' in originalError
    ? originalError.launchErrorMessageKey : undefined;
  friendlyError.launchErrorMessageKey = typeof originalKey === 'string' ? originalKey
    : acpReviewErrorKey(originalError) ?? classified.messageKey;
  if (typeof originalKey === 'string') friendlyError.launchErrorCategory = 'target';
  friendlyError.launchErrorStep = classified.step;
  friendlyError.originalMessage = acpReviewErrorText(originalError).trim() || normalizeErrorMessage(originalError);
  if (originalError && typeof originalError === 'object' && 'cleanupCause' in originalError) {
    friendlyError.cleanupCause = originalError.cleanupCause;
    friendlyError.cleanupStepDescription = describeLaunchStep(launchStep);
  }
  if (childSessionId) {
    friendlyError.childSessionId = childSessionId;
  }
  if (cleanupResult) {
    friendlyError.cleanupCompleted = cleanupResult.cleanupCompleted;
    friendlyError.cleanupIssues = cleanupResult.cleanupIssues;
  }

  return friendlyError;
}

export function getDeepReviewLaunchErrorMessage(
  error: unknown,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  return acpReviewErrorMessage(error, translate);
}

export function buildLaunchCleanupError(
  launchStep: DeepReviewLaunchStep,
  childSessionId: string,
  originalError: unknown,
  cleanupResult: FailedDeepReviewCleanupResult,
): Error {
  const originalMessage = normalizeErrorMessage(originalError);
  if (cleanupResult.cleanupCompleted) {
    return originalError instanceof Error ? originalError : new Error(originalMessage);
  }

  const cleanupSummary = cleanupResult.cleanupIssues.join(' ');
  return Object.assign(new Error(
    `${originalMessage} Cleanup was incomplete after failure while ${describeLaunchStep(launchStep)}. ` +
      `The partially created Review session (${childSessionId}) may need manual cleanup. ${cleanupSummary}`.trim(),
  ), {
    cleanupCause: originalError ?? originalMessage,
    cleanupStepDescription: describeLaunchStep(launchStep),
    cleanupCompleted: false,
    cleanupIssues: cleanupResult.cleanupIssues,
    childSessionId,
  });
}
