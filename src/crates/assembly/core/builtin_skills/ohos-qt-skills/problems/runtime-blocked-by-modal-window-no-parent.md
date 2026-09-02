---
id: problem-runtime-blocked-by-modal-window-no-parent
type: problem
domain: runtime
tags: [blockedByModalWindow, QDialog, transientParent, qpa, syntheticParent, close-blocked, scroll-blocked, qt515, patch, qt, harmonyos, three-level-window, ohostemplate]
created: 2026-08-06
updated: 2026-08-06
status: solved
severity: high
audience: public
refs: [episodic-ohostemplate-blockedbymodal-patch, semantic-qt-harmonyos-window-model]
summary: >
  无 parent 的 QDialog() 在 OHOS 上被 blockedByModalWindow=1 拦截 close() 和滚轮事件。
  根因：OHOS QPA syntheticParent fallback 分类窗口为 SubWindow，但不调 setTransientParent() 反写 Qt 层，
  导致 isWindowBlocked() 的 isAncestorOf() 检查失败。修复：QPA showImmediate() 在 fallback 后反写 transientParent。
leader_summary: >
  定位并修复 Qt 源码层 blockedByModalWindow 根因，patch 设备验证通过，影响所有无 parent QDialog 场景
impact: [框架支撑, 商业答复, 运行时排障]
deliverables: [problem记录, patch, 源码分析报告]
evidence: [ohos-qt-patch-delivery, hilog 验证日志]

error_message: >
  processCloseEvent: blockedByModal=1 -> close 不执行
  QDialog close() 后窗口仍可见
  滚轮事件被 processWheelEvent 拦截（同一 blocked 标记）
error_code: ""
keywords: [blockedByModalWindow, QDialog, transientParent, syntheticParent, 关不掉, 滚不动, 三级窗口, isWindowBlocked]
symptoms: "QDialog 关不掉 + 不能滚动（同时出现），尤其在 matplotlib 三级窗口场景"

environment: "OHOS + Qt 5.15.16 + ohostemplateforqtapplication"
---

# 无 parent QDialog 被 blockedByModalWindow 拦截

## 错误信息

```
processCloseEvent: blockedByModal=1  (patch 前)
-> close() 不执行，窗口无法关闭
-> processWheelEvent if(blocked) return，滚轮不响应
```

## 场景

matplotlib NavigationToolbar -> Configure subplots -> SubplotToolQt -> Export values 创建的三级 QDialog。
`_export_values()` 中 `QDialog()` 无 parent。所有"无 parent 的 QDialog + 有模态兄弟窗口"的场景都可能触发。

## 原因

OHOS QPA `determineViewTypeAndLogicalParent()` 对无 parent 的 Dialog 用 syntheticParent fallback 分类为 SubWindow，
**但从不调 `QWindow::setTransientParent()` 反写 Qt 层**。Qt 层 `isWindowBlocked()` 通过 `isAncestorOf()` 检查 parent 链时，
发现 transientParent 为 null，判定为"被模态兄弟阻塞" -> blockedByModalWindow=1。

与 `ghost-window-dialog-close` 属同一根因族（syntheticParent 不反写 transientParent）。

## 解决方案

Qt 源码 patch：`qohosview.cpp` 的 `showImmediate()` 在 syntheticParent fallback 后反写 `setTransientParent()`。
详见 `episodic-ohostemplate-blockedbymodal-patch.md`。

```cpp
if (currentViewTypeInfo.viewType == SubWindow
    && currentViewTypeInfo.syntheticParent
    && m_ownerWindow->transientParent() == nullptr) {
    auto *tpWindow = currentViewTypeInfo.syntheticParent->qWindow();
    if (tpWindow && tpWindow != m_ownerWindow)
        m_ownerWindow->setTransientParent(tpWindow);
}
```

应用层临时 workaround：`QDialog()` 改为 `QDialog(self)` + `WA_DeleteOnClose`。

## 注意事项

- 此问题在 Win32 上也存在（逻辑链一致），但 Win32 窗口管理器的 `GetActiveWindow()` owner 机制在系统层面兜底
- patch 仅对 syntheticParent fallback 场景生效，有 parent 的 QDialog 不受影响
- 同一 blocked 标记同时影响 close 和 scroll，修复后两个问题同时解决

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 定位 Qt 源码层 blockedByModalWindow 根因，patch 设备验证通过 |
| 影响面 | 所有无 parent QDialog 场景（matplotlib、多窗口应用等） |
| 交付物 | problem 记录、patch、源码分析报告 |
| 证据 | hilog 日志验证链 |
| 可复用方式 | 遇到 QDialog 关不掉+滚不动时直接复用此 patch |
