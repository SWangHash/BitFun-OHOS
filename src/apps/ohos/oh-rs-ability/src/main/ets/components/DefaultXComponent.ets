import { NodeContent } from "@kit.ArkUI";
import { ArkHelper, WebViewInitData as NativeWebViewInitData } from "../ability/type";
import { exit } from "../helper";
import { Loadable } from "../helper/loadable";
import {
  RustWebviewNodeController,
  WebviewStyle,
  WebviewInitData,
} from "../webview/DefaultWebview";

export const RouteName = "RustAbility";
@Component
export struct DefaultXComponent {
  private rootSlot = new NodeContent();
  private webviewController = new RustWebviewNodeController(this.getUIContext());
  private nativeModule: ESObject;
  @StorageLink("bitfunStartupSplashIcon") splashIcon: ResourceStr = '';
  // Start window background resource published by EntryAbility.onCreate.
  // start_window_background is pinned to #000000 in both base/ and dark/, so
  // resolving it here always matches the system start window no matter which
  // color mode this component renders under (an application-level colorMode
  // override cannot diverge from the AbilityMgr-drawn start window).
  @StorageLink("bitfunStartupSplashBackground") splashBackground: ResourceColor = Color.Transparent;
  // Resolved system color mode published by EntryAbility ('light' | 'dark').
  // With WebDarkMode.Auto the page's prefers-color-scheme follows the system,
  // but the Web component's own backgroundColor attribute stays at its default
  // white unless the app syncs it — the documented Auto-mode pitfall for
  // flashes of light background on dark systems.
  @StorageProp('bitfunSystemColorMode') @Watch('onSystemColorModeChange')
  systemColorMode: string = '';
  // Controller object of the first webview created through the ArkHelper path
  // (the main window webview). Used by onSystemColorModeChange to re-apply the
  // background color when the system color mode flips.
  private mainWebviewController: ESObject = null;
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
      // Match the documented WebDarkMode.Auto pairing: seed the Web
      // component's background with the start window background so resize
      // gaps and pre-paint frames stay in sync with the splash mirror instead
      // of flashing the ArkWeb default white. start_window_background is
      // pinned to #000000 (see entry color.json), so the constant here is the
      // same color the mirror and the system start window show. The splash
      // mirror covers the very first frames anyway.
      if (!init.style?.backgroundColor) {
        init.style!.backgroundColor = '#000000';
      }
      const ret = this.webviewController.addWebview(init);
      if (this.mainWebviewController === null) {
        this.mainWebviewController = ret.controller;
      }

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

  /** Sync the webview background color with the new system color mode. */
  onSystemColorModeChange(): void {
    // The main webview is created through the ArkHelper path; its initData
    // style closure is still live, so re-applying updates the builder node.
    // Embedded browser webviews (BrowserWebviewService) manage their own
    // colors and are intentionally untouched here.
    const color: ResourceColor = this.systemColorMode === 'dark' ? '#000000' : '#FFFFFF';
    if (this.mainWebviewController !== null && typeof this.mainWebviewController.setBackgroundColor === 'function') {
      this.mainWebviewController.setBackgroundColor(color);
    }
  }

  async aboutToAppear(): Promise<void> {
    // Last-resort safety net: if the webview never reaches a first contentful
    // paint or a page-load end (navigation failure, blank page), release the
    // startup splash mirror so the app never gets stuck behind it. The normal
    // path hides the mirror via WebBuilder's FCP / onPageEnd handlers, long
    // before this timer fires.
    setTimeout(() => {
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
      // boots. DefaultXComponent is the page shown the moment the system
      // start window disappears, so this layer closes the blank gap until
      // the Web component's first contentful paint (see DefaultWebview).
      // Entry-side consumers that embed this component set
      // `bitfunStartupSplashIcon` in AppStorage; an empty value keeps this
      // layer inert on other consumers of the vendored module.
      if (this.splashIcon !== '') {
        Stack() {
          // The native start window (SurfaceDraw::DoDrawImageRect in
          // window_window_manager) scales the icon by
          // min(winW/iconW, winH/iconH) and never scales it up (scale >= 1
          // keeps the intrinsic 649px bitmap), centered on the window. With
          // the square 649px source icon that is a square of
          // min(649, winW, winH) physical pixels. Replicate exactly that:
          // px units (no density scaling) and a window-clamped size, so the
          // mirror lands pixel-identical on the takeover frame and the icon
          // does not jump when the system start window disappears.
          // syncLoad keeps the icon in the very first presented frame;
          // async decoding would show a background-only frame right after
          // the system start window goes away.
          Image(this.splashIcon)
            .objectFit(ImageFit.Contain)
            .interpolation(ImageInterpolation.Medium)
            .syncLoad(true)
            .width('100%')
            .height('100%')
            .constraintSize({
              minWidth: 0,
              minHeight: 0,
              maxWidth: '649px',
              maxHeight: '649px',
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
