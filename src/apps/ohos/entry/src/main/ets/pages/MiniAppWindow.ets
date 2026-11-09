/**
 * Content page for one independent MiniApp window.
 *
 * Loaded by `MiniAppWindowService` with a `LocalStorage` that carries the
 * window name. The ArkWeb page (`rawfile/miniapp-window/shell.html`) hosts the
 * MiniApp document and relays the shell protocol through the injected
 * `ohosMiniAppHost` proxy, so MiniApp content never sees host identity.
 */
import { webview } from '@kit.ArkWeb';
import { MiniAppWindowBridge, MiniAppWindowService } from '../services/MiniAppWindowService';

@Entry
@Component
struct MiniAppWindow {
  @LocalStorageProp('bitfunMiniAppWindowName') windowName: string = '';
  private controller: webview.WebviewController = new webview.WebviewController();
  private bridge: MiniAppWindowBridge = MiniAppWindowService.getInstance().bridgeFor('');

  aboutToAppear(): void {
    this.bridge = MiniAppWindowService.getInstance().bridgeFor(this.windowName);
  }

  build() {
    Column() {
      Web({ src: $rawfile('miniapp-window/shell.html'), controller: this.controller })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .javaScriptProxy({
          object: this.bridge,
          name: 'ohosMiniAppHost',
          methodList: ['call', 'result', 'closeSelf'],
          controller: this.controller,
        })
    }
    .width('100%')
    .height('100%')
  }
}
