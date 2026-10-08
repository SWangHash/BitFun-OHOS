import { common } from '@kit.AbilityKit';
import { BusinessError, deviceInfo, emitter } from '@kit.BasicServicesKit';
import { image } from '@kit.ImageKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { statusBarManager } from '@kit.DeskTopExtensionKit';

const LOG_DOMAIN = 0x0000;
const LOG_TAG = 'BitFunStatusBar';

/**
 * Syscap of the Desktop Extension Kit status bar. Only 2in1 devices (laptops,
 * desktops, and tablets in PC mode) carry it, and the icon is rejected on every
 * other form factor. The syscap is therefore checked with `canIUse` instead of
 * being declared as required, which would block installation on phones and
 * tablets that have no status bar at all.
 */
const STATUS_BAR_SYSCAP = 'SystemCapability.PCService.StatusBarManager';

/** Module that owns the ability involved in a status bar click. */
const BITFUN_MODULE_NAME = 'entry';
/**
 * Ability the right-click menu items resolve against. `StatusBarMenuAction`
 * requires a real, resolvable `abilityName` even for `notifyOnly` items — the
 * system resolves it before applying `notifyOnly`. Leaving it empty made the
 * shell report "暂无打开方式" instead of delivering the `rightMenuClick` event.
 */
const BITFUN_MAIN_ABILITY = 'EntryAbility';
/**
 * Height (vp) declared for the `quickOperation`. `height` is a required field
 * with a "greater than 0" range, but no popup is rendered because the click is
 * routed to the `statusBarIconClick` event instead of a view ability.
 */
const QUICK_OPERATION_HEIGHT_VP = 40;

/** Right-click menu item identifiers, routed back through `rightMenuClick`. */
const MENU_CODE_SHOW_WINDOW = 'bitfun_show_window';
const MENU_CODE_TOGGLE_DESKTOP_PET = 'bitfun_toggle_desktop_pet';
/**
 * Leading marker on the "show desktop pet" item while the pet is enabled.
 * `StatusBarMenuItemOptions.selected` (the native check mark) is only available
 * from API 24, and this module compiles against API 21, so the checked state is
 * rendered as a title glyph instead.
 */
const MENU_CHECK_MARK = '\u2713';
/** How often the menu re-reads the pet state changed from other surfaces. */
const MENU_REFRESH_INTERVAL_MS = 30000;

/** Main-window/pet actions the status bar icon requests. */
export interface StatusBarTrayHost {
  /** Bring the main window to the front and focus it. */
  showMainWindow(): Promise<void>;
  /** Whether the Agent companion pet is currently enabled. */
  isDesktopPetEnabled(): boolean;
  /** Persist the Agent companion pet enabled state. */
  setDesktopPetEnabled(enabled: boolean): Promise<void>;
}

/**
 * Publishes the BitFun icon in the HarmonyOS status bar (the system tray on PC
 * form factors) and routes its interactions to `host`.
 *
 * The system owns the tray surface: the user cannot add or remove a
 * third-party icon from the quick-settings editor, so an application
 * advertises itself by calling `addToStatusBar` while it runs and
 * `removeFromStatusBar` when it stops. A left click raises the main window;
 * a right click opens a context menu that also shows or hides the Agent
 * companion pet, and closing the application withdraws the icon.
 */
export class StatusBarTrayService {
  private readonly context: common.UIAbilityContext;
  private readonly host: StatusBarTrayHost;
  private installed: boolean = false;
  private refreshTimerId: number = -1;

  constructor(context: common.UIAbilityContext, host: StatusBarTrayHost) {
    this.context = context;
    this.host = host;
  }

  /**
   * Publish the tray icon. Failures are logged and swallowed: a device without
   * the status bar syscap, or a system build that rejects the icon, must still
   * let BitFun launch normally.
   */
  install(): void {
    if (this.installed) {
      return;
    }
    if (!canIUse(STATUS_BAR_SYSCAP)) {
      hilog.info(
        LOG_DOMAIN,
        LOG_TAG,
        'status bar is unavailable on device type %{public}s; skipping the tray icon',
        deviceInfo.deviceType
      );
      return;
    }
    try {
      statusBarManager.addToStatusBar(this.context, this.buildItem());
      statusBarManager.on('statusBarIconClick', this.onIconClick);
      statusBarManager.on('rightMenuClick', this.onRightMenuClick);
      this.installed = true;
      // The pet state can also change from the settings UI, so re-read it
      // periodically instead of only after this menu's own toggle.
      this.refreshTimerId = setInterval(() => {
        this.updateMenu();
      }, MENU_REFRESH_INTERVAL_MS);
      hilog.info(LOG_DOMAIN, LOG_TAG, 'status bar icon registered');
    } catch (error) {
      const businessError = error as BusinessError;
      hilog.error(
        LOG_DOMAIN,
        LOG_TAG,
        'failed to register the status bar icon: code=%{public}s message=%{public}s',
        String(businessError.code),
        businessError.message
      );
    }
  }

  /**
   * Withdraw the tray icon when the ability is destroyed. The system refuses
   * removal while no window of the application is in the foreground, so a
   * rejection during shutdown is expected and only logged.
   */
  remove(): void {
    if (!this.installed) {
      return;
    }
    this.installed = false;
    if (this.refreshTimerId >= 0) {
      clearInterval(this.refreshTimerId);
      this.refreshTimerId = -1;
    }
    try {
      statusBarManager.off('statusBarIconClick', this.onIconClick);
      statusBarManager.off('rightMenuClick', this.onRightMenuClick);
    } catch (error) {
      const businessError = error as BusinessError;
      hilog.warn(
        LOG_DOMAIN,
        LOG_TAG,
        'failed to detach the status bar listener: %{public}s',
        businessError.message
      );
    }
    try {
      statusBarManager.removeFromStatusBar(this.context);
      hilog.info(LOG_DOMAIN, LOG_TAG, 'status bar icon removed');
    } catch (error) {
      const businessError = error as BusinessError;
      hilog.warn(
        LOG_DOMAIN,
        LOG_TAG,
        'failed to remove the status bar icon: code=%{public}s message=%{public}s',
        String(businessError.code),
        businessError.message
      );
    }
  }

  /** Icon plus the `quickOperation` the system requires before it inserts one. */
  private buildItem(): statusBarManager.StatusBarItem {
    const item: statusBarManager.StatusBarItem = {
      icons: {
        white: this.loadIcon($r('app.media.bitfun_status_bar_icon_white').id),
        black: this.loadIcon($r('app.media.bitfun_status_bar_icon_black').id),
      },
      quickOperation: {
        title: this.text($r('app.string.status_bar_title').id),
        height: QUICK_OPERATION_HEIGHT_VP,
        // An empty ability name tells the system to deliver the left click as a
        // `statusBarIconClick` event instead of opening a `statusBarView`
        // extension window. Naming an extension here made the system pop up
        // that empty window on every click (a visible flicker) and the window
        // then failed to foreground the already-running singleton main window.
        // The event path raises the real window directly and shows no popup.
        abilityName: '',
        moduleName: BITFUN_MODULE_NAME,
      },
      statusBarGroupMenu: this.buildGroupMenu(),
    };
    return item;
  }

  /**
   * Right-click group menu: "show BitFun" plus a pet item whose title carries a
   * check mark while the Agent companion pet is enabled. Both entries are
   * `notifyOnly` so clicks come back through `rightMenuClick` instead of
   * launching an ability.
   */
  private buildGroupMenu(): Array<statusBarManager.StatusBarGroupMenu> {
    const showItem: statusBarManager.StatusBarMenuItem = {
      title: this.text($r('app.string.status_bar_show_app').id),
      menuAction: this.notifyAction(MENU_CODE_SHOW_WINDOW),
    };
    const petLabel = this.text($r('app.string.status_bar_show_desktop_pet').id);
    const petItem: statusBarManager.StatusBarMenuItem = {
      title: this.host.isDesktopPetEnabled() ? `${MENU_CHECK_MARK} ${petLabel}` : petLabel,
      menuAction: this.notifyAction(MENU_CODE_TOGGLE_DESKTOP_PET),
    };
    const group: statusBarManager.StatusBarGroupMenu = [showItem, petItem];
    const groups: Array<statusBarManager.StatusBarGroupMenu> = [group];
    return groups;
  }

  /** A menu action that reports the click back as a `rightMenuClick` event. */
  private notifyAction(menuCode: string): statusBarManager.StatusBarMenuAction {
    const action: statusBarManager.StatusBarMenuAction = {
      abilityName: BITFUN_MAIN_ABILITY,
      moduleName: BITFUN_MODULE_NAME,
      notifyOnly: true,
      menuCode: menuCode,
    };
    return action;
  }

  /** Replace the right-click menu so the pet check mark reflects the live state. */
  private updateMenu(): void {
    if (!this.installed) {
      return;
    }
    try {
      statusBarManager.updateStatusBarMenu(this.context, this.buildGroupMenu());
    } catch (error) {
      const businessError = error as BusinessError;
      hilog.warn(
        LOG_DOMAIN,
        LOG_TAG,
        'failed to update the status bar menu: ' + businessError.message
      );
    }
  }

  /** Resolve a localized label from this module's string resources. */
  private text(resourceId: number): string {
    return this.context.resourceManager.getStringSync(resourceId);
  }

  /**
   * Decode a bundled monochrome mark into a `PixelMap`. The status bar rejects
   * oversized icons (error 1010710001), so the assets keep the small export
   * size produced by `scripts/generate-brand-assets.mjs`.
   */
  private loadIcon(resourceId: number): image.PixelMap {
    const bytes: Uint8Array = this.context.resourceManager.getMediaContentSync(resourceId);
    const source: image.ImageSource = image.createImageSource(bytes.buffer as ArrayBuffer);
    return source.createPixelMapSync();
  }

  /**
   * Left click of the status bar icon. `quickOperation.abilityName` is empty,
   * so the system routes every left click here; the handler raises and focuses
   * the main window without opening any intermediate window. It also refreshes
   * the right-click menu while it is cheap to do so.
   */
  private onIconClick = (event: emitter.EventData): void => {
    hilog.info(LOG_DOMAIN, LOG_TAG, 'status bar icon clicked; showing the main window');
    this.run(this.host.showMainWindow(), 'show');
    this.updateMenu();
  };

  /** Right-click menu item click, dispatched by the `menuCode` set on the item. */
  private onRightMenuClick = (event: emitter.EventData): void => {
    const data = event.data;
    if (!data) {
      return;
    }
    const menuCode = data['menuCode'] as string;
    if (!menuCode) {
      return;
    }
    if (menuCode === MENU_CODE_SHOW_WINDOW) {
      this.run(this.host.showMainWindow(), 'show');
    } else if (menuCode === MENU_CODE_TOGGLE_DESKTOP_PET) {
      this.run(this.toggleDesktopPet(), 'toggle_desktop_pet');
    }
  };

  /** Flip the Agent companion pet, then refresh the menu check mark. */
  private async toggleDesktopPet(): Promise<void> {
    const next = !this.host.isDesktopPetEnabled();
    await this.host.setDesktopPetEnabled(next);
    this.updateMenu();
  }

  /** Await a window action, logging instead of surfacing an unhandled rejection. */
  private run(action: Promise<void>, name: string): void {
    action.catch((error: BusinessError) => {
      hilog.error(
        LOG_DOMAIN,
        LOG_TAG,
        'status bar action %{public}s failed: %{public}s',
        name,
        error.message
      );
    });
  }
}