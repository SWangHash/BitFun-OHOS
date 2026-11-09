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
const WINDOW_HANDLE_KEY: string = 'bitfunPetWindow';
const DEFAULT_PAGE_PATH: string = 'index.html?bitfunWindow=agent-companion';

/**
 * Hosts the Agent companion pet in its own HarmonyOS window.
 *
 * The pet used to render as an overlay inside the main window, which clipped it
 * to the app bounds and hid it whenever the main window minimized. A separate
 * UIAbility gives it an independent desktop position and lifecycle: the main
 * window can minimize, and the pet window keeps its own place on screen.
 *
 * The window is created decoration-free and transparent, and the page inside it
 * (`pages/PetWindow`) hosts the same web-ui bundle the desktop pet window loads.
 * All window control stays here; the main ability only asks for show/hide
 * through the `pet_window_*` host functions.
 */
export default class AgentCompanionAbility extends UIAbility {
  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    const requested: string | undefined =
      (want.parameters?.[PAGE_PATH_KEY] as string | undefined);
    AppStorage.setOrCreate<string>(PAGE_PATH_KEY, requested ?? DEFAULT_PAGE_PATH);
    hilog.info(DOMAIN, PET_WINDOW_TAG,
      `pet ability created: page=${requested ?? DEFAULT_PAGE_PATH}`);
  }

  async onWindowStageCreate(windowStage: window.WindowStage): Promise<void> {
    let petWindow: window.Window | null = null;
    try {
      petWindow = windowStage.getMainWindowSync();
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      hilog.error(DOMAIN, PET_WINDOW_TAG,
        `pet window unavailable: code=${businessError.code} message=${businessError.message}`);
    }

    if (petWindow !== null) {
      await this.applyPetWindowProperties(petWindow);
      AppStorage.setOrCreate<window.Window>(WINDOW_HANDLE_KEY, petWindow);
    }

    try {
      await windowStage.loadContent('pages/PetWindow');
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      hilog.error(DOMAIN, PET_WINDOW_TAG,
        `pet page load failed: code=${businessError.code} message=${businessError.message}`);
    }
  }

  onWindowStageDestroy(): void {
    AppStorage.setOrCreate<window.Window | null>(WINDOW_HANDLE_KEY, null);
    hilog.info(DOMAIN, PET_WINDOW_TAG, 'pet window stage destroyed');
  }

  /**
   * Make the window behave like a desktop pet rather than an app window:
   * transparent, undecorated, small, parked in the bottom-right corner of the
   * display, and (when the platform allows it) above other windows.
   */
  private async applyPetWindowProperties(petWindow: window.Window): Promise<void> {
    const density: number = display.getDefaultDisplaySync().densityPixels;
    const scale: number = density > 0 ? density : 1;
    const size: number = Math.max(1, Math.round(PET_WINDOW_INITIAL_SIZE * scale));
    const gap: number = Math.round(PET_WINDOW_EDGE_GAP * scale);

    // Both of these are synchronous in the ArkUI window API, so there is nothing
    // to await; they only fail through a thrown BusinessError.
    try {
      petWindow.setWindowBackgroundColor('#00000000');
    } catch (error) {
      this.logWindowError('setWindowBackgroundColor', error);
    }
    try {
      petWindow.setWindowDecorVisible(false);
    } catch (error) {
      this.logWindowError('setWindowDecorVisible', error);
    }
    // The pet must be able to take focus for its reply composer, but showing it
    // must not pull focus away from whatever the user was editing, so the window
    // is focused explicitly by the page instead of on show.
    try {
      petWindow.setWindowFocusable(true);
    } catch (error) {
      this.logWindowError('setWindowFocusable', error);
    }

    // Cross-application stacking is a restricted platform capability: without it
    // the call rejects and the pet degrades to a normal window, so a failure is
    // logged instead of aborting the launch.
    try {
      await petWindow.setWindowTopmost(true);
    } catch (error) {
      this.logWindowError('setWindowTopmost', error);
    }

    try {
      const area: window.AvoidArea = petWindow.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
      const screen: display.Display = display.getDefaultDisplaySync();
      const right: number = Math.max(0, screen.width - size - gap - area.rightRect.width);
      const bottom: number = Math.max(0, screen.height - size - gap - area.bottomRect.height);
      await petWindow.resizeAsync(size, size);
      await petWindow.moveWindowTo(right, bottom);
      hilog.info(DOMAIN, PET_WINDOW_TAG,
        `pet window placed: size=${size} x=${right} y=${bottom} scale=${scale}`);
    } catch (error) {
      this.logWindowError('place pet window', error);
    }
  }

  private logWindowError(action: string, error: Object): void {
    const businessError: BusinessError = error as BusinessError;
    hilog.warn(DOMAIN, PET_WINDOW_TAG,
      `${action} failed: code=${businessError.code} message=${businessError.message}`);
  }
}
