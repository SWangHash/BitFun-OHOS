---
id: procedural-qt-cef-ohos-dev-guide
type: procedural
domain: workflow
tags: [qt, cef, chromium, harmonyos, ohos, webengine, migration, webview, cmake, hap, arkweb, js-bridge, version-adaptation, component-pack]
created: 2026-08-25
updated: 2026-08-26
status: active
audience: public
refs: [semantic-qt-harmonyos-modules, semantic-qt-harmonyos-qt6-status, semantic-qt-harmonyos-window-model, semantic-qt-harmonyos-third-party-libs, semantic-qt-harmonyos-build-run-workflow, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-api-mapping, procedural-demo-generation]
summary: >
  Qt + CEF 鸿蒙开发指导（公开·自含·版本中立）：鸿蒙 Qt 无 QtWebEngine（Out of scope），CEF for OpenHarmony
  （chromium_cef）是完整 Chromium 内核的 web 嵌入平替。**不绑定特定 Qt 版本**（Qt5.12/5.15/Qt6 通用，按 §5.1 读你
  Qt OHOS SDK 头适配）。CEF 以**去版本化的组件包**提供——维护者从 chromium_cef 版本化下载剥离内核层（libcef.so+
  wrapper+include+cmake+OHOS adapter）、按版本标注、与应用/胶水解耦，放指定位置供开发者下载；集成版本中立
  （find_package(CEF)+CEF_ROOT，读组件 include/ 找该版本 API）。Part 1 版本稳定核心 + Part 2 集成实例（给定 CEF 组件包 +
  你的 Qt OHOS SDK）。WebEngine→CEF API 映射 + 迁移步骤 + §5 版本升级适配方法论。
leader_summary: >
  补齐鸿蒙 Qt 无 WebEngine 的内核级 web 方案缺口：基于华为官方开源 CEF for OpenHarmony，沉淀 Qt+CEF 鸿蒙开发指导 +
  WebEngine→CEF 迁移；**不绑定 Qt 版本 + CEF 以去版本化组件包形式分发**（剥离/下载/版本中立集成），附版本升级适配
  方法论，支撑迁移提效与开发者答复，升级不踩空。
impact: [迁移提效, 框架支撑, 商业答复, 开发者指导]
deliverables: [开发指导页, WebEngine→CEF 迁移方案, API 映射表, CEF 组件包剥离方法, 版本升级适配方法论, AI 端到端检查清单]
evidence: [chromium_cef 114 release 分支源码结构核验（libcef 41 OHOS 适配文件 + tests/cefsimple + cmake/FindCEF + include API 头）, 华为 guidebook solution6 §5 CEF for OpenHarmony]
---

# Qt + CEF 鸿蒙开发指导（公开·自含·版本中立）

> **一句话**：鸿蒙 Qt（5.12/5.15/Qt6）**没有 QtWebEngine**（Chromium，Out of scope）。需要完整 Chromium 内核 web 能力的应用，用华为官方开源的 **CEF for OpenHarmony**（`gitcode.com/openharmony-tpc/chromium_cef`）作为平替。
>
> **本页刻意不绑定特定 Qt 版本**：Qt5.12 / 5.15 / Qt6 通用，Qt OHOS QPA/Ability 启动 API、业务 .so `main` 导出契约随你的 Qt SDK 版本变，按 §5.1 读你 SDK 头找。
>
> **CEF 以去版本化的组件包形式分发**：维护者从 chromium_cef 版本化下载里**剥离**出 CEF 内核层（libcef.so + wrapper 源码 + include + cmake + OHOS adapter），按版本标注、与应用/胶水解耦，放指定位置供开发者下载。集成**版本中立**：`find_package(CEF)`+`CEF_ROOT` 指向组件包，读组件 `include/` 找该版本 API。
>
> **结构**：Part 1 版本稳定核心（§1–§5）+ Part 2 集成实例（版本中立，给定 CEF 组件包 + 你的 Qt OHOS SDK）。
>
> 版本敏感部分（node manager API、IoC 容器、子进程入口符号、Ability→Qt 启动 API、`main` 导出契约）**不硬编为通用接口**——随 Qt OHOS QPA / CEF 组件 / 胶水层版本变，按 §5 读你版本的权威源。

---

## 0. 版本中立性与稳定性地图

### 三层版本独立（互不绑定）

| 层 | 版本由谁定 | 权威源（你版本的正确 API 在这） |
|----|-----------|------|
| **CEF 组件** | 你下载/剥离的 CEF 版本（如 cef114-ohos5.1 / cef132-ohos6.0） | 你 CEF 组件包的 `include/` `cmake/` `libcef_dll/`（§2） |
| **Qt OHOS SDK** | 你用的 Qt 版本（5.12 / 5.15 / Qt6） | 你 SDK 的 `libqohos.d.ts` / `qohos*.h` / `templates/EntryAbility.ets`（§5.1） |
| **胶水层** | 你用的胶水层版本（CEF↔ArkTS↔Qt 桥，独立工程） | 胶水层仓库本身（native adapter 头 + ArkTS IoC 模块）（§5.3） |

> 三层版本**互不绑定**：CEF 组件包不绑 Qt 版本（纯 C ABI，Qt 无关）；Qt SDK 版本不绑 CEF；胶水层版本不绑前两者。升级任一层不影响另两层。

### 稳定性表

| 内容 | 稳定性 | 说明 |
|------|:------:|------|
| CEF 五层架构概念（内核/wrapper/client/Qt窗口/Ability） | ✅ 稳定 | CEF 设计，跨版本 |
| CEF `include/` 公开 API（CefClient/CefBrowser/handlers） | ✅ 稳定 | 主 API 跨版本；OHOS 扩展方法以你组件 `include/` 为准 |
| `find_package(CEF)`+`CEF_ROOT` cmake 模式 | ✅ 稳定 | 来自组件 `cmake/FindCEF.cmake` |
| CEF 独立线程 + 自带 message loop + marshal 铁律 | ✅ 稳定 | CEF 架构基线 |
| `.so` 部署 + 依赖链 + 权限 + HAP 打包 | ✅ 稳定 | OHOS 机制 |
| WebEngine→CEF API 映射 + 迁移步骤 | ✅ 稳定 | CEF API 角色 ≈ WebEngine |
| ② native node manager 的 API 名 | ⚠️ 版本敏感 | 随胶水层版本，见 §5.3 |
| ③ IoC 容器模块名 + 绑定 API + init 参数 | ⚠️ 版本敏感 | 随胶水层版本，见 §5.3 |
| ③ 子进程入口符号名 + QPA dlsym 契约 | ⚠️ 版本敏感 | 随 Qt OHOS QPA + CEF 版本，见 §5.1/§5.2 |
| ⑤ Ability→Qt 启动 API | ⚠️ 版本敏感 | 随 Qt OHOS QPA 版本，见 §5.1 |
| 业务 .so `main` 导出契约 | ⚠️ 版本敏感 | 随 Qt OHOS QPA 版本，见 §5.1 |
| OHOS adapter `.so` 名 | ⚠️ 版本敏感 | 随 CEF 组件版本，见 §5.2 |

> **原则**：⚠️ 版本敏感项，本页只给"做什么/为什么"（不变量），**不给**"具体 API 名/签名"（会过期）；以你版本的权威源（§5.4）为准。

---

# Part 1 — 版本稳定核心

## 1. 背景与定位

### 1.1 为什么需要 CEF

| 维度 | 鸿蒙 Qt 状态 | 说明 |
|------|:---:|------|
| **QtWebEngine**（Chromium 内核，QWebEngineView/QWebEnginePage） | ❌ **Out of scope** | Chromium 仅适配 Windows/Linux/macOS 桌面；鸿蒙 Qt 5.12/5.15/Qt6 均不提供。详见 [[qt-harmonyos-modules]] |
| **Qt WebView**（原生 ArkWeb 桥） | ✅ 支持 | 封装鸿蒙系统 Web 组件（ArkWeb），轻量 |
| **CEF for OpenHarmony**（完整 Chromium 嵌入） | ✅ 官方开源 | `chromium_cef`，完整 Chromium content 层，重型但能力与 WebEngine 最接近 |

依赖 `QWebEngineView` 且需完整 Chromium 内核能力（DevTools、扩展、离屏渲染、复杂 JS/Blink、cookie/download 精细控制）的应用选 **CEF**；只需轻量展示网页可先评估 [[qt-harmonyos-modules]] 中 ✅ 的 **Qt WebView**（见 §4.2）。

### 1.2 官方指导来源

| 来源 | 链接 | 性质 |
|------|------|------|
| 华为 guidebook「三方跨平台框架解决方案」§5 CEF for OpenHarmony | https://developer.huawei.com/consumer/cn/doc/guidebook/solution6-0000002601573495 | 官方，含 Chromium/CEF/Electron/Qt 多框架鸿蒙适配总览 |
| CEF for OpenHarmony 源码仓 | https://gitcode.com/openharmony-tpc/chromium_cef | 官方开源（2025-06），分支 114（HarmonyOS 5.x）/ 132（HarmonyOS 6.0） |
| 论坛「CEF框架HarmonyOS开发指导」 | https://developer.huawei.com/consumer/cn/forum/topic/0204189797656362142 | 官方技术文章（论坛页，需登录浏览） |
| Chromium for OpenHarmony 源码仓 | https://gitcode.com/openharmony-tpc/chromium_src | 官方开源，CEF 的底层 |
| CEF 上游项目 | https://bitbucket.org/chromiumembedded/cef | CEF 原始文档/Tutorial/API 文档 |

---

## 2. CEF 组件包：去版本化、剥离与获取（核心）

### 2.1 什么是 CEF 组件包

CEF 组件包 = **CEF 内核层**，去版本化、Qt/应用无关、按版本标注的可下载产物：

| 内容 | 作用 |
|------|------|
| `libcef.so` | CEF 内核（Chromium content 层），预编译，重型 |
| `libcef_dll/`（源码） | C++ 包装层（C API → `CefRefPtr<CefBrowser>` 等），随业务重编 |
| `include/` | CEF 公开 C++ API 头——**你组件版本的正确 API 在这** |
| `cmake/` | `FindCEF.cmake` + `cef_macros` + `cef_variables`（`find_package(CEF)` 模式） |
| OHOS adapter `.so` | CEF↔OHOS 适配桥（名随 CEF 组件版本，见 §5.2） |
| `tests/cefsimple`（可选） | 参考样例 |
| `kb-cef-graft.py` + `kb-cef-graft.config.example.json` | 嫁接脚本+配置：把 CEF 嫁接到 Qt OHOS 模板工程（§2.3 一键嫁接，`--run` 签名+装机+启动+崩溃检查）——**随 CEF 组件包分发，不在本知识库**（维护者从内部维护仓取，剥离进组件包时重命名为 `tools/graft_cef.py`） |

> **去版本化**的含义：版本标注在**包名/目录**（如 `cef-component-ohos-cef114/`），包内**内容是版本中性的内核层**——不混入任何 Qt/应用/胶水代码。集成方式（`find_package(CEF)`+`CEF_ROOT`）跨版本一致。开发者下载哪个版本，就用那个版本的 API（读其 `include/`）。

### 2.2 从 chromium_cef 版本化下载剥离组件包（去版本化方法）

`chromium_cef` 仓的每个分支是一个**版本化的 CEF**（114 / 132 / ...）。剥离 = 抽离内核层、按版本标注、与应用/胶水解耦：

```bash
# 1. 取版本化的 chromium_cef（你选的版本分支）
git clone https://gitcode.com/openharmony-tpc/chromium_cef.git
cd chromium_cef
git checkout <你选的版本分支>   # 如 114_trunk_5.1.0-Release / 132_trunk_6.0-Release

# 2. 物化 CMake（.in 模板 → 可用 .cmake，需 CEF 上游工具链）
bash cef_create_projects.sh

# 3. 剥离组件包到独立目录（版本标注在目录名）
VER=<版本标注，如 cef114-ohos5.1 或 cef132-ohos6.0>
PKG=cef-component-ohos-$VER
mkdir -p $PKG/libs/arm64-v8a
cp -r include cmake libcef_dll $PKG/                         # API + cmake + wrapper 源码（Qt 无关）
cp -r tests/cefsimple $PKG/                                   # 参考样例（可选）
# 预编译内核（从构建产物或预编译 binary distribution 取）：
cp <libcef.so + OHOS adapter .so + 依赖 .so（icu/freetype/fontconfig/expat/brotli/jpeg/png）> $PKG/libs/arm64-v8a/
# 4. 附带嫁接工具（kb-cef-graft.py，随组件包分发；维护者从 KB 仓 _scripts/ 取）
mkdir -p $PKG/tools
cp <KB 仓>/_scripts/kb-cef-graft.py $PKG/tools/graft_cef.py
# → $PKG/ 即"去版本化的 CEF 组件包"：版本标注在目录名，内容是版本中性的内核层 + 自带嫁接工具
```

> **去版本化要点**：
> - **只抽内核层**（libcef.so + wrapper 源码 + include + cmake + OHOS adapter）——这些 Qt/应用无关、纯 C ABI + CEF API。
> - **不混入 Qt/应用/胶水代码**（node manager、CefClient 业务实现、ArkTS IoC 都不在组件包里，由开发者按 §B/§5.3 实现）。
> - **版本标注在包名**（`cef-component-ohos-<ver>/`），不在内容里硬编版本。
> - **依赖链一起带**（libcef.so 的 DT_NEEDED：icu/freetype/fontconfig/expat/brotli/jpeg/png），用 `llvm-readelf -d libcef.so` 核全。
>
> 维护者把 `$PKG/` 打包放到指定下载位置（§2.3 方式 A）。全量从源码构建 CEF（gclient fetch Chromium，多 GB）只在无预编译 binary 时才走，见 CEF 上游 `BranchesAndBuilding` wiki。

### 2.3 获取 CEF 组件包

- **方式 A（推荐，维护者分发）**：从维护者指定位置下载 `cef-component-ohos-<ver>/` → 解压 → `CEF_ROOT` 指向它。
  - 下载地址：`<维护者提供的 CEF 组件包下载地址（发布前填入）>`
  - **一键嫁接**：用嫁接脚本把 CEF 嫁接到你的 Qt OHOS 模板工程（正确姿势：基于模板嫁接，不在 CEF demo 上改）。脚本在**外部知识库 `tools/kb-cef-graft.py`**（CEF 组件包剥离时重命名为 `tools/graft_cef.py`）+ 配置 `tools/kb-cef-graft.config.example.json`：
    ```bash
    # 1. 复制配置改值（deveco/device/qt_libs 等，看 _comment）
    cp tools/kb-cef-graft.config.example.json .config.json  # 改里面的值
    # 2. 一条命令：graft+签名+装机+启动+崩溃检查（--ohqtcef-glue 全量 overlay 跑通）
    python tools/kb-cef-graft.py --config .config.json \
      --template <Qt OHOS 模板工程> --qt-sdk <Qt OHOS SDK> \
      --ohqtcef-glue <OpenQtCef 胶水> --output <输出工程> --run
    ```
    （`--run` 自动 devecocli signature generate + run + log --crash；详见脚本 `--help` + §B/§5；环境配置全在 `.config.json`，换环境只改配置不改脚本）
- **方式 B（自行剥离）**：按 §2.2 从 `chromium_cef` 你选的版本剥离。

> 无论哪种，集成方式一样：`find_package(CEF)` + `CEF_ROOT` 指向组件包；读 `CEF_ROOT/include/` 找该版本 API（§5.2）。

### 2.4 版本中立集成

- `CEF_ROOT` 指向你的 CEF 组件包（任何版本）；`find_package(CEF)` 载入其 `cmake/`。
- 业务 .so 链 `${CEF_ROOT}/libs/arm64-v8a/libcef.so` + `libcef_dll_wrapper`（重编）+ OHOS adapter。
- 你 CEF 版本的 API：读 `${CEF_ROOT}/include/`（§5.2）。
- OHOS 扩展方法（`NotifyJavaScriptResult`/`OnScaleChanged`/`PutAcceptCookieEnabled` 等）以你组件 `include/` 为准。

---

## 3. CEF-for-OHOS 内核架构（版本稳定）

### 3.1 CEF 内核层（纯 C ABI / Qt 无关）

见 §2.1 组件包内容。`libcef` 内的 `*_ohos.cc`（browser/net/ssl/safe_browsing/printing/cookie/applink 的 OHOS 实现）已编进 `libcef.so`，无需关心。

> **OHOS 专属扩展**（114 release 源码核验；**跨 CEF 版本可能变/增/删，以你组件 `include/` 为准**，见 §5.2）：
> - `CefClient` 内置 **JS 对象绑定**：`NotifyJavaScriptResult` / `HasJavaScriptObjectMethods` / `GetJavaScriptObjectMethods` / `RemoveTransientJavaScriptObject`（QWebChannel/`registerJavaScriptObject` 等价物）。
> - `CefCookieManager` cookie 策略控制：`IsAcceptCookieAllowed`/`PutAcceptCookieEnabled`、`IsThirdPartyCookieAllowed`/`PutAcceptThirdPartyCookieEnabled` 等。
> - `CefDisplayHandler` OHOS 专属：`OnScaleChanged`/`OnScaleInited`/`OnContentsBrowserZoomChange`。
> - `CefLoadHandler` OHOS 专属：`OnPageVisible`/`OnRefreshAccessedHistory`/`OnFirstContentfulPaint`/`OnNavigationEntryCommitted` 等。

### 3.2 CEF 公开 API（`include/`，跨版本稳定的主 API）

核心对象：`CefApp`（进程级，`cef_app.h`）、`CefClient`（**客户端聚合器**，返回各 handler，≈ `QWebEnginePage`，`cef_client.h`）、`CefBrowser`/`CefBrowserHost`（`CreateBrowser`/`LoadURL`/`ExecuteJavaScript`/`ShowDevTools`，≈ `QWebEngineView`+page）、`CefFrame`（`ExecuteJavaScript` 在 frame 上）、各 handler（≈ QWebEnginePage 信号）。

`CefClient` 聚合的 handler（`cef_client.h`）：`GetDisplayHandler`/`GetLifeSpanHandler`/`GetLoadHandler`/`GetRequestHandler`/`GetDownloadHandler`/`GetContextMenuHandler`/`GetFocusHandler`/`GetJSDialogHandler`/`GetKeyboardHandler`/`GetDragHandler`/`GetFindHandler`/`GetPermissionHandler`/`GetPrintHandler`/`GetRenderHandler`/`GetAudioHandler`/`GetMediaHandler`/`GetFormHandler`/`GetFrameHandler` + `OnProcessMessageReceived`（IPC）+ JS 对象绑定方法。

### 3.3 cefsimple 学习样例（组件包内 `tests/cefsimple`）

最小可学的 CEF 客户端（`simple_handler.h` 源码核验）：

```cpp
// 一个类同时实现 CefClient + 多 handler（典型写法）
class SimpleHandler : public CefClient,
                      public CefDisplayHandler, public CefLifeSpanHandler, public CefLoadHandler {
  CefRefPtr<CefDisplayHandler>  GetDisplayHandler() override  { return this; }
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler>     GetLoadHandler() override      { return this; }
  void OnTitleChange(CefRefPtr<CefBrowser>, const CefString&) override;
  void OnAfterCreated(CefRefPtr<CefBrowser>) override;
  bool DoClose(CefRefPtr<CefBrowser>) override;
  void OnBeforeClose(CefRefPtr<CefBrowser>) override;
  void OnLoadError(...) override;
};
```

> **关键**：`SimpleHandler` 注释「Only accessed on the CEF UI thread」——**CEF 回调全在 CEF 自己的 UI 子线程**，不在 Qt 主线程。这是 Qt 集成最大的注意点（§4 marshal、§D 踩坑）。
>
> `simple_app.cc` 用 CEF **Views 框架**（`CefWindow`/`CefBrowserView`）做窗口化渲染——桌面玩法。**OHOS 不走 Views**（无传统窗口 reparent，见 [[qt-harmonyos-window-model]]），改用 XComponent surface + native node manager（§B）。cefsimple 的 `CefClient`/handler 写法可复用，窗口部分换。

### 3.4 CMake 集成（`cmake/FindCEF.cmake`，跨版本稳定模式）

入口 `find_package(CEF REQUIRED)`：需 CEF 组件包（物化的 `cmake/*.cmake` + `CMakeLists.txt` + `libcef_dll/CMakeLists.txt` + 预编译 `libcef.so`）。`FindCEF.cmake` 要 `CEF_ROOT`（CMake/环境变量）指向组件包根；`ADD_LOGICAL_TARGET("libcef_lib" ...)` 注册 libcef，`add_subdirectory(libcef_dll)` 编 wrapper，业务 target 链 `libcef_dll_wrapper`+`libcef_lib`+`libcef.so`。要求 CMake ≥ 3.19。

### 3.5 关键机制：CEF 独立线程 + 自带 message loop

CEF 初始化开自己的子线程跑 `CefRunMessageLoop`（自带消息循环），**与 Qt 主线程 `QEventLoop` 完全分离，不做事件循环集成**。Qt↔CEF 用 CEF `PostTask` 跨线程派发 + 回调。这是架构基线，决定 §4 marshal 与 §D 踩坑。

---

## 4. WebEngine → Qt+CEF 迁移方案（版本稳定）

### 4.1 为什么迁

`QWebEngineView`/`QWebEnginePage` 在鸿蒙 Qt 上**不可用**（Out of scope，[[qt-harmonyos-modules]]）。CEF 提供完整 Chromium content 层，API 角色与 WebEngine 高度对应，是最小改造量的平替。

### 4.2 先评估：能否用 Qt WebView 替代

| 场景 | 选 |
|------|----|
| 只展示网页、基本导航、简单 JS 交互 | **Qt WebView**（原生 ArkWeb 桥，[[qt-harmonyos-modules]] ✅，轻量） |
| 需要 DevTools、扩展、离屏渲染、特定 Blink 行为、精细 cookie/download/权限、复杂 JS 注入对象 | **CEF**（完整 Chromium） |
| 代码重度依赖 `QWebEnginePage` 的 handler/信号模型 | **CEF**（handler 模型一一对应） |

### 4.3 API 映射表（QWebEngine* → CEF）

> CEF 回调签名来自 `chromium_cef/include/*.h`（114 release）源码核验；**主 API 跨版本稳定**，OHOS 扩展方法以你组件 `include/` 为准（§5.2）。

**视图与浏览器实例**

| QtWebEngine | CEF | 说明 |
|-------------|-----|------|
| `QWebEngineView`（构造/`setPage`） | `CefBrowserHost::CreateBrowser` / `CreateBrowserSync` | 在 `CefWindowInfo`/client 上创建 browser；OHOS windowInfo 由 node manager 提供 surface |
| `view->page()` | `CefClient` | client 是 handler 聚合器，≈ page |
| `setUrl` / `page->load(url)` | `browser->GetMainFrame()->LoadURL(url)` | 在 mainFrame 上加载 |
| `setHtml` / `setContent` | `frame->LoadString(html, url)` | |
| `back/forward/stop` | `browser->GoBack/GoForward/StopLoading` | |
| `reload` | `browser->Reload` | |
| `runJavaScript(code)` | `frame->ExecuteJavaScript(code, url, callback)` | CEF 可带回调拿返回值；在 CEF UI 线程回调，须 marshal |
| `setDevToolsPage` / `inspect` | `browser->GetHost()->ShowDevTools(...)` | DevTools |

**信号 → handler 回调（`CefClient` 聚合）**

| QWebEnginePage 信号 | CEF handler 方法 | 头 |
|---------------------|------------------|----|
| `urlChanged(url)` | `CefDisplayHandler::OnAddressChange(browser, frame, url)` | `cef_display_handler.h` |
| `titleChanged(title)` | `CefDisplayHandler::OnTitleChange(browser, title)` | 同 |
| `iconUrlChanged`/`iconChanged` | `CefDisplayHandler::OnFaviconURLChange(browser, icon_urls)` | 同 |
| `linkHovered(text)` | `CefDisplayHandler::OnStatusMessage(browser, value)` | 同 |
| `consoleMessage` | `CefDisplayHandler::OnConsoleMessage(...)` | 同 |
| `loadProgress(p)` | `CefDisplayHandler::OnLoadingProgressChange(browser, p)` | 同 |
| `loadStarted` | `CefLoadHandler::OnLoadStart` 或 `OnLoadingStateChange(isLoading=true)` | `cef_load_handler.h` |
| `loadFinished(ok)` | `CefLoadHandler::OnLoadEnd` / `OnLoadingStateChange(isLoading=false)` | 同 |
| `loadFailed` | `CefLoadHandler::OnLoadError(browser, frame, errorCode, errorText, failedUrl)` | 同 |
| `createWindow(type)` | `CefLifeSpanHandler::OnBeforePopup(...)`（返回 false 让 CEF 创建） | `cef_life_span_handler.h` |
| （关闭） | `CefLifeSpanHandler::DoClose` / `OnBeforeClose` | 同 |
| `pdfPrintingFinished` | `CefPrintHandler`（libcef 有 `ohos_print_manager`） | `cef_print_handler.h` |
| `featurePermissionRequested` | `CefPermissionHandler` / `CefPermissionRequest` | `cef_permission_handler.h` |

**Cookie / Download / JS bridge**

| QtWebEngine | CEF | 头 / OHOS 扩展 |
|-------------|-----|----|
| `QWebEngineProfile::cookieStore()` / `setCookie/getCookie/deleteCookie` | `CefCookieManager`（`VisitAllCookies`/`VisitUrlCookies`/`SetCookie`/`DeleteCookies`/`FlushStore`） | `cef_cookie.h`；OHOS 扩展 `PutAcceptCookieEnabled`/`PutAcceptThirdPartyCookieEnabled` |
| `downloadRequested` | `CefDownloadHandler::OnBeforeDownload`/`OnDownloadUpdated` + `CefBeforeDownloadCallback::Continue(path)` | `cef_download_handler.h` |
| `QWebChannel`/`registerObject`（C++↔JS 对象） | **CEF `CefClient` 内置 JS 对象绑定**（`NotifyJavaScriptResult`/`HasJavaScriptObjectMethods`/`GetJavaScriptObjectMethods`/`RemoveTransientJavaScriptObject`） + `OnProcessMessageReceived`（IPC）/ CEF `MessageRouter` | `cef_client.h` |
| `QWebEngineUrlRequestInterceptor` | `CefRequestHandler::GetResourceRequestHandler` | `cef_request_handler.h` |

> **偏移铁律（关键，跨版本稳定）**：
> 1. **线程**：CEF 回调全在 **CEF UI 子线程**。凡回调里碰 Qt 对象（`QWidget`/信号/`QObject`），必须 marshal 回 Qt 主线程——CEF `CefPostTask` 投递到 CEF 线程，`QMetaObject::invokeMethod(obj, ..., Qt::QueuedConnection)` 从 CEF 线程回 Qt 主线程。**绝不在 CEF 回调里直接操作 Qt 对象**。
> 2. **事件循环**：CEF 自带 `CefRunMessageLoop`（独立子线程），**不与 Qt `QEventLoop` 集成**。
> 3. **子进程**：CEF 子进程要你导出业务 .so 的子进程入口（§B），`browser_subprocess_path` 指业务 .so——**确切符号名+QPA dlsym 契约随版本，见 §5.1/§5.2**。
> 4. **窗口嵌入**：`QWebEngineView` 是直接显示的 QWidget；CEF 的 browser surface 要经 node manager 挂到 ArkUI 节点树（§B），不是直接 reparent。

### 4.4 迁移步骤清单（AI 可执行）

1. **扫描 WebEngine 用法**：`grep -rnE 'QWebEngine(View|Page|Profile|CookieStore|UrlRequest|DownloadRequest|Settings|Script)' <src>`。
2. **按 §4.3 映射表替换类**：`QWebEngineView`→`CefBrowser`、`QWebEnginePage`→`CefClient` 子类。
3. **实现 `CefClient` + handler**：照组件包内 `tests/cefsimple/simple_handler.{h,cc}` 多继承模式，把信号 slot 改写成 handler 回调。
4. **线程 marshal**：每个碰 Qt 对象的回调加 `QMetaObject::invokeMethod(..., Qt::QueuedConnection)` 回 Qt 主线程；Qt→CEF 用 `CefPostTask`。
5. **移植 JS bridge**：`QWebChannel`/`registerObject` → CEF `CefClient` JS 对象绑定或 `MessageRouter`。
6. **cookie/download/权限**：`QWebEngineProfile`/`cookieStore`/`downloadRequested` → `CefCookieManager`/`CefDownloadHandler`/`CefPermissionHandler`。
7. **CMake 改造**：`find_package(Qt<ver> WebEngineWidgets)` → `find_package(CEF)` + 链 libcef.so/wrapper/adapter（§C）。
8. **部署 .so + 权限 + 打 HAP**（§C）。
9. **验证**：页面加载（`LoadURL`）/ JS 执行（`ExecuteJavaScript`）/ 导航/ 弹窗（`OnBeforePopup`）/ cookie/ 下载/ DevTools/ 线程 marshal 无崩溃。

---

## 5. 版本升级适配（核心方法论——升级后照此找正确 API）

> 版本敏感部分（§0 表 ⚠️ 项）随 Qt OHOS QPA / CEF 组件 / 胶水层版本变。升级后不照抄 §B/§C 的 API 名——按本节重读权威源，找你版本的正确 API。

### 5.1 Qt OHOS SDK（不绑定版本：Qt5.12 / 5.15 / Qt6 通用）

Qt OHOS SDK 版本变化后，重读你 SDK 的 QPA 头/模板找以下契约：

| 适配项 | 去哪找（你 SDK） | 变体提示 |
|--------|------|------|
| Ability→Qt 启动 API | SDK `templates/EntryAbility.ets` + `libqohos.d.ts`/`qohos*.h` 里"Ability 怎么调起 Qt"的入口 | Qt5：`qpa.startQtApplication(this)` 之类；Qt6：`harmonydeployqt6` 生成 `QAbility` + `libqohos.so` `handleAbilityOn*` |
| 业务 .so `main` 导出契约 | QPA 源码/头里 `dlsym("main")` 的约定 + 业务 .so 怎么导出 main GLOBAL DEFAULT | Qt5：`add_library(SHARED)` + `__attribute__((visibility("default")))` 手写；Qt6：`qt_add_executable` 自动 |
| 子进程加载契约 | QPA 的 subprocess 加载约定（dlsym 哪个符号） | 见 §5.2 CEF 侧 + QPA 侧合看 |

> ⚠️ **已知 QPA 版本断裂**：`modulesFactories`（5.12 模板）vs `modules`（5.15 `libqohos.so`）API 契约不符致 launch 崩（5.12 模板配 5.15 libqohos 会崩 "object has no property named 'modules'"）。升级/混用 SDK 后核验此契约（读你 SDK 的 `libqohos.d.ts` 与 `templates` 是否一致）。

### 5.2 CEF 组件（你下载/剥离的版本）

切换 CEF 组件包版本（cef114 ↔ cef132 等）后，读你 `CEF_ROOT` 的组件包：

| 适配项 | 去哪找（你 CEF 组件） |
|--------|------|
| API 变更/新增/删除 | `$CEF_ROOT/include/` 全扫（`cef_client.h`/`cef_browser.h`/`cef_display_handler.h`/`cef_load_handler.h`/`cef_cookie.h`/`cef_download_handler.h`...），对照 §4.3 映射表 |
| OHOS 扩展方法 | grep `$CEF_ROOT/include/` 的 `*_ohos.*` 或 OHOS 命名方法（`NotifyJavaScriptResult`/`OnScaleChanged`/`PutAcceptCookieEnabled` 等）——版本间可能增减 |
| `browser_subprocess_path` 机制 + 子进程入口 | `$CEF_ROOT/tests/cefsimple` + `libcef` 的子进程加载约定 |
| OHOS adapter `.so` 名 | `$CEF_ROOT/libs/arm64-v8a/` 里 CEF↔OHOS 适配桥的 .so 名 |

> 原则：你下载/剥离的 CEF 组件包即你 CEF 版本的真相。§3.2/§4.3 的 API 名是 cef114 基线快照，**以你 `$CEF_ROOT/include/` 为准**。

### 5.3 胶水层（native node manager + ArkTS IoC）

胶水层（CEF↔ArkTS↔Qt 桥，独立工程，不在 CEF 组件包也不在 Qt SDK）升级后，重读胶水层仓库本身：

| 适配项 | 去哪找（你胶水层版本） |
|--------|------|
| ② native node manager API（move/resize/focus/remove 类） | 胶水层 native adapter 头（`.h`） |
| ③ IoC 容器模块 + 绑定 API + init 参数 | 胶水层 ArkTS IoC 模块 |
| ArkTS 协作层（napi 桥、JS bindings） | 胶水层 ArkTS 模块 |

> 原则：胶水层是独立工程，其 API 名/签名/模块名随它自己的版本走。**永远以胶水层仓库的头/源为准**，本页 §B 只给"做什么/为什么"。

### 5.4 权威源清单（你版本的正确 API 在这）

| 侧 | 权威源 | 怎么用 |
|----|--------|--------|
| CEF | 你下载/剥离的 CEF 组件包（`$CEF_ROOT`：`include/` `cmake/` `libcef_dll/` `tests/cefsimple`） | `grep`/读头 |
| Qt OHOS QPA | 你 Qt OHOS SDK（`libqohos.d.ts` / `qohos*.h` / `templates/EntryAbility.ets`） | `grep`/读头 |
| 胶水层 | 胶水层仓库本身（native adapter 头 + ArkTS IoC 模块） | 读该仓库 |
| OHOS 平台 | OHOS NDK + [[qt-harmonyos-platform-limits]] / [[qt-harmonyos-window-model]] | 平台机制稳定 |

> **一句话**：本页所有 API 名都是 cef114 基线快照。版本敏感项（§0 表 ⚠️）**永远以你版本的权威源为准**；本页给的是"做什么/为什么/去哪找"，不是"抄这个符号名"。

---

# Part 2 — 集成实例（版本中立，给定 CEF 组件包 + 你的 Qt OHOS SDK）

## A. 前提（不绑定版本）

- 你有一个 **CEF 组件包**（§2 获取，任意版本）在 `CEF_ROOT`。
- 你有你的 **Qt OHOS SDK**（Qt5.12 / 5.15 / Qt6 任意）在 `QT_SDK`。
- 胶水层按 §5.3（你版本）。

## B. 五层胶水集成（版本中立，版本敏感处指向 §5）

把 CEF 嵌进 Qt 鸿蒙 HAP 的五层。① ② ③ 与 Qt 无关（CEF 内核/native/客户端层），④⑤ 才是 Qt 集成面。

| 层 | 组成 | 依赖 Qt? | 处置 |
|----|------|:------:|------|
| **① CEF 内核层** | libcef.so + libcef_dll_wrapper + OHOS adapter .so + 依赖 .so | ❌ 纯 C ABI | 复用 CEF 组件包预编译产物，不重编（§2.1） |
| **② native ArkUI node manager** | 一个 native adapter，在统一 ArkUI 节点树里组织 Qt 与 CEF 的 XComponent surface 节点父子/z-order/焦点 | ❌ 纯 OHOS NDK | 自行实现（模式见下） |
| **③ CEF 客户端层** | `CefClient` + 各 handler 子类 + 业务 .so 导出 CEF 子进程入口 | ❌ 纯 CEF API | 自行实现（照 §3.3 cefsimple） |
| **④ Qt 业务窗口层** | `QMainWindow`/`QWidget`，resize/focus/close 事件转发给 CEF 节点 | ✅ 基础 Qt | 几乎零改动（Qt6 兼容见 §5.1） |
| **⑤ ArkTS Ability/启动层** | `UIAbility` 启动 Qt + IoC 容器初始化绑定 CEF adapter 服务 | ✅ Qt 启动耦合 | 主要改造点 |

### B.1 ② native ArkUI node manager（核心模式）

鸿蒙没有传统 `SetParent` reparent（靠 ArkUI 节点树组织 surface）。写一个 native adapter（OHOS NDK）：

- **不变量（跨版本稳定）**：在统一 ArkUI 节点树里为 Qt 与 CEF 各自的 XComponent surface 节点建立父子/z-order/焦点归属（用标记区分节点属主，如 "QT"/"CEF"）；暴露 move/resize/focus/remove 类操作给 Qt 窗口层；Qt 的 `QMainWindow` 在 `resizeEvent`/`focusInEvent`/`closeEvent` 里调这些操作同步给 CEF 节点。
- **`[版本敏感]`**：node manager 的方法名/签名随胶水层版本。**你版本的确切方法名：读你胶水层 native adapter 头（§5.3）**，不照抄本页任何具体名。

> 背景：OHOS 渲染走 XComponent + ArkUI 节点树，详见 [[qt-harmonyos-window-model]]。Qt 鸿蒙 QPA 本身也基于 XComponent，故 Qt 与 CEF 的 surface 可在同一节点树被组织。

### B.2 ③ CEF 客户端层 + 子进程入口

- 实现自己的 `CefClient` 子类（聚合需要的 handler，照 §3.3 `SimpleHandler` 多继承写法）。
- **不变量**：CEF spawn 子进程（render/GPU 等）；桌面版在 subprocess main 调 `CefExecuteProcess`。OHOS HAP 子进程加载方式不同——`settings.browser_subprocess_path` 指向你的业务 .so，由 OHOS 加载器 dlsym 该 .so 导出的子进程入口符号，入口里调 `CefExecuteProcess`。
- **`[版本敏感]`**：业务 .so 导出的子进程入口符号名 + QPA dlsym 契约随 Qt OHOS QPA + CEF 版本。**读你 Qt OHOS QPA 的子进程加载约定 + 你 CEF 组件的 `browser_subprocess_path` 机制（§5.1/§5.2）**，不照抄。
- **CEF 独立线程**：`CefInitialize` + `CefRunMessageLoop` 跑在子线程（detach），与 Qt 主线程 event loop 分离（§3.5，稳定）。

### B.3 ⑤ ArkTS Ability + IoC 初始化

- **不变量**：`UIAbility` 启动 Qt 应用；CEF 的 ArkTS 协作层（adapter napi 桥、JS bindings 等）用一个 IoC 容器在 Ability 启动早期绑定 CEF adapter 所需服务，否则客户端层在 `onCreate` 取这些服务会「无绑定」崩溃；同时调 node manager 的初始化函数。
- **`[版本敏感]`**：IoC 容器模块名+绑定 API+init 参数随胶水层版本；Ability→Qt 启动 API 随 Qt OHOS QPA 版本。**前者读胶水层 ArkTS IoC 模块（§5.3）；后者读 Qt OHOS SDK（§5.1，Qt5 `qpa.startQtApplication` / Qt6 `harmonydeployqt6`+`QAbility`）**。

> §B 的逐字实现属具体工程版本细节，**以你版本权威源（§5.4）为准**；本页止于不变量 + "去哪找"。

## C. 构建流程（版本中立；Qt5/Qt6 CMake 变体作示例，非绑定）

> 路径用 ENV 变量占位（真实值在本地 `ENV.local.md`）：CEF 组件包 `CEF_ROOT`、Qt OHOS SDK `QT_SDK`（Qt5.12/5.15/Qt6 任意）、OHOS NDK `${OHOS_SDK_NATIVE}`、DevEco `${DEVECO_PATH}`。

### C.1 环境

```bash
export DEVECO_PATH=<DevEco>
export OHOS_SDK_NATIVE=$DEVECO_PATH/sdk/default/openharmony/native
export CEF_ROOT=<你的 CEF 组件包路径>          # §2 获取，任意版本
export QT_SDK=<你的 Qt OHOS SDK>                # Qt5.12/5.15/Qt6 任意
export PATH="$DEVECO_PATH/jbr/bin:$DEVECO_PATH/tools/node/bin:$DEVECO_PATH/tools/hvigor/bin:$DEVECO_PATH/tools/ohpm/bin:$PATH"
HDC=$OHOS_SDK_NATIVE/../toolchains/hdc.exe
```

### C.2 业务 CMake（Qt5 / Qt6 两个变体示例——选你用的，非绑定）

```cmake
cmake_minimum_required(VERSION 3.19)          # CEF 要求 ≥3.19
project(QtCefOhosDemo)
set(CMAKE_AUTOMOC ON); set(CMAKE_AUTOUIC ON); set(CMAKE_AUTORCC ON)

# --- CEF 组件包（跨版本稳定模式）---
set(CEF_ROOT "$ENV{CEF_ROOT}" CACHE PATH "")
set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} "${CEF_ROOT}/cmake")
find_package(CEF REQUIRED)
add_subdirectory(${CEF_ROOT}/libcef_dll libcef_dll_wrapper)   # 编 libcef_dll_wrapper（Qt 无关）

# --- OHOS 系统库 ---
find_library(native-window-lib native_window)
find_library(hilog-lib hilog_ndk.z)
find_library(ace-napi-lib ace_napi.z)
find_library(ace-ndk-lib ace_ndk.z)

# --- ② native node manager（§B.1，Qt 无关）---
add_library(node_adapter SHARED node_adapter.cpp)
target_link_libraries(node_adapter PUBLIC ${hilog-lib} ${ace-napi-lib} ${ace-ndk-lib})

# --- 业务 .so：Qt5 / Qt6 二选一（你用的版本），非绑定 ---
# ▶ Qt5 变体：
#   find_package(Qt5 REQUIRED COMPONENTS Core Widgets)
#   add_library(qtmodule SHARED main.cpp mainwindow/mainwindow.cpp
#       cefclient/my_client.cpp cefclient/my_display_handler.cpp
#       cefclient/my_lifespan_handler.cpp cefclient/my_load_handler.cpp)
#   # [版本敏感] Qt5 OHOS QPA: 手写 main + 子进程入口 __attribute__((visibility("default"))) 供 QPA dlsym（§5.1）
# ▶ Qt6 变体：
#   find_package(Qt6 REQUIRED COMPONENTS Core Widgets)
#   qt_add_executable(qtmodule main.cpp mainwindow/mainwindow.cpp
#       cefclient/my_client.cpp cefclient/my_display_handler.cpp
#       cefclient/my_lifespan_handler.cpp cefclient/my_load_handler.cpp)
#   # Qt6: qt_add_executable 自动 MODULE .so + main GLOBAL DEFAULT + 生成 deployment json + bundle Qt6 ets（§5.1）

target_link_libraries(qtmodule PRIVATE
    Qt::Core Qt::Widgets
    node_adapter
    ${CEF_ROOT}/libs/arm64-v8a/libcef.so          # 复用组件包预编译（纯 C ABI）
    libcef_dll_wrapper                             # 重编（Qt 无关）
    ${CEF_ROOT}/libs/arm64-v8a/<OHOS adapter .so> # [版本敏感] 名随 CEF 组件版本，见 §5.2
    ${native-window-lib} ${hilog-lib} ${ace-napi-lib} ${ace-ndk-lib})
```

> `[版本敏感]`：Qt5 `add_library`+手写 main/子进程入口 vs Qt6 `qt_add_executable`（自动 main + `harmonydeployqt6` 生成 Qt6 模板 `QAbility`+`libqohos.so`）——**你 Qt 版本的具体契约见 §5.1**（[[qt-harmonyos-qt6-status]] 详述 Qt6 差异）。CEF 内核层（libcef.so/wrapper/adapter）Qt 无关，跨 Qt 版本复用。

### C.3 编译 + 部署 CEF .so + 权限 + 打 HAP（跨版本稳定机制）

```bash
# 编译业务 .so
mkdir build && cd build && cmake -G Ninja \
  -DCMAKE_TOOLCHAIN_FILE=$OHOS_SDK_NATIVE/build/cmake/ohos.toolchain.cmake \
  -DOHOS_ARCH=arm64-v8a -DCMAKE_PREFIX_PATH=$QT_SDK -DCEF_ROOT=$CEF_ROOT ../ && cmake --build . -j8

# 部署 CEF .so 到 HAP（hvigorw 只收 entry/libs/<abi>/ + Qt 库，不收 CMake 直接链接的绝对路径 .so，须手动复制）
cp "$CEF_ROOT"/libs/arm64-v8a/libcef.so "$CEF_ROOT"/libs/arm64-v8a/<OHOS adapter .so> entry/libs/arm64-v8a/  # [版本敏感] adapter 名见 §5.2
# ★ CEF 依赖链一起部署（libcef.so 的 DT_NEEDED）：
cp "$CEF_ROOT"/libs/arm64-v8a/libicudata.so "$CEF_ROOT"/libs/arm64-v8a/libicui18n.so "$CEF_ROOT"/libs/arm64-v8a/libicuuc.so entry/libs/arm64-v8a/
cp "$CEF_ROOT"/libs/arm64-v8a/libfreetype.so "$CEF_ROOT"/libs/arm64-v8a/libfontconfig.so "$CEF_ROOT"/libs/arm64-v8a/libexpat.so entry/libs/arm64-v8a/
cp "$CEF_ROOT"/libs/arm64-v8a/libbrotlicommon.so "$CEF_ROOT"/libs/arm64-v8a/libbrotlidec.so "$CEF_ROOT"/libs/arm64-v8a/libbrotlienc.so entry/libs/arm64-v8a/
cp "$CEF_ROOT"/libs/arm64-v8a/libjpeg.so "$CEF_ROOT"/libs/arm64-v8a/libpng.so entry/libs/arm64-v8a/
cp build/libqtmodule.so build/libnode_adapter.so entry/libs/arm64-v8a/
# 用 llvm-readelf -d 核验所有 .so 的 NEEDED 全是裸名（无 Windows 绝对路径前缀）

# ArkTS Ability + IoC 初始化（§B.3，版本敏感 API 见 §5.1/§5.3）+ CEF 权限：
# entry/src/main/module.json5 的 requestPermissions 加 INTERNET/GET_NETWORK_INFO + user_grant 配 reason+usedScene
#   （LOCATION/CAMERA/MICROPHONE 必须配 reason+usedScene，否则 00303218 报错，见 [[qt-harmonyos-platform-limits]]）

# 打 HAP + 安装启动
hvigorw assembleHap --mode module -p product=default --no-daemon
"$HDC" install -r entry/build/default/outputs/default/entry-default-signed.hap
"$HDC" shell "aa start -b <bundleName> -a EntryAbility"
"$HDC" shell "hilog 2>/dev/null | grep -iE 'cef|libcef|chromium|inject|qtmodule'"
```

> libcef.so 重型（~160MB+），HAP 体积大（~250MB+）。重型 .so 部署与 DT_NEEDED 依赖链处理见 [[qt-harmonyos-third-party-libs]]。DevEco/hvigorw 全流程见 [[qt-harmonyos-build-run-workflow]]。

## D. 踩坑清单（标注稳定/版本敏感）

| # | 坑 | 现象 | 修复 | 性质 |
|---|----|------|------|:----:|
| 1 | CEF .so 未打进 HAP | 运行时 `dlopen(libcef.so) failed` | 手动复制 libcef.so + 依赖到 `entry/libs/arm64-v8a/`（§C.3） | 稳定 |
| 2 | CEF 依赖链缺失 | `dlopen(libcef.so) → libicui18n/libfreetype/... not found` | 依赖（icu/freetype/fontconfig/expat/brotli/jpeg/png）一起部署；`llvm-readelf -d` 查全 | 稳定 |
| 3 | `find_package(CEF)` 失败 | `Must specify a CEF_ROOT value` | `CEF_ROOT` 在 `find_package(CEF)` 之前设（§3.4/§C.2） | 稳定 |
| 4 | CEF 回调里直接碰 Qt 对象 | 偶发崩溃/数据竞争 | marshal 回 Qt 主线程：`QMetaObject::invokeMethod(..., Qt::QueuedConnection)`（§4.3 偏移 1） | 稳定 |
| 5 | 用 QEventLoop 驱 CEF | 死锁/不工作 | CEF 自带 `CefRunMessageLoop`（独立子线程），不与 Qt event loop 集成（§3.5） | 稳定 |
| 6 | user_grant 权限缺 reason | `00303218 reason and usedScene mandatory` | LOCATION/CAMERA/MICROPHONE 配 `reason`+`usedScene`（[[qt-harmonyos-platform-limits]]） | 稳定 |
| 7 | `browser_subprocess_path` 不匹配 | CEF 子进程加载失败 | 指向业务 .so + 导出子进程入口（§B.2）；**符号名+契约随版本，见 §5.1/§5.2** | 版本敏感 |
| 8 | QPA 契约不符致 launch 崩 | `object has no property named 'modules'` 等 | SDK 模板与 libqohos.so 契约对齐（`modulesFactories` vs `modules`，见 §5.1） | 版本敏感 |
| 9 | QPA 残留（混用旧 ets/跨版本 QPA） | `Error loading libQt5Gui.so (needed by libplugins_platforms_qopenharmony.so)` | 用正确版本 Qt OHOS QPA 启动；部署 CEF 库勿误拷跨版本 QPA | 版本敏感 |

## E. AI 可执行端到端检查清单

> AI 据本页跑通 Qt+CEF 鸿蒙集成全流程（不绑定 Qt/CEF 版本；先按 §5 找你版本的正确 API）：

- [ ] **取 CEF 组件包**：从维护者指定位置下载（§2.3 方式 A）或按 §2.2 从 chromium_cef 剥离；`CEF_ROOT` 指向它；核验含 `include/`+`cmake/`+`libcef_dll/`+`libcef.so`+OHOS adapter。
- [ ] **环境**：`CEF_ROOT`、Qt OHOS SDK `QT_SDK`（Qt5.12/5.15/Qt6 任意）、OHOS NDK `${OHOS_SDK_NATIVE}`、DevEco `${DEVECO_PATH}` 就绪。
- [ ] **§5 版本适配**：按 §5.1/§5.2/§5.3 读你版本的权威源，找 Ability→Qt 启动 API / main 契约 / 子进程入口符号 / node manager API / IoC 模块 / OHOS adapter .so 名。
- [ ] **CMake**（§C.2）：`find_package(CEF)`+`CEF_ROOT` + `add_subdirectory(libcef_dll)` + 业务 .so 链 libcef.so/wrapper/adapter + node_adapter（Qt5/Qt6 变体选你用的）。
- [ ] **架构五层**（§B）：① 复用组件包 libcef.so ② 实现 node manager（API 见 §5.3）③ 实现 CefClient+handlers + 导出子进程入口（符号见 §5.1/§5.2）④ Qt 窗口事件转发 ⑤ ArkTS Ability+IoC（启动 API 见 §5.1，IoC 见 §5.3）。
- [ ] **编译**：业务 .so + node_adapter.so + libcef_dll_wrapper 产出，链接通过。
- [ ] **部署 .so**：libcef.so+adapter+依赖链+业务 .so 进 `entry/libs/arm64-v8a/`；`llvm-readelf -d` NEEDED 全裸名（§C.3）。
- [ ] **权限**：INTERNET/GET_NETWORK_INFO + user_grant 配 reason+usedScene。
- [ ] **打 HAP+装+启**：`hvigorw assembleHap` → signed.hap → `hdc install` → `aa start` → hilog 见 CEF 启动。
- [ ] **WebEngine 迁移**（若迁旧应用）：按 §4.4 九步走，每类用法对照 §4.3 映射表替换 + marshal。

---

## 相关上下文

- [[qt-harmonyos-modules]] — Qt 模块鸿蒙适配状态（WebEngine Out of scope / WebView ✅，迁移选型依据）
- [[qt-harmonyos-window-model]] — 窗口模型（XComponent/ArkUI 节点树，解释 §B.1 node manager 为何不用传统 reparent）
- [[qt-harmonyos-third-party-libs]] — 三方库交叉编译/.so 部署（CEF 作为重型预编译 .so 的依赖链处理）
- [[qt-harmonyos-build-run-workflow]] — 构建运行全流程、DevEco/hvigorw/hdc
- [[qt-harmonyos-platform-limits]] — 平台限制（权限/user_grant reason 等）
- [[qt-harmonyos-api-mapping]] — API 替换方法论（本页 §4 是其专项应用：WebEngine→CEF）
- [[qt-harmonyos-qt6-status]] — Qt6 鸿蒙状态与 Qt5→Qt6 差异（§5.1 升级路径、Qt6 `qt_add_executable`+`harmonydeployqt6`）
- [[procedural-demo-generation]] — Demo 生成流程（本页 §E 检查清单的流程框架）

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 补齐鸿蒙 Qt 无 WebEngine 的内核级 web 方案缺口：基于华为官方开源 CEF for OpenHarmony 沉淀 Qt+CEF 开发指导 + WebEngine→CEF API 映射与迁移步骤；**不绑定 Qt 版本 + CEF 以去版本化组件包形式分发**（剥离/下载/版本中立集成）+ §5 版本升级适配方法论，支撑迁移提效与开发者答复，升级不踩空 |
| 影响面 | 迁移提效（WebEngine 应用迁移）、框架支撑（CEF 作为 WebEngine 平替）、商业答复、开发者指导（公开可分享） |
| 交付物 | 开发指导页、WebEngine→CEF 迁移方案、API 映射表、**CEF 组件包剥离方法**、**版本升级适配方法论**、AI 端到端检查清单 |
| 证据 | chromium_cef 114 release 分支源码结构核验（libcef 41 OHOS 适配 + tests/cefsimple + cmake/FindCEF + include API 头）、华为 guidebook solution6 §5 |
| 可复用方式 | 以后遇到「WebEngine 应用迁鸿蒙」「鸿蒙 Qt 需要 web 内核」「CEF 集成」类需求，直接加载本页跑 §E 检查清单；**升级 Qt/CEF/胶水层后先读 §5 找正确 API 再动手** |
