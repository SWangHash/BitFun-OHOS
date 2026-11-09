---
id: problem-render-fail-egl-bad-config-samples
type: problem
domain: runtime
tags: [egl, egl-bad-config, msaa, samples, qsurfaceformat, black-screen, ohos, opengl]
created: 2026-10-17
updated: 2026-10-17
status: solved
severity: high
audience: public
refs: [semantic-qt-harmonyos-platform-limits, problem-render-black-rgba8-zink-mipmap]
summary: >
  OHOS 的 EGL 实现不提供 4x MSAA 的 framebuffer config：应用设置
  QSurfaceFormat::setSamples(4) 后 eglChooseConfig 找不到匹配项，surface 创建失败
  （EGL_BAD_CONFIG 12293 / Cannot find EGLConfig），窗口启动即黑屏（进程不崩溃）。
  修复：用 Q_OS_OHOS 守卫移除 setSamples(4)，保留 depth24+stencil8。
leader_summary: >
  沉淀 OHOS EGL 无 4x MSAA config 导致启动黑屏的排障方案；OpenGL/GL 渲染类应用
  移植鸿蒙的常见启动阻断，修复成本低，但现象（整窗纯黑 + 进程稳定）容易与白屏类、
  mipmap 类黑屏混判。
impact: [迁移提效, 商业答复]
deliverables: [problem记录]
evidence: [OHOS 项目排障实测（qt-ohos-run-test §4.2b 判据）, 守卫后 surface 创建成功、渲染恢复]

# ====== 检索关键字 ======
error_message: >
  Failed to create surface with error: 12293 - EGL_BAD_CONFIG
  / Cannot find EGLConfig（hilog 可见；应用不崩溃，窗口黑屏）
error_code: "12293"
keywords: [egl, egl_bad_config, 12293, eglChooseConfig, setSamples, samples, MSAA, multisample, QSurfaceFormat, black-screen, 黑屏, depth24, stencil8]
symptoms: >
  应用启动后窗口黑屏、进程不退出也无 crash；hilog 出现 EGL_BAD_CONFIG 12293 /
  Cannot find EGLConfig；源码中存在 QSurfaceFormat::setSamples(4)（或多重采样设置）。

# ====== 问题详情 ======
environment: >
  OHOS Qt5（5.12.12 / 5.15.16 OHOS SDK），QPA 使用 OHOS EGL；应用在 QSurfaceFormat
  中请求 4x MSAA（setSamples(4)）。
---

# EGL_BAD_CONFIG 12293：OHOS 无 4x MSAA config 导致启动黑屏

## 错误信息

```
Cannot find EGLConfig
Failed to create surface with error: 12293 - EGL_BAD_CONFIG
```

应用启动后窗口**整窗黑屏**，进程不退出、无 crash——surface 创建失败后没有内容可渲染。

## 根因

OHOS 的 EGL 实现不提供 4x MSAA（multisample）的 framebuffer config。应用通过
`QSurfaceFormat::setSamples(4)` 请求多重采样抗锯齿后，`eglChooseConfig` 在全部
EGLConfig 中找不到满足 samples=4 的匹配项，surface 创建直接失败（`EGL_BAD_CONFIG`，
错误码 12293）。

桌面 EGL/GLX 通常带 MSAA config，`setSamples(4)` 静默生效，因此该问题只在鸿蒙上暴露。

## 修复/绕行

用 `Q_OS_OHOS` 守卫移除 samples 请求，保留 depth24+stencil8（OHOS 有对应 config）：

```cpp
QSurfaceFormat fmt;
fmt.setDepthBufferSize(24);
fmt.setStencilBufferSize(8);
#ifndef Q_OS_OHOS
fmt.setSamples(4);   // OHOS EGL 无 4x MSAA config，保留会 EGL_BAD_CONFIG 12293 黑屏
#endif
QSurfaceFormat::setDefaultFormat(fmt);
```

实测修复：加守卫后 surface 创建成功，渲染恢复正常。注意 Qt6 预构建 kit 的平台宏是
`Q_OS_HARMONY`，`Q_OS_OHOS` 未定义（见 semantic/qt-harmonyos-qt6-status.md），Qt6
工程需按双宏守卫。

## 排查判据

1. hilog 含 `EGL_BAD_CONFIG` / `12293` / `Cannot find EGLConfig` → 直接搜 `setSamples(`
2. 与其它两类黑屏区分：
   - 本问题：**整个窗口黑** + 有 EGL 错误日志，进程稳定；
   - mipmap 黑：**局部实体贴图黑**（Phong 光照/JPG 正常）+ **无任何 GL 错误**，
     见 [render-black-rgba8-zink-mipmap](render-black-rgba8-zink-mipmap.md)；
   - 白屏：QML 模块未部署 / 应用侧未调 `show()`，见
     procedural/qt-ohos-run-test.md §2.5 与 golden rule W6。

## 相关

- [render-black-rgba8-zink-mipmap](render-black-rgba8-zink-mipmap.md) — 同为 OHOS 渲染管线的黑屏坑（ZINK mipmap 对 RGBA8 alpha 失败，静默无日志）
- [[semantic-qt-harmonyos-platform-limits]] — 平台限制主文档（渲染/EGL 差异）
- 排障流水线位置：procedural/qt-ohos-run-test.md §4.2b 判据与三类黑屏区分矩阵；procedural/qt-app-harmonyos-full-pipeline.md 常见问题表
- 本页为**本地基线新增**（manifest `action=added-local`，上游尚未收录）：内容源自 BitFun 内置 KB 的同名页（2026-09-10 建立）；一旦上游收录，按同步流程改为 `take-upstream`。

> 📋 返回 [错误速查表](_lookup.md)
