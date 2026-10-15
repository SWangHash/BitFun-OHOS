---
id: procedural-llvm-ohos-cross-compile
type: procedural
domain: tech
tags: [llvm, cross-compile, ohos, qt, qlogo, cmake, aarch64, jit]
created: 2026-08-06
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-build, semantic-qt-harmonyos-third-party-libs]
summary: >
  Qt/QLogo 接入 OHOS arm64 LLVM 15 静态库的 adapter：保留 Qt 目标链接、QLogo JIT
  所需库闭包、部署与回归检查；通用 OHOS NDK/LLVM 交叉编译流程由 common 维护。
leader_summary: >
  将 LLVM 15 OHOS 交叉编译知识收敛为 QLogo/Qt 集成 adapter，避免在 Qt KB 重复维护平台 toolchain 流程。
impact: [迁移提效]
deliverables: [Qt集成指南, QLogo库清单]
evidence: [WORKLOG 08-05, workspace/llvm-15.0.7.src/]
---

# LLVM OHOS 产物接入 Qt/QLogo

> OHOS NDK toolchain、host/target generator 分离、ELF/依赖闭包检查及 LLVM 通用失败分类，以 common 的 [[ohos-common-kb/procedural/ohos-llvm-cross-compile|LLVM 类原生工程交叉编译到 OHOS]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/procedural/ohos-llvm-cross-compile.md)）为准。本页只记录 Qt/QLogo 如何消费已验证的 AArch64 产物。

## Why:

QLogo 的 JIT 依赖 LLVM 多个静态库。平台侧“如何编出 LLVM”与 Qt 侧“链接哪些库、怎样进入 HAP 并验证 JIT”是两个 seam；只有后者属于 Qt KB。

## How to apply:

1. 按 common 流程取得同一 OHOS SDK/ABI 构建的 LLVM 15.0.7 AArch64 静态库，并用 `llvm-readelf -h` 确认 `Machine: AArch64`。
2. 将 QLogo 实际需要的 `.a` 放入项目受控的 target library 目录，不把 host `llvm-tblgen` 或 Windows 库带入 Qt 目标链接。
3. 在 Qt 应用目标上配置 include 路径与静态库；保持 LLVM 库依赖顺序，链接失败时从最后一个 undefined symbol 反查缺失组件。
4. 构建 HAP 后检查 Qt 主库的 `NEEDED`、导出符号和最终包内容。
5. 真机执行最小 QLogo/JIT 用例；若触发可执行内存权限问题，转 common 平台限制页处理，不把签名/profile 结论复制到本页。

## QLogo JIT 已验证库集

| 库 | 用途 |
|---|---|
| `libLLVMOrcJIT.a` | ORC JIT 核心 |
| `libLLVMCore.a`、`libLLVMSupport.a` | IR 与基础设施 |
| `libLLVMIRReader.a`、`libLLVMExecutionEngine.a` | IR 解析与执行引擎 |
| `libLLVMCodeGen.a`、`libLLVMAArch64CodeGen.a` | AArch64 代码生成 |
| `libLLVMAnalysis.a`、`libLLVMScalarOpts.a` | 分析与优化 Pass |
| `libLLVMInstCombine.a`、`libLLVMTransformUtils.a` | 指令与变换工具 |
| `libLLVMAsmPrinter.a`、`libLLVMTarget.a` | 汇编输出与 Target 基础 |
| `libLLVMCoroutines.a` | 协程支持 |

该清单来自 QLogo 验证，不代表所有 Qt 应用都要全量链接。应从实际 unresolved symbol 和功能入口裁剪。

## Qt CMake 接入

```cmake
set(LLVM_OHOS_ROOT "<validated-llvm-ohos-prefix>")
target_include_directories(QLogo PRIVATE "${LLVM_OHOS_ROOT}/include")
target_link_directories(QLogo PRIVATE "${LLVM_OHOS_ROOT}/lib")
target_link_libraries(QLogo PRIVATE
  LLVMOrcJIT LLVMExecutionEngine LLVMIRReader LLVMCore
  LLVMAArch64CodeGen LLVMCodeGen LLVMAnalysis LLVMScalarOpts
  LLVMInstCombine LLVMTransformUtils LLVMAsmPrinter LLVMTarget LLVMSupport
)
```

库顺序和集合以当前 LLVM 构建实际生成的 target/依赖为准；升级 LLVM 后重新生成链接闭包，不沿用旧清单猜测。

## Qt 验收

- [ ] Qt 应用只消费 OHOS AArch64 `.a`，未混入 host artifact。
- [ ] `find_package(Qt*)` 与 LLVM prefix 互不覆盖，Qt SDK 仍由既有 Kit/`CMAKE_PREFIX_PATH` 提供。
- [ ] 主 Qt native library 链接成功且无 host 绝对路径/RPATH。
- [ ] HAP 安装、启动成功。
- [ ] QLogo 最小 JIT 用例真机通过；权限拒绝有明确日志与 common 问题页路由。

## 证据边界

2026-08-05 验证基线为 LLVM 15.0.7、OHOS NDK clang 15.0.4、AArch64，产出约 69 个静态库；本页只声明上表所列库在 QLogo 场景中的消费关系。其他 LLVM 版本、组件或 JIT 权限需重新验证。
