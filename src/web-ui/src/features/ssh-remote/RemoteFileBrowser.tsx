import { describeFileAccessError } from '@/infrastructure/services/business/fileAccessErrorPresentation';
import { desktopDomainErrorMessage } from '@/shared/ai-errors/desktopDomainErrors';
/**
 * Remote File Browser Component
 * Allows browsing and selecting directories on a remote SSH host
 */

import { captureConfirmationAnchor, subscribeOverlayInteraction, createOverlayPortal, Button, Dialog, DialogHeader, DialogHeading, DialogTitle, DialogClose, DialogBody, DialogFooter, Field, ConfirmDialog, Icon, IconButton, Input, Menu, MenuItem, MenuSeparator, ScrollArea } from '@bitfun/ui';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import { useI18n } from '@/infrastructure/i18n';
import { isOpenHarmonyRuntime, isWindowsDesktopRuntime } from '@/infrastructure/runtime';
import { confirmDialog } from '@/infrastructure/confirm-dialog/confirmDialogService';
import type { RemoteFileEntry } from './types';
import { sshApi } from './sshApi';
import {
  captureSshLocalFileHost,
  pickSshDownloadPath,
  pickSshUploadPaths,
  supportsSshFileDialogs,
  sshDownloadDestinationExists,
} from './sshFileDialogs';
import { isImeOwnedKeyboardEvent } from '@/shared/utils/ime';
import { createLogger } from '@/shared/utils/logger';
import { FolderOpen, Home, Loader2 } from 'lucide-react';
import './RemoteFileBrowser.scss';

const log = createLogger('RemoteFileBrowser');

interface RemoteFileBrowserProps {
  connectionId: string;
  initialPath: string;
  homePath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
  selectDirectoriesOnly?: boolean;
}

interface DeleteConfirmState {
  show: boolean;
  entry: RemoteFileEntry | null;
}

interface BrowserTransfer {
  cancelled: boolean;
  cancelPending: boolean;
  currentId: string | null;
}

function getRemoteParentPath(path: string): string | null {
  if (!path || path === '/' || path === '~') return null;
  const normalized = path.replace(/\/+$/, '');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) {
    return normalized.startsWith('~/') ? '~' : '/';
  }
  return normalized.slice(0, lastSlash) || '/';
}

function joinRemotePath(dir: string, name: string): string {
  if (!dir || dir === '/') return `/${name}`;
  if (dir === '~') return `~/${name}`;
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

export const RemoteFileBrowser: React.FC<RemoteFileBrowserProps> = ({
  connectionId,
  initialPath,
  homePath,
  onSelect,
  onCancel,
  selectDirectoriesOnly = false,
}) => {
  const homeAnchor = homePath ?? initialPath;
  const { t } = useI18n('common');
  const { t: tTools } = useI18n('tools');
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [pathInputValue, setPathInputValue] = useState(initialPath);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const textInputCompositionActiveRef = useRef(false);
  const [entries, setEntries] = useState<RemoteFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedConnectionId, setLoadedConnectionId] = useState<string | null>(null);
  const directoryRequestRef = useRef(0);
  const requestedPathRef = useRef(initialPath);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
    entry: RemoteFileEntry | null;
  }>({ show: false, x: 0, y: 0, entry: null });
  const [renameEntry, setRenameEntry] = useState<RemoteFileEntry | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteAnchor, setDeleteAnchor] = useState<ReturnType<typeof captureConfirmationAnchor>>(undefined);
  const [deleteConfirm, setDeleteConfirm] = useState<DeleteConfirmState>({
    show: false,
    entry: null,
  });
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferCancelling, setTransferCancelling] = useState(false);
  const activeTransferRef = useRef<BrowserTransfer | null>(null);
  const lifetimeRef = useRef({ active: true });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const beginTransfer = (): BrowserTransfer | null => {
    if (activeTransferRef.current || !lifetimeRef.current.active) return null;
    const transfer: BrowserTransfer = { cancelled: false, cancelPending: false, currentId: null };
    activeTransferRef.current = transfer;
    setTransferBusy(true);
    setTransferCancelling(false);
    setError(null);
    return transfer;
  };

  const endTransfer = (transfer: BrowserTransfer) => {
    if (activeTransferRef.current !== transfer) return;
    activeTransferRef.current = null;
    if (lifetimeRef.current.active) {
      setTransferBusy(false);
      setTransferCancelling(false);
    }
  };

  const stopTransfer = async () => {
    const transfer = activeTransferRef.current;
    if (!transfer || transfer.cancelPending) return;
    transfer.cancelled = true;
    transfer.cancelPending = true;
    setTransferCancelling(true);
    setError(null);
    try {
      if (transfer.currentId) await sshApi.cancelTransfer(transfer.currentId);
    } catch (error) {
      transfer.cancelPending = false;
      if (activeTransferRef.current === transfer && lifetimeRef.current.active) {
        setTransferCancelling(false);
        setError(describeFileAccessError(error));
      }
    }
  };

  // One-shot retry: when the SSH session was torn down by a transient network
  // blip, the backend transparently reconnects on the next call but the
  // initial request still fails. Give the listing request one more attempt so
  // that a transient disconnect does not surface as a hard error.
  const loadDirectory = useCallback(async (path: string) => {
    const lifetime = lifetimeRef.current;
    const requestId = ++directoryRequestRef.current;
    const isCurrent = () => lifetime.active && requestId === directoryRequestRef.current;
    requestedPathRef.current = path;
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    setIsEditingPath(false);
    const fetchOnce = () => sshApi.readDir(connectionId, path);
    try {
      let result: RemoteFileEntry[];
      try {
        result = await fetchOnce();
      } catch (firstError) {
        if (!isCurrent()) return;
        // Brief pause lets the backend complete its reconnect handshake before
        // we hammer it again.
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!isCurrent()) return;
        try {
          result = await fetchOnce();
        } catch {
          throw firstError;
        }
      }
      if (!isCurrent()) return;
      result.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(result);
      // READDIR follows directory links on the remote host. Commit navigation
      // only after it succeeds, retaining the link path and last usable listing
      // when a link is broken, points to a file, or cannot be accessed.
      setCurrentPath(path);
      setPathInputValue(path);
      setLoadedConnectionId(connectionId);
    } catch (e) {
      if (isCurrent()) setError(describeFileAccessError(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connectionId]);

  // Browsers own one connection at a time. Changing the connection or entry
  // path resets the listing, and disposal retires the in-flight transfer so no
  // remote operation outlives the surface that started it.
  useEffect(() => {
    const lifetime = { active: true };
    lifetimeRef.current = lifetime;
    setTransferBusy(false);
    setTransferCancelling(false);
    setEntries([]);
    setLoadedConnectionId(null);
    setCurrentPath(initialPath);
    setPathInputValue(initialPath);
    void loadDirectory(initialPath);
    return () => {
      lifetime.active = false;
      directoryRequestRef.current += 1;
      const transfer = activeTransferRef.current;
      activeTransferRef.current = null;
      if (!transfer) return;
      transfer.cancelled = true;
      if (transfer.currentId) {
        void sshApi.cancelTransfer(transfer.currentId).catch(error => {
          log.error('Failed to cancel SSH transfer after browser disposal', error);
        });
      }
    };
  }, [connectionId, initialPath, loadDirectory]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu({ show: false, x: 0, y: 0, entry: null });
      }
    };
    const removeOverlayMousedown0 = subscribeOverlayInteraction(contextMenuRef, 'mousedown', handleClickOutside);
    return () => removeOverlayMousedown0?.();
  }, []);

  const navigateTo = (path: string) => {
    void loadDirectory(path);
  };

  const handlePathInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      (e.key === 'Enter' || e.key === 'Escape')
      && isImeOwnedKeyboardEvent(e, textInputCompositionActiveRef.current)
    ) {
      e.stopPropagation();
      return;
    }
    if (e.key === 'Enter') {
      const val = pathInputValue.trim();
      if (val) {
        const nav = val.startsWith('~')
          ? val
          : val.startsWith('/')
            ? val
            : `/${val}`;
        navigateTo(nav);
      }
    } else if (e.key === 'Escape') {
      setPathInputValue(currentPath);
      setIsEditingPath(false);
    }
  };

  const handlePathInputBlur = () => {
    setPathInputValue(currentPath);
    setIsEditingPath(false);
  };

  const handleEntryClick = (entry: RemoteFileEntry) => {
    if (entry.isDir || (selectDirectoriesOnly && entry.isSymlink)) {
      navigateTo(entry.path);
    } else if (!selectDirectoriesOnly) {
      setSelectedPath(entry.path);
    }
    setContextMenu({ show: false, x: 0, y: 0, entry: null });
  };

  const handleEntryDoubleClick = (entry: RemoteFileEntry) => {
    if (entry.isDir || entry.isSymlink) {
      navigateTo(entry.path);
    }
  };

  const handleEntryKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, entry?: RemoteFileEntry) => {
    if (entry && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setContextMenu({ show: true, x: rect.left, y: rect.bottom, entry });
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(event.currentTarget.closest('table')?.querySelectorAll<HTMLButtonElement>('.remote-file-browser__entry-button') ?? [])];
    const current = buttons.indexOf(event.currentTarget);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    event.preventDefault();
    buttons[next]?.focus();
  };

  const beginPathEdit = () => {
    setIsEditingPath(true);
    setTimeout(() => pathInputRef.current?.select(), 0);
  };

  const handleContextMenu = (e: React.MouseEvent, entry: RemoteFileEntry) => {
    e.preventDefault();
    setContextMenu({
      show: true,
      x: e.clientX,
      y: e.clientY,
      entry,
    });
  };

  const handleDownloadEntry = async (entry: RemoteFileEntry) => {
    if (entry.isDir || activeTransferRef.current) return;
    if (!supportsSshFileDialogs()) {
      setError(t('ssh.remote.transferNeedsDesktop'));
      return;
    }
    setError(null);
    const lifetime = lifetimeRef.current;
    let transfer: BrowserTransfer | null = null;
    try {
      const surface = captureSshLocalFileHost();
      const localPath = await pickSshDownloadPath(entry.name, t('ssh.remote.downloadDialogTitle'));
      if (localPath === null || !lifetime.active) return;
      surface.assertCurrent('SSH file download');
      if (isOpenHarmonyRuntime() && await sshDownloadDestinationExists(localPath)) {
        if (!lifetime.active) return;
        surface.assertCurrent('SSH file download');
        const overwrite = await confirmDialog({
          title: t('ssh.remote.download'),
          message: t('errors:file.alreadyExists', { path: localPath }),
          confirmText: tTools('editor.codeEditor.overwriteSave'),
          cancelText: t('actions.cancel'),
          type: 'warning',
          confirmDanger: true,
        });
        if (!overwrite || !lifetime.active) return;
      }
      if (!lifetime.active) return;
      surface.assertCurrent('SSH file download');
      transfer = beginTransfer();
      if (!transfer) return;
      const activeTransfer = transfer;
      activeTransfer.currentId = crypto.randomUUID();
      await sshApi.downloadToLocalPath(connectionId, entry.path, localPath, undefined,
        activeTransfer.currentId, () => activeTransfer.cancelled);
    } catch (e) {
      const message = describeFileAccessError(e);
      if (lifetime.active && !(transfer?.cancelled && message === 'Transfer cancelled')) setError(message);
    } finally {
      if (transfer) endTransfer(transfer);
    }
  };

  const handleContextMenuAction = async (action: string, trigger?: HTMLElement) => {
    const anchor = captureConfirmationAnchor(trigger);
    if (!contextMenu.entry) return;

    const entry = contextMenu.entry;
    setContextMenu({ show: false, x: 0, y: 0, entry: null });

    try {
      switch (action) {
        case 'delete':
          setDeleteAnchor(anchor);
          setDeleteConfirm({ show: true, entry });
          break;
        case 'open':
          if (entry.isDir || entry.isSymlink) {
            navigateTo(entry.path);
          } else if (!selectDirectoriesOnly) {
            onSelect(entry.path);
          }
          break;
        case 'rename':
          setRenameEntry(entry);
          setRenameValue(entry.name);
          break;
        case 'download': {
          await handleDownloadEntry(entry);
          break;
        }
      }
    } catch (e) {
      setError(describeFileAccessError(e));
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm.entry) return;
    const entry = deleteConfirm.entry;
    setDeleteConfirm({ show: false, entry: null });

    try {
      await sshApi.remove(connectionId, entry.path, entry.isDir);
      await loadDirectory(requestedPathRef.current);
    } catch (e) {
      setError(describeFileAccessError(e));
    }
  };

  const handleRename = async () => {
    if (!renameEntry || !renameValue.trim()) return;
    if (renameValue.trim() === renameEntry.name) {
      setRenameEntry(null);
      return;
    }

    const parentPath = getRemoteParentPath(renameEntry.path) ?? '/';
    const newPath = parentPath.endsWith('/')
      ? `${parentPath}${renameValue.trim()}`
      : `${parentPath}/${renameValue.trim()}`;

    try {
      await sshApi.rename(connectionId, renameEntry.path, newPath);
      setRenameEntry(null);
      await loadDirectory(requestedPathRef.current);
    } catch (e) {
      setError(describeFileAccessError(e));
    }
  };

  const handleUploadToCurrentDir = async () => {
    if (activeTransferRef.current) return;
    if (!supportsSshFileDialogs()) {
      setError(t('ssh.remote.transferNeedsDesktop'));
      return;
    }
    setError(null);
    const lifetime = lifetimeRef.current;
    let transfer: BrowserTransfer | null = null;
    try {
      const surface = captureSshLocalFileHost();
      const paths = await pickSshUploadPaths(t('ssh.remote.uploadDialogTitle'));
      if (paths.length === 0 || !lifetime.active) return;
      transfer = beginTransfer();
      if (!transfer) return;
      const activeTransfer = transfer;
      for (const localPath of paths) {
        if (activeTransfer.cancelled) break;
        surface.assertCurrent('SSH file upload');
        const segments = localPath.split(isWindowsDesktopRuntime() ? /[/\\]/ : '/');
        const base = segments.pop();
        if (!base) continue;
        const remotePath = joinRemotePath(currentPath, base);
        activeTransfer.currentId = crypto.randomUUID();
        await sshApi.uploadFromLocalPath(connectionId, localPath, remotePath, undefined,
          activeTransfer.currentId, () => activeTransfer.cancelled);
        activeTransfer.currentId = null;
      }
      endTransfer(activeTransfer);
      if (lifetime.active && !activeTransfer.cancelled) await loadDirectory(requestedPathRef.current);
    } catch (e) {
      const message = describeFileAccessError(e);
      if (lifetime.active && !(transfer?.cancelled && message === 'Transfer cancelled')) setError(message);
    } finally {
      if (transfer) endTransfer(transfer);
    }
  };

  const openSelectedWorkspace = () => {
    if (loading || transferBusy || loadedConnectionId !== connectionId) return;
    onSelect(selectDirectoriesOnly ? currentPath : (selectedPath || currentPath));
  };

  const formatFileSize = (bytes?: number): string => {
    if (bytes === undefined || bytes === null) return '-';
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  };

  const formatDate = (timestamp?: number): string => {
    if (!timestamp) return '-';
    const d = new Date(timestamp);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  };

  const getEntryIcon = (entry: RemoteFileEntry) => {
    if (entry.isDir) return <Icon name="folder" size="lg" className="remote-file-browser__entry-icon" />;
    if (entry.isSymlink) return <Icon name="link" size="lg" className="remote-file-browser__entry-icon remote-file-browser__entry-icon--link" />;
    return <Icon name="files" size="lg" className="remote-file-browser__entry-icon remote-file-browser__entry-icon--file" />;
  };

  const pathParts = (() => {
    if (currentPath === '/' || currentPath === '') return [];
    if (currentPath === '~') return ['~'];
    if (currentPath.startsWith('~/')) {
      return ['~', ...currentPath.slice(2).split('/').filter(Boolean)];
    }
    return currentPath.split('/').filter(Boolean);
  })();

  const pathAtSegment = (index: number) => {
    if (pathParts[0] === '~') {
      if (index === 0) return '~';
      return `~/${pathParts.slice(1, index + 1).join('/')}`;
    }
    return `/${pathParts.slice(0, index + 1).join('/')}`;
  };

  return (
    <Dialog ref={surfaceRef} open size="lg" className="remote-file-browser" onOpenChange={() => onCancel()}>
      {/* Keep product Appearance parts on neutral wrappers; Dialog owns modal anatomy. */}
      <div className="remote-file-browser__layout" data-bitfun-component="ssh-remote" data-bitfun-part="browserOverlay">
      <div className="remote-file-browser__layout" data-bitfun-component="ssh-remote" data-bitfun-part="browser">
        {/* Header */}
        <div data-bitfun-component="ssh-remote" data-bitfun-part="browserHeader">
          <DialogHeader separator>
            <DialogHeading><DialogTitle>{t('ssh.remote.selectWorkspace')}</DialogTitle></DialogHeading>
            <span data-bitfun-component="ssh-remote" data-bitfun-part="browserClose">
              <DialogClose className="remote-file-browser__close-btn" aria-label={t('actions.close')} />
            </span>
          </DialogHeader>
        </div>

        <DialogBody inset="none" className="remote-file-browser__body">

        {/* Path Breadcrumb / Input */}
        <ScrollArea
          className="remote-file-browser__breadcrumb"
          data-bitfun-component="ssh-remote"
          data-bitfun-part="breadcrumb"
          orientation="horizontal"
          scrollbarVisibility="hidden"
        >
          {isEditingPath ? (
            <Input
              ref={pathInputRef}
              size="sm"
              aria-label={t('peerDirectoryPicker.path')}
              className="remote-file-browser__path-input-field"
              value={pathInputValue}
              onValueChange={setPathInputValue}
              onKeyDown={handlePathInputKeyDown}
              onCompositionStart={() => {
                textInputCompositionActiveRef.current = true;
              }}
              onCompositionEnd={() => {
                textInputCompositionActiveRef.current = false;
              }}
              onBlur={handlePathInputBlur}
              autoFocus
              spellCheck={false}
            />
          ) : (
            <div
              className="remote-file-browser__breadcrumb-path"
              onClick={beginPathEdit}
              title={t('ssh.remote.clickToEditPath') || 'Click to edit path'}
            >
              <IconButton
                className="remote-file-browser__breadcrumb-btn"
                onClick={(e) => { e.stopPropagation(); navigateTo(homeAnchor); }}
                title={t('ssh.remote.homeFolder') || 'Home folder'}
                aria-label={t('ssh.remote.homeFolder')}
                icon={<Home size={14} />}
              />
              <Icon name="chevron-right" size="xs" className="remote-file-browser__breadcrumb-sep" />
              {pathParts.length === 0 ? (
                <span className="remote-file-browser__breadcrumb-current">/</span>
              ) : (
                pathParts.map((part, index) => {
                  const segPath = pathAtSegment(index);
                  const isLast = index === pathParts.length - 1;
                  return (
                    <React.Fragment key={segPath}>
                      <button
                        className={`remote-file-browser__breadcrumb-btn ${isLast ? 'remote-file-browser__breadcrumb-btn--current' : ''}`}
                        onClick={(e) => { e.stopPropagation(); navigateTo(segPath); }}
                      >
                        {part}
                      </button>
                      {!isLast && <Icon name="chevron-right" size="xs" className="remote-file-browser__breadcrumb-sep" />}
                    </React.Fragment>
                  );
                })
              )}
              <IconButton aria-label={t('ssh.remote.clickToEditPath')} size="sm" variant="quiet"
                icon={<Icon name="edit" size="sm" />}
                onClick={event => { event.stopPropagation(); beginPathEdit(); }} />
            </div>
          )}
        </ScrollArea>

        {/* Toolbar */}
        <div className="remote-file-browser__toolbar" data-bitfun-component="ssh-remote" data-bitfun-part="toolbar">
          <IconButton
            className="remote-file-browser__toolbar-btn"
            onClick={() => loadDirectory(currentPath)}
            title={t('actions.refresh')}
            disabled={transferBusy}
            aria-label={t('actions.refresh')}
            icon={<Icon name="refresh" size="md" />}
          />
          <IconButton
            className="remote-file-browser__toolbar-btn"
            onClick={() => {
              const p = getRemoteParentPath(currentPath);
              if (p !== null) navigateTo(p);
            }}
            title={t('newProject.parentDirectory')}
            disabled={getRemoteParentPath(currentPath) === null || transferBusy}
            aria-label={t('newProject.parentDirectory')}
            icon={<Icon name="arrow-left" size="md" />}
          />
          <IconButton
            type="button"
            className="remote-file-browser__toolbar-btn"
            onClick={() => void handleUploadToCurrentDir()}
            title={t('ssh.remote.upload')}
            disabled={transferBusy}
            aria-label={t('ssh.remote.upload')}
            icon={<Icon name="upload" size="md" />}
          />
        </div>

        {transferBusy && (
          <div className="remote-file-browser__transfer-status">
            <Loader2 size={16} className="remote-file-browser__spinner-inline" />
            <span>{t('ssh.remote.transferring')}</span>
            <Button
              variant="fill"
              size="sm"
              onClick={() => void stopTransfer()}
              disabled={transferCancelling}
              style={{ marginLeft: 'auto' }}
              data-testid="ssh-file-transfer-stop"
            >
              {t('actions.cancel')}
            </Button>
          </div>
        )}

        {/* File List */}
        <ScrollArea className="remote-file-browser__content" data-bitfun-component="ssh-remote" data-bitfun-part="content">
          {error && (
            <div className="remote-file-browser__error" role="alert">
              <span>{desktopDomainErrorMessage(error, t)}</span>
              <IconButton
                type="button"
                onClick={() => loadDirectory(requestedPathRef.current)}
                disabled={transferBusy}
                title={t('actions.retry') || 'Retry'}
                style={{ marginLeft: 'auto', marginRight: 8 }}
                aria-label={t('actions.retry')}
                icon={<Icon name="refresh" size="sm" />}
              />
              <IconButton
                onClick={() => setError(null)}
                aria-label={t('actions.close')}
                icon={'×'}
              />
            </div>
          )}

          {loading ? (
            <div className="remote-file-browser__loading">
              <Loader2 size={32} className="remote-file-browser__spinner" />
              <span>{t('app.loading')}</span>
            </div>
          ) : (
            <table className="remote-file-browser__table">
              <thead className="remote-file-browser__thead">
                <tr>
                  <th className="remote-file-browser__th remote-file-browser__th--name">
                    {t('ssh.remote.name')}
                  </th>
                  <th className="remote-file-browser__th remote-file-browser__th--size">
                    {t('ssh.remote.size')}
                  </th>
                  <th className="remote-file-browser__th remote-file-browser__th--date">
                    {t('ssh.remote.modified')}
                  </th>
                </tr>
              </thead>
              <tbody className="remote-file-browser__tbody">
                {/* Parent directory link */}
                {getRemoteParentPath(currentPath) !== null && (
                  <tr
                    onClick={() => {
                      const parent = getRemoteParentPath(currentPath);
                      if (parent !== null) navigateTo(parent);
                    }}
                    className="remote-file-browser__row remote-file-browser__row--parent"
                  >
                    <td colSpan={3} className="remote-file-browser__td remote-file-browser__td--name">
                      <Button variant="quiet" size="sm" className="remote-file-browser__entry-button"
                        leadingIcon={<Icon name="folder" size="md" className="remote-file-browser__entry-icon remote-file-browser__entry-icon--parent" />}
                        onKeyDown={event => handleEntryKeyDown(event)}
                        onClick={event => {
                          event.stopPropagation();
                          const parent = getRemoteParentPath(currentPath);
                          if (parent !== null) navigateTo(parent);
                        }}>
                        <span className="remote-file-browser__name">..</span>
                      </Button>
                    </td>
                  </tr>
                )}
                {entries.map((entry) => (
                  <tr
                    key={entry.path}
                    onClick={() => handleEntryClick(entry)}
                    onDoubleClick={() => handleEntryDoubleClick(entry)}
                    onContextMenu={(e) => handleContextMenu(e, entry)}
                    className={`remote-file-browser__row ${selectedPath === entry.path ? 'remote-file-browser__row--selected' : ''}`}
                  >
                    <td className="remote-file-browser__td remote-file-browser__td--name">
                      <Button variant="quiet" size="sm" className="remote-file-browser__entry-button"
                        leadingIcon={getEntryIcon(entry)}
                        onKeyDown={event => handleEntryKeyDown(event, entry)}
                        onClick={event => { event.stopPropagation(); handleEntryClick(entry); }}>
                        <span className="remote-file-browser__name">{entry.name}</span>
                      </Button>
                    </td>
                    <td className="remote-file-browser__td remote-file-browser__td--size">
                      {entry.isDir ? '-' : formatFileSize(entry.size)}
                    </td>
                    <td className="remote-file-browser__td remote-file-browser__td--date">
                      {formatDate(entry.modified)}
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && !loading && !error && loadedConnectionId === connectionId && (
                  <tr>
                    <td colSpan={3} className="remote-file-browser__empty">
                      {t('ssh.remote.emptyDirectory')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </ScrollArea>
        </DialogBody>

        {/* Context Menu */}
        {contextMenu.show && contextMenu.entry && createOverlayPortal(
          <Menu
            ref={contextMenuRef}
            className="remote-file-browser__context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            aria-label={contextMenu.entry.name}
            autoFocusFirstItem
          >
            {(contextMenu.entry.isDir || contextMenu.entry.isSymlink || !selectDirectoriesOnly) && (
              <MenuItem
                leading={<FolderOpen size={14} aria-hidden />}
                onClick={() => handleContextMenuAction('open')}
              >
                {t('actions.open') || 'Open'}
              </MenuItem>
            )}
            {!contextMenu.entry.isDir && (
              <MenuItem
                leading={<Icon name="arrow-down" size="sm" aria-hidden />}
                onClick={() => handleContextMenuAction('download')}
              >
                {t('ssh.remote.download')}
              </MenuItem>
            )}
            <MenuItem
              leading={<Icon name="edit" size="sm" aria-hidden />}
              onClick={() => handleContextMenuAction('rename')}
            >
              {t('ssh.remote.rename')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              leading={<Icon name="delete" size="sm" aria-hidden />}
              tone="danger"
              onClick={event => handleContextMenuAction('delete', event.currentTarget)}
            >
              {t('actions.delete') || 'Delete'}
            </MenuItem>
          </Menu>,
          getAppearanceOverlayHost(),
          null,
          { ownerRef: surfaceRef },
        )}

        {/* Rename Dialog */}
        {renameEntry && (
          <Dialog
            open
            onOpenChange={() => setRenameEntry(null)}
            aria-label={t('ssh.remote.rename')}
            className="remote-file-browser__dialog"
            portalTarget={getAppearanceOverlayHost()}
            initialFocusRef={renameInputRef}
            size="sm"
            closeOnEscape={false}
            closeOnPointerOutside={false}
          >
              <DialogHeader>
                <DialogHeading><DialogTitle>{t('ssh.remote.rename')}</DialogTitle></DialogHeading>
                <DialogClose aria-label={t('actions.close')} />
              </DialogHeader>
              <DialogBody>
              <Field label={t('ssh.remote.name')} controlWidth="fill">
              <Input
                ref={renameInputRef}
                size="md"
                type="text"
                value={renameValue}
                onValueChange={setRenameValue}
                onKeyDown={(e) => {
                  if (
                    (e.key === 'Enter' || e.key === 'Escape')
                    && isImeOwnedKeyboardEvent(e, textInputCompositionActiveRef.current)
                  ) {
                    e.stopPropagation();
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === 'Enter') void handleRename();
                    else setRenameEntry(null);
                  }
                }}
                onCompositionStart={() => {
                  textInputCompositionActiveRef.current = true;
                }}
                onCompositionEnd={() => {
                  textInputCompositionActiveRef.current = false;
                }}
              />
              </Field>
              </DialogBody>
              <DialogFooter>
                <Button variant="fill" size="sm" onClick={() => setRenameEntry(null)}>
                  {t('actions.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleRename}
                  disabled={!renameValue.trim() || renameValue.trim() === renameEntry.name}
                >
                  {t('actions.confirm')}
                </Button>
              </DialogFooter>
          </Dialog>
        )}

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          anchor={deleteAnchor}
          open={deleteConfirm.show}
          title={t('ssh.remote.deleteTitle') || 'Delete'}
          message={deleteConfirm.entry
            ? t('ssh.remote.deleteConfirm') || `Delete "${deleteConfirm.entry.name}"?`
            : ''
          }
          confirmText={t('actions.delete') || 'Delete'}
          cancelText={t('actions.cancel')}
          onConfirm={handleDeleteConfirm}
          onOpenChange={() => setDeleteConfirm({ show: false, entry: null })}
          confirmDanger
          type="error"
        />

        {/* Footer */}
        <div data-bitfun-component="ssh-remote" data-bitfun-part="footer">
        <DialogFooter separator className="remote-file-browser__footer">
          <div className="remote-file-browser__footer-info">
            {!selectDirectoriesOnly && selectedPath ? (
              <>
                <span className="remote-file-browser__footer-label">{t('ssh.remote.selected')}: </span>
                <span className="remote-file-browser__footer-path">{selectedPath}</span>
              </>
            ) : (
              <span className="remote-file-browser__footer-hint">
                {selectDirectoriesOnly ? currentPath : t('ssh.remote.clickToSelect')}
              </span>
            )}
          </div>
          <div className="remote-file-browser__footer-actions">
            <Button variant="fill" size="sm" onClick={onCancel}>
              {t('actions.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={openSelectedWorkspace}
              disabled={loading || transferBusy || loadedConnectionId !== connectionId}
            >
              {t('ssh.remote.openWorkspace')}
            </Button>
          </div>
        </DialogFooter>
        </div>
      </div>
      </div>
    </Dialog>
  );
};

export default RemoteFileBrowser;
