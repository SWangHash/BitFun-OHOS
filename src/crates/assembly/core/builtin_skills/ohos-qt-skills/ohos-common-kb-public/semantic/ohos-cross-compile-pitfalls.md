---
id: ohos-cross-compile-pitfalls
title: HarmonyOS 交叉编译与真机构建通用陷阱
status: active
confidence: 0.7
sources:
  - type: practice
    name: Tauri、AWT/Swing 与归档仓真机及 fresh-clone 验证
    date: 2026-08-06
created: 2026-08-12
updated: 2026-08-14
last_confirmed: 2026-08-06
superseded_by: null
tags: [ohos, cross-compile, rust, ffi, signing, fresh-clone]
refs: [deveco-cli-usage-rules]
summary: "OHOS target cfg、c_char 符号性、系统权限签名和 fresh-clone 是跨框架移植的四类高频陷阱。"
audience: public
---

# HarmonyOS 交叉编译与真机构建通用陷阱

本页只收录跨两个以上框架复现的平台级规律。框架专属修复仍应写入对应领域 KB。

## Rust target cfg 不等于业务平台分类

OHOS Rust target 常见为 `aarch64-unknown-linux-ohos`，其中 `target_os = "linux"`、`target_env = "ohos"`。因此：

- 仅用 `target_os = "linux"` 或框架的 `desktop` cfg，可能误启用桌面插件和系统集成。
- 仅把 Android 视为移动端，会让 OHOS 落入文件系统等错误分支。
- `cfg(mobile)` 是框架/构建配置注入的条件；`target_os` 与 `target_env` 是 Rust target 属性，不能互相替代。

典型修正：

```rust
#[cfg(all(desktop, not(target_env = "ohos")))]
fn desktop_only() {}

#[cfg(any(target_os = "android", target_env = "ohos"))]
fn mobile_platform_path() {}
```

修正前先核对目标 crate 的 cfg 定义与功能语义，不能机械替换所有 `linux` 或 `android` 分支。

## `c_char` 的符号性必须来自目标 ABI

在已验证的 OHOS Rust target 中，`std::os::raw::c_char` 为 `u8`；许多 Unix target 上则为 `i8`。C binding 若硬编码 `*mut i8` / `*const i8`，在 OHOS 可能出现 `E0308` 类型不匹配。

处理原则：

1. 自有 FFI 使用 `std::os::raw::c_char` 或 libc 对应类型，不硬编码符号性。
2. 非核心间接依赖可在 OHOS cfg 下关闭整条依赖链。
3. 核心依赖需 fork/patch 时，将修复限制在 ABI 类型边界，并补交叉编译验证。

历史上 `git2` filter 路径和 `nix` 相关结构曾触发此类问题；具体版本是否仍受影响应重新检查源码。

## 系统级权限依赖正确的签名 profile

需要 JIT 或可执行内存的运行时（例如 JVM）可能申请 `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY`。仅用 `hap-sign-tool.jar` 手工生成的普通 debug profile 不一定包含系统级权限 ACL；应通过团队认可的 DevEco/devecocli 签名流程生成具备授权的 profile。

验证不能止于“安装成功”：还应检查权限授予结果、进程启动和崩溃日志。工具链操作规则见 [[deveco-cli-usage-rules]]。

## 已有工作树通过不代表可复现

Cargo/npm 缓存、未跟踪文件和本地生成目录会掩盖缺失提交或错误路径。发布或归档前至少执行一次：

1. clone 到新的临时目录；
2. 按 SETUP/构建入口从零执行完整构建链；
3. 确认构建不依赖原工作树的缓存或未提交文件；
4. 检查生成工程是否被上游 `.gitignore`（如 `/gen/`）意外排除；
5. 验证完成后确认临时 clone 没有非预期修改。

若必须提交 `gen/ohos/`，应使用最窄的 `.gitignore` 反向规则，并继续排除 `.hvigor/`、`build/`、`oh_modules/` 等产物。

## 适用边界

- cfg 与 `c_char` 结论针对具体 OHOS toolchain；升级 Rust/NDK 后重新确认。
- 签名能力受设备、证书类型和权限策略影响，不把某次成功的 profile 当作可复制凭据。
- fresh-clone 是可复现性门禁，不代替真机功能验证。
