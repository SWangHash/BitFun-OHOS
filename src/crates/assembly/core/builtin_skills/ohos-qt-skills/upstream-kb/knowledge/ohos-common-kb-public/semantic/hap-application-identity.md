---
id: hap-application-identity
title: HAP 应用身份与 bundleName 约束
status: active
confidence: 0.7
sources: [{type: experience, name: "Qt/Tauri HAP 配置与签名排障", date: 2026-08-06}]
created: 2026-08-13
updated: 2026-08-14
last_confirmed: 2026-08-06
review_by: null
superseded_by: null
tags: [hap, bundle-name, identity, signing, appscope]
refs: [hap-native-project-structure]
summary: "bundleName 的平台身份作用、语法/唯一性检查及其与 profile、安装和框架生成配置的关系。"
audience: public
---

# HAP 应用身份与 bundleName 约束

`bundleName` 是应用身份的一部分，参与安装、启动、签名 profile 和数据隔离。它不是可以在构建最后随意替换的显示名称。

## 约束

- 使用目标 SDK schema 接受的字符和点分段形式；迁移实践中应使用至少三段、由字母/数字/下划线/点组成的稳定反向域名风格值。
- 在组织/设备环境中保持唯一，避免模板默认 identity 与其他应用冲突。
- `AppScope/app.json5`、框架配置、生成工程、启动命令和签名 profile 必须指向同一 identity。
- 框架可能把连字符转换为下划线或从 package id 派生 bundleName；这是 adapter 行为，不是平台语法。

## 排障

遇到配置校验、签名、安装或启动失败时，先收集生成后的最终 `AppScope/app.json5`，不要只读框架源配置。比较：

1. 最终 bundleName；
2. product/signingConfig；
3. profile 绑定的应用身份；
4. 安装/启动命令使用的 bundle；
5. 设备上是否已有冲突应用。

精确字符范围和长度可能随 SDK schema 演进，实施时以目标 SDK 校验结果和官方文档为准。
