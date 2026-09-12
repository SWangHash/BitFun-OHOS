import { X as LucideX } from 'lucide-react';
import React from 'react';
import { useI18n } from '../i18n';
import { MobileBanner, MobileIconButton } from '@openbitfun/ui/mobile';

interface ChatFeedbackProps {
  actionMessage: string | null;
  errorMessage: string | null;
  infoMessage: string | null;
  onDismissError: () => void;
  onDismissInfo: () => void;
}

export default function ChatFeedback({ actionMessage, errorMessage, infoMessage, onDismissError, onDismissInfo }: ChatFeedbackProps) {
  const { t } = useI18n();
  const closeAction = (onClose: () => void) => <MobileIconButton appearance="plain" onClick={onClose} aria-label={t('common.close')} icon={<LucideX stroke="currentColor" aria-hidden="true" />} />;
  return (
    <>
      {actionMessage && <MobileBanner className="chat-page__toast" role="status" aria-live="polite" tone="neutral">{actionMessage}</MobileBanner>}
      {errorMessage && <MobileBanner className="chat-page__toast" action={closeAction(onDismissError)} role="alert" tone="danger">{errorMessage}</MobileBanner>}
      {infoMessage && <MobileBanner className="chat-page__toast" action={closeAction(onDismissInfo)} role="status" tone="info">{infoMessage}</MobileBanner>}
    </>
  );
}
