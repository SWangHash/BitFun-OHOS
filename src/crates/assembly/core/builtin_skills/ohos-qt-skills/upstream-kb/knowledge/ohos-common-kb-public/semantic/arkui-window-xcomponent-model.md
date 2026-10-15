---
id: arkui-window-xcomponent-model
title: ArkUI 窗口与 XComponent 承载模型
status: active
confidence: 0.5
sources:
  - type: official
    name: "HarmonyOS Window 与 XComponent 开发指南"
    date: 2026-08-11
    uri: "https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/window-overview"
  - type: experience
    name: "Qt QPA 的 WindowStage、XComponent 与 SurfaceHolder 适配审计"
    date: 2026-08-11
created: 2026-08-14
updated: 2026-08-14
last_confirmed: 2026-08-11
review_by: null
superseded_by: null
tags: [arkui, window, xcomponent, surface, native-window, focus]
refs: []
summary: "区分 WindowStage/main/subwindow、XComponent 节点、native surface、焦点/可见/可绘制状态及新旧 API seam。"
audience: public
---

# ArkUI 窗口与 XComponent 承载模型

本页定义跨框架可复用的概念边界，不把某个 QPA、Skia、JVM 或 WebView adapter 的内部状态机提升为平台行为。

## 窗口层次

- UIAbility 通过 WindowStage 获得窗口承载；
- 应用主窗口、子窗口、浮窗或其他扩展窗口具有不同的系统任务、父子、权限与生命周期语义；
- 框架 top-level window 不必与平台 main window 一一对应；映射由 adapter 决定；
- 窗口对象存在、请求显示、系统可见、获得焦点和 surface 可绘制是不同状态。

排障时分别观察 platform window state、focus、visibility/exposure、surface lifecycle 和框架自身 visible flag，不能用其中一个替代全部状态。

## XComponent seam

XComponent 用于在 ArkUI 节点树中承载 native surface 或 native node，使 C/C++ 渲染/组件能够嵌入页面。典型 seam 包含：

1. ArkUI 创建并挂载 XComponent/ContentSlot 节点；
2. 平台创建或变更 surface/native window；
3. native adapter 接收 lifecycle、size、touch/mouse/key/focus 等事件；
4. 渲染线程只在 surface 有效且尺寸/状态就绪时提交；
5. 节点卸载或 surface 销毁后停止使用旧 handle。

## 新旧 API 边界

OH_NativeXComponent、Node API SurfaceHolder/SurfaceCallback 等接口可能覆盖不同年代或职责。已观察到两套 surface 管理路径混用时创建失败，但互斥的精确触发边界仍需最小原生复现确认。

因此 common 只固定以下规则：

- 一个 adapter 必须明确选择谁拥有 surface lifecycle；
- 不同时注册两套未知兼容性的 surface owner 后假定可共存；
- 输入、无障碍和 surface 管理可有不同 API seam，迁移前逐项列依赖；
- API deprecated/替代关系以目标 SDK 文档为准；未验证的 Qt 现象不能写成系统全局限制。

## 焦点、可见与可绘制

| 状态 | 回答的问题 |
|---|---|
| requested visible | 应用/框架是否请求显示 |
| system visibility/window status | 系统当前如何呈现窗口 |
| focus/active | 键盘、输入与视觉激活由谁获得 |
| surface available/exposed | native renderer 当前能否提交内容 |

异步窗口 API 成功返回通常只说明请求已受理。应等待对应 callback/event，并在超时或窗口销毁时取消旧请求。

## Adapter 验证

覆盖首次创建、旋转/resize、前后台、hide/show、surface 重建、窗口关闭、焦点切换、触摸/鼠标/键盘、无障碍树和多窗口。保存 native handle 前定义有效期，所有回调都防止使用已销毁 surface/node。

