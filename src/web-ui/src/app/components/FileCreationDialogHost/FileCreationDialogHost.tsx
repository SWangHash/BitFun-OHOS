/**
 * Global host for file/folder creation dialogs.
 *
 * The "New File" and "New Folder" InputDialogs were previously owned by
 * FilesPanel, which is only mounted inside WorkspaceResourcePanel (the
 * file-viewer scene's SceneNav). When a session switch calls
 * `openScene('session')`, WorkspaceResourcePanel unmounts and the dialog
 * can no longer be opened — even though the globalEventBus event still fires.
 *
 * This host is always mounted in AppLayout and listens to the same
 * `file:new-file` / `file:new-folder` events, so the dialog is available
 * regardless of which scene is active.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { InputDialog } from '@/app/components/InputDialog';
import { useCurrentWorkspace } from '@/infrastructure/contexts/WorkspaceContext';
import { workspaceAPI } from '@/infrastructure/api';
import { globalEventBus } from '@/infrastructure/event-bus';
import { notificationService } from '@/shared/notification-system';
import { useI18n } from '@/infrastructure/i18n';
import { isRemoteWorkspace } from '@/shared/types';
import { joinWorkspaceTargetPath } from '@/tools/file-system/services/workspaceFileTransfer';
import { validateFileName } from '@/tools/file-system/utils/validateFileName';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('FileCreationDialogHost');

interface DialogState {
  isOpen: boolean;
  type: 'newFile' | 'newFolder' | null;
  parentPath: string;
  siblings?: string[];
}

const CLOSED_STATE: DialogState = {
  isOpen: false,
  type: null,
  parentPath: '',
};

export const FileCreationDialogHost: React.FC = () => {
  const { workspace } = useCurrentWorkspace();
  const { t } = useI18n('panels/files');
  const [dialog, setDialog] = useState<DialogState>(CLOSED_STATE);

  useEffect(() => {
    const handleNewFile = (data: { parentPath: string; siblings?: string[] }): void => {
      flushSync(() => setDialog({ isOpen: true, type: 'newFile', parentPath: data.parentPath, siblings: data.siblings }));
    };
    const handleNewFolder = (data: { parentPath: string; siblings?: string[] }): void => {
      flushSync(() => setDialog({ isOpen: true, type: 'newFolder', parentPath: data.parentPath, siblings: data.siblings }));
    };
    globalEventBus.on('file:new-file', handleNewFile);
    globalEventBus.on('file:new-folder', handleNewFolder);
    return () => {
      globalEventBus.off('file:new-file', handleNewFile);
      globalEventBus.off('file:new-folder', handleNewFolder);
    };
  }, []);

  const handleClose = useCallback(() => {
    setDialog(CLOSED_STATE);
  }, []);

  // Emitters that hold the file tree (toolbar, context menu) pass the parent's
  // child names; other entry points (global commands) do not. Fetch them once
  // per open so the duplicate-name rule applies everywhere.
  useEffect(() => {
    if (!dialog.isOpen || !workspace || dialog.siblings) {
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const page = await workspaceAPI.getDirectoryChildrenPaginated(workspace.id, dialog.parentPath, 0, 1000);
        if (!disposed) {
          setDialog(previous => (
            previous.isOpen && previous.parentPath === dialog.parentPath
              ? { ...previous, siblings: page.children.map(child => child.name) }
              : previous
          ));
        }
      } catch (error) {
        log.warn('Failed to list parent directory for duplicate check', { path: dialog.parentPath, error: String(error) });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [dialog.isOpen, dialog.parentPath, dialog.siblings, workspace]);

  const handleConfirm = useCallback(async (value: string) => {
    if (!workspace) {
      log.error('No active workspace when confirming file creation');
      notificationService.error(t('notifications.createFileFailed', { error: 'No active workspace' }));
      handleClose();
      return;
    }
    const targetPath = joinWorkspaceTargetPath(dialog.parentPath, value, isRemoteWorkspace(workspace));
    try {
      if (dialog.type === 'newFile') {
        await workspaceAPI.createWorkspaceFile(workspace.id, targetPath);
        log.info('File created', { path: targetPath });
      } else if (dialog.type === 'newFolder') {
        await workspaceAPI.createWorkspaceDirectory(workspace.id, targetPath);
        log.info('Directory created', { path: targetPath });
      }
      handleClose();
      globalEventBus.emit('file-tree:refresh', {});
    } catch (error) {
      log.error('Failed to create file/folder', error);
      const message = dialog.type === 'newFile'
        ? t('notifications.createFileFailed', { error: String(error) })
        : t('notifications.createFolderFailed', { error: String(error) });
      notificationService.error(message);
    }
  }, [workspace, dialog.parentPath, dialog.type, handleClose, t]);

  const isRemote = workspace ? isRemoteWorkspace(workspace) : false;

  return (
    <InputDialog
      isOpen={dialog.isOpen}
      onClose={handleClose}
      onConfirm={handleConfirm}
      title={dialog.type === 'newFile' ? t('dialog.newFile.title') : t('dialog.newFolder.title')}
      placeholder={dialog.type === 'newFile' ? t('dialog.newFile.placeholder') : t('dialog.newFolder.placeholder')}
      confirmText={dialog.type === 'newFile' ? t('dialog.newFile.confirm') : t('dialog.newFolder.confirm')}
      cancelText={dialog.type === 'newFile' ? t('dialog.newFile.cancel') : t('dialog.newFolder.cancel')}
      validator={(value) => {
        const validationError = validateFileName(value, {
          isRemote,
          isDirectory: dialog.type === 'newFolder',
          siblings: dialog.siblings,
        });
        return validationError ? t(validationError, { name: value.trim() }) : null;
      }}
    />
  );
};

export default FileCreationDialogHost;
