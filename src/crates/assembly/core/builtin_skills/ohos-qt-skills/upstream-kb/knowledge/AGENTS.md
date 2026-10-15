# AGENTS.md

本文件指导 AI 工具（Claude Code / Codex / Cursor 等）使用本知识库（`CLAUDE.md` 为本地等价副本，由本文件复制生成）。

> **这是一份 Qt for HarmonyOS 移植参考知识库**，面向进行 Qt 应用鸿蒙化与 Qt 应用问题分析的开发者。
> 它由一个更大的个人工作流知识库裁剪、脱敏后生成（开发者版）。

---

## 首次使用（Agent 必读）

如果用户是第一次使用本知识库，或 `ENV.local.md` 不存在，**必须**先执行 `skills/kb-init/SKILL.md` 完成初始化。

初始化 skill 会引导用户完成：
- 检测当前环境（DevEco Studio、HarmonyOS SDK、Qt 源码等）
- 引导安装缺失依赖
- 生成 `ENV.local.md`（本地路径配置）
- 验证环境可用

**触发关键词**：用户说"初始化"、"配置环境"、"第一次使用"、"ENV.local.md 不存在"时，自动执行初始化 skill。

---

## 知识库结构

```
_index/      → 索引层（知识地图 _map、标签 _tags、仪表盘 _dashboard、任务路由 _task-routing）
semantic/    → 语义知识：技术概念、API 参考、平台限制、模块状态、构建/工程
procedural/  → 程序知识：工作流（应用迁移、问题分析、修复验证、Demo 生成）
episodic/    → 情景知识：实际移植项目复盘
problems/    → 错误知识库：实际编译/部署/运行时报错与解决方案
faults/      → 故障库（图模型 S 症状/C 根因/W 临时方案/T 跟踪单）：真源 _data/ + C 页，_graph.yaml/_registry.md 由 tools/faults-build.py 自动重建
ohos-common-kb-public/ → 内嵌的 HarmonyOS 平台通用知识（ArkTS、ArkUI、NAPI、Stage 模型等）
skills/      → Agent skills（自动化脚本和工具）
```

## 快速开始（Agent 必读）

**接到任务后，按此顺序加载**：

```
① 检查 ENV.local.md 是否存在 → 不存在则执行 skills/kb-init/SKILL.md
② _index/_task-routing.md    → 匹配任务类型，确定工作流和必读页
③ semantic/qt-harmonyos-golden-rules.md  → 扫描 35 条铁律（避免已知陷阱）
④ _index/_map.md             → 知识地图，按 summary 判断相关性
⑤ 只读相关的知识页           → 不要全量加载
⑥ 沿 refs 字段追踪交叉引用    → 获取深度上下文
```

**五个核心页面**：

| 页面 | 作用 |
|------|------|
| `skills/kb-init/SKILL.md` | 初始化 skill：环境检测、依赖安装、ENV.local.md 生成 |
| `_index/_dashboard.md` | 仪表盘：计数、分域统计、使用建议入口 |
| `_index/_task-routing.md` | 任务路由：用户请求 → 任务类型 → 必读页 |
| `semantic/qt-harmonyos-golden-rules.md` | 35 条铁律速查（构建/窗口/API/限制/生命周期/跨平台） |
| `_index/_map.md` | 知识地图：每页一句话摘要 |

## 按场景入口

| 我想做... | 读哪些页 |
|----------|---------|
| 移植 Qt 应用到鸿蒙 | **第 0 步 portgraph 可行性评估**（`python portgraph/portgraph.py analyze <app>` + `deps <app>`（依赖角色/版本范围分类，见 `portgraph/docs/deps-report.md`）+ `fetch-deps <app> --dry-run`，见 `portgraph/docs/fetch-deps.md`）→ `procedural/qt-app-harmonyos-migration` + `semantic/qt-harmonyos-porting-workflow` + `qt-harmonyos-api-mapping` + `qt-harmonyos-code-patterns` |
| 查 API 替换 | `semantic/qt-harmonyos-api-mapping` + `qt-harmonyos-code-patterns` |
| 查某个 Qt 模块是否支持鸿蒙 | `semantic/qt-harmonyos-modules` |
| 查鸿蒙平台限制 | `semantic/qt-harmonyos-platform-limits` |
| 编译失败/构建报错/部署不了 | `semantic/qt-harmonyos-build` + `qt-harmonyos-build-run-workflow` + 先查 `problems/_lookup.md` |
| 窗口显示异常/对话框行为不对 | `semantic/qt-harmonyos-window-model` + golden-rules §二 |
| 生命周期/closeEvent/接续/分享 | `semantic/qt-harmonyos-lifecycle` |
| QtOhosExtras 怎么用 | `semantic/qt-ohos-extras` |
| 判断问题是否出在 Qt 鸿蒙框架层 | `golden-rules` + `qt-harmonyos-platform-limits` + `qt-harmonyos-api` + 先查 `problems/_lookup.md` |
| Qt 应用行为异常的排查思路 | `qt-harmonyos-build-run-workflow` §构建失败排查四步法 + `problems/_lookup.md` |
| 写个 demo/测试工程 | `procedural/demo-generation` |
| 三方库/依赖/交叉编译 | `semantic/qt-harmonyos-third-party-libs` + **`portgraph deps`**（依赖角色分类：编译产物/构建工具/运行时/测试/自带 + 版本范围，见 `portgraph/docs/deps-report.md`）+ **`portgraph fetch-deps`**（应用级依赖闭包，bottle 直下/源码编译缺口清单） |
| 遇到执行报错 | **先读 `problems/_lookup.md`**，按错误码/错误信息/症状搜索 |
| 查某问题是否已修/未解决清单/临时方案 | `faults/_registry.md` §症状索引（表现→根因）→ 根因页（定性/责任领域/临时方案或替代方案/复核计划） |

## 读取约定

- **summary**：每页 frontmatter 的一句话摘要，Agent 据此判断是否需要加载该页
- **refs**：交叉引用的其他知识页 id，沿其追踪深度上下文
- **tags**：经 `_index/_tags.md` 按主题聚合浏览
- **problems/ 记录的是实际执行报错**（编译失败、部署失败、运行时崩溃），不是 Qt 文档中的平台限制——后者在 `semantic/qt-harmonyos-platform-limits.md`
- **faults/ 是症状×根因图**（S 应用层表现 → C 根因，C 分 defect 会修 / limitation 规格限制→替代方案）：报错解法查 `problems/`；问题"归谁、是缺陷还是规格、修没修、根治前怎么绕"按表现查 `faults/_registry.md` §症状索引或 `_graph.yaml`（机读全量图），两者经 refs 双向关联

## 路径变量

知识页以变量名（如 `QT5_15_SRC`、`OHOS_SDK_NATIVE`）引用本地路径，不硬编码。实际路径值见 `ENV.local.md`（由 `skills/kb-init/` 生成，或手动创建）。

## 内嵌的 HarmonyOS 平台通用知识

本知识库内嵌了 `ohos-common-kb-public/` 目录，包含 HarmonyOS 平台通用知识（ArkTS、ArkUI、NAPI、Stage 模型、DevEco 工具链等）。当任务涉及平台机制而非 Qt 特定问题时，优先查阅该目录。

## Skills（Agent 自动化脚本）

本知识库提供以下 Agent skills，位于 `skills/` 目录：

| Skill | 用途 | 触发方式 |
|-------|------|----------|
| `kb-init` | 初始化知识库环境（检测依赖、安装缺失组件、生成 ENV.local.md、验证环境） | 用户说"初始化"、"配置环境"、"第一次使用"、"ENV.local.md 不存在"时自动触发 |
| `qt-app-porting` | Qt 应用鸿蒙化自动迁移（扫描→计划→受追踪修改→构建→装机→验证门禁→报告→知识蒸馏，统一 CLI `tools/qt-ohos-run.py`） | 用户说"迁移/移植/鸿蒙化这个 Qt 项目（要执行）"、"验证迁移结果"、"分析构建/运行日志"时触发 |
| `qt-sdk-forge` | Qt 本地 SDK 工程平面（**所有 Qt SDK 编译与临时测试版本统一入口**）：编译 Qt 源码（全量/增量 install，5.12/5.15 源码编译、6.12 预构建登记）、应用与追踪修改补丁（接收其他 agent 的修改方案工单）、发布维护本地 SDK 多版本（SV0-SV8 门禁 + 补丁溯源 manifest + ENV 同步）、定期跟踪上游演进并联动 faults review，统一 CLI `tools/qt-sdk-run.py`（Python，Windows 编译差距已闭合） | 用户说"编译/重编 Qt"、"给 Qt 打补丁/应用修改方案"、"出/切换 SDK 版本或临时测试版本"、"检查上游更新"、"维护本地 SDK"时触发 |
| `portgraph`（仓库工具，非 skills/） | 可行性评估与依赖解决：`analyze` 可移植性判定（portable/blocked/uncertain）+ `deps` 综合依赖分析（link/build-tool/runtime/test/vendored 角色分类 + 版本范围与要求校验）+ `fetch-deps` 应用级依赖闭包（bottle 直下 / 源码编译缺口清单） | 接到"移植/迁移/鸿蒙化某应用"或"评估某应用可行性"任务时**自动作为第 0 步执行**，产出评估结论后再进入迁移工作流；依赖 ≥3 个三方库时**禁止**人工逐个判断 |
| `task-dispatcher` | 多 Agent 协作调度中枢：任务台账（task.yaml）+ 流转日志（flow.jsonl）+ 移交信封（ho-\*.yaml），按任务路由派单、汇聚人工接入请求（waiting-human）、关单移交工程迭代 | 多 agent 协作模式下用户发起任何任务时首先由本 agent 建档路由；"查任务状态 / 续跑 / 关单"时触发 |
| `kb-iterator` | 工程迭代 agent（知识库唯一真源写入门）：faults 草稿主编六步门禁、QOH/R promote、索引再生（faults-build build）、事实校验（kb-verify-qt）、任务复盘蒸馏、上游演进复核与版本基准表更新 | 任务关单需沉淀知识、用户说"合入草稿 / 复核 faults / 重建索引 / 检查上游演进影响"时触发 |

**首次使用**：如果用户是第一次使用本知识库，或 `ENV.local.md` 不存在，**必须**先执行 `skills/kb-init/SKILL.md` 完成初始化。

**执行纪律（qt-app-porting）**：

- 迁移"成功"只以 `python tools/qt-ohos-run.py verify` 的门禁结果（G0-G12）为准；
  编译通过 ≠ 迁移成功。LLM 负责推理，tool 负责事实。
- 日志报错先用 `python tools/qt-ohos-run.py analyze-log <日志>` 做机器匹配（42 条
  QOH 模式），再沿命中条目的 `refs` 读 problems/ 知识页。
- 每次自动修改都被追踪（`.qt-ohos/changes.json` + patches/）；禁止盲目扩写
  `Q_OS_LINUX` 守卫——鸿蒙下 `Q_OS_OHOS` 隐含 `Q_OS_LINUX`。
- **工具可用性预检**：开始构建/装机/签名/日志工作前先定位并验证
  `devecocli`、`hdc`、Qt kit 可用（devecocli 定位顺序：`ENV.local.md` 的
  `DEVECO_CLI` → PATH → npm 全局（`@deveco/deveco-cli`）→ DevEco 捆绑；
  **勿假设它随 DevEco Studio 安装**）；不可用即停下向用户报告并附安装
  命令，禁止用猜测的路径继续。详见
  `ohos-common-kb-public/procedural/deveco-cli-usage-rules.md` §工具可用性预检。
- **回合收尾纪律（操作级）**：非交互 CLI 会话（`opencode run` / `claude -p`
  等）中**回合结束 = 会话退出，没有任何机制会唤醒你**。禁止"委派后台代理后
  收尾等待"——主回合退出后子进程失去协调者，干完各自的活就地解散（两轮
  实测死因）；长任务必须在当前回合内同步等待（wait/轮询）或顺序自己执行；
  流水线未达 `verify` 终态或人工确认点禁止输出总结停止；中止需状态落盘
  `.qt-ohos/` 并写明续跑方式。
- 修改故障库真源（`faults/_data/*.yaml` 或 C 页）后必须跑
  `python tools/faults-build.py build` 重建派生物（`_graph.yaml`/`_registry.md`），
  ERROR 必须清零；复核用 `review` 子命令扫到期与状态推进。
- 协作者草稿（`faults/_drafts/draft-*.md`）合入前必须走主编门禁（`faults/_index.md`
  §六·协作草稿模式）：**复现 demo 必测**（defect/undetermined 类；未复现不合入）、
  人工核验（证据链/定性/归层/事实/脱敏）、复现结果登记进 C 页"版本验证记录"
  第一行，然后才 promote 拆分合入。
- **问题确认证据门禁**（`faults/_index.md` §六·证据标准）：定性 Qt 框架侧问题
  （defect 且 qt-port/qt-upstream）必须持有复现 demo 或调试日志+栈（C 页
  `evidence_type`，静态可判定类 source 例外+警告），纯转述/猜测不受理；提上游单
  （qt-bug/ohos-issue/partner）的 defect 必须 demo/logs/both 级证据——check 机器强制。
  Qt 侧问题的 demo 硬性要求：**复现逻辑集中在单个 main.cpp**（ohos 工程仅胶水壳）
  且**写明编号复现步骤**（到操作级 + 每步预期）——无步骤视为未完成。
- **链路完备性（闭环规则）**（`faults/_index.md` §四·闭环规则）：defect（外部责任）
  的"临时解决"必须**同时**有采用中方案（W adopted）与在跟单（T）——缺一即未闭环
  （missing-ticket / missing-workaround / both-missing，工具派生 chain_state/gaps）；
  limitation 与应用问题必须有采用中方案；**缺口向上传播**——S 宣称 resolved 而链有缺
  → ERROR。`review` 子命令输出"未闭环（待补齐）"清单，缺什么补什么。

## 待办与进度同步

- `TODO.md`：入库的待办模板（结构/分类规范，不含实际条目）。
- `TODO.local.md`：个人实际待办，记录进行中的任务与进展（已 gitignore，不入库）。
- 多步骤工作流任务在阶段转换时更新 `TODO.local.md` 的进展列；纯查询类任务无需同步。

## 多工具兼容

| 工具 | 集成方式 |
|------|---------|
| Claude Code | 将 `AGENTS.md` 复制为本地 `CLAUDE.md` 后自动加载（本仓不携带 CLAUDE.md） |
| Codex | AGENTS.md 自动加载（与本文件内容相同） |
| Cursor | 在 `.cursorrules` 中引用 `_index/_map.md` |
| Windsurf | 在 `.windsurfrules` 中引用 `_index/_map.md` |
| Obsidian | 直接作为 Vault 打开，利用图谱可视化 |

## 内容来源

| 来源类型 | 说明 |
|----------|------|
| Qt 官方文档 | wiki.qt.io、doc.qt.io（API 映射、模块状态） |
| HarmonyOS 官方文档 | developer.huawei.com（生命周期、窗口模型、平台限制） |
| Qt 源码验证 | QtOhosExtras 模块、QPA 插件源码（API 签名、枚举路径） |
| 实践经验 | 框架问题分析、迁移项目复盘、实际报错积累 |

### Qt 框架版本（校验基准）

| 版本 | 分支 | Commit | 日期 |
|------|------|--------|------|
| Qt 5.15.16 | tqtc/harmonyos-5.15.16 | 962aa625 | 2026-04-19 |
| Qt 5.12.12 | tqtc/harmonyos-5.12.12 | 613336de | 2026-05-25 |
