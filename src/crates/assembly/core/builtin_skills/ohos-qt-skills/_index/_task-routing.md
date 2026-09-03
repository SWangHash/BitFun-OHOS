---
id: agent-task-routing
type: meta
domain: workflow
tags: [agent, routing, task-types, workflow, decision-tree]
created: 2026-06-27
updated: 2026-08-25
status: active
refs: [semantic-qt-harmonyos-golden-rules, procedural-demo-generation]
summary: >
  开发者任务路由表：按用户请求匹配任务类型，确定必读页与工作流。
  覆盖移植、API/模块/平台限制查询、构建排障、窗口、生命周期、问题分析、
  修复验证、Qt6、三方库、工具链、Demo 生成等场景。Agent 接到任务后首先扫描此页。
---

# 任务路由表

> **使用方式**：收到请求后，先匹配下方路由树，确定任务类型，然后按"必读页"加载上下文、按"工作流"执行。

---

## 路由决策树

```
用户请求
    │
    ├─ "移植/迁移/鸿蒙化一个应用" ──────────→ [A] 应用移植
    ├─ "这个 API 在鸿蒙上怎么替换" ───────→ [B] API 替换查询
    ├─ "某个 Qt 模块是否支持鸿蒙" ──────────→ [C] 模块支持查询
    ├─ "鸿蒙有什么限制/不能做什么" ──────────→ [D] 平台限制查询
    ├─ "编译失败/构建报错/部署不了" ─────────→ [E] 构建排障
    ├─ "窗口显示异常/对话框行为不对" ──────→ [F] 窗口问题
    ├─ "生命周期/closeEvent/接续/分享" ────→ [G] 生命周期
    ├─ "QtOhosExtras 怎么用/某个函数" ────→ [H] QtOhosExtras API
    ├─ "Qt6 相关" ─────────────────────────→ [L] Qt6 状态
    ├─ "三方库/依赖/交叉编译" ────────────→ [M] 三方库
    ├─ "DevEco/MCP/工具链" ──────────────→ [N] 工具链
    └─ "写个demo/生成测试工程/渲染demo" ──→ [Q] Demo 生成
```

---

## 路由详情

### [A] 应用移植

**触发词**：移植、迁移、鸿蒙化、porting、migration

| 项目 | 内容 |
|------|------|
| **工作流** | `procedural/qt-app-harmonyos-migration.md` |
| **必读页** | ① `golden-rules.md` ② `porting-workflow.md`（8 步决策树） |
| **按需加载** | `api-mapping.md`、`code-patterns.md`、`window-model.md`、`lifecycle.md`、`project-structure.md`、`third-party-libs.md`、`fetch-qt-ohos-sdk.md`（无 Qt SDK/模板时） |
| **预期输出** | 可行性评估 → 工程创建 → 8 步迁移 → 编译验证 |

### [B] API 替换查询

**触发词**：API、替换、替代、怎么改、QProcess、chmod、symlink

| 项目 | 内容 |
|------|------|
| **必读页** | ① `api-mapping.md`（12 类映射表） |
| **按需加载** | `code-patterns.md`（Before/After 代码）、`platform-limits.md`（如 API 被平台限制） |
| **预期输出** | 具体的替换方案 + 代码示例 |

### [C] 模块支持查询

**触发词**：模块、支持、QtWebEngine、QtMultimedia、模块状态

| 项目 | 内容 |
|------|------|
| **必读页** | ① `modules.md` |
| **按需加载** | `qt6-status.md`（如问 Qt6 模块） |
| **预期输出** | 模块是否支持 + 版本（5.12/5.15）+ 替代方案（如不支持） |

### [D] 平台限制查询

**触发词**：限制、不能、禁止、chmod、symlink、dlopen、沙箱

| 项目 | 内容 |
|------|------|
| **必读页** | ① `platform-limits.md` |
| **按需加载** | `golden-rules.md` §四（P1-P5） |
| **预期输出** | 限制描述 + QTBUG 编号 + Workaround |

### [E] 构建排障

**触发词**：编译失败、构建报错、find_package、部署不了、dlopen failed、黑屏

| 项目 | 内容 |
|------|------|
| **工作流** | `build-run-workflow.md` §构建失败排查四步法 |
| **必读页** | ① `golden-rules.md` §一（B1-B11） ② `project-structure.md` |
| **按需加载** | `build.md`（Qt 编译）、`third-party-libs.md`（三方库编译）、`problems/_lookup.md`（已知错误） |
| **预期输出** | 错误分类 → 根因 → 修复步骤 |

### [F] 窗口问题

**触发词**：窗口、对话框、全屏、浮窗、tagging、setMask、hide、最小化

| 项目 | 内容 |
|------|------|
| **必读页** | ① `golden-rules.md` §二（W1-W5） ② `window-model.md` |
| **按需加载** | `code-patterns.md` §模式 3（对话框） |
| **预期输出** | 规则说明 + 修复代码 |

### [G] 生命周期

**触发词**：closeEvent、Ability、生命周期、接续、分享、Want、argv、深色模式

| 项目 | 内容 |
|------|------|
| **必读页** | ① `lifecycle.md`（金标准） |
| **按需加载** | `golden-rules.md` §五（L1-L4）、`ohos-extras.md`（相关 API） |
| **预期输出** | 行为说明 + 代码示例 + 枚举路径 |

### [H] QtOhosExtras API

**触发词**：QtOhosExtras、startAbility、QOhosWant、QOhosAppContext、ShareKit

| 项目 | 内容 |
|------|------|
| **必读页** | ① `ohos-extras.md`（~36 APIs） |
| **按需加载** | `lifecycle.md`（使用示例）、`golden-rules.md` §三（A1-A6） |
| **预期输出** | API 签名 + 用途 + 使用示例 |

### [L] Qt6 状态

**触发词**：Qt6、Qt 6、qtbase dev

| 项目 | 内容 |
|------|------|
| **必读页** | ① `qt6-status.md` |
| **按需加载** | `overview.md`、`build.md` §Qt6 |
| **预期输出** | 当前状态 + 已知差异 + 待验证项 |

### [M] 三方库

**触发词**：三方库、依赖、交叉编译、vcpkg、OpenSSL、boost、zlib

| 项目 | 内容 |
|------|------|
| **必读页** | ① `third-party-libs.md` |
| **按需加载** | `project-structure.md`（部署目录）、`platform-limits.md`（影响三方库的限制） |
| **预期输出** | 交叉编译方法 / 部署步骤 / 兼容性评估 |

### [N] 工具链

**触发词**：DevEco、MCP、工具链、hdc、DevEco Studio

| 项目 | 内容 |
|------|------|
| **必读页** | ① [[ohos-common-kb/procedural/deveco-cli-usage-rules|common：DevEco CLI 使用规则]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/procedural/deveco-cli-usage-rules.md)） ② [[ohos-common-kb/semantic/deveco-mcp-capabilities|common：DevEco MCP 能力边界]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/deveco-mcp-capabilities.md)） |
| **按需加载** | [[ohos-common-kb/semantic/harmonyos-development-fundamentals|common：HarmonyOS 开发基础]]（[standalone](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills/blob/main/ohos-common-kb-public/semantic/harmonyos-development-fundamentals.md)）、[[qt-harmonyos-build-run-workflow]] |
| **预期输出** | 安装/配置步骤 |

### [Q] Demo 生成

**触发词**：写个 demo、生成 demo、测试工程、渲染 demo、功能 demo、demo 项目

| 项目 | 内容 |
|------|------|
| **工作流** | `procedural/demo-generation.md` |
| **必读页** | ① 工作流本身（六步闭环） |
| **按需加载** | `project-structure.md`（鸿蒙工程）、`build.md`（编译配置） |
| **预期输出** | 需求理解 → 技术设计 → 工程创建 → 代码编写 → 编译验证 → 文档沉淀 |

---

## 模糊请求处理

当请求不明确匹配任何类型时：

1. **先扫描 `golden-rules.md`** — 33 条铁律覆盖最常见场景
2. **询问澄清** — 提供 3 个最可能的选项
3. **如果涉及多个类型** — 按 [A] 应用移植 的流程编排，它会自动调用其他类型

### 常见模糊请求示例

| 用户说 | 实际类型 | 路由 |
|--------|---------|------|
| "这个应用在鸿蒙上跑不起来" | [E] 构建排障 或 [A] 移植 | 先问：是新移植还是已有工程？ |
| "鸿蒙和 Android 有什么区别" | [D] 平台限制 + [G] 生命周期 | 加载 platform-limits + lifecycle |
| "帮我看看这个代码怎么改" | [B] API 替换 | 加载 api-mapping + code-patterns |
| "鸿蒙上能用什么数据库" | [C] 模块 + [M] 三方库 | 先查 Qt SQL 模块，再查 SQLite 三方库 |
