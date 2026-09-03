---
id: semantic-qt-harmonyos-porting-workflow
type: semantic
domain: tech
tags: [qt, harmonyos, porting, workflow, decision-tree]
created: 2026-06-02
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-api, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-modules, semantic-qt-ohos-extras]
summary: >
  面向 Qt 应用的 HarmonyOS 移植编排：将公共库中的生命周期、窗口模型与平台限制
  落到 Qt/QPA、QtOhosExtras、构建系统和模块验收的 8 步适配流程。
---

# Qt 鸿蒙移植 8 步决策树工作流

本文是 **Qt 适配层的流程枢纽**，不重复维护 HarmonyOS 平台规范。开始移植前，先以公共知识库中的以下页面作为规范事实来源：

- Stage/UIAbility 生命周期：[[ohos-common-kb/semantic/stage-uiability-lifecycle|公共库：Stage/UIAbility 生命周期]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/stage-uiability-lifecycle.md)）
- ArkUI 窗口与 XComponent 模型：[[ohos-common-kb/semantic/arkui-window-xcomponent-model|公共库：ArkUI 窗口与 XComponent 模型]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/arkui-window-xcomponent-model.md)）
- HarmonyOS 平台限制：[[ohos-common-kb/semantic/harmonyos-platform-limits|公共库：HarmonyOS 平台限制]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-platform-limits.md)）

下文只回答这些公共约束如何映射到 Qt 应用、QPA 插件和 QtOhosExtras。

## 五条核心原则

在动手移植之前，必须建立以下五个关键认知，它们贯穿整个移植流程：

### 原则 1：显式审查 Qt 的 Linux 兼容分支

`Q_OS_OHOS` 会与部分 Linux 条件重叠，因此 `#ifdef Q_OS_LINUX` 可能在 HarmonyOS 构建中命中。逐项审查这些分支，把平台能力结论交给公共平台限制页维护，在 Qt 侧只记录需要替换的类、调用点与构建条件。

### 原则 2：区分 Qt 事件循环与 ArkUI 运行时

Qt 事件循环、QPA 平台插件与 ArkUI/Ability 运行时各有线程和回调约束。不要把所有跨边界调用笼统等同于 N-API；应优先使用 QtOhosExtras 或 QPA 已封装的接口，并在自定义桥接处明确线程归属和投递方式。

### 原则 3：把 Stage/UIAbility 事件映射到 Qt 生命周期

Qt 应用仍从 `main()` 进入，但其创建、前后台切换、Want 投递与销毁由 Stage/UIAbility 承载。先理解公共生命周期，再决定 Qt 信号、`closeEvent()` 和 QtOhosExtras 回调如何响应；不要用单一“进程启动”模型解释所有场景。

### 原则 4：显式维护 QWindow 到系统窗口的映射

公共窗口模型定义系统侧约束；Qt 适配关注首个 `QWindow`、后续顶层窗口、`transientParent` 和子窗口标记如何经 QPA 落到该模型，以及 `show()` / `winId()` 前后的时序。

### 原则 5：让 Qt 文件与插件路径服从沙箱

以公共平台限制页为准审查 `QFile`、`QStandardPaths`、`QPluginLoader` 和第三方库加载路径。Qt 页只维护这些限制对 Qt API 的表现、替代接口和验收方法。

---

## Step 1：扫描平台相关代码

在整个应用代码库中搜索以下模式，建立完整的移植清单。

### 平台宏

搜索所有平台条件编译宏：

```
Q_OS_WIN
Q_OS_LINUX
Q_OS_ANDROID
Q_OS_MAC / Q_OS_MACOS / Q_OS_DARWIN
```

> 注意：`Q_OS_LINUX` 在鸿蒙上也会命中（因为 `Q_OS_OHOS` 隐含 `Q_OS_LINUX`），需要检查所有 `Q_OS_LINUX` 分支中的代码是否兼容鸿蒙。

### 平台相关 API

以下 API 在鸿蒙上行为不同或不可用，需逐一排查：

```
QProcess                        — 进程管理（无界面可用，有界面按 Qt/非Qt 改 startAppProcess/startAbility）
QDesktopServices                — 桌面服务（openUrl 等）
QFileDialog                     — 原生文件对话框
QSystemTrayIcon                 — 系统托盘图标
QClipboard                      — 剪贴板
setMask()                       — 窗口遮罩（仅子窗口有效）
showFullScreen()                — 全屏显示（有时序要求）
showMinimized()                 — 最小化（子窗口不支持）
chmod() / fchmod()              — 权限修改（不支持）
symlink()                       — 符号链接（第三方应用不可用）
dlopen()                        — 动态加载（拒绝可写路径）
QStandardPaths                  — 标准路径（部分 location 返回空）
```

### 构建配置中的平台分支

```qmake
# .pro 文件中的平台条件块
win32 { ... }
unix { ... }
android { ... }
macx { ... }
```

```cmake
# CMake 中的平台条件
if(WIN32) ...
if(UNIX AND NOT APPLE) ...
if(ANDROID) ...
```

> **Step 1 输出**：一份列出所有需要替换或适配的代码位置的完整清单。

---

## Step 2：API 映射替换

对 Step 1 发现的每个平台模式，按以下映射表进行替换：

### 进程管理

> 四场景决策树（无界面保留 QProcess / 有界面 Qt 用 startAppProcess / 有界面非 Qt 用 startAbility / 无界面需托管用 startNoUiChildProcess）详见 [[qt-harmonyos-api-mapping]] §1 进程管理。

### 服务与交互

| 源模式 | 鸿蒙替代方案 |
|--------|-------------|
| `QDesktopServices::openUrl()` | `QtOhosExtras::startAbility()` 配合 Want URI |
| 独立 `QDialog` / `QPopup`（无 parent） | 使用 `QOhosFunctions::tagWindowOrWidgetAsSubWindowOf()` 标记 |

### 窗口相关

| 源模式 | 鸿蒙替代方案 |
|--------|-------------|
| `showFullScreen()` 用于首个窗口 | 必须在窗口创建显示**之后**再调用 |
| `QFile::setPermissions()` | 不支持（对已有文件为 no-op，静默失败） |
| `QFile::link()` / `symlink()` | 第三方应用不可用 |

### 路径与参数

| 源模式 | 鸿蒙替代方案 |
|--------|-------------|
| `QStandardPaths::PublicShareLocation` | 返回空字符串，不支持 |
| `argv[0]` 作为可执行文件路径 | ❌ OHOS 上 `argv[0]` 是**库路径**（.so 路径），不是可执行文件路径 |
| `closeEvent()` 假设来自用户点击 | 必须用 `QtOhosExtras::getCloseEventRootCause(event)` 区分关闭来源 |

> 完整 API 差异详情见 [[qt-harmonyos-api]]，QtOhosExtras 用法见 [[qt-ohos-extras]]。

---

## Step 3：适配窗口管理

以公共 ArkUI 窗口模型为基线，逐个确认 QPA 如何把 `QWindow` / `QWidget` 映射为系统主窗口或子窗口；本步骤只记录 Qt 侧绑定与调用时序。

### 窗口绑定规则

- **首个** `QWindow` / `QWidget`（无 parent 的顶层窗口）自动绑定到系统首个主窗口
- **后续**创建的顶层窗口默认成为**新的主窗口**，除非被标记为子窗口
- `QDialog` 如果设置了 `transientParent`，可正常工作，无需手动标记

### 关键操作：标记子窗口

```cpp
#include <QtPlatformHeaders/QOhosFunctions>

// ⚠️ 必须在 show() 或 winId() 之前调用！
QOhosFunctions::tagWindowOrWidgetAsSubWindowOf(
    widget,
    mainWindow->windowHandle()
);
```

> **时序是硬性要求**：`tagWindowOrWidgetAsSubWindowOf()` 必须在 `show()` 和 `winId()` 之前调用，否则标记无效。

### 窗口限制清单

| 限制 | 说明 |
|------|------|
| `setMask()` 仅子窗口有效 | 主窗口调用 `setMask()` 无效果 |
| 子窗口不支持最小化 | 子窗口调用 `showMinimized()` 无效 |
| 首个主窗口不能启动时全屏 | 需先创建显示窗口，之后再调用 `showFullScreen()` |
| 主窗口 `hide()` 回退为最小化 | 在无系统托盘的情况下，`hide()` 实际执行最小化 |

---

## Step 4：适配应用生命周期

先按公共 Stage/UIAbility 生命周期确认系统事件，再把事件映射到 Qt 入口、信号和关闭处理。以下内容是 Qt 适配，不是生命周期规范的副本。

### 入口与启动

- `main()` 仍然是应用入口点，但语义不同——应用启动由系统 Ability 框架管理
- 使用 `QtOhosExtras::startAbility()` 替代传统的进程启动方式
- 不要依赖 `argv[0]` 获取可执行文件路径（OHOS 上它是库路径）

### 跨应用通信

处理 `newWantReceived` 回调来实现应用间通信，替代传统的进程间通信方式。

### 关闭事件处理

`closeEvent()` 可能来自多种来源（用户点击、Ability 生命周期终止、WindowStage 关闭），必须检查根因。详见 [[qt-harmonyos-lifecycle]] §3 级关闭拦截（WindowStageClose / AbilityClose / InternalClose 三级区分）。

### 可选：跨设备接续

```cpp
// 获取接续数据
auto data = QtOhosExtras::tryGetOnContinueData(want);

// 监听跨设备接续请求
connect(abilityContext, &QOhosAbilityContext::continueRequestReceived,
        this, &MyApp::onContinueRequest);
```

---

## Step 5：检查平台限制对 Qt 的影响

公共平台限制页维护限制本身及其依据；这里仅保留 Qt API 的影响检查，判断是否需要包装、替代或裁剪功能：

| Qt 检查面 | 本阶段动作 | 通过条件 |
|-----------|-----------|----------|
| `QFile` / `QFileInfo` | 列出权限变更、链接创建和系统路径探测调用，逐项对照 common 平台限制 | 不依赖未经验证的 POSIX 文件语义 |
| `QLibrary` / `QPluginLoader` | 记录每个 native artifact 的打包位置和加载入口，对照 common loader/沙箱契约 | 插件只从已验收的交付位置加载 |
| `QTimeZone` | 在目标设备执行时区枚举与转换回归，后端选择由 common 能力结论驱动 | 所需时区用例在目标设备通过 |
| `QFontDatabase` | 枚举应用实际需要的字体族；缺失时由 Qt 资源携带应用自有字体 | UI 不依赖未声明的平台字体目录 |
| native 依赖闭包 | 对最终 HAP 中的 ELF 运行 common artifact 检查，再验证 Qt target 的 `DT_NEEDED` | ABI、依赖和加载验证全部通过 |

> Qt 侧兼容表现与 QTBUG 追踪见 [[qt-harmonyos-platform-limits]]；平台限制的规范事实以本文开头链接的公共页面为准。

---

## Step 6：适配构建系统

### qmake（.pro 文件）

```qmake
ohos {
    QT += ohosextras
    # OHOS 专有源文件和库
}
```

### CMake

```cmake
if(OHOS)
    find_package(Qt5 COMPONENTS OhosExtras REQUIRED)
    target_link_libraries(${PROJECT_NAME} Qt5::OhosExtras)
endif()
```

> ⚠️ **使用任何 OHOS 专有 API 时，必须添加 `QT += ohosextras`（qmake）或 `find_package(Qt5 COMPONENTS OhosExtras)`（CMake）。**

---

## Step 7：添加 OHOS 专有功能（可选）

基础移植完成后，可选增强以下鸿蒙特有能力：

| 功能 | API | 调用时机 |
|------|-----|---------|
| 浮窗 | `QtOhosExtras::setShowWindowAsFloatWindowHint(widget, true)` | `show()` 之前 |
| 深色/浅色主题跟随 | `QOhosAppContext::setColorThemeMode(FollowSystemSetting)` | 应用初始化时 |
| 应用分享 | `QtOhosExtras::ShareKit::shareDataWithShareKit()` | 用户触发分享时 |
| 跨设备接续 | `QOhosAbilityContext::continueRequestReceived` 信号 | 按需实现 |
| 全屏（第 2+ 窗口） | `widget->showFullScreen()` | 窗口创建之后 |
| 进程内嵌入子窗口 | `winId()` 或设置 `Qt::WA_NativeWindow` 属性 | 嵌入场景 |
| 跨进程嵌入 | `QEmbeddedUiExtensionAbility` | 嵌入场景 |

### 主题适配示例

```cpp
auto *ctx = QtOhosExtras::QOhosAppContext::instance();
ctx->setColorThemeMode(QtOhosExtras::QOhosAppContext::ColorThemeMode::FollowSystemSetting);

// 查询当前是否深色模式
bool isDark = ctx->darkThemeActive();
```

### 分享示例

```cpp
auto record = QtOhosExtras::ShareKit::createContentRecord(mimeType, text);
auto ability = QtOhosExtras::QOhosAbilityContext::getInstanceForMainWindow(
    window.windowHandle()
);
ability->shareDataWithShareKit({record}, nullptr);
```

> 详见 [[qt-ohos-extras]]。

---

## Step 8：验证模块支持

确认应用使用的所有 Qt 模块在 OHOS 平台上受支持。

### 核心模块 — 全部支持 ✅

```
QtCore, QtGui, QtWidgets, QtQML, QtQuick, QtQuickControls,
QtNetwork, QtSQL, QtMultimedia
```

### 不支持的模块 — 需找替代方案 ❌

| 模块 | 说明 | 替代方案 |
|------|------|---------|
| **Qt WebEngine** | 不支持 | 使用系统 WebView 或跳转外部浏览器 |
| **Qt D-Bus** | 鸿蒙无 D-Bus | 使用鸿蒙 IPC 机制 |
| **Qt Remote Objects** | 不在支持范围内 | — |
| **Qt Serial Bus** | Windows/Linux 专属 | — |
| **Qt Virtual Keyboard** | 不在支持范围内 | 使用系统输入法 |
| **Active Qt** | Windows 专属 | 不适用 |
| **Qt Win Extras / X11 Extras / Mac Extras** | 平台专属 | 不适用 |

### 部分支持

- **Qt PDF** — 仅 Qt 5.15
- **Qt Quick Timeline** — 仅 Qt 5.15

> 完整模块适配状态表见 [[qt-harmonyos-modules]]。

---

## 重要提醒清单

以下是移植过程中最容易踩坑的 8 条规则，需反复检查：

1. **`QT += ohosextras` 必须添加** — 使用任何 OHOS 专有 API 时，构建系统中必须包含 ohosextras 模块
2. **窗口标记函数必须在 `show()` / `winId()` 之前调用** — 之后调用无效，窗口已被错误绑定
3. **`argv[0]` 是库路径，不是可执行文件路径** — 不要用 `argv[0]` 拼接资源路径或启动子进程
4. **拖放事件：仅在 `dropEvent` 中获取实际数据** — `dragEnterEvent` 和 `dragMoveEvent` 中只有 MIME 类型信息，实际数据只在 `dropEvent` 中可用
5. **首个主窗口不能在启动时全屏** — 必须先创建并显示窗口，之后再调用 `showFullScreen()`
6. **主窗口 `hide()` 回退为最小化** — 在无系统托盘时，`hide()` 不会真正隐藏窗口
7. **子窗口不支持最小化** — 子窗口调用 `showMinimized()` 无效果
8. **子进程按场景选**（2026-07-21 修正）— 无界面 `QProcess` 可用；有界面 Qt 用 `startAppProcess()`，有界面非 Qt 用 `startAbility()`；无界面需托管用 `startNoUiChildProcess()`。不要用裸 QProcess 起带界面子进程

---

## 移植完成检查清单

完成 8 步后的最终确认：

- [ ] 所有 `Q_OS_*` 宏分支已添加 `Q_OS_OHOS` 处理
- [ ] 子进程已按场景处理：无界面 `QProcess` 保留 / 有界面 Qt `startAppProcess` / 有界面非 Qt `startAbility` / 需托管 `startNoUiChildProcess`
- [ ] 所有无 parent 的顶层窗口已标记为子窗口（使用 `tagWindowOrWidgetAsSubWindowOf`）
- [ ] 窗口标记函数在 `show()` / `winId()` 之前调用
- [ ] `closeEvent()` 已通过 `getCloseEventRootCause()` 处理 Ability/WindowStage 级别的关闭
- [ ] 不依赖 `chmod()`、`symlink()`、可写路径 `dlopen()`
- [ ] `.pro` / CMake 已添加 `ohos` 条件和 `QT += ohosextras`
- [ ] 应用使用的所有 Qt 模块在 OHOS 上受支持
- [ ] `argv[0]` 未作为可执行文件路径使用
- [ ] 拖放事件的数据获取仅在 `dropEvent` 中进行
- [ ] 首个主窗口启动时未直接全屏
- [ ] 主窗口 `hide()` 行为已验证（回退为最小化）

---

## 相关

- [[ohos-common-kb/semantic/stage-uiability-lifecycle|公共库：Stage/UIAbility 生命周期]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/stage-uiability-lifecycle.md)）
- [[ohos-common-kb/semantic/arkui-window-xcomponent-model|公共库：ArkUI 窗口与 XComponent 模型]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/arkui-window-xcomponent-model.md)）
- [[ohos-common-kb/semantic/harmonyos-platform-limits|公共库：HarmonyOS 平台限制]]（[稳定链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-platform-limits.md)）
- [[qt-harmonyos-api]] — API 兼容性详情
- [[qt-harmonyos-platform-limits]] — 平台限制与 QTBUG 编号
- [[qt-harmonyos-modules]] — 模块适配状态表
- [[qt-ohos-extras]] — QtOhosExtras 模块 API 参考

## 参考来源

- Qt Application Porting to HarmonyOS (SKILL.md) — Agent Skill 决策树工作流定义
- [Qt for HarmonyOS Wiki](https://wiki.qt.io/Qt_for_HarmonyOS)
- [API Compatibility Notes](https://wiki.qt.io/Qt_for_HarmonyOS/api_inconsistencies_on_harmonyos)
- [User Development Guide](https://wiki.qt.io/Qt_for_HarmonyOS/user_development_guide)
