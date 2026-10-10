import {
  Button,
  Icon,
  IconButton,
  OverflowText,
  Tooltip,
} from '@bitfun/ui';
import { ChatComposerActionButton } from '@bitfun/ui/flow-chat';
import { Loader2 } from 'lucide-react';
import type { ComposerVoiceInputController } from './useComposerVoiceInput';

interface ComposerVoiceInputProps {
  controller: ComposerVoiceInputController;
}

/**
 * Composer-local voice control. It owns the idle microphone button and the
 * local-model setup prompt; the active capture renders its status below the
 * composer through {@link ComposerVoiceInputBar} and its stop control in the
 * composer end actions through {@link ComposerVoiceStopButton}.
 */
export function ComposerVoiceInputButton({ controller }: ComposerVoiceInputProps) {
  if (!controller.enabled) {
    return null;
  }

  const setupRequired = controller.phase === 'setup';
  const downloading = controller.phase === 'downloading';

  if (!setupRequired && !downloading) {
    if (controller.phase !== 'idle') {
      return null;
    }
    return (
      <span className="bitfun-chat-input__voice-cluster" data-bitfun-component="composer-voice-input" data-bitfun-part="root" data-bitfun-phase="idle">
        <span className="bitfun-chat-input__voice-control-shell" data-bitfun-component="composer-voice-input" data-bitfun-part="control" data-bitfun-state={controller.disabled ? 'disabled' : undefined}>
          <Tooltip content={controller.tooltip}>
            <IconButton
              aria-label={controller.tooltip}
              className="bitfun-chat-input__voice-control"
              size="sm"
              data-testid="chat-input-voice-control"
              disabled={controller.disabled}
              onClick={(event) => {
                event.stopPropagation();
                controller.toggle();
              }}
              icon={<Icon name="mic" size="sm" />}
            />
          </Tooltip>
        </span>
      </span>
    );
  }

  const progress = Math.min(100, Math.max(0, controller.downloadProgress ?? 0));
  return (
    <span
      className="bitfun-chat-input__voice-cluster bitfun-chat-input__voice-cluster--setup"
      data-bitfun-component="composer-voice-input"
      data-bitfun-part="root"
      data-bitfun-phase={controller.phase}
      data-bitfun-state="active"
    >
      <span
        className="bitfun-chat-input__voice-setup-pill"
        data-bitfun-component="composer-voice-input"
        data-bitfun-part="setupPill"
        role="group"
        aria-label={controller.setupMessage}
        aria-busy={downloading}
      >
        <span
          className="bitfun-chat-input__voice-setup-icon"
          data-bitfun-component="composer-voice-input"
          data-bitfun-part="status"
          aria-hidden="true"
        >
          {downloading
            ? <Loader2 size={14} className="bitfun-chat-input__voice-spinner" />
            : <Icon name="arrow-down" size="sm" />}
        </span>
        <span
          className="bitfun-chat-input__voice-setup-copy"
          data-bitfun-component="composer-voice-input"
          data-bitfun-part="setupMessage"
        >
          <OverflowText>{controller.setupMessage}</OverflowText>
          {downloading ? (
            <span className="bitfun-chat-input__voice-setup-progress" aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </span>
          ) : null}
        </span>
        {setupRequired ? (
          <span data-bitfun-component="composer-voice-input" data-bitfun-part="action" data-bitfun-action="install">
            <Button
              className="bitfun-chat-input__voice-setup-action"
              variant="primary"
              size="sm"
              data-testid="chat-input-voice-setup-action"
              onClick={(event) => {
                event.stopPropagation();
                controller.installAndStart();
              }}
            >
              {controller.setupActionLabel}
            </Button>
          </span>
        ) : null}
        <span data-bitfun-component="composer-voice-input" data-bitfun-part="action" data-bitfun-action="dismiss">
          <Tooltip content={controller.setupCancelTooltip}>
            <IconButton
              aria-label={controller.setupCancelTooltip}
              className="bitfun-chat-input__voice-setup-dismiss"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                controller.dismissSetup();
              }}
              icon={<Icon name="xmark" size="sm" />}
            />
          </Tooltip>
        </span>
      </span>
    </span>
  );
}

/**
 * Recording status rendered outside the composer, directly below it. The bar is
 * absolutely positioned, so starting a capture never reflows the composer.
 */
export function ComposerVoiceInputBar({ controller }: ComposerVoiceInputProps) {
  const preparing = controller.phase === 'preparing';
  const recording = controller.phase === 'recording';
  const transcribing = controller.phase === 'transcribing';

  if (!controller.enabled || (!preparing && !recording && !transcribing)) {
    return null;
  }

  return (
    <span
      className="bitfun-chat-input__voice-bar"
      data-bitfun-component="composer-voice-input"
      data-bitfun-part="root"
      data-bitfun-phase={controller.phase}
      data-bitfun-state={[
        'active',
        recording && controller.lowVolumeWarning && 'low-volume',
      ].filter(Boolean).join(' ')}
      aria-live="polite"
    >
      <span
        className="bitfun-chat-input__voice-bar-status"
        data-bitfun-component="composer-voice-input"
        data-bitfun-part="status"
      >
        {controller.statusLabel}
      </span>
    </span>
  );
}

/**
 * Stop control for an active capture. It renders in the composer end actions so
 * it stays at the bottom-right corner of the input box.
 */
export function ComposerVoiceStopButton({ controller }: ComposerVoiceInputProps) {
  if (!controller.enabled || controller.phase !== 'recording') {
    return null;
  }

  return (
    <span
      className="bitfun-chat-input__voice-stop-action"
      data-bitfun-component="composer-voice-input"
      data-bitfun-part="action"
      data-bitfun-action="stop"
      data-bitfun-phase="recording"
    >
      <Tooltip content={controller.tooltip}>
        <ChatComposerActionButton
          aria-label={controller.tooltip}
          onClick={(event) => {
            event.stopPropagation();
            controller.transcribe();
          }}
          icon={<Icon name="mic" size="lg" />}
          variant="primary"
        />
      </Tooltip>
    </span>
  );
}
