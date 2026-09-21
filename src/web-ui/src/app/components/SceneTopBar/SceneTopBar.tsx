import React, { useCallback } from 'react';
import { Toolbar } from '@bitfun/ui';
import { WindowControls } from '@/app/components/WindowControls';
import { supportsNativeWindowDragging, usesHostWindowControls } from '@/infrastructure/runtime';
import { useWindowChromeDrag } from '@/app/hooks/useWindowChromeDrag';
import { useSceneStore } from '../../stores/sceneStore';
import SceneBar from '../SceneBar/SceneBar';
import { SceneChromeHost } from './SceneChrome';
import './SceneTopBar.scss';

const INTERACTIVE_SELECTOR =
  'button, input, textarea, select, a, [role="button"], [role="tab"], [role="menu"], [contenteditable]:not([contenteditable="false"]), [draggable="true"], .window-controls';

function blocksWindowChromeInteraction(
  event: React.MouseEvent<HTMLDivElement>,
  allowTabDragging: boolean,
): boolean {
  const target = event.target;
  if (event.defaultPrevented || !(target instanceof Element) || !event.currentTarget.contains(target)) {
    return true;
  }

  // Tab count changes the tab hit target, never the surrounding window chrome.
  if (!allowTabDragging && target.closest('[data-bitfun-component="tab-group"] [data-bitfun-part="item"]')) {
    return true;
  }
  const interactive = target.closest(INTERACTIVE_SELECTOR);
  return interactive !== null && !(allowTabDragging && interactive.getAttribute('role') === 'tab');
}

interface SceneTopBarProps {
  className?: string;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
  isMaximized?: boolean;
}

const SceneTopBar: React.FC<SceneTopBarProps> = ({
  className = '',
  onMinimize,
  onMaximize,
  onClose,
  isMaximized = false,
}) => {
  const openTabCount = useSceneStore(state => state.openTabs.length);
  const hasTabs = openTabCount > 0;
  const isSingleTab = openTabCount <= 1;
  const canDragWindow = supportsNativeWindowDragging();
  const hasWindowControls = Boolean(onMinimize && onMaximize && onClose);
  // The OpenHarmony host paints its own minimize/maximize/close buttons in
  // this corner, so reserve the strip instead of drawing an overlapping set.
  const showHostWindowChromePlaceholder = usesHostWindowControls();
  // Window drag starts on mousedown. While maximized, it is deferred until the
  // pointer moves, because Windows restores a maximized window the moment a
  // native drag begins — even for a plain click.
  const { onMouseDown: handleChromeMouseDown } = useWindowChromeDrag({ isMaximized });

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // Interactive descendants (tabs, buttons, inputs, ...) keep their own
    // interactions; only plain chrome initiates the window drag.
    if (blocksWindowChromeInteraction(event, isSingleTab)) return;
    handleChromeMouseDown(event);
  }, [handleChromeMouseDown, isSingleTab]);

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canDragWindow || event.button !== 0 || blocksWindowChromeInteraction(event, isSingleTab)) return;
    onMaximize?.();
  }, [canDragWindow, isSingleTab, onMaximize]);

  return (
    <Toolbar
      bordered={hasTabs}
      className={`bitfun-scene-top-bar ${className}`.trim()}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      data-bitfun-scene="workbench"
      data-bitfun-part="topBar"
      leading={<SceneBar />}
      size="md"
      trailing={<>
      <SceneChromeHost
        className="bitfun-scene-top-bar__actions"
        data-bitfun-scene="workbench"
        data-bitfun-part="sceneActions"
      />
      {showHostWindowChromePlaceholder ? (
        <div
          className="bitfun-scene-top-bar__window-controls bitfun-scene-top-bar__window-controls--host"
          data-bitfun-component="scene-bar"
          data-bitfun-part="hostControls"
          aria-hidden="true"
        />
      ) : hasWindowControls ? (
        <div
          className="bitfun-scene-top-bar__window-controls"
          data-bitfun-component="scene-bar"
          data-bitfun-part="controls"
        >
          <WindowControls
            onMinimize={onMinimize!}
            onToggleMaximize={onMaximize!}
            onClose={onClose!}
            maximized={isMaximized}
          />
        </div>
      ) : null}
      </>}
    />
  );
};

export default SceneTopBar;
