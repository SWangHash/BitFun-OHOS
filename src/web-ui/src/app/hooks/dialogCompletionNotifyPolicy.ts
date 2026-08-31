import type { AgenticEvent } from '@/infrastructure/api/service-api/AgentAPI';
import type { Session } from '@/flow_chat/types/flow-chat';

interface DialogCompletionNotificationInput {
  event: AgenticEvent;
  session?: Pick<Session, 'sessionKind' | 'parentSessionId'> | null;
  isBackground: boolean;
  notificationsEnabled?: boolean;
}

interface DialogCompletionNotificationCopyInput {
  sessionTitle?: string | null;
  success?: boolean | null;
  cancelled?: boolean;
  finishReason?: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function shouldSendDialogCompletionNotification({
  event: _event,
  session,
  isBackground,
  notificationsEnabled,
}: DialogCompletionNotificationInput): boolean {
  if (!isBackground || notificationsEnabled === false) {
    return false;
  }

  if (!session) {
    return false;
  }

  const sessionKind = session?.sessionKind ?? 'normal';
  if (sessionKind === 'btw' || sessionKind === 'review' || sessionKind === 'subagent') {
    return false;
  }

  return true;
}

export function buildDialogCompletionNotificationCopy({
  sessionTitle,
  success,
  cancelled,
  finishReason,
  t,
}: DialogCompletionNotificationCopyInput): { title: string; body: string } {
  const trimmedTitle = sessionTitle?.trim();
  const failed = success === false;
  // Cancelled takes precedence over failed/completed: a cancelled turn is a
  // distinct terminal state the user should see as "cancelled", not "stopped".
  const titleKey = cancelled
    ? 'notify.dialogCancelledTitle'
    : failed
      ? 'notify.dialogFailedTitle'
      : 'notify.dialogCompletedTitle';
  const withSessionKey = cancelled
    ? 'notify.dialogCancelledWithSession'
    : failed
      ? 'notify.dialogFailedWithSession'
      : 'notify.dialogCompletedWithSession';
  const fallbackKey = cancelled
    ? 'notify.dialogCancelledFallback'
    : failed
      ? 'notify.dialogFailedFallback'
      : 'notify.dialogCompletedFallback';
  const options = {
    sessionTitle: trimmedTitle,
    finishReason,
  };

  return {
    title: t(titleKey),
    body: trimmedTitle ? t(withSessionKey, options) : t(fallbackKey, options),
  };
}
