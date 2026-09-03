---
id: problem-render-black-rgba8-zink-mipmap
type: problem
domain: runtime
tags: [zink, rgba8, mipmap, texture-incomplete, qt3d, alpha-png, ohos]
created: 2026-07-14
updated: 2026-07-14
status: solved
severity: high
audience: public
refs: [semantic-qt-harmonyos-platform-limits]
summary: >
  OHOS ZINK(Qt5 OpenGL-over-Vulkan)下 Qt3D Texture2D 用 RGBA8 alpha-PNG + generateMipMaps:true 时，
  glGenerateMipmap 对 RGBA8 失败/坏 mipchain→纹理 mipmap 不完整→采样器返回黑(0,0,0,1)→实体纯黑；
  同 effect 下 RGB8 JPG 行星贴图正常。修复：给 alpha-PNG 实体关 mipmap(generateMipMaps:false + minificationFilter:Texture.Linear)，
  守卫 Qt.platform.pluginName!=="ohos"（注意 Qt.platform.os 在 OHOS 返回 "linux"）。
leader_summary: >
  沉淀 OHOS ZINK 渲染管线一个静默 bug（RGBA8 alpha 纹理 mipmap 不完整→纯黑）的复用排障方案，
  Qt3D/QtQuick 3D 应用移植鸿蒙可直接套用。
impact: [迁移提效, Qt6支撑, 商业答复]
deliverables: [problem记录, patch]
evidence: [planets-qml-ohos 工程修复(SolarSystem.qml + PlanetMaterial.qml), hilog 干净无 GL 错(失败是静默的)]

# ====== 检索关键字 ======
error_message: >
  无 GL 错误日志（失败是静默的）。现象：Qt3D 球体/星环/云层贴图纯黑不显示，
  但 Phong 光照/阴影正常、其他 RGB8 JPG 贴图实体正常。
error_code: ""
keywords: [zink, rgba8, mipmap, glGenerateMipmap, alpha-png, colortrans, texture-incomplete, black, qt3d, planets-qml, blending-off]
symptoms: >
  Qt3D 实体贴图纯黑（cloud 球壳 / saturn 星环 / uranus 星环），光照与阴影正常；
  同 effect 下用 RGB8 JPG 的实体贴图正常；唯一判别变量是贴图格式 RGBA8(alpha) vs RGB8(JPG)。

# ====== 问题详情 ======
environment: >
  OHOS Qt5.12.12 OHOS SDK；真机 HUAWEI MateBook Fold；Mesa ZINK（OpenGL-over-Vulkan，NEED_OPENGL=1）；
  main.cpp QSurfaceFormat 3.2 CoreProfile→Qt3D 选 gl3 shader；Qt3D Texture2D (QOpenGLTexture)。
---

# Qt3D RGBA8 alpha-PNG 贴图在 OHOS ZINK 下渲染纯黑（mipmap 不完整）

## 错误信息

```
（无错误日志——失败完全静默）
hilog 只见：MESA: ZINK: SSBO is readonly in vertex stage!（无关红鲱鱼，来自 PlanetEffect 的 light UBO/SSBO 绑定）
无 GL_INVALID / 无 texture / 无 mipmap 错误行（OpenGL 规范：不完整纹理采样按设计静默返回 (0,0,0,1)，不报错）
现象：cloud 球壳 / saturn 星环 / uranus 星环 实体纯黑；同 effect 下 saturn 行星（saturnmap.jpg RGB8）正常
```

## 场景

planets-qml（Qt3D 太阳系 demo）OHOS 移植到真机运行：

- **黑掉的实体**：earth 云层（`earthcloudmapcolortrans.png`）、saturn 星环（`saturnringcolortrans.png`）、uranus 星环（`uranusringcolortrans.png`）——三者都是 **RGBA8 alpha-PNG**（PNG colortype 6，"colortrans"=color+transparency，带 alpha 通道）。
- **正常的实体**：mercury/venus/earth/mars/jupiter/saturn/uranus/neptune 行星贴图——都是 **RGB8 JPG**（无 alpha）。
- 两者走**同一个** `PlanetMaterial.qml` 的 diffuseTexture Texture2D 块（`generateMipMaps:true` + `LinearMipMapLinear` + `maximumAnisotropy:16.0` + `Repeat`）。

**决定性对照**：saturn 行星（`shadowMapEffect` + `saturnmap.jpg` RGB8）正常 vs saturn 星环（**同一个** `shadowMapEffect` + `saturnringcolortrans.png` RGBA8）纯黑——同 effect/同 shader/同 material 类/同 mipmap 配置，唯一变量是贴图格式 RGBA8 vs RGB8。

> 用户最初报告"earth 贴图没加载、被黑色覆盖"——根因是 cloud 球壳（RGBA8 alpha-PNG）渲染纯黑、套在 earth 外面盖住了 earth。禁用 cloud 后 earth 贴图立刻显示。

## 原因

**机制（a）**：OHOS Mesa ZINK（OpenGL-over-Vulkan）实现 `glGenerateMipmap` 走 `vkCmdBlitImage`，对 **GL_RGBA8（alpha 通道）纹理的 mipmap 生成失败/产生坏 mipchain**，纹理 mipmap 不完整。配合 `minificationFilter=LinearMipMapLinear`（要求所有 mip 级定义），OpenGL 规范按设计**静默返回 (0,0,0,1) 黑色**给**所有**采样（base level 也包括）——不报 GL 错（故 hilog 干净）。

- **GL_RGB8（无 alpha，JPG）纹理的 mipmap 在同一 ZINK 正常生成**→纹理完整→正常采样→JPG 行星贴图正常。
- ZINK 把 GL_RGB8 和 GL_RGBA8 都映射到同一个 VkFormat（`VK_FORMAT_R8G8B8A8_UNORM`），所以 VkImage 创建层面无差异；RGB8/RGBA8 的不对称在 ZINK 的 **GL 级 completeness/mip-blit 层**（正是机制 a 操作处），不在 VkImage 创建。

**排除的其他假设**（像素级证据）：

| 假设 | 判别 | 结论 |
|------|------|------|
| (b) blending 没开→透明区黑 RGB 盖住 | 星环不透明区是 tan 色（RGB≈87/82/85），blend-off 也会显示 tan 带，不是纯黑 | **排除**（不是黑的成因；但 blending 缺失是独立的次要缺陷，见下） |
| (c) RGBA8 上传/VkImage 创建失败 | ZINK 把 RGB8/RGBA8 映射到同一 VkFormat，format 级失败无依据 | 低（mipmap-off 实验若仍黑才升级到此） |
| (d) PNG 解码/ICC/sRGB | cloud 无 iCCP、星环有 iCCP=sRGB，症状一致；libpng 无 iCCP 警告（2D 缩略图才有） | 排除 |
| NPOT | 星环是 1024×512 POT 也黑；earthmap2k.jpg NPOT 正常 | 排除 |
| anisotropy 16 | Qt3D 双重守卫（`gltexture.cpp:514` + `qopengltexture.cpp:4288`）缺扩展静默跳过 | 排除（不是元凶） |

**纯黑（而非彩色带+透明缺口）是关键判据**：星环不透明区有色，若仅 blending-off 会显示彩色带；纯黑说明贴图采样本身返回 0 = 不完整纹理。

## 解决方案

给 `PlanetMaterial.qml` 加一个向后兼容的 mipmap 开关属性，**只让 alpha-PNG 实体在 OHOS 关 mipmap**，JPG 行星保留 mipmap 质量：

```qml
// PlanetMaterial.qml
property bool diffuseGenerateMipMaps: true  // 默认 true（保留 upstream mipmap 行为，JPG 行星不动）

// diffuseTexture 块（绑到开关，specularTexture/normalTexture 不动——都是 RGB8 JPG，mipmap 正常）
Texture2D {
    id: diffuseTexture
    minificationFilter: root.diffuseGenerateMipMaps ? Texture.LinearMipMapLinear : Texture.Linear
    // ...
    generateMipMaps: root.diffuseGenerateMipMaps
    // ...
}

// SolarSystem.qml —— 3 个 alpha-PNG 实体（cloud + 2 星环）OHOS 关 mipmap
PlanetMaterial {
    id: materialSaturnRing
    // ...
    diffuseMap: "qrc:/images/solarsystemscope/saturnringcolortrans.png"
    diffuseGenerateMipMaps: Qt.platform.pluginName !== "ohos"  // OHOS 关 mipmap
}
```

**关键**：`generateMipMaps:false` **必须同时**把 `minificationFilter` 从 `LinearMipMapLinear` 改成 `Texture.Linear`——否则 base-level-only 纹理配 mipmap min filter 仍不完整→仍黑。

**守卫用 `Qt.platform.pluginName !== "ohos"`**（⚠️ 见注意事项）。

## 注意事项

### ⚠️ Qt.platform.os 在 OHOS 返回 "linux"，不是 "ohos"

`qsystemdetection.h:115-117` 同时定义 `Q_OS_OHOS` 和 `Q_OS_LINUX`（同 Android 模式）；`qqmlplatform.cpp` 无 `Q_OS_OHOS` 分支→落回 `Q_OS_LINUX`→`Qt.platform.os` 返回 **"linux"**。**用 `Qt.platform.os === "ohos"` 守卫会永不触发（静默 bug）**。QML 里检测 OHOS 用 `Qt.platform.pluginName === "ohos"`（QPA 插件 key 是 "ohos"，经 `Qt.platform.pluginName` 暴露）。

### blending 是独立的次要缺陷（不是黑的成因）

Qt3D 的 `PlanetEffect`/`ShadowEffect`/`SunEffect` 都注释 "no special render state => use default set of states"，**无 BlendEquation/BlendEquationArguments/NoDepthMask**。Qt3D 的 `opacity` 只是 shader uniform，**不会自动开 GL_BLEND**。故 cloud（opacity 0.2）/星环（opacity 0.4）本该半透明，实际按不透明渲染。

- 修完黑（mipmap-off）后，cloud/星环会显示贴图但**不透明**（云层会盖住 earth、星环缺口实心）。
- 要真半透明，给相关 RenderPass 加显式 blend state：
  ```qml
  // PlanetEffect.qml / ShadowEffect.qml 的 gl3 forward RenderPass
  renderStates: [
      BlendEquation { blendFunction: BlendEquation.Add },
      BlendEquationArguments {
          sourceRgb: BlendEquationArguments.SourceAlpha
          destinationRgb: BlendEquationArguments.OneMinusSrcAlpha
          sourceAlpha: BlendEquationArguments.One
          destinationAlpha: BlendEquationArguments.OneMinusSrcAlpha
      },
      NoDepthMask {}
  ]
  ```
  更便宜的 shader-only 替代：`if (texture(diffuseTexture, uv).a < 0.5) discard;`（硬切口，丢失 soft opacity）。
- cloud 在 blending 修好前应**保持禁用**（components 注释），否则不透明云层盖住 earth。

### 上游 pristine 修复策略

`PlanetMaterial.qml` / shader 与上游字节一致（仅 PlanetFrameGraph shadow-sampler 注释 + ×1000 缩放是 OHOS 必需改动）。本修复通过加 property + 实体覆盖，**不改动 upstream 共享 shader/effect 文件**，desktop 保留 mipmap 质量。星环不透明对 demo 可接受；要真半透明再上 blending 修复。

## 成果展示

| 字段 | 内容 |
|------|------|
| 领导摘要 | 沉淀 OHOS ZINK 渲染管线一个静默 bug（RGBA8 alpha 纹理 mipmap 不完整→纯黑）的复用排障方案，Qt3D/QtQuick 3D 应用移植鸿蒙可直接套用 |
| 影响面 | Qt3D 应用鸿蒙化迁移、Qt6 鸿蒙化支撑、商业 Qt 3D 应用答复 |
| 交付物 | problem 记录 + planets-qml-ohos patch（PlanetMaterial.qml + SolarSystem.qml） |
| 证据 | planets-qml-ohos 工程修复 commit、hilog 干净（失败静默无 GL 错）、真机验证星环出彩色带 |
| 可复用方式 | Qt3D/QtQuick 3D 应用在 OHOS 真机出现"贴图纯黑但光照正常、JPG 正常、只有 alpha-PNG 黑"时直接套用：alpha-PNG 实体关 mipmap |

## 相关

- 见 _lookup 速查表 — 同为 OHOS ZINK 渲染管线问题（EGL_BAD_CONFIG 12293 setSamples(4)，已用 `#ifndef Q_OS_OHOS` 守卫修）
- [[semantic-qt-harmonyos-platform-limits]] — ZINK GL 级限制补在此页的"OpenGL/ZINK 渲染"小节
- [[semantic-qt-harmonyos-project-structure]] — Qt3D 应用的 qrc/Texture2D 部署模型
