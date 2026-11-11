import { common } from '@kit.AbilityKit';
import { display, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { PET_CARRIER_KEY, PET_WINDOW_TAG } from './PetWindowChannel';

const DOMAIN: number = 0x0000;
/**
 * Window names. A float window is the only carrier that stays above *other*
 * applications; a subwindow is the fallback for builds that cannot get the
 * restricted float permission, and is still a real top-level window without its
 * own Dock/task entry (a second UIAbility would add one).
 */
const PET_FLOAT_WINDOW_NAME: string = 'agent-companion-pet-float';
const PET_MAIN_WINDOW_NAME: string = 'agent-companion-pet-main';
const PET_SUBWINDOW_NAME: string = 'agent-companion-pet';
const PET_SUBWINDOW_TITLE: string = 'BitFun Pet';
/** Initial CSS pixel box; the pet page resizes it as bubbles appear. */
const PET_WINDOW_INITIAL_SIZE: number = 120;
const PET_WINDOW_EDGE_GAP: number = 16;
/** How long the window waits for the page's readiness signal before showing. */
const REVEAL_FALLBACK_MS: number = 2500;

const PAGE_PATH_KEY: string = 'bitfunPetPagePath';
const WINDOW_HANDLE_KEY: string = 'bitfunPetWindow';
const DEFAULT_PAGE_PATH: string = 'index.html?bitfunWindow=agent-companion';

/**
 * Owns the Agent companion pet window.
 *
 * Carrier preference, best first:
 *
 * 1. **Float window** (`TYPE_FLOAT`). The only HarmonyOS window that stays above
 *    other applications, which is what a desktop pet is for. It requires
 *    `ohos.permission.SYSTEM_FLOAT_WINDOW`, a restricted (ACL) permission, so a
 *    normal build gets error 201 here and falls back.
 * 2. **Subwindow**. A real top-level window with its own screen position and no
 *    Dock/task entry, but other applications cover it, and HarmonyOS hides it
 *    with its parent on minimize.
 *
 * `setWindowTopmost` is not an option for either: main windows reject a
 * subwindow with 1300004 ("Only main windows are supported"), and a main window
 * needs `ohos.permission.WINDOW_TOPMOST`, equally restricted.
 *
 * The page (`pages/PetWindow.ets`) receives the handle through AppStorage and
 * drives its own geometry/move loop; this service only creates, shows and
 * destroys the window.
 */
export class PetWindowService {
  private readonly windowStage: window.WindowStage;
  private readonly context: common.UIAbilityContext;
  private petWindow: window.Window | null = null;
  /** Which carrier actually got created; reported for logs and diagnostics. */
  private carrier: string = 'none';
  /** Whether the window has been shown for the current page. */
  private revealed: boolean = false;
  private revealTimer: number = -1;

  constructor(windowStage: window.WindowStage, context: common.UIAbilityContext) {
    this.windowStage = windowStage;
    this.context = context;
  }

  /**
   * Create the pet window and load the page into it, without showing it.
   *
   * The window only becomes visible once the page reports that the pet has been
   * measured (`reveal`). Showing it earlier exposes the document's boot
   * background — a flat theme colour — for as long as the SPA needs to start,
   * which is the flash users see before the pet appears.
   */
  async show(pagePath: string): Promise<void> {
    AppStorage.setOrCreate<string>(PAGE_PATH_KEY,
      pagePath.length > 0 ? pagePath : DEFAULT_PAGE_PATH);

    if (this.petWindow === null) {
      const created: window.Window | null = await this.createWindow();
      if (created === null) {
        return;
      }
      this.petWindow = created;
      this.revealed = false;
      AppStorage.setOrCreate<window.Window>(WINDOW_HANDLE_KEY, created);
      try {
        await created.loadContent('pages/PetWindow');
      } catch (error) {
        this.logWindowError('loadContent', error);
        return;
      }
      this.armRevealFallback();
      return;
    }

    await this.reveal();
  }

  /**
   * Make the window visible. Idempotent, and safe to call from the page's
   * readiness signal or from the fallback timer.
   */
  async reveal(): Promise<void> {
    const petWindow: window.Window | null = this.petWindow;
    if (this.revealed || petWindow === null) {
      return;
    }
    this.revealed = true;
    this.cancelRevealFallback();
    try {
      await petWindow.showWindow();
      // Chrome changes are only accepted once the window is in a normal state;
      // doing this earlier returns error 1300002 ("window state abnormal") and
      // leaves the title bar visible.
      this.hideChrome(petWindow);
      hilog.info(DOMAIN, PET_WINDOW_TAG,
        `pet window revealed: carrier=${this.carrier} decor=${petWindow.getWindowDecorVisible()}`);
    } catch (error) {
      this.revealed = false;
      this.logWindowError('showWindow', error);
    }
  }

  /**
   * Safety net: if the page never reports readiness (a page that failed to start,
   * a webview that does not run hidden), show the window anyway so the pet cannot
   * become permanently invisible.
   */
  private armRevealFallback(): void {
    this.cancelRevealFallback();
    this.revealTimer = setTimeout(() => {
      this.revealTimer = -1;
      hilog.warn(DOMAIN, PET_WINDOW_TAG,
        'pet page did not report readiness in time; revealing the window anyway');
      void this.reveal();
    }, REVEAL_FALLBACK_MS);
  }

  private cancelRevealFallback(): void {
    if (this.revealTimer !== -1) {
      clearTimeout(this.revealTimer);
      this.revealTimer = -1;
    }
  }

  /** Destroy the pet window; the next `show` recreates it. */
  async hide(): Promise<void> {
    this.cancelRevealFallback();
    this.revealed = false;
    const petWindow: window.Window | null = this.petWindow;
    this.petWindow = null;
    AppStorage.setOrCreate<window.Window | null>(WINDOW_HANDLE_KEY, null);
    if (petWindow === null) {
      return;
    }
    try {
      await petWindow.destroyWindow();
      hilog.info(DOMAIN, PET_WINDOW_TAG, `pet window destroyed: carrier=${this.carrier}`);
    } catch (error) {
      this.logWindowError('destroyWindow', error);
    }
  }

  /** Release the window when the ability goes away. */
  async dispose(): Promise<void> {
    await this.hide();
  }

  private async createWindow(): Promise<window.Window | null> {
    const floatWindow: window.Window | null = await this.createFloatWindow();
    if (floatWindow !== null) {
      this.carrier = 'float';
      AppStorage.setOrCreate<string>(PET_CARRIER_KEY, this.carrier);
      return floatWindow;
    }
    const mainWindow: window.Window | null = await this.createTopmostMainWindow();
    if (mainWindow !== null) {
      this.carrier = 'main-topmost';
      AppStorage.setOrCreate<string>(PET_CARRIER_KEY, this.carrier);
      return mainWindow;
    }
    const subWindow: window.Window | null = await this.createSubWindow();
    this.carrier = subWindow === null ? 'none' : 'subwindow';
    AppStorage.setOrCreate<string>(PET_CARRIER_KEY, this.carrier);
    return subWindow;
  }

  /**
   * Second attempt: a main-type window pinned with `setWindowTopmost`.
   *
   * `WINDOW_TOPMOST` is a normal-level, system-granted permission, so a plain
   * build can hold it, unlike the float permission. `setWindowTopmost` refuses
   * subwindows ("only main windows are supported"), which is why this path
   * creates a `TYPE_MAIN` window instead of reusing the subwindow carrier.
   */
  private async createTopmostMainWindow(): Promise<window.Window | null> {
    let created: window.Window | null = null;
    try {
      created = await window.createWindow({
        name: PET_MAIN_WINDOW_NAME,
        windowType: window.WindowType.TYPE_MAIN,
        ctx: this.context,
        decorEnabled: false,
        title: PET_SUBWINDOW_TITLE,
      });
      await created.setWindowTopmost(true);
      await this.configureCreatedWindow(created, true);
      hilog.info(DOMAIN, PET_WINDOW_TAG,
        'pet main-type window created and pinned above other windows (WINDOW_TOPMOST)');
      return created;
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      if (businessError.code === 201) {
        hilog.warn(DOMAIN, PET_WINDOW_TAG,
          'pet main-type window unavailable: ohos.permission.WINDOW_TOPMOST is not granted '
          + 'or the window type is not allowed here');
      } else {
        this.logWindowError('createWindow(TYPE_MAIN)+setWindowTopmost', error);
      }
      // A half-configured window would stay on screen and cover the fallback.
      if (created !== null) {
        try {
          await created.destroyWindow();
        } catch (destroyError) {
          this.logWindowError('destroyWindow(after failed topmost)', destroyError);
        }
      }
      return null;
    }
  }

  /**
   * Try the always-on-top carrier.
   *
   * `TYPE_FLOAT` is the only window type HarmonyOS keeps above other
   * applications, and it is gated by the restricted
   * `ohos.permission.SYSTEM_FLOAT_WINDOW`. A normal build answers 201 here, which
   * is expected — the pet then falls back to a subwindow that other apps cover.
   */
  private async createFloatWindow(): Promise<window.Window | null> {
    try {
      const created: window.Window = await window.createWindow({
        name: PET_FLOAT_WINDOW_NAME,
        windowType: window.WindowType.TYPE_FLOAT,
        ctx: this.context,
        decorEnabled: false,
        title: PET_SUBWINDOW_TITLE,
      });
      // `Configuration` has no rectangle field, so a float window is placed
      // explicitly; a subwindow already takes `windowRect` at creation.
      await this.configureCreatedWindow(created, true);
      hilog.info(DOMAIN, PET_WINDOW_TAG,
        'pet float window created; it stays above other applications');
      return created;
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      if (businessError.code === 201) {
        hilog.warn(DOMAIN, PET_WINDOW_TAG,
          'pet float window unavailable: ohos.permission.SYSTEM_FLOAT_WINDOW is not granted; '
          + 'falling back to a subwindow, which other applications cover');
      } else {
        this.logWindowError('createWindow(TYPE_FLOAT)', error);
      }
      return null;
    }
  }

  private async createSubWindow(): Promise<window.Window | null> {
    const rect: window.Rect = this.initialRect();
    try {
      const created: window.Window =
        await this.windowStage.createSubWindowWithOptions(PET_SUBWINDOW_NAME, {
          title: PET_SUBWINDOW_TITLE,
          // The pet paints itself; a system title bar would frame it.
          decorEnabled: false,
          isModal: false,
          maximizeSupported: false,
          outlineEnabled: false,
          windowRect: rect,
        });
      await this.configureCreatedWindow(created, false);
      hilog.info(DOMAIN, PET_WINDOW_TAG,
        `pet subwindow created: rect=${rect.width}x${rect.height}@${rect.left},${rect.top}`);
      return created;
    } catch (error) {
      this.logWindowError('createSubWindowWithOptions', error);
      return null;
    }
  }

  /** Settings both carriers need; a float window additionally places itself. */
  private async configureCreatedWindow(created: window.Window, isFloat: boolean): Promise<void> {
    // Transparent before the first frame: the OS window paints white until this
    // is applied, and the page cannot cover it while it is still loading. A
    // window that is not in a normal state yet rejects the call, which is why
    // `show` applies it again after showing.
    this.hideChrome(created);
    try {
      // The reply composer needs focus; showing the window must not take it,
      // which `setWindowFocusable` alone does not change.
      await created.setWindowFocusable(true);
    } catch (error) {
      this.logWindowError('setWindowFocusable', error);
    }
    if (!isFloat) {
      return;
    }
    const rect: window.Rect = this.initialRect();
    try {
      await created.resizeAsync(rect.width, rect.height);
      await created.moveWindowTo(rect.left, rect.top);
      await created.setWindowShadowRadius(0);
    } catch (error) {
      this.logWindowError('place float window', error);
    }
  }

  /** Transparent, decoration-free. Both calls are synchronous. */
  private hideChrome(petWindow: window.Window): void {
    try {
      petWindow.setWindowBackgroundColor('#00000000');
    } catch (error) {
      this.logWindowError('setWindowBackgroundColor', error);
    }
    try {
      // `setWindowDecorHeight(0)` is not accepted here (error 401: the platform
      // only allows 37..112), and the window was created with `decorEnabled:
      // false`, so hiding visibility alone removes the title bar.
      petWindow.setWindowDecorVisible(false);
    } catch (error) {
      this.logWindowError('setWindowDecorVisible', error);
    }
  }

  /** Bottom-right corner of the display, in physical pixels. */
  private initialRect(): window.Rect {
    const screen: display.Display = display.getDefaultDisplaySync();
    const density: number = screen.densityPixels;
    const scale: number = density > 0 ? density : 1;
    const size: number = Math.max(1, Math.round(PET_WINDOW_INITIAL_SIZE * scale));
    const gap: number = Math.round(PET_WINDOW_EDGE_GAP * scale);
    const rect: window.Rect = {
      left: Math.max(0, screen.width - size - gap),
      top: Math.max(0, screen.height - size - gap),
      width: size,
      height: size,
    };
    return rect;
  }

  private logWindowError(action: string, error: Object): void {
    const businessError: BusinessError = error as BusinessError;
    hilog.warn(DOMAIN, PET_WINDOW_TAG,
      `${action} failed: code=${businessError.code} message=${businessError.message}`);
  }
}
