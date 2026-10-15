---
id: problem-build-qt612-qos-harmony-macro
type: problem
domain: build
tags: [qt612, qsystemdetection, Q_OS_HARMONY, Q_OS_OHOS, cmake_helpers, nice_target_sources, 宏失效]
created: 2026-09-11
updated: 2026-09-11
status: solved
severity: high
audience: public
refs: [semantic-qt-harmonyos-golden-rules, semantic-qt-harmonyos-build]
summary: >
  Qt 6.12-beta3 harmonyos kit 的平台宏是 Q_OS_HARMONY（非 Q_OS_OHOS），
  且 OHOS 分支若在 nice_target_sources 里标记 not_linux 集合会把 ohos 后缀
  实现文件也排除——全部 platform/ohos 静默不编译，链接期集中爆 undefined。
leader_summary: >
  修正 Q_OS_HARMONY 宏认知与 nice_target_sources 集合语义，消除 ohos 实现被静默排除的陷阱
impact: [构建体系, 平台后端]
deliverables: [problem记录]
evidence: []

error_message: >
  ld.lld: error: undefined symbol: Platform::IsWayland()
  ld.lld: error: undefined symbol: base::Platform::Haptic()
  ld.lld: error: undefined symbol: Ui::Platform::TranslucentWindowsSupported()
  (全部 platform/ohos 实现符号缺失，编译期零报错)
error_code: ""
keywords: [Q_OS_HARMONY, Q_OS_OHOS, __OHOS__, nice_target_sources, not_linux, HEADER_FILE_ONLY, undefined symbol]
symptoms: "OHOS 交叉编译全部通过但链接集中报 platform 层符号 undefined；分发头始终落入 linux 分支"

environment: "Windows + Qt 6.12-beta3 harmonyos_arm64_v8a kit + OHOS NDK clang15"
---

# Qt 6.12 OHOS kit 平台宏是 Q_OS_HARMONY + ohos 源文件被静默排除

## 错误信息

```
ld.lld: error: undefined symbol: Platform::IsWayland()
ld.lld: error: undefined symbol: Platform::NewVersionLaunched(int)
ld.lld: error: undefined symbol: base::Platform::Haptic()
ld.lld: error: undefined symbol: Ui::Platform::TranslucentWindowsSupported()
```

## 场景

某 2000+ 编译目标的大型工程向 OHOS 移植：按知识库惯例写 `#if defined Q_OS_OHOS` 分发守卫、
在 cmake_helpers 的 `nice_target_sources` 里加 ohos 标签分支。编译全部目标
通过，最后链接主业务 so 时集中爆 20+ 个 platform 符号 undefined。

## 原因（两个叠加陷阱）

1. **Qt 6.12-beta3 的 qsystemdetection.h 定义的是 `Q_OS_HARMONY`，不是 `Q_OS_OHOS`**：
   `__OHOS__`(编译器预定义) → `Q_OS_HARMONY + Q_OS_LINUX`。Qt 5.15/5.12 harmonyos
   分支才是 `Q_OS_OHOS`。所有 `#ifdef Q_OS_OHOS` 守卫在 6.12 kit 下是死代码，
   分发头全部落入 linux 分支。

2. **nice_target_sources 集合语义写反**：ohos 后缀文件如果加入 `not_linux_sources`
   （为了在 Linux 上排除），而 OHOS 分支恰好标记 `not_linux`（沿用 LINUX 分支逻辑），
   则 OHOS 构建时 `set_source_files_properties(... HEADER_FILE_ONLY TRUE)` 把
   **全部 ohos 实现文件标记为仅头文件、静默跳过编译**——编译期零错误。

## 修复

- 守卫写成兼容两个 Qt 大版本：

```cpp
#if defined Q_OS_HARMONY || defined Q_OS_OHOS   // 6.12 / 5.15 两种 kit
#include "platform/ohos/xxx_ohos.h"
#else
#include "platform/linux/xxx_linux.h"
#endif
```

- nice_target_sources 正确集合：

```cmake
# win 文件   -> not_mac, not_linux, not_ohos
# mac 文件   -> not_win, not_linux, not_ohos
# linux 文件 -> not_win, not_mac
# ohos 文件  -> not_win, not_mac, not_linux
# posix 文件 -> not_win
# OHOS 分支只标记 not_ohos_sources（= win+mac），linux/posix/ohos 全保留
```

## 验证

`llvm-nm -C <specific_ohos.cpp.o>` 确认实现符号确实在目标文件里（曾出现
源文件有定义但 .o 里没有——头文件把声明写成 `inline` 导致定义被弱化丢弃）。

## 排查命令

```
clang -dM -E -x c++ nul | findstr OHOS     # 确认 __OHOS__ 预定义
grep Q_OS_HARMONY <kit>/include/QtCore/qsystemdetection.h
```
