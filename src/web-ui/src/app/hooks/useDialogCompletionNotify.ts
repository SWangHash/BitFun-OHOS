import { useEffect, useRef } from 'react';
import { agentAPI } from '@/infrastructure/api';
import type { AgenticEvent } from '@/infrastructure/api/service-api/AgentAPI';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { useI18n } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import { workspaceAPI } from '@/infrastructure';
import {
  buildDialogCompletionNotificationCopy,
  shouldSendDialogCompletionNotification,
} from './dialogCompletionNotifyPolicy';

const log = createLogger('useDialogCompletionNotify');

/**
 * Listens for dialog turn completion AND failure events and sends an OS-level
 * desktop notification (Windows toast / macOS notification center / HarmonyOS
 * Notification Kit) when the window is not focused and the feature is enabled
 * in config.
 *
 * Notification title = product title, success vs. failure variant.
 * Notification body  = session-aware "is ready" / "stopped unexpectedly" copy.
 *
 * "Not focused" means: the page is hidden (minimized / tab switched) OR the
 * window has lost focus to another OS-level application. On HarmonyOS the
 * webview does not reliably update document.hidden / fire window blur on
 * minimize, so the real minimized state is queried from the host instead.
 */
export const useDialogCompletionNotify = () => {
  const { t } = useI18n('common');
  // Track whether the window currently has OS-level focus
  const windowFocusedRef = useRef(true);

  useEffect(() => {
    const handleFocus = () => { windowFocusedRef.current = true; };
    const handleBlur = () => { windowFocusedRef.current = false; };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    const resolveIsBackground = async (): Promise<boolean> => {
      // On HarmonyOS the webview does not reliably update document.hidden or
      // fire window blur on minimize, so query the real window status from the
      // host. The diagnostic log below still captures document.hidden /
      // windowFocused for comparison.
      if (isOpenHarmonyRuntime()) {
        try {
          return await workspaceAPI.window_is_minimized();
        } catch {
          return document.hidden || !windowFocusedRef.current;
        }
      }
      return document.hidden || !windowFocusedRef.current;
    };

    const notify = async (
      event: AgenticEvent,
      outcome: { success?: boolean; cancelled?: boolean; finishReason?: string | null },
    ): Promise<void> => {
      const isBackground = await resolveIsBackground();

      let enabled = true;
      try {
        enabled = await configManager.getConfig<boolean>(
          'app.notifications.dialog_completion_notify'
        );
      } catch (error) {
        log.warn('Failed to read dialog_completion_notify config', error);
      }

      // Resolve session title from store; fall back to short session id
      const sessionId: string = event?.sessionId ?? '';
      const session = sessionId
        ? flowChatStore.getState().sessions.get(sessionId)
        : undefined;

      const shouldSend = shouldSendDialogCompletionNotification({
        event,
        session,
        isBackground,
        notificationsEnabled: enabled,
      });
      // Diagnostic (OHOS only): capture why the hook sends or skips, since OHOS
      // does not always update document.hidden / fire window blur on minimize.
      if (isOpenHarmonyRuntime()) {
        log.info('Dialog turn completion notification evaluated', {
          sessionId,
          isBackground,
          documentHidden: document.hidden,
          windowFocused: windowFocusedRef.current,
          enabled,
          hasSession: !!session,
          sessionKind: session?.sessionKind,
          shouldSend,
        });
      }

      if (!shouldSend) {
        return;
      }

      const notificationCopy = buildDialogCompletionNotificationCopy({
        sessionTitle: session?.title,
        success: outcome.success,
        cancelled: outcome.cancelled,
        finishReason: outcome.finishReason ?? undefined,
        t,
      });

      if (isOpenHarmonyRuntime()) {
        log.info('Sending dialog completion notification', { title: notificationCopy.title });
      }
      await systemAPI.sendSystemNotification(
        notificationCopy.title,
        notificationCopy.body,
      );
    };

    // A completed turn may itself be unsuccessful (success === false). A
    // DialogTurnFailed event carries an explicit error string, surfaced here
    // as the finish reason so the failure copy reflects what happened. A
    // DialogTurnCancelled event is a distinct terminal state shown as
    // "cancelled" rather than "stopped".
    const unlistenCompleted = agentAPI.onDialogTurnCompleted((event) =>
      notify(event, { success: event?.success ?? true, finishReason: event?.finishReason ?? event?.finish_reason })
    );
    const unlistenFailed = agentAPI.onDialogTurnFailed((event) =>
      notify(event, { success: false, finishReason: event?.error })
    );
    const unlistenCancelled = agentAPI.onDialogTurnCancelled((event) =>
      notify(event, { cancelled: true })
    );

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      unlistenCompleted();
      unlistenFailed();
      unlistenCancelled();
    };
  }, [t]);
};
