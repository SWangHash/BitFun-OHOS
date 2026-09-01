import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';
import { screenshot, display, window } from '@kit.ArkUI';
import { image } from '@kit.ImageKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { common } from '@kit.AbilityKit';

const LOG_DOMAIN = 0x0000;
const LOG_TAG = 'ScreenCaptureStore';

interface CaptureRequest {
  action: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface DisplayItem {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor: number;
}

interface CaptureResponse {
  status: string;
  value?: string;
  width?: number;
  height?: number;
  displays?: DisplayItem[];
  code?: string;
}

/**
 * OHOS screen-capture backend behind the `screen_capture` ArkTS bridge.
 *
 * `capture_region` and `capture_window` grab the full screen through
 * `screenshot.capture()` (programmatic, needs `ohos.permission.CUSTOM_SCREEN_CAPTURE`)
 * and read the requested rectangle as RGBA_8888 via `PixelMap.readPixels`,
 * returning the pixels base64-encoded so the JSON wire envelope stays UTF-8.
 * `list_displays` enumerates displays via `@ohos.display`. Every failure maps
 * to a `{ status: 'error', code }` response so the Rust caller degrades loudly
 * instead of receiving empty data.
 */
export class ScreenCaptureStore {
  private readonly base64Helper: util.Base64Helper = new util.Base64Helper();
  private readonly context: common.UIAbilityContext;

  constructor(context: common.UIAbilityContext) {
    this.context = context;
  }

  async handle(input: string): Promise<string> {
    let action = 'parse';
    try {
      const request: CaptureRequest = JSON.parse(input) as CaptureRequest;
      action = request.action;
      if (action === 'list_displays') {
        return JSON.stringify(await this.listDisplays() as CaptureResponse);
      }
      if (action === 'capture_region') {
        const x: number = request.x ?? 0;
        const y: number = request.y ?? 0;
        const width: number = request.width ?? 0;
        const height: number = request.height ?? 0;
        return JSON.stringify(await this.captureRegion(x, y, width, height) as CaptureResponse);
      }
      if (action === 'capture_window') {
        return JSON.stringify(await this.captureApplicationWindow() as CaptureResponse);
      }
      const invalid: CaptureResponse = { status: 'error', code: 'REQUEST_INVALID' };
      return JSON.stringify(invalid);
    } catch (error) {
      const businessError: BusinessError = error as BusinessError;
      const code: string = businessError.code === undefined ? 'INTERNAL_ERROR' : String(businessError.code);
      hilog.error(
        LOG_DOMAIN,
        LOG_TAG,
        'screen capture failed: action=%{public}s code=%{public}s',
        action,
        code
      );
      const failed: CaptureResponse = { status: 'error', code };
      return JSON.stringify(failed);
    }
  }

  private async listDisplays(): Promise<CaptureResponse> {
    const displays: Array<display.Display> = await display.getAllDisplays();
    const items: DisplayItem[] = displays.map((d: display.Display): DisplayItem => {
      const item: DisplayItem = {
        id: d.id,
        // OHOS Display does not expose a per-display desktop offset; report
        // origin (0,0). Multi-display global-coordinate mapping is not
        // exercised by the current single-display MiniApp capture path.
        x: 0,
        y: 0,
        width: d.width,
        height: d.height,
        scale_factor: d.densityPixels,
      };
      return item;
    });
    const response: CaptureResponse = { status: 'ok', displays: items };
    return response;
  }

  private async captureRegion(
    x: number,
    y: number,
    width: number,
    height: number
  ): Promise<CaptureResponse> {
    if (width <= 0 || height <= 0) {
      const invalid: CaptureResponse = { status: 'error', code: 'INVALID_REGION' };
      return invalid;
    }
    const pixelMap: image.PixelMap = await screenshot.capture();
    try {
      const info: image.ImageInfo = pixelMap.getImageInfoSync();
      const fullWidth: number = info.size.width;
      const fullHeight: number = info.size.height;
      const rx: number = Math.max(0, Math.min(x, fullWidth));
      const ry: number = Math.max(0, Math.min(y, fullHeight));
      const rw: number = Math.min(width, fullWidth - rx);
      const rh: number = Math.min(height, fullHeight - ry);
      if (rw <= 0 || rh <= 0) {
        const outside: CaptureResponse = { status: 'error', code: 'REGION_OUTSIDE_SCREEN' };
        return outside;
      }
      const region: image.Region = {
        x: rx,
        y: ry,
        size: { width: rw, height: rh } as image.Size
      };
      const pixels: ArrayBuffer = new ArrayBuffer(rw * rh * 4);
      const area: image.PositionArea = { pixels, stride: rw * 4, offset: 0, region };
      await pixelMap.readPixels(area);
      const value: string = this.base64Helper.encodeToStringSync(new Uint8Array(pixels));
      const response: CaptureResponse = { status: 'ok', value, width: rw, height: rh };
      return response;
    } finally {
      pixelMap.release();
    }
  }

  private async captureApplicationWindow(): Promise<CaptureResponse> {
    const win: window.Window = await window.getLastWindow(this.context);
    const props: window.WindowProperties = win.getWindowProperties();
    const rect: window.Rect = props.windowRect;
    return await this.captureRegion(rect.left, rect.top, rect.width, rect.height);
  }
}
