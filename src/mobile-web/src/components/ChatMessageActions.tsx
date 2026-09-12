import { Copy as LucideCopy, RotateCw as LucideRotateCw, Trash2 as LucideTrash2 } from 'lucide-react';
import React from 'react';
import { MobileActionSheet, type MobileActionSheetItem } from '@openbitfun/ui/mobile';
import { useI18n } from '../i18n';
import type { ChatMessage } from '../services/RemoteSessionManager';

interface ChatMessageActionsProps {
  deleting: boolean;
  message: ChatMessage | null;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onResend: () => void;
}

const CopyIcon = () => <LucideCopy width="18" height="18" stroke="currentColor" aria-hidden="true" />;
const ResendIcon = () => <LucideRotateCw width="18" height="18" stroke="currentColor" aria-hidden="true" />;
const DeleteIcon = () => <LucideTrash2 width="18" height="18" stroke="currentColor" aria-hidden="true" />;

export default function ChatMessageActions({ deleting, message, onClose, onCopy, onDelete, onResend }: ChatMessageActionsProps) {
  const { t } = useI18n();
  const actions: MobileActionSheetItem[] = message ? [
    { id: 'copy', label: t('chat.copyMessage'), leading: <CopyIcon /> },
    ...(message.role === 'user' ? [{ id: 'resend', label: t('chat.resendMessage'), leading: <ResendIcon /> }] : []),
    { disabled: deleting, id: 'delete', label: deleting ? '...' : t('chat.deleteMessage'), leading: <DeleteIcon />, tone: 'danger' },
  ] : [];

  return (
    <MobileActionSheet
      actions={actions}
      cancelLabel={t('common.cancel')}
      closeOnAction={false}
      onAction={(id) => {
        if (id === 'copy') onCopy();
        if (id === 'resend') onResend();
        if (id === 'delete') onDelete();
      }}
      onOpenChange={onClose}
      open={message !== null}
      title={t('common.more')}
    />
  );
}
