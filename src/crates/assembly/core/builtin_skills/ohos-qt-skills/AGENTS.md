# 维护本 skill 的 agent 须知

本仓库是 `qt-harmonyos-migration` skill 本身（入口为 `SKILL.md`）。迁移任务按 `SKILL.md` 执行；以下内容只适用于**维护** skill 的场景。

## 同步上游知识库

当用户提到“同步上游知识库”“更新知识库”“拉取 ohos_qt-skills”等，并且可能附带“本地路径为 xxx / git 路径为 xxx / 分支为 xxx”时：

1. 阅读并严格遵循 [`upstream-kb/AGENTS.md`](upstream-kb/AGENTS.md)。
2. 所有与上游的交互都通过 `upstream-kb/scripts/sync_upstream.py`（plan → 审阅 `.sync/review.tsv` → apply）和 `upstream-kb/scripts/verify_kb.py` 完成。
3. 不要手工编辑 `upstream-kb/knowledge/` 或 `upstream-kb/manifest.tsv`。在用户确认之前不要提交。
4. 同步只改 `upstream-kb/` 目录。不要把具体的知识库内容（某个页面、错误码或工具的介绍和用法）写进 `SKILL.md`、`README.md`、`references/` 或 `features/`；`SKILL.md` 只描述通用机制。

## 登记外部 feature

`features/` 下有三份文档：`README.md` 给特性开发者看（简介与 prompt 示例），`RULES.md` 是包的规则（写 `hook.json`、`feature.md`、`registry.tsv` 时以它为准），`REGISTER.md` 是给你的操作流程。

当用户说“把 xxx（这个 skill）登记为外部 feature”，或要升级、发布、修改、查看外部 feature 时，按 [`features/REGISTER.md`](features/REGISTER.md) 中对应的流程进行。登记是问答式的：先用 `scripts/feature_register.py inspect` 并通读 skill，再用带推荐项的选择题问开发者（最多 4 轮），然后用 `feature_register.py scaffold` 生成包并填写接入说明。不要求开发者事先准备任何描述。

新增或修改 `features/` 下的 feature 包（鸿蒙能力或外部验收流程）时：

1. 遵循 [`features/RULES.md`](features/RULES.md)：feature 一律以 skill 交付，从 `features/_templates/<kind>/` 复制骨架（通常由 `feature_register.py scaffold` 完成），把 skill 原样放到 `features/<feature-id>/skill/`，在 skill 外面写 `hook.json` 与接入说明 `feature.md`；不要修改 skill 内的任何文件，也不要往里添加文件。接入说明的每一节（包括“结果记录”“准出对照”）都由你读完 skill 后填写，不要求 skill 开发者提供；读不出的信息（如真机要求、负责人）再问用户。
2. 运行 `python scripts/feature_hooks.py lint <feature-id>` 直到输出 `OK`；在 `features/registry.tsv` 登记（新包先 `draft`），再跑一次全量 `lint`。
3. 改动机制本身（`scripts/feature_*.py`、`phase_gate.py` 的 feature 规则）后运行 `python -m unittest discover -s tests`。
4. 修改已发布的包会改变包哈希，影响进行中的迁移；在提交说明中写明。在用户确认之前不要提交，提交信息如 `Add harmonyos-share feature`。

## 其他约定

- 提交信息使用英文祈使句，例如 `Sync upstream KB to 2f9e4a0`。
- `upstream-kb/knowledge/**` 与 `upstream-kb/manifest.tsv` 按字节保存（见 `.gitattributes`），不要转换它们的换行符。
