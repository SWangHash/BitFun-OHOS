import { useCallback, type ReactNode } from 'react';
import { Phone } from 'lucide-react';
import { OverflowText } from '@bitfun/ui';
import { useI18n } from '@/infrastructure/i18n';

import { RealtimeVoiceCallPanel } from './RealtimeVoiceCallPanel';
import { useRealtimeVoiceCall } from './RealtimeVoiceCallContext';
import type { VoiceMiniAppCallTarget } from './voiceClientContext';
import './ConversationModeSurface.scss';

interface ConversationModeSurfaceProps {
  children: ReactNode;
  className?: string;
  /** Captured MiniApp route; absence keeps the existing workspace voice flow. */
  voiceTarget?: VoiceMiniAppCallTarget;
  /** Prevents a MiniApp call from falling back to the workspace route while its session binds. */
  voiceStartDisabled?: boolean;
  switchTestId?: string;
  onCloseVoice?: () => void;
}

/**
 * Shared text/realtime-voice capability shell for compact conversation hosts.
 * Window-specific components own only their chrome and provide the text
 * surface; this component is the single owner of mode switching and voice UI.
 */
export function ConversationModeSurface({
  children,
  className,
  voiceTarget,
  voiceStartDisabled = false,
  switchTestId,
  onCloseVoice,
}: ConversationModeSurfaceProps) {
  const { t } = useI18n('settings/voice-input');
  const {
    enabled,
    phase,
    start: startVoiceCall,
  } = useRealtimeVoiceCall();
  const isVoiceMode = phase !== 'idle';
  const showModeSwitch = enabled && !isVoiceMode;

  const handleModeSwitch = useCallback(() => {
    if (!enabled || voiceStartDisabled) return;
    startVoiceCall(voiceTarget);
  }, [enabled, startVoiceCall, voiceStartDisabled, voiceTarget]);

  return (
    <div
      className={[
        'bitfun-conversation-mode-surface',
        className,
      ].filter(Boolean).join(' ')}
      data-bitfun-component="conversation-mode-surface"
      data-bitfun-part="root"
      data-bitfun-state={isVoiceMode ? 'voice' : 'chat'}
    >
      <div
        className="bitfun-conversation-mode-surface__body"
        data-bitfun-component="conversation-mode-surface"
        data-bitfun-part="body"
      >
        {isVoiceMode ? <RealtimeVoiceCallPanel onClose={onCloseVoice} /> : children}
      </div>

      {showModeSwitch ? (
        <footer
          className="bitfun-conversation-mode-surface__switch"
          data-bitfun-component="conversation-mode-surface"
          data-bitfun-part="modeSwitch"
        >
          <button data-overflow-trigger
            type="button"
            className="bitfun-conversation-mode-surface__switch-button"
            data-testid={switchTestId}
            data-bitfun-component="conversation-mode-surface"
            data-bitfun-part="modeSwitchButton"
            disabled={voiceStartDisabled}
            onClick={handleModeSwitch}
          >
            <Phone size={15} aria-hidden="true" />
            <OverflowText>
              {t('voiceCall.call.switchToVoice')}
            </OverflowText>
          </button>
        </footer>
      ) : null}
    </div>
  );
}
