---
id: fault-C-0012
cid: C-0012
type: cause
title: 应用 loader 拒绝从可写路径加载动态库（代码加载仅限 HAP lib 目录，el2 可写区 dlopen 返回 EINVAL）
nature: limitation
domain: runtime
fault_type: gap
responsible: ohos-runtime
co_responsible: []
component: "HarmonyOS 应用沙箱 loader 规格 × dlopen / QPluginLoader"
severity: high
evidence_type: logs
status: wontfix
evidence: "loader 安全规格：动态库仅可从 HAP 打包的 native library 目录加载；普通可写路径（/data/storage/el2/ 下 files 区）dlopen 返回 errno=22（EINVAL）。QTBUG-146624 记录平台行为；ohos-common-kb dlopen-rejects-writable-path 诊断页（跨框架成立）"
evolution: "—（规格稳定，无演进方向；若平台未来开放受控的运行时代码加载机制，复核时改判）"
fix_route: ""
review_note: "loader 可写路径限制有无松动（开放受控运行时加载则改判）；T-0007（QTBUG-146624）答复动态"
depends_on: []
affects_qt: []
affects_ohos: ["全版本（loader 规格；源页记录 Qt 5.12/5.15 真机实证）"]
qoh: []
first_seen: 2026-06-03
review_due: 2026-12-15
created: 2026-09-15
updated: 2026-09-15
tags: [harmonyos, sandbox, loader, dlopen, qpluginloader, el2, plugin, hot-update, limitation, workaround]
audience: public
refs: [problem-runtime-dlopen-writable-path, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-third-party-libs]
summary: >
  应用 loader 仅允许从 HAP native library 目录加载动态库，可写路径（el2 沙箱
  files 区）dlopen 返回 EINVAL——运行时下载 .so 插件 / 热更新 / JIT 产物加载
  不可行。limitation/ohos-runtime（loader 规格，wontfix）；替代方案 W-0010
  （.so 随 HAP lib 目录打包交付 / 固定集合静态链接）已采用；Qt 侧平台行为记录
  T-0007（QTBUG-146624）。
---

# C-0012 应用 loader 拒绝从可写路径加载动态库

> nature: limitation ｜ 责任: ohos-runtime ｜ 状态: wontfix ｜ 表现: S-0011 ｜ 方案: W-0010 ｜ 跟踪: T-0007 ｜ 复核: 2026-12-15

## 表现（symptoms）

### S-0011 运行时 dlopen 从可写路径加载 .so 失败（errno=22 EINVAL）

错误原文（源页 [runtime-fail-dlopen-writable-path](../problems/runtime-fail-dlopen-writable-path.md)）：

```
dlopen failed: library "/data/storage/el2/100/base/files/plugins/libMyPlugin.so"
cannot open shared object file: errno=22 (EINVAL)
```

或 Qt 层面：`QPluginLoader: Could not load plugin: dlopen failed`。

触发场景：插件系统（.so 下载到可写目录后加载）、JIT 编译器（运行时生成代码
写入文件后加载）、热更新机制（替换 .so 后重新加载）。路径来自
`QStandardPaths::writableLocation()`（通常在 `/data/storage/el2/` 下）。

## 根因 / 定性依据

HarmonyOS 应用沙箱 loader 规格：**动态库代码只能从 HAP 打包的 native library
目录加载**；普通可写路径（el2 沙箱 files 区）不属合法代码加载路径，`dlopen()`
返回 EINVAL。属**规格限制**而非缺陷——不存在"放开可写路径加载"的修复路径，
只有按规格部署代码。

- 规格证据：Qt 官方平台限制页登记 QTBUG-146624（`QPluginLoader` / runtime
  `.so` 行，见 [qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md)
  §平台限制到 Qt API 的映射；golden-rules 规则 P3）；
- 现象证据：dlopen EINVAL 错误原文（源页，Qt 5.12/5.15 真机）；
- 通用诊断以 ohos-common-kb `dlopen-rejects-writable-path` 为准（跨框架成立）。

## 责任判定

`ohos-runtime`（loader 安全规格）。Qt 侧不修——QPluginLoader/dlopen 保持跨平台
语义，返回失败是如实反映平台行为（Qt 侧登记 T-0007，非修复请求）。应用必须按
规格适配（处置：鸿蒙必须适配）。

## 替代方案与演进（limitation）

- **W-0010（adopted）**：插件 .so 随最终 HAP 的 native library 闭包交付（打包时
  部署到 lib 目录）；插件集合固定时静态链接进主二进制；确需运行时下发的动态
  逻辑改用 ArkTS/JS 脚本（见 §临时方案）。
- **演进**：无（规格稳定）。观察点：平台是否开放受控的运行时代码加载机制
  （如经签名校验的动态模块）；T-0007 的答复动态。

## 临时方案（Workarounds）

- **W-0010（adopted，官方 adapter）**：
  1. 插件 .so 在打包阶段部署进 HAP 的 native library 目录（lib 目录），随应用
     交付——不做运行时下载/替换；
  2. 插件集合固定 → 静态链接（消除运行时加载环节）；
  3. 确需运行时下发逻辑的 → 用 ArkTS/JS 脚本替代 .so 插件。

  代价：新增/更新插件需重新打包发版，无热更新能力；动态代码形态受限。
  退役条件：无退役预期（wontfix：loader 规格稳定）；若平台开放可写区代码
  加载，可改回运行时下载模式。

## 跟踪单（Tickets）

- **T-0007（qt-bug，QTBUG-146624，submitted）**：Qt 侧平台行为记录
  （QPluginLoader / 运行时 .so 动态插件加载限制，非修复请求）；单号来自官方
  平台限制页（[qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md)）。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-06-03 | Qt 5.12/5.15 for HarmonyOS / 真机 | 随 problems 页建档：dlopen EINVAL 错误原文 + 平台限制 P3 定性（源页 status: solved） | 定性成立；lib 目录打包交付方案可用 | → wontfix |

## 关联

- 症状（S）：S-0011
- 临时方案（W）：W-0010
- 跟踪单（T）：T-0007
- problems：[runtime-fail-dlopen-writable-path](../problems/runtime-fail-dlopen-writable-path.md)（QPluginLoader 可搜索症状、部署位置、回归方法）
- semantic：[qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md)（§平台限制到 Qt API 的映射）、[qt-harmonyos-third-party-libs](../semantic/qt-harmonyos-third-party-libs.md)（§3 .so 部署规则）、[qt-harmonyos-golden-rules](../semantic/qt-harmonyos-golden-rules.md)（规则 P3）
- 相关根因（C，含 depends_on 说明）：C-0008（同属应用沙箱规格家族——C-0008 为权限/链接属打包契约，本条为代码加载路径规格；并列规则，无 depends_on 依赖）
