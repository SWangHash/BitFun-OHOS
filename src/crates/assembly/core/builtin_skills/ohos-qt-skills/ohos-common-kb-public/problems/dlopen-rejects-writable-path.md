---
id: dlopen-rejects-writable-path
title: "动态库加载失败：代码位于普通可写路径"
status: active
confidence: 0.7
sources: [{type: experience, name: "Qt plugin 与 runtime embedding 真机排障", date: 2026-08-05}]
created: 2026-08-13
updated: 2026-08-14
last_confirmed: 2026-08-05
superseded_by: null
tags: [problem, runtime, dlopen, writable-path, sandbox, loader]
refs: [application-sandbox-paths, ohos-native-third-party-libraries]
summary: "应用从普通可写 data/cache 路径 dlopen 代码被 loader/安全策略拒绝；随 HAP 合规打包并检查依赖闭包。"
audience: public
error_message: |
  dlopen failed
  Permission denied
  library load rejected
---

# 动态库加载失败：代码位于普通可写路径

## 场景与原因

应用下载、解压或生成 `.so` 到 data/cache 等普通可写位置，再尝试 `dlopen`。可写数据目录不自动是可信代码来源，平台 loader/安全策略可能拒绝；同一错误也可能来自缺失依赖、ABI 或 ELF 损坏。

## 解决方案

1. 确认 resolved library path 及其目录类别；
2. 检查 ELF target、`NEEDED` 和 loader 日志，排除普通依赖问题；
3. 将固定 native code 在构建时放入 HAP 的 ABI library 目录并由完整签名链分发；
4. 若业务确需动态代码更新，采用平台明确支持的分发/签名机制，不自行从 data/cache 加载。

## 预防措施

把 data 更新与 executable code 更新分开设计；框架 plugin manager 不得绕过平台代码完整性模型。
