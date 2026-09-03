---
id: programmatic-hotspot-unavailable
title: "普通应用无法程序化创建 Wi-Fi 热点"
status: active
confidence: 0.7
sources:
  - type: official
    name: "wifiManagerExt enableHotspot API 约束"
    date: 2026-08-08
  - type: experience
    name: "热点模式真机验证"
    date: 2026-08-08
created: 2026-08-14
updated: 2026-08-14
last_confirmed: 2026-08-08
superseded_by: null
tags: [problem, wifi, hotspot, privileged-api]
refs: [privileged-system-capabilities]
summary: "enableHotspot 已废弃且限定非通用产品，普通应用的自动建热点功能需降级或改用受支持网络模式。"
audience: public
error_message: |
  enableHotspot unavailable
  No WiFi interfaces found
  hotspot mode unsupported
---

# 普通应用无法程序化创建 Wi-Fi 热点

## 原因

公开扩展 API 的状态和产品限制不支持普通通用设备应用据此自动创建热点。仅添加权限、stub 接口或把 OHOS 当 Linux Wi-Fi backend 不能获得系统能力。

## 处置

- 将 programmatic hotspot 标为当前普通应用不可用；
- 评估用户手动启用、现有局域网、平台公开 P2P/nearby 能力或移除该模式；
- 在 UI 中明确功能差异，不静默返回空网卡列表；
- 若产品是获准的非通用设备，由对应产品/系统 owner 按其 SDK 与签名策略重新评审。

## 预防措施

迁移前把所有网络管理、VPN、热点、系统设置等能力纳入特权 API 审计，而不是等编译成功后才做功能测试。

