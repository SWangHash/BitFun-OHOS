/**
 * MainNav — primary product navigation sidebar.
 *
 * Layout (top to bottom):
 *   1. Search
 *   2. AI Assistant, Task Board, Mini Apps, then Extensions & Compatibility
 *   3. Unified Sessions (all or grouped by project / assistant)
 *
 * When a scene-nav transition is active (`isDeparting=true`), items receive
 * positional CSS classes for the split-open animation effect.
 */

import React, { useCallback, useState, useMemo, useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { OverflowText,
  Icon,
  IconButton,
  KeyHint,
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  NavigationPanel,
  NavigationPanelBody,
  NavigationPanelContent,
  NavigationPanelHeader,
  NavigationPanelItem,
  ScrollArea,
  Tooltip,
} from '@bitfun/ui';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import { isImeOwnedKeyboardEvent } from '@/shared/utils/ime';
import { FolderOpen, FolderPlus, Server, Users, Network } from 'lucide-react';
// import { PanelsTopLeft } from 'lucide-react'; // temporarily hidden: Pages nav entry
import { useSceneManager } from '../../hooks/useSceneManager';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import type { SceneTabId } from '../SceneBar/types';
import SectionHeader from './components/SectionHeader';
import StickySectionHeader from './components/StickySectionHeader';
import WorkspaceSessionGroupingToggle from './components/WorkspaceSessionGroupingToggle';
import WorkspaceSessionFilterMenu from './components/WorkspaceSessionFilterMenu';
import MiniAppEntry from './components/MiniAppEntry';
import WorkspaceListSection from './sections/workspaces/WorkspaceListSection';
import { useSceneStore } from '../../stores/sceneStore';
import { useMiniAppCatalogSync } from '../../scenes/miniapps/hooks/useMiniAppCatalogSync';
import { workspaceManager } from '@/infrastructure/services/business/workspaceManager';
import { useWorkspaceContext } from '@/infrastructure/contexts/WorkspaceContext';
import { createLogger } from '@/shared/utils/logger';
import { isRemoteWorkspace } from '@/shared/types';
import { getRecentWorkspaceLineParts } from '@/shared/utils/recentWorkspaceDisplay';
import { computeFixedPopoverPosition } from '@/shared/utils/fixedPopoverViewport';
import { useSSHRemoteContext, SSHConnectionDialog, RemoteFileBrowser } from '@/features/ssh-remote';
import { openGlobalSearch } from '@/app/global-search/globalSearchStore';
import { activateProductAction } from '@/app/global-search/productActionActivator';
import {
  getGlobalSearchShortcutLabel,
  splitGlobalSearchShortcutLabel,
  subscribeGlobalSearchShortcut,
} from '@/app/global-search/globalSearchShortcut';
import { useExternalAppAwareness } from '@/infrastructure/config/components/external-sources/useExternalAppAwareness';

import './NavPanel.scss';
import { subscribeOverlayInteraction, OverflowText } from '@bitfun/ui';

const log = createLogger('MainNav');

interface MainNavProps {
  isDeparting?: boolean;
  anchorNavSceneId?: SceneTabId | null;
}

const MainNav: React.FC<MainNavProps> = ({
  isDeparting: _isDeparting = false,
  anchorNavSceneId: _anchorNavSceneId = null,
}) => {
  const sshRemote = useSSHRemoteContext();
  const [isSSHConnectionDialogOpen, setIsSSHConnectionDialogOpen] = useState(false);

  useEffect(() => {
    if (sshRemote.showFileBrowser) {
      setIsSSHConnectionDialogOpen(false);
    }
  }, [sshRemote.showFileBrowser]);

  const { openScene } = useSceneManager();
  const activeTabId = useSceneStore(s => s.activeTabId);
  const { t } = useI18n('common');
  const searchShortcutLabel = useSyncExternalStore(
    subscribeGlobalSearchShortcut,
    getGlobalSearchShortcutLabel,
    getGlobalSearchShortcutLabel,
  );
  const searchShortcutHint = splitGlobalSearchShortcutLabel(searchShortcutLabel);
  // const { t: tPages } = useI18n('scenes/pages'); // temporarily hidden: Pages nav entry
  const {
    currentWorkspace,
    loading: workspaceLoading,
    recentWorkspaces,
    openedWorkspacesList,
    switchWorkspace,
  } = useWorkspaceContext();

  useMiniAppCatalogSync({
    enabled: !workspaceLoading,
    initialLoad: 'idle',
  });

  const activeMiniAppId = useMemo(
    () => (typeof activeTabId === 'string' && activeTabId.startsWith('miniapp:') ? activeTabId.slice('miniapp:'.length) : null),
    [activeTabId]
  );

  const workspaceMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const sectionsScrollRef = useRef<HTMLDivElement | null>(null);
  const sessionContentRef = useRef<HTMLDivElement | null>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuClosing, setWorkspaceMenuClosing] = useState(false);
  const [workspaceMenuPos, setWorkspaceMenuPos] = useState({ top: 0, left: 0 });
  const [isExtensionsOpen, setIsExtensionsOpen] = useState(false);

  const closeWorkspaceMenu = useCallback(() => {
    setWorkspaceMenuClosing(true);
    window.setTimeout(() => {
      setWorkspaceMenuOpen(false);
      setWorkspaceMenuClosing(false);
    }, 150);
  }, []);

  const updateWorkspaceMenuPos = useCallback(() => {
    const btn = workspaceMenuButtonRef.current;
    if (!btn || !workspaceMenuOpen) return;
    const rect = btn.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const fallbackWidth = 300;
    const fallbackHeight = 420;

    const apply = () => {
      const menuEl = workspaceMenuRef.current;
      const w = menuEl?.offsetWidth ?? fallbackWidth;
      const h = menuEl?.offsetHeight ?? fallbackHeight;
      setWorkspaceMenuPos(computeFixedPopoverPosition(rect, w, h, gap, viewportPadding));
    };

    apply();
    requestAnimationFrame(apply);
  }, [workspaceMenuOpen]);

  const openWorkspaceMenu = useCallback(async () => {
    try {
      await workspaceManager.cleanupInvalidWorkspaces();
    } catch (error) {
      log.warn('Failed to cleanup invalid workspaces before opening workspace menu', { error });
    }
    const rect = workspaceMenuButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setWorkspaceMenuPos(computeFixedPopoverPosition(rect, 300, 420, 6, 8));
    setWorkspaceMenuOpen(true);
    setWorkspaceMenuClosing(false);
  }, []);

  const toggleWorkspaceMenu = useCallback(() => {
    if (workspaceMenuOpen) { closeWorkspaceMenu(); return; }
    void openWorkspaceMenu();
  }, [closeWorkspaceMenu, openWorkspaceMenu, workspaceMenuOpen]);

  const handleOpenProject = useCallback(async () => {
    try {
      // 'project.open' owns the whole flow: platform-dispatched directory
      // picker (native dialog on desktop, OHOS DocumentViewPicker on
      // HarmonyOS) followed by workspaceManager.openWorkspace. Picking the
      // directory here as well stacked a second system picker on top —
      // confirming or cancelling the first one revealed the next one.
      await activateProductAction('project.open', { t });
    } catch (err) {
      log.error('Failed to open project', err);
    }
  }, [t]);

  const handleNewProject = useCallback(() => {
    void activateProductAction('project.new');
  }, []);

  const handleOpenAssistantManager = useCallback(() => {
    closeWorkspaceMenu();
    openScene('assistant');
  }, [closeWorkspaceMenu, openScene]);

  const handleSwitchWorkspace = useCallback(async (workspaceId: string) => {
    const targetWorkspace = recentWorkspaces.find(item => item.id === workspaceId);
    if (!targetWorkspace) return;
    closeWorkspaceMenu();
    await switchWorkspace(targetWorkspace);
  }, [closeWorkspaceMenu, recentWorkspaces, switchWorkspace]);

  const handleOpenRemoteSSH = useCallback(() => {
    closeWorkspaceMenu();
    setIsSSHConnectionDialogOpen(true);
  }, [closeWorkspaceMenu]);

  const handleSelectRemoteWorkspace = useCallback(async (path: string) => {
    try {
      await sshRemote.openWorkspace(path);
      sshRemote.setShowFileBrowser(false);
      setIsSSHConnectionDialogOpen(false);
    } catch (err) {
      log.error('Failed to open remote workspace', err);
    }
  }, [sshRemote]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (workspaceMenuButtonRef.current?.contains(target)) return;
      if (workspaceMenuRef.current?.contains(target)) return;
      closeWorkspaceMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isImeOwnedKeyboardEvent(event)) closeWorkspaceMenu();
    };
    const removeOverlayMousedown0 = subscribeOverlayInteraction(workspaceMenuRef, 'mousedown', handleClickOutside);
    const removeOverlayKeydown1 = subscribeOverlayInteraction(workspaceMenuRef, 'keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeWorkspaceMenu, workspaceMenuOpen]);

  useEffect(() => {
    if (!workspaceMenuOpen) return;

    updateWorkspaceMenuPos();

    const handleViewportChange = () => updateWorkspaceMenuPos();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [workspaceMenuOpen, updateWorkspaceMenuPos]);

  const handleOpenAgents = useCallback(() => {
    useSceneStore.getState().openScene('agents');
  }, []);

  const handleOpenTodos = useCallback(() => {
    void activateProductAction('surface.todos.open');
  }, []);

  const handleOpenSkills = useCallback(() => {
    void activateProductAction('surface.skills.open');
  }, []);

  const handleOpenEcosystemCompatibility = useCallback(() => {
    void activateProductAction('surface.ecosystemCompatibility.open');
  }, []);

  const isAgentsActive = activeTabId === 'agents';
  const isSkillsActive = activeTabId === 'skills';
  const isEcosystemCompatibilityActive = activeTabId === 'ecosystem-compatibility';
  const hasUnseenEcosystemCompatibility = useExternalAppAwareness(
    isEcosystemCompatibilityActive,
  );

  useEffect(() => {
    if (isAgentsActive || isSkillsActive || isEcosystemCompatibilityActive) {
      setIsExtensionsOpen(true);
    }
  }, [isAgentsActive, isEcosystemCompatibilityActive, isSkillsActive]);

  const workspaceMenuPortal = workspaceMenuOpen ? createPortal(
    <Menu
      ref={workspaceMenuRef}
      className={`bitfun-nav-panel__workspace-menu${workspaceMenuClosing ? ' is-closing' : ''}`}
      style={{ top: workspaceMenuPos.top, left: workspaceMenuPos.left }}
    >
      <MenuItem
        leading={<Icon glyph={FolderOpen} size="sm" />}
        onClick={() => { closeWorkspaceMenu(); void handleOpenProject(); }}
      >
        {t('header.openProject')}
      </MenuItem>
      <MenuItem
        leading={<Icon glyph={FolderPlus} size="sm" />}
        onClick={() => { closeWorkspaceMenu(); handleNewProject(); }}
      >
        {t('header.newProject')}
      </MenuItem>
      <MenuItem
        leading={<Icon name="user" size="sm" />}
        onClick={handleOpenAssistantManager}
        data-testid="nav-session-group-add-assistant"
      >
        {t('nav.workspaces.actions.newAssistant')}
      </MenuItem>
      <MenuItem
        leading={<Icon glyph={Server} size="sm" />}
        onClick={handleOpenRemoteSSH}
      >
        {t('ssh.remote.connect')}
      </MenuItem>
      <MenuSeparator />
      <MenuSection
        title={t('header.recentWorkspaces')}
      >
        <ScrollArea className="bitfun-nav-panel__workspace-menu-workspaces">
          <MenuList>
            {recentWorkspaces.length === 0 ? (
              <div className="bitfun-nav-panel__workspace-menu-empty">
                <span>{t('header.noRecentWorkspaces')}</span>
              </div>
            ) : (
              recentWorkspaces.map((workspace) => {
                const { hostPrefix, folderLabel, tooltip } = getRecentWorkspaceLineParts(workspace);
                const isCurrent = workspace.id === currentWorkspace?.id;
                return (
                  <MenuItem data-overflow-trigger
                    key={workspace.id}
                    leading={<Icon glyph={FolderOpen} size="sm" />}
                    role="menuitemradio"
                    checked={isCurrent}
                    metadata={isCurrent ? <Icon name="check-line" size="xs" /> : undefined}
                    title={tooltip}
                    onClick={() => { void handleSwitchWorkspace(workspace.id); }}
                    data-testid="nav-workspace-menu-recent-workspace"
                    data-workspace-id={workspace.id}
                  >
                    <span className="bitfun-nav-panel__workspace-menu-item-main">
                      {hostPrefix ? (
                        <>
                          <OverflowText className="bitfun-nav-panel__workspace-menu-item-host">{hostPrefix}</OverflowText>
                          <span className="bitfun-nav-panel__workspace-menu-item-host-sep" aria-hidden>
                            ·
                          </span>
                        </>
                      ) : null}
                      <OverflowText className="bitfun-nav-panel__workspace-menu-item-name">{folderLabel}</OverflowText>
                    </span>
                  </MenuItem>
                );
              })
            )}
          </MenuList>
          </ScrollArea>
      </MenuSection>
    </Menu>,
    getAppearanceOverlayHost()
  ) : null;

  const addSessionGroupTooltip = t('nav.tooltips.addSessionGroup');
  const agentsTooltip = t('nav.tooltips.agents');
  const skillsTooltip = t('nav.tooltips.skills');
  const ecosystemCompatibilityTooltip = hasUnseenEcosystemCompatibility
    ? t('nav.tooltips.ecosystemCompatibilityUnseen')
    : t('nav.tooltips.ecosystemCompatibility');
  const assistantManagerLabel = t('nav.items.assistant');
  const taskBoardLabel = t('nav.items.todos');
  const extensionsLabel = t('nav.sections.extensions');
  const isAssistantManagerActive = activeTabId === 'assistant' || activeTabId === 'profile';
  const isTaskBoardActive = activeTabId === 'todos';
  return (
    <>
    <NavigationPanel
      className="bitfun-nav-panel__main-nav"
    >
      <NavigationPanelHeader className="bitfun-nav-panel__main-nav-header">
        <div data-bitfun-component="nav-panel" data-bitfun-part="brandHeader" className="bitfun-nav-panel__brand-header">
        <div className="bitfun-nav-panel__utility-row" data-bitfun-component="nav-panel" data-bitfun-part="utilityRow">
          <div className="bitfun-nav-panel__brand-search" data-bitfun-component="nav-panel" data-bitfun-part="search">
            <Tooltip content={t('nav.search.triggerTooltip')} placement="right" followCursor>
              <button data-overflow-trigger
                type="button"
                className="bitfun-nav-panel__search-trigger"
                data-bitfun-component="nav-panel"
                data-bitfun-part="searchTrigger"
                onClick={() => openGlobalSearch()}
                aria-label={t('nav.search.triggerTooltip')}
                data-testid="nav-search-trigger"
              >
                <span className="bitfun-nav-panel__search-trigger__icon" aria-hidden="true">
                  <span className="bitfun-nav-panel__search-trigger__icon-inner">
                    <Icon name="search" size="xs" />
                  </span>
                </span>
                <OverflowText className="bitfun-nav-panel__search-trigger__label">
                  {t('nav.search.triggerPlaceholder')}
                </OverflowText>
                <KeyHint
                  data-testid="nav-search-shortcut"
                  aria-hidden="true"
                  icon={searchShortcutHint.modifier}
                >
                  {searchShortcutHint.key}
                </KeyHint>
              </button>
            </Tooltip>
          </div>
        </div>
        </div>
      </NavigationPanelHeader>
      <NavigationPanelBody className="bitfun-nav-panel__sections" ref={sectionsScrollRef}>
        <NavigationPanelContent className="bitfun-nav-panel__main-nav-content">
        <div data-testid="nav-sections" className="bitfun-nav-panel__sections-slot">
        <div data-bitfun-component="nav-panel" data-bitfun-part="topActions" className="bitfun-nav-panel__top-actions">
          <Tooltip content={assistantManagerLabel} placement="right" followCursor>
            <NavigationPanelItem
              className="bitfun-nav-panel__top-action-item bitfun-nav-panel__top-action-item--root"
              triggerClassName={[
                'bitfun-nav-panel__top-action-btn',
                isAssistantManagerActive ? 'is-active' : '',
              ].filter(Boolean).join(' ')}
              data-bitfun-component="nav-panel"
              data-bitfun-part="topAction"
              data-bitfun-action="assistant-manager"
              data-bitfun-state={isAssistantManagerActive ? 'active' : ''}
              onClick={handleOpenAssistantManager}
              aria-label={assistantManagerLabel}
              data-testid="nav-assistant-manager"
              leading={(
                <span className="bitfun-nav-panel__top-action-icon-slot">
                  <Icon name="user" size="sm" />
                </span>
              )}
              selected={isAssistantManagerActive}
            >
              {assistantManagerLabel}
            </NavigationPanelItem>
          </Tooltip>

          <Tooltip content={t('nav.tooltips.todos')} placement="right" followCursor>
            <NavigationPanelItem
              className="bitfun-nav-panel__top-action-item bitfun-nav-panel__top-action-item--root"
              triggerClassName={[
                'bitfun-nav-panel__top-action-btn',
                isTaskBoardActive ? 'is-active' : '',
              ].filter(Boolean).join(' ')}
              data-bitfun-component="nav-panel"
              data-bitfun-part="todoEntry"
              data-bitfun-action="todos"
              data-bitfun-state={isTaskBoardActive ? 'active' : ''}
              onClick={handleOpenTodos}
              aria-label={taskBoardLabel}
              data-testid="nav-todos-btn"
              leading={(
                <span className="bitfun-nav-panel__top-action-icon-slot">
                  <Icon name="clock" size="sm" />
                </span>
              )}
              selected={isTaskBoardActive}
            >
              {taskBoardLabel}
            </NavigationPanelItem>
          </Tooltip>

          <div className="bitfun-nav-panel__miniapp-navigation" data-bitfun-component="nav-panel" data-bitfun-part="miniAppFooter">
            <MiniAppEntry
              isActive={activeTabId === 'miniapps' || !!activeMiniAppId}
              activeMiniAppId={activeMiniAppId}
              onOpenMiniApps={() => openScene('miniapps')}
              onOpenMiniApp={(appId) => openScene(`miniapp:${appId}`)}
            />
          </div>

          <div className="bitfun-nav-panel__top-action-expand" data-bitfun-component="nav-panel" data-bitfun-part="extensionGroup" data-bitfun-state={isExtensionsOpen ? 'open' : ''} data-testid="agent-skill-panel">
            <Tooltip content={extensionsLabel} placement="right" followCursor>
              <NavigationPanelItem
                className="bitfun-nav-panel__top-action-item bitfun-nav-panel__top-action-item--root"
                triggerClassName={[
                  'bitfun-nav-panel__top-action-btn',
                  'bitfun-nav-panel__top-action-btn--expand',
                  isExtensionsOpen ? 'is-open' : '',
                ].filter(Boolean).join(' ')}
                data-bitfun-component="nav-panel"
                data-bitfun-part="topAction"
                data-bitfun-action="extensions"
                data-bitfun-state={isExtensionsOpen ? 'open' : ''}
                onClick={() => setIsExtensionsOpen(v => !v)}
                aria-expanded={isExtensionsOpen}
                aria-label={extensionsLabel}
                data-testid="agent-skill-entry"
                leading={(
                  <span
                    className="bitfun-nav-panel__top-action-icon-slot bitfun-nav-panel__top-action-expand-icons"
                  >
                    <Icon
                      name="extension"
                      size="sm"
                      className="bitfun-nav-panel__top-action-expand-icon-default"
                    />
                    <Icon
                      name="chevron-down"
                      size="sm"
                      className={[
                        'bitfun-nav-panel__top-action-expand-icon-chevron',
                        isExtensionsOpen ? 'is-open' : '',
                      ].filter(Boolean).join(' ')}
                    />
                  </span>
                )}
              >
                {extensionsLabel}
              </NavigationPanelItem>
            </Tooltip>

            <div
              className={`bitfun-nav-panel__top-action-sublist${isExtensionsOpen ? ' is-open' : ''}`}
              data-testid="agent-skill-tabs"
              aria-hidden={!isExtensionsOpen}
              {...(!isExtensionsOpen ? { inert: '' } : {})}
            >
              <div className="bitfun-nav-panel__top-action-sublist-inner">
                <Tooltip content={agentsTooltip} placement="right" followCursor>
                  <NavigationPanelItem
                    className="bitfun-nav-panel__top-action-item bitfun-nav-panel__top-action-item--sub"
                    triggerClassName={[
                      'bitfun-nav-panel__top-action-btn',
                      'bitfun-nav-panel__top-action-btn--sub',
                      isAgentsActive ? 'is-active' : '',
                    ].filter(Boolean).join(' ')}
                    data-bitfun-component="nav-panel"
                    data-bitfun-part="topAction"
                    data-bitfun-action="agents"
                    data-bitfun-state={isAgentsActive ? 'active' : ''}
                    onClick={handleOpenAgents}
                    aria-label={agentsTooltip}
                    data-testid="agent-tab"
                    leading={(
                      <span className="bitfun-nav-panel__top-action-icon-slot">
                        <Icon glyph={Users} size="sm" />
                      </span>
                    )}
                    selected={isAgentsActive}
                  >
                    {t('nav.items.agents')}
                  </NavigationPanelItem>
                </Tooltip>

                <Tooltip content={skillsTooltip} placement="right" followCursor>
                  <NavigationPanelItem
                    className="bitfun-nav-panel__top-action-item bitfun-nav-panel__top-action-item--sub"
                    triggerClassName={[
                      'bitfun-nav-panel__top-action-btn',
                      'bitfun-nav-panel__top-action-btn--sub',
                      isSkillsActive ? 'is-active' : '',
                    ].filter(Boolean).join(' ')}
                    data-bitfun-component="nav-panel"
                    data-bitfun-part="topAction"
                    data-bitfun-action="skills"
                    data-bitfun-state={isSkillsActive ? 'active' : ''}
                    onClick={handleOpenSkills}
                    aria-label={skillsTooltip}
                    data-testid="skill-tab"
                    leading={(
                      <span className="bitfun-nav-panel__top-action-icon-slot">
                        <Icon name="extension" size="sm" />
                      </span>
                    )}
                    selected={isSkillsActive}
                  >
                    {t('nav.items.skills')}
                  </NavigationPanelItem>
                </Tooltip>

                <Tooltip content={ecosystemCompatibilityTooltip} placement="right" followCursor>
                  <NavigationPanelItem
                    className="bitfun-nav-panel__top-action-item bitfun-nav-panel__top-action-item--sub"
                    triggerClassName={[
                      'bitfun-nav-panel__top-action-btn',
                      'bitfun-nav-panel__top-action-btn--sub',
                      isEcosystemCompatibilityActive ? 'is-active' : '',
                    ].filter(Boolean).join(' ')}
                    data-bitfun-component="nav-panel"
                    data-bitfun-part="topAction"
                    data-bitfun-action="ecosystem-compatibility"
                    data-bitfun-state={isEcosystemCompatibilityActive ? 'active' : ''}
                    onClick={handleOpenEcosystemCompatibility}
                    aria-label={ecosystemCompatibilityTooltip}
                    data-testid="ecosystem-compatibility-tab"
                    actionContent={hasUnseenEcosystemCompatibility ? (
                      <span
                        className="bitfun-nav-panel__top-action-unseen"
                        data-bitfun-component="nav-panel"
                        data-bitfun-part="topActionUnseen"
                        aria-hidden="true"
                      />
                    ) : null}
                    leading={(
                      <span className="bitfun-nav-panel__top-action-icon-slot">
                        <Icon glyph={Network} size="sm" />
                      </span>
                    )}
                    selected={isEcosystemCompatibilityActive}
                  >
                    {t('nav.items.ecosystemCompatibility')}
                  </NavigationPanelItem>
                </Tooltip>
              </div>
            </div>
          </div>
        </div>

        {/* Unified sessions */}
        <div className="bitfun-nav-panel__section" data-bitfun-component="nav-panel" data-bitfun-part="section" data-bitfun-section="sessions">
          <StickySectionHeader scrollRootRef={sectionsScrollRef} contentRef={sessionContentRef}>
            <SectionHeader
              label={t('nav.items.sessions')}
              actions={
                <>
                  <WorkspaceSessionGroupingToggle />
                  <WorkspaceSessionFilterMenu />
                  <div className="bitfun-nav-panel__workspace-action-wrap">
                    <Tooltip content={addSessionGroupTooltip} placement="right" followCursor disabled={workspaceMenuOpen}>
                      <IconButton
                        ref={workspaceMenuButtonRef}
                        className={`bitfun-nav-panel__section-action${workspaceMenuOpen ? ' is-active' : ''}`}
                        aria-label={addSessionGroupTooltip}
                        aria-haspopup="menu"
                        aria-expanded={workspaceMenuOpen}
                        onClick={toggleWorkspaceMenu}
                        data-testid="nav-workspace-add-btn"
                        icon={<Icon glyph={FolderPlus} size="sm" />}
                        size="xs"
                        variant="quiet"
                      />
                    </Tooltip>
                  </div>
                </>
              }
            />
          </StickySectionHeader>
          <div ref={sessionContentRef} className="bitfun-nav-panel__items" data-bitfun-component="nav-panel" data-bitfun-part="sectionContent">
            <WorkspaceListSection variant="all" />
          </div>
        </div>
        </div>
        </NavigationPanelContent>
      </NavigationPanelBody>
    </NavigationPanel>

      {workspaceMenuPortal}

      {/* SSH Remote Dialogs */}
      <SSHConnectionDialog
        open={isSSHConnectionDialogOpen}
        onClose={() => setIsSSHConnectionDialogOpen(false)}
      />
      {sshRemote.showFileBrowser && sshRemote.connectionId && (
        <RemoteFileBrowser
          connectionId={sshRemote.connectionId}
          initialPath={sshRemote.remoteFileBrowserInitialPath}
          homePath={sshRemote.remoteFileBrowserInitialPath}
          selectDirectoriesOnly
          onSelect={handleSelectRemoteWorkspace}
          onCancel={() => {
            const hasActiveRemoteWorkspace =
              Boolean(sshRemote.remoteWorkspace) ||
              openedWorkspacesList.some(workspace =>
                isRemoteWorkspace(workspace) &&
                workspace.connectionId === sshRemote.connectionId
              );
            sshRemote.setShowFileBrowser(false);
            if (!hasActiveRemoteWorkspace) {
              void sshRemote.disconnect();
            }
          }}
        />
      )}
    </>
  );
};

export default MainNav;
