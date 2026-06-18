import { webview } from '@kit.ArkWeb';
import { hilog } from '@kit.PerformanceAnalysisKit';

const DOMAIN = 0x0000;
const TAG = 'WebViewManager';

export class WebViewManager {
  private static instance: WebViewManager;
  private controllers: Map<string, webview.WebviewController> = new Map();

  static getInstance(): WebViewManager {
    if (!WebViewManager.instance) {
      WebViewManager.instance = new WebViewManager();
    }
    return WebViewManager.instance;
  }

  registerController(label: string, controller: webview.WebviewController): void {
    this.controllers.set(label, controller);
    hilog.info(DOMAIN, TAG, `Registered webview controller: ${label}`);
  }

  unregisterController(label: string): void {
    this.controllers.delete(label);
    hilog.info(DOMAIN, TAG, `Unregistered webview controller: ${label}`);
  }

  getController(label: string): webview.WebviewController | null {
    return this.controllers.get(label) ?? null;
  }

  async evalJavaScript(label: string, script: string): Promise<string> {
    const controller = this.getController(label);
    if (!controller) {
      hilog.error(DOMAIN, TAG, `Webview not found: ${label}`);
      return `Webview not found: ${label}`;
    }

    try {
      const result = await controller.runJavaScript(script);
      hilog.info(DOMAIN, TAG, `evalJavaScript success: ${script}`);
      return '';
    } catch (error) {
      hilog.error(DOMAIN, TAG, `evalJavaScript failed: ${JSON.stringify(error)}`);
      return `eval failed: ${JSON.stringify(error)}`;
    }
  }

  getUrl(label: string): string {
    const controller = this.getController(label);
    if (!controller) {
      hilog.error(DOMAIN, TAG, `Webview not found: ${label}`);
      return '';
    }

    try {
      const url = controller.getUrl();
      hilog.info(DOMAIN, TAG, `getUrl success: ${url}`);
      return url;
    } catch (error) {
      hilog.error(DOMAIN, TAG, `getUrl failed: ${JSON.stringify(error)}`);
      return '';
    }
  }
}

export const webViewManager = WebViewManager.getInstance();