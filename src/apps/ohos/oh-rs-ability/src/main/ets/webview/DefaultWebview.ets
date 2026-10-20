import { UIContext } from "@ohos.arkui.UIContext";
import web_webview from "@ohos.web.webview";
import { NodeController, BuilderNode, FrameNode } from "@ohos.arkui.node";
import { randomString } from "../helper";
import { OnDownloadStartResult } from "../ability/type";
import { getCookies, JsHelper } from "./Utils";
import { WebHeader } from "@kit.ArkUI";
import { unifiedDataChannel, uniformTypeDescriptor, uniformDataStruct } from "@kit.ArkData";
import { bundleManager } from "@kit.AbilityKit";
import fileUri from "@ohos.file.fileuri";
import fs from "@ohos.file.fs";
import hilog from "@ohos.hilog";
import { BusinessError } from "@ohos.base";

const FILE_DROP_LOG_DOMAIN: number = 0x0000;
const FILE_DROP_LOG_TAG: string = "BitFunFileDrop";
const USER_APPDATA_PREFIX: string = "/storage/Users/currentUser/appdata";
const FILE_DROP_MAX_RETRIES: number = 3;
const FILE_DROP_RETRY_INTERVAL_MS: number = 1500;
// Cap for the page URL that the startup log line carries. Query and fragment are
// dropped first, so the line never contains page state.
const STARTUP_LOG_URL_MAX_LENGTH: number = 96;

/**
 * Page URL for the `BitFunStartup` log line: fragment and query removed, then
 * capped, so one startup line stays readable and carries no page state.
 */
function startupLogUrl(rawUrl: string): string {
  const withoutFragment = rawUrl.split('#')[0];
  const withoutQuery = withoutFragment.split('?')[0];
  return withoutQuery.length > STARTUP_LOG_URL_MAX_LENGTH
    ? withoutQuery.slice(0, STARTUP_LOG_URL_MAX_LENGTH) + '...'
    : withoutQuery;
}

export interface WebviewStyle {
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;
  backgroundColor?: string | Color;
  visible?: string;
}

export interface WebviewInitData {
  webTag?: string;
  url: string;
  style?: WebviewStyle;
  controller?: WebviewController;
  javascriptEnable?: boolean;
  devtools?: boolean;
  autoplay?: boolean;
  userAgent?: string;
  initializationScripts?: ScriptItem[];
  headers?: Record<string, string>;
  html?: string;
  onDragAndDrop?: (event: string) => void;
  onDownloadStart?: (url: string, tempPath: string | undefined) => OnDownloadStartResult;
  onDownloadEnd?: (url: string, tempPath: string | undefined, success: boolean) => void;
  onNavigationRequest?: (url: string) => boolean;
  onTitleChange?: (title: string) => void;
  onPageBegin?: (url: string) => void;
  onPageEnd?: (url: string) => void;
}

interface WebviewNodeData extends WebviewInitData {
  controller: WebviewController;
}

interface OhosFileMetadata {
  size: number;
  isFile: boolean;
  isDir: boolean;
}

interface OhosNativeDropPayload {
  type: string;
  paths: string[];
  metadata?: OhosFileMetadata[];
}

interface CollectedDropResult {
  paths: string[];
  metadata: OhosFileMetadata[];
}

// ArkWeb does not deliver external (file manager) file drags as HTML5 drop
// events, and Wry's OHOS adapter does not forward them through Tauri's native
// drag-drop handler. The Web component therefore collects the dropped files
// and forwards their filesystem paths to the web-ui through a global JS hook.
function normalizeDroppedFileUri(uri: string): string {
  hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `normalizeDroppedFileUri input uri=${uri}`);
  if (!uri.startsWith("file://") && !uri.startsWith("docs://")) {
    hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `normalizeDroppedFileUri passthrough no prefix: ${uri}`);
    return uri;
  }

  const path = new fileUri.FileUri(uri).path;
  hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `normalizeDroppedFileUri FileUri.path=${path}`);
  if (!path.startsWith(USER_APPDATA_PREFIX)) {
    hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `normalizeDroppedFileUri returning non-appdata path: ${path}`);
    return path;
  }

  const storagePath = "/data/storage" + path.slice(USER_APPDATA_PREFIX.length);
  try {
    const bundleName = bundleManager.getBundleInfoForSelfSync(
      bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT,
    ).name;
    hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `normalizeDroppedFileUri bundleName=${bundleName}`);
    const result = bundleName.length > 0
      ? storagePath.replace("/" + bundleName + "/", "/base/")
      : storagePath;
    hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `normalizeDroppedFileUri final path=${result}`);
    return result;
  } catch (e) {
    const err = e as BusinessError;
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `Unable to resolve bundle name: code=${err.code} msg=${err.message}`);
    return storagePath;
  }
}

function resolveFileMetadata(path: string): OhosFileMetadata {
  try {
    const stat = fs.statSync(path);
    const isDir = stat.isDirectory();
    const meta: OhosFileMetadata = {
      size: stat.size,
      isFile: !isDir,
      isDir: isDir,
    };
    hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `resolveFileMetadata: path=${path} size=${meta.size} isFile=${meta.isFile} isDir=${meta.isDir}`);
    return meta;
  } catch (e) {
    const err = e as BusinessError;
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `resolveFileMetadata: fs.stat failed path=${path}: code=${err.code} msg=${err.message}`);
    return { size: 0, isFile: false, isDir: false };
  }
}

function tryCollectDroppedFilePaths(dragEvent: DragEvent): CollectedDropResult {
  const paths: string[] = [];
  const metadata: OhosFileMetadata[] = [];
  const seen: Set<string> = new Set<string>();
  try {
    const data = dragEvent.getData() as unifiedDataChannel.UnifiedData;
    if (!data) {
      hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, "tryCollect: getData returned null");
      return { paths, metadata };
    }
    const records: unifiedDataChannel.UnifiedRecord[] = data.getRecords();
    if (!records || records.length <= 0) {
      const count = records ? records.length : 0;
      hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: records null or empty, count=${count}`);
      return { paths, metadata };
    }
    hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: records count=${records.length}`);
    for (let i = 0; i < records.length; i++) {
      const types = records[i].getTypes();
      const hasFileUri = types.includes(uniformTypeDescriptor.UniformDataType.FILE_URI);
      hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: record[${i}] typesCount=${types.length} hasFileUri=${hasFileUri}`);
      if (hasFileUri) {
        const fileUriUds =
          records[i].getEntry(uniformTypeDescriptor.UniformDataType.FILE_URI) as uniformDataStruct.FileUri;
        if (fileUriUds && fileUriUds.oriUri) {
          try {
            const path = normalizeDroppedFileUri(fileUriUds.oriUri);
            if (path.length > 0 && !seen.has(path)) {
              seen.add(path);
              paths.push(path);
              metadata.push(resolveFileMetadata(path));
            } else {
              hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: record[${i}] path empty or duplicate: ${path}`);
            }
          } catch (e) {
            const err = e as BusinessError;
            hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: normalize failed record[${i}]: code=${err.code} msg=${err.message}`);
          }
        } else {
          hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: record[${i}] fileUriUds null or oriUri empty`);
        }
      }
    }
  } catch (e) {
    const err = e as BusinessError;
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: inspect failed: code=${err.code} msg=${err.message}`);
  }
  return { paths, metadata };
}

function collectDroppedFilePathsWithRetry(
  controller: WebviewController,
  dragEvent: DragEvent,
  attempt: number,
): void {
  hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `collectWithRetry: attempt=${attempt + 1}/${FILE_DROP_MAX_RETRIES}`);
  const result = tryCollectDroppedFilePaths(dragEvent);
  if (result.paths.length > 0) {
    hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `Native file drop collected: attempt=${attempt + 1} pathCount=${result.paths.length}`);
    for (let i = 0; i < result.paths.length; i++) {
      hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `Native file drop path[${i}]=${result.paths[i]}`);
    }
    dispatchNativeDragEvent(controller, "drop", result.paths, result.metadata);
    return;
  }
  if (attempt >= FILE_DROP_MAX_RETRIES - 1) {
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `Native file drop exhausted retries: pathCount=0 after ${FILE_DROP_MAX_RETRIES} attempts`);
    dispatchNativeDragEvent(controller, "drop", [], []);
    return;
  }
  hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `Native file drop retry scheduled: nextAttempt=${attempt + 2} afterMs=${FILE_DROP_RETRY_INTERVAL_MS}`);
  setTimeout(() => {
    collectDroppedFilePathsWithRetry(controller, dragEvent, attempt + 1);
  }, FILE_DROP_RETRY_INTERVAL_MS);
}

function dispatchNativeDragEvent(
  controller: WebviewController,
  type: string,
  paths: string[],
  metadata?: OhosFileMetadata[],
): void {
  const payload: OhosNativeDropPayload = { type: type, paths: paths };
  if (metadata && metadata.length > 0) {
    payload.metadata = metadata;
  }
  const code: string =
    "window.__bitFunNativeFileDrop && window.__bitFunNativeFileDrop(" + JSON.stringify(payload) + ");";
  hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `dispatchNativeDragEvent: type=${type} pathCount=${paths.length} hasMetadata=${payload.metadata !== undefined}`);
  try {
    controller.runJavaScript(code).then((ret: string) => {
      hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `dispatchNativeDragEvent: JS dispatch ok type=${type}`);
    }).catch((e: BusinessError) => {
      hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `dispatchNativeDragEvent: JS dispatch failed type=${type}: code=${e.code} msg=${e.message}`);
    });
  } catch (e) {
    const err = e as BusinessError;
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `dispatchNativeDragEvent: controller unavailable type=${type}: code=${err.code} msg=${err.message}`);
  }
}

@Builder
function WebBuilder(data: WebviewNodeData) {
  // init with empty url and reload with loadUrl or loadData with onControllerAttach
  Web({ src: "", controller: data.controller as web_webview.WebviewController })
    .width(data.style?.width ?? "100%")
    .height(data.style?.height ?? "100%")
    .position({
      x: data.style?.x || 0,
      y: data.style?.y || 0,
    })
    .backgroundColor(data?.style?.backgroundColor)
    // Follow the system color mode so `prefers-color-scheme` inside the page
    // resolves correctly. ArkWeb defaults to WebDarkMode.Off, which pins every
    // page to light mode no matter what the system uses: the pre-React
    // background and the startup brand splash (both keyed on
    // prefers-color-scheme) would stay white on dark systems. Desktop webviews
    // (WebView2/WKWebView) follow the system by default, so Auto keeps OHOS
    // behavior aligned with the other platforms. forceDarkAccess stays off:
    // pages style themselves via their own dark-theme CSS. Live mode changes
    // are still delivered through notifySystemColorMode (see EntryAbility).
    .darkMode(WebDarkMode.Auto)
    .forceDarkAccess(false)
    .visibility(data?.style?.visible === "hidden" ? Visibility.Hidden : Visibility.Visible)
    .javaScriptAccess(data?.javascriptEnable)
    .mediaPlayGestureAccess(
      typeof data?.autoplay === "boolean" && data.autoplay === true ? false : true,
    )
    .javaScriptOnDocumentStart(data?.initializationScripts)
    .onControllerAttached(() => {
      const ctrl = data.controller;
      // load url or html string
      if (data?.url) {
        const header: WebHeader[] = Object.keys(
          (data?.headers || {}) as Record<string, string>,
        ).reduce((t: WebHeader[], i) => {
          t.push({ headerKey: i, headerValue: data.headers![i] } as WebHeader);
          return t;
        }, []);
        ctrl.loadUrl(data.url, header);
      } else {
        ctrl.loadData(data!.html, "text/html", "UTF-8", " ", " ");
      }
    })
    .onLoadIntercept((event) => {
      const url = event.data.getRequestUrl();
      if (url.startsWith("file://")) {
        hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG,
          `onLoadIntercept: blocked file:// navigation from drag-drop default: ${url}`);
        return true;
      }
      if (typeof data?.onNavigationRequest === "function") {
        const ret = data.onNavigationRequest(url);
        return ret;
      }
      return false;
    })
    // Hide the startup splash mirror once the webview has actually presented
    // the brand overlay. Release signals, earliest first:
    // 1. FCP: the Web component painted content (absent on some ArkWeb builds).
    // 2. The page's 'bitfun-startup-overlay-presented' console token: emitted
    //    after the overlay mark is decoded and one double-rAF frame commits,
    //    i.e. the takeover frame. This is the exact handoff point; releasing
    //    earlier (e.g. on a load event) can expose a background-only frame
    //    that reads as a flash between the mirror and the overlay.
    // 3. onPageEnd fallback, delayed so the overlay frame is on screen.
    // Clearing an already-empty value is idempotent.
    .onFirstContentfulPaint(() => {
      hilog.info(FILE_DROP_LOG_DOMAIN, 'BitFunStartup', 'splash mirror released by FCP');
      AppStorage.set<ResourceStr>("bitfunStartupSplashIcon", '');
    })
    .onConsole((event) => {
      if (event && event.message && event.message.getMessage() === 'bitfun-startup-overlay-presented') {
        hilog.info(FILE_DROP_LOG_DOMAIN, 'BitFunStartup', 'splash mirror released by overlay-presented token');
        AppStorage.set<ResourceStr>("bitfunStartupSplashIcon", '');
        return true;
      }
      if (event && event.message && event.message.getMessage() === 'bitfun-startup-overlay-hidden') {
        hilog.info(FILE_DROP_LOG_DOMAIN, 'BitFunStartup', 'startup overlay hidden by app shell');
        return true;
      }
      return false;
    })
    .onPageBegin((event) => {
      // The first page beginning is the moment the native side has finished
      // creating this webview and the frontend starts loading. Together with the
      // `native render returned` mark in DefaultXComponent it splits the launch
      // surface into "native startup" and "frontend load".
      hilog.info(
        FILE_DROP_LOG_DOMAIN,
        'BitFunStartup',
        'frontend page load began: url=%{public}s',
        startupLogUrl(event?.url ?? '')
      );
      if (typeof data?.onPageBegin === "function") {
        const url = event?.url ?? "";
        data.onPageBegin(url);
      }
    })
    .onPageEnd((event) => {
      // Delayed fallback: onPageEnd itself is a load event, not a paint event,
      // so releasing here immediately can expose a frame before the overlay is
      // presented. The console token above releases at the exact takeover
      // frame; this path only covers pages that never emit it.
      setTimeout(() => {
        hilog.info(FILE_DROP_LOG_DOMAIN, 'BitFunStartup', 'splash mirror released by onPageEnd fallback');
        AppStorage.set<ResourceStr>("bitfunStartupSplashIcon", '');
      }, 300);
      if (typeof data?.onPageEnd === "function") {
        const url = event?.url ?? "";
        data.onPageEnd(url);
      }
    })
    .onTitleReceive((e) => {
      if (typeof data?.onTitleChange === "function") {
        data.onTitleChange(e.title);
      }
    })
    .onDragEnter((dragEvent: DragEvent) => {
      hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, "onDragEnter triggered");
      dispatchNativeDragEvent(data.controller, "enter", []);
    })
    .onDragMove((dragEvent: DragEvent) => {
      // No dispatch: onDragMove fires for every pixel of movement, flooding
      // runJavaScript and contending with GitStateManager's listen fetches.
      // The enter event already sets the drag-over state; over is redundant.
    })
    .onDragLeave((dragEvent: DragEvent) => {
      hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, "onDragLeave triggered");
      dispatchNativeDragEvent(data.controller, "leave", []);
    })
    .onDrop((dragEvent: DragEvent) => {
      hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, "onDrop triggered, starting retry collection");
      collectDroppedFilePathsWithRetry(data.controller, dragEvent, 0);
    });
}

const webViewWrap = wrapBuilder<WebviewNodeData[]>(WebBuilder);

interface AddWebviewMethod {
  webTag: string;
  controller: JsHelper;
}

export class RustWebviewNodeController extends NodeController {
  private rootNode: FrameNode | null = null;
  private webviewList: Map<string, BuilderNode<WebviewNodeData[]>> = new Map();
  private webviewData: Map<string, JsHelper> = new Map();
  private uiContext: UIContext | null = null;

  constructor(uiContext: UIContext) {
    super();
    this.uiContext = uiContext;
  }

  private buildData(controller: WebviewController, initData: WebviewInitData): JsHelper {
    const getUrl = () => {
      return controller.getUrl();
    };
    const getCookiesHelper = (url: string) => {
      return getCookies(url) as string;
    };
    const loadUrl = (url: string, header?: Record<string, string>) => {
      const headers = Object.keys((header || {}) as Record<string, string>).reduce(
        (t, i) => {
          if (!!header![i]) {
            t.push({ headerKey: i, headerValue: header![i] });
          }
          return t;
        },
        [] as Array<WebHeader>,
      );
      controller.loadUrl(url, headers);
    };

    const loadHtml = (html: string) => {
      controller.loadData(html, "text/html", "UTF-8", " ", " ");
    };

    const zoom = (scale: number) => {
      controller.zoom(scale);
    };

    const refresh = () => {
      controller.refresh();
    };

    const requestFocus = () => {
      controller.requestFocus();
    };

    // clear browsing data
    const clearAllBrowsingData = () => {
      web_webview.WebStorage.deleteAllData(true);
      web_webview.WebDataBase.deleteHttpAuthCredentials();
      controller.removeCache(true);
      controller.clearHistory();
    };

    const runJavaScript = (code: string, cb: (result?: string) => void) => {
      controller.runJavaScript(code).then((ret) => {
        cb(ret);
      });
    };

    // Updates the BuilderNode that backs this webview with a new style object.
    // Mirrors the pattern the original DefaultXComponent used to apply
    // setVisible/setBackgroundColor: mutate initData.style then re-build.
    const syncStyleToNode = () => {
      const node = this.webviewList.get(initData.webTag ?? "");
      node?.update(initData);
    };

    const setBackgroundColor = (color: string) => {
      if (!initData.style) {
        initData.style = {};
      }
      initData.style.backgroundColor = color;
      syncStyleToNode();
    };

    const setVisible = (visible: boolean) => {
      if (!initData.style) {
        initData.style = {};
      }
      initData.style.visible = visible ? "visible" : "hidden";
      syncStyleToNode();
    };

    const data: JsHelper = {
      getUrl,
      getCookies: getCookiesHelper,
      loadUrl,
      loadHtml,
      zoom,
      refresh,
      requestFocus,
      clearAllBrowsingData,
      runJavaScript,
      setBackgroundColor,
      setVisible,
    } as JsHelper;
    return data;
  }

  makeNode(uiContext: UIContext): FrameNode {
    if (this.rootNode === null) {
      this.rootNode = new FrameNode(uiContext);
    }
    return this.rootNode;
  }

  addWebview(data: WebviewInitData): AddWebviewMethod {
    if (!data.webTag) {
      data.webTag = randomString();
    }
    if (!data.controller) {
      data.controller = new web_webview.WebviewController(data.webTag) as WebviewController;
    }

    if (this.rootNode === null) {
      this.rootNode = new FrameNode(this.uiContext!);
    }

    // Enabled devtools
    data?.devtools && web_webview.WebviewController.setWebDebuggingAccess(true);

    const node: BuilderNode<WebviewNodeData[]> = new BuilderNode(this.uiContext!);
    node.build(webViewWrap, data);
    this.webviewList.set(data.webTag, node);

    const controller = this.buildData(data.controller, data);
    // intercept download task
    if (typeof data?.onDownloadStart === "function" || typeof data?.onDownloadEnd === "function") {
      const download = new web_webview.WebDownloadDelegate();

      if (typeof data?.onDownloadStart === "function") {
        download.onBeforeDownload((e) => {
          const url = e.getUrl();
          const tempPath = e.getFullPath();
          const ret = data.onDownloadStart!(url, tempPath);

          if (ret.allow) {
            e.start(ret.tempPath || tempPath);
          } else {
            e.cancel();
          }
        });
      }

      if (typeof data?.onDownloadEnd === "function") {
        download.onDownloadFinish((e) => {
          const url = e.getUrl();
          const tempPath = e.getFullPath();
          data.onDownloadEnd!(url, tempPath, true);
        });
        download.onDownloadFailed((e) => {
          const url = e.getUrl();
          data.onDownloadEnd!(url, undefined, false);
        });
      }

      data.controller.setDownloadDelegate(download);
    }
    this.webviewData.set(data.webTag, controller);

    this.rootNode?.appendChild(node.getFrameNode());
    return {
      webTag: data.webTag,
      controller,
    };
  }

  getWebviewNode(webTag: string) {
    return this.webviewList.get(webTag);
  }

  getWebviewData(webTag: string): JsHelper | undefined {
    return this.webviewData.get(webTag);
  }

  /**
   * Remove a previously-added webview from the render tree and dispose of its
   * BuilderNode / controller entries. The detached FrameNode is removed from
   * the rootNode so the embedded Web component is torn down promptly (releases
   * the underlying ArkWeb renderer slot). Safe to call when the webTag is
   * unknown (returns false).
   */
  removeWebview(webTag: string): boolean {
    const node = this.webviewList.get(webTag);
    if (!node) {
      return false;
    }
    const frameNode = node.getFrameNode();
    if (this.rootNode && frameNode) {
      this.rootNode.removeChild(frameNode);
    }
    // Removing the FrameNode only detaches it from the render tree. Dispose
    // the BuilderNode as well so ArkWeb releases the renderer and its CDP
    // target instead of keeping a detached page alive until process exit.
    node.dispose();
    this.webviewList.delete(webTag);
    this.webviewData.delete(webTag);
    return true;
  }
}

// extend WebviewController method
declare class WebviewController extends web_webview.WebviewController {
  getCookies: (url: string) => string;
  setBackgroundColor: (color: string) => void;
  setVisible: (visible: boolean) => void;
  clearAllBrowsingData: () => void;
}
