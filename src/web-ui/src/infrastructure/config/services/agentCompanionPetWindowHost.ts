/**
 * Host port for the Agent companion pet's own OS window.
 *
 * The desktop host renders `AgentCompanionDesktopPet` inside a Tauri webview
 * window (`?bitfunWindow=agent-companion`) and reaches the rest of the product
 * through the Tauri event bus, the current-window geometry APIs and `invoke`.
 *
 * HarmonyOS renders the same component in a separate ArkUI window. That window
 * hosts a plain ArkWeb page, so `@tauri-apps/api` has nothing to talk to: ArkTS
 * installs a JavaScript proxy (`window.bitfunPetHost`) for commands and pushes
 * events back with `window.__bitfunPetHostDeliver`. This module owns that split
 * so the component itself stays host-agnostic.
 *
 * Direction summary:
 *   pet window -> host: `post()` (relayed to the main window by ArkTS/Rust)
 *   host -> pet window: `__bitfunPetHostDeliver` (fed from the main window's
 *   existing `agent-companion://` events)
 */

import { emit, listen } from '@tauri-apps/api/event';
import {
  cursorPosition as tauriCursorPosition,
  getCurrentWindow,
} from '@tauri-apps/api/window';
import { api } from '@/infrastructure/api/service-api/ApiClient';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('AgentCompanionPetWindowHost');

export interface AgentCompanionPetWindowSize {
  width: number;
  height: number;
}

export interface AgentCompanionPoint {
  x: number;
  y: number;
}

/**
 * Window geometry and global pointer access. Desktop only: the in-app overlay
 * and the HarmonyOS window drive hover from DOM pointer events instead, and
 * neither has a global cursor position to poll.
 */
export interface AgentCompanionPetPointerHost {
  cursorPosition(): Promise<AgentCompanionPoint>;
  windowPosition(): Promise<AgentCompanionPoint>;
  scaleFactor(): Promise<number>;
  onMoved(handler: (position: AgentCompanionPoint) => void): Promise<() => void>;
  onScaleChanged(handler: (scaleFactor: number) => void): Promise<() => void>;
}

export interface AgentCompanionPetWindowHost {
  readonly kind: 'desktop' | 'harmonyos';
  /** Subscribe to a cross-window event; resolves to an unlisten handle. */
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  /** Publish an event to the main window. */
  emit(event: string, payload?: unknown): Promise<void>;
  hideWindow(): Promise<void>;
  /** Size the host window to the dock's CSS pixel box. */
  resizeWindow(size: AgentCompanionPetWindowSize): Promise<void>;
  focusWindow(): Promise<void>;
  showMainWindow(): Promise<void>;
  /**
   * Ask the host to run the drag loop itself (no per-frame round trips). Null
   * when the desktop gesture branches own dragging.
   */
  startHostDrag: (() => Promise<void>) | null;
  pointer: AgentCompanionPetPointerHost | null;
}

/** Shape of the proxy ArkTS injects through `javaScriptProxy`. */
interface HarmonyOsPetHostProxy {
  post(event: string, payloadJson: string): void;
  hide(): void;
  resize(widthCss: number, heightCss: number): void;
  focus(): void;
  showMainWindow(): void;
  startDrag(): void;
}

declare global {
  interface Window {
    bitfunPetHost?: HarmonyOsPetHostProxy;
    __bitfunPetHostDeliver?: (eventJson: string) => void;
  }
}

/* ------------------------------- Desktop -------------------------------- */

function createDesktopPetWindowHost(): AgentCompanionPetWindowHost {
  return {
    kind: 'desktop',
    listen: <T,>(event: string, handler: (payload: T) => void) => (
      listen<T>(event, incoming => handler(incoming.payload))
    ),
    emit: async (event, payload) => {
      await emit(event, payload);
    },
    hideWindow: async () => {
      await getCurrentWindow().hide();
    },
    resizeWindow: async size => {
      await api.invoke('resize_agent_companion_desktop_pet', {
        width: size.width,
        height: size.height,
      });
    },
    focusWindow: async () => {
      await getCurrentWindow().setFocus();
    },
    showMainWindow: async () => {
      await api.invoke('show_main_window');
    },
    startHostDrag: null,
    pointer: {
      cursorPosition: async () => {
        const position = await tauriCursorPosition();
        return { x: position.x, y: position.y };
      },
      windowPosition: async () => {
        const position = await getCurrentWindow().outerPosition();
        return { x: position.x, y: position.y };
      },
      scaleFactor: async () => {
        const factor = Number(await getCurrentWindow().scaleFactor());
        return Number.isFinite(factor) && factor > 0 ? factor : 1;
      },
      onMoved: async handler => (
        getCurrentWindow().onMoved(event => handler({ x: event.payload.x, y: event.payload.y }))
      ),
      onScaleChanged: async handler => (
        getCurrentWindow().onScaleChanged(event => handler(Number(event.payload.scaleFactor)))
      ),
    },
  };
}

/* ------------------------------ HarmonyOS -------------------------------- */

type DeliverHandler = (payload: unknown) => void;

const deliverHandlers = new Map<string, Set<DeliverHandler>>();

/**
 * ArkTS pushes host events with
 * `runJavaScript("window.__bitfunPetHostDeliver(...)")`, so the dispatcher has
 * to exist before the page's listeners register.
 */
function installDeliverDispatcher(): void {
  window.__bitfunPetHostDeliver = (eventJson: string) => {
    let message: { event?: string; payload?: unknown };
    try {
      message = JSON.parse(eventJson) as { event?: string; payload?: unknown };
    } catch (error) {
      log.warn('Ignored malformed Agent companion host event', { error });
      return;
    }
    if (!message.event) {
      log.warn('Ignored Agent companion host event without a name');
      return;
    }
    const handlers = deliverHandlers.get(message.event);
    if (!handlers) {
      return;
    }
    handlers.forEach(handler => {
      try {
        handler(message.payload);
      } catch (error) {
        log.warn('Agent companion host event handler failed', { event: message.event, error });
      }
    });
  };
}

function createHarmonyOsPetWindowHost(proxy: HarmonyOsPetHostProxy): AgentCompanionPetWindowHost {
  installDeliverDispatcher();

  // The host window is resized on every bubble/layout change. HarmonyOS applies
  // `moveWindowToGlobalDisplay` and `resizeAsync` asynchronously and does not
  // render them atomically, so a redundant resize (same size) is a flicker
  // trigger. Drop those requests here instead of relying on the host to filter.
  let lastSize: AgentCompanionPetWindowSize | null = null;

  return {
    kind: 'harmonyos',
    listen: async <T,>(event: string, handler: (payload: T) => void) => {
      const wrapped = handler as DeliverHandler;
      let handlers = deliverHandlers.get(event);
      if (!handlers) {
        handlers = new Set();
        deliverHandlers.set(event, handlers);
      }
      handlers.add(wrapped);
      return () => {
        handlers?.delete(wrapped);
        if (handlers && handlers.size === 0) {
          deliverHandlers.delete(event);
        }
      };
    },
    emit: async (event, payload) => {
      try {
        proxy.post(event, JSON.stringify(payload ?? null));
      } catch (error) {
        log.warn('Failed to post Agent companion event to the HarmonyOS host', { event, error });
      }
    },
    hideWindow: async () => {
      try {
        proxy.hide();
      } catch (error) {
        log.warn('Failed to hide the HarmonyOS Agent companion window', { error });
      }
    },
    resizeWindow: async size => {
      const width = Math.max(1, Math.round(size.width));
      const height = Math.max(1, Math.round(size.height));
      if (lastSize && lastSize.width === width && lastSize.height === height) {
        return;
      }
      lastSize = { width, height };
      try {
        proxy.resize(width, height);
      } catch (error) {
        lastSize = null;
        log.warn('Failed to resize the HarmonyOS Agent companion window', { error });
      }
    },
    focusWindow: async () => {
      try {
        proxy.focus();
      } catch (error) {
        log.warn('Failed to focus the HarmonyOS Agent companion window', { error });
      }
    },
    showMainWindow: async () => {
      try {
        proxy.showMainWindow();
      } catch (error) {
        log.warn('Failed to show the main window from the HarmonyOS pet', { error });
      }
    },
    startHostDrag: async () => {
      proxy.startDrag();
    },
    pointer: null,
  };
}

/* -------------------------------- Resolve -------------------------------- */

let resolvedHost: AgentCompanionPetWindowHost | null = null;

/**
 * The host the pet window is running under. Resolved once: the pet window is a
 * single-purpose page, so the platform cannot change while it lives.
 */
export function resolveAgentCompanionPetWindowHost(): AgentCompanionPetWindowHost {
  if (resolvedHost) {
    return resolvedHost;
  }
  const proxy = typeof window === 'undefined' ? undefined : window.bitfunPetHost;
  if (proxy) {
    resolvedHost = createHarmonyOsPetWindowHost(proxy);
    log.info('Agent companion pet window host resolved: harmonyos');
    return resolvedHost;
  }
  resolvedHost = createDesktopPetWindowHost();
  log.info('Agent companion pet window host resolved: desktop');
  return resolvedHost;
}

/** Test seam: the derived bundle evaluates the pet page once per process. */
export function resetAgentCompanionPetWindowHostForTesting(): void {
  resolvedHost = null;
  deliverHandlers.clear();
  delete window.__bitfunPetHostDeliver;
}
