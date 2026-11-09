import { display, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import RustModule from 'libbitfun_desktop_lib.so';

const DOMAIN: number = 0x0000;
const TAG: string = 'BitFunDesktopCard';

/** Page registered in `resources/base/profile/main_pages.json`. */
const CARD_PAGE: string = 'pages/DesktopCard';
const WINDOW_LABEL_PREFIX: string = 'desktop-card-';
const EDGE_MARGIN_VP: number = 24;
const CASCADE_STEP_VP: number = 28;
const MIN_CARD_WIDTH_VP: number = 180;
const MIN_CARD_HEIGHT_VP: number = 96;
const MAX_CARD_WIDTH_VP: number = 640;
const MAX_CARD_HEIGHT_VP: number = 720;
const CARD_BACKGROUND: string = '#00000000';

export interface DesktopCardViewSize {
  width: number;
  height: number;
}

export interface DesktopCardViewPosition {
  x: number;
  y: number;
}

/** Request shape sent by `desktop_cards::ohos` over `desktop_card_window_ohos`. */
export interface DesktopCardWindowRequest {
  action: string;
  cardId?: string;
  /** Opaque JSON view model; stored as text so the page can parse it. */
  view?: Object;
  size?: DesktopCardViewSize;
  position?: DesktopCardViewPosition;
  alwaysOnTop?: boolean;
}

interface DesktopCardWindowEntry {
  cardId: string;
  win: window.Window;
  storage: LocalStorage;
  closed: boolean;
}

/** Payload for `RustModule.desktopCardOhosAction`. */
export interface DesktopCardActionPayload {
  cardId: string;
  itemId?: string;
  done?: boolean;
  alwaysOnTop?: boolean;
  desktopPinned?: boolean;
  url?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function ok(): string {
  return JSON.stringify({ ok: true });
}

function fail(message: string): string {
  return JSON.stringify({ ok: false, error: message });
}

function describeError(error: BusinessError | Error): string {
  const businessError = error as BusinessError;
  return businessError.message ?? String(error);
}

/**
 * Owns one ArkUI subwindow per visible desktop card.
 *
 * The Rust host pushes the whole presentation view on open/update, so this
 * service only manages window lifecycle and page state. Card interactions go
 * back through the napi bridge; results arrive again as an update push.
 */
export class DesktopCardWindowService {
  static instance: DesktopCardWindowService | null = null;

  private readonly stage: window.WindowStage;
  private readonly cards: Map<string, DesktopCardWindowEntry> = new Map<string, DesktopCardWindowEntry>();

  constructor(stage: window.WindowStage) {
    this.stage = stage;
  }

  static getInstance(): DesktopCardWindowService | null {
    return DesktopCardWindowService.instance;
  }

  async handle(arg: string): Promise<string> {
    let request: DesktopCardWindowRequest;
    try {
      request = JSON.parse(arg) as DesktopCardWindowRequest;
    } catch (error) {
      return fail('Invalid desktop card window request');
    }
    try {
      switch (request.action) {
        case 'open':
          return await this.open(request);
        case 'update':
          return this.update(request);
        case 'close':
          return this.close(request);
        case 'resize':
          return await this.resize(request);
        case 'focus':
          return await this.focus(request);
        default:
          return fail(`Unsupported desktop card window action: ${request.action}`);
      }
    } catch (error) {
      const message = describeError(error as BusinessError);
      hilog.warn(DOMAIN, TAG, `card window action failed: action=${request.action} error=${message}`);
      return fail(message);
    }
  }

  /** Starts the OS move loop for a card; called from the header drag gesture. */
  async startMoving(cardId: string): Promise<void> {
    const entry = this.cards.get(cardId);
    if (entry === undefined) {
      return;
    }
    try {
      await entry.win.startMoving();
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `startMoving failed: ${describeError(error as BusinessError)}`);
    }
  }

  private requireCardId(request: DesktopCardWindowRequest): string {
    const cardId = request.cardId;
    if (cardId === undefined || cardId.length === 0) {
      throw new Error('Desktop card window request is missing cardId');
    }
    return cardId;
  }

  private viewText(request: DesktopCardWindowRequest): string | undefined {
    if (request.view === undefined) {
      return undefined;
    }
    return JSON.stringify(request.view);
  }

  private async open(request: DesktopCardWindowRequest): Promise<string> {
    const cardId = this.requireCardId(request);
    const existing = this.cards.get(cardId);
    const view = this.viewText(request);
    if (existing !== undefined && !existing.closed) {
      if (view !== undefined) {
        existing.storage.setOrCreate('card', view);
      }
      await this.place(existing.win, request, this.cards.size);
      await existing.win.showWindow();
      return ok();
    }

    const win = await this.stage.createSubWindow(`${WINDOW_LABEL_PREFIX}${cardId}`);
    const storage = new LocalStorage();
    storage.setOrCreate('cardId', cardId);
    storage.setOrCreate('card', view ?? '');
    const entry: DesktopCardWindowEntry = {
      cardId: cardId,
      win: win,
      storage: storage,
      closed: false,
    };
    this.cards.set(cardId, entry);

    win.on('windowEvent', (event: window.WindowEventType) => {
      this.onWindowEvent(entry, event);
    });

    await win.loadContent(CARD_PAGE, storage);
    this.applyChrome(win);
    await this.place(win, request, this.cards.size - 1);
    await win.showWindow();
    return ok();  }

  private update(request: DesktopCardWindowRequest): string {
    const cardId = this.requireCardId(request);
    const entry = this.cards.get(cardId);
    const view = this.viewText(request);
    if (entry === undefined || entry.closed || view === undefined) {
      return ok();
    }
    entry.storage.setOrCreate('card', view);
    return ok();
  }

  private close(request: DesktopCardWindowRequest): string {
    const cardId = this.requireCardId(request);
    const entry = this.cards.get(cardId);
    if (entry === undefined) {
      return ok();
    }
    this.reportGeometry(entry);
    this.cards.delete(cardId);
    entry.closed = true;
    entry.win.destroyWindow().catch((error: BusinessError) => {
      hilog.warn(DOMAIN, TAG, `destroyWindow failed: ${error.message}`);
    });
    RustModule.desktopCardOhosClosed(cardId);
    return ok();
  }

  private async resize(request: DesktopCardWindowRequest): Promise<string> {
    const cardId = this.requireCardId(request);
    const entry = this.cards.get(cardId);
    const size = request.size;
    if (entry === undefined || entry.closed || size === undefined) {
      return ok();
    }
    await entry.win.resize(size.width, size.height);
    return ok();
  }

  private async focus(request: DesktopCardWindowRequest): Promise<string> {
    const cardId = this.requireCardId(request);
    const entry = this.cards.get(cardId);
    if (entry === undefined || entry.closed) {
      return ok();
    }
    await entry.win.showWindow();
    return ok();
  }

  private onWindowEvent(entry: DesktopCardWindowEntry, event: window.WindowEventType): void {
    if (event === window.WindowEventType.WINDOW_INACTIVE) {
      this.reportGeometry(entry);
      return;
    }
    if (event === window.WindowEventType.WINDOW_DESTROYED) {
      if (!entry.closed) {
        entry.closed = true;
        this.cards.delete(entry.cardId);
        this.reportGeometry(entry);
        RustModule.desktopCardOhosClosed(entry.cardId);
      }
    }
  }

  private geometryOf(entry: DesktopCardWindowEntry): DesktopCardActionPayload | null {
    try {
      const rect = entry.win.getWindowProperties().windowRect;
      const payload: DesktopCardActionPayload = {
        cardId: entry.cardId,
        x: px2vp(rect.left),
        y: px2vp(rect.top),
        width: px2vp(rect.width),
        height: px2vp(rect.height),
      };
      return payload;
    } catch (error) {
      hilog.debug(DOMAIN, TAG, `getWindowProperties failed: ${describeError(error as BusinessError)}`);
      return null;
    }
  }

  private reportGeometry(entry: DesktopCardWindowEntry): void {
    const payload = this.geometryOf(entry);
    if (payload === null) {
      return;
    }
    RustModule.desktopCardOhosAction('geometry', JSON.stringify(payload));
  }

  private applyChrome(win: window.Window): void {
    try {
      win.setWindowBackgroundColor(CARD_BACKGROUND);
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `setWindowBackgroundColor failed: ${describeError(error as BusinessError)}`);
    }
    try {
      win.setWindowDecorVisible(false);
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `setWindowDecorVisible failed: ${describeError(error as BusinessError)}`);
    }
    try {
      win.setWindowLimits({
        minWidth: vp2px(MIN_CARD_WIDTH_VP),
        minHeight: vp2px(MIN_CARD_HEIGHT_VP),
        maxWidth: vp2px(MAX_CARD_WIDTH_VP),
        maxHeight: vp2px(MAX_CARD_HEIGHT_VP),
      });
    } catch (error) {
      hilog.debug(DOMAIN, TAG, `setWindowLimits failed: ${describeError(error as BusinessError)}`);
    }
  }

  private async place(
    win: window.Window,
    request: DesktopCardWindowRequest,
    cascadeIndex: number,
  ): Promise<void> {
    const size: DesktopCardViewSize = request.size ?? { width: 280, height: 180 };
    const width = Math.min(Math.max(size.width, MIN_CARD_WIDTH_VP), MAX_CARD_WIDTH_VP);
    const height = Math.min(Math.max(size.height, MIN_CARD_HEIGHT_VP), MAX_CARD_HEIGHT_VP);
    await win.resize(vp2px(width), vp2px(height));
    const position = request.position ?? this.defaultPosition(width, height, cascadeIndex);
    await win.moveWindowTo(vp2px(position.x), vp2px(position.y));
  }

  private defaultPosition(
    width: number,
    height: number,
    cascadeIndex: number,
  ): DesktopCardViewPosition {
    let screenWidth = 1440;
    let screenHeight = 900;
    try {
      const screen = display.getDefaultDisplaySync();
      screenWidth = px2vp(screen.width);
      screenHeight = px2vp(screen.height);
    } catch (error) {
      hilog.warn(DOMAIN, TAG, `getDefaultDisplaySync failed: ${describeError(error as BusinessError)}`);
    }
    const steps = Math.max(Math.floor(screenHeight / 2 / CASCADE_STEP_VP), 1);
    const offset = (cascadeIndex % steps) * CASCADE_STEP_VP;
    return {
      x: Math.max(screenWidth - width - EDGE_MARGIN_VP - offset, 0),
      y: Math.min(EDGE_MARGIN_VP + offset, Math.max(screenHeight - height - EDGE_MARGIN_VP, 0)),
    };
  }
}

/** Installs the service and registers the Rust-facing host function. */
export function installDesktopCardWindowService(windowStage: window.WindowStage): DesktopCardWindowService {
  const service = new DesktopCardWindowService(windowStage);
  DesktopCardWindowService.instance = service;
  return service;
}
