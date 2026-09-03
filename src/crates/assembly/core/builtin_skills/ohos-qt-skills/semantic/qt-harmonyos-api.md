---
id: semantic-qt-harmonyos-api
type: semantic
domain: tech
tags: [qt, harmonyos, api, porting, qprocess, qwindow, dialog, modality, fullscreen, platform, setSurfaceConsumer, OHNativeWindow]
created: 2026-06-02
updated: 2026-08-06
status: active
audience: public
refs: [semantic-qt-harmonyos-overview, semantic-qt-ohos-extras]
summary: >
  Qt 鸿蒙化 API 兼容性要点：argv 参数差异、子进程按场景选（无界面 QProcess 可用/有界面 Qt 用 startAppProcess/有界面非Qt 用 startAbility）、
  窗口模型差异（QDialog/Popup 为子窗口）、
  modality 仅子窗口有效、winId() 非原生句柄、setSurfaceConsumer 获取 OHNativeWindow* 的公开路径、hide() 语义不同、
  setMask() 仅子窗口、closeEvent 可能来自系统生命周期。
  平台判断：Qt.platform.os 在鸿蒙返回 "linux"（上游 os() 缺 Q_OS_OHOS 分支），临时用 pluginName，建议上游修复。
  设备类型判断：Qt 不导出公开设备类型接口；私有层 QtCore 的 QOhosDeviceInfo（Q_CORE_EXPORT，可 include 可 link，但仅 2in1/tablet/phone 三档、本质是 @ohos.deviceInfo 缓存）可用，应用层推荐直接走 Node-API 调 @ohos.deviceInfo。
---

# Qt for HarmonyOS API 兼容性笔记

> 来源：[API Compatibility Notes](https://wiki.qt.io/Qt_for_HarmonyOS/api_inconsistencies_on_harmonyos)

## 平台判断（QML 与 C++）

> **源码验证**（Qt 5.15.16 OHOS commit `962aa625`，tqtc/harmonyos-5.15.16 分支）

### 现状：`Qt.platform.os` 在鸿蒙返回 `"linux"`，而非 `"ohos"`

```qml
Qt.platform.os === "ohos"    // false（鸿蒙下 os 返回 "linux"）
Qt.platform.os === "linux"   // true，但无法区分鸿蒙与 Linux 桌面
```

**根因（Qt 上游实现缺陷）**：`QQmlPlatform::os()`（`qtdeclarative/src/qml/qml/qqmlplatform.cpp:59`）的 `#ifdef` 链**缺少 `Q_OS_OHOS` 分支**；而 `qsystemdetection.h:115-117` 中 `__OHOS__` 同时定义了 `Q_OS_OHOS` **和** `Q_OS_LINUX`，于是命中 `Q_OS_LINUX → "linux"`。这与同平台 `QSysInfo::productType()` 返回 `"ohos"`（`qglobal.cpp:2718`，有 `Q_OS_OHOS` 分支）不一致——属 Qt 内部不一致，应向上游反馈修复。

### 临时方案：用 `pluginName` 判断（上游修复前过渡）

鸿蒙 QPA 插件 key 为 `"ohos"`（`qtbase/src/plugins/platforms/ohos/ohos.json` 的 `Keys`、`qohosplatformplugin.cpp:23` 的 `key.compare("ohos")`），`Qt.platform.pluginName` 正好返回它：

```qml
readonly property bool isHarmony: Qt.platform.pluginName === "ohos"
```

> ⚠️ `pluginName` 依赖运行时加载的 QPA 插件；用 `-platform offscreen` 等测试环境跑时值会变。绝对可靠用 C++ 编译期 `#ifdef Q_OS_OHOS` 注入 context property。

### C++ 侧判断

```cpp
// 运行时
const bool isHarmony = QSysInfo::productType() == "ohos";  // qglobal.cpp:2718 有 Q_OS_OHOS 分支

// 编译期（最可靠，零运行时开销）
#ifdef Q_OS_OHOS
    // 鸿蒙特有代码
#endif
```

> **注意**：`QSysInfo::productType()` 返回 `"ohos"`，`Qt.platform.os` 返回 `"linux"`——两者实现不同，**不要互相印证**。

### 设备类型判断：Qt 框架不导出，须走 Node-API

> **结论**：Qt（含 QtOhosExtras）**没有**任何鸿蒙设备类型（phone/tablet/2in1/tv/car/wearable）判断的公开接口。

**源码验证**（Qt 5.15.16 OHOS commit `962aa625`）：

1. **QtOhosExtras 公开头文件无设备类型接口**：`qtohosextras/src/ohosextras/` 全部公开头（appcontext/want/startrequest/sharekit/pasteboard/...）中**没有** deviceType/deviceInfo/deviceProfile 类符号。
2. **Qt 标准平台 API 只判"系统"不判"设备"**：`productType()`→`"ohos"`、`Qt.platform.os`→`"linux"`、`pluginName`→`"ohos"`，均不返回设备形态。
3. **框架内部有设备类型判断，分两层**：
   - **✅ 可用层 `QOhosDeviceInfo`（QtCore 私有导出，Q_CORE_EXPORT）**：`QtCore/private/qohosdeviceinfo_p.h` 的 `is2in1()`/`isPhone()`/`isTablet()`/`sdkApiVersion()`/`tryGetRecognizedDeviceType()`。符号**导出在 libQt5Core.so**，应用可 `#include <QtCore/private/qohosdeviceinfo_p.h>`（qmake `QT += core-private`）并 link。但 **`RecognizedDeviceType` 仅 `_2in1/tablet/phone` 三档**，无 tv/car/wearable。
   - **❌ 不可用层（QPA 插件内部，不导出/不可 include）**：`qohosruntimedevicetypeandmode.h` 的 `queryQOhosRuntimeDeviceAndMode()`/`isHandheldDeviceType()`、`qohossettings.h` 的 `QOhosSettings::isWindowPcModeEnabled()`。它们只是 `QOhosDeviceInfo` 的二次封装，头文件不在 SDK、符号 `-fvisibility=hidden`。
   - **数据源**：两层最终都来自 `qohosjsmain.cpp` 启动时 `eval("@ohos.deviceInfo")` → `QOhosDeviceInfo::init(map)` 填充的静态缓存。即 **`QOhosDeviceInfo` 本质就是 `@ohos.deviceInfo` 的 C++ 缓存壳**。

**用私有入口的代价**：①无 ABI 承诺（头文件明文 may change/remove without notice）；②依赖 QPA init 时机，过早调用拿空值；③仅三档设备类型；④本质是系统 deviceInfo 缓存。

**推荐方案**：直接走 Node-API 调 `@ohos.deviceInfo` 取 `deviceInfo.deviceType`——数据等价、鸿蒙公开稳定 API、粒度全、无 Qt 版本耦合。仅当需与 QPA 判断口径完全一致、且能接受 Qt 强耦合时，才用 `QOhosDeviceInfo`。

### 上游修复建议

建议 Qt 在 `QQmlPlatform::os()` 增加 `Q_OS_OHOS` 分支，返回 `"ohos"`：

```diff
 QString QQmlPlatform::os()
 {
 #if defined(Q_OS_ANDROID)
     return QStringLiteral("android");
+#elif defined(Q_OS_OHOS)
+    return QStringLiteral("ohos");
 #elif defined(Q_OS_IOS)
     return QStringLiteral("ios");
 #elif defined(Q_OS_TVOS)
     return QStringLiteral("tvos");
 #elif defined(Q_OS_MAC)
     return QStringLiteral("osx");
 #elif defined(Q_OS_WINRT)
     return QStringLiteral("winrt");
 #elif defined(Q_OS_WIN)
     return QStringLiteral("windows");
 #elif defined(Q_OS_LINUX)
     return QStringLiteral("linux");
```

**要点**：
- 分支须置于 `Q_OS_LINUX` **之前**——`Q_OS_OHOS` 隐含 `Q_OS_LINUX`（同 `Q_OS_ANDROID` 置于 `Q_OS_LINUX` 之前的既有模式）。
- 与 `QSysInfo::productType()`（已返回 `"ohos"`）保持一致，消除 Qt 内部不一致。
- 修复后 QML 可用 `Qt.platform.os === "ohos"` 正常判断，临时 `pluginName` 方案即可移除。
- **兼容性**：行为变更，影响依赖 `os==="linux"` 的 OHOS 代码与 `QFileSelector` 平台选择器（若用 "linux"）。建议 release notes 标注。Qt6 同适用（`os()` 实现一致）。

## 应用启动与参数传递

### main(int argc, char *argv[])
- `argv[0]` 是应用库路径，**不是**传统可执行文件路径
- 通过 Want 传参时，`want.uri` 可能占用 `argv[1]`
- **不要假设**业务参数从 `argv[1]` 开始
- 应根据 `argc/argv` 实际内容解析

### 启动进程/实例
- **不要**用桌面思维"给路径启动进程"
- 使用 Ability/Want 接口：
  - `QtOhosExtras::startAbility()` — 启动 Ability
  - `QtOhosExtras::startNewAbilityInstance()` — 启动新实例
  - `QtOhosExtras::startAppProcess()` — 启动应用进程

### QProcess

> 详见 [[qt-harmonyos-api-mapping]] §1 进程管理（决策树 + Before/After）。

### 无 UI 子进程
- `QtOhosExtras::QOhosAppContext::startNoUiChildProcess()` — 使用鸿蒙 Child Process Manager
- 进入 NoUiChildProcess 模式后，UI 渲染管线不初始化
- 用 `isNoUiChildMode()` 检测状态
- **禁止**在此模式下创建或操作窗口/UI

## 窗口类型与关系

### QDialog / Qt::Popup / Qt::ToolTip / Qt::Tool
- 在鸿蒙上行为类似**子窗口**（非独立顶层窗口）
- 父子关系严格执行，激活/关闭行为依赖主窗口
- **必须**显式设置 parent 或 transientParent

### setParent() / Reparenting
- 鸿蒙对父子关系调整有额外限制
- **不要**将外部嵌入窗口视为标准父窗口

## 模态、最小化、全屏

### Qt::WindowModality

> **源码验证**（Qt 5.12.12 OHOS commit `613336de`）：鸿蒙**不支持桌面语义的应用级模态**。QPA 将 `Qt::WindowModality` 映射为鸿蒙 `@ohos.window.ModalityType` 枚举（`WINDOW_MODALITY` / `APPLICATION_MODALITY`），经 `setSubWindowModal` 接口生效，但有多层限制。

- 模态**仅对子窗口生效**——主窗口设模态被 QPA 在两处 early-return 丢弃（`qohosview.cpp:910`、`qohoswindowproxy.cpp:967`）
- `Qt::ApplicationModal` **不等于桌面全局模态**：
  - QPA 打印警告 `ApplicationModal policy is unsupported by the platform`（`qohosview.cpp:914`），但实际仍映射为 `APPLICATION_MODALITY` 传给鸿蒙（**非**降级为 `WINDOW_MODALITY`——源码警告措辞略误导）
  - 仅当 `QOhosSettings::isWindowPcModeEnabled()` 为真——即 **2in1 设备**或**平板开启 PC 窗口模式**（自由多窗状态）——才生效；否则 `setSubWindowModalEnabled` 直接 `return` 跳过（`qohoswindowproxy.cpp:971`）
  - PC 模式判定：`qohossettings.cpp:98`（`is2in1()` ‖ 系统设置 `window_pcmode_switch_status=="true"`）
- **不要依赖**传统桌面全局应用级模态；手机端 `ApplicationModal` 完全无效（静默跳过）

**调用链**：`QWindow::setModality` → `modalityChanged` →（`qohosfloatingwindow.cpp:351`）→ `QOhosView::setModality`（`qohosview.cpp:765`）→ `updateWindowModality`（`qohosview.cpp:907`，做子窗口/警告检查）→ `mapQtWindowModalityToOhosOrDefault`（`qohosview.cpp:55`，WindowModal→WINDOW_MODALITY / ApplicationModal→APPLICATION_MODALITY）→ `setSubWindowModalEnabled`（`qohoswindowproxy.cpp:965`，做主窗口/PC 模式检查）→ 鸿蒙 JS `setSubWindowModal(true, ModalityType)`

### showFullScreen()
- 支持，运行时调用可切换全屏
- **首个主窗口**与后续窗口创建路径不同：首个可能不支持"启动即全屏"
- **建议**：窗口创建显示后再调用 `showFullScreen()`

### showMinimized()
- **仅主窗口**支持最小化
- 子窗口不支持桌面风格的最小化

### hide()
- **主窗口**：优先系统级隐藏（需系统托盘），不支持则回退到最小化
- **子窗口/浮窗**：隐藏当前窗口，但不携带主窗口级"隐藏"语义
- **不要**在 `closeEvent()` 中用 `hide()` 作为通用"关闭替代"
- 主窗口保活优先用 `showMinimized()`

## 窗口标志与标题栏

### MinimizeButtonHint / MaximizeButtonHint / CloseButtonHint
- 主要针对主窗口，通常仅 PC 模式有效
- **不要假设**这些标志在不同设备/窗口类型下稳定生效

### Qt::FramelessWindowHint
- 主窗口和子窗口隐藏系统装饰
- 主窗口启用后标准三按钮(最小/最大/关闭)也不可用

### Qt::WindowStaysOnTopHint
- 仅主窗口 + PC 模式

### 系统拖拽移动 startSystemMove ↔ startMoving()

无边框窗口（`Qt::FramelessWindowHint`）自定义标题栏拖拽移动场景。鸿蒙侧系统级窗口移动 API 实为 `window.Window.startMoving()`（API 14+，无参）、`startMoving(offsetX, offsetY)`（API 15+）和 `stopMoving()`（API 15+）——公开文档中**没有**名为 `startSystemMove` 的鸿蒙 API，"startSystemMove" 是 Qt 侧命名。

| Qt 接口 | 版本 | 说明 |
|---------|------|------|
| `QPlatformWindow::startSystemMove(QPoint)` | ≥5.11 | 平台虚函数，基类默认返回 `false`（no-op）|
| `QWindow::startSystemMove()` | **Qt6 新增** | 公开便捷方法，无参，返回 bool |

**OHOS QPA 接通链路**（5.12/5.15/6 均有，源码 `qohosfloatingwindow.cpp`）：
`QOhosFloatingWindow::startSystemMove()` → `QOhosView::startMoving()` → `QOhosWindowProxy::startMoving()` → ArkTS 侧 `jsWindowRef` eval/call `"startMoving()"`（5.x 用 `evalToPromiseOrRejectOnThrow`，Qt6 用 `call<QNapi::Promise>`）。

**关键**：`createPlatformWindow` 工厂对**几乎所有顶层窗口**（主窗口、Tool、Dialog 等普通窗口）都创建 `QOhosFloatingWindow`，仅 `QFileDialogClassWindow` 原生对话框和 UIExtension 窗口走基类——因此**主窗口也走这条链路**，`startSystemMove` 在主窗口上是接通的。

**是否真正移动取决于鸿蒙策略**：`startMoving()` 对系统窗口/子窗口/全局悬浮窗/模态窗生效；对**应用主窗口仅在自由窗口（FLOATING）状态下生效**，否则返回 `801`/`1300004`。移动端/非自由窗口设备调用返回 `801`。

**调用方式**：
- Qt6：`window->startSystemMove()`
- Qt5.12/5.15：无公开 `QWindow::startSystemMove()`，走 `window->handle()->startSystemMove(pos)`（`QPlatformWindow` 公开虚函数）
- 典型在自定义标题栏的 mousePress / `onTouch(TouchType.Down)` 中调用

## 窗口形状与裁剪

### setMask()
- **仅子窗口**有效，主窗口不支持
- 主窗口特殊外观用内容级裁剪或自定义绘制

## 窗口几何持久化

- 依赖 `QtOhosExtras::setMainWindowGeometryPersistenceHint()`
- 仅针对**首个主窗口**
- 必须在首个主窗口显示前设置
- 目前仅 **2in1 设备**支持

## 窗口关闭语义

### closeEvent(QCloseEvent *)
- 关闭事件可能来自用户操作或系统 Ability 生命周期终止
- **不要**把所有 `closeEvent()` 当"用户点了关闭按钮"
- 需区分窗口关闭和生命周期终止

## 原生窗口句柄

### QWindow::winId()
- 鸿蒙上返回的是 Qt 内部私有结构，**不是**原生窗口句柄
- 类型和布局可能随时变更
- `QtOhosExtras::tryGetNativeWindowId(QWindow *)` 返回 ArkTS 侧 WindowProperties.id
  - 但官方警告：不保证应用生命周期内有效，使用后稳定性/性能可能差

### setSurfaceConsumer（获取 OHNativeWindow* 的公开路径）

> **源码验证**（Qt 5.15.16 OHOS commit `962aa625`，tqtc/harmonyos-5.15.16 分支）

QPA 插件通过 `platformFunction("setSurfaceConsumer")` 暴露 `OHNativeWindow*`，这是 Qt 内部 **唯一公开** 的获取原生窗口句柄的路径。`winId()` 不返回 OHNativeWindow。

**注册**（`qohosplatformnativeinterface.cpp`）：
```cpp
} else if (functionName == "setSurfaceConsumer") {
    return reinterpret_cast<QFunctionPointer>(&QOhosPlatformWindow::setSurfaceConsumer);
}
```

**签名**（`qohosplatformwindow.h`）：
```cpp
static std::shared_ptr<void> setSurfaceConsumer(
    QWindow *targetWindow,
    QObject *surfaceConsumerContext,
    std::function<void(QOhosOptional<void *>)> surfaceConsumer);
```

**回调中的 `void*`** 是 `QOhosSurface::nativeWindow()` 返回的 `OHNativeWindow*`。回调在 surface 创建/销毁/变化时触发（包括初始 surface 和 `surfaceStatusChanged` 信号）。返回的 `shared_ptr<void>` 是句柄，析构时自动注销 consumer。

**QtMultimedia 已在用**（`qtmultimedia/src/plugins/ohos/src/mediaplayer/qohosvideowidget.cpp`）：
```cpp
auto setSurfaceConsumerFunc = reinterpret_cast<...>(
    qApp->platformFunction("setSurfaceConsumer"));
m_surfaceConsumerHandle = setSurfaceConsumerFunc(
    m_displayWindow.get(), this,
    [this](QOhosOptional<void *> nativeSurface) {
        m_playerControl->setVideoSurface(
            static_cast<::OHNativeWindow *>(nativeSurface.value()));
    });
```

**使用场景**：
- C++ 应用：直接 `qApp->platformFunction("setSurfaceConsumer")` 获取函数指针
- Python/PyQt5 应用：需通过 ctypes + C++ shim .so 桥接（PyQt5 sip 未暴露 `platformFunction`）
- 典型用途：将 OHNativeWindow 传给三方渲染库（libvlc、OpenGL 等）

**注意**：`QOhosOptional` 是 Qt OHOS QPA 内部类型，二进制布局兼容性需在编译时验证。

## 参考来源

- [Qt for HarmonyOS API Compatibility Notes](https://wiki.qt.io/Qt_for_HarmonyOS/api_inconsistencies_on_harmonyos)
