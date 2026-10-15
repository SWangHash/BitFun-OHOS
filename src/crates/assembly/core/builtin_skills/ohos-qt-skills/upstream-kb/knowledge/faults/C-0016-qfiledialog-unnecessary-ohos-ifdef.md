---
id: fault-C-0016
cid: C-0016
type: cause
title: "应用误判 QFileDialog 无 OHOS 原生支持而添加 #ifdef 替代分支（QOhosPlatformIntegrationPlugin 实已内置）"
nature: defect
domain: api
fault_type: caveat
responsible: app
co_responsible: []
component: "QOhosPlatformIntegrationPlugin（libqohos.so，经 OhosExportModules.ts 注册 fileManagerService）× 应用侧 QFileDialog 守卫代码"
severity: low
evidence_type: source
status: closed
fix_route: "改用法：直接使用标准 QFileDialog API，删除 #ifdef Q_OS_OHOS 替代分支"
review_note: "薄 C 页（app 使用问题）：核对 FRequest 修复结论与两条边界（沙箱内保存对系统文件管理器不可见、file:// 不支持 QDesktopServices::openUrl）仍在 problems 页维护；源页未记录 Qt/OHOS 版本，无版本跟踪需求"
depends_on: []
affects_qt: []
affects_ohos: []
qoh: []
first_seen: 2026-07-29
review_due: 2026-12-15
created: 2026-09-15
updated: 2026-09-15
tags: [qfiledialog, file-dialog, native-support, qohosplatformplugin, ifdef, anti-pattern, app-usage, qt515]
audience: public
refs: [problem-ohos-qfiledialog-native-support, semantic-qt-harmonyos-api-mapping]
summary: >
  开发者误以为 QFileDialog 在 OHOS 不可用，为 Save/Load/Download 添加
  Q_OS_OHOS 守卫与替代分支；实际平台插件已内置原生文件对话框，标准 API
  可直接使用。defect/app（应用使用问题）；FRequest 已改用法修复，closed，
  无 W/T。
---

# C-0016 误判 QFileDialog 无 OHOS 原生支持（应用误用）

> nature: defect ｜ 责任: app ｜ 状态: closed ｜ 表现: S-0015 ｜ 方案: 无（改用法即根治） ｜ 跟踪: 暂无 ｜ 复核: 2026-12-15

## 表现（symptoms）

### S-0015 误为 QFileDialog 添加 Q_OS_OHOS 替代分支（守卫与内置原生支持冲突）

迁移 Qt 应用到 OHOS 时，开发者误以为 OHOS 不支持 `QFileDialog`，为
Save/Load/Download 功能添加 `#ifdef Q_OS_OHOS` 替代分支（`QInputDialog`
输入文件名、硬编码路径等），造成不必要的维护负担，且与平台插件内置的原生
支持冲突。实际标准 `QFileDialog` API 在 OHOS 上可直接使用。

## 根因 / 定性依据

`QOhosPlatformIntegrationPlugin`（libqohos.so）已内置文件对话框原生支持：
内部经 `OhosExportModules.ts` 注册的
`@kit.FileManagerServiceKit.fileManagerService` 调用 OHOS 原生文件管理器
API，对上层 Qt Widgets 代码完全透明。属**应用误用**（API 语义静态可判定，
source 级证据），非框架缺失——Qt 侧无缺陷、平台侧无规格缺口。

## 责任判定

`app`：平台能力存在而应用未使用（误判后自造替代分支），修复到达路径 =
自己改代码。深度内容（验证方法、错误做法对照、沙箱可见性边界）留在
[ohos-qfiledialog-native-support](../problems/ohos-qfiledialog-native-support.md)，
本页仅沉淀"这不是框架问题"的结论。

## 根治方案（defect）

改用法：删除 `#ifdef Q_OS_OHOS` 守卫，直接使用标准 QFileDialog API
（`getSaveFileName` / `getOpenFileName`）；module.json5 中的
`FILE_ACCESS_PERSIST` 权限由 Qt 模板预置，无需 ArkTS 桥接、无需 NAPI 层。

| 错误做法 | 正确做法 |
|----------|----------|
| `#ifdef Q_OS_OHOS` + QInputDialog 输入文件名 | 直接用 QFileDialog |
| `#ifdef Q_OS_OHOS` + 硬编码到 getAppPath() | 直接用 QFileDialog |
| `#ifdef Q_OS_OHOS` + QStandardPaths::DocumentsLocation | 直接用 QFileDialog（DocumentsLocation 在 OHOS 上不存在） |

## 临时方案（Workarounds）

无——改用法即根治，无需绕过手段。

## 跟踪单（Tickets）

暂无（非框架问题，无上游可跟）。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-09-15 | 未记录 | 随 problems 页建档转录（源页 2026-07-29 建 / 2026-08-03 更新）：ModbusDebuger 直接使用标准 API 验证通过；FRequest（com.ohosqt.FRequest）移除全部不必要 QFileDialog OHOS 守卫 | 定性成立；改用法后问题消失 | → closed |

## 关联

- 症状（S）：S-0015
- 临时方案（W）：无
- 跟踪单（T）：暂无
- problems：[ohos-qfiledialog-native-support](../problems/ohos-qfiledialog-native-support.md)
- semantic：[qt-harmonyos-api-mapping](../semantic/qt-harmonyos-api-mapping.md)
- 相关根因（C）：无
