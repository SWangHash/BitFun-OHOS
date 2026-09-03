---
id: native-runtime-embedding
title: HarmonyOS 原生运行时嵌入模型
status: active
confidence: 0.7
sources: [{type: experience, name: "Python、Node、Java、Rust runtime embedding 真机验证", date: 2026-08-05}]
created: 2026-08-13
updated: 2026-08-15
last_confirmed: 2026-08-05
review_by: null
superseded_by: null
tags: [runtime, embedding, hap-bin, shared-library, hnp, execve, jit]
refs: [application-sandbox-paths, executable-binary-eacces, executable-memory-permission-denied]
summary: "hap-bin、进程内 SO 与 HNP 三种运行时集成模型及路径、签名、JIT 和验证契约。"
audience: public
---

# HarmonyOS 原生运行时嵌入模型

## 选型

| 模型 | 隔离 | 典型接口 | 主要风险 |
|---|---|---|---|
| HAP 内 executable（hap-bin） | 子进程 | fork/execve、stdin/stdout/IPC | executable 声明、bin 签名、路径 namespace、JIT 权限 |
| 进程内共享库 | 同进程 | `dlopen` + C API | ABI、符号闭包、主线程/信号/崩溃影响整个应用 |
| HNP | 独立软件包/系统管理路径 | HNP 安装布局和公开入口 | 设备/发行策略、路径与版本管理复杂度 |

优先按运行时官方嵌入能力、隔离需求和平台发行模型选择，不因某个框架 API 恰好可用就固定架构。

## hap-bin 契约

- bin 随 HAP 打包，并在 `module.json5` 的 `executableBinaryPaths` 中声明；
- 安装后的执行权限、完整性/签名节和 profile 权限是独立检查；
- 应用与 shell 的路径视角不同，路径从运行主体的 platform API/已验证布局取得；
- 子进程环境、stdlib/resources、locale、证书和动态依赖必须显式部署；
- JIT runtime 可能需要受控的 writable-code-memory 权限和 profile ACL。

## 进程内 SO 契约

- 使用目标 ABI 的 shared library，并部署完整 `NEEDED` 闭包；
- 初始化顺序、allocator、线程、signal、locale、环境变量和 shutdown 必须由 host 明确管理；
- 不从普通可写目录加载代码；
- 先用最小 C/C++ host 验证，再接框架 event loop/线程 adapter。

## 验收矩阵

至少覆盖：clean install、首次启动、重复启动、正常退出、异常退出、资源/stdlib 加载、非 ASCII 数据、子进程/线程、权限拒绝、设备重启后运行和 fresh package。框架仓另外验证其 UI/event loop 与 API adapter。
