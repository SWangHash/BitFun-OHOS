---
id: harmonyos-development-fundamentals
title: HarmonyOS 应用开发基础
status: active
confidence: 0.7
sources:
  - type: official
    name: "HarmonyOS 应用开发指南与 API 文档"
    date: 2026-06-02
    uri: "https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/application-dev-guide"
  - type: doc
    name: "Qt Wiki: HarmonyOS Development Fundamentals"
    date: 2026-06-02
    uri: "https://wiki.qt.io/HarmonyOS_Development_Fundamentals"
created: 2026-08-13
updated: 2026-08-13
last_confirmed: 2026-06-02
review_by: null
superseded_by: null
tags: [harmonyos, openharmony, arkts, arkui, node-api, stage, deveco, hdc]
refs: []
summary: "HarmonyOS 应用开发的中立入口：区分 HarmonyOS 与 OpenHarmony，说明 Stage、ArkTS、ArkUI、Node-API 和 DevEco/hdc 的职责边界。"
audience: public
---

# HarmonyOS 应用开发基础

本页提供不依赖 Qt、Tauri、AWT/Swing 或 Avalonia 的平台概念入口。具体 API、系统行为和工具命令仍应以目标 SDK 对应的官方文档与本库专题页为准。

## HarmonyOS 与 OpenHarmony

OpenHarmony 是开放原子开源基金会旗下的开源项目；HarmonyOS 是华为面向设备和应用生态交付的商业系统。两者共享部分技术基础，但产品能力、SDK、API 可用性、签名权限和设备策略不能默认完全相同。

迁移或排障时应先确认：

- 目标是 HarmonyOS 还是 OpenHarmony；
- 设备形态与系统版本；
- 编译使用的 SDK/API level；
- 结论来自公开平台文档、目标 SDK，还是某个框架的适配实现。

## 应用模型与主要技术层

| 层次 | 主要职责 | 框架适配时的边界 |
|---|---|---|
| Stage / UIAbility | 应用组件、生命周期、启动与 Want 路由 | 平台定义生命周期；框架负责映射自己的 event loop 和窗口语义 |
| ArkTS | 应用侧业务与系统 API 调用语言 | 框架胶水常在 ArkTS 层接入平台能力 |
| ArkUI | 声明式 UI、组件、布局、窗口与交互 | 框架可能只把 ArkUI/XComponent 作为渲染或窗口底座 |
| Node-API | ArkTS/JS 与 C/C++ 原生模块之间的 ABI | 框架负责线程、对象生命周期和自身类型的适配 |
| Native C/C++ | NDK、系统接口、三方库与渲染运行时 | 平台工具链和沙箱约束由 common 维护，框架构建接入留在框架仓 |

## Stage 与 UIAbility

Stage 模型以应用、模块和 Ability 组织运行单元。`UIAbility` 是带界面的应用组件，常通过 `Want` 接收启动目标和参数，并由 `module.json5` 声明入口、skills、设备类型及权限等元数据。

不要把框架的窗口对象直接等同于 UIAbility：一个框架可能在单个 Ability 中管理多个内部窗口，也可能通过平台能力创建额外窗口。完整生命周期与 Want 语义由后续 common 专题页维护。

## ArkTS、ArkUI 与 Node-API

- ArkTS 是 HarmonyOS 应用开发的主要语言，用于页面、Ability 和系统能力调用。
- ArkUI 提供声明式组件、布局、动画、事件、窗口及原生组件承载能力。
- Node-API 让 ArkTS/JS 调用 C/C++ 原生模块；跨线程调用、异步回调、对象释放和异常传播必须由接入层明确管理。

学习入口：

- [ArkTS 概述](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/arkts-overview)
- [Node-API 开发流程](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/use-napi-process)
- [窗口管理](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/window-manager)

## 开发与调试工具

DevEco Studio 提供工程编辑、SDK 管理、构建、签名、调试与分析能力。命令行自动化可由 `devecocli` 统一编排；AI 工具可通过 deveco-mcp 接入静态检查。具体操作规则属于内部工具治理页，不作为理解本基础页的必要依赖。

`hdc` 是设备连接器，可用于设备查询、文件传输、安装、shell 和日志等底层操作。生态日常流程由 `devecocli` 编排这些能力；只有诊断封装层本身或仓库明确要求时才直接调用底层工具。

## 工程元数据提示

应用支持的设备类型在模块配置中声明，例如：

```json5
{
  "module": {
    "deviceTypes": ["phone", "tablet", "2in1"]
  }
}
```

具体可选值和产品支持范围必须以目标 SDK schema 为准；仅修改声明不会自动让框架适配新的窗口、输入或显示能力。

## 延伸方向

- Stage/UIAbility 生命周期与 Want 路由
- ArkUI 窗口、XComponent 与原生渲染承载
- Node-API 线程、对象生命周期与异常边界
- OHOS NDK、交叉编译、HAP 构建签名与平台沙箱
