import { webview } from '@kit.ArkWeb';
import { WorkspaceToolsIntent } from '../state/WorkspaceToolsState';
interface EditorFrame { content: string; editing: boolean; lineNumbers: boolean; ink: string; muted: string; }
interface EditorEvent { type: string; text?: string; }
class EditorNativeBridge {
  private receive: (raw: string) => void;
  constructor(receive: (raw: string) => void) { this.receive = receive; }
  postMessage(raw: string): void { this.receive(raw); }
}
@ComponentV2
export struct WorkspaceFileEditorView {
  @Param content: string = '';
  @Param editing: boolean = false;
  @Param lineNumbers: boolean = true;
  @Event onIntent: (intent: WorkspaceToolsIntent) => void = (_intent: WorkspaceToolsIntent) => {};
  private controller: webview.WebviewController = new webview.WebviewController();
  private ready: boolean = false;
  private active: boolean = true;
  private running: boolean = false;
  private dirty: boolean = true;
  private bridge: EditorNativeBridge = new EditorNativeBridge((raw: string): void => {
    if (!this.active) return;
    try {
      const event = JSON.parse(raw) as EditorEvent;
      if (event.type === 'ready') { this.ready = true; this.changed(); }
      else if (event.type === 'edit' && this.editing && typeof event.text === 'string') this.onIntent({ type: 'edit', text: event.text });
    } catch (_error) { /* Only typed editor input can leave the renderer. */ }
  });
  @Monitor('content', 'editing', 'lineNumbers')
  private changed(): void { this.dirty = true; void this.flush(); }
  private color(id: number): string {
    const value = this.getUIContext().getHostContext()?.resourceManager.getColorSync(id) || 0;
    return `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;
  }
  private async flush(): Promise<void> {
    if (!this.ready || !this.active || this.running) return;
    this.running = true;
    try {
      while (this.dirty && this.active) {
        this.dirty = false;
        const frame: EditorFrame = { content: this.content, editing: this.editing, lineNumbers: this.lineNumbers,
          ink: this.color($r('app.color.ink').id), muted: this.color($r('app.color.muted').id) };
        await this.controller.runJavaScript(`window.BitFunEditor.accept(${JSON.stringify(frame)})`);
      }
    } catch (error) { this.onIntent({ type: 'file-renderer-error', text: String(error) }); }
    finally { this.running = false; }
  }
  aboutToDisappear(): void { this.active = false; this.ready = false; }
  build() {
    Web({ src: $rawfile('editor/index.html'), controller: this.controller })
      .javaScriptAccess(true).domStorageAccess(false).fileAccess(false)
      .darkMode(WebDarkMode.Auto).forceDarkAccess(false)
      .javaScriptProxy({ object: this.bridge, name: 'BitFunEditorHost', methodList: ['postMessage'], controller: this.controller })
      .onControllerAttached(() => { this.active = true; })
      .onPageEnd(() => { void this.controller.runJavaScript('window.BitFunEditor.connect()').catch((error: Error) => this.onIntent({ type: 'file-renderer-error', text: error.message })); })
      .onErrorReceive((event: OnErrorReceiveEvent) => this.onIntent({ type: 'file-renderer-error', text: event.error.getErrorInfo() }))
      .onOverrideUrlLoading((request: WebResourceRequest): boolean => !request.getRequestUrl().startsWith('resource://rawfile/editor/'))
      .width('100%').height('100%')
  }
}
