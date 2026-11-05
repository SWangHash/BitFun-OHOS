/**
 * WorkspaceBody — main workspace container.
 *
 * Left-right layout:
 *   .nav-area   (300px default, flex-column)
 *     NavBar        (45px — back/forward + drag + WindowControls)
 *     NavPanel      (flex:1 — navigation sidebar)
 *   .scene-area (flex:1, flex-column)
 *     SceneTopBar   (scene tabs + active-scene chrome + WindowControls)
 *     SceneViewport (flex:1 — active scene content)
 */

import React, { useId, useRef, useState } from 'react';
import { useCurrentWorkspace } from '../../infrastructure/contexts/WorkspaceContext';
import { NavBar } from '../components/NavBar';
import NavPanel from '../components/NavPanel/NavPanel';
import { SceneChromeProvider } from '../components/SceneTopBar';
import WorkbenchLayout from '../workbench/WorkbenchLayout';
import { SceneViewport } from '../scenes';
import TerminalActionBridge from '../scenes/terminal/TerminalActionBridge';
import { useApp } from '../hooks/useApp';
import { selectActiveSceneId, useSceneStore } from '../stores/sceneStore';
import { useI18n } from '@/infrastructure/i18n';
import { useNavResize } from './useNavResize';
import './WorkspaceBody.scss';

const NAV_DEFAULT_WIDTH = 300;
const NAV_MIN_WIDTH = 216;
const NAV_MAX_WIDTH = 480;
const COLLAPSE_THRESHOLD = 64;

interface WorkspaceBodyProps {
  className?: string;
  isEntering?: boolean;
  isExiting?: boolean;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  isMaximized?: boolean;
  sceneOverlay?: React.ReactNode;
}

const WorkspaceBody: React.FC<WorkspaceBodyProps> = ({
  className = '',
  isEntering = false,
  isExiting = false,
  onMinimize,
  onMaximize,
  onClose,
  isMaximized = false,
  sceneOverlay,
}) => {
  const { t } = useI18n('components');
  const navId = useId();
  const { workspace: currentWorkspace } = useCurrentWorkspace();
  const { state, toggleLeftPanel } = useApp();
  const activeSceneId = useSceneStore(selectActiveSceneId);
  const isNavCollapsed = state.layout.leftPanelCollapsed;
  const [navWidth, setNavWidth] = useState(NAV_DEFAULT_WIDTH);
  const navAreaRef = useRef<HTMLDivElement>(null);
  const navDividerRef = useRef<HTMLDivElement>(null);
  const navGripRef = useRef<SVGPathElement>(null);
  const navResize = useNavResize({
    areaRef: navAreaRef,
    dividerRef: navDividerRef,
    gripRef: navGripRef,
    width: navWidth,
    minWidth: NAV_MIN_WIDTH,
    maxWidth: NAV_MAX_WIDTH,
    collapseThreshold: COLLAPSE_THRESHOLD,
    collapsed: isNavCollapsed,
    onWidthChange: setNavWidth,
    onCollapse: toggleLeftPanel,
  });

  return (
    <div
      className={`bitfun-workspace-body${isEntering ? ' is-entering' : ''}${isExiting ? ' is-exiting' : ''} ${className}`}
      data-bitfun-scene="workbench"
      data-bitfun-part="workspace"
      data-bitfun-state={isNavCollapsed ? 'collapsed' : undefined}
    >
      <div
        className="bitfun-workspace-body__material"
        data-bitfun-scene="workbench"
        data-bitfun-part="workspaceMaterial"
        data-bitfun-theme-scope="chrome"
        aria-hidden="true"
      />
      {isNavCollapsed && (
        <div className="bitfun-workspace-body__collapsed-nav" data-bitfun-scene="workbench" data-bitfun-part="collapsedNav">
          <NavBar isCollapsed onExpandNav={toggleLeftPanel} onMaximize={onMaximize} isMaximized={isMaximized} />
        </div>
      )}

      {/* Left: nav history bar + navigation sidebar — always rendered for slide animation */}
      <div
        id={navId}
        ref={navAreaRef}
        className={`bitfun-workspace-body__nav-area${isNavCollapsed ? ' is-collapsed' : ''}`}
        style={isNavCollapsed ? undefined : { '--nav-width': `${navWidth}px` } as React.CSSProperties}
        data-bitfun-scene="workbench"
        data-bitfun-part="navArea"
        data-bitfun-theme-scope="chrome"
        data-bitfun-state={isNavCollapsed ? 'collapsed' : undefined}
      >
        <NavBar onExpandNav={toggleLeftPanel} onMaximize={onMaximize} isMaximized={isMaximized} />
        <NavPanel className="bitfun-workspace-body__nav-panel" />
        <div data-bitfun-creation-slot="sidebar-footer" />
      </div>

      <TerminalActionBridge />

      {/* Resize divider — placed at workspace-body level to avoid overflow:hidden clipping */}
      {!isNavCollapsed && (
        <div
          ref={navDividerRef}
          className="bitfun-workspace-body__nav-divider"
          style={{ '--nav-width': `${navWidth}px` } as React.CSSProperties}
          {...navResize}
          role="separator"
          tabIndex={0}
          aria-label={t('canvas.resizePanes')}
          aria-orientation="vertical"
          aria-controls={navId}
          aria-valuemin={NAV_MIN_WIDTH}
          aria-valuemax={NAV_MAX_WIDTH}
          aria-valuenow={navWidth}
          data-bitfun-scene="workbench"
          data-bitfun-part="navDivider"
          data-bitfun-theme-scope="chrome"
        >
          <svg className="bitfun-workspace-body__nav-grip" viewBox="0 0 48 120" aria-hidden="true" focusable="false">
            <path ref={navGripRef} d="M 24 44 L 24 76" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      )}

      {/* Right: visual scene surface + any shell-level overlay */}
      <div className="bitfun-workspace-body__scene-area" data-bitfun-scene="workbench" data-bitfun-part="sceneArea">
        <div
          className="bitfun-workspace-body__scene-surface"
          data-bitfun-scene="workbench"
          data-bitfun-part="sceneSurface"
        >
          <SceneChromeProvider activeSceneId={activeSceneId}>
            <div data-bitfun-creation-slot="scene-header" />
            <WorkbenchLayout
              workspacePath={currentWorkspace?.rootPath}
              onMinimize={onMinimize}
              onMaximize={onMaximize}
              onClose={onClose}
              isMaximized={isMaximized}
            >
              <SceneViewport paned
                workspacePath={currentWorkspace?.rootPath}
                isEntering={isEntering}
              />
            </WorkbenchLayout>
            <div data-bitfun-creation-slot="scene-footer" />
          </SceneChromeProvider>
        </div>
        {sceneOverlay}
      </div>
    </div>
  );
};

export default WorkspaceBody;
