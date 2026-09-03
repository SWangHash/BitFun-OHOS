---
id: ohpm-install-timeout
title: ohpm install 超时或 registry 不可达
status: active
confidence: 0.9
sources:
  - type: experience
    name: "Tauri 应用迁移中的 ohpm install 超时"
    date: 2026-07-15
created: 2026-08-15
updated: 2026-08-15
last_confirmed: 2026-07-30
superseded_by: null
tags: [ohos, ohpm, registry, timeout, network, problem]
refs: [deveco-cli-usage-rules]
summary: "ohpm install 长时间无响应或超时通常是 registry、代理或网络可达性问题；先诊断当前配置，再切换到组织批准且可达的 registry。"
audience: public
error_message: |
  ohpm install 超时
  ohpm install 长时间无响应
---

# ohpm install 超时或 registry 不可达

## 症状

执行 `ohpm install` 时长时间无响应、连接失败或超时。该问题属于 OHPM registry 与网络链路，不由上层 Qt、Tauri、AWT/Swing 或 Avalonia 框架决定。

## 诊断

1. 记录 `ohpm --version` 和当前 registry 配置，确认实际使用的客户端与源；
2. 检查目标 registry 的 DNS、TLS 和代理可达性，区分源不可达、代理配置错误与临时网络波动；
3. 在同一终端重试最小 `ohpm install`，不要用删除锁文件或反复清缓存掩盖网络根因；
4. 若通过 `devecocli` 构建，结合其详细日志确认失败确实发生在 OHPM 安装阶段。

## 处置

优先使用组织批准且在当前网络可达的 registry。经批准使用华为云镜像时，可执行：

```bash
ohpm config set registry https://repo.huaweicloud.com/repository/ohpm/
```

切换后重新读取 registry 配置并执行安装验证。若组织要求官方源或内部代理，以该策略为准；不要把某个镜像地址写死到框架模板或应用源码。

## 框架 adapter 边界

框架仓只需保留生成工程中从哪里触发 `ohpm install`、如何采集日志以及修复后的框架构建回归证据。registry、代理和网络诊断由本页统一维护。

## 关联

- [[../procedural/deveco-cli-usage-rules|deveco-cli 使用规则]] — OHPM 在 DevEco 工具链中的职责与底层诊断边界
