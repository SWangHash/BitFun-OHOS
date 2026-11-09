# ohos-qt-skills

将一个现有 C++/QML Qt 应用迁移到 HarmonyOS（鸿蒙 PC）的 Agent Skill。保留 C++/QML 与既有宿主平台行为，只叠加鸿蒙所需的构建、打包、生命周期、窗口、API、依赖、插件与资源适配；等价移植完成后，还可按特性目录为应用增加鸿蒙特有特性（碰一碰、接续、分享等）。

本文是给人看的概述。Agent 的规则以 `SKILL.md` 为入口，每个概念只有一个主页（见下文“文档分层”），这里不复述细则。

## 目录结构

```
SKILL.md                         # Agent 入口：第一步、阶段与门禁、台账规则、工具清单、硬规则
AGENTS.md / CLAUDE.md            # 维护本 skill 的 agent 须知
agents/openai.yaml               # Agent 元信息
assets/templates/migration/ohos/ # 迁移台账与文档模板、批次计划示例
assets/ledger-columns.tsv        # 台账列字典（ledger.py columns 打印）
assets/known-issues.tsv          # 已知问题签名库：失败日志 → 根因 + 修法（batch_checks 自动匹配）
assets/smoke/                    # 环境冒烟与输出工程信封应用用的 Qt Widgets 最小应用
features/                        # 外部 feature 包（以 skill 交付，外加 hook.json 与接入说明）与接入规范
references/                      # 按主题的规则文档（决策、诊断循环、盘点扫描、三方并行、外部特性、知识钉版、工具链输入、持久化模型）
docs/                            # 设计历史（迁移时不读）
scripts/                         # 迁移脚本，用法见各脚本 --help；取值集中在 vocab.py
tests/                           # 单元与端到端测试
upstream-kb/                     # 与上游 ohos_qt-skills 的唯一接口（维护者），见 upstream-kb/AGENTS.md
```

## 一、7 阶段门控工作流

每个阶段都是“动作 → 证据写入台账 → 门禁判定”。阶段只能由 `validate_ledgers.py --phase <id>` 输出 READY 关闭；当前阶段该做什么、不该做什么、门禁还差什么，由 `next_step.py` 打印。

```
①环境准备 → ②迁移项盘点 → ③方案确认 → ④迁移实施 → ⑤构建与诊断 → ⑥鸿蒙特性接入 → ⑦验收与交付
```

| 阶段 | 做什么 | 为什么 |
|---|---|---|
| ① 环境准备 `environment` | `env_probe.py` 探测工具链并整表写入 `environment.tsv`（一个环境项一行）；`env_smoke.py` 用 hello 应用走一遍应用以后要走的整条流水线（有设备时签名、装机、启动），结果写 `env-smoke.json` 作为本阶段出口门禁；待决策项只记不问 | 环境问题只在这里解决一次，之后的阶段直接复用，不在批次里绕 |
| ② 迁移项盘点 `inventory` | 构建文件预检、portgraph 依赖闭包、按固定任务书扫描源码；写 INV/VAL/队列行 | 工作单元是“能力切片”而不是文件；范围在这里定死 |
| ③ 方案确认 `decisions` | 给出评估结论，冻结方案与验收场景，一次性询问所有待决策项（10 分钟无人回答自动选推荐项） | 把范围变更和实现在时间上隔开；修复循环期间方案只读 |
| ④ 迁移实施 `tasks` | 生成输出工程，应用用自己的构建系统为 OHOS 配置并审计；先编译再读代码；按队列逐行做最小守卫改动 | 机械化的下一步，每个改动可审计 |
| ⑤ 构建与诊断 `diagnostics` | 构建、部署、打包、签名、装机都走 `batch_checks.py`；失败记成问题（一个问题一行），已知问题自动给出原因和修法，其余先写原因再重试；同一问题修 3 次不过就标阻塞并问用户 | 杜绝同一错误反复构建的死循环 |
| ⑥ 鸿蒙特性接入 `features` | 让用户从特性目录中选择（默认不选），逐个实施能力类特性 | 先把基础迁移做稳，再叠加鸿蒙特有能力 |
| ⑦ 验收与交付 `validation` | 检查真实产物与设备行为，运行验收类特性，按实际达到的最强层级写报告 | 构建成功 ≠ 能跑 ≠ 行为正确，交付不夸大 |

①–⑤ 是 Qt 基础迁移，不涉及鸿蒙特性。用户决策的规则见 `references/decisions.md`，诊断循环见 `references/build-diagnostics.md`。

## 二、文档分层（每个概念一个主页）

| 概念 | 主页 |
|---|---|
| 第一步、阶段一览、门禁机制、台账读写规则、硬规则 | `SKILL.md` |
| 每个阶段做什么、不做什么、门禁条件 | `scripts/next_step.py`（运行时打印） |
| 脚本用法 | 各脚本 docstring（`--help`） |
| 批次计划格式 | `batch_checks.py`（`next_step.py --schema` 打印） |
| 台账列的含义、取值、由谁写 | `assets/ledger-columns.tsv`（`ledger.py columns <台账>` 打印） |
| 阶段、状态、处置、完成层级等取值 | `scripts/vocab.py` |
| 用户决策 | `references/decisions.md` |
| 构建与诊断循环 | `references/build-diagnostics.md` |
| 盘点扫描与盘点行 | `references/inventory-scan.md` |
| 三方库并行分派（阈值在 `closure.py`） | `references/third-party-parallel-dispatch.md` |
| 外部特性 | `references/external-features.md`；维护侧 `features/RULES.md`、`features/REGISTER.md` |
| 知识钉版与证据链 | `references/knowledge-sync.md` |
| 工具链与模板输入 | `references/toolchain-template-inputs.md` |
| 各台账记录什么、为什么 | `references/persistence-model.md` |

## 三、知识库：同步上游，下发到项目

```
上游 ohos_qt-skills（git commit，只读）
   │  维护者专用 upstream-kb/scripts/sync_upstream.py（plan → 审阅 → apply → verify）
   ▼
skill 发布基线：upstream-kb/knowledge/ + upstream-kb/manifest.tsv
   │  项目专用 sync_knowledge.py（校验 + 钉版，零复制）
   ▼
项目证据链：<container>/migration/ohos/knowledge-manifest.tsv
```

上游知识库为 [ohos_qt-skills](https://gitcode.com/OpenHarmonyPCDeveloper/ohos_qt-skills)，按“知识尽量保留、上游新增逐条审阅、裁剪需充分理由”的原则同步为已评审的发布基线。迁移中直接读基线页并打 `used` 标，不复制；只有目标确实需要适配的页才在项目里存本地副本并注册。迁移中途基线变了，`sync_knowledge.py` 改钉到新基线并列出变化的页，agent 转告用户后继续。三哈希证据链与 manifest 协议见 `references/knowledge-sync.md`。

更新知识库（维护者）：在本仓库对 agent 说“同步上游知识库，知识库本地路径为 xxx（或 git 路径为 xxx），分支为 xxx”，按 [`upstream-kb/AGENTS.md`](upstream-kb/AGENTS.md) 执行：

```bash
python upstream-kb/scripts/sync_upstream.py plan [--source <本地检出> | --repo <url>] [--branch <分支>] [--ref <commit>]
python upstream-kb/scripts/sync_upstream.py apply [--prune-stale-exclusions]
python upstream-kb/scripts/verify_kb.py --smoke
```

红线：`upstream-kb/scripts/` 只给维护者用，迁移 agent 不执行；不手改 `upstream-kb/knowledge/` 和 manifest；排除必须写理由；Qt/DevEco/OHOS SDK 与模板树永远是外部输入。

## 四、台账

`<container>/migration/ohos/` 下有 9 个 TSV 台账加自动生成的 `knowledge-manifest.tsv`，以及 `STATE.md`（导航、范围与评估结论）、`report.md`（交付报告）。同一事实只存一处：文档只写台账里没有的内容，`ledger.py state` 读取时把台账视图合并显示。台账的增改查一律通过脚本，agent 不用 Read/Edit 直接读写。各台账的用途见 `references/persistence-model.md`，列定义用 `ledger.py columns <台账>` 查看。

## 五、脚本清单

用法一律看 `python scripts/<脚本> --help`。

| 用途 | 脚本 |
|---|---|
| 初始化与导航 | `init_migration.py`、`next_step.py` |
| 环境 | `env_probe.py`、`env_smoke.py` |
| 盘点 | `preflight_build_files.py`、`closure.py`、`scan_qt_api_gap.py` |
| 构建、部署、打包、装机 | `template_patch.py`、`batch_checks.py`、`deploy_qt_libs.py`、`devecocli_build.py`、`hap_check.py`、`device_run.py` |
| 诊断与已知问题 | `record_diagnostic.py`、`known_issues.py` |
| 台账与门禁 | `ledger.py`、`validate_ledgers.py`、`phase_gate.py` |
| 知识钉版 | `sync_knowledge.py`、`mark_knowledge_used.py` |
| 外部特性 | `feature_hooks.py`、`feature_gate.py`、`feature_register.py`（登记，见 `features/REGISTER.md`） |
| 内部模块 | `vocab.py`、`ohos_env.py`、`gate_state.py`、`feature_predicates.py` |

## 效果

基于 9 个真实 Qt 应用（4 fix + 5 trans）的对比评测（旧 skill = 上游知识库直接使用，新 skill = 本工程）：

| 指标 | 旧 skill | 新 skill |
|---|---|---|
| 平均得分 | 0.59 | **0.85** |
| so + hap + 安装成功 | 6/9 | **9/9** |
| 启动成功且 a11y 可用 | 6/9 | **8/9** |

最大收益在编译链路保通（3 个旧 skill 编译失败/放弃的任务全部走通）。详见 `D:\code\qt\IMPROVEMENTS-VS-UPSTREAM.md`。

## 边界（不做什么）

- 不编译 Qt 本身、不批量移植多个应用、不把应用改写成 ArkTS；
- 不分发 Qt/DevEco/OHOS 二进制或模板树，真实工具链是外部输入；
- 只做框架/平台移植，不做逐文件语言翻译，不建平行应用树。
