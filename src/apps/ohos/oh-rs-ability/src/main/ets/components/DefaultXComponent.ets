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
          // The native start window draws startWindowIcon at its intrinsic
          // pixel size without density scaling, so use px units here too.
          Image(this.splashIcon)
            .objectFit(ImageFit.Contain)
            .interpolation(ImageInterpolation.Medium)
            .width('649px')
            .height('649px')
        }
        .width("100%")
        .height("100%")
        .backgroundColor(this.splashBackground)
      }
    };
  }
}
