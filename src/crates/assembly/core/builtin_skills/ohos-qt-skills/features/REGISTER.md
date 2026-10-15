# 外部 feature 操作流程（给 agent）

本文件是维护本仓库的 agent 处理外部 feature 的操作流程：登记、升级、发布、修改、查看。
包的格式与每个字段、章节的规则以 [`RULES.md`](RULES.md) 为准；给特性开发者看的简介与 prompt 示例在
[`README.md`](README.md)。

| 开发者说的话（示例） | 流程 |
|---|---|
| “把 xxx 这个 skill 登记为外部 feature” | A. 登记 |
| “把 xxx 的 skill 升级到 <新路径>” | B. 升级 |
| “把 xxx 发布为 beta / stable” | C. 发布 |
| “把 xxx 的触发词/负责人/完成标准改成 …” | D. 修改 |
| “列出已登记的外部 feature” | E. 查看 |

## 0. 通用原则

- **先读后问**：所有选项都来自 skill 本身。skill 已经写清楚的事项给出推荐项让开发者确认，
  不要让开发者从零描述。开发者在请求里已经给出的信息（类型、负责人等）直接采用，不再提问。
- **只问开发者能回答的事**：`hook.json` 字段名、谓词、占位符、台账列这些技术细节由 agent 按 RULES.md 决定，
  不要拿来提问。
- **轮次少**：最多 4 轮，每轮最多 4 题；每题 2–4 个选项，推荐项放第一个并标“（推荐）”，附一句依据，
  并始终允许开发者自填。有结构化提问工具（如 AskUserQuestion）就用它，没有就用编号选项。
  开发者回答“都用推荐”时，剩下的问题全部按推荐项处理，不再追问。
- **超时不是回答**：提问超时或被跳过时再问一次；仍无回答就停下，说明还缺什么，不要替开发者选。
- **不改 skill**：skill 只读、原样复制。交付不完整（缺 `SKILL.md`、frontmatter 缺 `name`/`description`、
  skill 里带了 `hook.json`）时请开发者补交，不要替他改。
- **提交前先问**：每个流程结束都汇报结果并询问是否提交；没有确认不提交。

## A. 登记

### A1. 定位 skill 并读取

1. 找到 skill 目录：开发者给了路径就用该路径；只给了名字，就在本仓库、已连接的文件夹和上传目录中
   查找名为该名字或 frontmatter `name` 等于该名字的目录。找到多个时让开发者选；找不到时请他给出路径。
2. 运行 `python scripts/feature_register.py inspect <skill-dir>`。它输出 JSON：类型建议及依据、
   候选 feature_id（及是否已被占用）、候选触发词、是否需要真机、步骤（milestones）、
   可选的准出条件、skill 提到的 `ohos.permission.*`、需要被主流程覆盖的 skill 指令，以及已登记的 feature。
   `problems` 非空时先处理交付问题。
3. 通读 `SKILL.md` 以及它引用的文件。inspect 只是启发式提示：以你读到的内容为准，修正它的建议
   （例如去掉不像迁移用户会说的触发词、补上 skill 里真正的验收脚本）。

### A2. 问答（按轮进行）

**第 1 轮：这是什么**

| 问题 | 选项来源 | 说明 |
|---|---|---|
| 类型 | inspect `kind`，附一句依据 | “鸿蒙能力（第 6 阶段接入，会改应用代码）”/“验收流程（第 8 阶段交付前运行，只记录不修改）” |
| feature ID | inspect `feature_id` 中未被占用的项 | 命名规则见 RULES.md 第 4 节 |
| 中文名称 | 由 skill 的标题或 description 拟 2 个 | 候选列表里展示给迁移用户 |
| 负责人 | 开发者本人 / skill frontmatter 中的作者（若有） | 读不出时必须问 |

**第 2 轮：什么时候用**

| 问题 | 选项来源 | 说明 |
|---|---|---|
| 触发词（多选） | inspect `keywords` + 你读 skill 补充的说法 | 迁移用户提需求时可能说的词；只用于在候选里排前面，不会自动启用 |
| 一句话简介 | 由 description 拟 2 个 | 写进 registry 的 summary |
| 依赖其他 feature | 同类型的已登记 feature + “不依赖（推荐）” | 写进 `hook.after` |

**第 3 轮：怎样算完成**

| 问题 | 选项来源 | 说明 |
|---|---|---|
| 是否需要真机 | inspect `device` 及其依据 | 需要时准出要求有真机运行证据 |
| 完成标准（多选） | inspect `exit_options` | “迁移记录里本 feature 的验证项全部通过”始终包含，不必提问；可再加 skill 自带脚本退出码为 0、skill 报告文件中结论为通过 |
| 步骤 | inspect `milestones`（skill 的步骤标题）或默认三步 | 用于进度展示；可合并或改名 |

选了脚本作为完成标准时，先按 RULES.md 第 6 节的 `command` 约束读脚本；不满足时告诉开发者，
并改用“报告文件结论”或只保留验证项通过。

**第 4 轮：与主流程冲突的指令**

把 inspect `overrides` 与你阅读时发现的冲突合并成一张清单（skill 原文位置 → 主流程中的处理方式），
例如联网安装依赖、自带状态或输出目录、验收 skill 的“发现问题直接修”、自带的阶段划分、读写签名材料。
只问一题：“以下 skill 指令在迁移中按主流程处理，是否同意？”选项为“全部同意（推荐）”和“逐条调整”。
这份清单会原样写进接入说明的“执行入口”。

最后告诉开发者：新登记的 feature 状态为 `draft`，迁移用户暂时看不到它；发布见流程 C。

### A3. 生成与填写

1. 生成包：

   ```bash
   python scripts/feature_register.py scaffold --skill <skill-dir> --id <feature-id> \
     --kind capability|verification --title "<中文名称>" --owner "<负责人>" --summary "<一句话>" \
     --keyword "<词>" [--keyword ...] --device yes|no [--milestone "<步骤>" ...] [--after <feature-id> ...] \
     [--exit-command "python3 {package}/skill/<脚本> <参数>"] \
     [--exit-artifact <workdir 内文件名> --exit-json <键>=<值> ...]
   ```

   它会复制 `_templates/<kind>/`，把 skill 原样复制到 `features/<feature-id>/skill/`
   （仅略过顶层 `.git`，并逐文件核对哈希），按回答填好 `hook.json`，并在 `registry.tsv` 追加 `draft` 行。
   skill 若已经放在 `features/<feature-id>/skill/`，`--skill` 直接指向它即可。
2. 按 RULES.md 第 7 节填完接入说明 `features/<feature-id>/feature.md` 中所有 `TODO`。这部分不再提问，
   全部由你根据 skill 原文与问答结果写出，并引用 skill 内的具体文件与章节。第 4 轮确认的冲突清单写进
   “执行入口”；skill 提到的权限写进“前置条件”。scaffold 没覆盖的 `hook.json` 细节（如 `refs`、
   `entry.requires` 的额外条件）也在这一步按 RULES.md 第 5、6 节补齐。
3. 运行 `python scripts/feature_hooks.py lint <feature-id>`，直到输出 `OK`，并且没有 `TODO placeholder` 警告；
   然后运行全量 `python scripts/feature_hooks.py lint`。

### A4. 汇报

用几句话汇报：feature ID、类型、触发词、完成标准、需要真机与否、被主流程覆盖的指令数量、状态 `draft`，
以及包的位置。然后询问是否提交，提交信息如 `Add harmonyos-nfc-share feature`。

## B. 升级

1. 确认 feature 已登记，并找到新版本 skill；对新版本运行 `inspect` 并通读，与 `features/<id>/skill/`
   比较：新增、删除、改动了哪些文件，步骤、脚本、输出文件、权限、需被覆盖的指令有没有变化。
2. 整目录替换 `features/<id>/skill/`（原样复制，只略过顶层 `.git`；不要在旧目录上逐个改文件），
   更新 `hook.json` 的 `version`。
3. 变化影响到问答结果时（例如验收脚本改名、新增真机步骤、新的冲突指令），只就变化的部分提问，
   推荐项沿用原登记；然后按 RULES.md 更新 `hook.json` 和接入说明。
4. `lint` 通过且无 `TODO` 警告。汇报变化摘要，并提醒：包哈希已变，已激活但未关闭这个 feature 的迁移
   需迁移用户决定后 `repin`（RULES.md 第 10 节）。询问是否提交，提交信息如 `Update harmonyos-nfc-share to 1.3.0`。

## C. 发布（`draft` → `beta` / `stable`）

1. 按 RULES.md 第 9 节逐项自查，给出每一项的结论与依据；有不满足的项就停下并说明，保持 `draft`。
2. 全部满足时，问开发者发布为 `beta` 还是 `stable`（推荐 `beta`，除非已在真实迁移中跑通过），
   修改 `registry.tsv` 的 `status`，再跑全量 `lint`。
3. 汇报：发布后迁移用户在阶段 3 会看到这个 feature（仍需用户选择才会使用）。询问是否提交，
   提交信息如 `Release harmonyos-nfc-share as beta`。

## D. 修改

1. 只改开发者要求的部分（触发词、负责人、简介、完成标准、依赖、步骤等），registry 与 `hook.json`
   保持一致；涉及完成标准时同步更新接入说明的“准出对照/判定规则”。
2. 不修改 `skill/`；要改 skill 内容请开发者交付新版本，按流程 B 处理。
3. `lint` 通过后汇报改动；修改已发布的包同样会改变包哈希（RULES.md 第 10 节）。询问是否提交。

## E. 查看

运行 `python scripts/feature_hooks.py list`，用一张表列出 feature ID、名称、类型、状态、负责人和简介；
需要细节时再读对应的 `hook.json`。

## 示例

> 开发者：把 D:\skills\nfc-share 这个 skill 登记为外部 feature
>
> agent：（inspect + 通读 SKILL.md）
> 第 1 轮：类型？① 鸿蒙能力（推荐：skill 讲的是接入权限和接口，并改应用代码）② 验收流程。
> ID？① harmonyos-nfc-share（推荐）② nfc-share。名称？① 碰一碰分享（推荐）② NFC 分享。
> 负责人？① 你本人 ② 其他（请填写）。
>
> 开发者：都用推荐，负责人 team-x
>
> agent：（其余按推荐项处理，scaffold → 填写接入说明 → lint OK）
> 已登记 harmonyos-nfc-share（draft）：鸿蒙能力，第 6 阶段；触发词 碰一碰 / tap to share；
> 完成标准：验证项全部通过且需真机；skill 中 1 条联网安装依赖的指令改为在前置条件中列出。是否提交？
