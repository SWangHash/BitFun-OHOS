---
id: fault-C-0018
cid: C-0018
type: cause
title: "Mesa ZINK 以 vkCmdBlitImage 实现 glGenerateMipmap 对 GL_RGBA8 生成失败/坏 mipchain：纹理不完整，采样静默返回黑"
nature: defect
domain: render
fault_type: bug
responsible: third-party
co_responsible: []
component: "Mesa ZINK GL→Vulkan 翻译层（glGenerateMipmap→vkCmdBlitImage 路径）× Qt3D Texture2D 采样（LinearMipMapLinear）"
severity: high
evidence_type: both
status: workaround
fix_route: "等 Mesa/ZINK 修复 RGBA8 mipmap 生成并随 OHOS SDK 图形栈更新到达，届时移除应用侧 mipmap 开关"
review_note: "Mesa 上游单未提（本库无单号；提单材料=planets-qml 对照实验现成）；Qt6 OHOS GL 路径是否仍走 ZINK 待确认；W-0015 是否需覆盖 QtQuick 3D 场景"
depends_on: []
affects_qt: ["Qt 5.12.12 (OHOS SDK，Mesa ZINK)"]
affects_ohos: ["真机 HUAWEI MateBook Fold（NEED_OPENGL=1；API 版本未记录）"]
qoh: []
first_seen: 2026-07-14
review_due: 2026-12-15
created: 2026-09-15
updated: 2026-09-15
tags: [zink, mesa, rgba8, mipmap, glgeneratemipmap, texture-incomplete, qt3d, render, black-texture, third-party, ohos]
audience: public
refs: [problem-render-black-rgba8-zink-mipmap, semantic-qt-harmonyos-platform-limits, fault-C-0001]
summary: >
  Mesa ZINK（OpenGL-over-Vulkan）用 vkCmdBlitImage 实现 glGenerateMipmap，
  对 GL_RGBA8（alpha 通道）纹理生成失败/坏 mipchain，纹理 mipmap 不完整，
  LinearMipMapLinear 采样按 GL 规范静默返回 (0,0,0,1) 黑（RGB8 正常）。
  defect/third-party（三方图形栈缺陷）；W-0015（alpha-PNG 实体关 mipmap）
  已真机验证采用，未提上游单。
---

# C-0018 ZINK RGBA8 mipmap 生成失败 → 纹理不完整采样黑

> nature: defect ｜ 责任: third-party ｜ 状态: workaround ｜ 表现: S-0017 ｜ 方案: W-0015 ｜ 跟踪: 暂无 ｜ 复核: 2026-12-15

## 表现（symptoms）

### S-0017 Qt3D alpha-PNG(RGBA8) 贴图实体渲染纯黑

planets-qml（Qt3D 太阳系 demo）OHOS 真机运行：

- **黑掉的实体**：earth 云层（`earthcloudmapcolortrans.png`）、saturn 星环
  （`saturnringcolortrans.png`）、uranus 星环（`uranusringcolortrans.png`）
  ——三者都是 **RGBA8 alpha-PNG**（PNG colortype 6，带 alpha 通道），贴图
  **纯黑**不显示（用户最初报告"earth 贴图没加载、被黑色覆盖"，实为不透明
  的黑 cloud 球壳套在 earth 外面）；Phong 光照/阴影正常；
- **正常的实体**：mercury/venus/earth/mars/jupiter/saturn/uranus/neptune
  行星贴图——都是 **RGB8 JPG**（无 alpha）；
- 两者走**同一个** `PlanetMaterial.qml` 的 diffuseTexture Texture2D 块
  （`generateMipMaps:true` + `LinearMipMapLinear` + `maximumAnisotropy:16.0`
  + `Repeat`）；
- hilog **无 GL 错误**（仅 `MESA: ZINK: SSBO is readonly in vertex stage!`，
  为来自 PlanetEffect 的 light UBO/SSBO 绑定的无关红鲱鱼）——失败完全静默；
- **决定性对照**：saturn 行星（`shadowMapEffect` + `saturnmap.jpg` RGB8）
  正常 vs saturn 星环（**同一个** `shadowMapEffect` +
  `saturnringcolortrans.png` RGBA8）纯黑——同 effect/同 shader/同 material
  类/同 mipmap 配置，唯一变量是贴图格式 RGBA8 vs RGB8。

## 根因 / 定性依据

**机制**：OHOS Mesa ZINK（OpenGL-over-Vulkan，`NEED_OPENGL=1`）实现
`glGenerateMipmap` 走 `vkCmdBlitImage`，对 **GL_RGBA8（alpha 通道）纹理的
mipmap 生成失败/产生坏 mipchain** → 纹理 mipmap 不完整 → 配合
`minificationFilter=LinearMipMapLinear`（要求所有 mip 级定义），OpenGL
规范按设计**静默返回 (0,0,0,1) 黑色**给所有采样（base level 也包括），
不报 GL 错——故 hilog 干净。

- **GL_RGB8（无 alpha，JPG）纹理的 mipmap 在同一 ZINK 正常生成** → 纹理
  完整 → 正常采样 → JPG 行星贴图正常；
- ZINK 把 GL_RGB8 和 GL_RGBA8 都映射到同一个 VkFormat
  （`VK_FORMAT_R8G8B8A8_UNORM`），故 VkImage 创建层面无差异；RGB8/RGBA8 的
  不对称在 ZINK 的 **GL 级 completeness/mip-blit 层**（正是
  glGenerateMipmap 操作处），不在 VkImage 创建。

**排除的其他假设**（像素级证据，完整版见 problems 页）：

| 假设 | 判别 | 结论 |
|------|------|------|
| blending 没开 → 透明区黑 RGB 盖住 | 星环不透明区是 tan 色（RGB≈87/82/85），blend-off 也会显示 tan 带，不是纯黑 | 排除（不是黑的成因；blending 缺失是独立次要缺陷，见关联） |
| RGBA8 上传 / VkImage 创建失败 | RGB8/RGBA8 映射同一 VkFormat，format 级失败无依据 | 低 |
| PNG 解码 / ICC / sRGB | cloud 无 iCCP、星环有 iCCP=sRGB，症状一致；libpng 无 iCCP 警告 | 排除 |
| NPOT 纹理 | 星环 1024×512 POT 也黑；earthmap2k.jpg NPOT 正常 | 排除 |
| anisotropy 16 | Qt3D 双重守卫（`gltexture.cpp:514` + `qopengltexture.cpp:4288`）缺扩展静默跳过 | 排除 |

**纯黑（而非彩色带+透明缺口）是关键判据**：星环不透明区有色，若仅
blending-off 会显示彩色带；纯黑说明贴图采样本身返回 0 = 不完整纹理。

**证据形态**：planets-qml-ohos 真机工程 + 上述同 effect 单变量对照实验
（demo 级）；hilog 判读（无 GL 错的静默失败 + 红鲱鱼识别）（logs 级）
→ both。

## 责任判定

`third-party`（Mesa/ZINK 三方图形栈）：缺陷位于 ZINK 的 GL→Vulkan 翻译层
——mipmap blit 对带 alpha 的 GL 格式不对称（RGBA8 失败、RGB8 正常）。
Qt 侧无责：Qt3D 的 `generateMipMaps:true + LinearMipMapLinear` 是合法且
桌面 GL 正常的配置。OHOS 侧无责：Vulkan 层行为正常，缺陷在 GL 翻译层，
不在系统 Vulkan 实现。修复到达路径：Mesa 版本（随 OHOS SDK 图形栈更新）。

## 根治方案（defect）

等 Mesa/ZINK 修复 RGBA8 的 `glGenerateMipmap`（`vkCmdBlitImage` 路径）。
提单材料现成：planets-qml 对照实验（同 effect 唯一变量贴图格式）+ 静默
复现判据 + 源码路径定位；尚未向 Mesa bugzilla 提交（无单号记录，未编造）。

## 临时方案（Workarounds）

- **W-0015（adopted，2026-07-14 真机验证）**：OHOS 上给 alpha-PNG 实体关
  mipmap——`PlanetMaterial.qml` 加向后兼容开关属性，只让 alpha-PNG 实体在
  OHOS 关 mipmap，JPG 行星保留 mipmap 质量：

  ```qml
  // PlanetMaterial.qml
  property bool diffuseGenerateMipMaps: true  // 默认 true（upstream 行为不动，JPG 行星不动）

  // diffuseTexture 块（绑到开关；specular/normalTexture 不动——都是 RGB8 JPG）
  Texture2D {
      id: diffuseTexture
      minificationFilter: root.diffuseGenerateMipMaps ? Texture.LinearMipMapLinear : Texture.Linear
      generateMipMaps: root.diffuseGenerateMipMaps
  }

  // SolarSystem.qml —— 3 个 alpha-PNG 实体（cloud + 2 星环）OHOS 关 mipmap
  PlanetMaterial {
      id: materialSaturnRing
      diffuseMap: "qrc:/images/solarsystemscope/saturnringcolortrans.png"
      diffuseGenerateMipMaps: Qt.platform.pluginName !== "ohos"  // OHOS 关 mipmap
  }
  ```

  **三个关键点**：

  1. `generateMipMaps:false` **必须同时**把 `minificationFilter` 从
     `LinearMipMapLinear` 改成 `Texture.Linear`——否则 base-level-only 纹理
     配 mipmap min filter 仍不完整 → 仍黑；
  2. QML 守卫必须用 `Qt.platform.pluginName !== "ohos"`——`Qt.platform.os`
     在 OHOS 返回 "linux"，用 os 判断会永不触发（静默失效，见
     [C-0001](C-0001-qqmlplatform-os-ohos-branch.md)）；
  3. 通过 property + 实体覆盖实现，**不改动 upstream 共享 shader/effect
     文件**，desktop 保留 mipmap 质量（pristine 修复策略）。

  代价：alpha-PNG 实体失去 mipmap（minification 质量降：远处纹理混叠）；
  需按实体粒度加开关。退役条件：Mesa ZINK 修复 RGBA8 mipmap 生成并随所用
  OHOS SDK 到达后，移除 `diffuseGenerateMipMaps` 开关、恢复 upstream
  mipmap 行为并回归验证。

## 跟踪单（Tickets）

暂无。Mesa bugzilla 未提单（源页与 platform-limits 页均无单号记录）；若
后续提交，复现材料用 planets-qml 对照实验。

## 版本验证记录

| 日期 | 环境（Qt/OHOS） | 动作 | 结果 | 状态变化 |
|------|----------------|------|------|---------|
| 2026-07-14 | Qt 5.12.12 OHOS SDK / HUAWEI MateBook Fold 真机 / Mesa ZINK（NEED_OPENGL=1） | planets-qml 真机复现：同 effect 下 RGB8 JPG 行星正常 vs RGBA8 alpha-PNG（cloud + 2 星环）纯黑，唯一变量贴图格式；hilog 无 GL 错（静默失败） | 定性成立（ZINK GL 翻译层缺陷，third-party） | → diagnosed |
| 2026-07-14 | 同上 | 应用 W-0015（alpha-PNG 实体关 mipmap + Texture.Linear，pluginName 守卫） | 星环出彩色带，贴图正常显示 | → workaround |

## 关联

- 症状（S）：S-0017
- 临时方案（W）：W-0015
- 跟踪单（T）：暂无
- problems：[render-black-rgba8-zink-mipmap](../problems/render-black-rgba8-zink-mipmap.md)
- semantic：[qt-harmonyos-platform-limits](../semantic/qt-harmonyos-platform-limits.md) §OpenGL/ZINK 渲染
- 相关根因（C）：[C-0001](C-0001-qqmlplatform-os-ohos-branch.md)（无 depends_on 关系；W-0015 的 QML 守卫写法因其绕开 `Qt.platform.os` 判断）
- 备注：透明实体（`opacity<1`）还需显式
  `BlendEquation`+`BlendEquationArguments`+`NoDepthMask` RenderState——Qt3D
  的 `opacity` 只是 shader uniform，不会自动开 GL_BLEND。该行为跨平台一致
  （非 OHOS 特有），不单独建档；详见 problems 页注意事项。
