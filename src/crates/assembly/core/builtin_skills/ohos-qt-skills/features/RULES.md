# 外部 feature 包规则（给 agent）

本文件是外部 feature 包的完整规则，给维护本仓库的 agent 用：写 `hook.json`、接入说明 `feature.md`、
登记 `registry.tsv` 时以本文件为准。登记、升级的操作流程见 [`REGISTER.md`](REGISTER.md)；
给特性开发者看的简介见 [`README.md`](README.md)。迁移过程中 agent 如何运行 feature 见
[`../references/external-features.md`](../references/external-features.md)。

## 1. 概念

迁移主流程是宿主，feature 是钩子：每个 feature 声明挂在哪个阶段、何时被选用、做到什么程度算完成；
主 skill 只负责登记、激活、准入、准出，不关心 feature 内部怎么做（灰盒）。

| kind | 挂载阶段（hook point） | 用途 | 可改应用源码 |
|---|---|---|---|
| `capability` | 6 `features` | 鸿蒙特有能力：碰一碰、接续、分享、系统托盘类增强等超出“等价移植”的系统能力 | 可以（平台守卫内） |
| `verification` | 7 `validation` | 其他团队/开发者提供的验收流程，在交付前对最终 HAP 做额外验证 | **不可以**，发现缺陷回主流程修复 |

其他阶段暂不开放钩子。阶段 1–5 是 Qt 基础迁移，不涉及 feature；所有 feature 的询问、选用、激活以及
`capability` 的实施都集中在阶段 6（`diagnostics` 通过之后），选中的 `verification` 在阶段 7 运行。

## 2. 包的组成

每个 feature（两类都一样）都以一个完整的 **skill** 交付，没有其他交付形态。登记时把 skill 原样放进
feature 包的 `skill/` 子目录，由 agent 在 skill **外面**写 `hook.json` 和接入说明 `feature.md`。

```
features/
  README.md                 # 给特性开发者：简介与 prompt 示例
  RULES.md                  # 本文件：包规则
  REGISTER.md               # 给 agent：登记、升级流程
  registry.tsv              # 登记表：只有登记的 feature 能被选用
  _templates/               # 骨架（以 _ 开头的目录不参与 lint）
    capability/   hook.json  feature.md                # 第 6 阶段（features）挂载的鸿蒙能力
    verification/ hook.json  feature.md                # 第 7 阶段（validation）挂载的验收流程
  <feature-id>/
    hook.json               # agent 写：钩子、触发词、准入、准出、产出，"skill": "skill"
    feature.md              # agent 写：接入说明（skill 与台账的对应关系）
    checks/                 # 可选：agent 补充的准出脚本
    skill/                  # 开发者交付的 skill，原样存放
      SKILL.md  scripts/  references/ ...
```

三条规则：

- **保持完整**：`skill/` 与交付内容逐字节一致（只略过顶层 `.git`）；不往里添加、不修改任何文件；
  升级时整目录替换。
- **不自行触发**：skill 只放在 `features/<feature-id>/skill/`，不安装到运行环境的 skill 目录；
  迁移 agent 只在 `feature_gate.py enter` 通过后才读它的 `SKILL.md`。是否使用由迁移用户在阶段 6 选择。
- **宿主规则优先**：skill 的指令与主流程冲突时以主流程和接入说明为准（skill 自带的阶段划分、
  状态文件位置、联网安装依赖、验收 skill 的“发现问题直接修”等）；skill 的状态、产物和结论只写 `{workdir}`，
  由准出条件判定才算数。
- **不写其他台账**：feature 的记录只有 `features.tsv` 中本 FEAT 行和 `{workdir}`；用户对 feature 的回答
  （选用、重试、延期）记在本行 `notes`，不写 `decisions.tsv`；不新增 `inventory.tsv`、`tasks.tsv`、
  `validation.tsv` 行。执行期间会变化的其他台账只有主流程脚本写的 `diagnostics.tsv`（失败的批次）和
  `device-runs.tsv`（应用 HAP 最近一次的结果，只有一行）。

## 3. 生命周期（迁移侧看到的）

写 `hook.json` 与接入说明时，要清楚每个字段在迁移中何时起作用。

1. **候选**：阶段 6（`features`，基础迁移已通过 `diagnostics`）开始时运行 `feature_hooks.py candidates <root> --request "<用户需求>"`，
   列出所有已登记的 feature（按挂载阶段分组）；`trigger.keywords` 命中需求的排在前面，
   **只用于排序，不自动选用**。
2. **选用**：用户在阶段 6 人工决定，默认不选；超时或跳过的提问不算回答。问答不写入 `decisions.tsv`。
3. **激活**：`feature_hooks.py activate <root> --answer "<用户原话>" --select <id> ...`，为每个选中的
   feature 写一行 `features.tsv`（`FEAT-NNN`，`planned`，用户的回答记在 `notes`）；用户不选时不写任何行。
   `activate` 只在阶段 6 开放期间可用；之前的阶段门不检查 feature。
4. **准入**：宿主阶段开放后（其前一阶段已通过），`feature_gate.py enter <root> FEAT-NNN`。
   检查 `hook.after`、同阶段串行（一次只运行一个）、`entry.requires`。
   READY → `in-progress`，创建工作目录 `migration/ohos/features/FEAT-NNN/`（即 `{workdir}`）。
5. **执行**：按 `feature.md` 做；每步开始时 `feature_hooks.py progress <root> FEAT-NNN --step "<步骤>"`。
6. **准出**：`feature_gate.py exit <root> FEAT-NNN`。显式条件 + 隐式条件全部满足 → `passed`，
   `exit_gate` 保留上一次没准出的原因（一次通过则为空）；否则 `attempts+1`，`exit_gate` 记下未满足项。超过 `max_attempts`
   时状态变为 `blocked`（等用户答复），需用户同意才能继续尝试：`feature_gate.py exit <root> FEAT-NNN --answer "<用户原话>"`（计数清零，回答记入 `notes`）。
7. **关闭的其他方式**：`feature_hooks.py close <root> FEAT-NNN --answer "<用户原话>"`（`deferred-approved`）；
   回答记入 `notes`，`exit_gate` 仍是上一次没准出的原因。
8. **宿主阶段门**：`phase_gate.py` 要求该阶段所有 FEAT 行都已终结（`passed` / `deferred-approved`）；第 7 阶段还要求
   `report.md` 的 `## External features` 逐行列出每个 FEAT 及其状态。

状态只由脚本写入（`ledger.py` 拒绝改 features.tsv）。

## 4. registry.tsv

| 列 | 说明 |
|---|---|
| `feature_id` | 稳定 ID，kebab-case，与目录名、`hook.json.feature_id` 一致；能力类惯用 `harmonyos-` 前缀，验收类惯用 `ext-` 前缀 |
| `title` | 中文名称 |
| `kind` | `capability`（在 `features` 阶段执行）/ `verification`（在 `validation` 阶段执行），与 hook.json 一致 |
| `package_path` | 相对本目录，如 `<feature-id>/` |
| `owner` | 维护者（个人或团队） |
| `summary` | 一句话说明，候选列表里展示给迁移用户 |

## 5. hook.json

```json
{
  "schema": "qt-ohos-feature/1",
  "feature_id": "harmonyos-tap-to-transfer",
  "title": "碰一碰",
  "kind": "capability",
  "version": "1.0.0",
  "owner": "team-x",
  "skill": "skill",
  "hook": { "phase": "features", "after": [] },
  "trigger": { "keywords": ["碰一碰", "tap to transfer"] },
  "entry": { "requires": [ { "check": "phase-passed", "phase": "diagnostics" } ] },
  "exit": { "criteria": [ { "check": "artifact", "path": "{workdir}/result.json", "json": { "result": "pass" } } ], "max_attempts": 3 },
  "outputs": { "ledgers": ["diagnostics.tsv", "device-runs.tsv"], "evidence_files": ["{workdir}/result.json"] },
  "permissions": { "modify_sources": true, "device": true },
  "milestones": ["声明权限", "接入代码", "真机验证"],
  "playbook": "feature.md",
  "refs": ["semantic/<page>.md"]
}
```

| 字段 | 规则 |
|---|---|
| `schema` | 固定 `qt-ohos-feature/1` |
| `feature_id` / `title` / `version` / `owner` | 必填；`feature_id` 等于目录名；`version` 优先取 skill frontmatter 的 `version` |
| `skill` | 必填，交付的 skill 所在子目录（约定 `skill`）；该目录下必须有带 `name`/`description` frontmatter 的 `SKILL.md`，且不得包含 `hook.json` 或 `playbook` 文件 |
| `kind` | `capability` 或 `verification`，必须与 `hook.phase` 匹配（features↔capability，validation↔verification） |
| `hook.after` | 同一挂载阶段内必须先关闭的其他 feature_id；不可自指、不可成环 |
| `trigger.keywords` | 非空；迁移用户提需求时可能说的词；只用于候选排序；不接受其他字段（不存在自动触发） |
| `entry.requires` / `exit.criteria` | 谓词列表，见第 6 节；`exit.criteria` 至少一个显式条件 |
| `exit.max_attempts` | 正整数，默认 3 |
| `outputs.ledgers` | 执行期间会变化的主流程台账，只能是 `diagnostics.tsv`、`device-runs.tsv`（由主流程脚本写）；feature 不写 inventory、decisions、tasks、validation |
| `outputs.evidence_files` | 证据文件，必须位于 `{workdir}/` 下 |
| `permissions.modify_sources` | verification 必须为 `false` |
| `permissions.device` | `true` 时准出隐式要求真机证据；capability 不需要真机时同时去掉 `entry.requires` 里的 device-runs 条件 |
| `milestones` | 步骤名，用于 `progress --step`，由 `ledger.py state` 与 `feature_hooks.py status` 展示；与接入说明的步骤一致 |
| `playbook` | 接入说明文件，固定 `feature.md`，必须在 skill 目录之外 |
| `refs` | `upstream-kb/knowledge/` 下的页面路径；必须存在于当前基线 |

字符串中可用占位符：`{migration_root}`、`{app_root}`、`{package}`（feature 包目录）、
`{workdir}`（`migration/ohos/features/FEAT-NNN`）、`{FEAT}`。其他 `{...}` 会被 lint 拒绝。

## 6. 谓词

| check | 可用于 | 必填参数 | 可选参数 | 含义 |
|---|---|---|---|---|
| `phase-passed` | entry, exit | `phase` | | STATE.md 中该阶段已通过 |
| `feature` | entry, exit | `feature_id` | `status_in` | 另一个已激活 feature 达到给定状态（默认 `passed`） |
| `ledger-row` | entry, exit | `ledger` | `where`、`status_in`、`non_placeholder`、`min` | 台账中满足条件的行数 ≥ `min`（默认 1）；`where` 为 列→值/值列表 |
| `artifact` | entry, exit | `path` | `json` | 文件存在；给出 `json` 时逐键比对（键可用点号路径） |
| `command` | exit | `run` | `timeout_s`（默认 600）、`cwd`（`workdir`/`package`/`app`） | 运行包内脚本，退出码 0 为满足；输出写 `{workdir}/exit-<attempt>.log`；stdout 最后一行若是含 `evidence` 的 JSON，会显示在结论中 |
| `no-open-diagnostics` | exit | | | diagnostics.tsv 里没有 `open` 的问题（基础迁移的问题在阶段 6 之前已全部关闭） |

`command` 的约束：`run[0]` 只能是 `python`/`python3`/`bash`/`sh`/`node`，`run[1]` 必须是
`{package}/` 下真实存在的脚本（可以是 skill 自带的，如 `{package}/skill/scripts/judge.py`，
直接引用、不复制）；只用标准库；只读迁移目录、只写 `{workdir}`；不得触网下载、
不得读写签名材料。选用 skill 自带脚本前先读脚本确认满足这些约束，不满足就改用 `artifact`。

**隐式准出条件**（无论 hook.json 写什么都会检查）：diagnostics.tsv 里没有 `open` 的问题；
`device=true` 时还要求 `device-runs.tsv` 的状态是 `run`（最新的 HAP 在真机上跑通过）。

## 7. feature.md（接入说明）

`feature.md` 只是 skill 与迁移台账之间的适配层，不复述 skill 内容。它由 agent 在登记时读完 skill 后填写；
skill 开发者只交付 skill，不需要了解迁移台账。章节标题固定，lint 按标题检查（可加其他章节）；
所有 `TODO` 必须填完，lint 对残留的 `TODO` 给出警告。

| capability | verification | 写什么 |
|---|---|---|
| 前置条件 | 前置条件 | 与 `entry.requires` 对应，外加 skill 自身要求的 SDK、权限、设备、工具，注明在哪个台账核对 |
| 执行入口 | 执行入口 | 先读哪个文件；本次用到 skill 的哪些部分；**逐条列出被主流程覆盖的 skill 指令**（skill 原文位置 → 主流程中的处理方式）；产物写 `{workdir}` |
| 结果记录 | 证据产出 | skill 做完的每处改动、每个验收场景记在 `{workdir}` 的哪个文件；证据文件的格式及其与 skill 原始结果的转换关系 |
| 准出对照 | 判定规则 | 每个显式与隐式准出条件由 skill 的哪一步、哪项证据满足 |
| 失败处理 | 失败处理 | 失败如何记诊断；capability 的回退方式在 skill 哪一节；verification 发现缺陷回主流程修复后 `enter --restart` |

总的合格标准：没读过这个 skill 的 agent，凭接入说明就知道从哪里读起、哪些指令不照做、
结果记到哪里、准出失败回到哪一步。引用 skill 时写出具体文件与章节，不凭记忆补写 skill 没有的内容。

### 前置条件（两类共用）

- **写什么**：与 `entry.requires` 一一对应，并补充 hook.json 表达不了、skill 又要求的条件：QtOhosExtras API
  是否存在于所选 Qt SDK（给出头文件/模块名，对照 `environment.tsv`）、module.json5 权限/ability
  （精确字符串）、设备能力（NFC/双机/系统版本）、skill 需要的工具；每项注明在哪个台账核对。
  skill 要求联网安装的依赖改写为“需预先准备”的条件。
- **合格标准**：另一台机器上的 agent 逐条核对，能明确得出“可开工 / 缺哪项”。
- **不合格示例**：“需要 Qt 5.15 和 NFC”——没有验证途径、没有精确权限串。

### 执行入口（两类共用）

- **写什么**：先读 `skill/SKILL.md`，skill 内的相对路径按 `features/<feature-id>/skill/` 解析；本次迁移用到 skill
  的哪些部分、哪些不适用；与 `milestones` 对应的步骤及每步对应 skill 的哪一节；被主流程覆盖的 skill 指令清单
  （skill 自带的阶段划分、状态文件位置、联网安装、验收 skill 的“发现问题直接修”、读写签名材料等）；
  capability 的所有 C++ 改动仍在 `Q_OS_OHOS` / 平台守卫内；verification 不在应用目录下生成任何文件。
- **合格标准**：照着做不会执行任何与主流程冲突的 skill 指令；每个步骤都能在 skill 中找到出处。
- **不合格示例**：只写“按 skill 执行”。

### 结果记录（capability）/ 证据产出（verification）

- **写什么**：skill 的每处改动（文件、改动、所在平台守卫）、每个验收场景（步骤、期望、结果）写进 `{workdir}`
  的哪个文件；准出条件读取的结论文件（capability 默认 `{workdir}/result.json`，verification 默认
  `{workdir}/report.json`）的格式，以及如何由 skill 的原始结果转换而来；device-runs 证据要求。
  不写 inventory、decisions、tasks、validation 台账。
- **合格标准**：agent 能据此在具体应用里核实后写出这些文件；至少一个验收场景是“会失败的实验”。
- **不合格示例**：只写“记录改动”。

### 准出对照（capability）/ 判定规则（verification）

- **写什么**：表格，每个显式与隐式准出条件 → 由 skill 的哪一步、哪项证据满足。
- **合格标准**：准出失败时，看这张表就知道回到哪一步补什么。

### 失败处理（两类共用）

- **写什么**：capability 失败时记一个问题（`record_diagnostic.py --id new`，location 或 symptom 里写上 FEAT 编号）
  后重试，skill 给出的已知失败签名在哪一节；回退方式（删哪些代码块、撤哪些权限、还原哪些构建配置、
  是否需重签）在 skill 哪一节，skill 没写时按平台守卫整体摘除；做不完时 `close`。
  verification 发现缺陷时只记录（`{workdir}` 报告记失败、diagnostics.tsv 记一个问题），不修改源码；主流程修复后
  `feature_gate.py enter --restart <root> FEAT-xxx` 重跑。
- **合格标准**：回退后可构建、宿主平台行为不变、鸿蒙侧变化明确；这条路径会进入 `report.md`
  的 External features 一节（FEAT 的最终状态和限制）。

## 8. 编写要求

| 要求 | 达标判定 | 在哪被检查 |
|---|---|---|
| **平台隔离** | 所有 C++ 改动在守卫内，声明“其他宿主平台零改动” | 评审拓扑把平台守卫列为强制独立评审范围；共享代码修改后重跑宿主回归 |
| **至少一个验收场景** | 能写出一个“会失败的实验”：可执行步骤 + 可判定期望，结果进入准出条件读取的结论文件 | 评审；写不出的不能登记 |
| **引用知识页（refs）** | 平台事实落到 `upstream-kb/knowledge/` 具体页面 | lint 检查页面存在；缺页 → 申请新基线 |
| **只写可验证内容** | 每个行为声明都能指向某个验收场景 | `report.md` 按实际最强证据层交底 |
| **证据可追溯** | 证据都在台账或 `{workdir}` 下，不依赖会话记忆 | 评审 |
| **不写知识库细节** | 平台事实只通过 `refs` 引用，不在 `features/` 里复述具体知识库页面内容 | 评审 |

## 9. 登记前自查清单（提交登记前逐项确认）

1. `feature_hooks.py lint` 全量通过且无 `TODO placeholder` 警告，registry 行与 hook.json 一致；
2. `entry.requires` 只依赖宿主阶段开放时已经成立的事实；
3. `exit.criteria` 每一条都能由 feature.md 中某一步的证据满足（准出对照/判定规则表完整）；
4. 至少一个验收场景能明确写“期望什么、怎么判定失败”；
5. capability：所有改动都在平台守卫内；回退后可构建、宿主行为不变；
6. verification：不修改源码；`command` 脚本只用标准库、只写 `{workdir}`、有超时；
7. `skill/` 与交付内容一致、未安装到会自动触发的位置，接入说明列全了被主流程覆盖的指令；
8. refs 指向的页面全部存在于当前 `upstream-kb/knowledge/` 基线；
9. 通读一遍：每个行为声明都能指出“哪个验收场景验证它”——指不出的删掉。

## 10. 修改已登记的包

- 修改包内任何文件（含替换 `skill/`）会影响已激活但未关闭这个 feature 的迁移，提交说明中写明这一影响。
- skill 升级：整目录替换 `skill/`，复核接入说明的“执行入口”和准出对照是否仍成立，更新
  `hook.json.version`，重新 `lint`。
- 迁移 agent 从不修改本目录；只有维护本仓库的 agent 按 [`REGISTER.md`](REGISTER.md) 修改。
