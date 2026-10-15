---
id: privileged-system-capabilities
title: 特权系统能力与普通应用边界
status: active
confidence: 0.7
sources:
  - type: official
    name: "wifiManagerExt enableHotspot API 约束"
    date: 2026-08-08
  - type: experience
    name: "热点模式真机评估"
    date: 2026-08-08
created: 2026-08-14
updated: 2026-08-14
last_confirmed: 2026-08-08
review_by: null
superseded_by: null
tags: [privileged-api, permission, system-app, wifi, hotspot]
refs: [programmatic-hotspot-unavailable]
summary: "API 可见、manifest 权限、profile ACL、应用类型和产品类型共同决定特权能力；普通应用必须设计降级。"
audience: public
---

# 特权系统能力与普通应用边界

在 SDK 中能看到 API 或权限名，不等于普通第三方应用可调用。能力判断至少包含：API 状态、system capability、permission level、签名/profile ACL、应用类型、产品类型与设备策略。

## 判定顺序

1. API 是否在目标 SDK/API level 存在，是否 deprecated；
2. 文档是否限定 system/basic、特定产品或非通用设备；
3. manifest 权限能否由当前应用类型申请；
4. profile/证书是否实际授权；
5. 真机是否提供对应 system capability；
6. 拒绝时是否有用户设置页、系统 chooser 或其他受支持替代流程。

不要尝试通过隐藏 API、复制系统签名或扩大证书权限绕过平台边界。无法向普通应用开放的核心能力应在迁移评估中标为 blocked/degraded，而不是留到运行时静默失败。

## Wi-Fi 热点案例

已审计的 `wifiManagerExt.enableHotspot` 已 deprecated，并面向非通用类型产品；普通手机/平板/2in1 应用不能据此承诺程序化创建热点。应用可评估用户手动设置、现有网络、平台公开的 nearby/P2P 能力或取消该模式，但替代方案是否等价必须重新验证。

## Adapter 边界

框架仓保留具体功能开关、错误和用户体验 fallback；common 维护权限/产品/应用类型判定方法与已确认的平台边界。

