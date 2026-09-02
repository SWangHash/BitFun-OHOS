---
id: ohos-llvm-cross-compile
title: LLVM 类原生工程交叉编译到 OHOS
status: active
confidence: 0.5
sources: [{type: experience, name: "Qt KB LLVM OHOS 交叉编译流程", date: 2026-08-05}]
created: 2026-08-13
updated: 2026-08-14
last_confirmed: 2026-08-05
review_by: null
superseded_by: null
tags: [ohos, llvm, cross-compile, cmake, ndk]
refs: [ohos-native-third-party-libraries, ohos-cross-compile-pitfalls]
summary: "用 OHOS NDK toolchain 构建 LLVM 类 CMake 原生工程，并验证 target artifact 与依赖闭包。"
audience: public
---

# LLVM 类原生工程交叉编译到 OHOS

## Why:

LLVM 及同类大型 CMake 工程经常同时构建 host generator 与 target library。只设置 `CC/CXX` 容易让 CMake 混用主机 sysroot、运行 target 工具或生成错误 ABI 产物。

## How to apply:

1. 固定目标 SDK/NDK、API level、ABI 与源码版本。
2. 清理旧的主机构建目录，为 host tools 与 target artifacts 使用不同 build directory。
3. 用 OHOS toolchain file 配置 target build；显式关闭目标系统不支持或任务不需要的组件。
4. 若工程需要 tablegen/code generator，先构建 host 版本并通过工程支持的变量传入，禁止在主机执行 OHOS target binary。
5. 构建后检查 ELF、`NEEDED`、导出符号、RPATH 和主机路径泄漏。
6. 把 `.so` 按 HAP ABI 目录部署，用最小 native consumer 验证 load 与核心 API。
7. 最后再接入 Qt、Rust、JVM 或 .NET adapter，并在对应框架仓验证。

最小配置骨架：

```bash
cmake -S <source> -B <target-build> \
  -DCMAKE_TOOLCHAIN_FILE=<OHOS_NDK>/build/cmake/ohos.toolchain.cmake \
  -DOHOS_ARCH=arm64-v8a \
  -DCMAKE_BUILD_TYPE=Release \
  <project-specific-feature-flags>
cmake --build <target-build> --parallel
```

## 失败分类

| 阶段 | 常见原因 | 首查 |
|---|---|---|
| configure | toolchain/sysroot 混用、host tool 缺失 | CMake cache、compiler target、try_compile 日志 |
| compile | POSIX/glibc 假设、SDK header/API 差异 | 首个 target compile error，不先改框架代码 |
| link | 系统库缺失、符号可见性、依赖顺序 | link line、undefined symbol、目标 SDK stubs |
| load | 依赖未打包、ABI/RPATH、loader policy | ELF dynamic section、HAP 内容、系统日志 |

## 验收

构建成功不等于可复用：必须保存版本/flags/补丁来源，完成 target artifact 检查、最小加载验证和 fresh-clone 重建。
