import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { ChevronsDownUp, FilePlus, FolderPlus, List, RotateCw } from 'lucide-react';
import {
  Icon, IconButton, NavigationPanel, NavigationPanelBody, NavigationPanelContent,
  NavigationPanelHeader, OverflowText, StatusPill, Tooltip,
} from '@bitfun/ui';
import { useI18n } from '@/infrastructure/i18n';
import { getWorkspaceDisplayName, useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { getActiveSurfaceScope, onSurfaceActivated } from '@/infrastructure/peer-device/deviceSurface';
import type { FileExplorerToolbarHandlers } from '@/tools/file-system';
import FilesPanel from '../../components/panels/FilesPanel';
import { DEFAULT_RESOURCE_LAYOUT, useWorkspaceResourceState } from './workspaceResourceState';
import { showResourceMenu } from './resourceMenus';
import { resolveResourceWorkspace, useNavSceneStore } from '../../stores/navSceneStore';
import type { WorkspaceInfo } from '@/shared/types';
import '../file-viewer/FileViewerNav.scss';

export default function WorkspaceResourcePanel() {
  const { activeWorkspace, openedWorkspaces } = useWorkspaceContext();
  const target = useNavSceneStore(state => state.resourceWorkspace);
  const scope = useSyncExternalStore(onSurfaceActivated, getActiveSurfaceScope, getActiveSurfaceScope);
  const workspace = resolveResourceWorkspace(target, scope.surfaceId, openedWorkspaces, activeWorkspace);
  // Persisted layout and search state are keyed by (surface, workspace ID) only.
  const resourceKey = scope.key('workspace-resources', workspace?.id);
  const migrateLayout = useWorkspaceResourceState(state => state.migrateLayout);
  useEffect(() => {
    if (!workspace) return;
    migrateLayout(
      scope.key('workspace-resources', workspace.connectionId, workspace.id, workspace.rootPath),
      resourceKey,
    );
  }, [migrateLayout, resourceKey, scope, workspace]);
  return <WorkspaceResourceContent key={resourceKey} resourceKey={resourceKey} workspace={workspace} />;
}

function WorkspaceResourceContent({ resourceKey, workspace }: { resourceKey: string; workspace: WorkspaceInfo | null }) {
  const { t } = useI18n('common');
  const { t: tFiles } = useI18n('panels/files');
  const { t: tTools } = useI18n('tools');
  const { openedWorkspacesList } = useWorkspaceContext();
  const openWorkspaceResources = useNavSceneStore(state => state.openWorkspaceResources);
  const scope = getActiveSurfaceScope();
  const layout = useWorkspaceResourceState(state => state.layouts[resourceKey] ?? DEFAULT_RESOURCE_LAYOUT);
  const updateLayout = useWorkspaceResourceState(state => state.updateLayout);
  const [toolbar, setToolbar] = useState<FileExplorerToolbarHandlers | null>(null);
  const filesId = useId();
  const isRemote = workspace?.workspaceKind === 'remote';

  const workspaceName = getWorkspaceDisplayName(workspace);
  const location = isRemote ? workspace?.connectionName || workspace?.sshHost || t('nav.resources.remote')
    : scope.surfaceId === 'local' ? t('nav.resources.local') : t('nav.resources.peer');

  return (
    <NavigationPanel className="bitfun-file-viewer-nav" aria-label={t('nav.resources.title')}
      data-bitfun-component="file-viewer-nav" data-bitfun-part="root" data-testid="workspace-resources">
      <NavigationPanelHeader className="bitfun-file-viewer-nav__panel-header">
        <div className="bitfun-file-viewer-nav__workspace" data-bitfun-component="file-viewer-nav" data-bitfun-part="workspace">
          <button type="button" data-overflow-trigger className="bitfun-file-viewer-nav__workspace-button"
            data-bitfun-component="file-viewer-nav" data-bitfun-part="workspaceButton"
            disabled={openedWorkspacesList.length < 2} aria-haspopup="menu"
            aria-label={t('nav.resources.switchWorkspace')}
            onClick={event => showResourceMenu(event, openedWorkspacesList.map(item => ({
              id: item.id, label: getWorkspaceDisplayName(item), icon: item.id === workspace?.id ? 'Check' : 'Folder',
              onClick: () => openWorkspaceResources(item.id),
            })))}>
            <Icon name="folder" size="sm" />
            <OverflowText className="bitfun-file-viewer-nav__workspace-name">{workspaceName || t('nav.resources.title')}</OverflowText>
            {openedWorkspacesList.length > 1 && <Icon name="chevron-down" size="xs" />}
          </button>
          {workspace && <span className="bitfun-file-viewer-nav__location" data-overflow-trigger title={location}
            data-bitfun-component="file-viewer-nav" data-bitfun-part="location">
            <StatusPill tone="neutral">{location}</StatusPill>
          </span>}
        </div>
      </NavigationPanelHeader>
      <NavigationPanelBody className="bitfun-file-viewer-nav__body">
        <NavigationPanelContent className="bitfun-file-viewer-nav__content">
          {!workspace || (isRemote && !workspace.connectionId)
            ? <p className="bitfun-file-viewer-nav__empty" data-bitfun-component="file-viewer-nav"
              data-bitfun-part="empty">{workspace ? t('nav.resources.unavailable') : tFiles('empty.selectWorkspace')}</p> : (
            <div className="bitfun-file-viewer-nav__sections"
              data-bitfun-component="file-viewer-nav" data-bitfun-part="sections">
              <section className="bitfun-file-viewer-nav__section" aria-label={t('nav.resources.files')}
                style={{ flex: layout.filesCollapsed ? '0 0 auto' : '1 1 0' }}>
                <div className="bitfun-file-viewer-nav__header" data-bitfun-component="file-viewer-nav" data-bitfun-part="header">
                  <button type="button" data-overflow-trigger className="bitfun-file-viewer-nav__section-toggle" aria-expanded={!layout.filesCollapsed}
                    aria-controls={filesId} onClick={() => updateLayout(resourceKey, { filesCollapsed: !layout.filesCollapsed })}>
                    <Icon name={layout.filesCollapsed ? 'chevron-right' : 'chevron-down'} size="xs" />
                    <OverflowText className="bitfun-file-viewer-nav__section-label">{t('nav.resources.files')}</OverflowText>
                  </button>
                  <div className="bitfun-file-viewer-nav__actions" data-bitfun-component="file-viewer-nav" data-bitfun-part="actions">
                    {layout.fileView === 'tree' && toolbar && <>
                      <Tooltip content={tTools('fileTree.newFile')}><IconButton size="xs" aria-label={tTools('fileTree.newFile')} icon={<FilePlus />} onClick={toolbar.onNewFile} /></Tooltip>
                      <Tooltip content={tTools('fileTree.newFolder')}><IconButton size="xs" aria-label={tTools('fileTree.newFolder')} icon={<FolderPlus />} onClick={toolbar.onNewFolder} /></Tooltip>
                      {toolbar.onCollapseAll && <Tooltip content={tTools('fileTree.collapse')}><IconButton size="xs" aria-label={tTools('fileTree.collapse')} icon={<ChevronsDownUp />} onClick={toolbar.onCollapseAll} /></Tooltip>}
                      <Tooltip content={tTools('fileTree.refresh')}><IconButton size="xs" aria-label={tTools('fileTree.refresh')} icon={<RotateCw />} onClick={toolbar.onRefresh} /></Tooltip>
                    </>}
                    <Tooltip content={layout.fileView === 'tree' ? tFiles('actions.switchToSearch') : tFiles('actions.switchToTree')}>
                      <IconButton size="xs" aria-label={layout.fileView === 'tree' ? tFiles('actions.switchToSearch') : tFiles('actions.switchToTree')}
                        icon={layout.fileView === 'tree' ? <Icon name="search" size="xs" /> : <List />}
                        onClick={() => updateLayout(resourceKey, { filesCollapsed: false, fileView: layout.fileView === 'tree' ? 'search' : 'tree' })} />
                    </Tooltip>
                  </div>
                </div>
                <div id={filesId} hidden={layout.filesCollapsed} className="bitfun-file-viewer-nav__section-body">
                  <FilesPanel workspace={workspace} workspacePath={workspace.rootPath} searchStateKey={resourceKey} hideHeader hideExplorerToolbar onExplorerToolbarApi={setToolbar}
                    viewMode={layout.fileView} onViewModeChange={fileView => updateLayout(resourceKey, { fileView })} />
                </div>
              </section>
            </div>
          )}
        </NavigationPanelContent>
      </NavigationPanelBody>
    </NavigationPanel>
  );
}
