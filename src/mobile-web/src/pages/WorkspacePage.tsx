import { Folder as LucideFolder, X as LucideX } from 'lucide-react';
import React, { useEffect, useState, useCallback } from 'react';
import { MobileBanner, MobileIconButton, MobileListRow, MobilePageHeader, MobileStatus } from '@openbitfun/ui/mobile';
import { useI18n } from '../i18n';
import { useMobileStore } from '../services/store';
import {
  RemoteSessionManager,
  WorkspaceInfo,
  RecentWorkspaceEntry,
} from '../services/RemoteSessionManager';

interface WorkspacePageProps {
  sessionMgr: RemoteSessionManager;
  onReady: () => void;
  onBack?: () => void;
}

const WorkspacePage: React.FC<WorkspacePageProps> = ({ sessionMgr, onReady, onBack }) => {
  const { t } = useI18n();
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspaceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controlTarget = useMobileStore((state) => state.controlTarget);

  const loadWorkspaceInfo = useCallback(async () => {
    try {
      const info = await sessionMgr.getWorkspaceInfo();
      setWorkspaceInfo(info);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sessionMgr]);

  const loadRecentWorkspaces = useCallback(async () => {
    try {
      const list = await sessionMgr.listRecentWorkspaces();
      setRecentWorkspaces(list);
    } catch (e: any) {
      setError(e.message);
    }
  }, [sessionMgr]);

  useEffect(() => {
    void Promise.all([loadWorkspaceInfo(), loadRecentWorkspaces()]);
  }, [loadRecentWorkspaces, loadWorkspaceInfo]);

  const handleSelectWorkspace = useCallback(async (workspace: RecentWorkspaceEntry) => {
    if (switching) return;
    setSwitching(true);
    setError(null);
    try {
      const result = await sessionMgr.setWorkspace(workspace.path, {
        remoteConnectionId: workspace.remote_connection_id,
        remoteSshHost: workspace.remote_ssh_host,
      });
      if (result.success) {
        await loadWorkspaceInfo();
        onReady();
      } else {
        setError(result.error || t('workspace.failedToSetWorkspace'));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSwitching(false);
    }
  }, [loadWorkspaceInfo, onReady, sessionMgr, switching, t]);

  if (loading) {
    return (
      <div className="workspace-page">
        <MobileStatus className="workspace-page__loading" loading title={t('workspace.loadingInfo')} />
      </div>
    );
  }

  return (
    <div className="workspace-page">
      <div className="workspace-page__sheet">
        <MobilePageHeader
          className="workspace-page__header"
          title={t('workspace.selectWorkspace')}
          subtitle={controlTarget?.deviceName}
          actions={onBack ? (
            <MobileIconButton
              appearance="surface"
              className="workspace-page__close"
              icon={<LucideX stroke="currentColor" aria-hidden="true" />}
              onClick={onBack}
              size="sm"
              aria-label={t('common.close')}
            />
          ) : undefined}
        />

        <div className="workspace-page__divider" />
        <div className="workspace-page__content">
          {recentWorkspaces.length === 0 ? (
            <MobileStatus className="workspace-page__recent-empty" description={t('workspace.noRecentWorkspaces')} />
          ) : (
            <div className="workspace-page__recent-list">
              {recentWorkspaces.map((ws) => {
                const selected = workspaceInfo?.path === ws.path;
                return (
                  <MobileListRow
                    key={`${ws.remote_connection_id ?? 'local'}:${ws.path}`}
                    appearance="plain"
                    className={`workspace-page__recent-item${selected ? ' is-selected' : ''}`}
                    onClick={() => handleSelectWorkspace(ws)}
                    disabled={switching}
                    selected={selected}
                    leading={<span className="workspace-page__recent-item-icon" aria-hidden="true">
                      <LucideFolder width="22" height="22" stroke="currentColor" aria-hidden="true" />
                    </span>}
                    label={<span className="workspace-page__recent-item-name">{ws.name}</span>}
                    supportingText={<span className="workspace-page__recent-item-path">{ws.path}</span>}
                    trailing={<span className="workspace-page__recent-item-trailing" aria-hidden="true">{selected ? '✓' : '›'}</span>}
                  />
                );
              })}
            </div>
          )}
          {switching && <MobileStatus className="workspace-page__switching" loading />}
          {error && <MobileBanner className="workspace-page__error" tone="danger">{error}</MobileBanner>}
        </div>
      </div>
    </div>
  );
};

export default WorkspacePage;
