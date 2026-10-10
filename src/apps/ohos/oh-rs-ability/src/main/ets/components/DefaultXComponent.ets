import { NodeContent } from "@kit.ArkUI";
import { hilog } from "@kit.PerformanceAnalysisKit";
import { ArkHelper, WebViewInitData as NativeWebViewInitData } from "../ability/type";
import { exit } from "../helper";
import { Loadable } from "../helper/loadable";
import {
  RustWebviewNodeController,
  WebviewStyle,
  WebviewInitData,
} from "../webview/DefaultWebview";

export const RouteName = "RustAbility";

const SPLASH_LOG_DOMAIN: number = 0x0000;
const SPLASH_LOG_TAG: string = "BitFunStartup";
// Intrinsic pixel size of the bundled start-window mark
// (resources/base/media/bitfun_start_window.png). The native start window
// draws startWindowIcon at its raw pixel size without density scaling, so the
// ArkUI mirror and the web-ui startup overlay must use the same px value to
// land pixel-identical on the handoff frame. `px` units (not vp) match that
// raw-pixel draw rule.
const START_WINDOW_ICON_PX: string = '240px';
// The entry `start_window_background` neutral constant
// (resources/{base,dark}/element/color.json). The launch surface is a single
// color in every mode so it never flips; the Web component's own background
// does not follow WebDarkMode.Auto, so it is seeded with the same constant to
// keep resize gaps and pre-paint frames in sync with the splash mirror instead
// of flashing the ArkWeb default white.
const SPLASH_BG: string = '#6A6A6A';

@Component
export struct DefaultXComponent {
  private rootSlot = new NodeContent();
  private webviewController = new RustWebviewNodeController(this.getUIContext());
  private nativeModule: ESObject;
  // Launch-page mirror appearance published by EntryAbility.onCreate. The
  // background is the neutral `start_window_background` constant, so the mirror
  // matches the system start window in every color mode. An empty icon keeps
  // the mirror layer inert for other consumers of this module.
  @StorageLink("bitfunStartupSplashIcon") splashIcon: ResourceStr = '';
  @StorageLink("bitfunStartupSplashBackground") splashBackground: ResourceColor = Color.Transparent;
  private helper: ArkHelper = {
    exit,
    createWebview: (data: NativeWebViewInitData) => {
      const initScripts: ScriptItem[] = (data?.initializationScripts || []).map((i) => {
        return {
          script: i,
          scriptRules: ["*"],
        } as ScriptItem;
      });
      // url set to empty string avoid double load.
      const init: WebviewInitData = {
        webTag: data?.id,
        url: data?.url,
        html: data?.html,
        headers: data?.headers,
        style: (data.style || {}) as WebviewStyle,
        javascriptEnable: data?.javascriptEnable ?? true,
        userAgent: data?.userAgent,
        devtools: data?.devtools,
        autoplay: data?.autoplay,
        initializationScripts: initScripts,
        onDragAndDrop: data?.onDragAndDrop,
        onDownloadStart: data?.onDownloadStart,
        onDownloadEnd: data?.onDownloadEnd,
        onNavigationRequest: data?.onNavigationRequest,
        onTitleChange: data?.onTitleChange,
      } as WebviewInitData;

      // transparent only be set when backgroundColor is null.
      if (data?.transparent && !init.style?.backgroundColor) {
        init.style!.backgroundColor = Color.Transparent;
      }
      // Seed the Web component's background with the neutral start-window
      // constant so resize gaps and pre-paint frames stay in sync with the
      // splash mirror instead of flashing the ArkWeb default white.
      if (!init.style?.backgroundColor) {
        init.style!.backgroundColor = SPLASH_BG;
      }
      const ret = this.webviewController.addWebview(init);

      ret.controller.setBackgroundColor = (color: string) => {
        init.style!.backgroundColor = color;
        const node = this.webviewController.getWebviewNode(ret.webTag);
        node?.update(init);
      };

      ret.controller.setVisible = (visible: boolean) => {
        init.style!.visible = visible ? "visible" : "hidden";
        const node = this.webviewController.getWebviewNode(ret.webTag);
        node?.update(init);
      };

      // Return controller and use controller to control webview behavior
      return ret.controller;
    },
  };
  @StorageProp("moduleName") name: string = "";
  @StorageProp("loadMode") loadMode: "async" | "sync" = "async";

  async aboutToAppear(): Promise<void> {
    // Diagnostics: the exact moment the mirror layer becomes visible.
    hilog.info(SPLASH_LOG_DOMAIN, SPLASH_LOG_TAG, 'splash mirror aboutToAppear');
    // Last-resort safety net: if the webview never reaches a first contentful
    // paint or a page-load end (navigation failure, blank page), release the
    // startup splash mirror so the app never gets stuck behind it. The normal
    // path hides the mirror via WebBuilder's FCP / console-token / onPageEnd
    // handlers, long before this timer fires.
    setTimeout(() => {
      hilog.info(SPLASH_LOG_DOMAIN, SPLASH_LOG_TAG, 'splash mirror released by aboutToAppear fallback');
      AppStorage.set<ResourceStr>("bitfunStartupSplashIcon", '');
    }, 5000);
    // Expose the controller so app-level services (e.g. BrowserWebviewService)
    // can call addWebview/removeWebview directly to create embedded child
    // webviews for the built-in browser scene, bypassing the ArkHelper path.
    AppStorage.setOrCreate<RustWebviewNodeController>("rustWebviewController", this.webviewController);
    const moduleName = `lib${this.name}.so`;
    this.nativeModule = await Loadable.load(moduleName, this.loadMode);
    this.nativeModule.render(this.helper, this.rootSlot);
  }

  build() {
    Stack() {
      ContentSlot(this.rootSlot)
      Row() {
        Column() {
          NodeContainer(this.webviewController)
            .height("100%")
            .width("100%")
        }.width("100%")
      }.height("100%")
      // Startup splash mirror: renders the same icon and background color as
      // the native start window (startWindowIcon / startWindowBackground,
      // seeded into AppStorage by EntryAbility.onCreate) while the webview
      // boots. DefaultXComponent is the page shown the moment the system start
      // window disappears, so this layer closes the blank gap until the Web
      // component presents its first frame (see WebBuilder's release handlers).
      // The native start window scales the icon by min(winW/iconW, winH/iconH)
      // and never upscales, centered on the window; with the square source icon
      // that is min(iconPx, winW, winH) physical pixels. Replicating it in px
      // units keeps the mirror pixel-identical on the takeover frame, so the
      // icon does not jump when the system start window goes away. syncLoad
      // keeps the mark in the very first presented frame.
      if (this.splashIcon !== '') {
        Stack() {
          Image(this.splashIcon)
            .objectFit(ImageFit.Contain)
            .interpolation(ImageInterpolation.Medium)
            .syncLoad(true)
            .width('100%')
            .height('100%')
            .constraintSize({
              minWidth: 0,
              minHeight: 0,
              maxWidth: START_WINDOW_ICON_PX,
              maxHeight: START_WINDOW_ICON_PX,
            })
        }
        .alignContent(Alignment.Center)
        .width("100%")
        .height("100%")
        .backgroundColor(this.splashBackground)
      }
    };
  }
}
