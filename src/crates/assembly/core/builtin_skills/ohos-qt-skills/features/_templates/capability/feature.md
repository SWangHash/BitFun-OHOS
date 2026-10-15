# <中文名称>（capability）

> 骨架：由 `scripts/feature_register.py scaffold` 复制为 `features/<feature-id>/`，同时把开发者交付的
> skill **原样**放到 `features/<feature-id>/skill/`（流程见 `features/REGISTER.md`）。
> 本文件是**接入说明**，由登记的 agent 读完 skill 后填写，skill 开发者只交付 skill。
> 只写 skill 与迁移台账之间的对应关系，不复述 skill 的内容，也不往 `skill/` 里添加或修改任何文件。
> 章节标题不可改名（lint 按标题检查）；每节写什么、合格标准见 `features/RULES.md` 第 7 节。

## 前置条件

与 `hook.json` 的 `entry.requires` 一一对应，另列 skill 自身要求的条件（SDK、权限、设备、工具），
每项写明在哪个台账核对。

| 项 | 要求 | 验证途径 |
|---|---|---|
| TODO | TODO | TODO |

## 执行入口

- 先读：`skill/SKILL.md`；skill 内的相对路径按 `features/<feature-id>/skill/` 解析。
- 适用范围：TODO（本次迁移用到 skill 的哪些部分；哪些部分不适用）。
- 与主流程冲突时以主流程为准：TODO（逐条列出 skill 中被覆盖的指令，例如 skill 自带的阶段划分、
  状态文件位置、联网安装依赖）。
- skill 自己的状态与中间产物只写 `{workdir}`；所有 C++ 改动仍在 `Q_OS_OHOS` / 平台守卫内。
- 步骤名与 `milestones` 对应，每步开始时运行
  `feature_hooks.py progress <root> <FEAT> --step "<步骤名>"`。

## 结果记录

本 feature 做完的每件事在迁移台账里记成哪一行。

| skill 中的内容 | 记到哪里 | 怎么记 |
|---|---|---|
| 每一处代码/配置改动（权限、CMake、ArkTS 胶水等） | `inventory.tsv` + `work-queue.tsv`，一项一个 `CAP-*` | TODO（category、source_location 样式、risk） |
| skill 的每个验收/测试场景 | `validation.tsv`，一个场景一个 `VAL-*` | TODO（scenario、command_or_steps、expected；至少一个会失败的场景） |
| 需要真机确认的场景 | `device-runs.tsv` | TODO（设备要求、证据形式） |

执行时把实际写下的 `CAP-*` / `VAL-*` 编号填进本 `FEAT` 行的 `capability_ids` / `validation_ids`。

## 准出对照

| 准出条件 | 由 skill 的哪一步、哪项证据满足 |
|---|---|
| `validation-passed: row` | TODO |
| 隐式：capability_ids 已关闭 | work-queue / inventory 行关闭 |
| 隐式：真机证据（device=true） | device-runs.tsv 通过行的 scenario_ids 含本 feature 的 VAL-* |

## 失败处理

- skill 步骤失败：`record_diagnostic.py --affected-ids <FEAT>,<CAP>,<VAL>` 记录后再重试。
- 回退：TODO（skill 给出的回退方式在哪一节；回退后应用行为；是否需重签）。
- 做不完：`feature_hooks.py close <root> <FEAT> --status deferred-approved|blocked --decision <DEC>`。
