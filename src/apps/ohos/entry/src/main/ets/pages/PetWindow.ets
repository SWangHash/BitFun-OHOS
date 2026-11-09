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
const PET_SCHEME: string = 'bitfunpet';
const PET_SCHEME_HOST: string = 'local';
const RESFILE_DIST: string = 'resources/resfile/dist';
const PAGE_PATH_KEY: string = 'bitfunPetPagePath';

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

  resize(width: number, height: number): void {
    this.onRect({ width: width, height: height });
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
  private hideSubscriber: commonEventManager.CommonEventSubscriber | null = null;
  private rectSubscriber: commonEventManager.CommonEventSubscriber | null = null;
  private petWindow: window.Window | null = null;
  private pageUrl: string = '';
  private lastWidth: number = 0;
  private lastHeight: number = 0;

  aboutToAppear(): void {
    // The scheme has to be registered before the Web component attaches its
    // controller, otherwise the first navigation fails and the window stays
    // blank until a reload.
    try {
      webview.WebviewController.customizeSchemes([
        { schemeName: PET_SCHEME, isSupportCORS: true, isSupportFetch: true },
      ]);
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      hilog.error(DOMAIN, PET_WINDOW_TAG,
        `customizeSchemes failed: code=${businessError.code} message=${businessError.message}`);
    }
    const pagePath: string = AppStorage.get<string>(PAGE_PATH_KEY) ?? 'index.html?bitfunWindow=agent-companion';
    this.pageUrl = `${PET_SCHEME}://${PET_SCHEME_HOST}/${pagePath}`;
    this.petWindow = AppStorage.get<window.Window>('bitfunPetWindow') ?? null;
    hilog.info(DOMAIN, PET_WINDOW_TAG, `pet page loading: ${this.pageUrl}`);
    this.subscribeHostEvents();
  }

  aboutToDisappear(): void {
    disposePetSubscriber(this.deliverSubscriber);
    disposePetSubscriber(this.hideSubscriber);
    disposePetSubscriber(this.rectSubscriber);
    this.deliverSubscriber = null;
    this.hideSubscriber = null;
    this.rectSubscriber = null;
  }

  private subscribeHostEvents(): void {
    void createPetSubscriber(PET_DELIVER_EVENT, data => this.deliverToPage(data))
      .then(subscriber => { this.deliverSubscriber = subscriber; });
    void createPetSubscriber(PET_HIDE_EVENT, () => this.terminatePetAbility())
      .then(subscriber => { this.hideSubscriber = subscriber; });
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

  private terminatePetAbility(): void {
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    try {
      context.terminateSelf();
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      hilog.warn(DOMAIN, PET_WINDOW_TAG, `terminateSelf failed: ${businessError.message}`);
    }
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
    const context = this.getUIContext().getHostContext() as common.UIAbilityContext;
    const path: string = `${context.bundleCodeDir}/${RESFILE_DIST}/${relative}`;
    try {
      const file = fileIo.openSync(path, fileIo.OpenMode.READ_ONLY);
      try {
        const stat = fileIo.statSync(file.fd);
        const buffer: ArrayBuffer = new ArrayBuffer(stat.size);
        fileIo.readSync(file.fd, buffer);
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
        .javaScriptProxy({
          object: new PetWindowHostProxy(
            this.controller,
            () => this.terminatePetAbility(),
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
