import { display, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { PET_WINDOW_TAG } from './PetWindowChannel';

const DOMAIN: number = 0x0000;
/**
 * Subwindow name. A subwindow is the only HarmonyOS carrier that is a real
 * top-level window without its own Dock/task entry: a second UIAbility gets its
 * own task, so hovering the Dock icon previews two windows.
 */
const PET_SUBWINDOW_NAME: string = 'agent-companion-pet';
const PET_SUBWINDOW_TITLE: string = 'BitFun Pet';
/** Initial CSS pixel box; the pet page resizes it as bubbles appear. */
const PET_WINDOW_INITIAL_SIZE: number = 120;
const PET_WINDOW_EDGE_GAP: number = 16;

const PAGE_PATH_KEY: string = 'bitfunPetPagePath';
const DIST_ROOT_KEY: string = 'bitfunPetDistRoot';
const WINDOW_HANDLE_KEY: string = 'bitfunPetWindow';
const DEFAULT_PAGE_PATH: string = 'index.html?bitfunWindow=agent-companion';

/**
 * Owns the Agent companion pet's subwindow.
 *
 * The pet needs its own desktop position and must be draggable outside the app
 * window, but it must not become a second application task: a subwindow belongs
 * to the main window (no Dock icon, no task entry, not in Alt+Tab) while still
 * being a real OS window that can sit anywhere on screen.
 *
 * The trade-off is lifecycle: HarmonyOS hides a subwindow with its parent, so
 * minimizing the main window hides the pet. That is the platform's rule for
 * this carrier, not something this service can opt out of.
 *
 * The page (`pages/PetWindow.ets`) receives the handle through AppStorage and
 * drives its own geometry/move loop; this service only creates, shows and
 * destroys the window.
 */
export class PetWindowService {
  private readonly windowStage: window.WindowStage;
  private petWindow: window.Window | null = null;

  constructor(windowStage: window.WindowStage) {
    this.windowStage = windowStage;
  }

  /** Show (or recreate) the pet window and load the pet page into it. */
  async show(pagePath: string, distRoot: string): Promise<void> {
    AppStorage.setOrCreate<string>(PAGE_PATH_KEY,
      pagePath.length > 0 ? pagePath : DEFAULT_PAGE_PATH);
    AppStorage.setOrCreate<string>(DIST_ROOT_KEY, distRoot);

    if (this.petWindow === null) {
      const created: window.Window | null = await this.createWindow();
      if (created === null) {
        return;
      }
      this.petWindow = created;
      AppStorage.setOrCreate<window.Window>(WINDOW_HANDLE_KEY, created);
      try {
        await created.loadContent('pages/PetWindow');
      } catch (error) {
        this.logWindowError('loadContent', error);
        return;
      }
    }

    const petWindow: window.Window = this.petWindow;
    try {
      await petWindow.showWindow();
      // Chrome changes are only accepted once the window is in a normal state;
      // doing this earlier returns error 1300002 ("window state abnormal") and
      // leaves the title bar visible.
      this.hideChrome(petWindow);
      hilog.info(DOMAIN, PET_WINDOW_TAG,
        `pet subwindow shown: decor=${petWindow.getWindowDecorVisible()}`);
    } catch (error) {
      this.logWindowError('showWindow', error);
    }
  }

  /** Destroy the pet window; the next `show` recreates it. */
  async hide(): Promise<void> {
    const petWindow: window.Window | null = this.petWindow;
    this.petWindow = null;
    AppStorage.setOrCreate<window.Window | null>(WINDOW_HANDLE_KEY, null);
    if (petWindow === null) {
      return;
    }
    try {
      await petWindow.destroyWindow();
      hilog.info(DOMAIN, PET_WINDOW_TAG, 'pet subwindow destroyed');
    } catch (error) {
      this.logWindowError('destroyWindow', error);
    }
  }

  /** Release the window when the ability goes away. */
  async dispose(): Promise<void> {
    await this.hide();
  }

  private async createWindow(): Promise<window.Window | null> {
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
      try {
        // The reply composer needs focus; showing the window must not take it,
        // which `setWindowFocusable` alone does not change.
        await created.setWindowFocusable(true);
      } catch (error) {
        this.logWindowError('setWindowFocusable', error);
      }
      try {
        // Cross-application stacking needs a system-level permission; without it
        // the pet stays above its own app only.
        await created.setWindowTopmost(true);
      } catch (error) {
        this.logWindowError('setWindowTopmost', error);
      }
      hilog.info(DOMAIN, PET_WINDOW_TAG,
        `pet subwindow created: rect=${rect.width}x${rect.height}@${rect.left},${rect.top}`);
      return created;
    } catch (error) {
      this.logWindowError('createSubWindowWithOptions', error);
      return null;
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
      petWindow.setWindowDecorVisible(false);
      petWindow.setWindowDecorHeight(0);
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
