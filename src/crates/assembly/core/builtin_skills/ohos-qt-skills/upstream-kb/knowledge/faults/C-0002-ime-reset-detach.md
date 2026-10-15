---
id: fault-C-0002
cid: C-0002
type: cause
title: QOhosInputContext::reset() Detach/Attach 收起 IMF 面板并 commit 污染文本
nature: defect
domain: input
fault_type: bug
responsible: qt-port
co_responsible: []
component: "Qt 6.12-beta3 libqohos qohosinputcontext.cpp（reset/commit）"
severity: high
evidence_type: logs
status: workaround
fix_route: "对齐 Android 插件行为（reset 只 finalize preedit），随 Qt 6.12 后续 OHOS kit 合入"
review_note: "Qt 6.12 下一版 OHOS kit 是否合入 reset 修复；顺手验证丢首字（C-0003）"
depends_on: []
affects_qt: ["Qt 6.12-beta3 (libqohos)"]
affects_ohos: ["HarmonyOS PC（MateBook Pro，物理键盘 + 华为输入法）"]
qoh: []
first_seen: 2026-09-12
review_due: 2026-12-14
created: 2026-09-14
updated: 2026-09-14
tags: [qt, harmonyos, ime, inputmethod, qohosinputcontext, reset, detach, preedit, 拼音, workaround, bug]
audience: public
refs: [problem-runtime-ohos-ime-reset-detach, problem-build-qt612-ohos-plugin-rebuild, fault-C-0003]
summary: >
  QOhosInputContext::reset() 里 Detach/Attach 输入法控制器，拼音组合中途收起软键盘
  且 commit() 把 pending 拼音字母强制上屏。defect/qt-port；修复=对齐 Android 插件行为，
  临时方案 W-0002（重编 libqohos）已真机验证，待上游合入 Qt6 OHOS kit。
---

# C-0002 QOhosInputContext::reset() 的 Detach/Attach

> nature: defect ｜ 责任: qt-port ｜ 状态: workaround ｜ 表现: S-0002 ｜ 复核: 2026-12-14

## 表现（symptoms）

### S-0002 拼音组合输入异常：键盘中途收起 + 拼音字母污染上屏文本

- 拼音组合输入进行到一半，软键盘被系统收起（hilog `handlePanelHiding`）；
- 选词上屏后文本混入拼音字母（如「ji极速搜索」），污染搜索框查询词；
- Qt 侧 `showTextInput` 被重复触发 8+ 次，光标跳到编辑区底部。

## 根因 / 定性依据（源码级，已确认）

`qohosinputcontext.cpp` 的 `reset()` 原实现：

```cpp
void QOhosInputContext::reset()
{
    setImConnectionState(Detached);   // OHOS IMF 的 Detach 直接收起键盘面板
    setImConnectionState(Attached);
}
```

1. **Detach 收起面板**：OHOS IMF 的 `OH_InputMethodController_Detach` 语义比 Android
   激进——组合中途 detach 直接塌掉键盘面板，打断候选词选择；
2. **commit 污染文本**：`commit()` 把 `m_pendingPreeditText`（拼音组合期原始字母
   preview）强制 `setCommitString` 上屏。

## 责任判定

`qt-port`（Qt OHOS 平台插件行为与 Qt Android 插件不对齐）。修复随 Qt 6.12 后续
beta/RC 的 OHOS kit 发布。

## 根治方案（defect，已明确待上游合入）

对齐 Qt Android 插件行为：

```cpp
void QOhosInputContext::reset()
{
    // 只收尾未决 preedit，不 detach/attach，保持 IMF 连接与面板状态
    if (!m_pendingPreeditText.isEmpty())
        commit();
}
```

## 临时方案（Workarounds）

- **W-0002（adopted，已验证 2026-09-12 真机）**：按
  [build-qt612-ohos-plugin-rebuild](../problems/build-qt612-ohos-plugin-rebuild.md)
  流程重编 libqohos.so 并替换 kit 部署。代价：kit 每次更新需重打补丁重编。
  退役条件：上游版本含此修复后恢复官方 kit，移除本地重编流程。

## 跟踪单（Tickets）

- 尚无（未上报）。2026-09-12 已完成根因与修复验证，IMEPROBE 探针法材料齐全，
  待按 `procedural/qt-bug-report-generation.md` 提交；建议与
  [C-0003](C-0003-ime-focus-switch-race.md) 合并成一份材料。排查方法论见
  [runtime-ohos-ime-reset-detach](../problems/runtime-ohos-ime-reset-detach.md)。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-09-12 | Qt 6.12-beta3 / HarmonyOS PC（MateBook Pro） | IMEPROBE 探针定位 + 重编 libqohos 替换 kit | 键盘不再收起、文本不再污染 | → workaround |

## 关联

- 症状（S）：S-0002
- 临时方案（W）：W-0002
- 跟踪单（T）：暂无
- problems：[runtime-ohos-ime-reset-detach](../problems/runtime-ohos-ime-reset-detach.md)、
  [build-qt612-ohos-plugin-rebuild](../problems/build-qt612-ohos-plugin-rebuild.md)
- 相关根因（C）：[C-0003](C-0003-ime-focus-switch-race.md)（同组件，焦点切换竞态，open）
