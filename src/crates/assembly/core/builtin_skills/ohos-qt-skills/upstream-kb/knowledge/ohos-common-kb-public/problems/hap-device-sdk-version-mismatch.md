---
id: hap-device-sdk-version-mismatch
title: "HAP 安装失败：设备 API 低于 compatibleSdkVersion"
status: active
confidence: 0.9
sources: [{type: experience, name: "AWT/Swing 测试 app 真机验证", date: 2026-07-30}]
created: 2026-08-13
updated: 2026-08-13
last_confirmed: 2026-07-30
superseded_by: null
tags: [problem, install, hap, sdk, api-version]
refs: [hap-native-project-structure]
summary: "设备 API 低于 HAP compatibleSdkVersion 时安装返回 9568297/older sdk version；按真实最低能力选择兼容版本。"
audience: public
error_message: |
  error: failed to install bundle. code:9568297
  error: install failed due to older sdk version in the device.
---

# HAP 安装失败：设备 API 低于 compatibleSdkVersion

## 错误信息

```text
error: failed to install bundle. code:9568297
error: install failed due to older sdk version in the device.
```

## 场景与原因

构建 product 的 `compatibleSdkVersion` 高于目标设备 API。安装器拒绝把要求更高最低 API 的 HAP 安装到旧设备。

## 解决方案

1. 查询目标设备 API level；
2. 确认应用及所有 native/ArkTS 能力的真实最低 API；
3. 将 product 的 compatible SDK 调整为不高于设备、且不低于应用实际需求的值；
4. clean rebuild、重新签名并安装。

不要机械复制某个案例中的低版本值。若应用确实依赖更高 API，应升级设备或保留安装拒绝，而不是降低声明后承担运行时崩溃。

## 预防措施

测试矩阵记录设备系统/API、编译 SDK、target SDK 与 compatible SDK；安装前由工具输出这些值。

