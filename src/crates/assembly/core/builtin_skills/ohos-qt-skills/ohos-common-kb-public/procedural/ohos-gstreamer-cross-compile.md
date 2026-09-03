---
id: ohos-gstreamer-cross-compile
title: GStreamer 交叉编译到 OHOS
status: active
confidence: 0.5
sources: [{type: experience, name: "Qt KB GStreamer OHOS 交叉编译与应用验证", date: 2026-08-05}]
created: 2026-08-13
updated: 2026-08-13
last_confirmed: 2026-08-05
review_by: null
superseded_by: null
tags: [ohos, gstreamer, meson, cross-compile, multimedia]
refs: [ohos-native-third-party-libraries]
summary: "面向 OHOS 的 GStreamer core/plugin 交叉编译、feature 裁剪、依赖部署与最小 pipeline 验证。"
audience: public
---

# GStreamer 交叉编译到 OHOS

## Why:

GStreamer 是 core、plugin、registry 与外部 codec 的组合。仅生成一组 `.so` 无法证明目标能力可用；Linux 桌面 backend、扫描器和运行时 plugin discovery 也不能直接照搬。

## How to apply:

1. 固定 GStreamer/子项目版本、OHOS SDK/NDK、ABI 和所需 codec/feature 清单。
2. 准备 Meson cross file，确保 C/C++ compiler、ar、strip、pkg-config sysroot 全部指向 OHOS target。
3. 先构建最小 core/base，再按需求启用 good/bad/ugly/libav 等组件；禁用 ALSA、X11、Wayland 等不适用 backend。
4. 记录每个外部依赖的来源、许可证、构建 flags 与目标 artifact。
5. 将 core、所需 plugin 和所有 `NEEDED` 依赖部署到 HAP native library 目录。
6. 在目标设备设置受控的 plugin discovery 路径，验证 registry 建立与最小 pipeline。
7. 用实际 codec/源/sink 分别验证；不能以 `gst_init` 成功代替媒体功能验收。

## 最小验证矩阵

- core：初始化、版本查询、空 pipeline；
- plugin：目标 plugin 可枚举且依赖闭包完整；
- typefind/demux/decoder：用一个已知输入验证协商；
- sink：选择 OHOS 可用 backend 或应用提供的输出 adapter；
- fresh package：从干净 HAP 验证，不依赖开发机 registry/cache。

## Adapter 边界

QtMultimedia、Tauri plugin、Java binding 或其他框架如何消费 GStreamer，留在框架仓。本页不收特定应用补丁或框架 module/plugin 行为。
