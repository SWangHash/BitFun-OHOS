---
id: agent-task-routing
type: meta
domain: workflow
tags: [agent, routing, task-types, workflow, decision-tree]
created: 2026-06-27
updated: 2026-09-23
status: active
refs: [agent-mesh, semantic-qt-harmonyos-golden-rules, procedural-demo-generation]
summary: >
  开发者任务路由表：按用户请求匹配任务类型，确定必读页与工作流。
  覆盖移植、API/模块/平台限制查询、构建排障、窗口、生命周期、问题分析、
  修复验证、Qt6、三方库、工具链、Demo 生成等场景。Agent 接到任务后首先扫描此页。
---

# 任务路由表

> **使用方式**：收到请求后，先匹配下方路由树，确定任务类型，然后按"必读页"加载上下文、按"工作流"执行。

> **多 agent 协作模式**：任务台账 / 移交信封（ho-\*.yaml）/ 流转日志（flow.jsonl）/ 人工接入点契约见
> [_agent-mesh](_agent-mesh.md)；本表即 task-dispatcher 的路由核心。单 agent 场景忽略此注记。

---

## 路由决策树

```
用户请求
    │
    ├─ "移植/迁移/鸿蒙化一个应用" ──────────→ [A] 应用移植
    ├─ "自动迁移/一键迁移/跑一遍迁移" ─────→ [P] 自动迁移（执行层）
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
    ├─ "Qt+CEF demo / WebEngine 迁移 demo" ─→ [Q] Demo 生成（+ qt-cef-ohos-dev-guide）
    ├─ "写个demo/生成测试工程/渲染demo" ──→ [Q] Demo 生成
    ├─ "某问题修了吗/未解决问题/临时方案" ─→ [R] 故障跟踪
    └─ "编译Qt/打补丁/出SDK版本/上游演进" → [S] SDK 工程
```

---

## 路由详情

### [A] 应用移植

**触发词**：移植、迁移、鸿蒙化、porting、migration

| 项目 | 内容 |
|------|------|
| **工作流** | `procedural/qt-app-harmonyos-migration.md` |
| **必读页** | ① `golden-rules.md` ② `porting-workflow.md`（8 步决策树）③ `portgraph/docs/deps-report.md`（仓库工具，依赖角色/版本范围）+ `portgraph/docs/fetch-deps.md`（依赖闭包产物） |
| **按需加载** | `api-mapping.md`、`code-patterns.md`、`window-model.md`、`lifecycle.md`、`project-structure.md`、`third-party-libs.md` |
| **预期输出** | **第 0 步 portgraph 可行性评估**（analyze + deps + fetch-deps --dry-run：portable/blocked/uncertain + 依赖角色分类/版本要求校验 + bottle 数/源码编译缺口）→ 工程创建 → 8 步迁移 → 编译验证 |

> **第 0 步门禁（与 [P] 的 assess 对齐）**：接到应用移植任务先跑
> `python portgraph/portgraph.py analyze <app>`、`deps <app>` 与
> `fetch-deps <app> --dry-run`。
> 依赖 ≥3 个三方库时禁止人工逐个判断可行性，以闭包分析输出为准；blocked 需研判
> blockers 的 guard 证据（无条件 ohos-active 命中且核心路径才是硬阻塞，可选分支放行）；
> unknowns 即源码编译缺口清单，要**明确逐项告知用户**。
> 反例实证（2026-09，某 68 依赖大型应用）：首轮人工逐个判断依赖直接绕开闭包分析，
> 走了弯路后 portgraph 闭包分析一次给出 59 bottle + 9 源码编译的解，
> 避免了按全源码交叉编译的错误路径。

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
| **按需加载** | `qt6-status.md`（如问 Qt6 模块）；`qt-cef-ohos-dev-guide.md`（如问 QtWebEngine——Out of scope，CEF for OpenHarmony 是完整 Chromium 平替，含 WebEngine→CEF API 映射 + 迁移方案 + CEF 组件包去版本化/剥离） |
| **预期输出** | 模块是否支持 + 替代方案（如不支持：QtWebEngine→`qt-cef-ohos-dev-guide.md` CEF 平替；轻量展示可先用 Qt WebView 原生桥） |

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
| **必读页** | ① `golden-rules.md` §一（B1-B12） ② `project-structure.md` |
| **按需加载** | `build.md`（Qt 编译）、`third-party-libs.md`（三方库编译）、`problems/_lookup.md`（已知错误） |
| **预期输出** | 错误分类 → 根因 → 修复步骤 |

### [F] 窗口问题

**触发词**：窗口、对话框、全屏、浮窗、tagging、setMask、hide、最小化

| 项目 | 内容 |
|------|------|
| **必读页** | ① `golden-rules.md` §二（W1-W6） ② `window-model.md` |
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
| **必读页** | ① `ohos-extras.md`（145+ API） |
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

### [P] 自动迁移（Execution Plane）

**触发词**：自动迁移、一键迁移、跑一遍迁移、鸿蒙化这个项目、验证迁移结果、分析构建/运行日志

| 项目 | 内容 |
|------|------|
| **工作流** | `skills/qt-app-porting/SKILL.md`（统一 CLI：`tools/qt-ohos-run.py`） |
| **必读页** | ① `golden-rules.md` ② `skills/qt-app-porting/SKILL.md` |
| **按需加载** | 风险发现与日志命中自带的 `kb`/`refs` 字段（R*.yaml / QOH*.yaml 机器条目直链知识页） |
| **预期输出** | 可行性评估（assess：portable/blocked/uncertain，`knowledge/adaptation/` 三库驱动）→ 风险报告 → 迁移计划 → 壳工程自动生成（templates/qt-ohos-app）→ 受追踪修改（.qt-ohos/patches）→ 编译/打包/装机/启动 → G0-G12 门禁判定 → 报告 + 知识草稿（draft→promote 闭环） |

> 端到端数据流：`app → scan → assess → plan → project_generation → patch → compile → package → install → launch → smoke → verify → report → draft → promote → 索引再生成 → kb-release 发布`。assess 为迁移第 0 步：blocked 即止并出报告（`assessment.json`）。

> 关键约束：成功与否只以 `qt-ohos-run verify` 的门禁结果为准（LLM 负责推理，tool 负责事实）。
> 机器知识：`knowledge/rules/`（18 条预扫描规则）、`knowledge/errors/`（42 条错误模式，对应 problems/）。

### [Q] Demo 生成

**触发词**：写个 demo、生成 demo、测试工程、渲染 demo、功能 demo、demo 项目、CEF demo、WebEngine demo

| 项目 | 内容 |
|------|------|
| **工作流** | `procedural/demo-generation.md`（六步闭环） |
| **必读页** | ① 工作流本身 |
| **按需加载** | `project-structure.md`（鸿蒙工程）、`build.md`（编译配置）；`qt-cef-ohos-dev-guide.md`（Qt+CEF / WebEngine 迁移 demo——鸿蒙无 WebEngine，用 CEF；嫁接脚本随 CEF 组件包分发，不在本知识库，用法见 dev-guide §2.3/§5） |
| **预期输出** | 需求理解 → 技术设计 → 工程创建 → 代码编写 → 编译验证 → 文档沉淀；Qt+CEF demo 按 `qt-cef-ohos-dev-guide.md` §2.3 嫁接流程 |

### [R] 故障跟踪

**触发词**：修了吗、已解决、未解决、已知问题、known issue、临时方案、workaround、跟进状态、新版本是否修复、故障状态

| 项目 | 内容 |
|------|------|
| **必读页** | ① `faults/_registry.md` §症状索引（按表现→根因）② `faults/_graph.yaml`（机读全量图，一次加载） |
| **按需加载** | 命中的根因 C 页（defect：修复版本/临时方案 W；limitation：替代方案 W/演进）；`faults/_index.md`（四实体图模型与状态机）；对应 `problems/` 页（解法细节）；`procedural/framework-fix-verification.md`（要验证修复时） |
| **工具** | `python tools/faults-build.py review`（复核到期扫描+状态推进）；修改真源后 `build` 重建派生物 |
| **预期输出** | 定性（缺陷待修 / 规格限制）+ 责任领域 + 临时方案或替代方案（W，含退役条件）+ 跟踪单状态与修复版本（T.fix_version）或演进/复核计划 |

### [S] SDK 工程（Execution Plane）

**触发词**：编译 Qt、重编 Qt、打补丁、应用修改方案、出 SDK 版本、发布 SDK、切换/回滚 SDK 版本、上游演进、检查上游更新、维护本地 SDK

| 项目 | 内容 |
|------|------|
| **工作流** | `skills/qt-sdk-forge/SKILL.md`（统一 CLI `tools/qt-sdk-run.py` 已实现：init/env/src-clone/status/patch-*/configure/build/install/verify/smoke-mark/release/release-list/use/diff/upstream-check/forge/resume，Python 原生跨平台） |
| **必读页** | ① `semantic/qt-harmonyos-build.md`（configure 参数/增量编译三坑）② `procedural/framework-issue-analysis.md` §4.3-4.5（patch 生成与清理铁律）③ `skills/qt-sdk-forge/SKILL.md` |
| **按需加载** | `procedural/framework-fix-verification.md`（修复验证）、`problems/_lookup.md`（编译报错）、`faults/_registry.md`（补丁关联根因）、`skills/kb-init/references/qt-compile-guide.md`（编译故障排除） |
| **预期输出** | 修改方案评审 → 补丁应用（登记溯源）→ 编译 install → SV0-SV8 门禁判定 → 版本发布（manifest+SHA256）→ ENV.local.md 同步；定期产出上游《演进报告》+ 补丁 superseded 复核 + faults review 联动 |

> 与 [P] 的关系：[P]（qt-app-porting）不重编 Qt 框架——需要重编验证/带补丁出版本时转入本路由；
> 本路由产出的 SDK 版本被 [P] 消费（`qt_sdk_prefix` 配置项）。
> "新版本是否修复了某问题"（[R]）需要重编验证走 SDK 时，也路由到此处。

---

## 模糊请求处理

当请求不明确匹配任何类型时：

1. **先扫描 `golden-rules.md`** — 35 条铁律覆盖最常见场景
2. **询问澄清** — 提供 3 个最可能的选项
3. **如果涉及多个类型** — 按 [A] 应用移植 的流程编排，它会自动调用其他类型

### 常见模糊请求示例

| 用户说 | 实际类型 | 路由 |
|--------|---------|------|
| "帮我把这个 Qt 项目迁移到鸿蒙（要你执行）" | [P] 自动迁移 | 跑 `tools/qt-ohos-run.py scan/plan/patch/verify`，按 `skills/qt-app-porting/SKILL.md` |
| "这个应用在鸿蒙上跑不起来" | [E] 构建排障 或 [A] 移植 | 先问：是新移植还是已有工程？ |
| "鸿蒙和 Android 有什么区别" | [D] 平台限制 + [G] 生命周期 | 加载 platform-limits + lifecycle |
| "帮我看看这个代码怎么改" | [B] API 替换 | 加载 api-mapping + code-patterns |
| "鸿蒙上能用什么数据库" | [C] 模块 + [M] 三方库 | 先查 Qt SQL 模块，再查 SQLite 三方库 |
| "这个问题在鸿蒙是已知问题吗/修了吗" | [R] 故障跟踪（+ [E]/[D] 判定） | 先查 `faults/_registry.md`，再查 `problems/_lookup.md` |
