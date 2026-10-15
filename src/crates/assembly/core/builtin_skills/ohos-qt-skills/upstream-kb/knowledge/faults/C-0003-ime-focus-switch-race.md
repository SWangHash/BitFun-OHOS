---
id: fault-C-0003
cid: C-0003
type: cause
title: IME focus 切换瞬间 Detach→Attach 竞态，首字符 commit 给旧 focus object
nature: defect
domain: input
fault_type: bug
responsible: qt-port
co_responsible: []
component: "Qt 6.12-beta3 libqohos qohosinputcontext.cpp（focus 切换时序）"
severity: medium
evidence_type: logs
status: open
fix_route: "同 C-0002 组件，随其修复合并提交（commit 前校验 focus object 的 ImEnabled）"
review_note: "与 C-0002 一并验证（Qt 6.12 下一版 kit）"
depends_on: []
affects_qt: ["Qt 6.12-beta3 (libqohos)"]
affects_ohos: ["HarmonyOS PC（华为输入法）"]
qoh: []
first_seen: 2026-09-12
review_due: 2026-12-14
created: 2026-09-14
updated: 2026-09-14
tags: [qt, harmonyos, ime, focus, detach, attach, 竞态, 丢字, bug]
audience: public
refs: [fault-C-0002, problem-runtime-ohos-ime-reset-detach]
summary: >
  焦点切换瞬间（Detach→Attach 竞态）首字母被 commit 给旧 focus object（新字段尚未
  接上），表现为偶发丢首字。defect 暂判 qt-port；未完全定位（有探针时序证据，无源码
  级隔离复现），无临时方案。
---

# C-0003 IME focus 切换瞬间 Detach→Attach 竞态

> nature: defect ｜ 责任: qt-port ｜ 状态: open ｜ 表现: S-0003 ｜ 复核: 2026-12-14

## 表现（symptoms）

### S-0003 输入框焦点切换后首字符偶发丢失

偶发：输入框获得焦点后输入的第一个字符丢失。IMEPROBE 探针时序证据：focus 切换瞬间
`previewText raw=[j]` 后紧跟 `commit pending=[j]`——首字母被 commit 给了**旧的**
focus object（此刻 `pushText left=[]` 为空，新字段还没接上）。

## 根因 / 定性依据

Detach→Attach 竞态：commit 目标 focus object 与 IMF 回调时序不同步。
**未完全定位**（已捕获时序证据，未做源码级隔离复现）。

## 责任判定

暂判 `qt-port`（组件与竞态均在 Qt ohos 插件的 IME 桥内；若后续证明是 IMF 回调时序
问题再改判 ohos-runtime，CID 不变）。

## 根治方案（defect，思路）

commit 前校验 focus object 的 ImEnabled 查询结果，不匹配则丢弃/缓存待投递。

## 临时方案（Workarounds）

- 无（用户侧重打丢失字符）。

## 跟踪单（Tickets）

- 未上报。与 [C-0002](C-0002-ime-reset-detach.md) 同组件，建议合并为一份 issue 材料
  一起提交。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-09-12 | Qt 6.12-beta3 / HarmonyOS PC | IMEPROBE 探针时序观察 | 捕获丢首字时序证据 | → open |

## 关联

- 症状（S）：S-0003
- 临时方案（W）：无
- 跟踪单（T）：暂无
- problems：[runtime-ohos-ime-reset-detach](../problems/runtime-ohos-ime-reset-detach.md)
  §已知未修问题
- 相关根因（C）：[C-0002](C-0002-ime-reset-detach.md)（同组件，主 bug 已本地修复）
