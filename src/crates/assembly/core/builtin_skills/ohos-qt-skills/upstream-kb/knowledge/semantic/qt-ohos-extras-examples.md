---
id: semantic-qt-ohos-extras-examples
type: semantic
domain: tech
tags: [qt, harmonyos, ohos, ohosextras, examples, cookbook, howto, ability, want, window, share, permissions, continuation, multimedia, serialport, fileshare, colortheme, contextmenu, nativewindow, startrequest]
created: 2026-07-21
updated: 2026-07-21
status: active
audience: public
refs: [semantic-qt-ohos-extras, semantic-qt-harmonyos-lifecycle, semantic-qt-harmonyos-window-model, semantic-qt-ohos-js-thread-gateway, semantic-qt-harmonyos-api-mapping]
summary: >
  QtOhosExtras 官方示例菜谱：把 24 个 example 按"开发者问题"组织，每条给出一句话用途、所用 API、
  最小代码模式与源文件路径。直接回答"如何在鸿蒙 Qt 上实现（其他平台上的）xxx 功能？"
  索引覆盖：打开链接/启动应用/启动并取结果/启动选项/预加载/应用续接/权限申请(含串口)/系统分享(发送+接收)/
  文件共享权限/文件回收站/常亮/圆角/拖拽缩放/深浅主题/长按上下文菜单/native窗口id/显示器id/应用版本/重启/
  音频流场景/嵌入式UIExtension/文件描述符传递(Want FD 发送+接收)。所有 API 签名源自 Qt 5.12.12 源码
  (commit 613336de)，与 5.15.16 逐字一致；示例源码位于 qtohosextras/examples/qtohosextras/。
leader_summary: >
  把官方 24 个 QtOhosExtras 示例蒸馏成"功能->API->代码模式"菜谱，让面对"鸿蒙 Qt 怎么实现某功能"的
  开发者（含商业伙伴）能一页定位答案，减少重复探索与答疑成本。
impact: [开发者支撑, 商业答复, 迁移提效]
deliverables: [知识页]
evidence: [源码 qtohosextras/examples/qtohosextras/, commit 待提交]
---

# QtOhosExtras 官方示例菜谱

> **目的**：开发者问"如何在鸿蒙 Qt 上实现（其他平台上的）xxx 功能？"时，先查本页。
> 每条 = 一句话用途 + 所用 API + 最小代码模式 + 源文件路径。

## 概述

Qt for HarmonyOS 的 `qtohosextras` 模块自带 **24 个官方示例**（Qt 5.12.12，commit `613336de`；与 5.15.16 逐字一致）。本页把这 24 个示例按"开发者问题"重新组织成菜谱，每条都给出可直接复制的最小代码模式与源码定位。

> **API 详表**见 [[qt-ohos-extras]]（145+ 公开 API）。本页只讲"用哪个示例、怎么用"，不重复 API 全表。

**前置**：所有示例 `QT += ohosextras`（部分需额外模块，见各条）。Qt6 中这些 API 私有化，见 [[qt-harmonyos-qt6-status]]。

**示例目录**：`qtohosextras/examples/qtohosextras/`（Qt 源码树 `qtohosextras/` 下）。`abilitycontext/` 为子目录工程，含 9 个 Ability 相关示例。

## 一、Ability 启动与上下文

### 1. 打开链接 / 用系统打开 URL
**问题**：如何在鸿蒙 Qt 上像 `QDesktopServices::openUrl` 一样打开链接，并控制只走应用链接（不走浏览器）？

**API**：`QtOhosExtras::QOhosAbilityContext::tryOpenLink(url)` / `tryOpenLink(url, options)`；`createOpenLinkOptions()` + `setAppLinkingOnly(bool)`。

**模式**（`abilitycontext/openlink/main.cpp`）：
```cpp
auto ctx = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
auto opt = QtOhosExtras::createOpenLinkOptions();
opt->setAppLinkingOnly(appLinkingOnly);        // true=仅应用链接打开
if (!ctx->tryOpenLink(url, *opt)) { /* 失败处理 */ }
```
源码：`abilitycontext/openlink/main.cpp` - `QT += ohosextras widgets`

### 2. 启动 Ability（fire-and-forget）
**问题**：如何启动另一个 Ability / 应用 / 子进程？

> **子进程选型**（2026-07-21 按领域经验补注）：启动"子进程"要分场景，不一刀切——
> - **无界面子进程** → `QProcess` **可用**（鸿蒙沙箱内可 fork/exec 无界面二进制，保持不改）
> - **有界面 + Qt 程序** → `QtOhosExtras::startAppProcess()` / `startNewAbilityInstance()`（Qt extra 接口）
> - **有界面 + 非 Qt 程序** → `QtOhosExtras::startAbility(want)`（本条，Want 模型）
> - **无界面但需鸿蒙原生托管** → `startNoUiChildProcess()`（.so 子进程，见 [[qt-ohos-extras]] §AppContext）
> 决策树见 [[qt-harmonyos-api-mapping]] §1。

**API**：命名空间自由函数 `QtOhosExtras::startAbility(const QOhosWant&)` -> `QSharedPointer<QOhosOperationStatus>`；`->success()` 查结果。详见 [[qt-ohos-extras]] Ability 启动节。

**模式**（`abilitycontext/wantfdssender/main.cpp` 用 `startAbility(want)` 发送带 fd 的 Want）：
```cpp
QtOhosExtras::QOhosWant want;
want.bundleName = "..."; want.abilityName = "...";
auto status = QtOhosExtras::startAbility(want);
if (!status.isNull() && status->success()) { /* ok */ }
```

### 3. 启动 Ability 并取结果（startActivityForResult 等价物）
**问题**：如何在鸿蒙 Qt 上实现 Android 的 `startActivityForResult`？

**API**：`QOhosAbilityContext::startAbilityForResult(const QOhosWant&)` / `(want, startOptions)` -> 返回 `QByteArray requestId`（**异步**，不阻塞）；结果经信号 `startAbilityForResultResponseReceived(requestId, resultCode, optWant)` / `startAbilityForResultErrorResponseReceived(requestId)` 回调。

**关键**：要**同步阻塞**等结果才需 [[qt-ohos-js-thread-gateway]] 的 `evalWithPromise`（QtOhosExtras 无同步变体）。

**模式**（`abilitycontext/startabilityforresult/main.cpp`）：
```cpp
auto ctx = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
QObject::connect(ctx.get(),
    &QtOhosExtras::QOhosAbilityContext::startAbilityForResultResponseReceived, this,
    [](QByteArray requestId, int resultCode, QSharedPointer<QtOhosExtras::QOhosWant> want) {
        // resultCode 即被启动 Ability 返回的结果码
    });
QObject::connect(ctx.get(),
    &QtOhosExtras::QOhosAbilityContext::startAbilityForResultErrorResponseReceived, this,
    [](QByteArray requestId) { /* 出错 */ });
auto requestId = ctx->startAbilityForResult(want);   // 或 (want, *startOptions)
```
源码：`abilitycontext/startabilityforresult/main.cpp`

### 4. 启动选项（窗口几何 / 分屏 / 启动画面）
**问题**：启动 Ability 时如何指定窗口位置大小、分屏/浮窗模式、启动画面图标与背景色、显示器 id？

**API**：`createStartOptions()` -> `QSharedPointer<QOhosStartOptions>`；`createWindowCreateParams()` -> `QOhosWindowCreateParams`。setter 见 [[qt-ohos-extras]] 启动选项节（几何/边界/WindowMode/DisplayId/WithAnimation/StartupVisibility/HideStartWindow/ProcessMode/StartWindowIcon/StartWindowBackgroundColor/SupportWindowModes/WindowCreateParams）。

**进阶 - 启动请求与完成回调**（示例还演示了 `QOhosStartRequest`，旧版 KB 未录，见 [[qt-ohos-extras]] 新增 API 节）：
```cpp
auto startRequest = QtOhosExtras::createStartRequest(*startOptions);   // 带 completion handler 的启动
QObject::connect(requestPtr, &QtOhosExtras::QOhosStartRequest::requestSucceeded, this,
    [](QtOhosExtras::QOhosElementName name, QString msg) { /* name.bundleName/moduleName/abilityName */ });
QObject::connect(requestPtr, &QtOhosExtras::QOhosStartRequest::requestFailed, this,
    [](QtOhosExtras::QOhosElementName name, QString msg) { /* 失败 */ });
auto status = QtOhosExtras::startAbility(want, *startRequest);
```
源码：`abilitycontext/startoptions/main.cpp` - `QT += ohosextras`（含 qrc 资源）- 该示例为最全配置演示器，覆盖几乎所有 StartOptions setter。

### 5. 预加载 Ability（快速冷启动）
**问题**：如何像系统预加载那样，提前创建窗口、用户点按时再显示？

**API**：`QOhosAppContext::getAppLaunchWantInfo()` -> `launchReason()` 判断 `Preload` vs `StartAbility`；预加载阶段不调 `show()`，监听 `QOhosAbilityContext::newWantInfoReceived`，等 `launchReason==StartAbility` 再 `show()`。

**模式**（`abilitycontext/preload/main.cpp`）：
```cpp
const auto wantInfo = QtOhosExtras::QOhosAppContext::getAppLaunchWantInfo();
if (wantInfo->launchReason() == QtOhosExtras::QOhosWantInfo::LaunchReason::StartAbility) {
    window->show();                       // 正常启动，直接显示
} else if (wantInfo->launchReason() == ...::Preload) {
    // 预加载：窗口已建好但不 show，等真正的 StartAbility 再显示
    QObject::connect(ctx.get(), &...::newWantInfoReceived, window,
        [w](auto wantInfo) {
            if (wantInfo->launchReason() == ...::StartAbility) w->show();
        });
}
```
源码：`abilitycontext/preload/main.cpp` - `LaunchReason` 枚举：`Unknown/StartAbility/Continuation/PrepareContinuation/Preload`

### 6. 跨设备迁移续接（Continuation）
**问题**：如何实现应用从一台鸿蒙设备迁移到另一台（设备续接）？

**API**：`QOhosAbilityContext::setContinuationActive(bool)`；信号 `continueRequestReceived(QSharedPointer<QOhosOnContinueContext>)`；`tryGetOnContinueData(want)` 取迁移数据；`context->setAgreeResponse(data)` / `setMismatchResponse()` / `sourceApplicationVersionCode()` 版本比对。

**模式**（`applicationcontinuation/main.cpp`）：
```cpp
auto ability = QtOhosExtras::QOhosAbilityContext::getInstanceForMainWindow(window.windowHandle());
ability->setContinuationActive(true);                       // 激活续接
QObject::connect(ability.get(), &...::continueRequestReceived, [](auto context) {
    auto ver = QtOhosExtras::QOhosAppContext::instance()->getBundleInfo()->versionCode();
    if (context->sourceApplicationVersionCode() == ver)
        context->setAgreeResponse(QByteArray("迁移数据"));   // 同意
    else
        context->setMismatchResponse();                      // 版本不匹配
});
auto data = QtOhosExtras::tryGetOnContinueData(             // 取迁移过来的数据
    QtOhosExtras::QOhosAppContext::getAppLaunchWant());
```
源码：`applicationcontinuation/main.cpp` - `QT += core ohosextras` - 详见 [[qt-harmonyos-lifecycle]] 接续迁移节

### 7. 文件描述符传递（Want FD）
**问题**：两个 Ability 之间如何传递已打开的文件描述符（fd）？

**发送端**（`abilitycontext/wantfdssender/main.cpp`）- 把 fd 装进 `want.fds`：
```cpp
QtOhosExtras::QOhosWant want;
auto file = QSharedPointer<QFile>::create(filePath);
file->open(QIODevice::ReadOnly);
int fd = file->handle();
want.fds.insert(QStringLiteral("keyFd%1").arg(i), fd);     // QMap<QString,int>
QtOhosExtras::startAbility(want);                           // 发送给目标 Ability
// 注意：file 必须保持存活直到 startAbility 返回
```

**接收端**（`abilitycontext/wantfdsreceiver/main.cpp`）- 从 Want 取 fd：
```cpp
auto ctx = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
QObject::connect(ctx.get(), &...::newWantInfoReceived, &window,
    [&window](QSharedPointer<QtOhosExtras::QOhosWantInfo> wantInfo) {
        const auto &want = wantInfo->want();
        for (auto it = want.fds.cbegin(); it != want.fds.cend(); ++it)
            /* it.key() / it.value()(int fd) 可直接 read()/fstat() */
    });
// 启动时也要处理 launch Want（迁移/被启动场景）
auto launch = QtOhosExtras::QOhosAppContext::getAppLaunchWantInfo();
if (!launch.isNull()) window.handleWant(launch->want());
```
源码：`abilitycontext/wantfdsreceiver/` + `abilitycontext/wantfdssender/` - 两个 Ability 配对运行

## 二、权限

### 8. 运行时权限申请
**问题**：如何向用户请求运行时权限（剪贴板/截屏/蓝牙/定位等）？

**API**：`QOhosAbilityContext::getInstanceForMainWindow(qWindow)` 取当前主窗口对应实例；`requestPermissionFromUserIfNeeded(Permission)`（枚举）或 `(const QString& namedPermission)`（自定义权限名）；结果经信号 `permissionRequestResponseReceived(Permission, PermissionResult)` / `namedPermissionRequestResponseReceived(QString, PermissionResult)` 回调。`PermissionResult{permissionGranted, dialogShown}`。

**预置权限枚举**（5 种）：`ReadPasteboard / CustomScreenCapture / AccessBluetooth / ApproximatelyLocation / Location`，对应字符串名如 `ohos.permission.READ_PASTEBOARD`。

**模式**（`abilitycontext/requestpermission/main.cpp`）：
```cpp
auto ctx = QtOhosExtras::QOhosAbilityContext::getInstanceForMainWindow(window->windowHandle());
ctx->requestPermissionFromUserIfNeeded(
    QtOhosExtras::AppPermissions::Permission::Location);          // 枚举
// 或自定义权限名：
ctx->requestPermissionFromUserIfNeeded(QStringLiteral("ohos.permission.XXX"));
QObject::connect(ctx.get(), &...::permissionRequestResponseReceived, window,
    [](QtOhosExtras::AppPermissions::Permission p,
       QtOhosExtras::AppPermissions::PermissionResult r) {
        // r.permissionGranted / r.dialogShown
    });
```
源码：`abilitycontext/requestpermission/main.cpp` - **注意**：必须先 `window.show()`（`getInstanceForMainWindow` 需要 `windowHandle()`）

### 9. 串口访问权限
**问题**：如何申请鸿蒙串口访问权限（`QSerialPort` 前置）？

**API**（旧版 KB 未录，源码 `qohosappcontext.h:53-54`）：
- `QOhosAppContext::hasSerialPortAccessRight(const QString &portName) const` -> bool
- `requestSerialPortAccessRightIfNeeded(const QString &portName)`
- 信号 `serialPortAccessRightResponseReceived(portName, QSharedPointer<QObject> accessRightContext)`

**模式**（`serialportpermissions/main.cpp`）：
```cpp
auto appCtx = QtOhosExtras::QOhosAppContext::instance();
appCtx->requestSerialPortAccessRightIfNeeded(portName);           // 弹权限
if (appCtx->hasSerialPortAccessRight(portName)) { /* 已授权 */ }
QObject::connect(appCtx, &...::serialPortAccessRightResponseReceived, this,
    [portName](QString respPort, QSharedPointer<QObject> ctx) {
        if (respPort != portName) return;
        // ctx 非空=授权；持有 ctx 期间权限有效，销毁即撤销
        // 期望场景：保持 ctx 存活（如存窗口成员），关闭窗口即撤销
    });
```
源码：`serialportpermissions/main.cpp` - `QT += ohosextras serialport`（需 Qt Serial Port 模块）- **关键约束**：`accessRightContext` 须保持存活，销毁即撤销权限（示例把它存进 `PermissionWindow` 成员，窗口关闭即撤销）

## 三、系统分享

### 10. 发送分享（ShareKit 系统面板）
**问题**：如何把文本/URL/文件通过系统分享面板分享出去（Android Intent.ACTION_SEND 等价物）？

**API**：`ShareKit::createContentRecord(mimeType, text)` / `createUrlRecord(QUrl)` / `createFileRecord(QFileInfo)` -> `QSharedPointer<QOhosSharedRecord>`；`createControllerOptions()`；入口 `QOhosAbilityContext::shareDataWithShareKit(records, controllerOptions)` -> `QByteArray requestId`；完成信号 `shareKitCompleted(requestId, result)` / `shareKitPanelClosed(requestId)`。

**Record 设置项**：`setTitle/Label/Description`、`setThumbnail(QByteArray)` / `setThumbnailFilePath`、`setExtraData(QVariantMap)`。
**ControllerOptions**：`setAnchor(QPoint/QRect)`、`setSingleSelectionMode(bool)`、`setDefaultPreviewMode(bool)`、`setExcludedAbilities(QList<ShareAbilityType>)`。

**模式**（`abilitycontext/sharedata/main.cpp`）：
```cpp
auto textRec = QtOhosExtras::ShareKit::createContentRecord(
    QMimeDatabase().mimeTypeForName("text/plain"), QStringLiteral("内容"));
textRec->setTitle("标题"); textRec->setThumbnail(logoBytes);
auto urlRec = QtOhosExtras::ShareKit::createUrlRecord(QUrl("https://..."));
auto fileRec = QtOhosExtras::ShareKit::createFileRecord(QFileInfo(path));

auto opts = QtOhosExtras::ShareKit::createControllerOptions();
opts->setSingleSelectionMode(true);
opts->setAnchor({x, y});

auto ctx = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
auto requestId = ctx->shareDataWithShareKit({textRec, urlRec, fileRec}, opts);
// 结果：ctx shareKitCompleted -> result->targetAbilityName()
```
源码：`abilitycontext/sharedata/main.cpp` - `QT += ohosextras widgets` - 含 rsc.qrc（qt_logo.png 缩略图）

### 11. 接收分享（作为分享目标）
**问题**：如何让自己的应用出现在系统分享面板的目标列表里并接收分享数据？

**API**：被分享时应用被启动，通过 `QOhosAppContext::getAppLaunchWant()` 取启动 Want，或监听 `QOhosAbilityContext::newWantReceived(QOhosWant)` 信号；`QOhosWantInfo::tryGetSharedRecordsFromShareKit()` 取分享记录。

**模式**（`abilitycontext/sharedatareceiver/main.cpp`）：
```cpp
auto ctx = QtOhosExtras::QOhosAbilityContext::getDefaultInstance();
QObject::connect(ctx.get(), &...::newWantReceived, this,
    [](QtOhosExtras::QOhosWant want) { /* want.parameters / want.uri 等 */ });
// 处理启动时已有的 launch Want（被分享启动）
```
源码：`abilitycontext/sharedatareceiver/main.cpp`

## 四、文件

### 12. 沙箱外文件访问权限（FileShare）
**问题**：如何授权/撤销/检查对沙箱外文件的访问（替代沙箱限制）？

**API**：`FileShare` 命名空间，`QList<PathPolicy>` 批量操作：`persistPermission / revokePermission / activatePermission / deactivatePermission / checkPersistent`；`PathPolicy{path, operationModes}`，`OperationMode{Read, Write}`（QFlags）。

**模式**（`filepermissions/main.cpp`，含官方 qdoc）：
```cpp
QtOhosExtras::FileShare::PathPolicy policy{filePath,
    QtOhosExtras::FileShare::OperationMode::Read | ...::Write};
auto result = QtOhosExtras::FileShare::persistPermission({policy});
// result->operationStatus()->success() + result->errorInfoList()（含 path/error/errorMessage）
auto check = QtOhosExtras::FileShare::checkPersistent({policy});
// check->checkResultList()[i].result（bool 是否已授权）
```
源码：`filepermissions/main.cpp` - `doc/src/filepermissions.qdoc`（官方文档，演示 PathPolicy 创建 + 各 API 调用 + 结果日志）

### 13. 文件移入回收站
**问题**：如何把文件移到回收站（而非直接删除）？

**API**：`QtOhosExtras::moveFileToTrash(const QString &filePath)` -> bool。

**模式**（`fileutils/main.cpp`）：
```cpp
bool ok = QtOhosExtras::moveFileToTrash(filePath);   // 返回是否成功
```
源码：`fileutils/main.cpp` - 另有 `authorizeFilePath(QWindow*, path)` 弹系统授权窗访问沙箱外路径（此 demo 未演示，见 [[qt-ohos-extras]] 工具函数节）

## 五、窗口

### 14. 窗口圆角
**问题**：如何给窗口设圆角？

**API**：`QtOhosExtras::setWindowCornerRadius(QWindow*/QWidget*, double radius)`（重载，`double`）。

**模式**（`windowcornerradius/main.cpp`）：
```cpp
auto *w = new QWidget; w->setWindowFlags(Qt::Window); w->resize(300, 300);
QtOhosExtras::setWindowCornerRadius(w, 16.0);   // show() 前调用
w->show();
```
源码：`windowcornerradius/main.cpp`

### 15. 窗口拖拽缩放
**问题**：如何开启鸿蒙窗口的拖拽缩放边框？

**API**：`QtOhosExtras::setWindowDragResizable(QWindow*/QWidget*, bool)`（重载）。

**模式**（`windowdragresize/main.cpp`）：
```cpp
QtOhosExtras::setWindowDragResizable(window, enable);   // toggle 开关
// 浮窗模式配合：
QtOhosExtras::setShowWindowAsFloatWindowHint(floatWindow, true);
```
源码：`windowdragresize/main.cpp` - 演示子窗口 + 浮窗两种，每种可单独切换 drag-resizable

### 16. native 窗口 id
**问题**：如何拿到鸿蒙侧的 native window id（用于跨进程窗口绑定等）？

**API**：`QtOhosExtras::tryGetNativeWindowId(QWindow*)` -> `QSharedPointer<double>`（ArkTS 侧 `WindowProperties.id`）。

**模式**（`nativewindowid/main.cpp`）：
```cpp
auto id = QtOhosExtras::tryGetNativeWindowId(window->windowHandle());
// id 非空时 *id 即 native id；不保证生命周期内始终有效
```
源码：`nativewindowid/main.cpp`

### 17. 显示器 id
**问题**：如何获取当前屏幕的 display id（跨屏/多显示器场景）？

**API**：`QtOhosExtras::tryGetScreenDisplayId(QScreen*)` -> `QSharedPointer<double>`。

**模式**（`screendisplayid/main.cpp`）：
```cpp
auto id = QtOhosExtras::tryGetScreenDisplayId(window->windowHandle()->screen());
```
源码：`screendisplayid/main.cpp`

### 18. 嵌入式 UIExtension（多窗口绑定）
**问题**：如何把多个 Qt 窗口作为 UIExtension 嵌入同一个 Ability？

**API**：`QtOhosExtras::setBundledAbilityAndQWindowBindingKeyForQWindow(QWindow*, const QString &key)`。

**模式**（`bundledembeddeduiextension/main.cpp`）：
```cpp
widget->winId();                                        // 确保 QWindow 已创建
QtOhosExtras::setBundledAbilityAndQWindowBindingKeyForQWindow(
    widget->windowHandle(), QStringLiteral("A"));        // 每个窗口一个 key
```
源码：`bundledembeddeduiextension/main.cpp` - 详见 [[qt-harmonyos-window-model]] 嵌入式子窗口/跨进程UIExtension节

### 19. 常亮屏幕
**问题**：如何保持屏幕常亮（视频/导航类应用）？

**API**：`QtOhosExtras::setWindowKeepScreenOn(QWindow*/QWidget*, bool)`（重载）。

**模式**（`keepscreenon/main.cpp`）：
```cpp
QtOhosExtras::setWindowKeepScreenOn(&window, keepOn);   // checkbox toggle
```
源码：`keepscreenon/main.cpp`

### 20. 窗口隐私模式（防截屏）
**问题**：如何防止窗口内容被截屏/录屏？

**API**：`QtOhosExtras::setWindowPrivacyMode(QWindow*, bool)`（无专门示例，见 [[qt-ohos-extras]] 窗口节）。

> 该 API 无独立 demo，但已收录 API 表；隐私场景（密码框、支付）常见。

## 六、应用与上下文

### 21. 应用版本号
**问题**：如何获取应用自身版本号？

**API**：`QOhosAppContext::instance()->getBundleInfo()->versionCode()`。

**模式**（`appbundleinfo/main.cpp`）：
```cpp
auto info = QtOhosExtras::QOhosAppContext::instance()->getBundleInfo();
auto versionCode = info->versionCode();
```
源码：`appbundleinfo/main.cpp` - `QT += core gui ohosextras`

### 22. 重启应用（保留/丢弃参数）
**问题**：如何重启应用，并控制是否保留命令行参数？

**API**：`QOhosAppContext::instance()->restartApp()`（Q_NORETURN，保留参数）/ `restartApp(const QOhosWant &want)`（Q_NORETURN，自定义 Want）。

**模式**（`restartapp/main.cpp`）：
```cpp
QtOhosExtras::QOhosAppContext::instance()->restartApp();           // 保留所有参数
auto want = QtOhosExtras::QOhosAppContext::getAppLaunchWant();
want.parameters = {};                                               // 清空参数
QtOhosExtras::QOhosAppContext::instance()->restartApp(want);        // 不保留参数
```
源码：`restartapp/main.cpp` - 同示例还演示从 `getAppLaunchWant().parameters` 读启动参数

### 23. 深浅主题切换
**问题**：如何切换深色/浅色主题、跟随系统？

**API**：`QOhosAppContext::setColorThemeMode(ColorThemeMode)`；`darkThemeActive()`；信号 `darkThemeActiveChanged(bool)`。`ColorThemeMode{LightTheme, DarkTheme, FollowSystemSetting}`。

**模式**（`colortheme/main.cpp`）：
```cpp
auto appCtx = QtOhosExtras::QOhosAppContext::instance();
appCtx->setColorThemeMode(QtOhosExtras::QOhosAppContext::ColorThemeMode::DarkTheme);
QObject::connect(appCtx, &...::darkThemeActiveChanged, label,
    [](bool dark) { /* 更新 UI */ });
bool dark = appCtx->darkThemeActive();
```
源码：`colortheme/main.cpp`

### 24. 长按上下文菜单
**问题**：触摸屏上如何像鼠标右键一样弹出上下文菜单？

**API**：`QOhosAppContext::enableContextMenuEventOnLongPress()`（**`app.exec()` 前调用一次，全局生效**）。

**关键约束**：长按产生的 `QContextMenuEvent::reason()` 是 `Other`，**非** `Mouse` - 按 reason 过滤须同时接受 `Other`。

**模式**（`contextmenuonlongpress/main.cpp`）：
```cpp
QtOhosExtras::QOhosAppContext::instance()->enableContextMenuEventOnLongPress();
// 之后 override contextMenuEvent：
void contextMenuEvent(QContextMenuEvent *e) override {
    // e->reason() == QContextMenuEvent::Other（长按），非 Mouse
}
```
源码：`contextmenuonlongpress/main.cpp`

## 七、多媒体

### 25. 音频流场景设置
**问题**：如何设置音频流用途（闹钟/铃声/通话/导航等），影响系统音量类型与打断策略？

**API**：`Multimedia::setAudioStreamUsageHintProperty(QObject*, AudioStreamUsageHint)`（作用于 `QSound`/`QSoundEffect`）；`tryGetAudioStreamUsageHintProperty`。14 种 hint：`Music/VoiceCommunication/VoiceAssistant/Alarm/VoiceMessage/Ringtone/Notification/Accessibility/Movie/Game/Audiobook/Navigation/VideoCommunication/Unknown`。

**模式**（`multimedia/audiostreamusagehint/main.cpp`）：
```cpp
auto *soundEffect = new QSoundEffect(this);
QtOhosExtras::Multimedia::setAudioStreamUsageHintProperty(
    soundEffect, QtOhosExtras::Multimedia::AudioStreamUsageHint::Alarm);
soundEffect->setSource(QUrl("qrc:/test.wav"));
soundEffect->play();
// 同样适用于 QSound
```
源码：`multimedia/audiostreamusagehint/main.cpp` - `QT += ohosextras multimedia widgets` - 含 resources.qrc（test.wav）

## 示例与 API 对照速查

| # | 示例 | 开发者问题 | 核心 API |
|---|------|-----------|---------|
| 1 | abilitycontext/openlink | 打开链接 | `tryOpenLink` + `createOpenLinkOptions` |
| 2 | abilitycontext/wantfdssender | 启动 Ability | `startAbility(want)` |
| 3 | abilitycontext/startabilityforresult | 启动取结果 | `startAbilityForResult` + 响应信号 |
| 4 | abilitycontext/startoptions | 启动选项 | `createStartOptions` + `createStartRequest`/`QOhosStartRequest` |
| 5 | abilitycontext/preload | 预加载 | `getAppLaunchWantInfo().launchReason()` + `newWantInfoReceived` |
| 6 | applicationcontinuation | 设备迁移 | `setContinuationActive` + `continueRequestReceived` |
| 7a | abilitycontext/wantfdssender | 发 fd | `want.fds.insert(key, fd)` + `startAbility` |
| 7b | abilitycontext/wantfdsreceiver | 收 fd | `newWantInfoReceived` -> `want.fds` |
| 8 | abilitycontext/requestpermission | 权限申请 | `requestPermissionFromUserIfNeeded` + 响应信号 |
| 9 | serialportpermissions | 串口权限 | `requestSerialPortAccessRightIfNeeded`/`hasSerialPortAccessRight` |
| 10 | abilitycontext/sharedata | 发送分享 | `shareDataWithShareKit` + `ShareKit::create*Record` |
| 11 | abilitycontext/sharedatareceiver | 接收分享 | `newWantReceived` + `tryGetSharedRecordsFromShareKit` |
| 12 | filepermissions | 文件权限 | `FileShare::persist/.../checkPersistent` + `PathPolicy` |
| 13 | fileutils | 回收站 | `moveFileToTrash` |
| 14 | windowcornerradius | 圆角 | `setWindowCornerRadius` |
| 15 | windowdragresize | 拖拽缩放 | `setWindowDragResizable` + `setShowWindowAsFloatWindowHint` |
| 16 | nativewindowid | native id | `tryGetNativeWindowId` |
| 17 | screendisplayid | 显示器 id | `tryGetScreenDisplayId` |
| 18 | bundledembeddeduiextension | UIExtension | `setBundledAbilityAndQWindowBindingKeyForQWindow` |
| 19 | keepscreenon | 常亮 | `setWindowKeepScreenOn` |
| 20 | -（无 demo） | 防截屏 | `setWindowPrivacyMode` |
| 21 | appbundleinfo | 版本号 | `getBundleInfo()->versionCode()` |
| 22 | restartapp | 重启 | `restartApp()` / `restartApp(want)` |
| 23 | colortheme | 主题 | `setColorThemeMode` + `darkThemeActiveChanged` |
| 24 | contextmenuonlongpress | 长按菜单 | `enableContextMenuEventOnLongPress` |
| 25 | multimedia/audiostreamusagehint | 音频场景 | `Multimedia::setAudioStreamUsageHintProperty` |

> 另有 API 无独立 demo：`setWindowPrivacyMode`（防截屏）、`authorizeFilePath`（弹窗授权访问沙箱外路径）、`setInAppOnlyPasteboardShareOption`（剪贴板仅应用内）、`setSurfaceBackgroundColor`、`setMainWindowGeometryPersistenceHint`、`startNoUiChildProcess`、`startAppProcess`、`startAbilityByType`、`setFont...` 等，见 [[qt-ohos-extras]] API 全表。

## 参考来源

| 来源 | 说明 |
|------|------|
| Qt 源码示例 | `qtohosextras/examples/qtohosextras/`（24 个 example，Qt 5.12.12 commit `613336de`，与 5.15.16 commit `962aa625` 逐字一致）- 2026-07-21 全量扫描 |
| Qt 源码头文件 | `qtohosextras/src/ohosextras/*.h`（API 签名校验：`qohosappcontext.h` 串口、`qohosstartrequest.h`+`qohosbundlemanager.h` 启动请求） |
| 官方文档 | `filepermissions/doc/src/filepermissions.qdoc`（filepermissions 示例官方 qdoc，演示 PathPolicy 创建与各 API 调用） |
| Qt Wiki | [Qt OHOS Extras Examples](https://wiki.qt.io/Qt_for_HarmonyOS/qtohosextras_doc/Qt_Ohos_Extras_Examples) |

## 相关上下文

- [[qt-ohos-extras]] - QtOhosExtras 模块 145+ API 全表（本页的 API 详表来源）
- [[qt-harmonyos-lifecycle]] - 生命周期、Want、设备迁移续接（对应示例 5/6）
- [[qt-harmonyos-window-model]] - 窗口模型、浮窗、嵌入式子窗口/UIExtension（对应示例 14-20）
- [[qt-ohos-js-thread-gateway]] - 同步化 `startAbilityForResult` 结果（异步信号->同步等值）
- [[qt-harmonyos-api-mapping]] - 平台间 API 迁移映射（Before/After 对照）

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 把官方 24 个 QtOhosExtras 示例蒸馏成"功能->API->代码模式"菜谱，让面对"鸿蒙 Qt 怎么实现某功能"的开发者能一页定位答案 |
| 影响面 | 开发者支撑、商业答复、应用迁移提效 |
| 交付物 | 知识页 |
| 证据 | 源码 `qtohosextras/examples/qtohosextras/` 全量扫描 + 头文件签名校验 |
| 可复用方式 | 开发者问"鸿蒙 Qt 如何实现 X 功能"时直接引用本页对应条目 |
