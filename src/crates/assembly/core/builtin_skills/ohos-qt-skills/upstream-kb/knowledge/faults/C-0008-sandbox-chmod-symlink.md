---
id: fault-C-0008
cid: C-0008
type: cause
title: 应用沙箱禁运行时 chmod/symlink（文件权限与链接属打包契约，不属运行时能力）
nature: limitation
domain: filesystem
fault_type: gap
responsible: ohos-runtime
co_responsible: []
component: "HarmonyOS 应用沙箱文件系统规格 × QFile::setPermissions / QFile::link"
severity: medium
evidence_type: docs
status: wontfix
evidence: "应用沙箱规格：文件权限与链接属打包契约（QTBUG-146619/146621 记录平台行为）"
evolution: "—（规格稳定，无演进方向；若未来平台开放相应能力，复核时改判）"
fix_route: ""
review_note: "沙箱规格有无变化（chmod/symlink 能力开放则改判）"
depends_on: []
affects_qt: []
affects_ohos: ["全版本（沙箱规格）"]
qoh: []
first_seen: 2026-06-02
review_due: 2026-12-14
created: 2026-09-14
updated: 2026-09-14
tags: [harmonyos, sandbox, chmod, symlink, qfile, filesystem, limitation, workaround]
audience: public
refs: [semantic-qt-harmonyos-platform-limits]
summary: >
  应用沙箱运行时禁止 chmod 与 symlink 创建：QFile::setPermissions 对已有文件返回失败、
  QFile::link 无法创建应用所需链接。limitation/ohos-runtime（规格如此，不会"修"，
  wontfix）；替代方案 W-0005（构建期展开真实文件）/ W-0006（权限交打包契约）已采用。
---

# C-0008 沙箱禁运行时 chmod/symlink

> nature: limitation ｜ 责任: ohos-runtime ｜ 状态: wontfix ｜ 表现: S-0007 ｜ 复核: 2026-12-14

## 表现（symptoms）

### S-0007 运行时 chmod / symlink 失败

- `QFile::setPermissions()` 对已有文件返回失败；
- `QFile::link()` 无法创建应用所需链接。

依赖运行时改权限/建链接的桌面式代码在鸿蒙上走错误分支（若把返回值当业务成功
条件，会误判失败甚至崩溃——参见 problems 沙箱类条目）。

## 根因 / 定性依据

HarmonyOS 应用沙箱规格：文件权限与链接属**打包契约**（构建/HAP 打包阶段决定），
不属运行时能力——运行时文件系统不提供 chmod/symlink 语义。Qt 追踪：
QTBUG-146619（setPermissions，T-0003）、QTBUG-146621（link，T-0004）。
属**规格限制**，非缺陷——不存在"修好 chmod"的路径。

## 责任判定

`ohos-runtime`（沙箱规格）。Qt 侧不修（API 保持跨平台语义，返回失败是如实反映平台行为）。

## 替代方案与演进（limitation）

- **W-0005（adopted）**：构建/打包期展开真实文件——需要"链接"效果的地方，
  构建/打包阶段展开为真实文件副本，避免运行时建链接；
- **W-0006（adopted）**：权限交打包契约——不用 `setPermissions()` 结果作业务成功
  条件；应用所需权限在 module.json5 / 打包配置声明；
- **演进**：无（规格稳定；若未来平台开放相应能力，复核时改判）。

## 临时方案（Workarounds）

即替代方案 W-0005 / W-0006（见上）。**无退役预期**（wontfix：长期依赖替代方案）。

## 跟踪单（Tickets）

- **T-0003（qt-bug，QTBUG-146619，submitted）**：QFile::setPermissions 平台行为记录；
- **T-0004（qt-bug，QTBUG-146621，submitted）**：QFile::link 平台行为记录；
- 两者均为 Qt 侧登记（非修复请求），详见
  [qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md)
  §平台限制到 Qt API 的映射。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-06-02 | — | 随 platform-limits 页建档（Qt 官方 wiki 平台限制 + QTBUG） | 定性成立；替代方案可用 | → wontfix |

## 关联

- 症状（S）：S-0007
- 临时方案（W）：W-0005、W-0006
- 跟踪单（T）：T-0003、T-0004
- semantic：[qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md)
