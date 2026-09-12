import {
  CircleAlert as LucideCircleAlert,
  LogOut as LucideLogOut,
  SquarePen as LucideSquarePen,
  Trash2 as LucideTrash2,
} from 'lucide-react';
import React, { useRef } from 'react';
import {
  MobileActionSheet,
  MobileButton,
  MobileConfirmSheet,
  MobileSheet,
  MobileTextField,
} from '@openbitfun/ui/mobile';
import { useI18n } from '../i18n';
import type { SessionInfo } from '../services/RemoteSessionManager';
import HarnessProfilePicker from './HarnessProfilePicker';

interface SessionOverlaysProps {
  compact: boolean;
  deleteTarget: SessionInfo | null;
  deleting: boolean;
  harnessOpen: boolean;
  menuSession: SessionInfo | null;
  onCloseDelete: () => void;
  onCloseDisconnect: () => void;
  onCloseHarness: () => void;
  onCloseMenu: () => void;
  onCloseRename: () => void;
  onConfirmDelete: () => void;
  onConfirmDisconnect: () => void;
  onConfirmRename: () => void;
  onDeleteRequest: (session: SessionInfo) => void;
  onHarnessSelect: (agentType: string) => void;
  onRenameRequest: (session: SessionInfo) => void;
  onRenameValueChange: (value: string) => void;
  renameTarget: SessionInfo | null;
  renameValue: string;
  renaming: boolean;
  showDisconnectConfirm: boolean;
}

const RenameIcon = () => (
  <LucideSquarePen width="18" height="18" stroke="currentColor" aria-hidden="true" />
);

const DeleteIcon = () => (
  <LucideTrash2 width="18" height="18" stroke="currentColor" aria-hidden="true" />
);

const WarningIcon = () => (
  <LucideCircleAlert width="28" height="28" stroke="currentColor" aria-hidden="true" />
);

const DisconnectIcon = () => (
  <LucideLogOut width="28" height="28" stroke="currentColor" aria-hidden="true" />
);

function RenameSessionSheet({ compact, onClose, onConfirm, onValueChange, open, pending, value }: {
  compact: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onValueChange: (value: string) => void;
  open: boolean;
  pending: boolean;
  value: string;
}) {
  const { t } = useI18n();
  const compositionActiveRef = useRef(false);

  return (
    <MobileSheet
      className="session-list__rename-modal"
      footer={(
        <div className="session-list__rename-actions">
          <MobileButton className="session-list__rename-btn session-list__rename-btn--cancel" disabled={pending} onClick={onClose}>
            {t('sessions.cancel')}
          </MobileButton>
          <MobileButton appearance="primary" className="session-list__rename-btn session-list__rename-btn--save" disabled={pending || !value.trim()} loading={pending} onClick={onConfirm}>
            {t('sessions.save')}
          </MobileButton>
        </div>
      )}
      onOpenChange={() => !pending && onClose()}
      open={open}
      showHandle={compact}
      title={t('sessions.renameTitle')}
    >
      <MobileTextField
        appearance="surface"
        autoFocus
        className="session-list__rename-input"
        onChange={(event) => onValueChange(event.target.value)}
        onCompositionEnd={() => { compositionActiveRef.current = false; }}
        onCompositionStart={() => { compositionActiveRef.current = true; }}
        onKeyDown={(event) => {
          const nativeEvent = event.nativeEvent as KeyboardEvent;
          const imeOwned = compositionActiveRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;
          if ((event.key === 'Enter' || event.key === 'Escape') && imeOwned) {
            event.stopPropagation();
            return;
          }
          if (event.key === 'Enter' && value.trim() && !pending) onConfirm();
          if (event.key === 'Escape' && !pending) onClose();
        }}
        placeholder={t('sessions.sessionNamePlaceholder')}
        type="text"
        value={value}
      />
    </MobileSheet>
  );
}

export default function SessionOverlays({
  compact,
  deleteTarget,
  deleting,
  harnessOpen,
  menuSession,
  onCloseDelete,
  onCloseDisconnect,
  onCloseHarness,
  onCloseMenu,
  onCloseRename,
  onConfirmDelete,
  onConfirmDisconnect,
  onConfirmRename,
  onDeleteRequest,
  onHarnessSelect,
  onRenameRequest,
  onRenameValueChange,
  renameTarget,
  renameValue,
  renaming,
  showDisconnectConfirm,
}: SessionOverlaysProps) {
  const { t } = useI18n();

  return (
    <>
      <MobileActionSheet
        actions={menuSession ? [
          { id: 'rename', label: t('sessions.renameSession'), leading: <RenameIcon /> },
          { id: 'delete', label: t('sessions.deleteSession'), leading: <DeleteIcon />, tone: 'danger' },
        ] : []}
        cancelLabel={t('sessions.cancel')}
        onAction={(id) => {
          if (!menuSession) return;
          if (id === 'rename') onRenameRequest(menuSession);
          if (id === 'delete') onDeleteRequest(menuSession);
        }}
        onOpenChange={onCloseMenu}
        open={menuSession !== null && renameTarget === null && deleteTarget === null}
        title={menuSession?.name || t('sessions.untitledSession')}
      />

      <RenameSessionSheet compact={compact} onClose={onCloseRename} onConfirm={onConfirmRename} onValueChange={onRenameValueChange} open={renameTarget !== null} pending={renaming} value={renameValue} />

      <MobileConfirmSheet
        cancelLabel={t('sessions.cancel')}
        confirmLabel={t('sessions.deleteSession')}
        confirmTone="danger"
        description={deleteTarget ? <><strong>“{deleteTarget.name || t('sessions.untitledSession')}”</strong><br />{t('sessions.confirmDeleteDesc')}</> : undefined}
        icon={<WarningIcon />}
        onConfirm={onConfirmDelete}
        onOpenChange={onCloseDelete}
        open={deleteTarget !== null}
        pending={deleting}
        showHandle={compact}
        title={t('sessions.confirmDelete')}
      />

      <MobileConfirmSheet
        cancelLabel={t('common.cancel')}
        confirmLabel={t('sessions.disconnect')}
        confirmTone="danger"
        description={t('sessions.disconnectConfirm')}
        icon={<DisconnectIcon />}
        onConfirm={onConfirmDisconnect}
        onOpenChange={onCloseDisconnect}
        open={showDisconnectConfirm}
        showHandle={compact}
        title={t('sessions.disconnect')}
      />

      <HarnessProfilePicker open={harnessOpen} onClose={onCloseHarness} onSelect={onHarnessSelect} />
    </>
  );
}
