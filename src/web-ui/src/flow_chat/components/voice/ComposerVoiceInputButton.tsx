import { useTranslation } from 'react-i18next';
import { Loader2, Mic } from 'lucide-react';
import { IconButton } from '@/component-library';
import type { ComposerVoiceInputController } from './useComposerVoiceInput';

interface ComposerVoiceInputButtonProps {
  controller: ComposerVoiceInputController;
}

export function ComposerVoiceInputButton({ controller }: ComposerVoiceInputButtonProps) {
  if (!controller.enabled) {
    return null;
  }

  const busy = controller.phase === 'preparing' || controller.phase === 'transcribing';

  return (
    <span
      className="bitfun-chat-input__voice-cluster"
      data-bf-component="composer-voice-input"
      data-bf-part="root"
      data-bf-phase={controller.phase}
    >
      <span data-bf-component="composer-voice-input" data-bf-part="control" data-bf-state={controller.disabled ? 'disabled' : undefined}>
        <IconButton
          aria-label={controller.tooltip}
          className="bitfun-chat-input__voice-control"
          data-testid="chat-input-voice-control"
          variant="ghost"
          size="xs"
          disabled={controller.disabled || busy}
          tooltip={controller.tooltip}
          onClick={(event) => {
            event.stopPropagation();
            controller.toggle();
          }}
        >
          {busy ? <Loader2 size={14} className="bitfun-chat-input__voice-spinner" /> : <Mic size={14} />}
        </IconButton>
      </span>
    </span>
  );
}

interface ComposerVoiceInputStatusProps {
  controller: ComposerVoiceInputController;
}

export function ComposerVoiceInputStatus({ controller }: ComposerVoiceInputStatusProps) {
  const { t } = useTranslation('flow-chat');
  if (!controller.enabled) {
    return null;
  }

  const active = controller.phase !== 'idle';
  if (!active) {
    return <div className="bitfun-chat-input__voice-status-row" aria-hidden="true" />;
  }

  return (
    <div
      className="bitfun-chat-input__voice-status-row"
      data-bf-component="composer-voice-input"
      data-bf-part="status"
      data-bf-phase={controller.phase}
      aria-hidden={controller.phase !== 'recording' || undefined}
    >
      <span
        className="bitfun-chat-input__voice-recording-hint"
        data-bf-component="composer-voice-input"
        data-bf-part="recordingHint"
        role="status"
        aria-live="polite"
      >
        {controller.phase === 'recording' ? t('input.voiceInput.recording') : ''}
      </span>
    </div>
  );
}
