---
id: semantic-qt-ohos-extras
type: semantic
domain: tech
tags: [qt, harmonyos, ohos, ohosextras, ability, want, startability, context-menu, touch, long-press, window, cornerradius, permissions, share, fileshare, continuation, multimedia, startoptions, serialport, startrequest, nativewindow, colortheme]
created: 2026-06-02
updated: 2026-07-21
status: active
audience: public
refs: [semantic-qt-harmonyos-overview, semantic-qt-harmonyos-api, semantic-qt-ohos-js-thread-gateway, semantic-qt-harmonyos-lifecycle, semantic-qt-harmonyos-qt6-status, semantic-qt-harmonyos-window-model, semantic-qt-ohos-extras-examples]
summary: >
  QtOhosExtras 模块：Qt 与鸿蒙系统交互的桥梁。Qt5 公开 API 145+ 个（2026-07-15 源码全扫补全，此前仅录 ~9 个）。
  覆盖：窗口（setWindowCornerRadius/tryGetNativeWindowId/setShowWindowAsFloatWindowHint/隐私模式/常亮/拖拽缩放）、
  Ability 启动（startAbility/startAbilityForResult★异步/startAppProcess/startNoUiChildProcess/startAbilityByType）、
  权限申请、系统分享(ShareKit)、文件共享(FileShare)、设备迁移续接、启动选项(QOhosStartOptions)、
  Want/WantInfo、剪贴板/文件/多媒体工具。使用：QT += ohosextras。Qt6 私有化。
---

# QtOhosExtras 模块

## 概述

QtOhosExtras 是 Qt for HarmonyOS 的专有扩展模块，提供与鸿蒙系统交互的 API。

> **2026-07-15 全量扫描补全**：对源码 `qtohosextras/src/ohosextras/` 全部公开头文件做了一次完整扫描，公开 API 共 **145+ 个**（含 `qohoswindowutils.h`）。此前知识库仅收录 ~9 个，漏 90%+，含多处误导性错误（见各节 ⚠️ 及末尾「已纠正的历史错误」）。
>
> **版本**：全部为 Qt5 公开 API。Qt 5.12.12（commit `613336de`）与 5.15.16（commit `962aa625`）的 `qtohosextras` 头文件**逐字一致**——本页 API 两版均有。Qt6 中 QtOhosExtras 不再独立、API 私有化（`_p.h`），无公开等价物（见 [[qt-harmonyos-qt6-status]]）。

## 使用方式

```cpp
#include <QtOhosExtras>          // 模块级总头（推荐），或子头 <QtOhosExtras/qohoswindowutils.h> 等
// 项目文件 (.pro):  QT += ohosextras
// CMake:            find_package(Qt5 REQUIRED COMPONENTS OhosExtras)
//                   target_link_libraries(... Qt5::OhosExtras)
```

## 核心 API

### 窗口相关（`qohoswindowutils.h` · `QtOhosExtras` 命名空间自由函数）

> ⚠️ 本节曾严重缺失：2026-07-15 前仅收录 2 个、漏 11 个（含 `setWindowCornerRadius`）——直接导致答错"QtOhosExtras 无窗口圆角接口"。

**枚举**：
- `enum class CloseEventRootCause { InternalClose, AbilityClose, WindowStageClose }` — close 事件根因
- `enum class WindowGeometryPersistenceHint { Disabled, Enabled, FollowSystemSetting }` — 主窗口几何持久化策略

**函数**（标"重载"者 `QWindow*` 与 `QWidget*` 各一版）：

| 函数 | 用途 |
|------|------|
| `getCloseEventRootCause(QCloseEvent*)` → `CloseEventRootCause` | 查询 close 事件根因 |
| `setShowWindowAsFloatWindowHint(QWindow*/QWidget*, bool)`（重载） | 置为浮窗模式（浮窗 demo 用，见 [[qt-harmonyos-window-model]] §浮窗） |
| `setMainWindowGeometryPersistenceHint(WindowGeometryPersistenceHint)` | 主窗口几何持久化（仅 2in1） |
| `setWindowPrivacyMode(QWindow*, bool)` | 窗口隐私模式（防截屏） |
| `setSurfaceBackgroundColor(QWindow*/QWidget*, const QColor&)`（重载） | 设窗口 surface 背景色 |
| **`setWindowCornerRadius(QWindow*/QWidget*, double radius)`**（重载） | ★ **设窗口圆角半径**（鸿蒙系统窗口圆角的 extra 封装；官方 demo `windowcornerradius`） |
| `setWindowKeepScreenOn(QWindow*/QWidget*, bool)`（重载） | 屏幕常亮 |
| `setWindowDragResizable(QWindow*/QWidget*, bool)`（重载） | 拖拽缩放开关 |
| `tryGetNativeWindowId(QWindow*)` → `QSharedPointer<double>` | ArkTS 侧 WindowProperties.id（不保证生命周期内有效） |
| `tryGetScreenDisplayId(QScreen*)` → `QSharedPointer<double>` | 屏幕 display id |
| `setBundledAbilityAndQWindowBindingKeyForQWindow(QWindow*, const QString&)` | 绑定 Ability-QWindow key |

> **`setWindowCornerRadius` 用法**（官方 demo `qtohosextras/examples/qtohosextras/windowcornerradius/main.cpp`）：
> ```cpp
> auto *w = new QWidget; w->setWindowFlags(Qt::Window); w->resize(300, 300);
> QtOhosExtras::setWindowCornerRadius(w, 16.0);   // double，官方在 show() 前调用
> w->show();
> ```
> 作用于 `QWindow`/`QWidget` 对应的鸿蒙窗口；对短生命周期 popup（QMenu/下拉）需在窗口创建后、`show()` 前调，时机需 demo 验证。

### Ability 启动与上下文（`qohosabilitycontext.h`）

> ⚠️ **纠正历史错误**：本页曾断言"无 `startAbilityForResult`"。源码 `qohosabilitycontext.h:79-80` **明确提供** `QOhosAbilityContext::startAbilityForResult` 两个重载（异步，返回 `requestId`，结果经信号回调）。要**同步阻塞**等结果时才需 [[qt-ohos-js-thread-gateway]] 的 `evalWithPromise` 同步化（QtOhosExtras 无同步阻塞变体，见末尾「已纠正」）。

> **子进程选型**：启动子进程不能一刀切（`QProcess`/`startAppProcess()`/`startAbility()`/`startNoUiChildProcess()` 各有适用场景），决策树见 [[qt-harmonyos-api-mapping]] §1。

**命名空间级自由函数**：

| 函数 | 用途 |
|------|------|
| `startAbility(const QOhosWant&)` → `QSharedPointer<QOhosOperationStatus>` | 启动指定 Ability（fire-and-forget） |
| `startAbility(const QOhosWant&, const QOhosStartOptions&)` | 带 StartOptions 启动 Ability |
| `startAbilityByType(const QString &appType, const QJsonObject &wantParameters)` | 按应用类型启动（隐式 Want） |
| `startNewAbilityInstance(QWidget *instanceWidget)` | 启动新 Ability 实例 |
| `startAppProcess(const QString &processId, const QOhosWant &requestWant)` | 启动应用进程 |
| `startAppProcess(..., const QOhosStartOptions &options)` | 带选项启动应用进程 |
| `setAbilityInstanceDestroyEnabled(QWindow*, bool)` | 设置某 Ability 实例窗口是否允许系统销毁 |
| `tryGetOnContinueData(const QOhosWant&)` → `QSharedPointer<QByteArray>` | 从 Want 中取设备迁移续接数据 |

**`QOhosAbilityContext` 类方法**（继承 QObject，`instance()` 单例）：

| 方法 | 用途 |
|------|------|
| `static instance()` / `getDefaultInstance()` | 单例 / 默认实例（共享指针） |
| `static getInstanceForMainWindow(QWindow*)` | 为指定主窗口获取对应实例 |
| `setDestroyFromSystemEnabled(bool)` | 系统可否销毁该 Ability 实例 |
| `requestPermissionFromUserIfNeeded(Permission)` / `(const QString&)` | 按需向用户请求权限（枚举/字符串名） |
| `requestPermissionOnSettingIfNeeded(Permission)` / `(const QString&)` | 按需跳设置页请求权限 |
| ★ `startAbilityForResult(const QOhosWant&)` → `QByteArray` | 启动 Ability 并**异步**等结果（返回 requestId） |
| ★ `startAbilityForResult(const QOhosWant&, const QOhosStartOptions&)` | 带 StartOptions 的异步等结果启动 |
| `shareDataWithShareKit(records, controllerOptions)` | 通过 ShareKit 系统面板分享数据 |
| `tryOpenLink(const QString&)` / `(..., const QOhosOpenLinkOptions&)` | 用系统打开链接（可带选项） |
| `setContinuationActive(bool)` | 设置跨设备迁移续接激活状态 |

**`QOhosAbilityContext` 信号**（异步结果回调入口）：

| 信号 | 用途 |
|------|------|
| `newWantReceived(QOhosWant)` / `newWantInfoReceived(QSharedPointer<QOhosWantInfo>)` | 收到新 Want/WantInfo |
| `continueRequestReceived(QSharedPointer<QOhosOnContinueContext>)` | 收到设备迁移续接请求 |
| `permissionRequestResponseReceived(Permission, PermissionResult)` / `namedPermissionRequestResponseReceived(...)` | 权限请求响应 |
| `permissionRequestOnSettingResponseReceived(Permission, bool)` / `named...` | 设置页权限响应 |
| ★ `startAbilityForResultResponseReceived(requestId, resultCode, optWant)` | `startAbilityForResult` 成功响应 |
| ★ `startAbilityForResultErrorResponseReceived(requestId)` | `startAbilityForResult` 错误响应 |
| `shareKitPanelClosed(requestId)` / `shareKitCompleted(requestId, result)` | ShareKit 面板关闭/分享完成 |

> **打开链接辅助**：`createOpenLinkOptions()` 工厂 + `QOhosOpenLinkOptions::setAppLinkingOnly(bool)`（仅应用链接打开，不走浏览器）。

### 应用上下文 `QOhosAppContext`（`qohosappcontext.h`，单例）

| 方法 | 用途 |
|------|------|
| `static instance()` | AppContext 单例 |
| `static isNoUiChildMode()` | 当前是否无 UI 子进程模式 |
| `static startNoUiChildProcess(QString libraryName, QStringList args)` | 启动无 UI 后台子进程（按库名+参数） |
| `static getAppLaunchWant()` / `getAppLaunchWantInfo()` | 应用启动时的 Want / WantInfo（迁移/深链必用） |
| `isPermissionGranted(Permission)` / `(const QString&)` | 查询权限是否已授予 |
| `requestPermissionFromUserIfNeeded(Permission)` / `requestPermissionOnSettingIfNeeded(Permission)` | 按需请求权限 |
| `fontSizeScale()` | 系统字体大小缩放比例 |
| `darkThemeActive()` / `setColorThemeMode(ColorThemeMode)` | 深色主题查询/设置 |
| `enableContextMenuEventOnLongPress()` | 启用触摸长按触发 `QContextMenuEvent`（默认仅鼠标右键） |
| `getBundleInfo()` → `QSharedPointer<QOhosBundleInfo>` | 应用包信息 |
| `restartApp()` / `restartApp(const QOhosWant&)` | 重启应用（`Q_NORETURN`） |
| `hasSerialPortAccessRight(const QString &portName)` / `requestSerialPortAccessRightIfNeeded(const QString &portName)` | ★ 串口访问权限查询/按需申请（源码 `qohosappcontext.h:53-54`；官方 demo `serialportpermissions`，`QT += serialport`） |

**枚举**：`enum class ColorThemeMode { LightTheme, DarkTheme, FollowSystemSetting }`
**信号**：`permissionRequestResponseReceived` / `...WithResultReceived` / `...OnSettingResponseReceived` / `fontSizeScaleChanged(double)` / `darkThemeActiveChanged(bool)` / ★ `serialPortAccessRightResponseReceived(QString portName, QSharedPointer<QObject> accessRightContext)`

> ⚠️ **串口权限约束**（官方 demo `serialportpermissions`）：`accessRightContext` 须保持存活，销毁即撤销权限（示例把它存进 `PermissionWindow` 成员，窗口关闭即撤销）。`QSerialPort` 前置需 `QT += serialport`。

> ⚠️ **`enableContextMenuEventOnLongPress` 注意**（源码 `qohosappcontext.cpp:501-513`）：
> - **调用时机**：`app.exec()` 之前调用一次，全局生效（非 per-widget）。
> - **触发 reason 为 `Other`**：长按产生的 `QContextMenuEvent::reason()` 是 `Other`，**非** `Mouse`。若按 reason 过滤需同时接受 `Other`。
> - **仅 Qt5**：Qt6 中此 API 已私有化，无公开等价物。

### 启动选项 `QOhosStartOptions`（`qohosstartoptions.h`）

> 多窗口/分屏/启动画面配置核心，移植应用高频使用。整块曾缺失。

**工厂**：`createStartOptions()` → `QSharedPointer<QOhosStartOptions>`；`createWindowCreateParams()` → `QSharedPointer<QOhosWindowCreateParams>`

**`QOhosStartOptions` setter**：

| 分组 | setter |
|------|--------|
| 窗口几何 | `setWindowLeft/Top/Width/Height(int)` |
| 窗口边界 | `setMinWindowWidth/Height`、`setMaxWindowWidth/Height` |
| 窗口模式 | `setWindowMode(WindowMode)`、`setSupportWindowModes(QList<SupportWindowMode>)` |
| 显示器 | `setDisplayId(int)` |
| 动画/可见 | `setWithAnimation(bool)`、`setStartupVisibility(StartupVisibility)`、`setHideStartWindow(bool)` |
| 进程 | `setProcessMode(ProcessMode)` |
| 启动画面 | `setStartWindowIcon(QImage)`、`setStartWindowBackgroundColor(QColor)` |
| 窗口创建参数 | `setWindowCreateParams(QOhosWindowCreateParams)` |
| ⚠️ 废弃 | `setWindowFocused(bool)`（`QT_DEPRECATED_X`，无效果） |

**`QOhosWindowCreateParams`**：`setAnimationType(AnimationType)`，`enum class AnimationType { FADE_IN_OUT = 0 }`

**枚举**：
- `QOhosStartOptions::ProcessMode { NEW_PROCESS_ATTACH_TO_PARENT, NEW_PROCESS_ATTACH_TO_STATUS_BAR_ITEM }`
- `QOhosStartOptions::StartupVisibility { STARTUP_HIDE, STARTUP_SHOW }`
- `QOhosStartOptions::WindowMode { WINDOW_MODE_SPLIT_PRIMARY, WINDOW_MODE_SPLIT_SECONDARY, WINDOW_MODE_FULLSCREEN }`
- `QOhosStartOptions::SupportWindowMode { FULL_SCREEN, SPLIT, FLOATING }`

### 启动请求 `QOhosStartRequest`（`qohosstartrequest.h` · `qohosbundlemanager.h`）

> ⚠️ **2026-07-21 示例补全新增**：旧版 KB 未录。源码头文件 `qohosstartrequest.h` + `qohosbundlemanager.h`；官方 demo `abilitycontext/startoptions` 演示。

**工厂**：`QtOhosExtras::createStartRequest(const QOhosStartOptions &options)` → `QSharedPointer<QOhosStartRequest>`

**`QOhosStartRequest` 类**（QObject，不可直接构造，用工厂创建）：

| 信号 | 用途 |
|------|------|
| `requestSucceeded(QOhosElementName elementName, QString message)` | 启动成功回调（completion handler） |
| `requestFailed(QOhosElementName elementName, QString message)` | 启动失败回调 |

**`QOhosElementName` 结构体**（`qohosbundlemanager.h`，`Q_DECLARE_METATYPE`）：`deviceId / bundleName / abilityName / uri / shortName / moduleName`

**配套 `startAbility` / `startAbilityForResult` 重载**（命名空间级 + `QOhosAbilityContext` 方法，均接收 `QOhosStartRequest`）：
- `startAbility(const QOhosWant&, const QOhosStartRequest&)` — 带 completion 回调的启动
- `QOhosAbilityContext::startAbilityForResult(const QOhosWant&, const QOhosStartRequest&)` — 带回调的等结果启动
- `startAppProcess(processId, requestWant, const QOhosStartRequest&)` — 带回调的启动应用进程

> **何时用 StartRequest**：普通 `startAbility(want, startOptions)` 是 fire-and-forget（只知 `operationStatus->success()`）。要拿到启动最终结果（成功/失败 + ElementName）用 `createStartRequest` + `startAbility(want, *startRequest)`，结果经 `requestSucceeded`/`requestFailed` 信号回调。用法见 [[qt-ohos-extras-examples]] §4。

### Want / WantInfo（`qohoswant.h`）

**`QOhosWant` 结构体**（鸿蒙 Want 的 C++ 映射）：`deviceId / bundleName / moduleName / abilityName / uri / type / action / entities / flags / parameters / fds`
- `enum class QOhosWantFlag { AuthReadUriPermission, AuthWriteUriPermission, InstallOnDemand }`（QFlags 组合）

**`QOhosWantInfo` 访问方法**（纯虚成员）：

| 方法 | 用途 |
|------|------|
| `want() const` → `QOhosWant` | 取完整 Want |
| `tryGetSharedRecordsFromShareKit() const` | 取通过 ShareKit 传入的分享记录 |
| `tryGetContactInfo() const` → `ContactInfo` | 取 Want 携带的联系人信息 |
| `launchReason() const` → `LaunchReason` | 应用启动原因 |

- `enum class LaunchReason { Unknown, StartAbility, Continuation, PrepareContinuation, Preload }`
- `struct ContactInfo { QString contactType; QString contactId; }`

### 系统分享 ShareKit（`qohossharekit.h` · `ShareKit` 命名空间）

**工厂**：`createContentRecord(QMimeType, QString content)` / `createFileRecord(QFileInfo)` / `createUrlRecord(QUrl)` / `createControllerOptions()` → 均返回 `QSharedPointer<...>`

**`QOhosSharedRecord`** getter/setter（16 个）：`mimeType/content/filePath/isUrlContent`（只读）；`setTitle/title`、`setLabel/label`、`setDescription/description`、`setThumbnail/thumbnail`（QByteArray）、`setThumbnailFilePath/thumbnailFilePath`、`setExtraData/extraData`（QVariantMap）

**`QOhosShareControllerOptions`**：`setAnchor(QPoint)` / `setAnchor(QRect)`、`setSingleSelectionMode(bool)`、`setDefaultPreviewMode(bool)`、`setExcludedAbilities(QList<ShareAbilityType>)`
**`QOhosShareOperationResult`**：`targetAbilityName() const`
**枚举**：`enum class ShareAbilityType { CopyToPasteboard, SaveToMediaAsset, SaveAsFile, Print, SaveToSuperHub }`

> 入口：`QOhosAbilityContext::shareDataWithShareKit(records, options)`，完成经 `shareKitCompleted` 信号回调。

### 文件共享 FileShare（`qohosfileshare.h` · `FileShare` 命名空间）

沙箱外文件访问授权的官方途径。批量操作，均返回 `QSharedPointer<ActionResult>` / `QSharedPointer<CheckResult>`。

| 函数 | 用途 |
|------|------|
| `persistPermission(QList<PathPolicy>)` | 持久化文件共享权限 |
| `revokePermission(QList<PathPolicy>)` | 撤销权限 |
| `activatePermission(QList<PathPolicy>)` | 激活已持久化权限 |
| `deactivatePermission(QList<PathPolicy>)` | 停用权限 |
| `checkPersistent(QList<PathPolicy>)` | 检查持久化状态 |

- `enum class OperationMode { Read=1<<0, Write=1<<1 }`（QFlags 组合）
- `enum class PathPolicyError { Unknown, PersistenceForbidden, InvalidMode, InvalidPath, PermissionNotPersisted }`
- `struct PathPolicy { QString path; OperationModes operationModes; }`
- `ActionResult::operationStatus()` / `errorInfoList()`；`CheckResult::checkResultList()`

### 权限 AppPermissions（`qohosapppermissions.h` · `AppPermissions` 命名空间）

- `enum class Permission { ReadPasteboard, CustomScreenCapture, AccessBluetooth, ApproximatelyLocation, Location }` — QtOhosExtras 预置 5 种可申请权限
- `struct PermissionResult { bool permissionGranted; bool dialogShown; }`

> 入口：`QOhosAppContext` / `QOhosAbilityContext` 的 `requestPermissionFromUserIfNeeded` / `requestPermissionOnSettingIfNeeded`，结果经 `permissionRequestResponse*` 信号回调。

### 设备迁移续接 `QOhosOnContinueContext`

| 方法 | 用途 |
|------|------|
| `setAgreeResponse(const QByteArray &responseData)` | 同意迁移，携带响应数据 |
| `setRejectResponse()` | 拒绝迁移 |
| `setMismatchResponse()` | 迁移不匹配响应 |
| `setExitAppOnSourceDeviceAfterMigration(bool)` | 迁移完成后是否退出源设备应用 |
| `sourceApplicationVersionCode() const` | 源应用版本号 |

> 入口：`QOhosAbilityContext::continueRequestReceived` 信号 + `setContinuationActive`；`tryGetOnContinueData` 取数据。详见 [[qt-harmonyos-lifecycle]]。

### 工具函数

| 头文件 / 命名空间 | 函数 | 用途 |
|------|------|------|
| `qohosfileutils.h` | `moveFileToTrash(const QString&)` → bool | 文件移入回收站 |
| `qohosfileutils.h` | `authorizeFilePath(QWindow*, const QString&)` → bool | 弹系统授权窗，访问沙箱外路径 |
| `qohosmultimediautils.h` · `Multimedia` | `setAudioStreamUsageHintProperty(QObject*, AudioStreamUsageHint)` | 给 QSoundEffect/QSound 设音频流场景 |
| `qohosmultimediautils.h` | `tryGetAudioStreamUsageHintProperty(QObject*, AudioStreamUsageHint*)` | 读取音频流场景属性 |
| `qohospasteboard.h` · `QOhosPasteboard` | `setInAppOnlyPasteboardShareOption(bool)` | 剪贴板内容仅应用内共享 |

- `enum class AudioStreamUsageHint { Unknown, Music, VoiceCommunication, VoiceAssistant, Alarm, VoiceMessage, Ringtone, Notification, Accessibility, Movie, Game, Audiobook, Navigation, VideoCommunication }`（14 种，影响系统音量类型/打断策略）

### 枚举与类型（`qohosenums.h`）

- `enum class ColorMode { COLOR_MODE_NOT_SET, COLOR_MODE_DARK, COLOR_MODE_LIGHT }`（命名空间 `QtOhos::enums::...::ConfigurationConstant`，对应 `@ohos.app.ability.ConfigurationConstant.ColorMode`）
- `struct OhosEnumMeta<Enum>` 模板：为 OHOS 枚举提供全类型名 + 枚举值↔字符串映射（桥接 NAPI 反射），当前仅特化 `ColorMode`

### `QOhosBundleInfo`（`qohosappbundleinfo.h`）

- `versionCode() const` — 应用版本号

> `QOhosUiAbilityContext`（`qohosuiabilitycontext.h`）是 `QOhosAbilityContext` 的类型别名，无新 API。
> `QOhosOperationStatus::success() const` — 异步操作（startAbility 等）是否成功。

## ⚠️ 已纠正的历史错误（2026-07-15）

| 原错误（旧版 KB） | 纠正（源码核实） |
|------|------|
| "无 `startAbilityForResult`，需绕道 [[qt-ohos-js-thread-gateway]]" | `QOhosAbilityContext::startAbilityForResult` **存在**（2 重载，异步返回 `requestId`，经 `startAbilityForResultResponseReceived` / `...Error...` 信号回调）。要**同步阻塞**等结果才用 gateway `evalWithPromise`（QtOhosExtras 无同步变体） |
| "QtOhosExtras 无窗口圆角接口" | `QtOhosExtras::setWindowCornerRadius(QWindow*/QWidget*, double)` **存在**（见窗口节，官方 demo `windowcornerradius`） |
| 窗口相关仅录 2 个 API | `qohoswindowutils.h` 共 13 个窗口 API + 2 枚举 |
| 全页仅录 ~9 个 API | 公开 API 145+ 个（含 StartOptions/ShareKit/FileShare/权限/迁移/工具等整块） |

## API 参考来源

- [Qt OHOS Extras C++ Classes](https://wiki.qt.io/Qt_for_HarmonyOS/qtohosextras_doc/Qt_Ohos_Extras_C%2B%2B_Classes)（类索引页，**不含函数签名**——曾因此误判"无圆角接口"，查具体 API 须看源码头文件）
- [Qt OHOS Extras Examples](https://wiki.qt.io/Qt_for_HarmonyOS/qtohosextras_doc/Qt_Ohos_Extras_Examples)
- [Qt OHOS Extras Document](https://wiki.qt.io/Qt_for_HarmonyOS/qtohosextras_doc)

## 参考来源

| 来源 | 说明 |
|------|------|
| 🛠️ Qt 源码 | `qtohosextras/src/ohosextras/*.h`（5.15.16 commit `962aa625` + 5.12.12 commit `613336de`，逐字一致）—— 2026-07-15 全量扫描 |
| 🛠️ Qt 源码 | `qtohosextras/examples/qtohosextras/windowcornerradius/main.cpp` — `setWindowCornerRadius` 官方 demo |
| 📦 安装头文件 | `<LOCAL_PATH>/include/QtOhosExtras/` |
| 🛠️ Qt 源码示例 | `qtohosextras/examples/qtohosextras/`（24 个 example 全量，2026-07-21 扫描）— 详见 [[qt-ohos-extras-examples]]，串口/StartRequest API 即由示例补全 |

## 相关上下文

- [[qt-harmonyos-overview]] — QPA 插件架构总览
- [[qt-harmonyos-api]] — 平台差异（`winId()` vs `tryGetNativeWindowId`）
- [[qt-ohos-extras-examples]] — ★ 24 个官方示例菜谱（功能→API→代码模式），开发者问"如何实现某功能"时先查此页
- [[qt-ohos-js-thread-gateway]] — Qt↔ArkTS 私有桥接；同步化 `startAbilityForResult` 结果（异步信号→同步等值）
- [[qt-harmonyos-lifecycle]] — 生命周期、Want 接续、设备迁移
- [[qt-harmonyos-window-model]] — 窗口模型（浮窗、popup、XComponent 承载）
- [[qt-harmonyos-qt6-status]] — Qt6 中本模块私有化
