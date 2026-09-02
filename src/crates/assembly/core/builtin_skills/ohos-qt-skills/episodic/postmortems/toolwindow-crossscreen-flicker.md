---
id: episodic-toolwindow-crossscreen-flicker
type: episodic
domain: postmortem
tags: [bug, window, cross-screen, flicker, system-issue, moveWindowToGlobalDisplay, resizeAsync, ohos-window]
created: 2026-06-05
updated: 2026-06-05
status: active
audience: public
refs: [semantic-qt-harmonyos-window-model]
summary: >
  ToolWindow跨屏闪烁系统问题分析：moveWindowToGlobalDisplay与resizeAsync在跨屏拖拽场景冲突，
  screenIdChanged仅拖拽结束时触发，Qt已通过完整调用链追踪定位根因，归属鸿蒙系统接口。
---

# ToolWindow 跨屏闪烁 — 系统问题分析

> 商业 Qt 反馈：拖拽 MainWindow 标题栏跨屏时，Qt::Tool 子窗口闪烁。
> 工作流 系统问题验证 完整执行。

---

## 问题概述

| 项目 | 内容 |
|------|------|
| 报告来源 | 商业 Qt 问题反馈 |
| 问题现象 | 拖拽 MainWindow 跨屏时 ToolWidget 闪烁 |
| 触发条件 | 多屏设备 + 拖拽标题栏 + Qt::Tool 子窗口 |
| 归属判定 | **鸿蒙系统接口** |
| 交付路径 | `<WORK_DIR>/toolwindow-crossscreen-flicker/` |
| 复现 Demo | `<INTERNAL_DEMO>` |

## 完整调用链

```
MainWindow::moveEvent()
  → updateToolWidget()
    → m_toolWidget->setGeometry(rect)
      → QOhosFloatingWindow::setGeometry(rect)        [qohosfloatingwindow.cpp:44]
        → view->setPosition(topLeft)                  [line 68]
          → QOhosView::setSystemUpdateProperty(position)  [batched]
          → flush → updateWindowPosition()            [qohosview.cpp:810]
            → m_ohosWindowProxy->moveWindowToGlobalOrGlobalDisplay()  [qohoswindowproxy.cpp:372]
              → "moveWindowToGlobalDisplay(x, y)"     [line 434, Promise]
        → view->setSize(size)                         [line 70]
          → QOhosView::setSystemUpdateProperty(size)  [batched]
          → flush → updateWindowSize()                [qohosview.cpp:801]
            → m_ohosWindowProxy->setSize()            [qohoswindowproxy.cpp:442]
              → "resizeAsync(w, h)"                   [line 452, Promise]
```

## 根因

Qt 在 `QOhosFloatingWindow::setGeometry` 中同时调用 `setPosition` 和 `setSize`，通过 QOhosView 的批处理机制（`setSystemUpdateProperty` + `flushSystemPropertyUpdatesImmediate`）同时 flush 到系统接口。

在跨屏拖拽场景中：
- `moveWindowToGlobalDisplay` 触发窗口的屏幕迁移
- `resizeAsync` 在窗口正在迁移屏幕时被执行
- 两个异步操作的渲染在跨屏上下文中产生冲突 → **闪烁**

## 关键证据

1. **屏蔽 resizeAsync → 闪烁消失**（窗口大小实际未变化）
2. screenIdChanged 仅在拖拽结束时触发（Qt 无异议）
3. Qt 已确认 setPosition 和 setSize 在 QOhosView 层做了批处理

## 日志证据（编译安装 libqohos.so 后抓取）

**每次 moveEvent 的完整调用序列**：
```
setGeometry: win=0x5a1f8f2b80 pos=(1888,743) size=476x203 isToolWindow=11
flush: updateWindowSize win=0x5a1f8f2b80 size=476x203
WindowProxy::setSize 476,203 proxyType=2
JS-CALL: resizeAsync(476,203)                    ← 每次都调用，即使 size 未变
flush: updateWindowPosition win=0x5a1f8f2b80 pos=(1888,743) hasDisplayId=0
WindowProxy::moveToGlobal 1888,743 displayId=-1.000000 proxyType=2
JS-CALL: moveWindowToGlobalDisplay(1888,743)      ← 在 resize 之后
```

**关键发现**：
- 窗口大小 476×203 在整个拖拽过程中**从未变化**
- 但每次 moveEvent 都触发了 `resizeAsync`（10+ 次冗余调用）
- 执行顺序固定：`resizeAsync` → `moveWindowToGlobalDisplay`
- 用户验证：**不调用 resizeAsync 时闪烁完全消失**

## 根因确认

**系统接口问题**：鸿蒙系统的 `moveWindowToGlobalDisplay` 和 `resizeAsync` 在跨屏拖拽场景下无法保证渲染原子性。

Qt 框架行为：
1. `QOhosView` 批处理机制正常工作 — position 和 size 在同一次 flush 中发出
2. `QOhosFloatingWindow::setGeometry` 每次都无条件调用 `setPosition` + `setSize`
3. 这是合理的框架设计 — 保证窗口状态与系统同步

系统侧行为：
1. 接收到 `resizeAsync` 后触发窗口重绘/动画
2. 紧接着 `moveWindowToGlobalDisplay` 触发跨屏迁移
3. 两个异步操作的渲染无法在同一帧内完成 → **中间状态导致闪烁**

## 归属判定

🔴 **鸿蒙系统接口问题**（非 Qt 框架 bug）

Qt 的 `setSize` 调用是必要的（确保窗口状态同步），不应跳过。问题在于系统侧无法原子化执行 resize + move 操作。

## 纯鸿蒙真机验证（2026-06-05）

在 **HUAWEI MateBook Fold | ULTIMATE DESIGN** 双屏真机上，使用纯 ArkTS 代码（不依赖 Qt）成功复现完全一致的闪烁现象。

**实现方式**：`setInterval(50ms)` 轮询主窗口位置变化 → 同时调用 `subWindow.moveWindowTo()` + `subWindow.resize()`

| 操作 | 结果 |
|------|------|
| `moveWindowTo` + `resize` 同时调用 | **子窗口闪烁** ✅ 复现 |
| 仅 `moveWindowTo`，不调用 `resize` | **子窗口不闪烁** |

**结论**：问题在鸿蒙系统层面，与 Qt 框架无关。

## 可复用经验

1. **批处理不等于原子性**：Qt 在 QOhosView 层做了批处理（两个操作同时 flush），但系统侧对两个异步操作的原子性保证不足
2. **冗余调用是触发器**：即使 size 未变，`setSize` 仍触发 `resizeAsync`，这种"无害"的冗余调用在跨屏场景下成为问题触发器
3. **跨屏场景特殊性**：很多窗口操作在单屏场景下正常，但在跨屏场景下（窗口正在迁移屏幕时）行为不可预测
4. **screenIdChanged 延迟触发**：拖拽过程中不触发屏幕变更回调，这意味着 Qt 在拖拽期间无法得知窗口当前所在屏幕
5. **⚠️ 不要急于修改 Qt 框架**：遇到疑似系统问题时，应先评估系统接口表现是否正常，而非优先修改 Qt 代码。修改框架代码必须严格评估影响范围（如跳过 setSize 可能导致首次大小不正确）

## 相关上下文

- 系统问题验证 — 本问题使用的工作流
- [[qt-harmonyos-window-model]] — 窗口模型理解
- Qt 框架分析方法论
