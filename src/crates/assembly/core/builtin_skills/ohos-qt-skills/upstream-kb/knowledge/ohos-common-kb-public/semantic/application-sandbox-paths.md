---
id: application-sandbox-paths
title: HarmonyOS 应用沙箱路径与代码加载
status: active
confidence: 0.7
sources: [{type: experience, name: "Qt runtime embedding 与跨框架真机路径排障", date: 2026-08-05}]
created: 2026-08-13
updated: 2026-08-14
last_confirmed: 2026-08-05
review_by: null
superseded_by: null
tags: [sandbox, path, mount-namespace, bundle, writable, dlopen]
refs: []
summary: "区分 bundle 与数据路径、应用与 hdc shell mount namespace，并约束写入、chmod、dlopen 和 execve。"
audience: public
---

# HarmonyOS 应用沙箱路径与代码加载

## 三个不可混淆的维度

1. **内容性质**：安装包资源、native library/executable，还是运行时数据；
2. **访问主体**：应用进程、子进程、hdc shell 或系统服务；
3. **操作类型**：读取、写入、修改权限、`dlopen` 或 `execve`。

安装后的 bundle 路径用于已签名/打包内容，通常不可由普通应用随意写入或 `chmod`。可写应用数据目录用于配置、数据库、缓存和用户数据，但“可写”不意味着允许从该位置加载或执行代码。

## Mount namespace

应用进程与 hdc shell 可能用不同前缀观察同一 bundle 文件。已验证案例中应用使用 `/data/storage/...` 视角，而 shell 从 `/data/app/...` 观察安装内容。不要把 shell 中复制出的绝对路径硬编码到应用。

路径应优先由平台 context/API 或框架的应用目录 API 取得。诊断时分别在实际访问主体中检查文件，不用一个 namespace 的 `ls` 推断另一个 namespace 一定可见。

## 操作规则

- 随包资源只读使用；需要修改时复制数据到平台提供的可写数据目录。
- 不在应用代码中尝试给 bundle 文件 `chmod +x`；需要执行的 bin 在打包时声明。
- 不把下载/生成的 `.so` 放到普通可写目录后直接 `dlopen`；先确认平台允许的代码分发和签名模型。
- 将 “not found”“permission denied”“loader rejected” 分开诊断：它们分别可能来自 namespace、Unix mode、签名/策略或缺失依赖。

## 删除测试

框架页应保留“使用哪个框架 API 获得路径、原始错误和修复步骤”，本页维护平台 invariant。若框架页能脱离本页完整解释 sandbox/mount/loader 规则，则摘要过深。
