import {
  AbilityConstant,
  common,
  Configuration,
  ConfigurationConstant,
  Want
} from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window, display } from '@kit.ArkUI';
import { RustAbility } from '@ohos-rs/ability';
import { CommonEventListener } from '../utils/CommonEventListener';
import { harmonyShare, systemShare } from '@kit.ShareKit';
import { fileIo, fileUri, Environment } from '@kit.CoreFileKit';
import { uniformTypeDescriptor } from '@kit.ArkData';
import { calendarManager } from '@kit.CalendarKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { buffer } from '@kit.ArkTS';
import { notificationManager } from '@kit.NotificationKit';
import RustModule from 'libbitfun_desktop_lib.so';
import { AppUpdater, UpdateCheckResult } from '../utils/AppUpdater';
import { CommonUtils } from '../utils/CommonUtils';
import { runDeveco } from '../utils/DevecoStart';
import { VoiceInputService } from '../services/VoiceInputService';
import { FeedbackCredentialStore } from '../utils/FeedbackCredentialStore';
import { ScreenCaptureStore } from '../utils/ScreenCaptureStore';
import { SecureCredentialStore } from '../utils/SecureCredentialStore';
import { WindowHostRequest, WindowHostService } from '../services/WindowHostService';
import {
  BrowserWebviewService,
  CreateRequest,
  EvalRequest,
  NavigateRequest,
  BoundsRequest,
  LabelRequest,
} from '../services/BrowserWebviewService';
import { FileShareRequest, FileShareService } from '../services/FileShareService';


const DOMAIN = 0x0000;

interface SetAlwaysOnTopArg {
  isTopmost: boolean;
}
interface SetDecorationsArg {
  visible: boolean;
}
interface SetSkipTaskbarArg {
  skip: boolean;
}
interface SetWindowSizeArg {
  width: number;
  height: number;
}
interface SetWindowPositionArg {
  x: number;
  y: number;
}
interface SetMinSizeArg {
  width: number;
  height: number;
}
interface SetResizableArg {
  resizable: boolean;
}
interface SaveFileToDownloadsArg {
  fileName: string;
  dataBase64: string;
}
interface SendNotificationArg {
  title: string;
  body: string | null;
}
interface PointResult {
  x: number;
  y: number;
}
interface SizeResult {
  width: number;
  height: number;
}
interface MonitorResult {
  width: number;
  height: number;
  scaleFactor: number;
  avoidArea: MonitorAvoidArea;
}

interface MonitorAvoidArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
interface HaitaiBrowserLaunchRequest {
  port?: number;
  initialUrl?: string | null;
}

export default class EntryAbility extends RustAbility {
  public moduleName: string = "bitfun_desktop_lib";
  public defaultPage: boolean = true;
  public commonEventListener: CommonEventListener | undefined = undefined;
  public remoteUrl: string = "";
  private appUpdater: AppUpdater = new AppUpdater();
  private voiceInputService: VoiceInputService = new VoiceInputService();
  public shareStatus: boolean = false;

  async onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): Promise<void> {
    super.onCreate(want, launchParam);
    this.commonEventListener = new CommonEventListener();
    // Cold-start best-effort report of the current system color mode so the
    // web-ui "follow system" selection resolves correctly without waiting for
    // the first system change. web-ui dedups when it equals the resolved theme.
    this.notifySystemColorMode();
  }

  onDestroy(): void {
    RustModule.ohosMarkCleanShutdown();
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  /**
   * HarmonyOS calls this when the system configuration changes, including the
   * light/dark color mode. We forward the new mode to the native module, which
   * emits an event the web-ui listens for to re-resolve "follow system" live —
   * the OHOS webview does not fire prefers-color-scheme change events on its own.
   */
  onConfigurationUpdate(newConfig: Configuration): void {
    const mode = this.colorModeToString(newConfig?.colorMode);
    if (mode.length > 0) {
      try {
        RustModule.notifySystemColorMode(mode);
        hilog.info(DOMAIN, 'vnext', 'onConfigurationUpdate: system color mode -> ' + mode);
      } catch (e) {
        hilog.warn(DOMAIN, 'vnext', 'notifySystemColorMode failed: ' + JSON.stringify(e));
      }
    }
  }

  /** Read the current Ability config color mode and push it to the web-ui. */
  private notifySystemColorMode(): void {
    const mode = this.readSystemColorMode();
    try {
      RustModule.notifySystemColorMode(mode);
    } catch (e) {
      hilog.warn(DOMAIN, 'vnext', 'notifySystemColorMode failed: ' + JSON.stringify(e));
    }
  }

  /** Map a ConfigurationConstant.ColorMode value to 'light' | 'dark' (empty if unset). */
  private colorModeToString(colorMode: number | undefined): string {
    if (colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT) {
      return 'light';
    }
    if (colorMode === ConfigurationConstant.ColorMode.COLOR_MODE_DARK) {
      return 'dark';
    }
    return '';
  }

  onWindowStageCreate(windowStage: window.WindowStage): Promise<void> {
    AppGlobal.calendarMgr = calendarManager.getCalendarManager(this.context);
    AppGlobal.mContext = this.context;
    const DOMAIN_NUMBER: number = 0xFF00;
    const TAG: string = '[BitfunUIAbilityComponents]';
    const feedbackCredentialStore = new FeedbackCredentialStore();
    const secureCredentialStore = new SecureCredentialStore();
    const screenCaptureStore = new ScreenCaptureStore(this.context);
    windowStage.on('windowStageClose', () => {
      RustModule.notifyMainWindowCloseRequested();
      return true;
    });
    const windowHostService = new WindowHostService(windowStage, () => {
      this.context.terminateSelf(() => {
        hilog.info(DOMAIN_NUMBER, TAG, 'WebDriver requested Ability termination');
      });
    });
    RustModule.registerArktsFunction('webdriver_window_ohos', async (
      _err: Error,
      arg: string,
    ): Promise<string> => {
      try {
        const request: WindowHostRequest = JSON.parse(arg) as WindowHostRequest;
        return await windowHostService.handle(request);
      } catch (error) {
        const businessError: BusinessError = error as BusinessError;
        return JSON.stringify({
          ok: false,
          error: businessError.message ?? 'Invalid WebDriver window request',
        });
      }
    });
    RustModule.registerArktsFunction('feedback_secure_credentials', async (
      _err: Error,
      arg: string
    ): Promise<string> => feedbackCredentialStore.handle(arg));
    // Unified key->bytes secure credential vault. Subscription auth and
    // MiniApp/appearance market services delegate to this single
    // AssetStoreKit-backed store; alias formats are consumer-specific and
    // do not collide inside the shared namespace. Feedback service still
    // uses the dedicated `feedback_secure_credentials` function below
    // until its multi-asset split logic migrates to the unified vault.
    RustModule.registerArktsFunction('secure_credentials', async (
      _err: Error,
      arg: string
    ): Promise<string> => secureCredentialStore.handle(arg));
    // OHOS screen-capture backend for the MiniApp "截取当前画面" feature
    // (and, eventually, the Computer Use screenshot subsystem). Delegates to
    // `screenshot.capture()` + `PixelMap.readPixels`; needs
    // `ohos.permission.CUSTOM_SCREEN_CAPTURE`. Failures degrade loudly as a
    // `{ status: 'error', code }` response.
    RustModule.registerArktsFunction('screen_capture', async (
      _err: Error,
      arg: string
    ): Promise<string> => screenCaptureStore.handle(arg));
    RustModule.registerArktsFunction('open_dialog_file', async (err: Error, arg: string): Promise<string> => {
      let res = await CommonUtils.open_file_dialog(arg);
      return res;
    });
    RustModule.registerArktsFunction('save_text_file_dialog', async (_err: Error, arg: string): Promise<string> => {
      return await CommonUtils.save_text_file_dialog(arg);
    });
    RustModule.registerArktsFunction('get_clipboard_files', async (err: Error, _arg: string): Promise<string> => {
      let res = await CommonUtils.read_clipboard_files();
      return res;
    });
    RustModule.registerArktsFunction('handle_min_window', async (err: Error, arg: string): Promise<string> => {
      windowStage.getMainWindowSync().minimize();
      return '';
    });
    RustModule.registerArktsFunction('handle_max_window', async (err: Error, arg: string): Promise<string> => {
      windowStage.getMainWindowSync().maximize();
      return '';
    });
    RustModule.registerArktsFunction('handle_restore_window', async (err: Error, arg: string): Promise<string> => {
      windowStage.getMainWindowSync().recover();
      return '';
    });
    RustModule.registerArktsFunction('window_is_maximized', async (err: Error, arg: string): Promise<string> => {
      let state = windowStage.getMainWindowSync().getWindowStatus();
      if (state == window.WindowStatusType.FULL_SCREEN || state == window.WindowStatusType.MAXIMIZE) {
        return 'true';
      } else {
        return 'false';
      }
    });
    RustModule.registerArktsFunction('check_app_update_ohos', async (err: Error, _arg: string): Promise<string> => {
      hilog.info(0x0000, 'vnext', 'check_app_update_ohos invoked');
      let result: UpdateCheckResult;
      try {
        result = await this.appUpdater.checkUpdateWithResult(this.context);
      } catch (error) {
        let message: string = (error && error.message) ? error.message : 'unexpected error';
        hilog.error(0x0000, 'vnext', 'check_app_update_ohos unexpected error: ' + JSON.stringify(error));
        return '{"updateAvailable":false,"error":' + JSON.stringify(message) + '}';
      }
      hilog.info(0x0000, 'vnext', 'check_app_update_ohos done: updateAvailable=' + result.updateAvailable
        + ', errorMessage=' + result.errorMessage);
      if (result.errorMessage.length > 0) {
        return '{"updateAvailable":' + (result.updateAvailable ? 'true' : 'false')
          + ',"error":' + JSON.stringify(result.errorMessage) + '}';
      }
      return '{"updateAvailable":' + (result.updateAvailable ? 'true' : 'false') + '}';
    });
    RustModule.registerArktsFunction('open_browser', async (err: Error, url: string): Promise<string> => {
      try {
        let want : Want = {
          "action": "ohos.want.action.viewData",
          "entities": ["entity.system.browsable"],
          "uri": url
        }
        if (/^https?:\/\//i.test(url)) {
          try {
            want.bundleName = 'com.haitai.htbrowser';
            want.moduleName = 'pc_entry';
            want.abilityName = 'EntryAbility';
            await this.context.startAbility(want);
            hilog.info(201, 'vnext', `open url succeed (haitai): ${url}`);
            return `start ability succeed with ${url}`;
          } catch (haitaiError) {
            hilog.info(201, 'vnext', `haitai browser unavailable, falling back to system browser: ${haitaiError.code}`);
            want = {
              "action": "ohos.want.action.viewData",
              "entities": ["entity.system.browsable"],
              "uri": url
            };
          }
        }
        await this.context.startAbility(want);
        hilog.info(201, 'vnext', `open url succeed: ${url}`);
        return `start ability succeed with ${url}`;
      } catch (error) {
        hilog.info(201, 'vnext', `fail to open ${url} ${error.code}`);
        return `fail to open ${url} ${error.code}`;
      }
    });
    RustModule.registerArktsFunction('launch_haitai_browser_cdp', async (err: Error, arg: string): Promise<string> => {
      try {
        const request = JSON.parse(arg) as HaitaiBrowserLaunchRequest;
        const port = request.port ?? 9222;
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return JSON.stringify({ ok: false, error: 'invalid Haitai CDP port' });
        }
        const cmdArgs = `--remote-debugging-port=${port} --remote-debugging=true --remote-allow-origins=http://localhost:${port}`;
        const want: Want = {
          bundleName: 'com.haitai.htbrowser',
          moduleName: 'pc_entry',
          abilityName: 'EntryAbility',
          parameters: { cmdArgs: cmdArgs },
        };
        const initialUrl = request.initialUrl?.trim() ?? '';
        if (initialUrl.length > 0) {
          if (!/^https?:\/\//i.test(initialUrl)) {
            return JSON.stringify({ ok: false, error: 'Haitai initialUrl must use http or https' });
          }
          want.action = 'ohos.want.action.viewData';
          want.entities = ['entity.system.browsable'];
          want.uri = initialUrl;
        }
        await this.context.startAbility(want);
        hilog.info(201, 'vnext', `launched Haitai CDP provider port=${port} url=${initialUrl}`);
        return JSON.stringify({ ok: true });
      } catch (error) {
        const detail = error as BusinessError;
        hilog.error(201, 'vnext', `failed to launch Haitai CDP provider: ${detail.message}`);
        return JSON.stringify({ ok: false, error: detail.message ?? String(error) });
      }
    });
    RustModule.registerArktsFunction('window_is_minimized', async (err: Error, arg: string): Promise<string> => {
      let state = windowStage.getMainWindowSync().getWindowStatus();
      if (state == window.WindowStatusType.MINIMIZE) {
        return 'true';
      } else {
        return 'false';
      }
    });
    RustModule.registerArktsFunction('close_window', async (err: Error, arg: string): Promise<string> => {
      this.context.terminateSelf(() => {
        hilog.info(DOMAIN_NUMBER, TAG, 'terminateSelf success');
      });
      return '';
    });
    RustModule.registerArktsFunction('quit_app_ohos', async (_err: Error, _arg: string): Promise<string> => {
      this.context.terminateSelf(() => {
        hilog.info(DOMAIN_NUMBER, TAG, 'Quit requested from window close behavior');
      });
      return '';
    });
    RustModule.registerArktsFunction('minimize_to_tray_ohos', async (_err: Error, _arg: string): Promise<string> => {
      // HarmonyOS PC keeps minimized applications in the system dock. This is
      // the platform equivalent of the desktop system-tray close behavior.
      await windowStage.getMainWindowSync().minimize();
      return '';
    });
    RustModule.registerArktsFunction('window_start_dragging', async (err: Error, arg: string): Promise<string> => {
      windowStage.getMainWindowSync().startMoving();
      return '';
    });
    RustModule.registerArktsFunction('set_always_on_top_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: SetAlwaysOnTopArg = JSON.parse(arg);
      const mainWin = windowStage.getMainWindowSync();
      try {
        await mainWin.setWindowTopmost(req.isTopmost);
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `setWindowTopmost failed (code=${be.code}), falling back to showWindow: ${be.message}`);
        try {
          await mainWin.showWindow();
        } catch (e2) {
          const be2 = e2 as BusinessError;
          hilog.warn(DOMAIN, TAG, `showWindow fallback failed: ${be2.message}`);
        }
      }
      return '';
    });
    RustModule.registerArktsFunction('set_decorations_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: SetDecorationsArg = JSON.parse(arg);
      const mainWin = windowStage.getMainWindowSync();
      try {
        // Showing native title buttons makes HarmonyOS fall back to hover-only
        // window decorations. Re-apply the same custom title-bar configuration
        // used at startup after restoring the buttons.
        await mainWin.setWindowTitleButtonVisible(
          req.visible,
          req.visible,
          req.visible,
        );
        if (req.visible) {
          mainWin.setWindowDecorHeight(44);
          mainWin.setWindowTitleMoveEnabled(false);
          mainWin.setWindowDecorVisible(false);
        }
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `setWindowTitleButtonVisible failed: ${be.message}`);
      }
      return '';
    });
    RustModule.registerArktsFunction('set_skip_taskbar_ohos', async (err: Error, arg: string): Promise<string> => {
      return '';
    });
    RustModule.registerArktsFunction('set_window_size_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: SetWindowSizeArg = JSON.parse(arg);
      try {
        await windowStage.getMainWindowSync().resize(req.width, req.height);
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `resize failed: ${be.message}`);
      }
      return '';
    });
    RustModule.registerArktsFunction('set_window_position_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: SetWindowPositionArg = JSON.parse(arg);
      try {
        await windowStage.getMainWindowSync().moveWindowTo(req.x, req.y);
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `moveWindowTo failed: ${be.message}`);
      }
      return '';
    });
    RustModule.registerArktsFunction('outer_position_ohos', async (err: Error, arg: string): Promise<string> => {
      const rect = windowStage.getMainWindowSync().getWindowProperties().windowRect;
      const result: PointResult = { x: rect.left, y: rect.top };
      return JSON.stringify(result);
    });
    RustModule.registerArktsFunction('outer_size_ohos', async (err: Error, arg: string): Promise<string> => {
      const rect = windowStage.getMainWindowSync().getWindowProperties().windowRect;
      const result: SizeResult = { width: rect.width, height: rect.height };
      return JSON.stringify(result);
    });
    RustModule.registerArktsFunction('inner_size_ohos', async (err: Error, arg: string): Promise<string> => {
      const rect = windowStage.getMainWindowSync().getWindowProperties().windowRect;
      const result: SizeResult = { width: rect.width, height: rect.height };
      return JSON.stringify(result);
    });
    RustModule.registerArktsFunction('current_monitor_ohos', async (err: Error, arg: string): Promise<string> => {
      let dispWidth: number = 0;
      let dispHeight: number = 0;
      let scale: number = 1;
      let avoidTop: number = 0;
      let avoidBottom: number = 0;
      let avoidLeft: number = 0;
      let avoidRight: number = 0;
      try {
        const disp = display.getDefaultDisplaySync();
        dispWidth = disp.width;
        dispHeight = disp.height;
        scale = disp.densityPixels > 0 ? disp.densityPixels : 1;
        // A floating window may not intersect the system bar when this query
        // runs, in which case getWindowAvoidArea() reports zero. The display's
        // available bounds still exclude the desktop bar, so keep that
        // right/bottom reservation as a monitor-level fallback.
        if (disp.availableWidth > 0 && disp.availableWidth <= disp.width) {
          avoidRight = Math.max(avoidRight, disp.width - disp.availableWidth);
        }
        if (disp.availableHeight > 0 && disp.availableHeight <= disp.height) {
          avoidBottom = Math.max(avoidBottom, disp.height - disp.availableHeight);
        }
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `getDefaultDisplaySync failed: ${be.message}`);
      }
      try {
        const avoidArea = windowStage.getMainWindowSync()
          .getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM);
        avoidTop = Math.max(avoidTop, avoidArea.topRect.height);
        avoidBottom = Math.max(avoidBottom, avoidArea.bottomRect.height);
        avoidLeft = Math.max(avoidLeft, avoidArea.leftRect.width);
        avoidRight = Math.max(avoidRight, avoidArea.rightRect.width);
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `getWindowAvoidArea failed: ${be.message}`);
      }
      const avoid: MonitorAvoidArea = {
        top: avoidTop,
        bottom: avoidBottom,
        left: avoidLeft,
        right: avoidRight,
      };
      const result: MonitorResult = {
        width: dispWidth,
        height: dispHeight,
        scaleFactor: scale,
        avoidArea: avoid,
      };
      return JSON.stringify(result);
    });
    RustModule.registerArktsFunction('unmaximize_ohos', async (err: Error, arg: string): Promise<string> => {
      try {
        await windowStage.getMainWindowSync().recover();
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `recover failed: ${be.message}`);
      }
      return '';
    });
    RustModule.registerArktsFunction('set_min_size_ohos', async (err: Error, arg: string): Promise<string> => {
      return '';
    });
    RustModule.registerArktsFunction('set_focus_ohos', async (err: Error, arg: string): Promise<string> => {
      try {
        await windowStage.getMainWindowSync().showWindow();
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `showWindow failed: ${be.message}`);
      }
      return '';
    });
    RustModule.registerArktsFunction('set_resizable_ohos', async (err: Error, arg: string): Promise<string> => {
      return '';
    });
    RustModule.registerArktsFunction('maximize_ohos', async (err: Error, arg: string): Promise<string> => {
      try {
        await windowStage.getMainWindowSync().maximize(window.MaximizePresentation.EXIT_IMMERSIVE);
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `maximize failed: ${be.message}`);
      }
      return '';
    });
    RustModule.registerArktsFunction('center_ohos', async (err: Error, arg: string): Promise<string> => {
      try {
        const mainWin = windowStage.getMainWindowSync();
        const rect = mainWin.getWindowProperties().windowRect;
        const disp = display.getDefaultDisplaySync();
        const x: number = Math.max(0, Math.floor((disp.width - rect.width) / 2));
        const y: number = Math.max(0, Math.floor((disp.height - rect.height) / 2));
        await mainWin.moveWindowTo(x, y);
      } catch (e) {
        const be = e as BusinessError;
        hilog.warn(DOMAIN, TAG, `center failed: ${be.message}`);
      }
      return '';
    });
    RustModule.registerArktsFunction('call_calendar', async (err: Error, arg: string): Promise<string> => {
      return await createMeetingEvent(arg);
    });
    RustModule.registerArktsFunction('call_harmony_build', async (err: Error, arg: string): Promise<string> => {
      hilog.info(DOMAIN_NUMBER, TAG, 'register harmony build callback ' + arg);
      runDeveco(this.context, arg);
      return '';
    });
    RustModule.registerArktsFunction('send_remote_url', async (err: Error, arg: string): Promise<string> => {
      hilog.info(DOMAIN_NUMBER, TAG, 'get remote url ' + arg);
      this.remoteUrl = arg;
      if (this.remoteUrl.length == 0) {
        this.shareDisablingListening();
      }
      else {
        this.shareListening();
      }
      return '';
    });
    RustModule.registerArktsFunction('send_remote_dialog_status', async (err: Error, arg: string): Promise<string> => {
          hilog.info(DOMAIN_NUMBER, TAG, 'get remote dialog status ' + arg);
          if (arg.length == 0) {
            this.shareDisablingListening();
          }
          else {
            this.shareListening();
          }
          return '';
    });
    RustModule.registerArktsFunction('harmony_create', async (err: Error, arg: string): Promise<string> => {
      await fileIo.copyDir('/storage/Users/currentUser/Documents/DevecoStudioProjects/MyApplication',
        '/storage/Users/currentUser/Documents/files', 1).then(() => {
        hilog.info(0x0000, 'vnext', 'copyDir success');
      }).catch((err: BusinessError) => {
        hilog.info(0x0000, 'vnext', 'copyFile error: ' + JSON.stringify(err));
      });
      await fileIo.rename('/storage/Users/currentUser/Documents/files',
        `/storage/Users/currentUser/Documents/DevecoStudioProjects/${arg.length == 0 ? 'MyApplication' : arg}`)
        .then(() => {
          hilog.info(0x0000, 'vnext', 'rename success');
        }).catch((err: BusinessError) => {
          hilog.info(0x0000, 'vnext', 'rename error: ' + JSON.stringify(err));
        });
      return '';
    });
    // Embedded browser webview bridge: each ArkTS callback parses a JSON-string
    // request from the Rust side (browser_api.rs OHOS branches) and delegates to
    // BrowserWebviewService, returning a JSON-string envelope. The service owns
    // a Map<label, BrowserWebviewEntry> and the RustWebviewNodeController
    // exposed via AppStorage by the vendored DefaultXComponent.
    const browserService = BrowserWebviewService.getInstance();
    RustModule.registerArktsFunction('browser_webview_create_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: CreateRequest = JSON.parse(arg);
      return await browserService.create(req);
    });
    RustModule.registerArktsFunction('browser_webview_eval_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: EvalRequest = JSON.parse(arg);
      return await browserService.eval(req);
    });
    RustModule.registerArktsFunction('browser_webview_navigate_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: NavigateRequest = JSON.parse(arg);
      return await browserService.navigate(req);
    });
    RustModule.registerArktsFunction('browser_webview_reload_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: LabelRequest = JSON.parse(arg);
      return await browserService.reload(req);
    });
    RustModule.registerArktsFunction('browser_webview_set_bounds_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: BoundsRequest = JSON.parse(arg);
      return await browserService.setBounds(req);
    });
    RustModule.registerArktsFunction('browser_webview_show_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: LabelRequest = JSON.parse(arg);
      return await browserService.show(req);
    });
    RustModule.registerArktsFunction('browser_webview_hide_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: LabelRequest = JSON.parse(arg);
      return await browserService.hide(req);
    });
    RustModule.registerArktsFunction('browser_webview_close_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: LabelRequest = JSON.parse(arg);
      return await browserService.close(req);
    });
    RustModule.registerArktsFunction('browser_webview_set_focus_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: LabelRequest = JSON.parse(arg);
      return await browserService.setFocus(req);
    });
    RustModule.registerArktsFunction('browser_webview_get_url_ohos', async (err: Error, arg: string): Promise<string> => {
      const req: LabelRequest = JSON.parse(arg);
      return await browserService.getUrl(req);
    });
    setTimeout(() => {
      windowStage.getMainWindow((err, data) => {
        data.setWindowDecorHeight(38);
        data.setWindowTitleMoveEnabled(false);
        data.setWindowDecorVisible(false);
      })
    }, 40)
    RustModule.registerArktsFunction('reveal_in_explorer', async (err: Error, arg: string): Promise<string> => {
      const context = getContext(this) as common.UIAbilityContext;
      let uri: string;
      if (arg.startsWith('file://')) {
        uri = arg;
      } else if (arg.startsWith('/data/storage/')) {
        uri = fileUri.getUriFromPath(arg);
      } else {
        uri = 'file://docs' + arg.split('/').map((part: string) => encodeURIComponent(part)).join('/');
      }
      const want: Want = {
        bundleName: 'com.huawei.hmos.filemanager',
        abilityName: 'MainAbility',
        parameters: {
          fileUri: uri
        }
      };
      try {
        await context.startAbility(want)
      } catch (err) {
        hilog.error(201, 'vnext', `reveal in explorer failed ${JSON.stringify(err)}`)
      }
      return '';
    });
    // Save a binary blob (base64) to <Download>/BitFun/<fileName> and return
    // the path. Mirrors the desktop `downloadDir` + `writeFile` save so the
    // web-ui can show the path and reveal it. `READ_WRITE_DOWNLOAD_DIRECTORY`
    // is declared in module.json5. Download dir via `Environment.getUserDownloadDir()`
    // (Core_File_Kit, 2-in-1/PC); base64 decode via `buffer.from` (ArkTS base lib).
    RustModule.registerArktsFunction('save_file_to_downloads_ohos', async (err: Error, arg: string): Promise<string> => {
      const params: SaveFileToDownloadsArg = JSON.parse(arg);
      const downloadDir = Environment.getUserDownloadDir();
      const bitfunDir = `${downloadDir}/BitFun`;
      if (!fileIo.accessSync(bitfunDir, fileIo.AccessModeType.EXIST)) {
        await fileIo.mkdir(bitfunDir);
      }
      const targetPath = `${bitfunDir}/${params.fileName}`;
      const file = fileIo.openSync(targetPath, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      const dataBuffer = buffer.from(params.dataBase64, 'base64');
      fileIo.writeSync(file.fd, dataBuffer.buffer);
      fileIo.closeSync(file);
      return targetPath;
    });
    // Send an OS-level notification (HarmonyOS Notification Kit) when a dialog
    // turn completes in the background, mirroring the desktop
    // send_system_notification. `requestEnableNotification()` prompts the user
    // once (idempotent afterwards); `publish` shows the notification.
    RustModule.registerArktsFunction('send_system_notification_ohos', async (err: Error, arg: string): Promise<string> => {
      const params: SendNotificationArg = JSON.parse(arg);
      try {
        await notificationManager.requestEnableNotification();
      } catch (e) {
        // user denied or unavailable; publish will no-op below
      }
      const request: notificationManager.NotificationRequest = {
        id: Date.now() % 2147483647,
        content: {
          contentType: notificationManager.ContentType.NOTIFICATION_CONTENT_BASIC_TEXT as number,
          normal: {
            title: params.title,
            text: params.body ?? '',
          },
        },
      };
      await notificationManager.publish(request);
      return '';
    });
    RustModule.registerArktsFunction('set_theme_mode', async (err: Error, arg: string): Promise<string> => {
      // arg is the color mode the webview should adopt: 'light' | 'dark' | 'system'.
      // - 'light'/'dark' pin the native override so the webview matches a fixed theme.
      // - 'system' releases the override (COLOR_MODE_NOT_SET) and returns the real
      //   system color mode ('light' | 'dark') so the web-ui can resolve a concrete
      //   theme without relying on `prefers-color-scheme`, which the OHOS webview does
      //   not update live (the web-ui also polls this return value to follow system).
      // Fixed themes return '' — the web-ui already knows the resolved theme id.
      const appContext = this.context.getApplicationContext();
      if (arg === 'light') {
        appContext.setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT);
        return '';
      }
      if (arg === 'dark') {
        appContext.setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
        return '';
      }
      appContext.setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
      return this.readSystemColorMode();
    });
    this.voiceInputService.setContext(this.context);
    // FileShareService needs the UIAbilityContext to call
    // `systemShare.ShareController.show()` on the discover path. Set once at
    // window-stage creation; the same singleton stays valid for the ability
    // lifetime. The knock path does not need the context (it arms a pending
    // file consumed by the knockShare listener), but set it unconditionally
    // so a later discover call after a knock does not race on missing state.
    FileShareService.getInstance().setContext(this.context);
    RustModule.registerArktsFunction('ohos_speech_start', async (err: Error, arg: string): Promise<string> => {
      try {
        return await this.voiceInputService.start(arg);
      } catch (e) {
        const detail: string = describeError(e);
        hilog.error(0x0000, 'BitFunVoiceInput', 'ohos_speech_start callback error: %{public}s', detail);
        return JSON.stringify({ '__error': detail });
      }
    });
    RustModule.registerArktsFunction('ohos_speech_append', async (err: Error, arg: string): Promise<string> => {
      return await this.voiceInputService.append(arg);
    });
    RustModule.registerArktsFunction('ohos_speech_finish', async (err: Error, arg: string): Promise<string> => {
      return await this.voiceInputService.finish(arg);
    });
    RustModule.registerArktsFunction('ohos_speech_cancel', async (err: Error, _arg: string): Promise<string> => {
      return await this.voiceInputService.cancel('');
    });
    // Share a BitFun-generated/exported file with a nearby HarmonyOS device
    // through the system Share Kit. `arg` is a JSON `FileShareRequest`
    // (`{ path, mode: 'knock' | 'discover', title?, description? }`); the
    // service returns a JSON `FileShareResult` envelope (`{ ok, error?,
    // status? }`). `knock` arms a pending file consumed by the knockShare
    // listener below; `discover` opens the system share panel and resolves on
    // dismiss. Mirrors `save_file_to_downloads_ohos` routing: single-string
    // arg, single-string JSON return. Non-OHOS hosts return `unsupported`.
    RustModule.registerArktsFunction('share_file_ohos', async (err: Error, arg: string): Promise<string> => {
      const fileShare = FileShareService.getInstance();
      let req: FileShareRequest;
      try {
        req = JSON.parse(arg) as FileShareRequest;
      } catch (error) {
        const be = error as BusinessError;
        hilog.error(DOMAIN_NUMBER, TAG, 'share_file_ohos invalid json: ' + be.message);
        return JSON.stringify({ ok: false, error: 'invalid_request: ' + be.message });
      }
      const result: string = await fileShare.handle(req);
      // Refresh knockShare listener state to match the new pending-or-remote
      // posture: a knock arms a pending file, so the listener must be on even
      // when remoteUrl is empty; remoteUrl-only callers keep their existing
      // gating through send_remote_url / send_remote_dialog_status.
      if (req.mode === 'knock') {
        this.shareListening();
      }
      return result;
    });
    return super.onWindowStageCreate(windowStage);
  }

  /**
   * Resolve the current system color mode as a plain 'light' | 'dark' string.
   * Reads the Ability config's colorMode; falls back to dark (the app's default
   * appearance) when the config is unavailable or unset. Called right after
   * releasing the native color override so the web-ui can resolve a concrete
   * theme without depending on `prefers-color-scheme` (which the OHOS webview
   * does not emit).
   */
  private readSystemColorMode(): string {
    try {
      const mode = this.colorModeToString(this.context?.config?.colorMode);
      if (mode.length > 0) {
        return mode;
      }
    } catch (e) {
      hilog.warn(DOMAIN, 'vnext', 'readSystemColorMode failed: ' + JSON.stringify(e));
    }
    return 'dark';
  }

  private shareListening() {
    hilog.info(0x0000, 'vnext', 'shareListening');
    // Activate the knockShare listener when either a remote URL is armed by
    // `send_remote_url` / `send_remote_dialog_status`, OR a knock file is
    // armed by `share_file_ohos` (mode='knock'). The listener callback below
    // prefers the pending file; without that gating, a knock that arrived
    // before any URL was armed would be silently dropped.
    const fileShare = FileShareService.getInstance();
    const hasPayload = this.remoteUrl.length != 0 || fileShare.hasPendingFile();
    if (hasPayload && !this.shareStatus) {
      harmonyShare.on('knockShare', this.sendOnlyCallback);
      this.shareStatus = true;
    }
  }
  private shareDisablingListening() {
    harmonyShare.off('knockShare', this.sendOnlyCallback);
    this.shareStatus = false;
  }
  private sendOnlyCallback = (sharableTable: harmonyShare.SharableTarget) => {
    // Prefer a knock-armed file (set by `share_file_ohos` with mode='knock')
    // over the remote URL. Falling back to the URL preserves the existing
    // HYPERLINK share behavior added by `send_remote_url`; if neither is
    // armed the knock is a no-op so the device state stays clean.
    const fileShare = FileShareService.getInstance();
    const pending = fileShare.takePendingFile();
    if (pending !== null) {
      try {
        sharableTable.share(fileShare.buildSharedData(pending));
      } catch (e) {
        const be = e as BusinessError;
        hilog.error(DOMAIN, 'vnext', `knock share(file) failed: code=${be.code}, msg=${be.message}`);
      }
      return;
    }
    if (this.remoteUrl.length != 0) {
      let content = this.remoteUrl;
      let shareData: systemShare.SharedData = new systemShare.SharedData({
        utd: uniformTypeDescriptor.UniformDataType.HYPERLINK,
        content,
        title: "BitFun",
        description: "Phone",
      });
      sharableTable.share(shareData)
    } else {
      hilog.error(DOMAIN, 'vnext', 'sendOnlyCallback error: no pending file or remote url');
    }
  }
}

interface AppGlobalType {
  calendarMgr: calendarManager.CalendarManager | null,
  mContext: common.UIAbilityContext | null
}

export const AppGlobal: AppGlobalType = {
  calendarMgr: null,
  mContext: null
}

function describeError(e: Object): string {
  if (e instanceof Error) {
    return `Error: ${e.message}`;
  }
  try {
    return `json: ${JSON.stringify(e)}`;
  } catch (_jsonErr) {
    return `str: ${e}`;
  }
}

export async function createMeetingEvent(input: string): Promise<string> {
  interface CalendarInfo {
    title: string,
    description: string,
    startTime: string,
    endTime: string
  }

  const info: CalendarInfo = JSON.parse(input)
  const calendarAccount: calendarManager.CalendarAccount = {
    name: info.title,
    type: calendarManager.CalendarType.LOCAL,
    displayName: 'bitfun',
  };
  const startTime = new Date(info.startTime).valueOf();

  const time = info.endTime == '' ? startTime : info.endTime;
  const endTime = new Date(time).valueOf();

  const event: calendarManager.Event = {
    type: calendarManager.EventType.NORMAL,
    title: info.title,
    startTime: startTime,
    endTime: endTime,
    isAllDay: false,
    description: info.description
  };

  try {
    let data: calendarManager.Calendar | undefined = await AppGlobal.calendarMgr?.createCalendar(calendarAccount);
    if (!data || data === null) {
      hilog.warn(0x0000, 'vnext', 'Failed to create calendar, data is null');
      return ""
    }
    let id = await data.addEvent(event);
    return "succeed in creating calendar and event " + id;
  } catch (error) {
    return "Failed to create calendar or event. Code: " + error;
  }
}
