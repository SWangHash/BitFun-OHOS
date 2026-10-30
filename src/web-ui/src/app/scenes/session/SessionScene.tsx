import { GripHorizontal as LucideGripHorizontal, GripVertical as LucideGripVertical } from 'lucide-react';
/**
 * SessionScene — Session scene layout.
 *
 * Layout (left to right):
 *   ChatPane (flex:1, FlowChat conversation)
 *   PaneResizer (draggable divider)
 *   AuxPane (variable width, ContentCanvas tabs)
 *
 * Resizer logic moved here from WorkspaceShell.
 */

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../hooks/useApp';
import ChatPane from './ChatPane';
import AuxPane, { type AuxPaneRef } from './AuxPane';
import BottomTerminalPane from './BottomTerminalPane';
import {
  applySessionAuxPaneWidth,
  clampRightPanelPreferredWidth,
  collapseSessionBottomTerminalPane,
  expandSessionAuxPane,
  expandSessionBottomTerminalPane,
  fitRightPanelWidth,
} from './sessionPanelLayout';
import {
  getCachedTerminalPanelPosition,
  onTerminalPanelPositionChange,
  refreshTerminalPanelPosition,
} from '@/tools/terminal/services/terminalPanelPreferenceService';
import type { TerminalPanelPosition } from '@/infrastructure/config/types';

import {
  BOTTOM_TERMINAL_PANEL_CONFIG,
  RIGHT_PANEL_CONFIG,
  PANEL_COMMON_CONFIG,
  STORAGE_KEYS,
  PanelDisplayMode,
  getPanelDisplayMode,
  getModeWidth,
  getSnappedWidth,
  getNextMode,
  savePanelWidth,
  loadPanelWidth,
} from '../../layout/panelConfig';

import './SessionScene.scss';

const TERMINAL_PANEL_RESIZE_SUSPEND_FALLBACK_MS = 360;

interface SessionSceneProps {
  workspacePath?: string;
  isEntering?: boolean;
  isActive?: boolean;
}

const SessionScene: React.FC<SessionSceneProps> = ({
  workspacePath,
  isEntering = false,
  isActive = true,
}) => {
  const { t } = useTranslation('flow-chat');
  const {
    state,
    toggleRightPanel,
    updateBottomTerminalPanelHeight,
  } = useApp();
  const auxPaneRef = useRef<AuxPaneRef>(null);

  const [isDraggingRight, setIsDraggingRight] = useState(false);
  const isDraggingRightRef = useRef(false);
  const [isDraggingBottom, setIsDraggingBottom] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [isHoveringBottom, setIsHoveringBottom] = useState(false);
  const [isRightPanelTransitioning, setIsRightPanelTransitioning] = useState(false);
  const [isBottomTerminalPanelTransitioning, setIsBottomTerminalPanelTransitioning] = useState(false);
  const [terminalPanelPosition, setTerminalPanelPosition] = useState<TerminalPanelPosition>(() =>
    getCachedTerminalPanelPosition(),
  );

  // Width the user chose for the right panel. It is the single source of truth
  // across window resizes: the rendered width is this value fitted into the
  // current scene box, so a maximize/restore cycle cannot lose it.
  const [preferredRightWidth, setPreferredRightWidth] = useState<number>(() =>
    loadPanelWidth(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH, RIGHT_PANEL_CONFIG.COMFORTABLE_DEFAULT)
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const resizerRef = useRef<HTMLDivElement>(null);
  const auxPaneElementRef = useRef<HTMLDivElement>(null);
  const bottomTerminalPaneElementRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const rightPanelTransitionTimerRef = useRef<number | null>(null);
  const bottomPanelTransitionTimerRef = useRef<number | null>(null);
  const previousRightTransitionKeyRef = useRef<string | null>(null);
  const previousBottomTransitionKeyRef = useRef<string | null>(null);

  const currentRightWidth = state.layout.rightPanelWidth || RIGHT_PANEL_CONFIG.COMFORTABLE_DEFAULT;
  const currentBottomHeight = state.layout.bottomTerminalPanelHeight || BOTTOM_TERMINAL_PANEL_CONFIG.COMFORTABLE_DEFAULT;
  const isTerminalDockedBottom = terminalPanelPosition === 'bottom';
  const isDragging = isDraggingRight || isDraggingBottom;

  const stopRightPanelTransition = useCallback(() => {
    if (rightPanelTransitionTimerRef.current !== null) {
      window.clearTimeout(rightPanelTransitionTimerRef.current);
      rightPanelTransitionTimerRef.current = null;
    }
    setIsRightPanelTransitioning(false);
  }, []);

  const startRightPanelTransition = useCallback(() => {
    if (rightPanelTransitionTimerRef.current !== null) {
      window.clearTimeout(rightPanelTransitionTimerRef.current);
    }
    setIsRightPanelTransitioning(true);
    rightPanelTransitionTimerRef.current = window.setTimeout(
      stopRightPanelTransition,
      TERMINAL_PANEL_RESIZE_SUSPEND_FALLBACK_MS,
    );
  }, [stopRightPanelTransition]);

  const stopBottomPanelTransition = useCallback(() => {
    if (bottomPanelTransitionTimerRef.current !== null) {
      window.clearTimeout(bottomPanelTransitionTimerRef.current);
      bottomPanelTransitionTimerRef.current = null;
    }
    setIsBottomTerminalPanelTransitioning(false);
  }, []);

  const startBottomPanelTransition = useCallback(() => {
    if (bottomPanelTransitionTimerRef.current !== null) {
      window.clearTimeout(bottomPanelTransitionTimerRef.current);
    }
    setIsBottomTerminalPanelTransitioning(true);
    bottomPanelTransitionTimerRef.current = window.setTimeout(
      stopBottomPanelTransition,
      TERMINAL_PANEL_RESIZE_SUSPEND_FALLBACK_MS,
    );
  }, [stopBottomPanelTransition]);

  const rightPanelMode: PanelDisplayMode = useMemo(() => {
    if (state.layout.rightPanelCollapsed) return 'collapsed';
    return getPanelDisplayMode(currentRightWidth, RIGHT_PANEL_CONFIG);
  }, [state.layout.rightPanelCollapsed, currentRightWidth]);

  const bottomTerminalPanelMode: PanelDisplayMode = useMemo(() => {
    if (state.layout.bottomTerminalPanelCollapsed) return 'collapsed';
    return getPanelDisplayMode(currentBottomHeight, BOTTOM_TERMINAL_PANEL_CONFIG);
  }, [state.layout.bottomTerminalPanelCollapsed, currentBottomHeight]);

  useEffect(() => {
    const unsubscribe = onTerminalPanelPositionChange(setTerminalPanelPosition);
    void refreshTerminalPanelPosition();
    return unsubscribe;
  }, []);

  // Keep right panel visible when chat is hidden
  useEffect(() => {
    if (state.layout.chatCollapsed && state.layout.rightPanelCollapsed) {
      expandSessionAuxPane();
    }
  }, [state.layout.chatCollapsed, state.layout.rightPanelCollapsed]);

  const calculateValidRightWidth = useCallback((desiredWidth: number): number => {
    // A scene box that is not laid out yet (offsetWidth 0, e.g. window restored
    // from minimize) keeps the remembered width instead of clamping it away.
    if (!containerRef.current) return clampRightPanelPreferredWidth(desiredWidth);
    return fitRightPanelWidth(desiredWidth, containerRef.current.offsetWidth);
  }, []);

  const calculateValidBottomHeight = useCallback((newHeight: number): number => {
    if (!containerRef.current) return newHeight;
    const containerHeight = containerRef.current.offsetHeight;
    if (containerHeight <= 0) return newHeight;
    const reserved = PANEL_COMMON_CONFIG.RESIZER_WIDTH + 220;
    const dynamicMax = containerHeight - reserved;
    const maxHeight = Math.min(BOTTOM_TERMINAL_PANEL_CONFIG.MAX_WIDTH, dynamicMax);
    return Math.min(maxHeight, Math.max(BOTTOM_TERMINAL_PANEL_CONFIG.COMPACT_WIDTH, newHeight));
  }, []);

  /**
   * Write the rendered width straight to the pane element. Drags use this so a
   * live resize does not re-render the panel subtree on every frame.
   */
  const setAuxPaneRenderedWidth = useCallback((width: number): boolean => {
    const element = auxPaneElementRef.current;
    if (!element || state.layout.rightPanelCollapsed || state.layout.chatCollapsed) return false;
    element.style.width = `${width}px`;
    return true;
  }, [state.layout.chatCollapsed, state.layout.rightPanelCollapsed]);

  /**
   * Apply a fitted width to state and to the pane. The direct write also covers
   * a fit that matches the current state (a drag that snapped back), where
   * React would not touch the DOM again.
   */
  const applyFittedRightWidth = useCallback((fitted: number) => {
    applySessionAuxPaneWidth(fitted);
    setAuxPaneRenderedWidth(fitted);
  }, [setAuxPaneRenderedWidth]);

  /** Remember the width the user just chose, then render it fitted. */
  const commitRightPanelWidth = useCallback((width: number) => {
    const preferred = clampRightPanelPreferredWidth(width);
    setPreferredRightWidth(preferred);
    savePanelWidth(STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH, preferred);
    applyFittedRightWidth(fitRightPanelWidth(preferred, containerRef.current?.offsetWidth ?? 0));
  }, [applyFittedRightWidth]);

  // Re-derive the rendered width from the remembered width whenever the scene
  // box or the remembered width changes. Fitting never overwrites the
  // remembered width, so a temporarily narrow container is reversible.
  const fitRightPanelWidthToContainer = useCallback(() => {
    if (state.layout.rightPanelCollapsed || state.layout.chatCollapsed) return;
    if (isDraggingRightRef.current) return;
    applyFittedRightWidth(
      fitRightPanelWidth(preferredRightWidth, containerRef.current?.offsetWidth ?? 0),
    );
  }, [
    applyFittedRightWidth,
    preferredRightWidth,
    state.layout.chatCollapsed,
    state.layout.rightPanelCollapsed,
  ]);

  const fitRightPanelWidthRef = useRef(fitRightPanelWidthToContainer);

  useEffect(() => {
    fitRightPanelWidthRef.current = fitRightPanelWidthToContainer;
  });

  useEffect(() => {
    fitRightPanelWidthToContainer();
  }, [fitRightPanelWidthToContainer]);

  // Observe the scene box itself: window maximize/restore and nav changes both
  // land here after layout settles, which is what the fit needs to measure.
  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const scheduleFit = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        fitRightPanelWidthRef.current();
      });
    };
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(node);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const saveAndUpdateBottomHeight = useCallback((height: number) => {
    updateBottomTerminalPanelHeight(height);
    savePanelWidth(STORAGE_KEYS.BOTTOM_TERMINAL_PANEL_LAST_HEIGHT, height);
  }, [updateBottomTerminalPanelHeight]);

  const handleDoubleClick = useCallback(() => {
    const nextMode = getNextMode(rightPanelMode);
    commitRightPanelWidth(getModeWidth(nextMode, RIGHT_PANEL_CONFIG));
  }, [rightPanelMode, commitRightPanelWidth]);

  const handleBottomDoubleClick = useCallback(() => {
    const nextMode = getNextMode(bottomTerminalPanelMode);
    const targetHeight = getModeWidth(nextMode, BOTTOM_TERMINAL_PANEL_CONFIG);
    saveAndUpdateBottomHeight(calculateValidBottomHeight(targetHeight));
  }, [bottomTerminalPanelMode, calculateValidBottomHeight, saveAndUpdateBottomHeight]);

  const handleMouseDownResizer = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const startX = e.clientX;
    const startWidth = currentRightWidth;
    let desiredWidth = clampRightPanelPreferredWidth(startWidth);

    setIsDraggingRight(true);
    isDraggingRightRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(() => {
        desiredWidth = clampRightPanelPreferredWidth(startWidth + (startX - ev.clientX));
        const fitted = calculateValidRightWidth(desiredWidth);
        if (!setAuxPaneRenderedWidth(fitted)) {
          applySessionAuxPaneWidth(fitted);
        }
        animationFrameRef.current = null;
      });
    };

    const onUp = () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      isDraggingRightRef.current = false;
      // Remember the width the user actually sees, so a scene box that limits
      // the panel cannot leave a hidden, larger preference behind.
      commitRightPanelWidth(
        calculateValidRightWidth(getSnappedWidth(desiredWidth, RIGHT_PANEL_CONFIG, false)),
      );
      requestAnimationFrame(() => requestAnimationFrame(() => setIsDraggingRight(false)));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [currentRightWidth, setAuxPaneRenderedWidth, calculateValidRightWidth, commitRightPanelWidth]);

  const handleMouseDownBottomResizer = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;

    const startY = e.clientY;
    const startHeight = currentBottomHeight;
    let lastValidHeight = startHeight;

    setIsDraggingBottom(true);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(() => {
        const valid = calculateValidBottomHeight(startHeight + (startY - ev.clientY));
        lastValidHeight = valid;
        if (bottomTerminalPaneElementRef.current) {
          bottomTerminalPaneElementRef.current.style.height = `${valid}px`;
        } else {
          updateBottomTerminalPanelHeight(valid);
        }
        animationFrameRef.current = null;
      });
    };

    const onUp = () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const snapped = getSnappedWidth(lastValidHeight, BOTTOM_TERMINAL_PANEL_CONFIG, false);
      if (snapped !== lastValidHeight) {
        saveAndUpdateBottomHeight(snapped);
      } else {
        updateBottomTerminalPanelHeight(lastValidHeight);
        savePanelWidth(STORAGE_KEYS.BOTTOM_TERMINAL_PANEL_LAST_HEIGHT, lastValidHeight);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => setIsDraggingBottom(false)));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [calculateValidBottomHeight, currentBottomHeight, saveAndUpdateBottomHeight, updateBottomTerminalPanelHeight]);

  // No-animation expansion
  const [isAuxPaneExpandingImmediate, setIsAuxPaneExpandingImmediate] = useState(false);

  useEffect(() => {
    const handler = (event: CustomEvent) => {
      if (event.detail?.noAnimation && state.layout.rightPanelCollapsed) {
        setIsAuxPaneExpandingImmediate(true);
        setTimeout(() => setIsAuxPaneExpandingImmediate(false), 0);
      }
    };
    window.addEventListener('expand-right-panel-immediate', handler as EventListener);
    return () => window.removeEventListener('expand-right-panel-immediate', handler as EventListener);
  }, [state.layout.rightPanelCollapsed]);

  const expandBottomTerminalPanel = useCallback(() => {
    const saved = loadPanelWidth(
      STORAGE_KEYS.BOTTOM_TERMINAL_PANEL_LAST_HEIGHT,
      BOTTOM_TERMINAL_PANEL_CONFIG.COMFORTABLE_DEFAULT,
    );
    expandSessionBottomTerminalPane(calculateValidBottomHeight(saved));
  }, [calculateValidBottomHeight]);

  // Responsive resize — keep a restored bottom terminal height inside the
  // current scene box. The right panel is fitted by the scene-box observer above.
  useEffect(() => {
    if (!isTerminalDockedBottom) return undefined;
    const validate = () => {
      const validBottom = calculateValidBottomHeight(currentBottomHeight);
      if (validBottom !== currentBottomHeight) updateBottomTerminalPanelHeight(validBottom);
    };
    const rafId = requestAnimationFrame(validate);
    window.addEventListener('resize', validate);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', validate);
    };
  }, [
    currentBottomHeight,
    calculateValidBottomHeight,
    isTerminalDockedBottom,
    updateBottomTerminalPanelHeight,
  ]);

  // Cleanup animation frames
  useEffect(() => () => {
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    if (rightPanelTransitionTimerRef.current !== null) {
      window.clearTimeout(rightPanelTransitionTimerRef.current);
    }
    if (bottomPanelTransitionTimerRef.current !== null) {
      window.clearTimeout(bottomPanelTransitionTimerRef.current);
    }
  }, []);

  const isRightAsMain = state.layout.chatCollapsed;
  const isChatHidden = state.layout.centerPanelCollapsed || isRightAsMain;

  // Terminal resize is suspended for the whole CSS transition. xterm.js reflows
  // its buffer on every resize, so fitting through intermediate panel widths can
  // permanently damage scrollback before the panel reaches its final size.
  useLayoutEffect(() => {
    const transitionKey = [
      state.layout.rightPanelCollapsed ? 'collapsed' : 'open',
      currentRightWidth,
      isRightAsMain ? 'main' : 'side',
    ].join(':');

    if (previousRightTransitionKeyRef.current === null) {
      previousRightTransitionKeyRef.current = transitionKey;
      return;
    }

    if (previousRightTransitionKeyRef.current === transitionKey) {
      return;
    }

    previousRightTransitionKeyRef.current = transitionKey;

    if (isDraggingRight || isAuxPaneExpandingImmediate) {
      return;
    }

    startRightPanelTransition();
  }, [
    currentRightWidth,
    isAuxPaneExpandingImmediate,
    isDraggingRight,
    isRightAsMain,
    startRightPanelTransition,
    state.layout.rightPanelCollapsed,
  ]);

  // Bottom docking uses the same suspension as the right panel. This keeps the
  // compact final height usable while avoiding transient animation heights.
  useLayoutEffect(() => {
    const transitionKey = [
      state.layout.bottomTerminalPanelCollapsed ? 'collapsed' : 'open',
      currentBottomHeight,
      isTerminalDockedBottom ? 'bottom' : 'right',
    ].join(':');

    if (previousBottomTransitionKeyRef.current === null) {
      previousBottomTransitionKeyRef.current = transitionKey;
      return;
    }

    if (previousBottomTransitionKeyRef.current === transitionKey) {
      return;
    }

    previousBottomTransitionKeyRef.current = transitionKey;

    if (isDraggingBottom || !isTerminalDockedBottom) {
      return;
    }

    startBottomPanelTransition();
  }, [
    currentBottomHeight,
    isDraggingBottom,
    isTerminalDockedBottom,
    startBottomPanelTransition,
    state.layout.bottomTerminalPanelCollapsed,
  ]);

  const handleRightPanelTransitionEnd = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target) return;
    if (event.propertyName !== 'width') return;
    stopRightPanelTransition();
  }, [stopRightPanelTransition]);

  const handleBottomPanelTransitionEnd = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.currentTarget !== event.target) return;
    if (event.propertyName !== 'height') return;
    stopBottomPanelTransition();
  }, [stopBottomPanelTransition]);

  const panelModeLabels = useMemo(() => ({
    collapsed:    t('layout.panelMode.collapsed'),
    compact:      t('layout.panelMode.compact'),
    comfortable:  t('layout.panelMode.comfortable'),
    expanded:     t('layout.panelMode.expanded'),
  }), [t]);

  const panelCollapseHintStyles = useMemo(() => {
    const q = (v: string) => `"${v.replace(/"/g, '\\"')}"`;
    return {
      '--panel-collapse-hint-right': q(t('layout.panelCollapseHintRight')),
    } as React.CSSProperties & Record<'--panel-collapse-hint-right', string>;
  }, [t]);

  return (
    <div
      ref={containerRef}
      className={[
        'bitfun-session-scene',
        isDragging && 'bitfun-session-scene--dragging',
        isDraggingBottom && 'bitfun-session-scene--dragging-bottom',
        isTerminalDockedBottom && 'bitfun-session-scene--terminal-bottom',
        isEntering && 'layout-entering',
      ].filter(Boolean).join(' ')}
      style={panelCollapseHintStyles}
      data-testid="session-scene"
      data-bitfun-scene="session"
      data-bitfun-part="root"
      data-bitfun-state={[
        isDragging && 'dragging',
        isDraggingBottom && 'dragging',
        isTerminalDockedBottom && 'terminal-bottom',
      ].filter(Boolean).join(' ') || undefined}
    >
      <div className="bitfun-session-scene__main-row" data-bitfun-scene="session" data-bitfun-part="main">
        {/* ChatPane — FlowChat conversation */}
        {!isChatHidden && (
          <div
            className={`bitfun-session-scene__chat-pane ${isDragging ? 'bitfun-session-scene__chat-pane--dragging' : ''}`}
            data-testid="session-chat-pane"
            data-bitfun-scene="session"
            data-bitfun-part="chat"
          >
            <ChatPane
              width={0}
              isFullscreen={false}
              isSceneActive={isActive}
              isDragging={false}
              workspacePath={workspacePath}
              showChatInput
              isRightPanelOpen={!state.layout.rightPanelCollapsed}
              onToggleRightPanel={toggleRightPanel}
            />
          </div>
        )}

        {/* Resizer — always rendered (when chat visible) for slide animation */}
        {!isChatHidden && (
          <div
            ref={resizerRef}
            className={[
              'bitfun-pane-resizer',
              state.layout.rightPanelCollapsed && 'bitfun-pane-resizer--collapsed',
              isDraggingRight && 'bitfun-pane-resizer--dragging',
              isHovering && 'bitfun-pane-resizer--hovering',
            ].filter(Boolean).join(' ')}
            onMouseDown={handleMouseDownResizer}
            onDoubleClick={handleDoubleClick}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            tabIndex={state.layout.rightPanelCollapsed ? -1 : 0}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('layout.resizer.rightAriaLabel')}
            aria-valuenow={currentRightWidth}
            aria-valuemin={RIGHT_PANEL_CONFIG.COMPACT_WIDTH}
            aria-valuemax={RIGHT_PANEL_CONFIG.MAX_WIDTH}
            title={t('layout.resizer.title', { mode: panelModeLabels[rightPanelMode] })}
            data-testid="session-right-pane-resizer"
          >
            <div className="bitfun-pane-resizer__line" />
            <div className="bitfun-pane-resizer__handle">
              <LucideGripVertical width="16" height="16" className="bitfun-pane-resizer__icon" aria-hidden="true" />
            </div>
          </div>
        )}

        {/* AuxPane — ContentCanvas */}
        <div
          ref={auxPaneElementRef}
          className={[
            'bitfun-session-scene__aux-pane',
            state.layout.rightPanelCollapsed         && 'bitfun-session-scene__aux-pane--collapsed',
            isDraggingRight                          && 'bitfun-session-scene__aux-pane--dragging',
            isRightAsMain                            && 'bitfun-session-scene__aux-pane--editor-mode',
            isAuxPaneExpandingImmediate              && 'bitfun-session-scene__aux-pane--no-animation',
          ].filter(Boolean).join(' ')}
          style={{
            width: state.layout.rightPanelCollapsed
              ? undefined
              : isRightAsMain ? undefined : `${currentRightWidth}px`,
          }}
          data-mode={rightPanelMode}
          data-testid="session-aux-pane"
          data-bitfun-scene="session"
          data-bitfun-part="auxiliary"
          onTransitionEnd={handleRightPanelTransitionEnd}
        >
          <AuxPane
            ref={auxPaneRef}
            workspacePath={workspacePath}
            isSceneActive={isActive && !state.layout.rightPanelCollapsed}
            terminalResizeSuspended={isRightPanelTransitioning || isDraggingRight}
          />
        </div>
      </div>

      {isTerminalDockedBottom ? (
        <>
          <div
            className={[
              'bitfun-bottom-pane-resizer',
              state.layout.bottomTerminalPanelCollapsed && 'bitfun-bottom-pane-resizer--collapsed',
              isDraggingBottom && 'bitfun-bottom-pane-resizer--dragging',
              isHoveringBottom && 'bitfun-bottom-pane-resizer--hovering',
            ].filter(Boolean).join(' ')}
            onMouseDown={handleMouseDownBottomResizer}
            onDoubleClick={handleBottomDoubleClick}
            onMouseEnter={() => setIsHoveringBottom(true)}
            onMouseLeave={() => setIsHoveringBottom(false)}
            tabIndex={state.layout.bottomTerminalPanelCollapsed ? -1 : 0}
            role="separator"
            aria-orientation="horizontal"
            aria-label={t('layout.resizer.terminalBottomAriaLabel')}
            aria-valuenow={currentBottomHeight}
            aria-valuemin={BOTTOM_TERMINAL_PANEL_CONFIG.COMPACT_WIDTH}
            aria-valuemax={BOTTOM_TERMINAL_PANEL_CONFIG.MAX_WIDTH}
            title={t('layout.resizer.title', { mode: panelModeLabels[bottomTerminalPanelMode] })}
          >
            <div className="bitfun-bottom-pane-resizer__line" />
            <div className="bitfun-bottom-pane-resizer__handle">
              <LucideGripHorizontal width="16" height="16" className="bitfun-bottom-pane-resizer__icon" aria-hidden="true" />
            </div>
          </div>

          <div
            ref={bottomTerminalPaneElementRef}
            className={[
              'bitfun-session-scene__bottom-terminal-pane',
              state.layout.bottomTerminalPanelCollapsed && 'bitfun-session-scene__bottom-terminal-pane--collapsed',
              isDraggingBottom && 'bitfun-session-scene__bottom-terminal-pane--dragging',
            ].filter(Boolean).join(' ')}
            style={{
              height: state.layout.bottomTerminalPanelCollapsed ? undefined : `${currentBottomHeight}px`,
            }}
            data-mode={bottomTerminalPanelMode}
            data-bitfun-scene="session"
            data-bitfun-part="terminal"
            onTransitionEnd={handleBottomPanelTransitionEnd}
          >
            <BottomTerminalPane
              workspacePath={workspacePath}
              isSceneActive={isActive}
              onExpand={expandBottomTerminalPanel}
              onCollapse={collapseSessionBottomTerminalPane}
              terminalResizeSuspended={isBottomTerminalPanelTransitioning || isDraggingBottom}
            />
          </div>
        </>
      ) : null}
    </div>
  );
};

export default SessionScene;
