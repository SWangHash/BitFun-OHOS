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
// Cross-app drags (WeChat, another app's sandbox) only carry a URI that is valid
// inside the source app, so such files are staged under the ability cache dir
// published by EntryAbility before the web-ui (and the Rust side) sees a path.
const DROP_CACHE_SUBDIR: string = "bitfun-drops";
const DROP_CACHE_DIR_STORAGE_KEY: string = "bitfunDropCacheDir";
let dropStageSequence: number = 0;

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
  domStorageEnable?: boolean;
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
  contentLoaded?: boolean;
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
  recordCount: number;
}

interface ResolvedDroppedFile {
  path: string;
  metadata: OhosFileMetadata;
}

enum NativeDragDataKind {
  Unavailable,
  File,
  NonFile,
}

// ArkWeb does not deliver external (file manager) file drags as HTML5 drop
// events, and Wry's OHOS adapter does not forward them through Tauri's native
// drag-drop handler. The Web component therefore collects the dropped files and
// forwards a readable local path per file to the web-ui through a global JS
// hook. "Readable" is the hard part: a drag from a user document folder is a
// real path, while a drag out of another app (WeChat, for example) is only a
// URI inside that app's sandbox and has to be staged first.
let ownBundleNameCache: string = "";

function getOwnBundleName(): string {
  if (ownBundleNameCache.length > 0) {
    return ownBundleNameCache;
  }
  try {
    ownBundleNameCache = bundleManager.getBundleInfoForSelfSync(
      bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT,
    ).name;
  } catch (e) {
    const err = e as BusinessError;
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG,
      `getOwnBundleName failed: code=${err.code} msg=${err.message}`);
  }
  return ownBundleNameCache;
}

/// Map the appdata view of THIS app's sandbox onto the sandbox path the Rust
/// side reads: `/storage/Users/currentUser/appdata/el2/base/<bundle>/a/b` ->
/// `/data/storage/el2/base/a/b`.
///
/// An appdata path that carries another bundle's name is deliberately not
/// mapped: no string rewrite can make it valid inside our own sandbox, so the
/// caller has to stage the drag URI instead.
function ownSandboxPathFromAppData(nativePath: string): string {
  if (!nativePath.startsWith(USER_APPDATA_PREFIX)) {
    return "";
  }
  const bundleName: string = getOwnBundleName();
  if (bundleName.length === 0) {
    return "";
  }
  const relativePath: string = nativePath.slice(USER_APPDATA_PREFIX.length);
  const bundleMarker: string = `/${bundleName}/`;
  const markerIndex: number = relativePath.indexOf(bundleMarker);
  if (markerIndex < 0) {
    return "";
  }
  return "/data/storage" + relativePath.replace(bundleMarker, "/");
}

function classifyNativeDragData(dragEvent: DragEvent): NativeDragDataKind {
  try {
    const data = dragEvent.getData() as unifiedDataChannel.UnifiedData;
    if (!data) {
      return NativeDragDataKind.Unavailable;
    }
    const records: unifiedDataChannel.UnifiedRecord[] = data.getRecords();
    if (!records || records.length <= 0) {
      return NativeDragDataKind.Unavailable;
    }
    for (let i = 0; i < records.length; i++) {
      if (records[i].getTypes().includes(uniformTypeDescriptor.UniformDataType.FILE_URI)) {
        return NativeDragDataKind.File;
      }
    }
    return NativeDragDataKind.NonFile;
  } catch (e) {
    return NativeDragDataKind.Unavailable;
  }
}

function toOhosFileMetadata(stat: fs.Stat): OhosFileMetadata {
  const isDir: boolean = stat.isDirectory();
  return {
    size: stat.size,
    isFile: !isDir,
    isDir: isDir,
  };
}

function statDroppedPath(path: string): fs.Stat | null {
  if (path.length === 0) {
    return null;
  }
  try {
    return fs.statSync(path);
  } catch (e) {
    const err = e as BusinessError;
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG,
      `statDroppedPath: fs.stat failed path=${path}: code=${err.code} msg=${err.message}`);
    return null;
  }
}

function resolveDropCacheDir(): string {
  const base: string | undefined = AppStorage.get<string>(DROP_CACHE_DIR_STORAGE_KEY);
  if (!base || base.length === 0) {
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG,
      `resolveDropCacheDir: ${DROP_CACHE_DIR_STORAGE_KEY} is not published by the ability`);
    return "";
  }
  const dir: string = base.replace(/\/+$/, "") + "/" + DROP_CACHE_SUBDIR;
  try {
    try {
      fs.statSync(dir);
    } catch (e) {
      fs.mkdirSync(dir);
    }
    return dir;
  } catch (e) {
    const err = e as BusinessError;
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG,
      `resolveDropCacheDir: mkdir failed dir=${dir}: code=${err.code} msg=${err.message}`);
    return "";
  }
}

/// Stage one cross-app drag URI into the app cache and return the sandbox copy.
///
/// A file dragged out of another app arrives as `file://<source-bundle>/...`.
/// `FileUri.path` turns that into an appdata path under the *source* bundle,
/// which this sandbox can neither stat nor read, and remapping it onto our own
/// sandbox produces a path that cannot exist (`/data/storage/el2/base/<other>`).
/// `fs.openSync` on the URI consumes the drag grant, so the copy below is the
/// only cross-app read that works - the same rule that already governs the
/// pasteboard path (entry/.../CommonUtils.copy_pasteboard_entry).
function stageDroppedUri(uri: string): ResolvedDroppedFile | null {
  const cacheDir: string = resolveDropCacheDir();
  if (cacheDir.length === 0) {
    return null;
  }

  let name: string = "";
  try {
    name = new fileUri.FileUri(uri).name;
  } catch (e) {
    name = "";
  }
  if (name.length === 0) {
    name = uri.substring(uri.lastIndexOf("/") + 1);
  }
  name = name.replace(/[\\/]/g, "_");
  if (name.length === 0) {
    name = "dropped-file";
  }

  dropStageSequence += 1;
  // One directory per staged URI keeps the original file name intact: the
  // web-ui derives the attachment label from the path's basename.
  const destDir: string = `${cacheDir}/${Date.now()}-${dropStageSequence}`;
  const destPath: string = `${destDir}/${name}`;
  let source: fs.File | null = null;
  try {
    fs.mkdirSync(destDir);
    source = fs.openSync(uri, fs.OpenMode.READ_ONLY);
    fs.copyFileSync(source.fd, destPath);
  } catch (e) {
    const err = e as BusinessError;
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG,
      `stageDroppedUri: copy failed uri=${uri} dest=${destPath}: code=${err.code} msg=${err.message}`);
    return null;
  } finally {
    if (source) {
      try {
        fs.closeSync(source);
      } catch (e) {
        // Closing a staged fd cannot fail in a way the caller can act on.
      }
    }
  }

  const stagedStat: fs.Stat | null = statDroppedPath(destPath);
  if (!stagedStat) {
    return null;
  }
  hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `stageDroppedUri: staged uri=${uri} -> path=${destPath}`);
  return { path: destPath, metadata: toOhosFileMetadata(stagedStat) };
}

/// Resolve one dragged file URI into a readable local path plus its metadata.
///
/// Order matters: keep the zero-copy path whenever the URI already points at a
/// real file (user documents, and this app's own sandbox), and only stage a
/// cache copy for URIs that live in another app's sandbox.
function resolveDroppedFile(uri: string): ResolvedDroppedFile | null {
  let nativePath: string = "";
  try {
    nativePath = new fileUri.FileUri(uri).path;
  } catch (e) {
    const err = e as BusinessError;
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG,
      `resolveDroppedFile: FileUri failed uri=${uri}: code=${err.code} msg=${err.message}`);
  }

  const nativeStat: fs.Stat | null = statDroppedPath(nativePath);
  if (nativeStat) {
    hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG,
      `resolveDroppedFile: using native path=${nativePath}`);
    return { path: nativePath, metadata: toOhosFileMetadata(nativeStat) };
  }

  const remappedPath: string = ownSandboxPathFromAppData(nativePath);
  if (remappedPath.length > 0) {
    const remappedStat: fs.Stat | null = statDroppedPath(remappedPath);
    if (remappedStat) {
      hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG,
        `resolveDroppedFile: using remapped path=${remappedPath}`);
      return { path: remappedPath, metadata: toOhosFileMetadata(remappedStat) };
    }
  }

  return stageDroppedUri(uri);
}

function tryCollectDroppedFilePaths(dragEvent: DragEvent): CollectedDropResult {
  const paths: string[] = [];
  const metadata: OhosFileMetadata[] = [];
  const seen: Set<string> = new Set<string>();
  let recordCount: number = 0;
  try {
    const data = dragEvent.getData() as unifiedDataChannel.UnifiedData;
    if (!data) {
      hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, "tryCollect: getData returned null");
      return { paths, metadata, recordCount };
    }
    const records: unifiedDataChannel.UnifiedRecord[] = data.getRecords();
    if (!records || records.length <= 0) {
      const count = records ? records.length : 0;
      hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: records null or empty, count=${count}`);
      return { paths, metadata, recordCount };
    }
    recordCount = records.length;
    hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: records count=${records.length}`);
    for (let i = 0; i < records.length; i++) {
      const types = records[i].getTypes();
      const hasFileUri = types.includes(uniformTypeDescriptor.UniformDataType.FILE_URI);
      hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: record[${i}] typesCount=${types.length} hasFileUri=${hasFileUri}`);
      if (hasFileUri) {
        const fileUriUds =
          records[i].getEntry(uniformTypeDescriptor.UniformDataType.FILE_URI) as uniformDataStruct.FileUri;
        if (fileUriUds && fileUriUds.oriUri) {
          const uri: string = fileUriUds.oriUri;
          if (seen.has(uri)) {
            hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: record[${i}] duplicate uri: ${uri}`);
            continue;
          }
          seen.add(uri);
          const resolved: ResolvedDroppedFile | null = resolveDroppedFile(uri);
          if (resolved) {
            paths.push(resolved.path);
            metadata.push(resolved.metadata);
          } else {
            hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `tryCollect: record[${i}] unresolved uri: ${uri}`);
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
  return { paths, metadata, recordCount };
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
  // Records were delivered but none resolved: staging needs the drag grant that
  // is only valid during this drop, so a later attempt cannot succeed - fail the
  // drop now instead of copying the same URI again.
  if (result.recordCount > 0) {
    hilog.warn(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, `Native file drop unresolved: recordCount=${result.recordCount}, not retrying`);
    dispatchNativeDragEvent(controller, "drop", [], []);
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
    // ArkWeb suspends its scrollbars above page content by default
    // (ScrollbarMode.OVERLAY_LAYOUT_SCROLLBAR): the thumb paints on top of
    // hovered rows, buttons, and card edges, and on a 2in1 build a mouse cannot
    // grab it, so only the wheel, a trackpad, or touch can scroll. That is a
    // host-level deviation from WebView2/WKWebView, where the desktop
    // scrollbar keeps its own column and is draggable, and no web-side CSS can
    // change it: the webkit scrollbar paint rules only apply once the engine
    // uses a non-overlay scrollbar. The resident mode keeps the scrollbar
    // inside the content area, reserves its column (so page styles such as the
    // design system's scrollbar gutter stay honest), and appears when the page
    // actually overflows. Scrollbar width, color, and idle hiding remain owned
    // by the web-side design system.
    .forceDisplayScrollBar(true)
    .visibility(data?.style?.visible === "hidden" ? Visibility.Hidden : Visibility.Visible)
    .javaScriptAccess(data?.javascriptEnable)
    // ArkWeb defaults domStorageAccess to false and wry's OHOS backend never
    // passes dom_storage_access, so without this default the main desktop
    // webview exposes window.localStorage as null. The shared storageAdapter
    // then falls back to a memory Map and every persisted zustand store
    // (input history, context store, i18n, etc.) is lost on restart. Default
    // to true so the desktop front end (loaded from the trusted built-in
    // asset protocol) keeps DOM storage, matching WebView2 / WKWebView.
    // Embedded browser webviews already pass domStorageEnable explicitly.
    .domStorageAccess(data?.domStorageEnable ?? true)
    .mediaPlayGestureAccess(
      typeof data?.autoplay === "boolean" && data.autoplay === true ? false : true,
    )
    .javaScriptOnDocumentStart(data?.initializationScripts)
    .onControllerAttached(() => {
      // BuilderNode.update() is also used for visibility and bounds changes.
      // Those style-only updates must not navigate the existing page again.
      if (data.contentLoaded) {
        return;
      }
      data.contentLoaded = true;
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
      return false;
    })
    .onPageBegin((event) => {
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
      if (classifyNativeDragData(dragEvent) === NativeDragDataKind.NonFile) {
        hilog.info(FILE_DROP_LOG_DOMAIN, FILE_DROP_LOG_TAG, "onDrop ignored non-file drag");
        dispatchNativeDragEvent(data.controller, "drop", [], []);
        return;
      }
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

    const setBounds = (x: number, y: number, width: number, height: number): boolean => {
      const node = this.webviewList.get(initData.webTag ?? "");
      if (!node) {
        return false;
      }
      if (!initData.style) {
        initData.style = {};
      }
      initData.style.x = x;
      initData.style.y = y;
      initData.style.width = width;
      initData.style.height = height;
      // ArkWeb updates its internal viewport only when the Web component's
      // declarative bounds are reapplied. FrameNode layout mutation moves the
      // outer node but leaves the page viewport at its previous size.
      node.update(initData);
      return true;
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
      setBounds,
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
