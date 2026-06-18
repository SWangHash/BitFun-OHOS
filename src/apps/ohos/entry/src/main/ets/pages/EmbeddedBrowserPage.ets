import { webview } from '@kit.ArkWeb';
import { webViewManager } from '../utils/WebViewManager';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0000;
const TAG = 'EmbeddedBrowserPage';

@Entry
@Component
struct EmbeddedBrowserPage {
  @State url: string = 'https://openbitfun.com/';
  @State label: string = 'embedded-browser-view-0';
  controller: webview.WebviewController = new webview.WebviewController();

  aboutToAppear(): void {
    webViewManager.registerController(this.label, this.controller);
    hilog.info(DOMAIN, TAG, `EmbeddedBrowserPage aboutToAppear, registered controller: ${this.label}`);
  }

  aboutToDisappear(): void {
    webViewManager.unregisterController(this.label);
    hilog.info(DOMAIN, TAG, `EmbeddedBrowserPage aboutToDisappear, unregistered controller: ${this.label}`);
  }

  build() {
    Column() {
      Web({ src: this.url, controller: this.controller })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .onPageBegin((event) => {
          hilog.info(DOMAIN, TAG, `Page begin: ${event?.url}`);
        })
        .onPageEnd((event) => {
          hilog.info(DOMAIN, TAG, `Page end: ${event?.url}`);
        })
        .onErrorReceive((event) => {
          hilog.error(DOMAIN, TAG, `Page error: ${event?.error.getErrorInfo()}`);
        })
    }
    .width('100%')
    .height('100%')
  }
}