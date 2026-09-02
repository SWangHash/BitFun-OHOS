---
id: semantic-qt-harmonyos-window-model
type: semantic
domain: tech
tags: [qt, harmonyos, window, mainwindow, subwindow, tagging, floating, embedded, activateWindow, shiftAppWindowFocus, focus, highlight, transientParent]
created: 2026-06-02
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-api, semantic-qt-ohos-extras, semantic-qt-harmonyos-code-patterns, episodic-ohostemplate-blockedbymodal-patch, problem-runtime-blocked-by-modal-window-no-parent]
summary: >
  ArkUI Window/XComponent 的 Qt QPA adapter：MainWindow(有Dock/任务图标/独立生命周期) vs
  Subwindow(无Dock/属于主窗口/随主窗口关闭最小化恢复)。核心规则：
  首个窗口自动绑定、后续窗口默认新主窗口、tagging必须在show/winId之前。
  QOhosFunctions API、6种代码模式、浮窗、全屏规则、嵌入式子窗口、跨进程嵌入。
  含【QPA层】visible的来源（QWindowPrivate::visible）、OHOS系统回调链
  （window.on('windowEvent')→WINDOW_SHOWN/HIDDEN/ACTIVE/INACTIVE）、
  所有修改visible的7个位置、QOhosFloatingWindow命名陷阱、浮窗hide销毁链(setOrResetWindowProxy→destroyWindow)。
  含【激活语义】activateWindow()→@ohos.window.shiftAppWindowFocus(非 showWindow!)异步~94ms、
  D1 no-op 缺口(无focus_window时静默无效)、焦点状态≠激活态(标题灰⇒未获焦⇒Tab不响应)。
  详见 episodic/postmortems/ 下复盘(内部文档)。
---

# ArkUI 窗口模型的 Qt QPA adapter

> 另见 [[semantic-qt-harmonyos-api]] 中窗口相关 API 差异、[[semantic-qt-ohos-extras]] 中 QtOhosExtras 模块、[[semantic-qt-harmonyos-code-patterns]] 中完整代码模式。
> WindowStage/main/subwindow、XComponent/native surface、焦点、可见与可绘制状态的平台边界，以 common 的 [[ohos-common-kb/semantic/arkui-window-xcomponent-model|ArkUI 窗口与 XComponent 承载模型]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/arkui-window-xcomponent-model.md)）为准。本页保留 QPA tagging、`QWindowPrivate::visible`、Qt exposure/activation、浮窗销毁链与 Qt API 模式。

## Qt QPA 映射概念 (Concepts)

Qt QPA 将平台窗口关系映射为 **Main Window**（主窗口）和 **Subwindow**（子窗口），并在其上增加 tagging、transient parent 和 fallback 行为。平台概念本身以 common 为准；下文只描述 Qt 映射后的可观察行为。

### Main Window（主窗口）

- 代表一个独立的 **task**（任务），对应鸿蒙 Ability 层面的"任务窗口"
- **拥有 Dock 图标**——在系统 Dock 栏中可见
- **拥有任务图标**——Alt+Tab 切换时独立出现
- **独立生命周期**——不依附于任何其他窗口
- 支持完整的窗口操作：最大化、最小化、还原（windowed）
- 典型场景：应用的主界面窗口、独立的多文档编辑器窗口

### Subwindow（子窗口）

- 用于承载子功能的**独立顶层窗口**——注意：它不是 Qt 里的"子控件"，而是一个真正的独立窗口
- **没有 Dock 图标**——不会出现在系统 Dock 栏
- **没有任务图标**——Alt+Tab 切换时不可见
- **必须归属一个主窗口**——通过 tagging 或 transient parent 关联
- 生命周期受主窗口控制：
  - 主窗口关闭 → subwindow **自动关闭**
  - 主窗口最小化 → subwindow **自动隐藏**
  - 主窗口恢复 → subwindow **自动显示**
- 典型场景：对话框、工具面板、弹出菜单、提示浮层

> **关键理解**：Subwindow 的"子"指的是系统层面的归属关系，而非 Qt widget 层级中的父子关系。一个 `QWidget` 即使没有 Qt parent，也可以通过 tagging 成为 subwindow。

## 核心规则 (Core Rules)

### First Window Rule（首个窗口自动绑定）

进程中创建的**第一个** `QWindow`（或无 parent 的 `QWidget`）**自动绑定**到系统分配的首个主窗口，无需任何额外操作。

```cpp
int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    MainWindow w;
    w.show(); // 首个窗口，自动绑定到系统分配的主窗口
    return app.exec();
}
```

这是最常见也是最简单的场景——绝大多数单窗口应用只需 `show()` 即可。

### Subsequent Windows Rule（后续窗口默认新主窗口）

任何非首个创建的 `QWindow`/`QWidget`，如果**没有 parent** 且**未被 tagging 为 subwindow**，将自动成为一个**新的主窗口**（拥有独立的 Dock 图标和任务图标）。

```cpp
void MainWindow::openNewMainWindow() {
    MainWindow *newWin = new MainWindow();
    newWin->show(); // 未 tagging → 自动成为新的主窗口
}
```

如果需要后续窗口作为 subwindow 存在，**必须**在 `show()` 之前手动 tagging。

### Tagging Function（标签机制）

```cpp
#include <QtPlatformHeaders/QOhosFunctions>

QOhosFunctions::tagWindowOrWidgetAsSubWindowOf(
    QObject *windowOrWidgetToTag,  // 要被标记为子窗口的窗口或 widget
    QWindow *mainWindow            // 所属的主窗口
);
```

**调用时序要求（严格）**：

1. **必须在主窗口创建之后调用**——`mainWindow` 参数必须是一个已创建的 `QWindow`
2. **必须在子窗口 `show()` 之前调用**——一旦窗口显示，标签将不再生效
3. **必须在子窗口 `winId()` 之前调用**——`winId()` 会触发原生句柄创建，此时窗口属性已被固化

```cpp
// 正确顺序
QWidget *panel = new QWidget();
QOhosFunctions::tagWindowOrWidgetAsSubWindowOf(panel, mainWindow->windowHandle());
panel->show();  // tagging 在 show 之前 ✓

// 错误顺序
QWidget *panel = new QWidget();
panel->show();  // 已经 show 了
QOhosFunctions::tagWindowOrWidgetAsSubWindowOf(panel, mainWindow->windowHandle()); // ✗ 无效！
```

如果 `mainWindow` 参数无效（如已销毁），对特定窗口类型会触发自动回退机制（见下文）。

### Transient Parent（瞬态父窗口自动绑定）

对于原生支持 transient parent 的控件（如 `QDialog`），如果构造时传入了 parent widget，Qt 会**自动**将 parent 关联的主窗口作为子窗口的归属——**无需手动 tagging**。

```cpp
// 推荐做法：传 parent，自动绑定
QDialog *dlg = new QDialog(this); // 'this' 是主窗口或其子 widget
dlg->exec(); // 无需任何 tagging
```

这是最推荐的对话框使用方式，既简洁又安全。

### Auto-Fallback（自动回退机制）

当 tagging 指定的 `mainWindow` 无效时，对以下窗口类型会触发自动回退：

- `Qt::Popup`（弹出式窗口）
- `Qt::ToolTip`（工具提示）
- `Qt::Dialog`（对话框）
- `Qt::Tool`（工具窗口）

回退策略：
1. **优先选择当前焦点窗口**（focused window）作为归属主窗口
2. 如果没有焦点窗口，则使用**第一个可用的顶层窗口**
3. 确保每个窗口都能找到归属，避免成为"孤儿"主窗口

> **注意**：普通 `Qt::Window` 类型**不会**触发自动回退。如果 `mainWindow` 无效且窗口类型是 `Qt::Window`，该窗口将成为一个新的主窗口。

### Known Gap: QPA syntheticParent 不反写 transientParent

OHOS QPA 的 `determineViewTypeAndLogicalParent()` 对无 parent 的 Dialog/Tool/Popup/ToolTip 使用 syntheticParent fallback
分类为 SubWindow，并通过 `createSubWindow()` 在 ArkUI 层建立归属。**但 OHOS QPA 从不调用 `QWindow::setTransientParent()` 将
syntheticParent 反写回 Qt 层**（qohosview.cpp grep 确认零调用）。

这导致：
- Qt 层 `transientParent()` 仍为 null
- `isWindowBlocked()` 的 `isAncestorOf(IncludeTransients)` 检查失败
- `blockedByModalWindow = 1` -> 拦截 `close()` 和 `processWheelEvent()`

**影响**：所有无 parent 的 `QDialog()` 在有模态兄弟窗口时会关不掉且不能滚动。
**修复**：Qt 源码 patch 在 `showImmediate()` 中反写 transientParent，详见 [[episodic-ohostemplate-blockedbymodal-patch]]。

> **Win32 对比**：Windows 的 `CreateWindowEx(parent=NULL)` 自动设 owner=GetActiveWindow()，在系统层面兜底。
> OHOS 没有类似兜底，Qt 必须在 QPA 层自己维护这个关系。两边 blockedByModalWindow 逻辑链一致，差异仅在兜底层。

## API Reference

所有窗口相关 API 位于 `QOhosFunctions` 类中：

```cpp
#include <QtPlatformHeaders/QOhosFunctions>
```

| API | 说明 |
|-----|------|
| `tagWindowOrWidgetAsSubWindowOf(QObject *windowOrWidget, QWindow *mainWindow)` | 将窗口标记为指定主窗口的 subwindow。必须在 `show()`/`winId()` 之前调用 |
| `tagWindowOrWidgetAsMainWindow(QObject *windowOrWidget, bool forceMainWindow = true)` | 将窗口显式标记为主窗口。`forceMainWindow=true` 时强制覆盖已有标签 |
| `getWindowOrWidgetAsSubWindowOfTagValue(QObject *target)` | 查询指定窗口当前被标记为哪个主窗口的 subwindow，返回归属的 `QWindow*` |
| `setInAppOnlyPasteboardShareOption(QObject *windowOrWidget, bool inAppOnly)` | 设置剪贴板共享范围：`true` 为应用内共享，`false` 为跨应用共享 |

## 6 Common Patterns（6 种常用代码模式）

### Pattern 1：单主窗口应用

最常见的场景。首个窗口自动绑定到系统主窗口。

```cpp
int main(int argc, char *argv[]) {
    QApplication app(argc, argv);
    MainWindow w;
    w.show(); // 首个窗口，自动绑定 → 主窗口
    return app.exec();
}
```

**要点**：无需任何 tagging，无需额外 API 调用。

### Pattern 2：有 parent 的对话框（无需 tagging）

`QDialog` 构造时传入 parent widget，Qt 自动处理 transient parent 绑定。

```cpp
void MainWindow::showAboutDialog() {
    QDialog *dlg = new QDialog(this); // this = 主窗口 widget
    dlg->exec(); // 自动绑定到 this 所属的主窗口
}
```

**要点**：这是弹出对话框的推荐做法。

### Pattern 3：无 parent 的对话框（需手动 tagging）

当对话框没有 parent 时，必须手动 tagging 使其成为 subwindow。

```cpp
void MainWindow::showSettingsDialog() {
    QDialog *dlg = new QDialog(); // 无 parent
    QOhosFunctions::tagWindowOrWidgetAsSubWindowOf(
        dlg, this->windowHandle());
    dlg->exec(); // tagging 在 exec 之前
}
```

**要点**：tagging 必须在 `exec()`（内部调用 `show()`）之前完成。

### Pattern 4：多主窗口应用

需要多个独立的顶层窗口时，不 tagging 直接 `show()` 即可创建新的主窗口。

```cpp
void MainWindow::openNewMainWindow() {
    MainWindow *newWin = new MainWindow();
    newWin->show(); // 无 tagging → 新主窗口（独立 Dock 图标）
}
```

**要点**：每个新主窗口都有独立的 Dock 图标和 Alt+Tab 条目。

### Pattern 5：工具面板子窗口

创建一个工具面板，作为当前主窗口的 subwindow。

```cpp
void MainWindow::openToolPanel() {
    QWidget *panel = new QWidget();
    panel->setWindowTitle("Tools");
    QOhosFunctions::tagWindowOrWidgetAsSubWindowOf(
        panel, this->windowHandle());
    panel->resize(400, 300);
    panel->show(); // 作为 subwindow 显示
}
```

**要点**：主窗口关闭或最小化时，工具面板会自动跟随。

### Pattern 6：浮窗（Floating Window）

创建一个浮窗，覆盖在其他应用之上。

```cpp
void MainWindow::openFloatingTool() {
    QWidget *tool = new QWidget();
    QtOhosExtras::setShowWindowAsFloatWindowHint(tool, true);
    tool->setAttribute(Qt::WA_DeleteOnClose);
    tool->resize(300, 300);
    tool->show();
}
```

**要点**：`setShowWindowAsFloatWindowHint` 必须在 `show()` 之前调用。详见下方"浮窗"章节。

## 浮窗 (Floating Window)

浮窗是一种特殊的窗口类型，可以覆盖在其他应用之上显示，不被最小化操作影响。

### 使用方法

```cpp
#include <QtOhosExtras>

QWidget *tool = new QWidget();
// 必须在 show() 之前设置浮窗 hint
QtOhosExtras::setShowWindowAsFloatWindowHint(tool, true);
tool->setAttribute(Qt::WA_DeleteOnClose);
tool->resize(300, 300);
tool->show();
```

### 约束与注意事项

- **需要权限**：应用必须申请 `ohos.permission.SYSTEM_FLOAT_WINDOW` 浮窗权限，否则浮窗创建会失败
- **支持子窗口**：浮窗上可以弹出模态和非模态子窗口
- **独立显示层级**：浮窗不受主窗口最小化影响，始终保持在最上层
- **时序要求**：`setShowWindowAsFloatWindowHint()` 必须在 `show()` 之前调用，窗口显示后无法更改
- **hide() 销毁原生窗口**：对浮窗调用 `hide()` 会同步销毁原生 OHOS Window（`Window.destroyWindow()`），但 `isVisible()` 仍为 `true`、`isExposed()` 变 `false`，再 `show()` 重建。与主窗口 `hide()`（走 `hideMainWindow()` 最小化，不销毁）不同。详见下方 QPA 层 §浮窗 hide 销毁链

## 全屏主窗口 (Full-Screen Main Window)

鸿蒙系统对首个窗口和后续窗口的全屏行为有不同限制。

### 首个窗口：不能直接全屏

```cpp
// 首个窗口必须分两步
MainWindow w;
w.show();             // 第一步：先以标准模式显示
w.showFullScreen();   // 第二步：然后切换到全屏
```

**原因**：鸿蒙系统要求首个窗口必须先完成 Ability 的初始化流程（包括窗口创建和首次渲染），之后才能切换显示模式。

### 第二个及后续窗口：可以直接全屏

```cpp
void MainWindow::openFullScreenWindow() {
    QWidget *fs = new QWidget();
    // 必须 tagging，否则成为新主窗口
    QOhosFunctions::tagWindowOrWidgetAsSubWindowOf(
        fs, this->windowHandle());
    fs->showFullScreen(); // 直接全屏，无需先 show()
}
```

## 窗口几何持久化 (Window Geometry Persistence)

用于在 2-in-1 设备（如平板/笔记本混合设备）上持久化主窗口的位置和大小。

```cpp
#include <QtOhosExtras>

// 必须在首个主窗口 show() 之前调用
QtOhosExtras::setMainWindowGeometryPersistenceHint(...);

MainWindow w;
w.show(); // 窗口将恢复上次保存的几何信息
```

**限制**：
- 仅在 **2-in-1 设备**上生效
- 必须在**首个主窗口 `show()` 之前**设置
- 普通手机设备上此 API 无效果

详见 [[semantic-qt-ohos-extras]] 中的窗口相关 API 说明。

## 嵌入式子窗口 (Embedded Subwindow)

当需要在 Qt 窗口中嵌入第三方渲染器（如 CEF/Chromium Embedded Framework、SDL 等）时，需要获取原生窗口句柄。

### 使用 `winId()` 获取原生句柄

```cpp
class NativeRendererHost : public QWidget {
public:
    void bindRenderer() {
        WId wid = winId(); // 强制创建原生窗口句柄
        // 将 wid 传给第三方渲染器进行绑定
        // third_party_renderer_bind(wid);
    }
};
```

### 鸿蒙平台注意事项

> **注意**：在鸿蒙平台上，`winId()` 返回的值**不是**真正的原生窗口句柄（与 Windows/Linux 不同）。如需获取真正的原生句柄，应使用 `QtOhosExtras::tryGetNativeWindowId()`。

详见 [[semantic-qt-harmonyos-api]] 中的平台差异说明。

## 跨进程嵌入 (Cross-Process Embedding)

Qt 应用可以作为 **Provider** 被其他宿主应用通过 UIExtension 机制嵌入显示。这是鸿蒙特有的跨进程 UI 嵌入能力。

### 基础用法：单实例模式

```cpp
// Provider 端（被嵌入的 Qt 应用）
#include <QEmbeddedUiExtensionAbility>

// 在 Ability 配置中声明为 UIExtension
// module.json5 中配置 extensionAbilities
```

### 多实例模式：使用 Binding Key

当同一个 Qt 应用需要为不同宿主提供不同的 UI 实例时，通过 binding key 区分：

```cpp
#include <QtOhosExtras>

// 创建窗口 A，绑定 key "A"
auto *windowA = createWindowA();
QtOhosExtras::setBundledAbilityAndQWindowBindingKeyForQWindow(
    windowA->windowHandle(), "A");
windowA->show();

// 创建窗口 B，绑定 key "B"
auto *windowB = createWindowB();
QtOhosExtras::setBundledAbilityAndQWindowBindingKeyForQWindow(
    windowB->windowHandle(), "B");
windowB->show();
```

**要点**：
- `setBundledAbilityAndQWindowBindingKeyForQWindow()` 必须在 `show()` 之前调用
- Binding key 需要与 `module.json5` 中 UIExtension 的 `metadata` 配置对应
- 每个 binding key 对应一个独立的窗口实例

## 决策速查表

| 场景 | 做法 | 需要 tagging？ |
|------|------|----------------|
| 应用首个窗口 | `w.show()` 自动绑定 | 否 |
| 有 parent 的对话框 | `new QDialog(this)` | 否 |
| 无 parent 的对话框 | `tagWindowOrWidgetAsSubWindowOf()` 后 `exec()` | **是** |
| 新的独立主窗口 | 不 tagging，直接 `show()` | 否（故意成为主窗口） |
| 工具面板子窗口 | `tagWindowOrWidgetAsSubWindowOf()` 后 `show()` | **是** |
| 浮窗 | `setShowWindowAsFloatWindowHint()` 后 `show()` | 否（使用浮窗 hint） |
| 全屏窗口（首个） | `show()` → `showFullScreen()` 两步 | 否 |
| 全屏窗口（后续） | tagging 后直接 `showFullScreen()` | **是** |
| 嵌入第三方渲染 | `winId()` 获取句柄 | 视情况 |
| 被其他应用嵌入 | UIExtension + binding key | 否 |

## QPA 层：visible 的来源与系统回调链

> **适用场景**：调试"主窗口为何 isVisible() 不符合预期""系统隐藏后 Qt 侧状态如何变化"等 QPA 内部问题。源码基准：Qt 5.12.12 OHOS（commit `613336de`）。
>
> **核心结论**：`visible` 是**应用侧控制**的属性，系统侧能改它的地方只有一处（且是 HACK）。系统隐藏/最小化窗口时**不会**把 `QWindow::isVisible()` 置 false——改的是 `isExposed()`、`windowState`、`ApplicationState` 三者。

### visible 的存储与唯一写入函数

| 项 | 位置 |
|----|------|
| 数据成员 | `QWindowPrivate::visible`（`bool` 位域，`qwindow_p.h`） |
| 公开读取 | `QWindow::isVisible()` → 返回 `d_func()->visible` |
| Q_PROPERTY | `qwindow.h:121` `READ isVisible WRITE setVisible NOTIFY visibleChanged` |
| **唯一写入** | `QWindowPrivate::setVisible(bool)` `qwindow.cpp:341`（`this->visible = visible` @346） |

`QWindow::setVisible()`（`qwindow.cpp:619`）只是 `d->setVisible(visible)` 的薄封装；`show()`/`hide()`/`showFullScreen()` 等最终都收口到这里。

### 系统回调接口（OHOS → Qt）

鸿蒙主窗口的平台窗口类是 **`QOhosFloatingWindow`**（名字误导——它承载主窗口/子窗口/浮窗**所有顶层窗口**，见 `qohosplatformintegration.cpp:334`）。它在 `initialize()`（`qohosfloatingwindow.cpp:125`）中 connect `QOhosView::windowEvent` 信号，信号源头是 OHOS 原生 `Window` 对象的回调。

Qt 在 JS 侧向原生窗口注册的 handler（`qohoswindowproxy.cpp:280-314`）：

| OHOS 原生回调 | handler | 投射到 Qt |
|---------------|---------|-----------|
| **`window.on('windowEvent')`** | `handleWindowEventCallback` | `WINDOW_SHOWN/HIDDEN/ACTIVE/INACTIVE/DESTROYED`（`qohoswindowproxy.h:38`） |
| `window.on('windowStatusChange')` | `handleWindowStatusCallback` | 全屏/最大化/最小化等 `windowState` |
| `window.on('windowVisibilityChange')` | `handleWindowVisibilityCallback` | 可见性变化信号 |

> **"系统哪个回调接口"** = OHOS 的 `window.on('windowEvent')`（对应 ArkTS `@ohos.window` 的 `WindowEventType` 枚举）。

### WINDOW_* 事件如何影响 visible / exposure / state

`QOhosFloatingWindow::initialize()` 的事件分发（`qohosfloatingwindow.cpp:162-214`）：

| 事件 | 对 visible | 对其它状态 |
|------|-----------|-----------|
| `WINDOW_ACTIVE` | 不动 | `handleWindowActivated()` + 输入系统激活 |
| `WINDOW_INACTIVE` | 不动 | 失焦 + 输入系统停用 |
| `WINDOW_HIDDEN` | **不动**（只 `setExposedFromOhos(false)`） | `m_exposed=false`，渲染表面不可用 |
| `WINDOW_SHOWN` | **仅当"上一事件是 HIDDEN 且当前 !isVisible()"才 `setVisible(true)`**（HACK，纠偏） | `setExposedFromOhos(true)` |
| `WINDOW_DESTROYED` | 不动 | `notifyWindowDestroyedFromOhos()` |

**关键**：`WINDOW_HIDDEN` 分支（`qohosfloatingwindow.cpp:187-193`）完全不碰 `visible`。系统隐藏窗口时 `isVisible()` 保持 `true`——这正是铁律 W5（`hide()` 退化为最小化）的底层原因。

唯一一处系统侧修改 visible 的 HACK（`qohosfloatingwindow.cpp:194-203`）：
```cpp
case WINDOW_SHOWN:
    // 修复 QWidget::hide() 后从 Dock 拉回时 Qt 侧仍处于 hidden 状态
    if (previousWindowEventType == WINDOW_HIDDEN && !qWindow->isVisible())
        qWindow->setVisible(true);
```

> 附：子窗口/浮窗 `hide()` 时 Qt **自己合成** `WINDOW_HIDDEN`（`qohosview.cpp:1143-1156`），主窗口走 `hideMainWindow()`。

#### 浮窗 hide 销毁链（setOrResetWindowProxy → destroyWindow）

> 上面 `WINDOW_HIDDEN` 分支只覆盖事件分发侧（`setExposed`）。浮窗 hide 在合成 `WINDOW_HIDDEN` **之前**，还会执行原生窗口销毁——这才是"hide 销毁原生窗口"的根因。

`QOhosView::hide()`（`qohosview.cpp:1143`）按 viewType 分流：

| viewType | hide() 路径 | 是否销毁原生窗口 |
|----------|------------|----------------|
| MainWindow | `hideMainWindow()`（`qohosview.cpp:1147`） | 否（最小化/系统隐藏） |
| **FloatWindow / SubWindow** | `setOrResetWindowProxy(nullptr, nullptr)` + 合成 emit `WINDOW_HIDDEN`（`qohosview.cpp:1152-1156`） | **是** |

`setOrResetWindowProxy(nullptr,…)`（`qohosview.cpp:1669`）执行 `m_ohosWindowProxy.reset()`。`QWindowProxyRegistry` 只存 `jsWindowId↔internalWindowId` 映射、不持 `QOhosWindowProxy` 引用（返回 `makeDestroyNotifier`，`qwindowproxyregistry.cpp:60`），故 proxy **立即析构** → `~QOhosWindowProxy`（`qohoswindowproxy.cpp:340`）→ `m_jsScopeData.reset()` → `jsWindowRef->eval("destroyWindow()")`（`qohoswindowproxy.cpp:1436`）**销毁原生 OHOS Window**。

| 对象 | 浮窗 `hide()` 后 | 再 `show()` |
|------|---------------|------------|
| 原生 OHOS Window | **销毁**（destroyWindow） | 重建 |
| QOhosWindowProxy | **销毁**（shared_ptr reset） | 重建（setOrResetWindowProxy 非空） |
| QOhosFloatingWindow 平台窗口 | 保留（不走 `QWindowPrivate::destroy`） | 复用 |
| QWindow/QWidget 对象 | 保留（`isVisible()` 仍 true） | — |

> **实操影响**：浮窗 hide 不是"廉价收起"，代价是销毁+重建原生窗口，不适合高频显隐；hide 后 `isVisible()` 仍 true 但原生窗口已不存在，此时操作 `winId()` 会触发重建（铁律 W1）。真正"保留原生窗口、仅不可见"的廉价收起无现成 API（主窗口 `showMinimized()` 对子窗口/浮窗不支持）。

### 一共 7 处可能修改 visible

| # | 调用点 | 来源 | 触发场景 |
|---|--------|------|----------|
| 1 | `QWindow::setVisible()` `qwindow.cpp:619` | **应用层（主入口）** | `show()/hide()/showFullScreen()/QWidget::setVisible` |
| 2 | `QWindowPrivate::setTopLevelScreen` `qwindow.cpp:510` | kernel | 切屏/重建后恢复显示 |
| 3 | `QWindowPrivate::create` `qwindow.cpp:552` | kernel | 延迟创建的子窗口补显 |
| 4 | `QWindow::setParent` `qwindow.cpp:733` | kernel | 重设父窗口后重应用可见性 |
| 5 | `QWindowPrivate::destroy` `qwindow.cpp:1909` | kernel | `close()`/析构 → `setVisible(false)` |
| 6 | **`WINDOW_SHOWN` HACK** `qohosfloatingwindow.cpp:202` | **OHOS 系统→Qt（唯一系统路径）** | hide 后系统重新拉起，状态纠偏 |
| 7 | `QOhosView` 子窗口创建 `qohosview.cpp:429` | QPA 自驱动 | 建 subwindow 时父窗口若隐藏则自动 `setVisible(true)` |

### WMS 与 Qt 可见性状态机独立性（2026-07-16 新增）

> **⚠️ 重要**：鸿蒙系统的窗口可见性管理（WMS）和 Qt 的可见性状态（WA_WState_Hidden）是**两套独立的状态机**。

系统可以通过 WMS 直接改变窗口可见性（如 GoForeground、文件加速推送窗口到前台），**不经过 Qt 的 show()/setVisible(true) 路径**，导致 Qt 侧 Hidden 标志与系统实际状态不一致。

```
┌─────────────┐     ┌─────────────┐
│  系统 WMS    │     │   Qt 层面    │
│             │     │             │
│ 窗口可见     │     │ Hidden=1    │
│ (GoForeground)│    │ (认为隐藏)   │
│             │     │ 不渲染      │
└─────────────┘     └─────────────┘
       │                   │
       └───── 状态不一致 ───┘
              → 白屏
```

**影响场景**：
- 文件加速（task_manager_service 后台预启动应用，应用 hide() 后系统推送窗口到前台）
- 系统 Dock 恢复（某些时序下）

**排查建议**：遇到白屏问题时，先检查应用侧是否正确调用了 `show()`/`setVisible(true)`，再考虑 Qt QPA 层修复。详见 白屏问题复盘。

### WINDOW_HIDDEN/SHOWN 事件不可靠场景（2026-07-16 新增）

> **⚠️ 重要**：`WINDOW_HIDDEN`/`WINDOW_SHOWN` 事件在以下场景**不会触发**：
> - 文件加速（task_manager_service 后台预启动）
> - 系统直接通过 WMS 管理窗口可见性时

**不应依赖这些事件作为状态同步的唯一触发源。**

设备日志实证（万兴图示文件加速场景，32 文件 ~160MB hilog）：
- `WINDOW_HIDDEN` 出现次数：**0**
- `WINDOW_SHOWN` 出现次数：**0**
- `OHOS-HIDE-DEBUG`（QWidget instrumentation）：**780+ 次**（证明 patched libqohos.so 已部署）

详见 白屏问题复盘 和 万兴白屏复盘。

### 易混淆点（visible / visibility / exposed / appState）

排查窗口可见性问题时，先分清这四个独立概念，不要混为一谈：

| 概念 | 含义 | 系统隐藏时如何变 |
|------|------|----------------|
| `isVisible()`（bool `visible`） | 应用是否"想显示"该窗口 | **不变，保持 true** |
| `visibility`（enum） | 派生自 `visible`+`windowState`：Hidden/Windowed/Minimized/FullScreen | 可能 → Minimized |
| `isExposed()`（`m_exposed`） | 渲染表面是否可绘制 | → false |
| `ApplicationState` | 应用整体前后台（Active/Inactive/Hidden） | 后台时 → Inactive/Hidden |

---

## 激活语义 (activateWindow → shiftAppWindowFocus,异步 + D1 no-op 缺口)

> **适用场景**:调试"`activateWindow()` 后窗口标题仍灰 / Tab 不响应 / Qt isActiveWindow 与 OS 不一致"。源码基准:Qt 5.12.12 OHOS(commit `613336de`)。设备铁证 + 完整复盘见 episodic/postmortems/ 下复盘(内部文档)。
>
> **核心纠正**:`QWidget::activateWindow()` 在 OHOS 调的**不是 `showWindow()`**,而是 `@ohos.window.shiftAppWindowFocus(srcWindowId, targetWindowId)`。

### 调用链(逐行核实)

```
QWidget::activateWindow()           qwidget.cpp:12908-12914   → wnd->requestActivate()
QWindow::requestActivate()           qwindow.cpp:1124-1133     → platformWindow->requestActivateWindow()
QOhosFloatingWindow::requestActivateWindow()   qohosfloatingwindow.cpp:258-266
QOhosPlatformWindow::requestActivateWindow()   qohosplatformwindow.cpp:486-494  → view->requestActivate()
QOhosView::requestActivate()        qohosview.cpp:1025-1044    ← ★ D1 no-op 缺口
QOhosWindowProxy::shiftAppWindowFocus()   qohoswindowproxy.cpp:1835-1852
  → JS eval "@ohos.window.shiftAppWindowFocus(srcWindowId, targetWindowId)"  (qohoswindowproxy.cpp:1846-1847)
```

`showWindow(*)`(qohoswindowproxy.cpp:656)是 `raise(MainWindow)`/`lower`/`show` 路径(qohosview.cpp:734 调),**与 activateWindow 无调用关系**。OHOS 把"激活"拆成"焦点 shift"(`shiftAppWindowFocus`)+"显示/置顶"(`showWindow`/`raiseToAppTop`)两个独立原语,无合二为一的 activeWindow 等价物——但 `shiftAppWindowFocus` 即"同应用窗口焦点转移"等价接口。

### 关键特性 1:异步(~94ms,非同步)

`shiftAppWindowFocus` 是 JS Promise。`activateWindow()` 同步返回后 `isActiveWindow()` **仍为 false**;~94ms 后 OHOS 回发 `WINDOW_ACTIVE` → `QOhosFloatingWindow::handleWindowEvent`(qohosfloatingwindow.cpp:277)→ `QWindowSystemInterface::handleWindowActivated`(qohosfloatingwindow.cpp:292)才置 Qt active。

设备铁证(前台,点主窗置灰 dialog 后调 activateWindow):
```
before-activate:    dialog isActiveWindow=false  focusWindow="MainWindow"   ← 同步前
after-activate(sync):  dialog isActiveWindow=false  focusWindow="MainWindow"   ← ★同步仍 false
(+94ms) dialog(widget) eventFilter type=WindowActivate                    ← 异步 WINDOW_ACTIVE 回环
after-activate(150ms): dialog isActiveWindow=true  focusWindow="Child Dialog"  ← ★150ms 后才 true
```

→ **不要在 `activateWindow()` 后同步检查 `isActiveWindow()`**;须等 `WindowActivate` 事件或延迟 ~150ms。

### 关键特性 2:D1 no-op 缺口(无 focus_window 时静默无效)

`QOhosView::requestActivate()`(qohosview.cpp:1025-1044)在 `m_ohosWindowProxy!=null` 且 `QGuiApplicationPrivate::focus_window==null` 时**什么都不做**(:1028 的 if 假,此分支无 else)→ `shiftAppWindowFocus` 不发(源窗须获焦,无源窗则不发)。

→ **app 后台/失焦(focus_window=null)时 `activateWindow()` 静默 no-op**,dialog 永不 active,Tab 到不了。这是"Tab 不响应"的真实复现场景(见复盘场景2)。这是 OHOS QPA 真实缺陷。

**2026-08-12 已修(方案 A hotfix)**:`requestActivate` 的 `focus_window==null` 分支加 else:尝试 `shiftAppWindowFocus` from logical parent(main 作 src,可能 onCatch 静默失败)+ `sendAsyncSyntheticWindowActiveEvent()` 合成事件 fallback 设 Qt 侧 focus_window=dialog。后台 D1 验证通过(isActiveWindow false→true,synthetic event 触发 WindowActivate)。补丁见 episodic/postmortems/ 下复盘(内部)。备选方案 D(合成事件 + 延迟 shiftAppWindowFocus 等主窗 WINDOW_ACTIVE 到达,根治 WMS 级焦点转移)。

### 关键特性 3:焦点状态 ≠ 激活态(官方 window-focus-guide)

| 概念 | 含义 | 现象 |
|------|------|------|
| 焦点状态(Focus State) | WINDOW_ACTIVE/INACTIVE,能否接收键盘事件 | Tab 不响应=未获焦 |
| 激活态(Highlight State) | 视觉高亮(标题栏颜色) | **标题灰=激活态 false** |

**铁律**:「窗口处于激活态不等于窗口获焦;但获焦窗口一定处于激活态。」逆否:**标题灰(未激活态)⇒ 一定未获焦 ⇒ Tab 不响应**(三现象同源)。要让标题亮须让窗口**获焦**(`shiftAppWindowFocus`),非 `setExclusivelyHighlighted`(只改外观)。

### 关键特性 4:触摸 vs 鼠标(NODE_FOCUS_ON_TOUCH,结构性差异)

> 设备实测:触摸按钮调 `activateWindow()` **首次即激活** dialog;鼠标点按钮**首次失败、二次成功**。结构性根因(非时序偶发)。

- XComponent 3 个独立回调:Touch(`DispatchTouchEvent`,qqtembeddedwindownode.cpp:66-71)/Mouse(`DispatchMouseEvent`,:73-76)/Focus-Blur(`handleOnFocusEvent`,:86-87)。
- **`NODE_FOCUS_ON_TOUCH`**(qnativenode.cpp:169 `focusOnTouch=true`,setAttributeOrFail :271):**手指触摸**时 ArkUI 让节点请求焦点 → `handleOnFocusEvent`(qqtembeddedwindownode.cpp:181)→ `qohosinputmethodeventhandler.cpp:333 handleWindowActivated(main)` → **focus_window=main 在 touch→clicked() 之前设好** → activateWindow() 见 focus_window=main → shiftAppWindowFocus 成功。
- **鼠标不触发 NODE_FOCUS_ON_TOUCH**(ArkUI "touch"=手指专指)→ 无焦点回调 → focus_window 保持 null → **命中特性 2 的 D1 no-op** → 首鼠失败;二鼠时 WMS WINDOW_ACTIVE(异步,文档:"处理点击事件后的状态")已到达 → focus_window=main → 成功。

→ **触摸天然避开 D1(经 NODE_FOCUS_ON_TOUCH 预设 focus_window),鼠标踩中(无此旁路)**。这是 OHOS QPA 触摸/鼠标激活不对称的结构性根因。方案 A 修复后,鼠标首鼠经 synthetic event 兜底(等价触摸路径)。

### `shiftAppWindowFocus` 约束(官方 arkts-apis-window-f)

1. 仅同应用内主窗/子窗(不能跨应用/跨进程主动激活)
2. **源窗 srcWindowId 必须是获焦状态**(→ D1 no-op 的文档根因)
3. 目标须 `setWindowFocusable(true)` + `showWindow()` 成功且执行完毕
4. `ShowWindowOptions.focusOnShow` **对主窗/模态窗/dialog 窗口不生效**(仅子窗/系统窗/悬浮窗默认获焦)

### 非模态 child dialog 不命中 isWindowBlocked 重定向

`qohosfloatingwindow.cpp:280-284` 守卫(`WINDOW_ACTIVE` 分支内)仅在 qWindow 被某**模态**窗口阻挡时把激活重定向回模态。非模态 child dialog 无模态阻挡 → `isWindowBlocked=false` → 守卫不触发 → 正常激活流程。(模态场景才命中,见 modalraise 复盘(内部)。)

### workaround

- 调 `activateWindow()` 前**确保 app 前台**(focus_window 非空);后台时 no-op,改用 `startAbility` 拉前台再 activate。
- `activateWindow()` 是异步,同步 `isActiveWindow()` 必 false;等 `WindowActivate` 或延迟 ~150ms。
- 标题灰⇒未获焦;要让标题亮须获焦(`shiftAppWindowFocus`),非 `setExclusivelyHighlighted`。
- 跨应用激活无应用侧 API,只能 `startAbility` 或依赖用户点击。

---

## 参考来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ Qt 源码验证 | QPA 插件 `qtohosextras`/ohos：`qohosfloatingwindow.cpp`、`qohoswindowproxy.cpp`、`qohosview.cpp`、`qohosplatformintegration.cpp`；Qt GUI `qwindow.cpp`/`qwindow_p.h`（visible 链路，commit `613336de`） |
| 💼 工作经验 | 日常 Qt 鸿蒙化开发实践积累 |
