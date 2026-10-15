---
id: fault-C-0007
cid: C-0007
type: cause
title: ARKUI_XCOMPONENT_TYPE_SURFACE 于 API 20 弃用，迁移方向 ContentSlot
nature: limitation
domain: api
fault_type: deprecation
responsible: ohos-runtime
co_responsible: []
component: "ArkUI XComponent（SURFACE 类型）/ ContentSlot"
severity: medium
evidence_type: docs
status: watching
evidence: "华为官方弃用公告（API 20 起）+ ContentSlot 渲染控制迁移指引"
evolution: "ContentSlot（官方方向）：观察能力覆盖、Qt-port 迁移节奏（T-0002）、SURFACE 移除时间表"
fix_route: ""
review_note: "ContentSlot 能力覆盖与 Qt-port 迁移节奏（T-0002）；平台对 SURFACE 的移除时间表"
depends_on: []
affects_qt: []
affects_ohos: ["API 20+"]
qoh: []
first_seen: 2026-06-02
review_due: 2026-12-14
created: 2026-09-14
updated: 2026-09-14
tags: [harmonyos, xcomponent, contentslot, opengl, surface, deprecation, limitation, 演进]
audience: public
refs: [semantic-qt-harmonyos-platform-limits]
summary: >
  SURFACE 类型 XComponent（Qt OHOS 用作 OpenGL 原生渲染表面）自 API 20 起弃用，
  官方迁移方向为 ContentSlot。limitation/ohos-runtime（规格演进，非缺陷）；
  watching：应用暂无动作（无临时方案），观察 ContentSlot 能力覆盖与 Qt-port
  迁移节奏（跟踪单 T-0002 / QTBUG-146622）。
---

# C-0007 XComponent SURFACE 于 API 20 弃用

> nature: limitation ｜ 责任: ohos-runtime ｜ 状态: watching ｜ 表现: S-0006 ｜ 复核: 2026-12-14

## 表现（symptoms）

### S-0006 SURFACE 型 XComponent 渲染表面处于弃用轨道（API 20+）

当前 Qt OHOS 的 OpenGL 原生渲染仍基于 `ARKUI_XCOMPONENT_TYPE_SURFACE`，该能力自
API 20 起标记弃用——**当前仍可运行**，但处于弃用轨道，存在未来 API 移除风险。

## 根因 / 定性依据

平台规格演进：华为官方将 SURFACE 型 XComponent 标记弃用（API 20 起），提供
ContentSlot 作为原生渲染控制的新方向（官方文档已给出渲染控制迁移指引）。
属**规格限制/演进**而非缺陷——不存在"修复回 SURFACE"的路径，只有迁移。

## 责任判定

`ohos-runtime`（ArkUI 平台规格）。演进执行方在 Qt-port（迁移到 ContentSlot），
Qt 侧跟踪于 QTBUG-146622（T-0002）。

## 替代方案与演进（limitation）

- **替代方案**：迁移 ContentSlot（Qt 框架层执行；应用开发者无需动作，升级 Qt OHOS
  SDK 时随版本获得）——本限制的应用侧无临时方案（W 无）；
- **演进**：ContentSlot（官方方向）。观察点：① ContentSlot 对 OpenGL/EGL 场景的
  能力覆盖是否完备；② qtbase harmonyos 分支的迁移进度（T-0002）；③ 平台对
  SURFACE 型的实际移除时间表（当前未公布）。

## 跟踪单（Tickets）

- **T-0002（qt-bug，QTBUG-146622，submitted）**：Qt 侧迁移跟踪，单号来自官方平台
  限制页（见 [qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md)
  §ArkUI/ArkTS API）。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-06-02 | API 20 文档 | 确认弃用与迁移方向（随 platform-limits 页建档） | 定性成立 | → watching |

## 关联

- 症状（S）：S-0006
- 临时方案（W）：无（应用层无动作）
- 跟踪单（T）：T-0002
- semantic：[qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md)
