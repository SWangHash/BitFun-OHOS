/**
 * OpenHarmony host for the Desktop "open in an independent window" MiniApp
 * presentation.
 *
 * Rust counterpart: `src/apps/desktop/src/api/ohos/miniapp_window.rs` plus the
 * OHOS branch of `src/apps/desktop/src/miniapp_desktop/mod.rs`. The Desktop
 * contract, instance registry and shell protocol are unchanged; this service
 * only replaces the sidecar process with a `WindowStage` sub-window whose
 * ArkWeb page relays the shell protocol back into the in-process host.
 *
 * This file is OHOS product code and is absent upstream. Keep it, its page and
 * the `miniapp_window_*` registrations across upstream merges.
 */
import { window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import RustModule from 'libbitfun_desktop_lib.so';

const DOMAIN: number = 0xFF00;
const TAG: string = '[BitFunMiniAppWindow]';
const PAGE: string = 'pages/MiniAppWindow';
const MIN_WINDOW_WIDTH: number = 720;
const MIN_WINDOW_HEIGHT: number = 520;
const WINDOW_SCALE: number = 0.7;
const FALLBACK_TITLE: string = 'MiniApp';

export interface MiniAppWindowRequest {
  instanceId: string;
  viewId: string;
  nonce: string;
  appId: string;
  /** App name shown in the native title bar; Rust always sends it. */
  title?: string;
  workspacePath?: string;
}

interface OpenReply {
  ok: boolean;
  error?: string;
  requestId?: string;
}

interface ShellCallInput {
  operation: string;
  params?: Record<string, Object>;
}

interface ShellEnvelope {
  operation: string;
  params: Record<string, Object>;
  instanceId: string;
  viewId: string;
  nonce: string;
}

interface WindowCallRequest {
  operation: string;
  params: Record<string, Object>;
  instanceId: string;
  viewId: string;
  nonce: string;
}

/** A created sub-window plus whether it was created with its native decor. */
interface CreatedWindow {
  handle: window.Window;
  decorated: boolean;
}

function errorText(error: Object): string {
  const businessError: BusinessError = error as BusinessError;
  return businessError.message === undefined ? String(error) : businessError.message;
}

function opened(): string {
  const reply: OpenReply = { ok: true };
  return JSON.stringify(reply);
}

function failure(message: string): string {
  const reply: OpenReply = { ok: false, error: message };
  return JSON.stringify(reply);
}

/**
 * JavaScript proxy exposed to the window's shell page as
 * `window.ohosMiniAppHost`. Identity is bound to the window instance that owns
 * this object, so MiniApp content can never address another instance.
 */
export class MiniAppWindowBridge {
  private readonly windowName: string;

  constructor(windowName: string) {
    this.windowName = windowName;
  }

  /** Submit a shell operation; the returned request id is polled via `result`. */
  call(request: string): string {
    return MiniAppWindowService.getInstance().call(this.windowName, request);
  }

  result(requestId: string): string {
    return MiniAppWindowService.getInstance().result(requestId);
  }

  closeSelf(): void {
    MiniAppWindowService.getInstance().close(this.windowName);
  }

  /**
   * Publish the title the MiniApp document declares to the native title bar.
   *
   * The host only knows the app name when it creates the window; a MiniApp that
   * carries `chrome.titlebar.title` (or a localized name) names itself later,
   * during `bootstrap`.
   */
  setTitle(title: string): void {
    MiniAppWindowService.getInstance().updateTitle(this.windowName, title);
  }
}

export class MiniAppWindowService {
  private static instance: MiniAppWindowService | null = null;
  private windowStage: window.WindowStage | null = null;
  private sequence: number = 0;
  private readonly windows: Map<string, window.Window> = new Map();
  private readonly handles: Map<string, window.Window> = new Map();
  private readonly requests: Map<string, MiniAppWindowRequest> = new Map();
  private readonly names: Map<string, string> = new Map();
  private readonly bridges: Map<string, MiniAppWindowBridge> = new Map();
  private readonly closing: Set<string> = new Set();

  private constructor() {
  }

  static getInstance(): MiniAppWindowService {
    if (MiniAppWindowService.instance === null) {
      MiniAppWindowService.instance = new MiniAppWindowService();
    }
    return MiniAppWindowService.instance;
  }

  install(windowStage: window.WindowStage): void {
    this.windowStage = windowStage;
  }

  bridgeFor(windowName: string): MiniAppWindowBridge {
    let bridge = this.bridges.get(windowName);
    if (bridge === undefined) {
      bridge = new MiniAppWindowBridge(windowName);
    }
    return bridge;
  }

  /** Entry point for the Rust `miniapp_window_open` host call. */
  async open(arg: string): Promise<string> {
    let request: MiniAppWindowRequest;
    try {
      request = JSON.parse(arg) as MiniAppWindowRequest;
    } catch (error) {
      return failure('Invalid MiniApp window request');
    }
    const stage = this.windowStage;
    if (stage === null) {
      return failure('The HarmonyOS window stage is not ready');
    }
    const existingName = this.names.get(request.instanceId);
    if (existingName !== undefined) {
      const existing = this.windows.get(request.instanceId);
      if (existing !== undefined) {
        try {
          await existing.showWindow();
          return opened();
        } catch (error) {
          hilog.warn(DOMAIN, TAG, `focus MiniApp window failed: ${errorText(error)}`);
        }
      }
    }
    this.sequence += 1;
    const windowName: string = `bitfun-miniapp-${this.sequence}-${request.instanceId.slice(0, 8)}`;
    const requestedTitle: string = request.title === undefined ? '' : request.title.trim();
    const title: string = requestedTitle.length > 0 ? requestedTitle : FALLBACK_TITLE;
    try {
      const created: CreatedWindow =
        await this.createWindow(stage, windowName, title, this.frameRect(stage));
      const subWindow: window.Window = created.handle;
      this.windows.set(request.instanceId, subWindow);
      this.handles.set(windowName, subWindow);
      this.requests.set(windowName, request);
      this.names.set(request.instanceId, windowName);
      this.bridges.set(windowName, new MiniAppWindowBridge(windowName));
      subWindow.on('windowEvent', (event: window.WindowEventType) => {
        if (event === window.WindowEventType.WINDOW_DESTROYED) {
          this.handleDestroyed(windowName);
        }
      });
      const storage = new LocalStorage();
      storage.setOrCreate('bitfunMiniAppWindowName', windowName);
      await subWindow.loadContent(PAGE, storage);
      await subWindow.showWindow();
      this.applyNativeChrome(subWindow, title, created.decorated);
      return opened();
    } catch (error) {
      hilog.error(DOMAIN, TAG, `create MiniApp window failed: ${errorText(error)}`);
      this.handleDestroyed(windowName);
      return failure(errorText(error));
    }
  }

  /** Submit one shell operation with the identity of its own window. */
  call(windowName: string, request: string): string {
    const identity = this.requests.get(windowName);
    if (identity === undefined) {
      return failure('This MiniApp window is no longer attached');
    }
    let parsed: ShellCallInput;
    try {
      parsed = JSON.parse(request) as ShellCallInput;
    } catch (error) {
      return failure('Invalid MiniApp shell request');
    }
    const empty: Record<string, Object> = {};
    const envelope: ShellEnvelope = {
      operation: parsed.operation,
      params: parsed.params === undefined ? empty : parsed.params,
      instanceId: identity.instanceId,
      viewId: identity.viewId,
      nonce: identity.nonce,
    };
    try {
      return RustModule.miniappWindowCall(JSON.stringify(envelope));
    } catch (error) {
      return failure(errorText(error));
    }
  }

  /** Read a settled operation; the shell page polls this between submissions. */
  result(requestId: string): string {
    try {
      return RustModule.miniappWindowResult(requestId);
    } catch (error) {
      return failure(errorText(error));
    }
  }

  /**
   * Replace the native title bar text with the title the document declares.
   * The creation-time title is only the app name, which a MiniApp may override.
   */
  updateTitle(windowName: string, title: string): void {
    const target = this.handles.get(windowName);
    if (target === undefined) {
      return;
    }
    const trimmed: string = title.trim();
    const next: string = trimmed.length > 0 ? trimmed : FALLBACK_TITLE;
    target.setWindowTitle(next).catch((error: BusinessError) => {
      hilog.warn(DOMAIN, TAG, `setWindowTitle failed: ${errorText(error)}`);
    });
  }

  /** Close a window; the destroy path retires the host instance once. */
  async close(windowName: string): Promise<void> {
    const identity = this.requests.get(windowName);
    if (identity === undefined || this.closing.has(windowName)) {
      return;
    }
    this.closing.add(windowName);
    const target = this.windows.get(identity.instanceId);
    try {
      if (target !== undefined) {
        await target.destroyWindow();
      }
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `destroy MiniApp window failed: ${errorText(error)}`);
    }
    this.handleDestroyed(windowName);
  }

  /**
   * The OS closed the window (or creation failed): drop the local bookkeeping
   * and retire the host instance exactly once.
   */
  private handleDestroyed(windowName: string): void {
    const identity = this.requests.get(windowName);
    this.requests.delete(windowName);
    this.bridges.delete(windowName);
    this.closing.delete(windowName);
    this.handles.delete(windowName);
    if (identity === undefined) {
      return;
    }
    this.windows.delete(identity.instanceId);
    if (this.names.get(identity.instanceId) === windowName) {
      this.names.delete(identity.instanceId);
    }
    this.notifyHost(identity).catch((error: Object) => {
      hilog.warn(DOMAIN, TAG, `retire MiniApp instance failed: ${errorText(error)}`);
    });
  }

  private async notifyHost(identity: MiniAppWindowRequest): Promise<void> {
    const empty: Record<string, Object> = {};
    const request: WindowCallRequest = {
      operation: 'close',
      params: empty,
      instanceId: identity.instanceId,
      viewId: identity.viewId,
      nonce: identity.nonce,
    };
    const submitted: OpenReply = JSON.parse(
      RustModule.miniappWindowCall(JSON.stringify(request))) as OpenReply;
    if (submitted.ok && submitted.requestId !== undefined) {
      // Best-effort drain; a still-running close is retried by the bounded queue.
      RustModule.miniappWindowResult(submitted.requestId);
    }
  }

  /**
   * Create the window with its native title bar from the first frame.
   *
   * A MiniApp window is a normal window: the user moves, resizes and closes it
   * with the OS chrome, because the window does not render MiniApp custom
   * chrome. `decorEnabled` must therefore be part of the creation call:
   * `placeWindow` used to ask for the decor through `setWindowDecorVisible`
   * before `showWindow`, which the platform rejects with `1300002 "window state
   * abnormal"`, so the window ended up with neither a title nor a close button.
   */
  private async createWindow(
    stage: window.WindowStage,
    windowName: string,
    title: string,
    frame: window.Rect,
  ): Promise<CreatedWindow> {
    try {
      const decorated: window.Window = await stage.createSubWindowWithOptions(windowName, {
        title,
        decorEnabled: true,
        isModal: false,
        windowRect: frame,
      });
      const created: CreatedWindow = { handle: decorated, decorated: true };
      return created;
    } catch (error) {
      hilog.warn(DOMAIN, TAG,
        `decorated MiniApp sub-window unavailable, using an undecorated one: ${errorText(error)}`);
    }
    const fallback: window.Window = await stage.createSubWindow(windowName);
    try {
      await fallback.resize(frame.width, frame.height);
      await fallback.moveWindowTo(frame.left, frame.top);
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `place MiniApp window failed: ${errorText(error)}`);
    }
    const created: CreatedWindow = { handle: fallback, decorated: false };
    return created;
  }

  /**
   * Re-assert the native chrome once the window is shown.
   *
   * Chrome calls are rejected with `1300002` while the window is not in a normal
   * state, so the decor is requested at creation time as well; this pass only
   * repairs the undecorated fallback carrier. A decorated window keeps the
   * creation-time title, because the shell republishes the MiniApp's own title
   * through `updateTitle` and a late call here would overwrite it.
   */
  private applyNativeChrome(subWindow: window.Window, title: string, decorated: boolean): void {
    if (!decorated) {
      try {
        subWindow.setWindowDecorVisible(true);
      } catch (error) {
        hilog.warn(DOMAIN, TAG, `setWindowDecorVisible failed: ${errorText(error)}`);
      }
      subWindow.setWindowTitle(title).catch((error: BusinessError) => {
        hilog.warn(DOMAIN, TAG, `setWindowTitle failed: ${errorText(error)}`);
      });
    }
    try {
      subWindow.setWindowTitleButtonVisible(true, true, true);
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `setWindowTitleButtonVisible failed: ${errorText(error)}`);
    }
  }

  /** Centered rect over the main window; a sane fallback if the main window is unreadable. */
  private frameRect(stage: window.WindowStage): window.Rect {
    try {
      const rect: window.Rect = stage.getMainWindowSync().getWindowProperties().windowRect;
      const width: number = Math.max(MIN_WINDOW_WIDTH, Math.round(rect.width * WINDOW_SCALE));
      const height: number = Math.max(MIN_WINDOW_HEIGHT, Math.round(rect.height * WINDOW_SCALE));
      const frame: window.Rect = {
        left: rect.left + Math.round((rect.width - width) / 2),
        top: rect.top + Math.round((rect.height - height) / 2),
        width,
        height,
      };
      return frame;
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `read the main window rect failed: ${errorText(error)}`);
      const frame: window.Rect = {
        left: 0,
        top: 0,
        width: MIN_WINDOW_WIDTH,
        height: MIN_WINDOW_HEIGHT,
      };
      return frame;
    }
  }
}
