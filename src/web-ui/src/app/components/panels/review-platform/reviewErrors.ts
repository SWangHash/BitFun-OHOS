import { acpReviewErrorMessage, acpReviewErrorText } from '@/shared/ai-errors/acpReviewErrors';
import type { ReviewPlatformAuthChallenge } from '@/infrastructure/api';

type ReviewTranslate = (key: string, options?: Record<string, unknown>) => string;


export function reviewPlatformErrorMessage(error: unknown, t: ReviewTranslate): string {
  return localizedErrorText(acpReviewErrorText(error), t) ?? acpReviewErrorMessage(error, t);
}

function localizedErrorText(message: string, t: ReviewTranslate): string | undefined {
  switch (message) {
    case "Review failed \u00b7 open to inspect": return t('common:reviewPlatform.messages.reviewFailedInspect');
    case "Review complete \u00b7 result unavailable \u00b7 open to inspect": return t('common:reviewPlatform.messages.reviewResultUnavailable');
    case "Review error": return t('common:reviewPlatform.messages.reviewError');
    case "No active workspace is available.": return t('common:reviewPlatform.messages.noWorkspace');
    case "This link is not a supported pull request URL.": return t('common:reviewPlatform.messages.unsupportedLink');
    case "Open or create a chat session before sending PR context.": return t('common:reviewPlatform.messages.chatRequired');
    case "Open or create a chat session before reviewing this pull request.": return t('common:reviewPlatform.messages.reviewChatRequired');
    case "Review started, but its start acknowledgement is uncertain.": return t('common:reviewPlatform.messages.reviewUncertain');
    case "Token is required.": return t('common:reviewPlatform.messages.tokenRequired');
    case "This pull request could not be resolved from the remotes of the current workspace.": return t('common:reviewPlatform.messages.unresolvedPullRequest');
    case "GitHub pull request head SHA was not available.": return t('common:reviewPlatform.messages.headUnavailable');
    case "No matching GitHub Actions job was found for this check run.": return t('common:reviewPlatform.messages.noActionsJob');
    case "The matching GitHub Actions job does not expose a job id.": return t('common:reviewPlatform.messages.noActionsJobId');
    default: return undefined;
  }
}

export function reviewErrorText(message: string | null | undefined, t: ReviewTranslate): string {
  return message ? localizedErrorText(message, t) ?? acpReviewErrorMessage(message, t) : "";
}

export function reviewAuthErrorMessage(challenge: ReviewPlatformAuthChallenge, t: ReviewTranslate): string {
  return acpReviewErrorMessage(challenge.message, t);
}
