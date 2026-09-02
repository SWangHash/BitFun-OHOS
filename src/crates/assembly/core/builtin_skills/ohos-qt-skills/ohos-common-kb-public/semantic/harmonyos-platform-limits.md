---
id: harmonyos-platform-limits
title: HarmonyOS 平台限制
status: active
confidence: 0.7
sources: [{type: experience, name: "Qt、Tauri、AWT/Swing 跨框架真机验证", date: 2026-08-06}]
created: 2026-08-13
updated: 2026-08-14
last_confirmed: 2026-08-06
review_by: null
superseded_by: null
tags: [ohos, platform-limits, sandbox, musl, permissions]
refs: [application-sandbox-paths, ohos-native-third-party-libraries]
summary: "跨框架验证的平台限制入口：bundle 写入/权限、动态代码加载、MUSL/SDK 与高权限能力边界。"
audience: public
---

# HarmonyOS 平台限制

本页只收录能脱离单一框架成立的平台结论。设备形态、系统版本、SDK/API 和证据日期是结论的一部分；框架错误、API wrapper 和 workaround 留在对应框架仓。

## 已确认限制

| 领域 | 平台约束 | 严重度 | 证据边界 |
|---|---|---|---|
| Bundle 路径 | 安装内容通常只读，普通应用不能靠 `chmod` 把随包文件变成 executable | 阻断 | 多 runtime/HAP 真机验证；见 [[application-sandbox-paths]] |
| 代码加载 | 普通可写数据路径不自动成为允许 `dlopen`/`execve` 的代码位置 | 阻断 | Qt plugin/runtime embedding 验证；见 problems |
| Mount namespace | 应用与 hdc shell 可能以不同前缀观察同一安装内容 | 高 | API24 PC/2in1 runtime embedding 验证 |
| Writable executable memory | JIT 等动态代码生成需要平台权限且 profile ACL 必须授权 | 阻断 | JVM/V8 跨两仓验证 |
| MUSL/SDK | glibc 私有符号、Linux 桌面库和完整 POSIX 行为不可假定存在 | 高 | native/Rust/Qt 交叉编译验证 |
| System privilege | 高权限系统能力不能仅凭 manifest 声明获得，受证书/profile/应用类型约束 | 阻断 | 签名与运行时验证 |

## 使用方法

1. 先判断错误是否来自平台 invariant，而不是框架 adapter；
2. 记录设备、系统/API、SDK、应用类型和签名 profile；
3. 用最小原生案例或第二个框架证据确认，再提升为本页结论；
4. 版本升级后重新确认，不把旧设备行为永久化。

## 不属于本页

Qt/QML platform name、QPA、GStreamer plugin、Rust crate cfg、JVM stack、.NET TFM 等只对框架/运行时成立的行为，不进入平台限制正文；它们可以链接这里解释平台触发条件。
