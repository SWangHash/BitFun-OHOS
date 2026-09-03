---
id: semantic-qt-harmonyos-overview
type: semantic
domain: tech
tags: [qt, harmonyos, ohos, huawei, cross-platform, qpa]
created: 2026-06-02
updated: 2026-08-14
status: active
audience: public
refs: [semantic-qt-harmonyos-build, semantic-qt-harmonyos-api, semantic-qt-harmonyos-platform-limits, semantic-qt-harmonyos-modules, semantic-qt-ohos-extras]
summary: >
  Qt for HarmonyOS 总览：鸿蒙系统简介、Qt 鸿蒙化架构（QPA 插件机制）、
  适配进展（Qt 5.12.12/5.15.16，适配率约90%）、
  支持设备（手机/平板/PC/2in1）、源码获取方式（Gerrit tqtc-qt5）。
---

# Qt for HarmonyOS 总览

## HarmonyOS 简介

HarmonyOS（鸿蒙）是华为开发的分布式操作系统，面向手机、平板、智慧屏、手表、PC 等设备。
- **微内核设计** + 单一框架，根据设备资源选择合适内核
- **2019 年**首发，最初 1-4 版本基于 AOSP + Linux 内核
- **HarmonyOS NEXT**（2024年10月发布）：替换为自研鸿蒙微内核，移除全部 Android 代码，仅支持原生"App"格式
- **2025 年 5 月**：首款搭载 HarmonyOS PC 的笔记本发布

## Qt 鸿蒙化核心机制

Qt 通过 **QPA（Qt Platform Abstraction）插件** 实现与鸿蒙系统的对接：
- QPA 插件将 Qt 的窗口系统、事件循环、图形渲染等抽象接口适配到鸿蒙的 ArkUI/ArkTS 层
- 底层通过 **Node-API**（基于 Node.js 12.x LTS）实现 C/C++ 与 ArkTS 的跨语言交互
- 渲染表面使用 **XComponent**（ArkUI 原生组件），注意 API 20 后已弃用，需迁移到 ContentSlot

## 版本信息

| 项目 | 内容 |
|------|------|
| Qt 版本 | **Qt 5.12.12 LTS**（主力）、Qt 5.15.16 |
| 最低 SDK | HarmonyOS SDK **API 15** |
| 推荐 SDK | API 17（HarmonyOS 5）/ API 20（最新特性） |
| 适配进度 | 核心模块约 **90%**（2025年中） |
| 目标架构 | arm64-v8a |

## 源码获取

1. 访问 [https://codereview.qt-project.org](https://codereview.qt-project.org) 登录
2. Settings → HTTP Credentials → GENERATE NEW PASSWORD
3. 克隆仓库：`https://codereview.qt-project.org/qt/tqtc-qt5`
4. 切换分支：
   - `git checkout tqtc/harmonyos-5.12.12`（Qt 5.12）
   - `git checkout tqtc/harmonyos-5.15.16`（Qt 5.15）
5. 初始化子模块：`git submodule update --init --recursive`

## 开发工具链

| 工具 | 用途 |
|------|------|
| **DevEco Studio** | 华为官方 IDE，提供 SDK、模拟器、签名打包 |
| **Qt Creator** | Qt 开发 IDE，配置 HarmonyOS Kit 后用于 C++ 开发 |
| **hdc** | HarmonyOS Device Connector，设备调试/传输/安装 |
| **CMake** | 构建系统（DevEco 内交叉编译） |

## 相关

- [[qt-harmonyos-build]] — 构建指南
- [[qt-harmonyos-api]] — API 兼容性笔记
- [[qt-harmonyos-platform-limits]] — 平台限制
- [[qt-harmonyos-modules]] — 模块适配状态
- [[qt-harmonyos-lifecycle]] — 生命周期/开发指南（dev-guide 已归档）
- [[qt-ohos-extras]] — QtOhosExtras 模块
- [[ohos-common-kb/semantic/harmonyos-development-fundamentals|HarmonyOS 开发基础]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-development-fundamentals.md)）

## 参考来源

- [Qt for HarmonyOS Wiki](https://wiki.qt.io/Qt_for_HarmonyOS)
- [Building Qt for HarmonyOS](https://wiki.qt.io/Building_Qt_for_HarmonyOS)
- [HarmonyOS Development Fundamentals](https://wiki.qt.io/HarmonyOS_Development_Fundamentals)
