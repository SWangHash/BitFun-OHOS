---
id: fault-C-0009
cid: C-0009
type: cause
title: OHOS QPA syntheticParent fallback 不反写 transientParent，无 parent QDialog 被 blockedByModalWindow 误拦截
nature: defect
domain: runtime
fault_type: bug
responsible: qt-port
co_responsible: []
component: "Qt 5.15.16 OHOS QPA qohosview.cpp（determineViewTypeAndLogicalParent / syntheticParentForQWindowOrNull / showImmediate）× qguiapplication.cpp isWindowBlocked()"
severity: high
evidence_type: logs
status: workaround
fix_route: "上游合入 showImmediate() 反写 setTransientParent() 的 qohosview.cpp patch（约 8 行），随 harmonyos-5.15.16 分支 / 下一版 Qt OHOS SDK 到达"
review_note: "查 harmonyos-5.15.16 分支是否已合入 transientParent 反写；未合入则按 qt-bug-report-generation 提单（先补单文件 main.cpp 最小 demo：无 parent QDialog + 模态兄弟窗口）；kit 更新时 W-0007 需重打"
depends_on: []
affects_qt: ["Qt 5.15.16 (tqtc/harmonyos-5.15.16，patch 基线 commit 未记录)"]
affects_ohos: ["真机（系统版本未记录）"]
qoh: [QOH029]
first_seen: 2026-08-04
review_due: 2026-12-15
created: 2026-09-15
updated: 2026-09-15
tags: [qt, harmonyos, qpa, blockedByModalWindow, QDialog, transientParent, syntheticParent, window, close-blocked, scroll-blocked, matplotlib, workaround, bug]
audience: public
refs: [problem-runtime-blocked-by-modal-window-no-parent, episodic-ohostemplate-blockedbymodal-patch, semantic-qt-harmonyos-window-model]
summary: >
  OHOS QPA 用 syntheticParent fallback 把无 parent Dialog 分类为 SubWindow 并在 ArkUI
  层建立归属，却从不调 setTransientParent() 反写 Qt 层，isWindowBlocked() 的
  isAncestorOf() 检查失败，blockedByModalWindow=1 同时拦截 close() 与滚轮。defect/
  qt-port；本地 patch（showImmediate 反写，约 8 行）已真机验证（W-0007），暂无跟踪单。
---

# C-0009 OHOS QPA syntheticParent 不反写 transientParent

> nature: defect ｜ 责任: qt-port ｜ 状态: workaround ｜ 表现: S-0008 ｜ 方案: W-0007 ｜ 跟踪: 暂无 ｜ 复核: 2026-12-15

## 表现（symptoms）

### S-0008 无 parent 的 QDialog 关不掉且滚轮不响应

- `processCloseEvent: blockedByModal=1` → close() 不执行，窗口关不掉（残留 ghost window）；
- 滚轮事件被同一 blocked 标记拦截（`processWheelEvent if (blocked) return`），不能滚动——**close 与 scroll 同时失效**是本症状的辨识特征；
- 典型场景：matplotlib NavigationToolbar → Configure subplots → SubplotToolQt → Export values 创建的三级 `QDialog()`（`_export_values()` 无 parent）；一切"无 parent QDialog + 存在模态兄弟窗口"的场景都可触发。

## 根因 / 定性依据（源码级 + 设备 hilog，已确认）

根因链：

```
QDialog() 无 parent
  → Qt 层 QWindow::transientParent() == nullptr
  → OHOS QPA determineViewTypeAndLogicalParent() 用 syntheticParent fallback 分类为 SubWindow
  → syntheticParent 传给 createSubWindow（ArkUI 层建立归属）
  → OHOS QPA 从不调 QWindow::setTransientParent() 反写 Qt 层（qohosview.cpp 零调用）
  → Qt 层 transientParent 仍为 null
  → isWindowBlocked() 的 isAncestorOf() 检查失败
  → blockedByModalWindow = 1
  → processCloseEvent() if (blocked) return → close 不执行（滚轮同标记同拦截）
```

关键源码位置：`qohosview.cpp:252-261`（`syntheticParentForQWindowOrNull()`）、`qohosview.cpp:390-471`（`tryCreateWindowProxyIfNeeded()`）、`qguiapplication.cpp:899-958`（`isWindowBlocked()`）。

设备验证（hilog，patch 前后对照）：

- patch 前：`processCloseEvent: blockedByModal=1`，close() 不可达，窗口残留；
- patch 后（17:39 验证链）：`blockedByModal=0` → `closeEvent sent, accepted=1` → `close() returned=1 proxyAfter=0`，窗口正确销毁。

平台对照：Win32 上 blockedByModalWindow 逻辑链一致，但窗口管理器 `GetActiveWindow()` owner 机制在系统层兜底遮蔽了问题；OHOS 无兜底，Qt 必须在 QPA 层自维护 transientParent 关系。

证据形态：`logs`（源码定位 + hilog 设备验证链）；**无最小复现 demo**——提上游前须按 demo 七原则补单文件 main.cpp（无 parent QDialog + 模态兄弟窗口 + 编号复现步骤）。

## 责任判定

`qt-port`——缺陷位于 Qt OHOS 平台插件（libqohos QPA）：syntheticParent fallback 只建了 ArkUI 层归属、不反写 Qt 层 transientParent，属适配层实现不完整。修复到达路径：harmonyos-5.15.16 分支合入 / 下一版 Qt OHOS SDK。

## 根治方案（defect）

`qohosview.cpp` 的 `showImmediate()` 在 syntheticParent fallback 后反写 transientParent（三候选方案中改动最小、风险最低项，约 8 行）：

```cpp
if (currentViewTypeInfo.viewType == SubWindow
    && currentViewTypeInfo.syntheticParent
    && m_ownerWindow->transientParent() == nullptr) {
    auto *tpWindow = currentViewTypeInfo.syntheticParent->qWindow();
    if (tpWindow && tpWindow != m_ownerWindow)
        m_ownerWindow->setTransientParent(tpWindow);
}
```

10 场景风险评估通过（有 parent 的 QDialog 跳过、ToolTip/Popup 不受影响、showImmediate 多次调用无负面、lastWindowClosed 行为更安全等），完整评估见 episodic 复盘。备选方案（重写 isAncestorOf 约 20 行 / 改 Qt GUI kernel 共享代码约 10 行）风险更高，不推荐。

## 临时方案（Workarounds）

- **W-0007（adopted，已验证 2026-08-06 真机）**：按上述 patch 重编 libqohos.so 并替换 kit / 目标工程部署（交付件含 patch、libs、模板，见 episodic 复盘）。
  代价：Qt kit 每次更新需重打补丁重编。
  退役条件：上游 harmonyos 分支合入 transientParent 反写后，恢复官方 kit、移除本地重编流程，并回归三级窗口关闭测试。
- 应用层备选（未单独建 W，未验证）：`QDialog()` 改 `QDialog(self)` + `WA_DeleteOnClose`——需逐处修改对话框构造点，且改不到三方库（matplotlib 等）内部创建的无 parent QDialog，仅适用于自有代码可控的场景。

## 跟踪单（Tickets）

- 暂无（无实证单号）。patch 已产出、评估为可提交 tqtc，但未见提交记录；提单前须按 `procedural/qt-bug-report-generation.md` 可复现性 HARD 闸门补最小 demo（单文件 main.cpp + 编号复现步骤）。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-08-04 | Qt 5.15.16 / OHOS 真机（ohostemplate，matplotlib 三级窗口） | hilog（43844 行）定位：三级窗口关闭链路断在 `onSubWindowCloseHandler: calling close()` | 确认 close 被 Qt 层拦截，转入源码分析 | → open |
| 2026-08-06 | Qt 5.15.16 / OHOS 真机（ohostemplate） | `showImmediate()` 反写 transientParent patch 重编部署，hilog 17:39 验证链 | blockedByModalWindow 1→0、closeEvent accepted=1、close()=1、proxy 销毁 | → workaround |

（历史事实来源：[ohostemplate-blockedbymodal-patch](../episodic/postmortems/ohostemplate-blockedbymodal-patch.md) 复盘与 [runtime-blocked-by-modal-window-no-parent](../problems/runtime-blocked-by-modal-window-no-parent.md)；主编合入时按门禁在本表首行登记审核复现。）

## 关联

- 症状（S）：S-0008
- 临时方案（W）：W-0007
- 跟踪单（T）：暂无
- problems：[runtime-blocked-by-modal-window-no-parent](../problems/runtime-blocked-by-modal-window-no-parent.md)
- episodic：[ohostemplate-blockedbymodal-patch](../episodic/postmortems/ohostemplate-blockedbymodal-patch.md)（方案对比、10 场景风险评估、部署记录）
- semantic：[qt-harmonyos-window-model](../semantic/qt-harmonyos-window-model.md) §Known Gap（QPA syntheticParent 不反写 transientParent）
- QOH（机器层）：QOH029（dialog_blocked_no_parent）
- 相关根因（C）：无（问题页所述 ghost-window-dialog-close"同根因族"在库内无独立页，全仓仅该页自提及）
