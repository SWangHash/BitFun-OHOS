---
id: episodic-wa-nativewindow-leave-bug
type: episodic
domain: debug
tags: [qt, harmonyos, ohos, qpa, leave-event, wa-nativewindow, mouse, hover, xcomponent]
created: 2026-06-04
updated: 2026-06-09
status: active
audience: public
refs: [semantic-qt-harmonyos-window-model, semantic-qt-harmonyos-api]
summary: >
  WA_NativeWindow Leave 事件不灵敏 Bug 完整分析：双重盲区根因（Qt Widget 层
  internalWinId() 跳过 + OHOS QPA hover 回调不可靠）、完整调用链追踪、
  修复策略评估（3 种方案对比）、10 场景风险矩阵、时序图。Qt 5.12 OHOS。
  ✅ 手动验证通过，交付件已输出至 <WORK_DIR>/leave-event-fix/（2026-06-09 最终整理）。
---

# Qt WA_NativeWindow Leave 事件不灵敏 Bug — 完整分析报告

> **影响版本**：Qt 5.12.12 OHOS 分支（`tqtc/harmonyos-5.12.12`，commit `613336de`）
> **同样影响**：Qt 5.15.16 OHOS 分支（`qohoshovereventsgenerator.cpp` 两版本代码一致）
> **分析日期**：2026-06-04
> **分析人**：<original-author>（Qt for HarmonyOS 开发者）

---

## 一、问题概述

### 1.1 一句话描述

当 `centralWidget` 设置了 `Qt::WA_NativeWindow` 属性后，鼠标从该 widget 移出到相邻的 `QDockWidget` 时，`QEvent::Leave` 事件不触发或严重延迟。

### 1.2 触发条件

| 条件 | 说明 |
|------|------|
| 目标 widget 设置了 `setAttribute(Qt::WA_NativeWindow)` | 使其拥有独立 `internalWinId()` |
| 该 widget 启用了 `setMouseTracking(true)` | 依赖 hover/Leave 事件进行 UI 反馈 |
| 鼠标跨越该 widget 与相邻 widget 的边界 | 尤其是跨越到另一个独立 XComponent 区域 |

### 1.3 预期行为 vs 实际行为

| | 描述 |
|---|------|
| **预期** | 鼠标离开 `centralWidget` 时，立即触发 `QEvent::Leave`，`leaveEvent()` 被调用 |
| **实际** | Leave 事件丢失或严重延迟——widget 的 hover 状态、光标追踪、tooltip 定时器全部残留 |

### 1.4 复现步骤

1. 将 demo（`<INTERNAL_DEMO>`）编译部署到鸿蒙设备
2. 将鼠标放在中央深色区域（`CentralWidget`，设置了 `WA_NativeWindow` + `setMouseTracking(true)`）
3. 缓慢将鼠标移向左侧停靠的 `QDockWidget`，观察 hilog 中是否出现 `QtDemoLog:Leave`

**对照实验**：注释掉 `centralwidget.h` 中的 `setAttribute(Qt::WA_NativeWindow)` → Leave 事件恢复正常，确认 `WA_NativeWindow` 是直接触发因素。

---

## 二、完整源码分析

### 2.1 Qt Widget 层 Leave 事件分发路径

#### 完整调用链

```
QPA 插件调用 handleLeaveEvent(QWindow*)
    │
    ▼
① QWindowSystemInterface::handleLeaveEvent<QWindowSystemInterface::DefaultDelivery>()
    │  qwindowsysteminterface.cpp:227-231
    │  创建 LeaveEvent 并入队
    │
    ▼
② QGuiApplicationPrivate::processWindowSystemEvent()
    │  qguiapplication.cpp:1915-1917
    │  switch(e->type) case Leave → processLeaveEvent()
    │
    ▼
③ QGuiApplicationPrivate::processLeaveEvent()
    │  qguiapplication.cpp:2324-2337
    │  检查 modal 阻塞 → 发送 QEvent::Leave 到 QWindow
    │
    ▼
④ QWidgetWindow::event()
    │  qwidgetwindow.cpp:262-288
    │  case QEvent::Leave → handleEnterLeaveEvent(event)
    │
    ▼
⑤ QWidgetWindow::handleEnterLeaveEvent()
    │  qwidgetwindow.cpp:426-487
    │  ★ 关键跳过点：line 467-469
    │
    ▼
⑥ QApplicationPrivate::dispatchEnterLeave(enter, leave, globalPosF)
    │  qapplication.cpp:2207
    │  构建 leaveList / enterList，逐个发送 QEvent::Leave / QEvent::Enter
    │
    ▼
⑦ QWidget::leaveEvent() / QWidget::enterEvent()
    │  最终到达用户代码
```

#### 关键源码位置

**QPA 入口** — `qwindowsysteminterface.cpp:227-231`：

```cpp
QT_DEFINE_QPA_EVENT_HANDLER(void, handleLeaveEvent, QWindow *window)
{
    QWindowSystemInterfacePrivate::LeaveEvent *e =
        new QWindowSystemInterfacePrivate::LeaveEvent(window);
    QWindowSystemInterfacePrivate::handleWindowSystemEvent<Delivery>(e);
}
```

`QT_DEFINE_QPA_EVENT_HANDLER` 宏（line 200-204）展开为 3 个显式模板实例化：`DefaultDelivery`、`SynchronousDelivery`、`AsynchronousDelivery`。

**事件分发** — `qguiapplication.cpp:2324-2337`：

```cpp
void QGuiApplicationPrivate::processLeaveEvent(
    QWindowSystemInterfacePrivate::LeaveEvent *e)
{
    if (!e->leave)
        return;
    if (e->leave.data()->d_func()->blockedByModalWindow)
        return;  // 模态窗口阻塞

    currentMouseWindow = 0;

    QEvent event(QEvent::Leave);
    QCoreApplication::sendSpontaneousEvent(e->leave.data(), &event);
}
```

Leave 事件作为 spontaneous event 发送到 `e->leave` 指向的 **QWindow**。对于 widget 窗口，这个 QWindow 就是 `QWidgetWindow`。

**★ 跳过点（The Skip Point）** — `qwidgetwindow.cpp:464-472`：

```cpp
if (!enter || !QWidget::mouseGrabber()) {
    // Preferred leave target is the last mouse receiver, unless it has native window,
    // in which case it is assumed to receive it's own leave event when relevant.
    QWidget *leave = m_widget;                                              // line 467
    if (qt_last_mouse_receiver && !qt_last_mouse_receiver->internalWinId()) // line 468 ★
        leave = qt_last_mouse_receiver.data();                               // line 469
    QApplicationPrivate::dispatchEnterLeave(enter, leave, globalPosF);       // line 470
    qt_last_mouse_receiver = enter;
}
```

#### `internalWinId()` 检查的作用

| `qt_last_mouse_receiver` 状态 | `leave` 目标 | Qt 的设计意图 |
|-------------------------------|---------------|---------------|
| `nullptr`（无追踪信息） | `m_widget`（顶层窗口控件） | 兜底：离开整个顶层窗口 |
| `internalWinId() != 0`（原生控件） | `m_widget`（顶层窗口控件） | **跳过**：假设 QPA 会为该原生子窗口单独投递 Leave |
| `internalWinId() == 0`（alien 控件） | `qt_last_mouse_receiver` | 正确：alien 没有 QPA 存在感，需要合成 Leave |

**核心假设**：Qt 的 widget 层假设拥有 `internalWinId()` 的原生子控件会通过 QPA 收到**独立的 Leave 事件**（目标为该子控件的 `QWidgetWindow`）。这在 X11、Windows、macOS 上是正确的——操作系统会为每个原生窗口边界穿越投递 Leave。

**在 OHOS 上，这个假设不成立**——QPA 从不投递这个独立的 Leave。

---

### 2.2 OHOS QPA 鼠标事件路径

#### 完整调用链

```
ArkUI NODE_ON_MOUSE 回调 (JS 线程)
    │
    ▼
① QEmbeddedWindowNode::setMouseEventsHandler() 注册的 lambda
    │  qembeddedwindownode.cpp:555-563
    │  ArkUI_UIInputEvent → NativeNodeMouseEvent
    │
    ▼
② QOhosNativeNodeMouseInputHandler::handleMouseEvent()
    │  qohosnativemouseeventshandler.cpp:102-144
    │  解析事件 → 调用 hoverEventsGenerator（空实现）→ 入 batch
    │
    ▼
③ batching handler（异步投递到 Qt 线程）
    │  qohosnativemouseeventshandler.cpp:128-143
    │  makeQtOhosBatchingQtRequestsHandler → visitInQtThreadIfAlive
    │
    ▼
④ processMouseEventsInQtThread()                    ★ Qt 线程入口
    │  qohosnativemouseeventshandler.cpp:146-207
    │  遍历 batch → mayDropMouseEvent 过滤
    │  → [FIX] s_lastMouseWindow 跨窗口补偿
    │  → eventHandler->onMouseEvent()
    │
    ▼
⑤ QOhosInputMethodEventHandler::onMouseEvent()
    │  → handleMouseEvent()
    │  → QWindowSystemInterface::handleMouseEvent()
    │
    ▼
⑥ 进入 Qt 标准事件分发（同 2.1 中的 ③-⑦）
```

#### batching 机制 + `mayDropMouseEvent`

**batching 的目的**：将 JS 线程上的高频鼠标事件批量收集，一次性投递到 Qt 线程处理，减少跨线程开销。

**事件丢弃逻辑** — `qohosnativemouseeventshandler.cpp:209-216`：

```cpp
bool QOhosNativeNodeMouseInputHandler::mayDropMouseEvent(
    ch::steady_clock::time_point now,
    const MouseEvent &event,
    const MouseEvent &nextEvent)
{
    return
        now - event.timestamp >= mouseMotionEventMinAgeForDrop  // 事件年龄 >= 阈值
        && event.mouseEvent.eventType == QEvent::MouseMove       // 当前是 Move
        && nextEvent.mouseEvent.eventType == QEvent::MouseMove;  // 下一个也是 Move
}
```

**影响**：连续的 `MouseMove` 事件中，年龄超过阈值的中间事件会被丢弃，只保留最新的。这意味着快速移动时，某些中间位置的事件不会到达 Qt——但**最后一个事件始终保留**，所以跨窗口检测不会遗漏。

#### `processMouseEventsInQtThread` 是真正的 Qt 线程入口

这是所有鼠标事件在 Qt 主线程上的**唯一处理入口**。补偿代码放在此处，确保：
- 在 Qt 线程同步执行，无跨线程竞争
- 在 `onMouseEvent()` 之前执行，Leave/Enter 先于 MouseMove 到达
- 所有 handler 实例共享 `static s_lastMouseWindow`，可跨 XComponent 追踪

---

### 2.3 OHOS QPA Hover 事件路径

#### `QOhosHoverEventsGenerator` 的作用

原始设计是一个**坐标同步桥**：ArkUI NativeNode 的 hover 事件有系统级限制——指针坐标永远为 `(0, 0)`。`QOhosHoverEventsGenerator` 用鼠标事件的正确坐标"补偿"hover 事件的坐标缺陷，同时承担 Enter/Leave 事件生成的职责。

```
                    ┌──────────────────────────────────┐
                    │   QOhosHoverEventsGenerator       │
                    │                                    │
鼠标事件（正确坐标）──→│ handleQOhosMouseEvent()           │
                    │   → 缓存 local/global 坐标        │
                    │   → if !m_hovered:                 │
                    │       sendQtHoverEvent(true)       │──→ handleEnterEvent(正确坐标)
                    │       m_hovered = true              │
                    │                                     │
ArkUI hover 回调 ───→│ handleQOhosHoverEvent(hovered)     │
                    │   → if !hovered && m_hovered:      │
                    │       sendQtHoverEvent(false)       │──→ handleLeaveEvent(缓存坐标)
                    │       m_hovered = false             │
                    └──────────────────────────────────┘
```

#### 当前状态：两条路径均已禁用

**文件** — `qohoshovereventsgenerator.cpp:34-48`：

```cpp
void QOhosHoverEventsGeneratorImpl::handleQOhosMouseEvent(
    const QOhosMouseEvent &mouseEvent)
{
    // [FIX] Removed sendQtHoverEvent(true) — async Enter/Leave interferes with
    // the synchronous Leave compensation in processMouseEventsInQtThread.
    Q_UNUSED(mouseEvent);  // 空实现
}

void QOhosHoverEventsGeneratorImpl::handleQOhosHoverEvent(bool hovered)
{
    // [FIX] Removed sendQtHoverEvent(false) — ArkUI hover callbacks are unreliable
    // at XComponent boundaries.
    Q_UNUSED(hovered);     // 空实现
}
```

#### 两条并行路径对比

| 路径 | 入口 | 当前状态 |
|------|------|---------|
| **路径 1**：XComponent `DispatchHoverEvent` | `CallbackReceiver::onHoverEvent()` → `QOhosNativeXComponentInputHandler::handleHoverEvent()` | 仅在 `isNativeNodeApiMouseEventsEnabled()=false` 时注册（非默认） |
| **路径 2**：ArkUI NativeNode `NODE_ON_HOVER_EVENT` | → `hoverEventsGenerator->handleQOhosHoverEvent()` | 已注册但空实现（默认配置下） |
| **路径 3**：鼠标移动跨窗口补偿（新增） | `processMouseEventsInQtThread` → `s_lastMouseWindow` 检测 | **唯一的 Enter/Leave 来源** |

#### `sendQtHoverEvent` 的 `visitInQtThreadIfAlive` 异步投递

原始的 `sendQtHoverEvent()` 通过 `m_qWindowRef.visitInQtThreadIfAlive(...)` 将事件投递到 Qt 线程。这是一个**异步**操作——事件被排入 Qt 线程的事件队列，在未来的某个事件循环迭代中处理。这与 `processMouseEventsInQtThread` 中的**同步**补偿形成时序竞争（详见 §4.2）。

---

### 2.4 跨平台对比

| 平台 | Leave 事件来源 | 可靠性 |
|------|---------------|--------|
| **X11** | `LeaveNotify`（X Server 原生事件） | ✅ OS 级保证，每个窗口边界都会触发 |
| **Windows** | `WM_MOUSELEAVE`（通过 `TrackMouseEvent` 注册） | ✅ OS 级保证 |
| **macOS** | `mouseExited:`（NSTrackingArea） | ✅ OS 级保证 |
| **Wayland** | `wl_pointer.leave` | ✅ 协议级保证 |
| **OHOS** | ArkUI `NODE_ON_HOVER_EVENT` hover=false | ❌ **不可靠**——XComponent 边界处丢失 |

**OHOS 是唯一没有 OS 级 Leave 事件支持的平台**。这是此 bug 的根本平台差异：

- 其他平台的 OS 会在鼠标离开每个原生窗口时自动投递 Leave
- OHOS 的 ArkUI 只在 XComponent 边界投递 hover 回调，且不可靠
- Qt 的 widget 层（`qwidgetwindow.cpp:468`）假设 QPA 会投递 Leave，但 OHOS QPA 做不到

---

## 三、改动影响评估

### 3.1 当前修复涉及的改动清单

| 文件 | 改动内容 | 行数 |
|------|---------|------|
| `qohoshovereventsgenerator.cpp` | 将 `handleQOhosMouseEvent()` 和 `handleQOhosHoverEvent()` 改为空实现（no-op），删除原 `sendQtHoverEvent()` 函数及相关状态 | :34-48 |
| `qohosnativemouseeventshandler.cpp` | 新增 `static QPointer<QWindow> s_lastMouseWindow`；在 `processMouseEventsInQtThread` 的 for 循环中检测窗口切换并同步调用 `handleLeaveEvent` + `handleEnterEvent` | :85-90, :174-203 |
| `qohosnativemouseeventshandler.h` | 新增 `s_lastMouseWindow` 静态成员声明 | :87 |
| `qohosinputmethodeventhandler.cpp` | 移除第一轮修复中放在 `handleMouseEvent` 的补偿代码；保留 `m_lastWindowLeft` 防御机制 | — |

### 3.2 场景化风险评估

| # | 场景 | 风险等级 | 说明 |
|---|------|:--------:|------|
| 1 | 正常跨窗口移动（centralWidget → DockWidget） | **NO** | 补偿正确工作，Leave+Enter 同步发送 |
| 2 | 拖拽操作（拖动 QDockWidget 跨窗口） | **LOW** | `isMouseGrabbed()` 跳过补偿；释放时 `stopAnyMouseGrab()` 发 Enter，但缺旧窗口 Leave |
| 3 | 多个顶层窗口（MainWindow ↔ QDialog） | **NO** | `s_lastMouseWindow` 是 static，跨实例共享，正确检测 |
| 4 | 鼠标离开所有 Qt 窗口 ⚠️ | **MEDIUM** | 无新鼠标事件触发补偿，`s_lastMouseWindow` 残留，最后窗口不收 Leave |
| 5 | 鼠标停留在一个窗口不动 | **NO** | 无窗口切换，无虚假事件 |
| 6 | 窗口销毁时仍被 hover | **NO** | `QPointer` 自动置空，下次鼠标移动时安全处理 |
| 7 | 触摸屏 hover（手指悬停不触碰） | **LOW** | 不产生鼠标事件，补偿不触发；但鸿蒙触摸屏场景通常无 hover 需求 |
| 8 | 触控笔 hover | **LOW** | 同场景 7 |
| 9 | 快速甩动鼠标跨多个窗口 | **NO** | `mayDropMouseEvent` 丢弃中间事件但保留最后一个，补偿在最后一个事件上正确执行 |
| 10 | Popup 菜单打开时的 Leave | **NO** | Qt 的 popup 模式有独立的 Enter/Leave 处理（`qwidgetwindow.cpp:428-434`） |

#### 场景 4 详细分析（唯一 MEDIUM 风险）

```
鼠标从窗口 A 移出 → 离开所有 Qt 窗口区域

① 没有新的鼠标事件到达任何 Qt 窗口
② processMouseEventsInQtThread 不被调用
③ s_lastMouseWindow 仍然指向 A
④ A 永远不会收到 Leave

后续影响：
- 鼠标重新进入 A → s_lastMouseWindow == A → 不生成 Enter → A 的 underMouse 状态已残留
- 鼠标进入另一个窗口 B → 生成 Leave(A) + Enter(B) → 延迟清除 A 的残留状态
```

**缓解因素**：鸿蒙应用通常全屏运行，鼠标离开所有 Qt 窗口的场景罕见。

### 3.3 `sendQtHoverEvent(true)` 去掉的影响

#### 原本解决什么问题

从 git 历史精确还原（commit `96728a820e`，Adam Krzykala，2025-11-07，QTFOROH-1835）：

> "pointer position for [native node hover events] is always 0,0 (system limitation)"

ArkUI NativeNode 的 `NODE_ON_HOVER_EVENT` 回调提供的指针坐标**永远为 `{0, 0}`**。`sendQtHoverEvent(true)` 在首个鼠标事件到达时，利用鼠标事件的正确坐标生成 Enter 事件，解决了"Enter 事件坐标为 0,0"的问题。

#### 为什么现在不需要

当前 `processMouseEventsInQtThread` 的补偿代码直接使用鼠标事件携带的 `localPosition` 和 `globalPosition` 调用 `handleEnterEvent()`：

```cpp
QWindowSystemInterface::handleEnterEvent(
    targetWindow, mouseEvent.localPosition, mouseEvent.globalPosition);
// qohosnativemouseeventshandler.cpp:200-201
```

这些坐标来自 ArkUI 的 `NODE_ON_MOUSE` 回调，是正确的像素坐标（不存在 0,0 问题）。

#### 是否安全

**是**。补偿代码生成的 Enter 事件带有正确坐标，且同步执行（无时序竞争）。`sendQtHoverEvent(true)` 的异步 Enter 不仅冗余，还会与同步补偿产生重复 Enter 事件。

### 3.4 `sendQtHoverEvent(false)` 去掉的影响

#### 原本解决什么问题

当鼠标离开 XComponent 的 hover 区域时，ArkUI 触发 `hovered=false` 回调。`sendQtHoverEvent(false)` 将其转换为 Qt 的 `QEvent::Leave`。这是**鼠标离开所有 Qt 窗口**时唯一能生成 Leave 的机制。

#### 为什么现在去掉有风险

去掉后，"鼠标离开所有 Qt 窗口"场景（§3.2 场景 4）失去了唯一的 Leave 来源。补偿机制依赖新的鼠标事件触发，而鼠标离开所有窗口后不会再有新事件。

#### 直接 hover 路径仍然活跃的事实

需要注意：`NODE_ON_HOVER_EVENT` 回调仍然在 ArkUI 层注册（`qnativenode.cpp:239-241`），只是接收端（`hoverEventsGenerator->handleQOhosHoverEvent()`）是空实现。如果恢复该函数，可以直接利用 ArkUI 的 hover-leave 作为防御层，无需改动注册逻辑。

---

## 四、问题根因

### 4.1 双重盲区（The Dual Blind Spot）

Leave 事件丢失的原因是**两个独立层各自假设对方会投递它**，但谁都没投。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           双重盲区示意图                                      │
│                                                                             │
│   ┌─────────────────────────┐         ┌──────────────────────────────┐     │
│   │  盲区 #1: Qt Widget 层   │         │  盲区 #2: OHOS QPA 层        │     │
│   │                          │         │                               │     │
│   │  qwidgetwindow.cpp:468   │         │  qohoshovereventsgenerator   │     │
│   │                          │         │  .cpp:42-48                   │     │
│   │  internalWinId() != 0    │  假设   │                               │     │
│   │  → 跳过合成 Leave        │───────→│  hover 回调是唯一 Leave 来源   │     │
│   │  → 假设 QPA 会投递       │  QPA    │  → 但 ArkUI hover 在边界不可靠 │     │
│   │                          │  会处理 │  → 且 hover 实现已被禁用       │     │
│   └─────────────────────────┘         └──────────────────────────────┘     │
│                                                                             │
│   结果：事件从两层之间的缝隙掉落                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 盲区 \#1：Qt Widget 层因 `internalWinId()` 跳过合成

**位置**：`qwidgetwindow.cpp:467-469`

当顶层窗口的 Leave 事件到达 `handleEnterLeaveEvent()` 时，代码检查 `qt_last_mouse_receiver->internalWinId()`。如果最后的鼠标接收者是一个原生控件（`WA_NativeWindow`），则**跳过**它，将 Leave 发给顶层窗口控件（`m_widget`）而不是实际的原生子控件。

Qt 的设计意图（注释 line 465-466）：

> "Preferred leave target is the last mouse receiver, **unless it has native window**, in which case it is assumed to receive it's own leave event when relevant."

#### 盲区 \#2：OHOS QPA 层 Leave 完全依赖 ArkUI hover 回调

**位置**：`qohoshovereventsgenerator.cpp:42-48`

OHOS QPA 整个插件中，`QWindowSystemInterface::handleLeaveEvent()` 的唯一调用点在 `QOhosHoverEventsGenerator` 的 `sendQtHoverEvent(false)` 中（已删除）。该函数依赖 ArkUI 的 `NODE_ON_HOVER_EVENT` 回调——而 ArkUI 的 hover 回调在 XComponent 边界处**不可靠**（快速滑动、无像素间隙、兄弟节点调度跳过）。

#### 两个盲区叠加导致事件丢失

```
鼠标从 WA_NativeWindow 子控件 A → 子控件 B

步骤 1: ArkUI 在 B 的 XComponent 上触发鼠标事件
        （不为 A 生成 Leave —— ArkUI 不知道 Qt 窗口边界）
        ↓
步骤 2: OHOS QPA 将鼠标移动投递到 B 的 QWindow
        （没有 A 的 Leave —— ArkUI 不提供）
        ↓
步骤 3: Qt widget 层处理 B 的 QWindow 级事件
        QWidgetWindow::handleEnterLeaveEvent() 执行
        ↓
步骤 4: 盲区 #1 激活
        qt_last_mouse_receiver = A 的 widget（有 WA_NativeWindow）
        internalWinId() != 0 → 跳过
        leave = m_widget（顶层控件），而非 A
        dispatchEnterLeave 发 Leave 给顶层控件，不给 A
        ↓
步骤 5: A 永远收不到 QEvent::Leave
        其 hover 状态、光标追踪、tooltip 定时器全部残留
```

### 4.2 异步投递 vs 同步处理的冲突

#### 问题本质

| 机制 | 执行位置 | 时序特征 |
|------|---------|---------|
| `visitInQtThreadIfAlive`（原 `sendQtHoverEvent`） | ArkUI 线程 → 异步投递到 Qt 线程 | 事件排入队列，**未来某个事件循环迭代**处理 |
| `processMouseEventsInQtThread`（当前补偿） | Qt 线程 | **同步执行**，在当前调用栈内立即处理 |

#### 时序竞争详细时间线

```
时间 ──────────────────────────────────────────────────────────────→

JS 线程（ArkUI）:
  T0: hover=false on XComponent_A
      → sendQtHoverEvent(false)
      → visitInQtThreadIfAlive(LeaveEvent_A)    ← 异步投递

  T1: mouse move on XComponent_B
      → batch 入队 → visitInQtThreadIfAlive(batch_B)  ← 异步投递

Qt 线程:
  T2: 处理 LeaveEvent_A（来自 T0）
      → QEvent::Leave 发到 A ✓

  T3: 处理 batch_B（来自 T1）
      → processMouseEventsInQtThread
      → s_lastMouseWindow = null（刚 Leave 了 A）
      → 检测到窗口切换 → 又发 Leave(A) + Enter(B)
      → ★ 重复 Leave(A)！

  或：

  T2: 处理 batch_B（来自 T1，先到达）
      → s_lastMouseWindow = A
      → 检测到窗口切换 → Leave(A) + Enter(B) ✓

  T3: 处理 LeaveEvent_A（来自 T0，后到达）
      → ★ 又发 Leave(A)！A 已经 Leave 了！
```

**结论**：异步 hover 回调与同步补偿的时序不可预测，导致重复 Leave 事件，破坏 Qt 内部状态机。这是 Round 2 禁用 `sendQtHoverEvent` 的根本原因。

### 4.3 第一轮修复失败原因

#### 失败原因 1：补偿代码放在 `handleMouseEvent` 但永远不触发

第一轮修复将补偿代码放在 `QOhosInputMethodEventHandler::handleMouseEvent()` 中。但鼠标事件实际上通过 `qohosnativemouseeventshandler.cpp` 的 batching 异步路径到达——`handleMouseEvent()` 是 batching 回调中的 `onMouseEvent()` 调用，此时已经太晚，且每次调用只处理单个事件，无法感知跨窗口切换。

#### 失败原因 2：batching 吞掉中间事件

`mayDropMouseEvent` 在 batch 构建时丢弃年龄超过阈值的中间 `MouseMove` 事件。如果补偿代码依赖每个事件检测窗口切换，被丢弃的事件会导致检测遗漏。

#### 失败原因 3：实例成员无法跨 XComponent 共享状态

每个 XComponent 有独立的 `QOhosNativeNodeMouseInputHandler` 实例。当鼠标从 XComponent A 移到 XComponent B 时：

- 实例 A 的 `m_lastWindow` = A（但 A 不再收到事件）
- 实例 B 的 `m_lastWindow` = null（首次收到事件，不知道之前是 A）

**无法检测到窗口切换**。必须使用 `static` 变量跨实例共享。

---

## 五、问题产生的流程

### 5.1 时序图 A：无 `WA_NativeWindow`（正常）

所有子控件都是 alien（无 `internalWinId()`）。单一 QWindow，单一 XComponent。

```
鼠标在 centralWidget ──────────────────────────────→ 鼠标移到 dockWidget 区域
（同一 QWindow_Main，同一 XComponent）                 （仍然同一 QWindow_Main）

══════════════════════════════════════════════════════════════════════

[JS 线程 — ArkUI]

T0  XComponent_Main: NODE_ON_MOUSE 触发（MouseMove）
    │
    ├─ qnativenode.cpp:235 → mouseEventsHandler(NativeNodeMouseEvent)
    ├─ qohosnativemouseeventshandler.cpp:102 → handleMouseEvent()
    ├─ hoverEventsGenerator->handleQOhosMouseEvent() → [空实现]
    └─ batch.push_back({now, mouseEvent})

══════════════════════════════════════════════════════════════════════

[Qt 线程 — 事件分发器]

T1  processMouseEventsInQtThread(batch)
    │  qohosnativemouseeventshandler.cpp:146
    │
    ├─ s_lastMouseWindow 检查：同一窗口 → 不补偿
    └─ eventHandler->onMouseEvent(mouseEvent)
         → QWindowSystemInterface::handleMouseEvent(QWindow_Main, ..., MouseMove)

T2  QWidgetWindow_Main::handleMouseEvent()
    │  qwidgetwindow.cpp:681
    │
    ├─ widget = m_widget->childAt(pos) → dockWidget
    └─ QApplicationPrivate::sendMouseEvent(dockWidget, ..., qt_last_mouse_receiver)

T3  sendMouseEvent() — alien 控件间的 Enter/Leave 分发
    │  qapplication.cpp:2615-2629
    │
    │  lastMouseReceiver = centralWidget（上一次鼠标移动的接收者）
    │  receiver = dockWidget
    │  alienWidget = dockWidget（alien，无 internalWinId）
    │
    ├─ 条件: alienWidget && alienWidget != lastMouseReceiver
    │   → dockWidget != centralWidget → TRUE ✓
    │
    └─ dispatchEnterLeave(dockWidget, centralWidget, ...)
         │  qapplication.cpp:2207
         ├─ QEvent::Leave  → centralWidget  ✓ 已投递
         └─ QEvent::Enter  → dockWidget     ✓ 已投递

══════════════════════════════════════════════════════════════════════

结果：✓ Leave + Enter 通过 sendMouseEvent 的 alien 控件追踪正确投递。
      不需要 QPA 级的 Leave/Enter。
```

### 5.2 时序图 B：有 `WA_NativeWindow`（原 bug）

DockWidget 有 `WA_NativeWindow` → 独立的 `QWindow_Dock` 和 `XComponent_Dock`。

```
鼠标在 centralWidget ────────────────────────→ 鼠标跨到 DockWidget
（QWindow_Main, XComponent_Main）              （QWindow_Dock, XComponent_Dock）
                                                ↑ 不同的 XComponent！

══════════════════════════════════════════════════════════════════════

[JS 线程 — ArkUI]

T0  XComponent_Main: NODE_ON_MOUSE 触发（MouseMove，centralWidget 区域）
    ├─ handleMouseEvent() → batch_A.push_back(...)

T1  鼠标越过 XComponent 边界
    │
    │  ArkUI hover 回调理论上应触发：
    │    hover=false on XComponent_Main  →  sendQtHoverEvent(false)
    │    hover=true  on XComponent_Dock  →  sendQtHoverEvent(true)
    │
    │  ★ 但 ArkUI 的 hover 回调在 XComponent 边界不可靠 ★
    │  → 可能不触发，或延迟触发，或坐标为 (0,0)
    │
    ├─ XComponent_Dock: NODE_ON_MOUSE 触发（MouseMove，dock 区域）
    ├─ handleMouseEvent() → batch_B.push_back(...)

══════════════════════════════════════════════════════════════════════

[Qt 线程 — 无补偿的原始代码]

T2  处理 batch_A（来自 XComponent_Main）
    ├─ eventHandler->onMouseEvent()
    │   → QWindowSystemInterface::handleMouseEvent(QWindow_Main, ..., MouseMove)
    └─ QWidgetWindow_Main::handleMouseEvent()
        → sendMouseEvent() → 正常的 intra-window 分发

T3  处理 batch_B（来自 XComponent_Dock）
    ├─ eventHandler->onMouseEvent()
    │   → QWindowSystemInterface::handleMouseEvent(QWindow_Dock, ..., MouseMove)
    └─ QWidgetWindow_Dock::handleMouseEvent()
        → 这是 QWindow_Dock 的第一个鼠标事件
        → handleEnterLeaveEvent 中无 qt_last_mouse_receiver 信息
        → 不会为 QWindow_Main 上的 centralWidget 生成 Leave

    ★ 同时，QWindow_Main 从未收到 QPA 级的 Leave 事件 ★
    ★ QWidgetWindow_Main::handleEnterLeaveEvent(Leave) 从未执行 ★
    ★ centralWidget 永远收不到 QEvent::Leave ★

══════════════════════════════════════════════════════════════════════

结果：✗ Leave 事件丢失。
      盲区 #1: Qt widget 层假设 QPA 会为原生子窗口投递 Leave
      盲区 #2: OHOS QPA 没有机制生成该 Leave
      事件从两层之间的缝隙掉落。
```

### 5.3 时序图 C：有 `WA_NativeWindow` + 当前修复（修复后）

```
鼠标在 centralWidget ────────────────────────→ 鼠标跨到 DockWidget
（QWindow_Main, XComponent_Main）              （QWindow_Dock, XComponent_Dock）

══════════════════════════════════════════════════════════════════════

[JS 线程 — ArkUI]

T0  XComponent_Main: NODE_ON_MOUSE → batch_A
T1  XComponent_Dock: NODE_ON_MOUSE → batch_B

  （hover 回调已被禁用，不产生任何事件）

══════════════════════════════════════════════════════════════════════

[Qt 线程 — 有补偿的修复代码]

T2  processMouseEventsInQtThread(batch_A)          [来自 handler 实例 A]
    │  qohosnativemouseeventshandler.cpp:146
    │
    ├─ targetWindow = QWindow_Main
    ├─ s_lastMouseWindow = nullptr（首次）
    ├─ 条件: s_lastMouseWindow && ... → FALSE（null）→ 不补偿
    ├─ s_lastMouseWindow = QWindow_Main             ← 记录
    └─ onMouseEvent() → 正常鼠标移动处理

T3  processMouseEventsInQtThread(batch_B)          [来自 handler 实例 B]
    │  qohosnativemouseeventshandler.cpp:146
    │
    ├─ targetWindow = QWindow_Dock
    ├─ s_lastMouseWindow = QWindow_Main（由 T2 设置）
    ├─ 条件: s_lastMouseWindow(Main) && Main != Dock → TRUE ✓
    │   │
    │   ├─ oldWindow = QWindow_Main
    │   ├─ QWindowSystemInterface::handleLeaveEvent(QWindow_Main)   ← 同步投递
    │   ├─ QWindowSystemInterface::handleEnterEvent(QWindow_Dock,   ← 同步投递
    │   │       localPos, globalPos)
    │   └─ qCDebug: "[MouseLeave] cross-window transition: old=Main new=Dock"
    │
    ├─ s_lastMouseWindow = QWindow_Dock             ← 更新
    └─ onMouseEvent() → 正常鼠标移动处理

T4  QPA 事件队列处理：
    ├─ Leave(QWindow_Main) → QWidgetWindow_Main::handleEnterLeaveEvent(Leave)
    │   ├─ 查看队列中是否有 Enter → 找到 Enter(QWindow_Dock)
    │   ├─ thisParent(Main) == enterParent(Main) → TRUE（同一顶层窗口层级）
    │   ├─ enter = DockWidget 的顶层 widget
    │   ├─ removeWindowSystemEvent(Enter)  ← 从队列移除，合并处理
    │   └─ dispatchEnterLeave(DockWidget顶层, Main顶层, globalPos)
    │        ├─ QEvent::Leave  → centralWidget  ✓ 已投递
    │        └─ QEvent::Enter  → dockWidget     ✓ 已投递
    │
    └─ Enter(QWindow_Dock) 已被 T4 的 peek 合并移除，不再单独处理

══════════════════════════════════════════════════════════════════════

结果：✓ Leave + Enter 通过静态补偿 + QPA 队列合并正确投递。
      同步执行，无时序竞争。
```

---

## 六、修复策略方案

### 6.1 三种候选策略

#### 策略 A：最小改动——只去 `sendQtHoverEvent(true)`，保留 `(false)`

| 项目 | 说明 |
|------|------|
| **思路** | 消除异步 Enter 干扰源（`true`），保留 ArkUI hover-leave 作为 Leave 来源（`false`） |
| **优点** | 保留"鼠标离开所有窗口"场景的 Leave 投递 |
| **缺点** | ArkUI hover-leave 在 XComponent 边界不可靠（这正是原始 bug 的成因），与同步补偿的时序竞争仍然存在 |
| **结论** | ❌ 不可行——保留 `false` 会重新引入时序竞争 |

#### 策略 B：当前实现——两者都去

| 项目 | 说明 |
|------|------|
| **思路** | 完全禁用 hover generator，Enter/Leave 全靠 `processMouseEventsInQtThread` 的静态补偿 |
| **优点** | 无时序竞争，跨窗口 Leave 同步且可靠 |
| **缺点** | "鼠标离开所有窗口"场景无 Leave（§3.2 场景 4，MEDIUM 风险） |
| **结论** | ✅ 当前方案，主要场景覆盖良好 |

#### 策略 C：综合方案——保留 `(false)` 作为防御层 + 去重协调

| 项目 | 说明 |
|------|------|
| **思路** | 保留 `handleQOhosHoverEvent(false)` 处理"离开所有窗口"场景，通过 `s_lastMouseWindow` 去重避免与同步补偿冲突 |
| **优点** | 覆盖场景 4 的盲区，同时避免时序竞争 |
| **缺点** | 需要暴露 `s_lastMouseWindow` 为 public，增加耦合度；ArkUI hover-leave 仍不可靠（可能漏发，但至少不会误发） |
| **结论** | ✅ 推荐——最完善的覆盖 |

### 6.2 推荐策略

**选择策略 C**，理由：

1. **消除已知盲区**：场景 4（鼠标离开所有窗口）是当前唯一的 MEDIUM 风险，策略 C 直接覆盖
2. **去重机制可靠**：通过检查 `s_lastMouseWindow == 当前窗口` 判断补偿是否已执行，避免重复 Leave
3. **ArkUI hover-leave 即使不可靠也无害**：最坏情况是漏发（与策略 B 相同），不会误发（去重机制阻止）
4. **改动量小**：只需恢复 `handleQOhosHoverEvent(false)` 并添加去重逻辑

### 6.3 需要的代码改动

详见 §七。

### 6.4 测试用例清单

| # | 测试场景 | 验证要点 | 预期结果 |
|---|---------|---------|---------|
| 1 | centralWidget → DockWidget | Leave 事件是否触发 | `leaveEvent()` 被调用 |
| 2 | DockWidget → centralWidget（反向） | Leave 事件是否触发 | `leaveEvent()` 被调用 |
| 3 | 快速甩动跨窗口 | 中间事件可丢弃，但最终 Leave 必须到达 | 无残留 hover 状态 |
| 4 | 鼠标移出应用窗口到系统区域 | 最后的 Qt 窗口收到 Leave | `underMouse()` 返回 false |
| 5 | 拖拽 QDockWidget 跨窗口 | 拖拽期间不触发补偿 Leave | 释放后状态正确 |
| 6 | 打开 Popup 菜单后鼠标离开 | Popup 模式下 Leave 正常 | 菜单项高亮正确清除 |
| 7 | 窗口销毁时鼠标在其上 | 不崩溃，无虚假事件 | 应用稳定 |
| 8 | 多顶层窗口切换 | MainWindow ↔ Dialog 的 Leave/Enter | 两个窗口状态都正确 |
| 9 | 触摸屏操作（无 hover） | 不产生虚假 Leave | 触摸行为正常 |
| 10 | `WA_NativeWindow` 关闭后 | 行为与无 `WA_NativeWindow` 一致 | Leave 通过 alien 路径正常投递 |

### 6.5 上线计划

1. **本地验证**：在 Qt 5.12 分支上实现策略 C，用 demo 验证全部 10 个测试用例
2. **回归测试**：在 Qt 5.15 分支上 cherry-pick 相同改动，验证一致性
3. **代码审查**：提交 Gerrit，请 Qt OHOS 团队 review
4. **合入**：通过后合入 `tqtc/harmonyos-5.12.12` 和 `tqtc/harmonyos-5.15.16`

---

## 七、关键代码改动清单（推荐策略 C）

### 7.1 `qohosnativemouseeventshandler.h` — 暴露 static 成员

**改动**：将 `s_lastMouseWindow` 从 private 改为 public，供 `QOhosHoverEventsGenerator` 访问。

```cpp
// 改动前：
private:
    static QPointer<QWindow> s_lastMouseWindow;

// 改动后：
public:
    // 供 QOhosHoverEventsGenerator 的去重逻辑访问
    static QPointer<QWindow> s_lastMouseWindow;
```

### 7.2 `qohoshovereventsgenerator.cpp` — 恢复 `handleQOhosHoverEvent(false)` 并添加去重

**改动前**（当前代码）：

```cpp
void QOhosHoverEventsGeneratorImpl::handleQOhosHoverEvent(bool hovered)
{
    // [FIX] Removed sendQtHoverEvent(false)
    Q_UNUSED(hovered);
}
```

**改动后**：

```cpp
void QOhosHoverEventsGeneratorImpl::handleQOhosHoverEvent(bool hovered)
{
    if (!hovered) {
        // 防御层：鼠标离开 XComponent 时，检查 processMouseEventsInQtThread
        // 是否已经处理了 Leave。如果 s_lastMouseWindow 仍然指向本窗口，
        // 说明没有跨窗口鼠标移动触发补偿（例如鼠标离开了所有 Qt 窗口）。
        m_qWindowRef.visitInQtThreadIfAlive(
            [](QWindow &window) {
                if (QOhosNativeNodeMouseInputHandler::s_lastMouseWindow.data()
                    == &window) {
                    qCDebug(QtForOhos)
                        << "[HoverGen] hover-leave补偿: window=" << &window;
                    QWindowSystemInterface::handleLeaveEvent(&window);
                    QOhosNativeNodeMouseInputHandler::s_lastMouseWindow = nullptr;
                }
                // else: 补偿已在 processMouseEventsInQtThread 中执行，跳过
            });
    }
    // hovered=true 不处理 — Enter 由 processMouseEventsInQtThread 同步补偿
}
```

**关键设计决策**：

| 决策 | 理由 |
|------|------|
| 只恢复 `hovered=false`，不恢复 `hovered=true` | Enter 由同步补偿处理，恢复异步 Enter 会重新引入时序竞争 |
| 用 `s_lastMouseWindow` 去重 | 如果补偿已执行，`s_lastMouseWindow` 已被设为新窗口或 nullptr |
| 用 `visitInQtThreadIfAlive` | hover 回调在 ArkUI 线程，必须投递到 Qt 线程 |
| 去重后设 `s_lastMouseWindow = nullptr` | 防止后续的重复 hover-leave 回调再次触发 |

### 7.3 `qohoshovereventsgenerator.h` — 添加头文件引用

需要 forward-declare `QOhosNativeNodeMouseInputHandler` 或 include 对应头文件：

```cpp
#include <render/qohosnativemouseeventshandler.h>  // 用于访问 s_lastMouseWindow
```

### 7.4 `qohosnativemouseeventshandler.cpp` — 无改动

当前的补偿逻辑保持不变：

```cpp
// qohosnativemouseeventshandler.cpp:194-203（无需修改）
if (!eventHandler->isMouseGrabbed()
    && s_lastMouseWindow && s_lastMouseWindow.data() != targetWindow) {
    QWindow *oldWindow = s_lastMouseWindow.data();
    QWindowSystemInterface::handleLeaveEvent(oldWindow);
    QWindowSystemInterface::handleEnterEvent(
        targetWindow, mouseEvent.localPosition, mouseEvent.globalPosition);
}
s_lastMouseWindow = targetWindow;
```

### 7.5 `qohosinputmethodeventhandler.cpp` — 无改动

保留现有的 `m_lastWindowLeft` 防御机制，不在此文件中添加补偿代码。

---

## 八、可复用经验

### 8.1 本次调试的 5 条经验教训

**教训 1：跨层假设是 Bug 温床**

Qt Widget 层假设 QPA 会投递 Leave，OHOS QPA 假设 ArkUI 会触发 hover 回调。两个"假设对方会做"的组合等于"谁都不做"。

> **原则**：当一个事件在层 A 被"跳过"、期望层 B 投递时，必须验证层 B 在所有场景下都能做到。

**教训 2：异步投递与同步处理的时序竞争**

`visitInQtThreadIfAlive` 的异步投递与 `processMouseEventsInQtThread` 的同步处理产生不可预测的时序竞争。在事件状态机中，重复的 Leave 事件比丢失的 Leave 事件更具破坏性。

> **原则**：如果同一事件有两个来源（一个异步、一个同步），要么消除一个来源，要么添加可靠的去重机制。

**教训 3：静态变量是跨实例状态共享的最后手段**

每个 XComponent 有独立的 handler 实例，实例成员无法感知跨 XComponent 的状态变化。`static` 变量虽然增加了全局耦合，但在 Qt 线程单线程访问的约束下是安全的。

> **原则**：当多个实例需要共享状态时，优先设计单例或 centralized tracker；如果不可行，`static` + 线程安全约束是可行的备选。

**教训 4：修复位置必须在事件的"汇聚点"**

第一轮修复将代码放在 `handleMouseEvent`（每个事件单独处理），无法感知跨窗口切换。第二轮将代码放在 `processMouseEventsInQtThread`（所有事件的汇聚点），可以看到完整的 batch 和窗口级状态。

> **原则**：补偿代码应放在能观察到**所有相关事件**的位置，而非事件链中的某个中间节点。

**教训 5：空实现 ≠ 无影响**

将 `handleQOhosMouseEvent` 和 `handleQOhosHoverEvent` 改为空实现看似"去掉了功能"，实际上改变了整个 Enter/Leave 事件流的拓扑结构。每个空实现都应该有注释说明"为什么空"和"谁接管了这个职责"。

> **原则**：禁用一个机制时，必须确认替代机制覆盖了原机制的所有场景，包括边界情况。

### 8.2 给后续 OHOS QPA 维护者的建议

1. **OHOS 是唯一没有 OS 级 Leave 的平台**——任何新增的窗口类型或控件如果需要 Leave 事件，必须在 QPA 层手动处理
2. **ArkUI hover 回调不可靠**——不要将其作为 Leave 事件的唯一来源，始终配合鼠标事件的窗口切换检测
3. **batching 系统会丢弃旧事件**——补偿代码不能依赖每个事件都到达，应基于最终状态判断
4. **`s_lastMouseWindow` 是全局状态**——修改它时需要考虑所有读取方（当前有两处：`processMouseEventsInQtThread` 和恢复后的 `handleQOhosHoverEvent`）
5. **测试必须覆盖"鼠标离开所有窗口"场景**——这是当前架构的已知最弱点

---

> **引用**：
> - Qt 5.12.12 源码：`<LOCAL_PATH>`
> - OHOS QPA 插件：`<LOCAL_PATH>`
> - Git 历史关键 commit：`96728a820e`（hover generator 原始实现）、`26023a439c`（hover generator 与 mouse handler 绑定）
> - 相关 JIRA：QTFOROH-1835（native node mouse/hover events）、QTFOROH-501（初始 Enter/Leave 实现）

---

## 九、验证与交付（2026-06-09）

### 9.1 手动验证结果

| 状态 | 说明 |
|------|------|
| ✅ **已通过** | 方案四（static 追踪 + 禁用异步投递 + 防御层 Leave）在 OHOS 真机上手动验证通过 |

### 9.2 上游交付件

| 交付件 | 路径 | 说明 |
|--------|------|------|
| ISSUE.md | `<WORK_DIR>/leave-event-fix/ISSUE.md` | 中英双语 issue 说明单（315 行） |
| Clean Patch | `<WORK_DIR>/leave-event-fix/patches/` | 仅含 5 个 Leave event fix 文件，已排除 MDI trace / OHOS-BUG-TRIAGE 无关改动 |
| 纯 Qt Demo | `<INTERNAL_DEMO>` | Qt5/Qt6 通用，桌面可编译 |
| OHOS 工程 Demo | `<INTERNAL_DEMO>` | 完整鸿蒙工程，HAP 已编译 |

### 9.3 工作流闭合

- [x] 阶段一：最简复现 demo 已编译 + 可稳定复现
- [x] 阶段二：调用链已追踪至 qwidgetwindow.cpp:468 + qohoshovereventsgenerator.cpp
- [x] 阶段三：根因定位（双重盲区 + 异步 vs 同步冲突），归属 Qt OHOS QPA 插件
- [x] 阶段四：交付件已输出至 `<WORK_DIR>/leave-event-fix/`
- [x] 知识沉淀：复盘记录已写入本文件
- [x] 工作流强化：框架问题分析方法论阶段四新增 patch 清理和工作流闭合清单
