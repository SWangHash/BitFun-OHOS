/**
 * Pure helpers, types, and layout constants shared by the desktop pet
 * (`AgentCompanionDesktopPet`, a separate Tauri window) and the in-app pet
 * overlay (`AgentCompanionInAppPet`, used on HarmonyOS where a second OS
 * window is not available).
 *
 * Everything here is runtime-agnostic: no Tauri APIs, no DOM state, no React.
 * Host-specific wiring (cross-window events, window ops, portal, settings
 * source) lives in the owning component.
 */

import type React from 'react';
import type { AgentCompanionTaskState } from '@/flow_chat/utils/agentCompanionActivity';

export const DEFAULT_PET_SIZE = 96;
export const DEFAULT_PETDEX_DISPLAY_SIZE = { width: 96, height: 104 };
export const PETDEX_DESKTOP_SCALE = 0.5;
export const WINDOW_MAX_WIDTH = 360;
export const WINDOW_MAX_HEIGHT = 240;
export const WINDOW_HORIZONTAL_GAP = 8;
export const MAX_VISIBLE_BUBBLES = 2;
export const BUBBLE_GAP = 6;
export const BUBBLE_WIDTH = 180;
export const BUBBLE_OUTPUT_TYPEWRITER_INTERVAL_MS = 28;
export const WINDOW_EDGE_BUFFER = 4;
export const MENU_EDGE_MARGIN = 4;
/** Clicks shorter/smaller than this start a drag instead of a click. */
export const PET_DRAG_THRESHOLD_PX = 8;

export interface TypewriterOutputState {
  target: string;
  visible: string;
}

/**
 * Which surface is layered above the pet dock. Only one may be open at a time so
 * the host never has to grow for two panels.
 */
export type PetOverlayState =
  | { kind: 'pet-menu' }
  | { kind: 'bubble-menu'; sessionId: string }
  | { kind: 'composer'; sessionId: string }
  | null;

/**
 * Bubbles are derived from live session activity, so "close this bubble" cannot
 * simply delete an item. It records which kind of bubble was dismissed instead:
 * silencing a working bubble keeps it hidden while the task runs, but a later
 * notice (needs input / finished / failed) still gets through.
 */
export type BubbleDismissBucket = 'active' | 'notice';

/**
 * Where a context menu was opened, measured from the host's bottom-right corner.
 * The host keeps that corner fixed while it grows to make room for the menu, so
 * this anchor survives a resize while `clientX`/`clientY` would not.
 */
export interface MenuAnchor {
  right: number;
  bottom: number;
}

export function menuAnchorFromEvent(event: React.MouseEvent): MenuAnchor {
  return {
    right: Math.max(0, window.innerWidth - event.clientX),
    bottom: Math.max(0, window.innerHeight - event.clientY),
  };
}

export function bubbleDismissBucket(state: AgentCompanionTaskState): BubbleDismissBucket {
  return state === 'running' || state === 'waiting' ? 'active' : 'notice';
}

export function isAcknowledgeableTaskState(state: AgentCompanionTaskState): boolean {
  return state === 'completed' || state === 'error' || state === 'interrupted';
}

export function rectContainsPoint(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left
    && x <= rect.right
    && y >= rect.top
    && y <= rect.bottom;
}

export function seedTypewriterOutput(target: string): string {
  if (target.length <= 1) {
    return '';
  }

  return target.slice(0, -1);
}

export function advanceTypewriterOutput(visible: string, target: string): string {
  if (visible === target) {
    return visible;
  }

  if (!target.startsWith(visible)) {
    return target;
  }

  const gap = target.length - visible.length;
  const step = Math.max(1, Math.floor(gap / 8));
  return target.slice(0, visible.length + step);
}
