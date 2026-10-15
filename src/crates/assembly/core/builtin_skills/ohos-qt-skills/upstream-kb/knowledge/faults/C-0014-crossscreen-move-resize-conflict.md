---
id: fault-C-0014
cid: C-0014
type: cause
title: ohos window 接口 moveWindowToGlobalDisplay × resizeAsync 跨屏迁移无渲染原子性（冗余 resize 成闪烁触发器）
nature: defect
domain: render
fault_type: bug
responsible: ohos-runtime
co_responsible: []
component: "HarmonyOS 窗口接口 moveWindowToGlobalDisplay × resizeAsync（跨屏拖拽场景）"
severity: medium
evidence_type: both
status: diagnosed
fix_route: "系统侧保证跨屏迁移场景 move+resize 渲染原子性（或提供原子化窗口几何更新接口），随系统 OTA / 新 API 版本到达；未提单前无到达路径"
review_note: "severity 校准（商业 Qt 反馈、多屏必现）；向华为侧提单（当前无单号，提单材料 demo+日志已齐）；系统版本对跨屏 move+resize 原子性的改进；W-0012 是否转正"
depends_on: []
affects_qt: ["未记录（源页仅记 libqohos.so 重编插桩采集日志，kit 版本未记录）"]
affects_ohos: ["未记录（HUAWEI MateBook Fold 双屏真机实证，系统版本未记录）"]
qoh: []
first_seen: 2026-06-05
review_due: 2026-12-15
created: 2026-09-15
updated: 2026-09-15
tags: [qt, harmonyos, window, cross-screen, flicker, toolwindow, moveWindowToGlobalDisplay, resizeAsync, multi-display, system-defect]
audience: public
refs: [episodic-toolwindow-crossscreen-flicker, semantic-qt-harmonyos-window-model]
summary: >
  跨屏拖拽时鸿蒙系统 moveWindowToGlobalDisplay（触发屏幕迁移）与 resizeAsync 两个
  异步操作无法同帧完成，中间态渲染导致 Qt::Tool 子窗口闪烁；Qt setGeometry 的冗余
  resize（size 未变仍调 resizeAsync）是触发器。defect/ohos-runtime（系统接口行为
  缺陷，diagnosed；纯 ArkTS 真机复现排除 Qt 因素，evidence=both）；临时方案
  W-0012（去冗余 resize）proposed；跟踪单暂无（源页未记录单号）。
---

# C-0014 跨屏迁移时 moveWindowToGlobalDisplay × resizeAsync 无渲染原子性

> nature: defect ｜ 责任: ohos-runtime ｜ 状态: diagnosed ｜ 表现: S-0013 ｜ 方案: W-0012（proposed）｜ 跟踪: 暂无 ｜ 复核: 2026-12-15

## 表现（symptoms）

### S-0013 多屏拖拽 MainWindow 跨屏时 Qt::Tool 子窗口闪烁

商业 Qt 问题反馈：多屏设备上拖拽 MainWindow 标题栏跨屏时，Qt::Tool 子窗口
（ToolWidget）持续闪烁。触发条件：多屏 + 拖拽标题栏 + Qt::Tool 子窗口。完整
分析过程见复盘 [toolwindow-crossscreen-flicker](../episodic/postmortems/toolwindow-crossscreen-flicker.md)。

## 根因 / 定性依据

Qt 侧完整调用链（源页，含 file:line）：

```
MainWindow::moveEvent() → updateToolWidget()
  → m_toolWidget->setGeometry(rect)
    → QOhosFloatingWindow::setGeometry(rect)        [qohosfloatingwindow.cpp:44]
      → view->setPosition(topLeft)                  [line 68]
          → flush → updateWindowPosition()          [qohosview.cpp:810]
            → m_ohosWindowProxy->moveWindowToGlobalOrGlobalDisplay()  [qohoswindowproxy.cpp:372]
              → "moveWindowToGlobalDisplay(x, y)"   [line 434, Promise]
      → view->setSize(size)                         [line 70]
          → flush → updateWindowSize()              [qohosview.cpp:801]
            → m_ohosWindowProxy->setSize()          [qohoswindowproxy.cpp:442]
              → "resizeAsync(w, h)"                 [line 452, Promise]
```

日志证据（重编 libqohos.so 插桩后抓取，每次 moveEvent）：

```
JS-CALL: resizeAsync(476,203)                    ← 每次都调用，即使 size 未变
JS-CALL: moveWindowToGlobalDisplay(1888,743)      ← 固定在 resize 之后
```

关键事实：
1. 窗口大小 476×203 在整个拖拽过程中**从未变化**，但每次 moveEvent 都触发
   `resizeAsync`（10+ 次冗余调用），执行顺序固定 resizeAsync → moveWindowToGlobalDisplay；
2. **屏蔽 resizeAsync → 闪烁完全消失**（Qt 侧用户验证）；
3. `QOhosView` 批处理机制正常（position/size 同一次 flush 发出），
   `QOhosFloatingWindow::setGeometry` 无条件调 setPosition + setSize 属合理的
   框架设计（保证窗口状态与系统同步）。

**根因**：跨屏拖拽场景中，`moveWindowToGlobalDisplay` 触发窗口屏幕迁移，
`resizeAsync` 在迁移进行中被执行——系统侧两个异步操作的渲染无法在同一帧内完成
（无原子性保证），中间状态渲染即闪烁。

**纯鸿蒙真机复现（排除 Qt 因素）**：HUAWEI MateBook Fold 双屏真机上，用纯 ArkTS
代码（`setInterval(50ms)` 轮询主窗口位置 → 同时调 `subWindow.moveWindowTo()` +
`subWindow.resize()`）复现完全一致的闪烁；仅 `moveWindowTo` 不调 `resize` 则不闪。
→ 问题在鸿蒙系统层面，与 Qt 框架无关。

## 责任判定

`ohos-runtime`——系统窗口接口在跨屏迁移场景无法原子化执行 resize + move
（系统接口行为缺陷，处置：系统问题）。Qt 侧行为合理且必要（跳过 setSize 可能
导致首次大小不正确——源页复盘明确警告"不要急于修改 Qt 框架"）。

## 根治方案（defect）

系统侧：保证跨屏迁移场景 `moveWindowToGlobalDisplay` × `resizeAsync` 的渲染
原子性，或提供原子化窗口几何更新接口。未提单前无到达路径（随系统 OTA / 新
API 版本，需建 T 跟踪）。

## 临时方案（Workarounds）

- **W-0012（proposed，对照实验验证 2026-06-05 双屏真机）**：去冗余 resize——
  size 未变化时不触发 resizeAsync：
  1. Qt 适配层：`QOhosView` 批处理 flush 时比较新旧 size，值未变则跳过
     `updateWindowSize()`（改 qohosview.cpp / qohosfloatingwindow.cpp，需重编
     libqohos.so / kit）；
  2. 应用层（自管 ToolWindow 场景）：`setGeometry` 前比对旧 size，size 未变只
     move 不 resize。

  代价：① 改框架需重编 kit 并严格评估影响范围（跳过 setSize 可能导致首次大小
  不正确）；② 应用层方案只覆盖自管窗口。
  验证依据：屏蔽 resizeAsync 后闪烁消失（2026-06-05，MateBook Fold 双屏真机，
  Qt 侧用户验证 + 纯 ArkTS 对照复现同结论）；**机制已验证但未作为长期方案采用**
  （复盘结论：先评估系统接口表现，不急于改框架）。
  退役条件：系统侧保证跨屏 move+resize 渲染原子性（或提供原子几何更新 API）后，
  移除跳过冗余 resize 的补丁并回归跨屏拖拽测试。

## 跟踪单（Tickets）

暂无（复盘未记录上游单号；商业 Qt 反馈渠道的原始单号未随源页留存）。占位
说明：若后续向华为侧提交 issue，建议以 ohos-issue 立案并回填本节——
evidence=both（纯 ArkTS 复现 demo + 调用链日志）已满足提单证据门禁。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-06-05 | Qt OHOS（libqohos.so 重编插桩）/ 多屏真机 | 完整调用链追踪 + 日志采集：resizeAsync → moveWindowToGlobalDisplay 固定顺序，size 未变仍触发 resizeAsync 10+ 次；屏蔽 resizeAsync 闪烁消失 | 锁定冗余 resize 为触发器、系统接口冲突为根因 | → diagnosed |
| 2026-06-05 | HUAWEI MateBook Fold 双屏真机（纯 ArkTS，无 Qt） | moveWindowTo + resize 同时调用复现闪烁；仅 moveWindowTo 不调 resize 则不闪 | 跨 Qt 复现成功，排除 Qt 框架因素，归属系统接口 | （维持 diagnosed） |

## 关联

- 症状（S）：S-0013
- 临时方案（W）：W-0012
- 跟踪单（T）：暂无（源页无单号；提单材料已齐备）
- episodic：[toolwindow-crossscreen-flicker](../episodic/postmortems/toolwindow-crossscreen-flicker.md)（完整调用链、插桩日志、纯 ArkTS 复现、可复用经验）
- semantic：[qt-harmonyos-window-model](../semantic/qt-harmonyos-window-model.md)
- 相关根因（C，含 depends_on 说明）：无（screenIdChanged 拖拽期间延迟触发的观察记录在复盘页，未单独定性为根因）
