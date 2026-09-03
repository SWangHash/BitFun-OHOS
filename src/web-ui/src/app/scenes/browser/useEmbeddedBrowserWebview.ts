import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BLANK_TARGET_INTERCEPT_SCRIPT } from './browserInspectorScript';
import { STREAM_RENDER_OPTIMIZATION_SCRIPT } from './browserStreamPerformanceScript';
import { validateUrl } from './browserUrlCheck';
import { api } from '@/infrastructure/api/service-api/ApiClient';

const WEBVIEW_RESIZE_DEBOUNCE_MS = 160;
const WEBVIEW_BOUNDS_EPSILON = 1;
const WEBVIEW_BOUNDS_WAIT_TIMEOUT_MS = 2000;
const OVERLAY_SELECTOR = "[data-bf-component='dialog'][data-bf-part='overlay'], [data-bf-component='sheet'][data-bf-part='overlay'], .canvas-mission-control";
export const BROWSER_WEBVIEW_BLOCKING_OVERLAY_SELECTOR = [
  '.modal-overlay',
  '.canvas-mission-control',
  '.canvas-drop-zone-overlay',
].join(', ');
const BROWSER_WEBVIEW_PAGE_LOAD_EVENT = 'browser-webview-page-load';
const CLOSE_BUILT_IN_BROWSER_EVENT = 'bitfun-close-built-in-browser';
const WEBVIEW_CREATE_RETRY_DELAYS_MS = [0, 250, 750];
let browserWebviewLabelSequence = 0;

export function createBrowserWebviewLabel(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const sequence = browserWebviewLabelSequence++;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${timestamp}-${sequence}-${random}`;
}

// #region agent log
function writeBrowserWebviewDiagnostic(
  hypothesis: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void {
  void fetch('http://127.0.0.1:7469/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hypothesis,
      location,
      message,
      data,
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => {});
}
// #endregion

type BrowserLogger = {
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
};

type BrowserWebviewHandle = {
  close: () => Promise<void>;
  hide: () => Promise<void>;
  label: string;
  setFocus: () => Promise<void>;
  show: () => Promise<void>;
};

type WebviewBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type BrowserWebviewPageLoadPayload = {
  label: string;
  event: 'started' | 'finished';
  url: string;
};

export interface UseEmbeddedBrowserWebviewOptions {
  adoptExistingWebview?: boolean;
  automationId?: string;
  automationTitle?: string;
  defaultUrl: string;
  initialUrl?: string;
  /** Raw HTML content to load instead of a URL (for local HTML files). */
  initialHtml?: string;
  isVisible: boolean;
  labelPrefix: string;
  log: BrowserLogger;
  openRequestId?: string;
  requestedWebviewLabel?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createAutomationBootstrapHtml(automationId: string, title: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body data-bitfun-automation-id="${escapeHtml(automationId)}"></body></html>`;
}

function isTauriEnvironment(): boolean {
  // Check __TAURI_INTERNALS__ (what `invoke` actually needs) rather than
  // __TAURI__ (the global API namespace, only set when withGlobalTauri is
  // true AND the webview was created via Tauri's WebviewWindowBuilder). On
  // OHOS the ArkUI Web component is created by @ohos-rs/ability, not Tauri's
  // builder, so __TAURI__ may be absent even though __TAURI_INTERNALS__
  // (and thus `invoke`) is available. Mirrors the pattern in
  // src/infrastructure/runtime/environment.ts `isTauriRuntime`.
  if (typeof window === 'undefined') return false;
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } })
    .__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function';
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const payload = 'payload' in record ? record.payload : undefined;
    const message =
      (typeof record.message === 'string' && record.message) ||
      (payload && typeof payload === 'object' && typeof (payload as Record<string, unknown>).message === 'string'
        ? String((payload as Record<string, unknown>).message)
        : null);
    if (message) return message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function isWebviewNotFoundError(error: unknown): boolean {
  return formatUnknownError(error).toLowerCase().includes('webview not found');
}

function isViewportUnavailableError(error: unknown): boolean {
  return formatUnknownError(error).includes('Browser viewport did not become visible');
}

function isTransientWebviewCreationError(error: unknown): boolean {
  const message = formatUnknownError(error).toLowerCase();
  return message.includes('0x80070057')
    || message.includes('0x8007139f')
    || message.includes('failed to create webview');
}

function normalizeUrl(raw: string, defaultUrl: string): string {
  const value = raw.trim();
  if (!value) return defaultUrl;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)) return value;
  return `https://${value}`;
}

async function evalWebview(label: string, script: string): Promise<void> {
  await api.invoke('browser_webview_eval', { request: { label, script } });
}

async function injectBrowserPageScripts(label: string): Promise<void> {
  await evalWebview(label, `${BLANK_TARGET_INTERCEPT_SCRIPT};\n${STREAM_RENDER_OPTIMIZATION_SCRIPT};`);
}

async function navigateWebview(label: string, url: string, openRequestId?: string): Promise<void> {
  await api.invoke('browser_webview_navigate', {
    request: { label, url, openRequestId },
  });
}

async function reloadWebview(label: string): Promise<void> {
  await api.invoke('browser_webview_reload', { request: { label } });
}

async function setWebviewBounds(label: string, bounds: WebviewBounds): Promise<void> {
  await api.invoke('browser_webview_set_bounds', {
    request: {
      label,
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
    },
  });
}

// Minimal `invoke` signature accepted by the command-based handle. Matches the
// runtime shape of `@tauri-apps/api/core`'s `invoke` once its generic `T` is
// erased to `unknown`.
type TauriInvoke = (cmd: string, args?: Record<string, unknown> | unknown[]) => Promise<unknown>;

/**
 * Build a `BrowserWebviewHandle` whose `close / hide / show / setFocus` ops
 * route through Tauri commands (`browser_webview_close/hide/show/set_focus`)
 * that the Rust side resolves to the platform's native webview handle —
 * `app.get_webview(label)` on desktop (Tauri child webview), or the ArkTS
 * `BrowserWebviewService` on OHOS (ArkUI Web component). This avoids the
 * `@tauri-apps/api/webview` `Webview.getByLabel()` call entirely, which
 * queries Tauri's own webview registry and returns null/throws for webviews
 * created outside that registry (notably ArkUI Web components on OHOS).
 */
export function createCommandBasedBrowserWebviewHandle(
  label: string,
  invoke: TauriInvoke,
): BrowserWebviewHandle {
  let commandQueue: Promise<unknown> = Promise.resolve();
  const enqueue = (command: string): Promise<void> => {
    const operation = commandQueue
      .catch(() => undefined)
      .then(async () => {
        await invoke(command, { request: { label } });
      });
    commandQueue = operation;
    return operation;
  };
  const close = async (): Promise<void> => {
    await enqueue('browser_webview_close');
  };
  const hide = async (): Promise<void> => {
    await enqueue('browser_webview_hide');
  };
  const show = async (): Promise<void> => {
    await enqueue('browser_webview_show');
  };
  const setFocus = async (): Promise<void> => {
    await enqueue('browser_webview_set_focus');
  };
  return { close, hide, label, setFocus, show };
}

/**
 * Create a browser webview via the `browser_webview_create` Tauri command
 * and return a command-based handle. The handle's show/hide/close/setFocus
 * ops route through Tauri commands (not `Webview.getByLabel`) so they work
 * uniformly on desktop (Tauri child webview) and OHOS (ArkUI Web component).
 */
async function createBrowserWebview(
  label: string,
  url: string,
  bounds: WebviewBounds,
  html?: string,
): Promise<BrowserWebviewHandle> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('browser_webview_create', {
async function setAgentTargetState(
  label: string,
  active: boolean,
  openRequestId?: string,
): Promise<void> {
  await api.invoke('browser_webview_set_agent_target_state', {
    request: { label, active, openRequestId },
  });
}

async function createBrowserWebview(
  label: string,
  url: string,
  bounds: WebviewBounds,
  openRequestId?: string,
): Promise<BrowserWebviewHandle> {
  const { Webview } = await import('@tauri-apps/api/webview');
  await api.invoke('browser_webview_create', {
    request: {
      label,
      url,
      html: html ?? null,
      x: bounds.left,
      y: bounds.top,
      width: bounds.width,
      height: bounds.height,
      openRequestId,
    },
  });
  return createCommandBasedBrowserWebviewHandle(label, invoke as TauriInvoke);
}

export function useEmbeddedBrowserWebview(options: UseEmbeddedBrowserWebviewOptions) {
  const {
    automationId,
    automationTitle,
    adoptExistingWebview,
    defaultUrl,
    initialUrl,
    initialHtml,
    isVisible,
    labelPrefix,
    log,
    requestedWebviewLabel,
  } = options;
  const { defaultUrl, initialUrl, isVisible, labelPrefix, log, openRequestId } = options;
  const isTauri = useMemo(() => isTauriEnvironment(), []);
  const startUrl = initialUrl ?? defaultUrl;
  const initialHtmlRef = useRef<string | undefined>(initialHtml);
  const automationBootstrapRef = useRef<string | undefined>(
    automationId && automationTitle
      ? createAutomationBootstrapHtml(automationId, automationTitle)
      : undefined,
  );
  const adoptExistingWebviewRef = useRef(adoptExistingWebview === true);
  const externallyOwnedWebviewRef = useRef(
    adoptExistingWebview === true && Boolean(automationId && requestedWebviewLabel),
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<BrowserWebviewHandle | null>(null);
  const currentUrlRef = useRef<string>(startUrl);
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;
  const resizeTimerRef = useRef<number | null>(null);
  const lastBoundsRef = useRef<WebviewBounds | null>(null);
  const webviewLabelRef = useRef<string>('');
  const pageLoadUnlistenRef = useRef<(() => void) | null>(null);
  const webviewCreationInFlightRef = useRef(false);
  const visibilityRevisionRef = useRef(0);

  const [inputValue, setInputValue] = useState(startUrl);
  const [currentUrl, setCurrentUrl] = useState(startUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [webviewLabel, setWebviewLabel] = useState('');

  const readViewportBounds = useCallback((): WebviewBounds | null => {
    if (!viewportRef.current) return null;

    const rect = viewportRef.current.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return null;

    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }, []);

  const waitForViewportBounds = useCallback(async (): Promise<WebviewBounds> => {
    const startedAt = performance.now();

    while (performance.now() - startedAt < WEBVIEW_BOUNDS_WAIT_TIMEOUT_MS) {
      const bounds = readViewportBounds();
      if (bounds) return bounds;

      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }

    throw new Error('Browser viewport did not become visible before webview creation');
  }, [readViewportBounds]);

  const syncWebviewBounds = useCallback(async (handle?: BrowserWebviewHandle | null) => {
    const target = handle ?? webviewRef.current;
    if (!isTauri || !target || !viewportRef.current) return;

    const nextBounds = readViewportBounds();
    if (!nextBounds) {
      // #region agent log
      const viewport = viewportRef.current;
      const viewportRect = viewport?.getBoundingClientRect();
      const ancestors: Array<Record<string, unknown>> = [];
      let ancestor = viewport?.parentElement ?? null;
      for (let index = 0; ancestor && index < 6; index += 1, ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        const rect = ancestor.getBoundingClientRect();
        ancestors.push({
          tagName: ancestor.tagName,
          className: ancestor.className,
          display: style.display,
          visibility: style.visibility,
          width: rect.width,
          height: rect.height,
        });
      }
      writeBrowserWebviewDiagnostic('F', 'useEmbeddedBrowserWebview.syncWebviewBounds', isVisibleRef.current
        ? 'keeping active webview at its last valid bounds while viewport is transiently unavailable'
        : 'hiding inactive webview because viewport has no usable bounds', {
        label: target.label,
        isVisible: isVisibleRef.current,
        hasViewport: Boolean(viewport),
        isConnected: viewport?.isConnected ?? false,
        viewportRect: viewportRect ? {
          left: viewportRect.left,
          top: viewportRect.top,
          width: viewportRect.width,
          height: viewportRect.height,
        } : null,
        windowSize: { width: window.innerWidth, height: window.innerHeight },
        ancestors,
      });
      // #endregion
      if (!isVisibleRef.current) {
        await target.hide().catch(() => {});
      }
      return;
    }

    const previous = lastBoundsRef.current;
    const boundsChanged =
      !previous ||
      Math.abs(previous.left - nextBounds.left) > WEBVIEW_BOUNDS_EPSILON ||
      Math.abs(previous.top - nextBounds.top) > WEBVIEW_BOUNDS_EPSILON ||
      Math.abs(previous.width - nextBounds.width) > WEBVIEW_BOUNDS_EPSILON ||
      Math.abs(previous.height - nextBounds.height) > WEBVIEW_BOUNDS_EPSILON;

    if (boundsChanged) {
      await setWebviewBounds(target.label, nextBounds);
      lastBoundsRef.current = nextBounds;
    }
  }, [isTauri, readViewportBounds]);

  const detachWebview = useCallback((
    handle?: BrowserWebviewHandle | null,
    updateReactState = true,
  ) => {
    const target = handle ?? webviewRef.current;
    if (target && target !== webviewRef.current) return;
    webviewRef.current = null;
    webviewLabelRef.current = '';
    if (updateReactState) setWebviewLabel('');
    lastBoundsRef.current = null;
    pageLoadUnlistenRef.current?.();
    pageLoadUnlistenRef.current = null;
  }, []);

  const closeWebview = useCallback(async (
    handle?: BrowserWebviewHandle | null,
    updateReactState = true,
  ) => {
    const target = handle ?? webviewRef.current;
    if (!target) return;

    try {
      await setAgentTargetState(target.label, false).catch(() => {});
      await target.close();
    } catch (closeError) {
      if (!isWebviewNotFoundError(closeError)) {
        log.warn('Close browser webview failed', closeError);
      }
    } finally {
      detachWebview(target, updateReactState);
    }
  }, [detachWebview, log]);

  const hideAndDetachWebview = useCallback(async () => {
    const target = webviewRef.current;
    if (!target) return;
    try {
      await target.hide();
    } catch (hideError) {
      if (!isWebviewNotFoundError(hideError)) {
        log.warn('Hide browser webview before detach failed', hideError);
      }
    } finally {
      // This path is used only during component teardown. Avoid scheduling a
      // React state update after the component has unmounted.
      detachWebview(target, false);
    }
  }, [detachWebview, log]);

  const startPageLoadListener = useCallback(async (label: string) => {
    pageLoadUnlistenRef.current?.();
    pageLoadUnlistenRef.current = null;

    const { listen } = await import('@tauri-apps/api/event');
    pageLoadUnlistenRef.current = await listen<BrowserWebviewPageLoadPayload>(
      BROWSER_WEBVIEW_PAGE_LOAD_EVENT,
      ({ payload }) => {
        if (!payload || payload.label !== label) return;
        if (payload.event === 'started') {
          setIsLoading(true);
        } else {
          setIsLoading(false);
        }
        if (payload.url && payload.url !== currentUrlRef.current) {
          currentUrlRef.current = payload.url;
          setInputValue(payload.url);
          setCurrentUrl(payload.url);
          setError(null);
          injectBrowserPageScripts(label).catch(() => {});
        }
      },
    );
  }, []);

  const createWebview = useCallback(async (url: string) => {
    const previous = webviewRef.current;
    if (previous) await closeWebview(previous);

    const { invoke } = await import('@tauri-apps/api/core');
    const initialBounds = await waitForViewportBounds();
    let lastError: unknown = null;

    for (let attempt = 0; attempt < WEBVIEW_CREATE_RETRY_DELAYS_MS.length; attempt += 1) {
      const delay = WEBVIEW_CREATE_RETRY_DELAYS_MS[attempt];
      if (delay > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }

      const label = requestedWebviewLabel ?? createBrowserWebviewLabel(labelPrefix);
      webviewLabelRef.current = label;
      setWebviewLabel(label);
      try {
        if (adoptExistingWebviewRef.current) {
          const { invoke } = await import('@tauri-apps/api/core');
          const handle = createCommandBasedBrowserWebviewHandle(label, invoke as TauriInvoke);
          // The backend creates automation WebViews offscreen at a stable CDP
          // viewport size. Apply the measured panel bounds before the first
          // show; marking them as synced without this call exposes the initial
          // 1280x720 surface over the BitFun window.
          await setWebviewBounds(label, initialBounds);
          webviewRef.current = handle;
          lastBoundsRef.current = initialBounds;
          await startPageLoadListener(label);
          void injectBrowserPageScripts(label).catch(() => {});
          adoptExistingWebviewRef.current = false;
          return handle;
        }
        const bootstrapHtml = automationBootstrapRef.current;
        const handle = await createBrowserWebview(
          label,
          url,
          initialBounds,
          bootstrapHtml ?? initialHtmlRef.current,
        );
        webviewRef.current = handle;
        lastBoundsRef.current = initialBounds;
        await injectBrowserPageScripts(label);
        await startPageLoadListener(label);
        automationBootstrapRef.current = undefined;
        initialHtmlRef.current = undefined;
        return handle;
      } catch (creationError) {
        lastError = creationError;
        // Clean up any partially-created webview via the command path — works
        // on both desktop (Tauri child webview) and OHOS (ArkUI Web node).
        // Agent automation WebViews are backend-owned and may still have a
        // healthy CDP target, so an adoption/display error must not destroy it.
        if (!externallyOwnedWebviewRef.current) {
          await invoke('browser_webview_close', { request: { label } }).catch(() => {});
        }
        if (!isTransientWebviewCreationError(creationError)
          || attempt === WEBVIEW_CREATE_RETRY_DELAYS_MS.length - 1) {
          throw creationError;
        }
        log.warn('Retry browser webview creation after transient WebView2 error', {
          attempt: attempt + 1,
          error: formatUnknownError(creationError),
        });
      }
    }

    throw lastError;
  }, [closeWebview, labelPrefix, log, requestedWebviewLabel, startPageLoadListener, waitForViewportBounds]);

  useEffect(() => {
    if (!automationId) return;
    const handleClose = (event: Event) => {
      const detail = (event as CustomEvent<{ automationId?: string }>).detail;
      if (detail?.automationId !== automationId) return;
      void closeWebview();
    };
    window.addEventListener(CLOSE_BUILT_IN_BROWSER_EVENT, handleClose);
    return () => window.removeEventListener(CLOSE_BUILT_IN_BROWSER_EVENT, handleClose);
  }, [automationId, closeWebview]);

  const navigateExistingWebview = useCallback(async (url: string): Promise<boolean> => {
    const label = webviewLabelRef.current;
    if (!label || !webviewRef.current) return false;

    try {
      await navigateWebview(label, url, openRequestId);
      window.setTimeout(() => {
        if (webviewLabelRef.current === label) {
          void injectBrowserPageScripts(label).catch(() => {});
        }
      }, 1000);
      window.setTimeout(() => {
        if (webviewLabelRef.current === label) {
          void injectBrowserPageScripts(label).catch(() => {});
        }
      }, 2500);
      return true;
    } catch (navigationError) {
      log.warn('Navigate browser webview via existing instance failed', navigationError);
      return false;
    }
  }, [log, openRequestId]);

  const loadUrl = useCallback(async (rawUrl: string) => {
    const nextUrl = normalizeUrl(rawUrl, defaultUrl);
    setInputValue(nextUrl);
    setCurrentUrl(nextUrl);
    currentUrlRef.current = nextUrl;
    setError(null);
    setIsLoading(true);

    if (!isTauri) {
      setIsLoading(false);
      return;
    }

    try {
      validateUrl(nextUrl);
      let handle = webviewRef.current;
      if (!handle) {
        if (!isVisible || !readViewportBounds()) {
          return;
        }
        if (webviewCreationInFlightRef.current) {
          return;
        }
        webviewCreationInFlightRef.current = true;
        try {
          handle = await createWebview(nextUrl);
        } finally {
          webviewCreationInFlightRef.current = false;
        }
      } else {
        const navigated = await navigateExistingWebview(nextUrl);
        if (!navigated) {
          if (externallyOwnedWebviewRef.current) {
            throw new Error(`Unable to navigate the Agent-owned browser WebView: ${handle.label}`);
          }
          handle = await createWebview(nextUrl);
        }
      }
      await syncWebviewBounds(handle);
      if (isVisibleRef.current && webviewRef.current === handle) {
        await handle.show();
        if (isVisibleRef.current && webviewRef.current === handle) {
          await handle.setFocus();
        }
      } else {
        await handle.hide().catch(() => {});
        await handle.setFocus();
        await setAgentTargetState(handle.label, true, openRequestId);
      }
    } catch (loadError) {
      const message = formatUnknownError(loadError);
      if (isViewportUnavailableError(loadError)) {
        log.warn('Deferring browser WebView activation until the panel is visible');
      } else {
        log.error('Load browser url failed', loadError);
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, [createWebview, defaultUrl, isTauri, isVisible, log, navigateExistingWebview, readViewportBounds, syncWebviewBounds]);
  }, [createWebview, defaultUrl, isTauri, isVisible, log, navigateExistingWebview, openRequestId, syncWebviewBounds]);

  const queueSync = useCallback(() => {
    if (resizeTimerRef.current !== null) window.clearTimeout(resizeTimerRef.current);
    resizeTimerRef.current = window.setTimeout(() => {
      resizeTimerRef.current = null;
      void syncWebviewBounds().catch((syncError) => {
        log.warn('Sync browser webview bounds failed', syncError);
      });
    }, WEBVIEW_RESIZE_DEBOUNCE_MS);
  }, [log, syncWebviewBounds]);

  useEffect(() => {
    if (!isTauri) return;

    const revision = ++visibilityRevisionRef.current;
    const handle = webviewRef.current;

    if (isVisible) {
      // #region agent log
      writeBrowserWebviewDiagnostic('G', 'useEmbeddedBrowserWebview.visibilityEffect', 'browser surface activated', {
        label: webviewRef.current?.label ?? null,
      });
      // #endregion
      if (!handle) {
        if (!readViewportBounds() || webviewCreationInFlightRef.current) {
          return;
        }
        void loadUrl(currentUrlRef.current).catch((loadError) => {
          log.warn('Restore browser webview failed', loadError);
        });
        return;
      }

      void syncWebviewBounds(handle)
        .then(async () => {
          if (
            revision !== visibilityRevisionRef.current
            || !isVisibleRef.current
            || webviewRef.current !== handle
          ) {
            return;
          }
          await handle.show();
          if (
            revision === visibilityRevisionRef.current
            && isVisibleRef.current
            && webviewRef.current === handle
          ) {
            await handle.setFocus();
          }
        })
        .catch((syncError) => {
          log.warn('Activate browser webview failed', syncError);
        });
      return () => {
        if (visibilityRevisionRef.current === revision) {
          visibilityRevisionRef.current += 1;
        }
      };
    }

    if (handle) {
      // #region agent log
      writeBrowserWebviewDiagnostic('G', 'useEmbeddedBrowserWebview.visibilityEffect', 'hiding webview because browser surface deactivated', {
        label: handle.label,
      });
      // #endregion
      void handle.hide().catch((hideError) => {
        log.warn('Hide browser webview on deactivate failed', hideError);
      });
    }
  }, [isTauri, isVisible, loadUrl, log, readViewportBounds, syncWebviewBounds]);

  useEffect(() => {
    if (!isTauri) return;

    const observer = new ResizeObserver(() => {
      if (!isVisible) return;
      if (!webviewRef.current && readViewportBounds() && !webviewCreationInFlightRef.current) {
        void loadUrl(currentUrlRef.current).catch((loadError) => {
          log.warn('Restore browser webview after panel resize failed', loadError);
        });
        return;
      }
      queueSync();
    });

    if (viewportRef.current) observer.observe(viewportRef.current);

    const handleResize = () => {
      if (isVisible) queueSync();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [isTauri, isVisible, loadUrl, log, queueSync, readViewportBounds]);

  useEffect(() => () => {
    pageLoadUnlistenRef.current?.();
    pageLoadUnlistenRef.current = null;
    if (resizeTimerRef.current !== null) {
      window.clearTimeout(resizeTimerRef.current);
      resizeTimerRef.current = null;
    }
    if (externallyOwnedWebviewRef.current) {
      void hideAndDetachWebview();
    } else {
      void closeWebview(undefined, false);
    }
  }, [closeWebview, hideAndDetachWebview]);

  useEffect(() => {
    if (!isTauri) return;

    let hiddenByOverlay = false;
    const checkOverlays = () => {
      const overlay = document.querySelector<HTMLElement>(BROWSER_WEBVIEW_BLOCKING_OVERLAY_SELECTOR);
      const hasOverlay = overlay !== null;
      // #region agent log
      if (overlay) {
        const style = window.getComputedStyle(overlay);
        const rect = overlay.getBoundingClientRect();
        writeBrowserWebviewDiagnostic('E', 'useEmbeddedBrowserWebview.checkOverlays', 'overlay selector matched', {
          label: webviewRef.current?.label ?? null,
          className: overlay.className,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          width: rect.width,
          height: rect.height,
          hiddenByOverlay,
        });
      }
      // #endregion
      if (hasOverlay && !hiddenByOverlay) {
        hiddenByOverlay = true;
        // #region agent log
        writeBrowserWebviewDiagnostic('E', 'useEmbeddedBrowserWebview.checkOverlays', 'hiding webview because overlay selector exists', {
          label: webviewRef.current?.label ?? null,
          className: overlay?.className ?? null,
        });
        // #endregion
        void webviewRef.current?.hide().catch(() => {});
      } else if (!hasOverlay && hiddenByOverlay) {
        hiddenByOverlay = false;
        const handle = webviewRef.current;
        if (isVisibleRef.current && handle) {
          // #region agent log
          writeBrowserWebviewDiagnostic('E', 'useEmbeddedBrowserWebview.checkOverlays', 'showing webview because overlay selector disappeared', {
            label: webviewRef.current?.label ?? null,
          });
          // #endregion
          void syncWebviewBounds(handle)
            .then(() => {
              if (!hiddenByOverlay && isVisibleRef.current && webviewRef.current === handle) {
                return handle.show();
              }
              return undefined;
            })
            .catch(() => {});
        }
      }
    };

    const observer = new MutationObserver(checkOverlays);
    observer.observe(document.body, { childList: true, subtree: true });
    checkOverlays();

    const handleToolbarActivating = () => {
      void webviewRef.current?.hide().catch(() => {});
    };
    window.addEventListener('toolbar-mode-activating', handleToolbarActivating);

    return () => {
      observer.disconnect();
      window.removeEventListener('toolbar-mode-activating', handleToolbarActivating);
    };
  }, [isTauri, isVisible, syncWebviewBounds]);

  const evalInWebview = useCallback(async (script: string) => {
    const label = webviewLabelRef.current;
    if (!isTauri || !label) return;
    await evalWebview(label, script);
  }, [isTauri]);

  const goBack = useCallback(() => {
    void evalInWebview('history.back()').catch(() => {});
  }, [evalInWebview]);

  const goForward = useCallback(() => {
    void evalInWebview('history.forward()').catch(() => {});
  }, [evalInWebview]);

  const reload = useCallback(() => {
    const label = webviewLabelRef.current;
    if (!isTauri || !label) return;
    void reloadWebview(label).catch(() => {});
  }, [isTauri]);

  const getWebviewLabel = useCallback(() => webviewLabelRef.current, []);
  const getCurrentUrl = useCallback(() => currentUrlRef.current, []);
  const hasWebview = useCallback(() => webviewRef.current !== null, []);

  return useMemo(() => ({
    currentUrl,
    error,
    evalInWebview,
    getCurrentUrl,
    getWebviewLabel,
    goBack,
    goForward,
    hasWebview,
    inputValue,
    isLoading,
    isTauri,
    loadUrl,
    reload,
    setInputValue,
    viewportRef,
    webviewLabel,
  }), [
    currentUrl,
    error,
    evalInWebview,
    getCurrentUrl,
    getWebviewLabel,
    goBack,
    goForward,
    hasWebview,
    inputValue,
    isLoading,
    isTauri,
    loadUrl,
    reload,
    viewportRef,
    webviewLabel,
  ]);
}
