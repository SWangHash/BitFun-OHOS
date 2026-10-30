import { appManager } from '../../services/AppManager';
import {
  loadPanelWidth,
  PANEL_COMMON_CONFIG,
  RIGHT_PANEL_CONFIG,
  STORAGE_KEYS,
} from '../../layout/panelConfig';

/**
 * The user's own right-panel width, independent of the current window size.
 * The rendered width is this value fitted into the scene box, so shrinking the
 * window (or a transient measurement during maximize/restore) can only ever
 * narrow the panel for a moment instead of replacing what the user chose.
 */
export function clampRightPanelPreferredWidth(width: number): number {
  if (!Number.isFinite(width)) return RIGHT_PANEL_CONFIG.COMFORTABLE_DEFAULT;
  return Math.min(
    RIGHT_PANEL_CONFIG.MAX_WIDTH,
    Math.max(RIGHT_PANEL_CONFIG.COMPACT_WIDTH, width),
  );
}

/**
 * Fit a remembered width into the current scene width.
 * The result must never be persisted: fitting is the container's constraint,
 * not the user's intent, and a wider container later has to restore the
 * remembered width.
 */
export function fitRightPanelWidth(preferredWidth: number, containerWidth: number): number {
  const preferred = clampRightPanelPreferredWidth(preferredWidth);
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return preferred;
  const available = Math.floor(
    containerWidth - PANEL_COMMON_CONFIG.RESIZER_WIDTH - PANEL_COMMON_CONFIG.MIN_CENTER_WIDTH,
  );
  // Not laid out, or no room for a chat column at all: keep the intent instead
  // of collapsing the panel to a degenerate width.
  if (available <= 0) return preferred;
  // Keep the panel at least compact-wide; only degrade below it when the scene
  // box itself cannot hold a compact panel.
  const floor = Math.min(available, RIGHT_PANEL_CONFIG.COMPACT_WIDTH);
  return Math.max(floor, Math.min(available, preferred));
}

/** Apply a container-fitted width without touching the remembered width. */
export function applySessionAuxPaneWidth(width: number): void {
  if (appManager.getState().layout.rightPanelCollapsed) return;
  appManager.updateLayout({ rightPanelWidth: width }, { persistPanelSizes: false });
}

/** Explicit, synchronous layout writes remain safe when open requests repeat. */
export function expandSessionAuxPane(): void {
  if (!appManager.getState().layout.rightPanelCollapsed) return;

  window.dispatchEvent(new CustomEvent('expand-right-panel-immediate', {
    detail: { noAnimation: true },
  }));
  appManager.updateLayout({
    rightPanelWidth: loadPanelWidth(
      STORAGE_KEYS.RIGHT_PANEL_LAST_WIDTH,
      RIGHT_PANEL_CONFIG.COMFORTABLE_DEFAULT,
    ),
    rightPanelCollapsed: false,
  });
}

export function collapseSessionAuxPane(): void {
  // In editor mode this pane is the main content surface.
  if (appManager.getState().layout.chatCollapsed) return;
  appManager.updateLayout({ rightPanelCollapsed: true });
}

export function expandSessionBottomTerminalPane(height: number): void {
  appManager.updateLayout({
    bottomTerminalPanelHeight: height,
    bottomTerminalPanelCollapsed: false,
  });
}

export function collapseSessionBottomTerminalPane(): void {
  appManager.updateLayout({ bottomTerminalPanelCollapsed: true });
}
