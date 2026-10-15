# <中文名称>（verification）

> 骨架：由 `scripts/feature_register.py scaffold` 复制为 `features/<feature-id>/`，同时把开发者交付的
> skill **原样**放到 `features/<feature-id>/skill/`（流程见 `features/REGISTER.md`）。
> 本文件是**接入说明**，由登记的 agent 读完 skill 后填写，skill 开发者只交付 skill。
> 只写 skill 与迁移台账之间的对应关系，不复述 skill 的内容，也不往 `skill/` 里添加或修改任何文件。
> 章节标题不可改名（lint 按标题检查）；每节写什么、合格标准见 `features/RULES.md` 第 7 节。
> 验证类 feature **不得修改应用源码**；发现缺陷只记录，修复回主流程。

## 前置条件

与 `entry.requires` 一一对应，另列 skill 自身要求的条件（设备、工具、输入物），并写明如何确认。

| 入口条件 | 含义 | 确认方式 |
|---|---|---|
| `package-manifest.tsv` 有通过的 `application-hap` 行 | 最终 HAP 已登记 | TODO |

## 执行入口

- 先读：`skill/SKILL.md`；skill 内的相对路径按 `features/<feature-id>/skill/` 解析。
- 验证对象：TODO（HAP 路径取自 `package-manifest.tsv` 哪一行；设备取自 `device-runs.tsv`）。
- 与主流程冲突时以主流程为准：TODO（逐条列出 skill 中被覆盖的指令，例如“发现问题直接修复”
  改为只记录、skill 自带的状态文件位置、联网安装依赖）。
- skill 的状态、日志、报告只写 `{workdir}`；不在应用目录下生成任何文件。
- 步骤名与 `milestones` 对应，每步开始时运行
  `feature_hooks.py progress <root> <FEAT> --step "<步骤名>"`。

## 证据产出

- `validation.tsv`：skill 的每个验收项对应一个 `VAL-*` 场景（TODO：对应规则），ID 填进本 `FEAT`
  行的 `validation_ids`。
- `{workdir}/report.json`：`{"result": "pass" | "fail", "cases": [...], "evidence": "<一句话摘要>"}`，
  由 skill 的原始结果（TODO：文件或输出）转换而来；原始结果一并保存在 `{workdir}`。

## 判定规则

| 准出条件 | 判定依据 |
|---|---|
| `validation-passed: row` | 所有列出的 VAL-* 通过 |
| `artifact report.json result=pass` | skill 的汇总结论 |
| 隐式 `source-unchanged` | 入口后应用源码未变 |

需要用 skill 自带脚本判定时，在 `exit.criteria` 加 `command`，脚本路径写
`{package}/skill/<脚本>`（不复制、不修改脚本）。

## 失败处理

发现缺陷：把对应 `VAL-*` 记为失败，`record_diagnostic.py --affected-ids <FEAT>,<VAL>` 记录诊断；
不在本 feature 内修改源码。主流程修复后运行 `feature_gate.py enter --restart <root> <FEAT>`，
按 skill 重新执行，再 `feature_gate.py exit`。
