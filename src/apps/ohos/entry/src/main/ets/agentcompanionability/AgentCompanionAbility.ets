import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { display, window } from '@kit.ArkUI';
import { BusinessError } from '@kit.BasicServicesKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { PET_WINDOW_TAG } from '../services/PetWindowChannel';

const DOMAIN: number = 0x0000;
/** Initial CSS pixel box; the pet page resizes it as bubbles appear. */
const PET_WINDOW_INITIAL_SIZE: number = 120;
const PET_WINDOW_EDGE_GAP: number = 16;
const PAGE_PATH_KEY: string = 'bitfunPetPagePath';
const DIST_ROOT_KEY: string = 'bitfunPetDistRoot';
const WINDOW_HANDLE_KEY: string = 'bitfunPetWindow';
const DEFAULT_PAGE_PATH: string = 'index.html?bitfunWindow=agent-companion';
/** How long to wait for the window to leave the maximized state. */
const FLOATING_TIMEOUT_MS: number = 2000;

/**
 * Hosts the Agent companion pet in its own HarmonyOS window.
 *
 * The pet used to render as an overlay inside the main window, which clipped it
 * to the app bounds and hid it whenever the main window minimized. A separate
 * UIAbility gives it an independent desktop position and lifecycle.
 *
 * Order matters here. An ability window can open maximized, and a maximized
 * window ignores geometry requests, so the window is put into the floating state
 * first. Chrome is hidden both before and after the geometry change because a
 * move/resize can re-apply the system decorations.
 */
export default class AgentCompanionAbility extends UIAbility {
  private petWindow: window.Window | null = null;

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const requested: Object | undefined = want.parameters?.[PAGE_PATH_KEY];
    const pagePath: string = typeof requested === 'string' ? requested as string : DEFAULT_PAGE_PATH;
    const distRootParam: Object | undefined = want.parameters?.[DIST_ROOT_KEY];
    const distRoot: string = typeof distRootParam === 'string' ? distRootParam as string : '';
    AppStorage.setOrCreate<string>(PAGE_PATH_KEY, pagePath);
    AppStorage.setOrCreate<string>(DIST_ROOT_KEY, distRoot);
    hilog.info(DOMAIN, PET_WINDOW_TAG,
      `pet ability created: page=${pagePath} distRoot=${distRoot.length > 0 ? distRoot : '(unset)'}`);
  }

  async onWindowStageCreate(windowStage: window.WindowStage): Promise<void> {
    try {
      this.petWindow = windowStage.getMainWindowSync();
    } catch (error) {
      this.logWindowError('getMainWindowSync', error);
    }

    if (this.petWindow !== null) {
      AppStorage.setOrCreate<window.Window>(WINDOW_HANDLE_KEY, this.petWindow);
      await this.preparePetWindow(this.petWindow);
    }

    try {
      await windowStage.loadContent('pages/PetWindow');
    } catch (error) {
      this.logWindowError('loadContent', error);
    }

    // The first frame can restore system chrome; hide it once the page exists.
    if (this.petWindow !== null) {
      this.hideWindowChrome(this.petWindow);
    }
  }

  onWindowStageDestroy(): void {
    AppStorage.setOrCreate<window.Window | null>(WINDOW_HANDLE_KEY, null);
    this.petWindow = null;
    hilog.info(DOMAIN, PET_WINDOW_TAG, 'pet window stage destroyed');
  }

  private async preparePetWindow(petWindow: window.Window): Promise<void> {
    this.hideWindowChrome(petWindow);
    // Geometry before stacking: `setWindowTopmost` on a not-yet-placed window is
    // fine, but the reverse order leaves the window painted at the wrong spot for
    // a frame.
    await this.ensureFloating(petWindow);
    this.placePetWindow(petWindow);
    // A move/resize can bring the title bar back.
    this.hideWindowChrome(petWindow);

    try {
      await petWindow.setWindowTopmost(true);
    } catch (error) {
      // Cross-application stacking needs the system-level
      // ohos.permission.WINDOW_TOPMOST; without it the pet stays a normal window.
      this.logWindowError('setWindowTopmost', error);
    }

    hilog.info(DOMAIN, PET_WINDOW_TAG,
      `pet window prepared: status=${petWindow.getWindowStatus()} decor=${petWindow.getWindowDecorVisible()}`);
  }

  /**
   * Make the window transparent and decoration-free.
   *
   * Both calls are synchronous; they only report failure by throwing.
   */
  private hideWindowChrome(petWindow: window.Window): void {
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

  /**
   * Leave the maximized state, because a maximized window ignores `resizeAsync`
   * and `moveWindowTo`. Mirrors the main window's `WindowHostService`.
   */
  private async ensureFloating(petWindow: window.Window): Promise<void> {
    if (petWindow.getWindowStatus() === window.WindowStatusType.MINIMIZE) {
      try {
        await petWindow.restore();
      } catch (error) {
        this.logWindowError('restore', error);
      }
    }
    if (petWindow.getWindowStatus() === window.WindowStatusType.FLOATING) {
      return;
    }
    try {
      await petWindow.recover();
    } catch (error) {
      this.logWindowError('recover', error);
    }
    if (petWindow.getWindowStatus() === window.WindowStatusType.FLOATING) {
      return;
    }
    await new Promise<void>((resolve) => {
      let settled: boolean = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        petWindow.off('windowStatusDidChange', listener);
        resolve();
      };
      const listener = (status: window.WindowStatusType): void => {
        if (status === window.WindowStatusType.FLOATING) {
          finish();
        }
      };
      petWindow.on('windowStatusDidChange', listener);
      setTimeout(finish, FLOATING_TIMEOUT_MS);
    });
    hilog.info(DOMAIN, PET_WINDOW_TAG,
      `pet window floating state: status=${petWindow.getWindowStatus()}`);
  }

  /** Park the window in the bottom-right corner of the display. */
  private placePetWindow(petWindow: window.Window): void {
    const density: number = display.getDefaultDisplaySync().densityPixels;
    const scale: number = density > 0 ? density : 1;
    const size: number = Math.max(1, Math.round(PET_WINDOW_INITIAL_SIZE * scale));
    const gap: number = Math.round(PET_WINDOW_EDGE_GAP * scale);
    const screen: display.Display = display.getDefaultDisplaySync();
    let right: number = Math.max(0, screen.width - size - gap);
    let bottom: number = Math.max(0, screen.height - size - gap);
    try {
      const area: window.AvoidArea = petWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      right = Math.max(0, screen.width - size - gap - area.rightRect.width);
      bottom = Math.max(0, screen.height - size - gap - area.bottomRect.height);
    } catch (error) {
      // Avoid areas are a refinement; the plain screen box is a fine fallback.
      this.logWindowError('getWindowAvoidArea', error);
    }
    petWindow.resizeAsync(size, size).then(() => {
      petWindow.moveWindowTo(right, bottom).then(() => {
        hilog.info(DOMAIN, PET_WINDOW_TAG,
          `pet window placed: size=${size} x=${right} y=${bottom} scale=${scale}`);
      }).catch((error: BusinessError) => this.logWindowError('moveWindowTo', error));
    }).catch((error: BusinessError) => this.logWindowError('resizeAsync', error));
  }

  private logWindowError(action: string, error: Object): void {
    const businessError: BusinessError = error as BusinessError;
    hilog.warn(DOMAIN, PET_WINDOW_TAG,
      `${action} failed: code=${businessError.code} message=${businessError.message}`);
  }
}
