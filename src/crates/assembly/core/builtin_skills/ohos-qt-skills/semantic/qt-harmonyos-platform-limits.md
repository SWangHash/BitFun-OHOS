---
id: semantic-qt-harmonyos-platform-limits
type: semantic
domain: tech
tags: [qt, harmonyos, platform-limits, chmod, symlink, dlopen, timezone, font, xcomponent, zink, rgba8, mipmap]
created: 2026-06-02
updated: 2026-08-15
status: active
audience: public
refs: [semantic-qt-harmonyos-overview, semantic-qt-harmonyos-api]
summary: >
  HarmonyOS 平台限制的 Qt/QPA/QML adapter：记录 QFile/QStandardPaths/QPluginLoader/QTimeZone、
  字体、XComponent、ZINK 与 Qt.platform 的可观察症状、Qt workaround 和 QTBUG；平台状态与原因由 common 维护。
---

# HarmonyOS 平台限制的 Qt adapter

> 来源：[HarmonyOS Platform Limitations](https://wiki.qt.io/Qt_for_HarmonyOS/platform_limitations)
> 父 issue：[QTBUG-146618](https://bugreports.qt.io/issues/?jql=project%20%3D%20QTBUG%20AND%20parent%20%3D%20QTBUG-146618)
>
> 跨框架成立的平台限制、证据边界与使用方法，以 common 的 [[ohos-common-kb/semantic/harmonyos-platform-limits|HarmonyOS 平台限制]]（[standalone 链接](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-platform-limits.md)）为准。本页保留 `QFile`、`QStandardPaths`、`QPluginLoader`、QML、Qt rendering 与 QTBUG 层面的症状和修复。

## 平台限制到 Qt API 的映射

下表只记录 Qt 层可观察结果和 adapter；限制是否成立、平台原因、错误码和确认状态以 common 为准。

| Qt 消费点 | Qt 层症状 | Qt adapter / 路由 | Qt 追踪 |
|---|---|---|---|
| `QFile::setPermissions()` | 对已有文件返回失败 | 不用它作为业务成功条件；权限需求交给平台打包契约 | [QTBUG-146619](https://bugreports.qt.io/browse/QTBUG-146619) |
| `QFile::link()` | 无法创建应用所需链接 | 构建/打包阶段展开为真实文件，避免运行时建链接 | [QTBUG-146621](https://bugreports.qt.io/browse/QTBUG-146621) |
| `QFileInfo` / `QStandardPaths::findExecutable()` | 系统可执行探测结果不可靠 | 不用桌面式 PATH 扫描选择程序；使用平台声明的入口 | [QTBUG-146625](https://bugreports.qt.io/browse/QTBUG-146625) |
| Qt 文件 IO 尾随斜杠 | 与桌面错误分支不同 | Qt 业务层先规范化并验证目标路径 | [QTBUG-146578](https://bugreports.qt.io/browse/QTBUG-146578) |
| `QFile` 包装的非阻塞流 | EOF 状态可能提前出现 | 同时检查 Qt IO 状态与底层错误，补回归测试 | [QTBUG-146579](https://bugreports.qt.io/browse/QTBUG-146579) |
| `QTimeZone` | libc 后端无法提供完整数据 | 构建 Qt 时选用 ICU 后端并验证目标时区 | [QTBUG-146717](https://bugreports.qt.io/browse/QTBUG-146717) / [QTBUG-146559](https://bugreports.qt.io/browse/QTBUG-146559) |
| Qt/三方 worker | 依赖线程取消的代码不可移植 | 使用 Qt interruption/cooperative cancellation | [QTBUG-146708](https://bugreports.qt.io/browse/QTBUG-146708) |
| `QPluginLoader` / runtime `.so` | 动态插件加载失败 | 让插件随最终 HAP 的 native library 闭包交付，或固定集合时静态链接；见 [runtime-fail-dlopen-writable-path](../problems/runtime-fail-dlopen-writable-path.md) | [QTBUG-146624](https://bugreports.qt.io/browse/QTBUG-146624) |
| Qt/三方共享库部署 | 处理后的 ELF 无法加载 | Qt 打包预检保留 loader 所需信息并验证 fresh HAP | [QTBUG-146620](https://bugreports.qt.io/browse/QTBUG-146620) |

## 标准路径

### QStandardPaths 约束
- `standardLocations()` 和 `writableLocation()` 返回相同单路径
- `AppLocalDataLocation` 映射到鸿蒙 `preferencesDir`
- **不支持**（返回空）：`PublicShareLocation`, `TemplatesLocation`, `StateLocation`, `GenericStateLocation`
- `findExecutable()` 因 `stat()` 限制无法工作
- **QTBUG**：[QTBUG-146625](https://bugreports.qt.io/browse/QTBUG-146625)

### 资源目录
- 路径：`<bundleCodeDir>/entry/resources/resfile`
- 当前**无** QStandardPaths 枚举映射此路径
- **QTBUG**：[QTBUG-146626](https://bugreports.qt.io/browse/QTBUG-146626)

## 字体系统

### 无等宽字体
- **影响**：`QFontDatabase::systemFont(FixedFont)` 返回非等宽字体
- **Workaround**：应用需自带等宽字体，用 `QFontDatabase::addApplicationFont()` 注册
- **QTBUG**：[QTBUG-146623](https://bugreports.qt.io/browse/QTBUG-146623)

## ArkUI/ArkTS API

### XComponent（ARKUI_XCOMPONENT_TYPE_SURFACE）在 API 20 弃用
- **状态**：华为已弃用
- **影响**：Qt 使用 ARKUI_XCOMPONENT_TYPE_SURFACE 作为 OpenGL 原生渲染表面
- **迁移方向**：ContentSlot 组件
- **参考**：[ContentSlot 文档](https://developer.huawei.com/consumer/en/doc/harmonyos-guides/arkts-rendering-control-contentslot)
- **QTBUG**：[QTBUG-146622](https://bugreports.qt.io/browse/QTBUG-146622)

## 参考来源

- [HarmonyOS Platform Limitations](https://wiki.qt.io/Qt_for_HarmonyOS/platform_limitations)
- [HarmonyOS MUSL 特殊符号不导出](https://developer.huawei.com/consumer/en/doc/harmonyos-references/musl-peculiar-symbol)

## OpenGL / ZINK 渲染

> OHOS Qt5.12 通过 Mesa ZINK（OpenGL-over-Vulkan，`NEED_OPENGL=1`）提供 OpenGL Desktop；main.cpp `QSurfaceFormat(3,2 CoreProfile)` → Qt3D 选 gl3 shader。ZINK 在 GL→Vulkan 翻译层有若干静默坑。

### glGenerateMipmap 对 RGBA8 alpha 纹理失败（mipmap 不完整→采样黑）
- **状态**：实测确认（planets-qml 真机，2026-07-14）
- **表现**：Qt3D/QtQuick `Texture2D` 用 **RGBA8 alpha-PNG** + `generateMipMaps:true` + `LinearMipMapLinear` 时，实体贴图**纯黑**（光照/阴影正常）；同配置下 **RGB8 JPG 正常**。hilog **无 GL 错误**（OpenGL 规范：不完整纹理按设计静默返回 `(0,0,0,1)`，不报错）
- **原因**：ZINK 用 `vkCmdBlitImage` 实现 `glGenerateMipmap`，对 **GL_RGBA8（alpha 通道）** mipmap 生成失败/坏 mipchain → 纹理不完整 → `LinearMipMapLinear` 采样返回黑。**GL_RGB8（无 alpha）mipmap 正常**。ZINK 把 RGB8/RGBA8 都映射到 `VK_FORMAT_R8G8B8A8_UNORM`，故不对称在 GL 级 completeness/mip-blit 层，不在 VkImage 创建
- **判别**：纯黑（而非彩色带+透明缺口）是关键——alpha-PNG 不透明区有色，若仅 blending-off 会显示彩色带；纯黑说明贴图采样返回 0 = 不完整
- **Workaround**：alpha-PNG 实体关 mipmap（`generateMipMaps:false` + `minificationFilter:Texture.Linear`，**两者必须同时改**，否则 base-level-only 配 mipmap min filter 仍不完整→仍黑）；JPG 实体保留 mipmap。详见 [problems/render-black-rgba8-zink-mipmap](../problems/render-black-rgba8-zink-mipmap.md)
- **关联次要缺陷**：透明实体（`opacity<1`）还需显式 `BlendEquation`+`BlendEquationArguments`+`NoDepthMask` RenderState——Qt3D 的 `opacity` 只是 shader uniform，**不会自动开 GL_BLEND**。这是独立缺陷，不是黑的成因

### Qt.platform.os 在 OHOS 返回 "linux"（不是 "ohos"）
- **状态**：源码确认
- **原因**：`qsystemdetection.h:115-117` 同时定义 `Q_OS_OHOS` 和 `Q_OS_LINUX`（同 Android 模式）；`qqmlplatform.cpp` 无 `Q_OS_OHOS` 分支 → 落回 `Q_OS_LINUX` → `Qt.platform.os` 返回 **"linux"**
- **影响**：QML 里用 `Qt.platform.os === "ohos"` 守卫会**永不触发**（静默 bug）
- **Workaround**：QML 检测 OHOS 用 `Qt.platform.pluginName === "ohos"`（QPA 插件 key 是 "ohos"，经 `Qt.platform.pluginName` 暴露）
