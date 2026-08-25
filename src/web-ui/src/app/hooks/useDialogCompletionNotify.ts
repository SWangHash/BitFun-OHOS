import { useEffect, useRef } from 'react';
import { agentAPI } from '@/infrastructure/api';
import { systemAPI } from '@/infrastructure/api/service-api/SystemAPI';
import { configManager } from '@/infrastructure/config/services/ConfigManager';
import { flowChatStore } from '@/flow_chat/store/FlowChatStore';
import { useI18n } from '@/infrastructure/i18n';
import { createLogger } from '@/shared/utils/logger';
import { isOpenHarmonyRuntime } from '@/infrastructure/runtime';
import {
  buildDialogCompletionNotificationCopy,
  shouldSendDialogCompletionNotification,
} from './dialogCompletionNotifyPolicy';

const log = createLogger('useDialogCompletionNotify');

/**
 * Listens for dialog turn completion events and sends an OS-level desktop
 * notification (Windows toast / macOS notification center) when the window
 * is not focused and the feature is enabled in config.
 *
 * Notification title = session title (or short session id fallback).
 * Notification body  = fixed "task completed" message.
 *
 * "Not focused" means: the page is hidden (minimized / tab switched) OR
 * the window has lost focus to another OS-level application.
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

    const unlisten = agentAPI.onDialogTurnCompleted(async (event) => {
      // Send notification if page is hidden OR window lost OS focus
      const isBackground = document.hidden || !windowFocusedRef.current;

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
        success: event?.success,
        finishReason: event?.finishReason ?? event?.finish_reason,
        t,
      });

      if (isOpenHarmonyRuntime()) {
        log.info('Sending dialog completion notification', { title: notificationCopy.title });
      }
      await systemAPI.sendSystemNotification(
        notificationCopy.title,
        notificationCopy.body,
      );
    });

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      unlisten();
    };
  }, [t]);
};
