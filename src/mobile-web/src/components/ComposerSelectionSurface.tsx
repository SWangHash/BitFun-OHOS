import { X as LucideX } from 'lucide-react';
import React from 'react';
import { MobileIconButton, MobileSheet } from '@openbitfun/ui/mobile';
import { useWideLayout } from '../hooks/useWideLayout';
import { useI18n } from '../i18n';
import ComposerAnchoredMenu from './ComposerAnchoredMenu';

interface Props {
  anchorRef: React.RefObject<HTMLDivElement>;
  id: string;
  label: string;
  width: number;
  onClose: () => void;
  children: React.ReactNode;
}

/** Keep touch selection spacious while retaining anchored controls in wide layouts. */
export default function ComposerSelectionSurface(props: Props) {
  const wide = useWideLayout();
  const { t } = useI18n();

  if (wide) return <ComposerAnchoredMenu {...props} />;

  return (
    <MobileSheet
      open
      id={props.id}
      title={props.label}
      className="chat-composer-sheet"
      data-composer-popover="true"
      onOpenChange={props.onClose}
      headerAction={(
        <MobileIconButton
          appearance="plain"
          className="chat-composer-sheet__close"
          aria-label={t('common.close')}
          onClick={props.onClose}
          icon={<LucideX stroke="currentColor" aria-hidden="true" />}
        />
      )}
    >
      {props.children}
    </MobileSheet>
  );
}
