---
id: ohos-native-third-party-libraries
title: OHOS 原生三方库接入契约
status: active
confidence: 0.7
sources:
  - type: experience
    name: "Qt OHOS LLVM、GStreamer 与三方库交叉编译实践"
    date: 2026-08-05
created: 2026-08-13
updated: 2026-08-14
last_confirmed: 2026-08-05
review_by: null
superseded_by: null
tags: [ohos, ndk, native, cmake, sysroot, musl, shared-library]
refs: [ohos-cross-compile-pitfalls, application-sandbox-paths]
summary: "OHOS NDK 三方库的 toolchain/sysroot、ABI、产物校验、HAP 部署与动态加载平台契约。"
audience: public
---

# OHOS 原生三方库接入契约

本页只描述跨框架成立的 native 平台 seam。Qt `find_package`、Tauri Cargo build script、JVM JNI 或 .NET P/Invoke 的接入方式由各框架仓维护。

## 构建输入

- 使用目标 HarmonyOS/OpenHarmony SDK 随附的 OHOS NDK、Clang 和 CMake toolchain；不要把主机编译器或 Android NDK 混入目标构建。
- target ABI、API level、sysroot 和 C/C++ runtime 必须来自同一 SDK 版本。
- 交叉编译时同时区分 host tools 与 target libraries；构建期生成器通常必须在 host 上运行。
- 不假设 glibc 内部符号、Linux 桌面库或完整 POSIX 行为在 OHOS MUSL 环境可用。

常见 CMake 入口形态如下，具体变量以目标 SDK toolchain 文档为准：

```bash
cmake -S . -B build-ohos \
  -DCMAKE_TOOLCHAIN_FILE=<OHOS_NDK>/build/cmake/ohos.toolchain.cmake \
  -DOHOS_ARCH=arm64-v8a \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build-ohos
```

## 产物检查

在接入框架前至少确认：

1. ELF machine/ABI 与目标设备一致；
2. `NEEDED` 依赖在系统或 HAP 中实际存在；
3. 未泄漏主机绝对路径、RPATH 或主机库；
4. 导出符号满足消费方 ABI；
5. stripped/unstripped 处理符合目标 loader 和调试要求；
6. fresh clone 能从声明的源码、补丁与构建入口重建。

## HAP 部署与加载

native `.so` 通常按 ABI 放入模块的 `libs/arm64-v8a/`，由构建系统纳入 HAP。应用不应把可执行代码复制到任意可写目录再 `dlopen`；bundle、应用数据和 shell 看到的路径还受 mount namespace 影响，见 [[application-sandbox-paths]]。

普通共享库不等同于可执行 bin。需要 `execve` 的 ELF 必须使用平台支持的 executable packaging、权限与签名链；具体运行时集成由对应框架 adapter 与受控交付流程维护。

## 系统库与第三方依赖

- 先查询目标 SDK 的 headers、stub libraries 和公开符号，不从其他 Unix 平台推断。
- 缺失系统库时优先关闭不适用 feature 或构建可审计的三方实现；不要链接 glibc 私有符号。
- 静态链接减少运行时部署项，但必须复核许可证、重复符号、PIC 与最终包体。
- 动态链接便于替换与共享，但需要完整部署依赖闭包并检查 loader 限制。

## Adapter 边界

common 维护 NDK、ABI、sysroot、MUSL、HAP native 部署和 loader invariant。框架仓维护自己的包发现、模块/plugin 目录、构建参数传递、API 封装与回归任务。
