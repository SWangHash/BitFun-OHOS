---
id: problem-runtime-dlopen-writable-path
type: problem
domain: runtime
tags: [runtime, dlopen, sandbox, writable-path, el2, plugin-loading]
created: 2026-06-03
updated: 2026-08-14
status: solved
audience: public
summary: "运行时 dlopen 加载 .so 失败返回 EINVAL（路径在 el2 沙箱可写区）"
severity: high

# ====== 检索关键字（Agent 快速匹配用）======
error_message: >
  dlopen failed: cannot open shared object file
  dlopen: errno=22 (EINVAL)
  library not found in writable path
error_code: "errno=22 (EINVAL)"
keywords: [dlopen, writable, el2, sandbox, plugin, dynamic-loading, EINVAL]
symptoms: "运行时加载 .so 插件失败，dlopen 返回 EINVAL，路径在 /data/storage/el2/ 下"

# ====== 问题详情 ======
environment: "Qt 5.12/5.15 for HarmonyOS, 真机"
refs: [semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-third-party-libs, semantic-qt-harmonyos-golden-rules]
related_problems: [problem-runtime-qpa-plugin-not-found]
---

# dlopen 从可写路径加载 .so 被拒绝

> 平台 loader 对普通可写代码路径的诊断以 common 的 [[ohos-common-kb/problems/dlopen-rejects-writable-path|动态库加载失败：代码位于普通可写路径]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/problems/dlopen-rejects-writable-path.md)）为准。本页保留 `QPluginLoader`/Qt plugin 的可搜索症状、部署位置与回归方法。

## 错误信息

```
dlopen failed: library "/data/storage/el2/100/base/files/plugins/libMyPlugin.so"
cannot open shared object file: errno=22 (EINVAL)
```

或 Qt 层面的报错：

```
QPluginLoader: Could not load plugin: dlopen failed
```

## 场景

应用尝试从 `QStandardPaths::writableLocation()` 返回的路径（通常在 `/data/storage/el2/` 下）动态加载 .so 插件文件，`dlopen()` 返回 EINVAL。

常见于：
- 插件系统（将插件 .so 下载到可写目录后加载）
- JIT 编译器（运行时生成代码写入文件后加载）
- 热更新机制（替换 .so 后重新加载）

## 解决方案

此为鸿蒙平台限制 P3，根因与 Workaround（放入应用 lib 目录 / 静态链接 / Qt 插件机制）详见平台限制页：

→ [[qt-harmonyos-platform-limits]] §dlopen() 拒绝可写路径

> 如需运行时下载代码执行，可考虑 ArkTS/JS 脚本替代 .so 插件；第三方库（如 Qt 自身的插件加载）同样受此限制，确保所有 .so 在打包时部署到 lib 目录。

## 相关

- [[qt-harmonyos-platform-limits]] — §dlopen 限制详情
- [[qt-harmonyos-third-party-libs]] — §3 .so 部署规则
- [[qt-harmonyos-golden-rules]] — 规则 P3

### 相关问题

- [runtime-fail-qpa-plugin-not-found](runtime-fail-qpa-plugin-not-found.md) — 同类 dlopen 失败，但原因是 .so 文件缺失而非路径权限

> 📋 返回 [错误速查表](_lookup.md)
