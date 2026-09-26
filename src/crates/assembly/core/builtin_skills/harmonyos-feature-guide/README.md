# HarmonyOS 创新特性开发指南 Skill

为 AI 编程助手提供鸿蒙 70+ 创新特性的开发指南和 API 参考，让 AI 在编码时能准确引导你接入鸿蒙平台能力。

## 它能做什么

当你在开发鸿蒙应用时想要接入平台创新特性，这个 Skill 会帮助 AI：

- **精准匹配特性** -- 你用日常说法描述需求（如"我想做个扫码功能"），AI 能自动匹配到正确的鸿蒙特性编号和官方文档
- **提供官方开发资源链接** -- 每个特性都附带华为开发者官网的开发指南和 API 参考链接，AI 会优先获取这些内容指导开发
- **按分类浏览** -- 支持按 2C 分类（简单易用 / 原生智能 / 极致流畅 / 全场景协同 / 高端精致 / 纯净安全）查找相关特性
- **按 Kit 查找** -- 知道 Kit 名称（如 Scan Kit、Share Kit）即可定位到对应特性

## 涵盖的 70+ 特性一览

| 分类 | 特性 |
|------|------|
| **简单易用** | 百米扫码、锁屏卡片、鸿蒙振感、统一文件下载、扫码直达、服务卡片、统一链接跳转、VOIP一键接听、日历、扫码能力开放、PC一步直达、统一文件预览、手写体验、统一拖拽、智慧多窗-应用内分屏、智慧多窗-画中画、实况窗 |
| **原生智能** | 应用智能体、意图框架、智能填充、AR空间计算、AR高精几何重建、AI算力开放、左右手感知、智能图文提取、文档扫描、卡证识别、朗读、AI字幕、长隧道车道级定位、智感支付、回旋镖、ArkData向量数据库、智能图片picker |
| **极致流畅** | 网络上行加速、弱网感知、TaskPool任务池、LTPO可变帧率、低时延编解码、小视频流畅、FFRT并行加速、音频低时延通路、Ascend C自定义算子 |
| **全场景协同** | 隔空传送、碰一碰、跨设备剪贴板、应用接续、服务互通、手机车机导航流转、无线投屏 |
| **高端精致** | 3DGS渲染、大图预览画中画、互动卡片、云镜-红枫直播、拍照一致性、鸿蒙vivid、视频超分辨率、MovingPhoto、一镜到底 |
| **纯净安全** | 通行密钥、数字盾、机主本人认证、安全摄像头、安全检测、DLP数据保护、设备真实性证明、通用密钥管理、Asset敏感资产存储、匿名设备查询、未成年人模式 |

## Skill 文件结构

```
harmonyos-feature-guide/
├── SKILL.md              # Skill 入口文件（含 frontmatter 触发描述 + 特性表 + 模糊匹配提示）
├── features.json         # 70+ 特性详细数据（名称、描述、Kit、分类、开发指南URL、API参考URL、关键词）
├── keywords_map.json     # 关键词 → 特性编号映射（支持模糊匹配）
├── kit_map.json          # Kit名称 → 特性编号映射
├── category_map.json     # 2C分类 → 特性编号映射
└── README.md             # 本文件
```

## 使用方法

### 方式一：作为 AI Agent Skill 使用（推荐）

将本 Skill 目录放置到 AI 编程工具的 skills 目录下，AI 会在你提到相关需求时自动加载。

**适用于支持 skills 机制的 AI 工具**（如 OpenCode、BitFun 等）：

将整个 `harmonyos-feature-guide` 目录复制到 skills 路径：

```bash
# 全局安装（所有项目生效）
cp -r harmonyos-feature-guide ~/.agents/skills/

# 或项目级安装（仅当前项目生效）
cp -r harmonyos-feature-guide .agents/skills/
```

放置后无需手动操作，AI 会在对话中根据你提到的关键词自动触发并加载 Skill 内容。

### 方式二：在 Claude Code 中使用

Claude Code 支持通过 `~/.claude/skills/` 目录加载 Skill：

```bash
cp -r harmonyos-feature-guide ~/.claude/skills/
```

放置后，当你提出鸿蒙特性相关需求时，Claude Code 会自动识别并加载该 Skill。例如：

```
> 我想在鸿蒙应用里加一个扫码功能，能扫二维码跳转到对应页面

Claude Code 会自动触发 harmonyos-feature-guide skill，
匹配到 #8 百米扫码、#35 扫码直达、#50 扫码能力开放，
并提供 Scan Kit 的开发指南和 API 参考链接。
```

### 方式三：在 OpenAI Codex CLI 中使用

Codex CLI 通过 `AGENTS.md` 或项目 instructions 文件接收指引。将 Skill 内容整合进项目的 `AGENTS.md`：

```bash
# 在项目根目录创建或编辑 AGENTS.md
# 将 SKILL.md 的核心内容（特性表 + 模糊匹配提示）粘贴进去
```

或者更直接的方式 -- 在 Codex CLI 的 `instructions` 配置中引用 Skill 文件：

```bash
# 方法 A：在项目根目录的 AGENTS.md 中添加指引
cat >> AGENTS.md << 'EOF'

## 鸮鸿创新特性开发

当用户需要接入鸿蒙创新特性时，请参考 resources/skills/harmonyos-feature-guide/SKILL.md 中的特性表和模糊匹配提示，
优先获取官方开发指南链接内容来指导开发。

EOF

# 方法 B：使用 codex --instructions 参数直接指定
codex --instructions ./resources/skills/harmonyos-feature-guide/SKILL.md "帮我接入鸿蒙扫码功能"
```

### 方式四：在任意 AI 对话中手动引用

如果你使用的 AI 工具不支持 skills 自动加载机制，可以手动将 `SKILL.md` 内容作为上下文提供给 AI：

```
请先阅读以下鸿蒙创新特性开发指南，然后帮我实现扫码功能：

[粘贴 SKILL.md 的全部内容]

我想做一个远距离扫码直达的功能，用户扫码后直接跳转到服务页面。
```

## 使用示例

### 示例 1：接入扫码功能（Claude Code）

```
用户：我想在鸿蒙应用中实现扫码功能，能识别二维码并跳转

AI（自动加载 Skill）：
  匹配到以下特性：
  - #8 百米扫码 (Scan Kit) -- 50cm二维码百米距离扫码直达
  - #35 扫码直达 (Scan Kit) -- 系统入口扫码直达应用服务页面
  - #50 扫码能力开放 (Scan Kit) -- 统一扫码服务，扫得快、准、远

  推荐使用 #50 扫码能力开放，开发指南：
  https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/scan-introduction-V5

  [基于官方文档内容提供具体实现代码和步骤]
```

### 示例 2：接入画中画功能（Codex CLI）

```
$ codex "我的视频播放应用要支持画中画，最小化后小窗继续播放"

AI：
  匹配到 #69 智慧多窗-画中画 (ArkUI)
  开发指南：https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/window-pipwindow

  实现步骤：
  1. 在 module.json5 中声明 pip 窗口权限
  2. 使用 PiPWindow API 创建画中画窗口
  3. 处理 PiP 控制按钮的回调事件
  ...
```

### 示例 3：按分类探索特性（任意 AI 工具）

```
用户：我的鸿蒙应用想提升用户体验，有哪些"简单易用"类的能力可以接入？

AI：
  "简单易用"分类下共有 17 个特性：
  - 百米扫码、锁屏卡片、鸿蒙振感、统一文件下载、扫码直达、
    服务卡片、统一链接跳转、VOIP一键接听、日历、扫码能力开放、
    PC一步直达、统一文件预览、手写体验、统一拖拽、
    智慧多窗-应用内分屏、智慧多窗-画中画、实况窗

  你对哪个特性感兴趣？我可以提供详细的接入指南。
```

### 示例 4：模糊匹配（Claude Code）

```
用户：我想做一个震动反馈，按钮点击时有手感

AI（自动匹配）：
  匹配到 #21 鸿蒙振感 (Sensor Service Kit)
  开发指南：https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/vibrator-V5

  用户说的"震动反馈"对应 Skill 中的"振感/马达/震动"关键词，
  精确匹配到鸿蒙振感特性。
```

## 适用场景

- 你知道功能需求但不知道该用哪个鸿蒙 Kit
- 你想按分类系统性地了解鸿蒙平台能力
- 你提到一个通俗说法（如"碰一碰传文件"），需要找到官方 API
- 你需要鸿蒙特性的官方开发指南链接

## 不适用场景

本 Skill **不覆盖**以下内容：

- 基础 ArkUI 组件用法（Column / Row / Stack 布局等）
- ArkTS 语法错误修复
- 项目创建和配置
- 通用 UI 开发问题

这些场景请直接查阅鸿蒙官方开发文档或使用通用编程辅助。