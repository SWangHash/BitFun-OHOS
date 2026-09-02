---
id: problem-build-fail-duplicate-so
type: problem
domain: build
tags: [hvigor, duplicate-so, ProcessLibs, abiFilters, x86_64]
created: 2026-06-04
updated: 2026-06-04
status: solved
audience: public
summary: "hvigor ProcessLibs 阶段报 Duplicated files found（同 .so 在 obj/ 与 libs/ 重复）"
severity: medium

# ====== 检索关键字 ======
error_message: >
  Duplicated files found in module entry. This may cause unexpected errors at runtime.
  entry/build/default/intermediates/cmake/default/obj/arm64-v8a/libXxx.so
  entry/libs/arm64-v8a/libXxx.so
error_code: "00306049"
keywords: [Duplicated files, ProcessLibs, pickFirsts, duplicate so]
symptoms: "hvigor 构建在 ProcessLibs 阶段失败，报 Duplicated files found"

# ====== 问题详情 ======
environment: "DevEco Studio 5.x / hvigor CLI / Qt 5.12.12 OHOS SDK"
refs: [semantic-qt-harmonyos-project-structure]
related_problems: [problem-cmake-findpackage-ohosextras-fail]
---

# hvigor 构建 ProcessLibs 阶段报 Duplicated .so files

## 错误信息

```
ERROR: Failed :entry:default@ProcessLibs...
Error Code: 00306049 Specification Limit Violation
Error Message: Duplicated files found in module entry. This may cause unexpected errors at runtime.
 - entry/build/default/intermediates/cmake/default/obj/arm64-v8a/libNativeWinLeaveEvt.so
 - entry/libs/arm64-v8a/libNativeWinLeaveEvt.so
```

## 场景

当 CMakeLists.txt 通过 hvigor 的 `externalNativeOptions.path` 集成构建时，
如果同时在 `entry/libs/arm64-v8a/` 目录手动放置了同名的 .so 文件，
hvigor 会发现两份同名库并报错。

## 原因

hvigor 的 CMake 集成会自动编译 C++ 代码并将产物放入 `entry/build/` 目录，
同时 `entry/libs/` 中的 .so 也会被打包。两者同名导致冲突。

## 解决方案

1. **不要手动放置应用库 .so 到 `entry/libs/`**。hvigor CMake 集成会自动编译并打包。
2. **仅手动放置 Qt 运行时库**（libQt5Core.so、libQt5Gui.so 等），这些不是项目编译产物。
3. 如果已经手动放了，删除即可：

```bash
rm entry/libs/arm64-v8a/libYourApp.so
```

## 附加问题：abiFilters 包含 x86_64 导致链接失败

### 错误信息

```
ld.lld: error: <LOCAL_PATH> is incompatible with elf_x86_64
```

### 原因

源码内置模板默认 `abiFilters` 包含 `["x86_64", "arm64-v8a"]`，
但 Qt SDK 只提供 arm64-v8a 预编译库。

### 解决方案

修改 `entry/build-profile.json5`：

```json5
"abiFilters": [
  "arm64-v8a"    // 只保留 arm64-v8a
]
```

## 注意事项

- Qt 运行时库（libQt5Core.so 等）仍需手动放到 `entry/libs/arm64-v8a/`
- libqohosstyle.so 需放到 `entry/libs/arm64-v8a/styles/` 子目录
- 应用自身的 .so 由 hvigor CMake 自动构建，不需要手动放置

## 相关

- [[qt-harmonyos-project-structure]] — §6 Qt 运行时库部署
- [[qt-harmonyos-golden-rules]] — B1 库名规则

### 相关问题

- [build-fail-cmake-ohosextras](build-fail-cmake-ohosextras.md) — 同为 CMake 构建配置问题

> 📋 返回 [错误速查表](_lookup.md)
