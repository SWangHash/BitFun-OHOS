import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronRight, Folder } from 'lucide-react';
import { MobileBanner, MobileButton, MobileIconButton, MobileListRow, MobileSheet, MobileStatus } from '@openbitfun/ui/mobile';
import type { RemoteSessionManager } from '../services/RemoteSessionManager';
import { useI18n } from '../i18n';

interface DirectoryEntry { path: string; name: string; isDirectory: boolean }
interface DirectoryPage { children: DirectoryEntry[]; hasMore: boolean; offset: number; limit: number }

/** Browses the captured runtime/provider, never the controller's filesystem. */
export function WorkspaceFolderPicker({ manager, initialPath, remoteConnectionId, location, onSelect, onClose }: {
  manager: RemoteSessionManager; initialPath: string; remoteConnectionId?: string; location?: string;
  onSelect: (path: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [directory, setDirectory] = useState(initialPath);
  const [folders, setFolders] = useState<DirectoryEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [more, setMore] = useState(false);
  const nextOffset = useRef(0);
  const request = useRef(0);
  const targetEpoch = useRef(manager.controlTargetEpoch);
  const current = (id: number) => id === request.current && manager.controlTargetEpoch === targetEpoch.current;
  async function browse(path: string, append = false) {
    const id = ++request.current;
    setBusy(true); setError(undefined);
    if (!append) { setDirectory(path); setFolders([]); setLoaded(false); setMore(false); }
    try {
      const page = await manager.invokeHost<DirectoryPage>('get_directory_children_paginated', {
        path, remoteConnectionId, sortBy: 'name', sortOrder: 'asc', offset: append ? nextOffset.current : 0, limit: 100,
      });
      if (!current(id)) return;
      // The server cursor counts files as well as directories, even though this picker hides files.
      nextOffset.current = page.offset + page.children.length;
      setFolders(previous => append ? [...previous, ...page.children.filter(entry => entry.isDirectory)] : page.children.filter(entry => entry.isDirectory));
      setMore(page.hasMore); setLoaded(true);
    } catch (cause) {
      if (current(id)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (current(id)) setBusy(false); }
  }
  useEffect(() => {
    void browse(initialPath);
    return () => { request.current++; };
  }, []);
  const parent = directory.replace(/\/$/, '').replace(/\/[^/]*$/, '') || '/';
  return <MobileSheet open title={t('workspace.chooseFolder')} description={location} onOpenChange={onClose}
    className="workspace-folder-picker" footer={<div className="workspace-folder-picker__footer">
      <MobileButton appearance="plain" onClick={onClose}>{t('common.cancel')}</MobileButton>
      <MobileButton appearance="primary" disabled={busy || !loaded || !!error} onClick={() => {
        if (manager.controlTargetEpoch === targetEpoch.current) onSelect(directory);
      }}>{t('workspace.selectFolder')}</MobileButton>
    </div>}>
    <div className="workspace-folder-picker__path">
      <MobileIconButton appearance="plain" size="sm" icon={<ArrowUp size={18}/>} aria-label={t('workspace.parentFolder')}
        disabled={busy || directory === '/'} onClick={() => void browse(parent)}/>
      <span title={directory}>{directory}</span>
    </div>
    {error && <MobileBanner tone="danger">{error}<MobileButton size="sm" appearance="plain" onClick={() => void browse(directory)}>{t('devices.retry')}</MobileButton></MobileBanner>}
    <div className="workspace-folder-picker__list" aria-busy={busy}>
      {folders.map(folder => <MobileListRow key={folder.path} appearance="plain" label={folder.name} leading={<Folder size={20}/>}
        trailing={<ChevronRight size={16}/>} disabled={busy} onClick={() => void browse(folder.path)}/>)}
      {busy && <MobileStatus loading title={t('common.loading')}/>}
      {!busy && !error && !folders.length && <MobileStatus description={t('workspace.noSubfolders')}/>}
      {more && !busy && <MobileButton block appearance="plain" onClick={() => void browse(directory, true)}>{t('common.more')}</MobileButton>}
    </div>
  </MobileSheet>;
}
