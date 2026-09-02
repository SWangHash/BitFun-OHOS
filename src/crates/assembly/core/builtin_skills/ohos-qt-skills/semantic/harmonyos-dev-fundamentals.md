---
id: semantic-harmonyos-dev-fundamentals
type: semantic
domain: tech
tags: [harmonyos, openharmony, huawei, arkts, arkui, node-api, hdc, deveco]
created: 2026-06-02
updated: 2026-06-02
status: active
audience: public
refs: [semantic-qt-harmonyos-overview]
summary: >
  鸿蒙开发基础知识：HarmonyOS vs OpenHarmony 区别、技术架构、
  DevEco Studio IDE、Node-API（C/C++与ArkTS交互）、ArkTS 语言、
  ArkUI 框架、hdc 调试工具、常用链接和示例。
---

# 鸿蒙开发基础知识

> 来源：[HarmonyOS Development Fundamentals](https://wiki.qt.io/HarmonyOS_Development_Fundamentals)

## HarmonyOS vs OpenHarmony

| | HarmonyOS | OpenHarmony |
|---|-----------|-------------|
| 开发方 | 华为 | 开放原子开源基金会 |
| 性质 | 商业系统 | 开源系统 |
| 基础 | HarmonyOS 衍生，捐赠 L0-L2 分支 | 基于 LiteOS |
| NEXT | 自研微内核，移除 Android | — |

## 技术架构

IDE：[DevEco Studio](https://developer.huawei.com/consumer/cn/deveco-studio/)
- 支持 Windows 和 macOS（Intel + Apple Silicon）
- 自带模拟器（有一定限制）
- 也可用[命令行工具](https://developer.huawei.com/consumer/en/download/command-line-tools-for-hmos)（含 Linux）

## 核心开发技术

### Node-API
- 基于 Node.js 12.x LTS Node-API
- 允许 ArkTS/JS 与 C/C++ 模块交互
- [Node-API 概述](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/napi-introduction)
- [Node-API 开发流程](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/use-napi-process)

### ArkTS
- 鸿蒙应用开发的官方高级语言
- [ArkTS 概述](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/arkts-overview)
- [跨语言交互](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/arkts-cross-language-interaction)

### ArkUI
- UI 开发基础设施：组件、布局、动画、交互事件
- [Window Manager](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/window-manager)
- [Display Management](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/display-manager)

## 调试工具：hdc

**HarmonyOS Device Connector** — 类似 adb 的命令行工具：
- 设备交互与调试
- 数据传输
- 日志查看
- 应用安装
- 支持 Windows/Linux/macOS
- [英文文档](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/hdc) | [中文文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/hdc)
- [hdcutils](https://github.com/lanbaoshen/hdcutils) — Python 纯实现

## 实用链接

| 资源 | 链接 |
|------|------|
| 开发者门户 | [developer.huawei.com](https://developer.huawei.com/consumer/en/harmonyos/develop/) |
| 应用开发指南 | [application-dev-guide](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/application-dev-guide) |
| SDK Headers (GitHub) | [harmonyos_sdk_headers](https://github.com/harmonyosmirror/harmonyos_sdk_headers) |
| 示例代码 (GitCode) | [HarmonyOS_Samples](https://gitcode.com/HarmonyOS_Samples) |
| Codelabs (GitCode) | [HarmonyOS_Codelabs](https://gitcode.com/HarmonyOS_Codelabs) |
| OpenHarmony (Gitee) | [openharmony](https://gitee.com/openharmony) |
| MUSL 特殊符号 | [不导出符号列表](https://developer.huawei.com/consumer/en/doc/harmonyos-references/musl-peculiar-symbol) |

## 小技巧

**设备类型配置**：修改 `entry/src/main/module.json5` 中的 `module.deviceTypes`：
```json5
// 默认通常只有 phone
"deviceTypes": ["phone"]

// 支持平板和 PC 时改为：
"deviceTypes": ["tablet", "2in1"]
```

## 参考来源

| 来源类型 | 说明 |
|----------|------|
| 🛠️ 工作经验 | 日常 Qt 鸿蒙化开发实践积累 |
