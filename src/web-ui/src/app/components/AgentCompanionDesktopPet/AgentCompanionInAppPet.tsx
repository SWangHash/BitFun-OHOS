/**
 * AgentCompanionInAppPet — HarmonyOS in-app overlay variant of the desktop pet.
 *
 * The desktop pet (`AgentCompanionDesktopPet`) runs in a separate transparent
 * always-on-top Tauri window and talks to the main window through Tauri events.
 * HarmonyOS has no second OS window wired (see
 * `src/apps/desktop/src/appearance.rs` `#[cfg(target_env = "ohos")]` stubs and
 * `docs/architecture/platform-portability-design.md`), so on OHOS the pet is
 * rendered as an in-app floating overlay instead — mirroring the toolbar-mode
 * single-window morph pattern (`flow_chat/components/toolbar-mode`).
 *
 * Differences from the desktop host:
 * - Activity comes from `useAgentCompanionActivity()` (direct FlowChatStore +
 *   state-machine subscription) instead of `listen('agent-companion://activity-updated')`.
 * - Settings come from `aiExperienceConfigService.addChangeListener` instead of
 *   `listen('agent-companion://settings-updated')`.
 * - Commands are dispatched directly via `handleAgentCompanionPetCommand` /
 *   `openAgentCompanionSession` instead of `emit('agent-companion://pet-command')`.
 * - Positioning is CSS `position: fixed` + pointer-driven drag, hover is DOM
 *   `pointerenter/leave`, and the overlay grows via CSS — no `resize_agent_companion_desktop_pet`,
 *   `startDragging`, or global `cursorPosition()` polling.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { aiExperienceConfigService, type AgentCompanionPetSelection, type AIExperienceSettings } from '@/infrastructure/config/services/AIExperienceConfigService';
import { ChatInputPixelPet, type ChatInputPixelPetMood } from '@/flow_chat/components/ChatInputPixelPet';
import { useAgentCompanionActivity } from '@/flow_chat/hooks/useAgentCompanionActivity';
import type { AgentCompanionTaskStatus } from '@/flow_chat/utils/agentCompanionActivity';
import { handleAgentCompanionPetCommand } from '@/app/services/agentCompanionPetCommands';
import { openAgentCompanionSession } from '@/app/services/openAgentCompanionSession';
import { exitPetOnlyMode, isPetOnlyModeActive } from '@/app/services/agentCompanionPetOnlyMode';
import { useAgentCompanionPetOnlyModeStore } from '@/app/stores/agentCompanionPetOnlyModeStore';
import { quickActions } from '@/shared/services/ide-control';
import { getAppearanceOverlayHost } from '@/infrastructure/appearance/runtime/AppearanceOverlayHost';
import { createLogger } from '@/shared/utils/logger';
import {
  DEFAULT_PET_SIZE,
  DEFAULT_PETDEX_DISPLAY_SIZE,
  PETDEX_DESKTOP_SCALE,
  BUBBLE_OUTPUT_TYPEWRITER_INTERVAL_MS,
  MENU_EDGE_MARGIN,
  PET_DRAG_THRESHOLD_PX,
  type TypewriterOutputState,
  type PetOverlayState,
  type BubbleDismissBucket,
  type MenuAnchor,
  menuAnchorFromEvent,
  bubbleDismissBucket,
  isAcknowledgeableTaskState,
  seedTypewriterOutput,
  advanceTypewriterOutput,
} from './agentCompanionPetShared';
import './AgentCompanionDesktopPet.scss';
import './AgentCompanionInAppPet.scss';

const log = createLogger('AgentCompanionInAppPet');

const PET_EDGE_GAP = 12;

interface PetDragPosition {
  x: number;
  y: number;
}

function clampDragPosition(x: number, y: number, width: number, height: number): PetDragPosition {
  const maxX = Math.max(0, window.innerWidth - width - PET_EDGE_GAP);
  const maxY = Math.max(0, window.innerHeight - height - PET_EDGE_GAP);
  return {
    x: Math.min(Math.max(PET_EDGE_GAP, x), maxX),
    y: Math.min(Math.max(PET_EDGE_GAP, y), maxY),
  };
}

export const AgentCompanionInAppPet: React.FC = () => {
  const { t } = useTranslation('flow-chat');
  const activity = useAgentCompanionActivity();
  const mood = activity.mood;
  const tasks = activity.tasks;
  const isPetOnlyMode = useAgentCompanionPetOnlyModeStore(state => state.isPetOnlyMode);

  const [pet, setPet] = useState<AgentCompanionPetSelection | null>(
    () => aiExperienceConfigService.getSettings().agent_companion_pet ?? null,
  );
  const [enabled, setEnabled] = useState<boolean>(
    () => aiExperienceConfigService.getSettings().enable_agent_companion,
  );
  const [displayMode, setDisplayMode] = useState<AIExperienceSettings['agent_companion_display_mode']>(
    () => aiExperienceConfigService.getSettings().agent_companion_display_mode,
  );
  const [petFrameSize, setPetFrameSize] = useState<{ width: number; height: number } | null>(null);

  const [typedOutputBySessionId, setTypedOutputBySessionId] = useState<Record<string, TypewriterOutputState>>({});
  const [isHoveringPet, setIsHoveringPet] = useState(false);
  const [isDraggingPet, setIsDraggingPet] = useState(false);
  const [overlay, setOverlay] = useState<PetOverlayState>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [menuPosition, setMenuPosition] = useState<MenuAnchor | null>(null);
  const [dismissedBubbles, setDismissedBubbles] = useState<Record<string, BubbleDismissBucket>>({});
  const [composerValue, setComposerValue] = useState('');
  const [isSendingComposer, setIsSendingComposer] = useState(false);
  const [hoveredBubbleSessionId, setHoveredBubbleSessionId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<PetDragPosition | null>(null);

  const dockRef = useRef<HTMLDivElement>(null);
  const bubblesRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLInputElement>(null);
  const outputRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const petPointerSessionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    dragStarted: boolean;
  } | null>(null);
  const dragSizeRef = useRef<{ width: number; height: number }>({ width: DEFAULT_PET_SIZE, height: DEFAULT_PET_SIZE });

  // Subscribe to AI experience settings in-process (no cross-window event).
  useEffect(() => {
    let disposed = false;
    const applySettings = (settings: AIExperienceSettings) => {
      if (disposed) return;
      // If the pet is turned off while minimized-to-pet, restore the window
      // before unmounting so the app is not left in the tiny pet-only shape.
      if (
        (!settings.enable_agent_companion || settings.agent_companion_display_mode !== 'desktop')
        && isPetOnlyModeActive()
      ) {
        void exitPetOnlyMode();
      }
      setPet(settings.agent_companion_pet ?? null);
      setPetFrameSize(null);
      setEnabled(settings.enable_agent_companion);
      setDisplayMode(settings.agent_companion_display_mode);
    };

    void aiExperienceConfigService.getSettingsAsync()
      .then(settings => {
        if (!disposed) applySettings(settings);
      })
      .catch(error => {
        if (!disposed) log.warn('Failed to load Agent companion settings', error);
      });

    const unsubscribe = aiExperienceConfigService.addChangeListener(applySettings);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const visibleTasks = useMemo(
    () => tasks.filter(task => dismissedBubbles[task.sessionId] !== bubbleDismissBucket(task.state)),
    [dismissedBubbles, tasks],
  );
  const displayTasks = [...visibleTasks].reverse();
  const activePetSize = pet && petFrameSize
    ? petFrameSize
    : pet
      ? DEFAULT_PETDEX_DISPLAY_SIZE
      : { width: DEFAULT_PET_SIZE, height: DEFAULT_PET_SIZE };

  // Drop dismissals whose bubble kind changed or whose session left the payload.
  useEffect(() => {
    setDismissedBubbles(previous => {
      const previousSessionIds = Object.keys(previous);
      if (previousSessionIds.length === 0) {
        return previous;
      }

      const next: Record<string, BubbleDismissBucket> = {};
      tasks.forEach(task => {
        const dismissedBucket = previous[task.sessionId];
        if (dismissedBucket && dismissedBucket === bubbleDismissBucket(task.state)) {
          next[task.sessionId] = dismissedBucket;
        }
      });

      return Object.keys(next).length === previousSessionIds.length ? previous : next;
    });
  }, [tasks]);

  // Never leave a bubble menu or composer floating over a bubble that is gone.
  useEffect(() => {
    setOverlay(previous => {
      if (!previous || previous.kind === 'pet-menu') {
        return previous;
      }
      return visibleTasks.some(task => task.sessionId === previous.sessionId) ? previous : null;
    });
    setHoveredBubbleSessionId(previous => (
      previous && !visibleTasks.some(task => task.sessionId === previous)
        ? null
        : previous
    ));
  }, [visibleTasks]);

  useEffect(() => {
    setTypedOutputBySessionId(previous => {
      const next: Record<string, TypewriterOutputState> = {};

      visibleTasks.forEach(task => {
        if (!task.latestOutput) {
          return;
        }

        const previousOutput = previous[task.sessionId];
        next[task.sessionId] = previousOutput
          ? { ...previousOutput, target: task.latestOutput }
          : {
            target: task.latestOutput,
            visible: seedTypewriterOutput(task.latestOutput),
          };
      });

      return next;
    });
  }, [visibleTasks]);

  // rAF-driven typewriter. Only re-arms when "is anything still typing" flips.
  const hasTypingOutput = useMemo(
    () => Object.values(typedOutputBySessionId)
      .some(output => output.visible !== output.target),
    [typedOutputBySessionId],
  );

  useEffect(() => {
    if (!hasTypingOutput) {
      return;
    }

    let frameId: number | null = null;
    let lastTickAt = 0;

    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick);
      if (now - lastTickAt < BUBBLE_OUTPUT_TYPEWRITER_INTERVAL_MS) {
        return;
      }
      lastTickAt = now;

      setTypedOutputBySessionId(previous => {
        let changed = false;
        const next: Record<string, TypewriterOutputState> = {};

        Object.entries(previous).forEach(([sessionId, output]) => {
          const visible = advanceTypewriterOutput(output.visible, output.target);
          if (visible !== output.visible) {
            changed = true;
          }
          next[sessionId] = { ...output, visible };
        });

        return changed ? next : previous;
      });
    };

    frameId = requestAnimationFrame(tick);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [hasTypingOutput]);

  useLayoutEffect(() => {
    outputRefs.current.forEach(element => {
      element.scrollTop = element.scrollHeight;
    });
  }, [typedOutputBySessionId]);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
  }, []);

  const openPetSettings = useCallback(() => {
    setOverlay(null);
    // The overlay already lives in the main window, so we open the settings
    // surface directly instead of emitting a cross-window command.
    try {
      quickActions.openSettings('session-personalization');
    } catch (error) {
      log.warn('Failed to open Agent companion settings', error);
    }
  }, []);

  const closeDesktopPet = useCallback(() => {
    setOverlay(null);
    // Toggling the persisted setting is what makes the close stick: the
    // settings change listener above hides the overlay. Display mode is left
    // alone so re-enabling brings the pet back where the user had it.
    void handleAgentCompanionPetCommand({ type: 'close-desktop-pet' })
      .catch(error => {
        log.warn('Failed to close Agent companion pet', error);
      });
  }, []);

  const closeBubble = useCallback((task: AgentCompanionTaskStatus) => {
    setOverlay(null);
    setDismissedBubbles(previous => ({
      ...previous,
      [task.sessionId]: bubbleDismissBucket(task.state),
    }));

    if (!isAcknowledgeableTaskState(task.state)) {
      return;
    }
    void handleAgentCompanionPetCommand({ type: 'dismiss-task', sessionId: task.sessionId })
      .catch(error => {
        log.warn('Failed to acknowledge Agent companion task', {
          sessionId: task.sessionId,
          error,
        });
      });
  }, []);

  const onPetContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuAnchor(menuAnchorFromEvent(event));
    setOverlay(previous => (previous?.kind === 'pet-menu' ? null : { kind: 'pet-menu' }));
  }, []);

  const onBubbleContextMenu = useCallback((event: React.MouseEvent, sessionId: string) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuAnchor(menuAnchorFromEvent(event));
    setOverlay(previous => (
      previous?.kind === 'bubble-menu' && previous.sessionId === sessionId
        ? null
        : { kind: 'bubble-menu', sessionId }
    ));
  }, []);

  const openBubbleComposer = useCallback((sessionId: string) => {
    setComposerValue('');
    setIsSendingComposer(false);
    setOverlay({ kind: 'composer', sessionId });
  }, []);

  const cancelBubbleComposer = useCallback(() => {
    setComposerValue('');
    setOverlay(null);
  }, []);

  const submitBubbleComposer = useCallback(async () => {
    const sessionId = overlay?.kind === 'composer' ? overlay.sessionId : null;
    const message = composerValue.trim();
    if (!sessionId || !message || isSendingComposer) {
      return;
    }

    setIsSendingComposer(true);
    try {
      await handleAgentCompanionPetCommand({ type: 'send-message', sessionId, message });
      setComposerValue('');
      setOverlay(null);
    } catch (error) {
      log.warn('Failed to send Agent companion message from in-app composer', {
        sessionId,
        error,
      });
    } finally {
      setIsSendingComposer(false);
    }
  }, [composerValue, isSendingComposer, overlay]);

  const onComposerKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelBubbleComposer();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      void submitBubbleComposer();
    }
  }, [cancelBubbleComposer, submitBubbleComposer]);

  useEffect(() => {
    if (overlay?.kind !== 'composer') {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [overlay]);

  const isMenuOverlay = overlay?.kind === 'pet-menu' || overlay?.kind === 'bubble-menu';

  // Place the menu at the cursor, kept fully inside the viewport.
  useLayoutEffect(() => {
    if (!isMenuOverlay || !menuAnchor) {
      setMenuPosition(null);
      return;
    }

    const placeMenu = () => {
      const menuBox = menuRef.current?.getBoundingClientRect();
      const menuWidth = menuBox?.width ?? 0;
      const menuHeight = menuBox?.height ?? 0;
      const right = Math.min(
        Math.max(menuAnchor.right, MENU_EDGE_MARGIN),
        Math.max(0, window.innerWidth - menuWidth),
      );
      const bottom = Math.min(
        Math.max(menuAnchor.bottom, MENU_EDGE_MARGIN),
        Math.max(0, window.innerHeight - menuHeight),
      );
      setMenuPosition(previous => (
        previous && previous.right === right && previous.bottom === bottom
          ? previous
          : { right, bottom }
      ));
    };

    placeMenu();
    window.addEventListener('resize', placeMenu);
    return () => window.removeEventListener('resize', placeMenu);
  }, [isMenuOverlay, menuAnchor]);

  // Keep the drag clamp aware of the current pet size.
  useEffect(() => {
    dragSizeRef.current = { width: activePetSize.width, height: activePetSize.height };
  }, [activePetSize.height, activePetSize.width]);

  const clearPetPointerSession = (target: HTMLDivElement, pointerId: number) => {
    const session = petPointerSessionRef.current;
    if (!session || session.pointerId !== pointerId) {
      return;
    }
    petPointerSessionRef.current = null;
    try {
      target.releasePointerCapture(pointerId);
    } catch {
      /* already released */
    }
  };

  const onPetPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    if (overlay?.kind === 'composer') {
      setOverlay(null);
    }
    const origin = dragPosition ?? { x: 0, y: 0 };
    petPointerSessionRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      dragStarted: false,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onPetPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = petPointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId || session.dragStarted) {
      return;
    }
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (dx * dx + dy * dy < PET_DRAG_THRESHOLD_PX * PET_DRAG_THRESHOLD_PX) {
      return;
    }
    session.dragStarted = true;
    event.preventDefault();
    setIsDraggingPet(true);
    // Begin free positioning; seed from the pointer so the grab point stays
    // under the cursor instead of jumping the pet's top-left there.
    const size = dragSizeRef.current;
    const seedX = Math.max(0, event.clientX - size.width / 2);
    const seedY = Math.max(0, event.clientY - size.height / 2);
    setDragPosition(clampDragPosition(seedX, seedY, size.width, size.height));
  };

  const onPetPointerMoveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = petPointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId || !session.dragStarted) {
      return;
    }
    const size = dragSizeRef.current;
    const nextX = session.originX + (event.clientX - session.startX);
    const nextY = session.originY + (event.clientY - session.startY);
    setDragPosition(clampDragPosition(nextX, nextY, size.width, size.height));
  };

  const onPetPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = petPointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    const wasDrag = session.dragStarted;
    clearPetPointerSession(event.currentTarget, event.pointerId);
    setIsDraggingPet(false);
    // A click (no drag) on the pet restores the full app window when the
    // surface is currently minimized to the pet-only shape.
    if (!wasDrag && isPetOnlyMode) {
      void exitPetOnlyMode();
    }
  };

  const onPetPointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    const session = petPointerSessionRef.current;
    if (!session || event.pointerId !== session.pointerId) {
      return;
    }
    clearPetPointerSession(event.currentTarget, event.pointerId);
    setIsDraggingPet(false);
  };

  const openTaskSession = useCallback(async (task: AgentCompanionTaskStatus) => {
    try {
      await openAgentCompanionSession(task.sessionId);
    } catch (error) {
      log.warn('Failed to open Agent companion task session', {
        sessionId: task.sessionId,
        error,
      });
    }
  }, []);

  const handlePetFrameSizeChange = useCallback((size: { width: number; height: number } | null) => {
    setPetFrameSize(size);
  }, []);

  if (!enabled || displayMode !== 'desktop') {
    return null;
  }

  const displayMood: ChatInputPixelPetMood = isDraggingPet
    ? 'dragging'
    : isHoveringPet
      ? 'hover'
      : mood;

  const dockVars = {
    '--bitfun-agent-companion-pet-width': `${activePetSize.width}px`,
    '--bitfun-agent-companion-pet-height': `${activePetSize.height}px`,
    '--bitfun-agent-companion-gap': `8px`,
  } as React.CSSProperties;
  // The root is a full-viewport fixed overlay (see .scss); dragging moves the
  // dock within it so the viewport-relative menu-anchor math stays valid.
  const stackStyle: React.CSSProperties = {
    ...dockVars,
    ...(dragPosition
      ? { left: `${dragPosition.x}px`, top: `${dragPosition.y}px`, right: 'auto', bottom: 'auto' }
      : { right: `${PET_EDGE_GAP}px`, bottom: `${PET_EDGE_GAP}px` }),
  };
  const isSingleTask = visibleTasks.length === 1;
  const hasAttentionTask = visibleTasks.some(task => task.state === 'attention');
  const overlayTask = overlay && overlay.kind !== 'pet-menu'
    ? visibleTasks.find(task => task.sessionId === overlay.sessionId) ?? null
    : null;
  const menuItems = overlay?.kind === 'pet-menu'
    ? [
      { key: 'switch-pet', label: t('agentCompanion.menu.switchPet'), onClick: openPetSettings },
      { key: 'close-pet', label: t('agentCompanion.menu.closePet'), onClick: closeDesktopPet },
    ]
    : overlay?.kind === 'bubble-menu' && overlayTask
      ? [{
        key: 'close-bubble',
        label: t('agentCompanion.menu.closeBubble'),
        onClick: () => closeBubble(overlayTask),
      }]
      : [];

  return createPortal(
    <main
      className={`bitfun-agent-companion-window bitfun-agent-companion-inapp${isMenuOverlay ? ' bitfun-agent-companion-window--menu-open' : ''}${isPetOnlyMode ? ' bitfun-agent-companion-inapp--pet-only' : ''}`}
      onContextMenu={event => event.preventDefault()}
      data-bf-component="agent-companion-desktop-pet"
      data-bf-part="root"
      data-bf-host="inapp"
    >
      {isMenuOverlay && (
        <div
          className="bitfun-agent-companion-inapp__backdrop"
          onPointerDown={closeOverlay}
        />
      )}
      {menuItems.length > 0 && (
        <div
          ref={menuRef}
          className="bitfun-agent-companion-window__overlay bitfun-agent-companion-window__overlay--anchored bitfun-agent-companion-inapp__menu"
          style={{
            right: `${menuPosition?.right ?? MENU_EDGE_MARGIN}px`,
            bottom: `${menuPosition?.bottom ?? MENU_EDGE_MARGIN}px`,
            visibility: menuPosition ? 'visible' : 'hidden',
          }}
        >
          <div className="bitfun-agent-companion-window__menu" role="menu">
            {menuItems.map(menuItem => (
              <button
                key={menuItem.key}
                type="button"
                role="menuitem"
                className="bitfun-agent-companion-window__menu-item"
                onClick={menuItem.onClick}
              >
                {menuItem.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="bitfun-agent-companion-window__stack" style={stackStyle}>
        <div
          ref={dockRef}
          className="bitfun-agent-companion-window__dock"
          data-bf-component="agent-companion-desktop-pet"
          data-bf-part="dock"
          data-bf-host="inapp"
        >
          {visibleTasks.length > 0 && (
            <div
              ref={bubblesRef}
              className={`bitfun-agent-companion-window__bubbles${isSingleTask ? ' bitfun-agent-companion-window__bubbles--single' : ''}`}
              aria-live="polite"
              onDoubleClick={event => event.stopPropagation()}
              data-bf-component="agent-companion-desktop-pet"
              data-bf-part="bubbles"
              data-bf-host="inapp"
            >
              {displayTasks.map(task => {
                const isComposingTask = overlay?.kind === 'composer'
                  && overlay.sessionId === task.sessionId;
                const isHoveredTask = hoveredBubbleSessionId === task.sessionId;
                const bubbleClassName = `bitfun-agent-companion-window__bubble bitfun-agent-companion-window__bubble--${task.state}${isSingleTask ? ' bitfun-agent-companion-window__bubble--single' : ''}${isComposingTask ? ' bitfun-agent-companion-window__bubble--composing' : ''}`;
                const bubbleBody = (
                  <>
                    <span
                      className="bitfun-agent-companion-window__bubble-title"
                      data-bf-component="agent-companion-desktop-pet"
                      data-bf-part="bubbleTitle"
                      data-bf-host="inapp"
                    >
                      {task.title}
                    </span>
                    <span
                      className="bitfun-agent-companion-window__bubble-status"
                      data-bf-component="agent-companion-desktop-pet"
                      data-bf-part="bubbleStatus"
                      data-bf-host="inapp"
                    >
                      {t(task.labelKey, { defaultValue: task.defaultLabel })}
                    </span>
                    {isSingleTask && task.latestOutput && (() => {
                      const typedOutput = typedOutputBySessionId[task.sessionId];
                      const visibleOutput = typedOutput?.visible ?? seedTypewriterOutput(task.latestOutput);
                      const targetOutput = typedOutput?.target ?? task.latestOutput;
                      const isTyping = visibleOutput !== targetOutput;
                      const sessionId = task.sessionId;

                      return (
                        <span
                          ref={element => {
                            if (element) {
                              outputRefs.current.set(sessionId, element);
                            } else {
                              outputRefs.current.delete(sessionId);
                            }
                          }}
                          className={`bitfun-agent-companion-window__bubble-output${isTyping ? ' bitfun-agent-companion-window__bubble-output--typing' : ''}`}
                          data-bf-component="agent-companion-desktop-pet"
                          data-bf-part="bubbleOutput"
                          data-bf-state={isTyping ? 'typing' : undefined}
                          data-bf-host="inapp"
                        >
                          {visibleOutput}
                        </span>
                      );
                    })()}
                  </>
                );

                return (
                  <div
                    key={task.sessionId}
                    data-agent-companion-session-id={task.sessionId}
                    className={`bitfun-agent-companion-window__bubble-shell${isSingleTask ? ' bitfun-agent-companion-window__bubble-shell--single' : ''}${isHoveredTask ? ' bitfun-agent-companion-window__bubble-shell--hovered' : ''}`}
                    onContextMenu={event => onBubbleContextMenu(event, task.sessionId)}
                  >
                    {isComposingTask ? (
                      <div
                        className={bubbleClassName}
                        data-bf-component="agent-companion-desktop-pet"
                        data-bf-part="bubble"
                        data-bf-host="inapp"
                      >
                        {bubbleBody}
                        <div className="bitfun-agent-companion-window__bubble-composer">
                          <input
                            ref={composerInputRef}
                            type="text"
                            data-mouse-glow-ignore
                            className="bitfun-agent-companion-window__bubble-composer-input"
                            value={composerValue}
                            placeholder={t('agentCompanion.composer.placeholder')}
                            aria-label={t('agentCompanion.composer.ariaLabel')}
                            onChange={event => setComposerValue(event.target.value)}
                            onKeyDown={onComposerKeyDown}
                          />
                          <button
                            type="button"
                            className="bitfun-agent-companion-window__bubble-composer-cancel"
                            title={t('agentCompanion.composer.cancel')}
                            aria-label={t('agentCompanion.composer.cancel')}
                            onClick={cancelBubbleComposer}
                          >
                            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                              <path
                                d="M4 4l8 8M12 4l-8 8"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                          <button
                            type="button"
                            className="bitfun-agent-companion-window__bubble-composer-send"
                            title={t('agentCompanion.composer.send')}
                            aria-label={t('agentCompanion.composer.send')}
                            disabled={!composerValue.trim() || isSendingComposer}
                            onClick={() => void submitBubbleComposer()}
                          >
                            <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                              <path
                                d="M8 13V3.6M4 7.6 8 3.4l4 4.2"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={bubbleClassName}
                        onClick={() => void openTaskSession(task)}
                        data-bf-component="agent-companion-desktop-pet"
                        data-bf-part="bubble"
                        data-bf-host="inapp"
                      >
                        {bubbleBody}
                      </button>
                    )}
                    {task.canReply !== false && !isComposingTask && (
                      <button
                        type="button"
                        className="bitfun-agent-companion-window__bubble-compose"
                        title={t('agentCompanion.composer.openTitle')}
                        aria-label={t('agentCompanion.composer.openTitle')}
                        onClick={() => openBubbleComposer(task.sessionId)}
                      >
                        <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                          <path
                            d="M10.6 2.6a1.4 1.4 0 0 1 2 2L6 11.2l-3 .8.8-3 6.8-6.4zM3.5 14h9"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div
            className={`bitfun-agent-companion-window__pet-hitbox${hasAttentionTask ? ' bitfun-agent-companion-window__pet-hitbox--needs-attention' : ''}`}
            onPointerEnter={() => setIsHoveringPet(true)}
            onPointerLeave={() => setIsHoveringPet(false)}
            onPointerDown={onPetPointerDown}
            onPointerMove={event => {
              onPetPointerMove(event);
              onPetPointerMoveDrag(event);
            }}
            onPointerUp={onPetPointerUp}
            onPointerCancel={onPetPointerCancel}
            onContextMenu={onPetContextMenu}
            data-bf-component="agent-companion-desktop-pet"
            data-bf-part="hitbox"
            data-bf-state={hasAttentionTask ? 'attention' : undefined}
            data-bf-host="inapp"
          >
            <ChatInputPixelPet
              mood={displayMood}
              pet={pet}
              nativePetdexSize
              petdexScale={PETDEX_DESKTOP_SCALE}
              onPetFrameSizeChange={handlePetFrameSizeChange}
              className="bitfun-agent-companion-window__pet"
              data-bf-component="agent-companion-desktop-pet"
              data-bf-part="pet"
              data-bf-host="inapp"
            />
          </div>
        </div>
      </div>
    </main>,
    getAppearanceOverlayHost(),
  );
};

export default AgentCompanionInAppPet;
