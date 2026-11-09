import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { display, window } from '@kit.ArkUI';
import { webview } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';
import { commonEventManager } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import {
  PET_COMMAND_EVENT,
  PET_DELIVER_EVENT,
  PET_HIDE_EVENT,
  PET_READY_EVENT,
  PET_RECT_EVENT,
  PET_WINDOW_TAG,
  buildPetCommandEnvelope,
  createPetSubscriber,
  disposePetSubscriber,
  publishPetEvent,
  toJavaScriptStringLiteral,
} from '../services/PetWindowChannel';

const DOMAIN: number = 0x0000;
/**
 * Scheme the pet page is served from. The packaged frontend is served by the
 * Tauri asset protocol, which only exists inside the webview that Rust created
 * for the main window (`wry` registers it per WebviewController), so a plain
 * ArkWeb page cannot request `tauri://localhost`. Serving the same packaged
 * bytes from an app-owned scheme keeps module scripts working (a `file://` page
 * cannot import ES modules) without duplicating the bundle into rawfile.
 */
/**
 * Scheme the pet page is served from.
 *
 * ArkWeb only treats a fixed set of schemes as CORS-enabled
 * (`arkweb`, `asset`, `chrome*`, `data`, `http(s)`, `ipc`, `tauri`). A private
 * scheme registered with `customizeSchemes` is rejected once the ArkWeb engine
 * has already started (error 17100020, because the main window started it), and
 * the page then runs with origin `null`, which blocks every module script and
 * stylesheet. `tauri` is in that allowed set and the main window's webview
 * already registered it process-wide, so the pet page reuses it and answers the
 * requests itself through `onInterceptRequest`.
 */
const PET_SCHEME: string = 'tauri';
const PET_SCHEME_HOST: string = 'localhost';
const ENTRY_RESFILE_DIST: string = 'entry/resources/resfile/dist';
const APP_RESFILE_DIST: string = 'resources/resfile/dist';
const PAGE_PATH_KEY: string = 'bitfunPetPagePath';
/**
 * Document-start styling for this window.
 *
 * The shared frontend boots like the main window: it paints the theme's surface
 * colour on `<html>`/`<body>` and mounts a startup splash. In this small window
 * both read as a flat coloured frame, so the stylesheet is overridden before the
 * first paint and the splash is suppressed. `!important` beats the inline
 * background the bootstrap writes, and `#root` is forced visible because the
 * usual rule hides the shell until the splash hands off — there is no handoff
 * here.
 */
const PET_SURFACE_SCRIPT: string = '(function () {'
  + 'function paint() {'
  + 'try {'
  + 'if (!document.getElementById("bitfun-pet-window-surface")) {'
  + 'var style = document.createElement("style");'
  + 'style.id = "bitfun-pet-window-surface";'
  + 'style.textContent = "html,body{background:transparent !important;}"'
  + '+ "#bitfun-startup-overlay{display:none !important;}"'
  + '+ "#root{visibility:visible !important;}";'
  + '(document.head || document.documentElement).appendChild(style);'
  + '}'
  + 'if (document.documentElement) { document.documentElement.style.background = "transparent"; }'
  + 'if (document.body) { document.body.style.background = "transparent"; }'
  + '} catch (error) {}'
  + '}'
  + 'paint();'
  + 'if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", paint); }'
  + '})();';

interface PetRectRequest {
  width: number;
  height: number;
}

interface HostDeliverEnvelope {
  event: string;
  payload: ESObject;
}

function mimeTypeFor(path: string): string {
  const lower: string = path.toLowerCase();
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'text/javascript';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.woff2')) return 'font/woff2';
  if (lower.endsWith('.woff')) return 'font/woff';
  if (lower.endsWith('.ttf')) return 'font/ttf';
  if (lower.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

/**
 * Proxy ArkTS installs into the pet page as `window.bitfunPetHost`.
 *
 * Every method is fire-and-forget: the page's port treats these as commands, and
 * verdicts travel back as ordinary `agent-companion://` events, so no method can
 * leave the page waiting on a failed ArkTS call.
 */
class PetWindowHostProxy {
  private controller: webview.WebviewController;
  private onHide: () => void;
  private onRect: (rect: PetRectRequest) => void;
  private onFocus: () => void;
  private onStartDrag: () => void;
  private readyReported: boolean = false;

  constructor(
    controller: webview.WebviewController,
    onHide: () => void,
    onRect: (rect: PetRectRequest) => void,
    onFocus: () => void,
    onStartDrag: () => void,
  ) {
    this.controller = controller;
    this.onHide = onHide;
    this.onRect = onRect;
    this.onFocus = onFocus;
    this.onStartDrag = onStartDrag;
  }

  /** Relay one pet-window event to the main window (`{event, payload}`). */
  post(event: string, payloadJson: string): void {
    void publishPetEvent(PET_COMMAND_EVENT, buildPetCommandEnvelope(event, payloadJson));
  }

  hide(): void {
    this.onHide();
  }

  /**
   * The page's first resize means the pet has measured itself, which is the
   * earliest frame worth showing: the window is sized correctly and the pet is
   * laid out, so revealing it cannot expose a boot background.
   */
  resize(width: number, height: number): void {
    this.onRect({ width: width, height: height });
    if (!this.readyReported) {
      this.readyReported = true;
      void publishPetEvent(PET_READY_EVENT, '{}');
    }
  }

  focus(): void {
    this.onFocus();
  }

  showMainWindow(): void {
    void publishPetEvent(
      PET_COMMAND_EVENT,
      buildPetCommandEnvelope('agent-companion://show-main-window', 'null'),
    );
  }

  startDrag(): void {
    this.onStartDrag();
  }
}

@Entry
@Component
struct PetWindow {
  private controller: webview.WebviewController = new webview.WebviewController();
  private deliverSubscriber: commonEventManager.CommonEventSubscriber | null = null;
  private rectSubscriber: commonEventManager.CommonEventSubscriber | null = null;
  private petWindow: window.Window | null = null;
  private pageUrl: string = '';
  private resolvedDistRoot: string = '';
  private lastWidth: number = 0;
  private lastHeight: number = 0;
  private servedFirstFile: boolean = false;

  aboutToAppear(): void {
    const pagePath: string = AppStorage.get<string>(PAGE_PATH_KEY) ?? 'index.html?bitfunWindow=agent-companion';
    this.pageUrl = `${PET_SCHEME}://${PET_SCHEME_HOST}/${pagePath}`;
    this.petWindow = AppStorage.get<window.Window>('bitfunPetWindow') ?? null;
    hilog.info(DOMAIN, PET_WINDOW_TAG, `pet page loading: ${this.pageUrl}`);
    this.subscribeHostEvents();
  }

  aboutToDisappear(): void {
    disposePetSubscriber(this.deliverSubscriber);
    disposePetSubscriber(this.rectSubscriber);
    this.deliverSubscriber = null;
    this.rectSubscriber = null;
  }

  private subscribeHostEvents(): void {
    void createPetSubscriber(PET_DELIVER_EVENT, data => this.deliverToPage(data))
      .then(subscriber => { this.deliverSubscriber = subscriber; });
    // Hiding is the host ability's job (it owns the subwindow), so the page only
    // listens for content updates and size requests.
    void createPetSubscriber(PET_RECT_EVENT, data => {
      try {
        const rect: PetRectRequest = JSON.parse(data) as PetRectRequest;
        this.applyRect(rect.width, rect.height);
      } catch (error) {
        hilog.warn(DOMAIN, PET_WINDOW_TAG, 'ignored malformed pet rect request');
      }
    }).then(subscriber => { this.rectSubscriber = subscriber; });
  }

  /** Forward one `{event, payload}` envelope into the page's dispatcher. */
  private deliverToPage(envelopeJson: string): void {
    try {
      const envelope: HostDeliverEnvelope = JSON.parse(envelopeJson) as HostDeliverEnvelope;
      const script: string =
        'window.__bitfunPetHostDeliver && window.__bitfunPetHostDeliver('
        + toJavaScriptStringLiteral(JSON.stringify(envelope))
        + ');';
      this.controller.runJavaScript(script).catch((error: BusinessError) => {
        hilog.debug(DOMAIN, PET_WINDOW_TAG,
          `deliver ${envelope.event} failed: code=${error.code} message=${error.message}`);
      });
    } catch (error) {
      hilog.warn(DOMAIN, PET_WINDOW_TAG, 'ignored malformed pet deliver envelope');
    }
  }

  /**
   * Apply a CSS pixel box to the OS window.
   *
   * HarmonyOS applies `moveWindowToGlobalDisplay` and `resizeAsync`
   * asynchronously without atomic rendering, so a redundant resize while the
   * window is settling reads as a flicker. Requests that do not change the size
   * are dropped here, which is the only place that knows the current size.
   */
  private applyRect(widthCss: number, heightCss: number): void {
    const density: number = display.getDefaultDisplaySync().densityPixels;
    const scale: number = density > 0 ? density : 1;
    const width: number = Math.max(1, Math.round(widthCss * scale));
    const height: number = Math.max(1, Math.round(heightCss * scale));
    if (width === this.lastWidth && height === this.lastHeight) {
      return;
    }
    this.lastWidth = width;
    this.lastHeight = height;
    const target: window.Window | null = this.petWindow;
    if (target === null) {
      return;
    }
    target.resizeAsync(width, height).catch((error: BusinessError) => {
      this.lastWidth = 0;
      this.lastHeight = 0;
      hilog.warn(DOMAIN, PET_WINDOW_TAG,
        `resize ${width}x${height} failed: code=${error.code} message=${error.message}`);
    });
  }

  private focusPetWindow(): void {
    try {
      this.controller.requestFocus();
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      hilog.warn(DOMAIN, PET_WINDOW_TAG, `requestFocus failed: ${businessError.message}`);
    }
  }

  /** Hand the move loop to ArkUI so dragging needs no per-frame round trips. */
  private dragPetWindow(): void {
    const target: window.Window | null = this.petWindow;
    if (target === null) {
      return;
    }
    target.startMoving().catch((error: BusinessError) => {
      hilog.warn(DOMAIN, PET_WINDOW_TAG,
        `startMoving failed: code=${error.code} message=${error.message}`);
    });
  }

  /**
   * Report whether the bundle actually mounted.
   *
   * A loaded page with an empty `#root` means the frontend threw during startup
   * (for example a transport it needs is missing here), which looks identical to
   * "nothing loaded" from the outside. One log line tells the two apart.
   */
  private reportMountedContent(): void {
    const script: string =
      '(function(){var root=document.getElementById("root");'
      + 'return root ? String(root.childElementCount) : "no-root";})()';
    this.controller.runJavaScript(script).then((result: string) => {
      hilog.info(DOMAIN, PET_WINDOW_TAG, `pet page mounted children=${result}`);
    }).catch((error: BusinessError) => {
      hilog.warn(DOMAIN, PET_WINDOW_TAG,
        `pet mount probe failed: code=${error.code} message=${error.message}`);
    });
  }

  /**
   * Ask the host ability to close the pet window.
   *
   * The page must not terminate the ability: it now shares that ability with the
   * main window, so terminating it would close the whole app.
   */
  private requestHide(): void {
    void publishPetEvent(PET_HIDE_EVENT, '{}');
  }

  /**
   * Serve the packaged frontend for the pet scheme.
   *
   * The files are the same bytes the main window loads from
   * `resources/resfile/dist`, read through the HAP install directory because the
   * page needs a real HTTP-like origin for ES modules and fetch.
   */
  private servePackagedFile(url: string): WebResourceResponse {
    const prefix: string = `${PET_SCHEME}://${PET_SCHEME_HOST}/`;
    const relative: string = url.startsWith(prefix)
      ? url.slice(prefix.length).split('?')[0].split('#')[0]
      : '';
    if (relative.length === 0) {
      // The callback type is non-nullable, so ArkWeb cannot be told to fall back
      // to its default loader: answer misses explicitly instead of leaving the
      // page waiting on a body. The bundle only requests its own scheme, and
      // blob:/data: subresources never reach the intercept.
      return this.buildResponse('text/plain', '', 404);
    }
    const path: string = `${this.resolveDistRoot()}/${relative}`;
    try {
      const file = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
      try {
        const stat = fileIo.statSync(file.fd);
        const buffer: ArrayBuffer = new ArrayBuffer(stat.size);
        fileIo.readSync(file.fd, buffer);
        if (!this.servedFirstFile) {
          this.servedFirstFile = true;
          hilog.info(DOMAIN, PET_WINDOW_TAG, `serving ${relative} from ${path}`);
        }
        return this.buildResponse(mimeTypeFor(relative), buffer, 200);
      } finally {
        fileIo.closeSync(file);
      }
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      hilog.error(DOMAIN, PET_WINDOW_TAG,
        `serve ${relative} failed: code=${businessError.code} message=${businessError.message} path=${path}`);
      return this.buildResponse('text/plain', '', 404);
    }
  }

  /**
   * Directory the packaged frontend is read from.
   *
   * Rust resolves it from the resource directory and passes it in. When that is
   * missing (for example a native library older than this page), probe the
   * layouts a HAP can install with and remember the first one that really
   * contains `index.html`; guessing a single path silently produced a blank
   * window, and each probe is logged so hilog names the working layout.
   */
  private resolveDistRoot(): string {
    if (this.resolvedDistRoot.length > 0) {
      return this.resolvedDistRoot;
    }
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    // Module resources live one level below the bundle root on this platform:
    // `/data/storage/el1/bundle/entry/resources/resfile/dist` holds the staged
    // frontend, while the bundle-level `resources/resfile` stays empty. Keep both
    // candidates and log each probe so a packaging change is visible in hilog.
    const candidates: string[] = [
      `${context.bundleCodeDir}/${ENTRY_RESFILE_DIST}`,
      `${context.bundleCodeDir}/${APP_RESFILE_DIST}`,
    ];
    for (const candidate of candidates) {
      const hasIndex: boolean = fileIo.accessSync(`${candidate}/index.html`);
      hilog.info(DOMAIN, PET_WINDOW_TAG,
        `pet frontend candidate: path=${candidate} index_html=${hasIndex}`);
      if (hasIndex) {
        this.resolvedDistRoot = candidate;
        return candidate;
      }
    }
    // Nothing matched: keep the first candidate so the per-request failure logs
    // point at the place the build was expected to stage.
    this.resolvedDistRoot = candidates[0];
    hilog.error(DOMAIN, PET_WINDOW_TAG,
      `pet frontend missing; falling back to ${this.resolvedDistRoot}`);
    return this.resolvedDistRoot;
  }

  /**
   * Build an intercept response. `onInterceptRequest` must answer every request
   * it receives, so a miss still returns a response instead of leaving the page
   * waiting on a body that never arrives.
   */
  private buildResponse(
    mimeType: string,
    data: ArrayBuffer | string,
    responseCode: number,
  ): WebResourceResponse {
    const response: WebResourceResponse = new WebResourceResponse();
    response.setResponseMimeType(mimeType);
    response.setResponseEncoding('utf-8');
    response.setResponseData(data);
    response.setResponseCode(responseCode);
    response.setResponseIsReady(true);
    return response;
  }

  build() {
    Stack() {
      Web({ src: this.pageUrl, controller: this.controller })
        .width('100%')
        .height('100%')
        .backgroundColor(Color.Transparent)
        .domStorageAccess(true)
        .darkMode(WebDarkMode.Auto)
        .forceDarkAccess(false)
        .javaScriptAccess(true)
        .javaScriptOnDocumentStart([{ script: PET_SURFACE_SCRIPT, scriptRules: ['*'] }])
        .javaScriptProxy({
          object: new PetWindowHostProxy(
            this.controller,
            () => this.requestHide(),
            rect => this.applyRect(rect.width, rect.height),
            () => this.focusPetWindow(),
            () => this.dragPetWindow(),
          ),
          name: 'bitfunPetHost',
          methodList: ['post', 'hide', 'resize', 'focus', 'showMainWindow', 'startDrag'],
          controller: this.controller,
        })
        .onInterceptRequest(event => this.servePackagedFile(event.request.getRequestUrl()))
        .onPageEnd(() => {
          hilog.info(DOMAIN, PET_WINDOW_TAG, 'pet page loaded');
          this.reportMountedContent();
        })
        .onErrorReceive(event => {
          hilog.error(DOMAIN, PET_WINDOW_TAG,
            `pet page error: ${event.request.getRequestUrl()} ${event.error.getErrorInfo()}`);
        });
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Color.Transparent);
  }
}
