# 维护本 skill 的 agent 须知

本仓库是 `qt-harmonyos-migration` skill 本身（入口为 `SKILL.md`）。迁移任务按 `SKILL.md` 执行；以下内容只适用于**维护** skill 的场景。

## 同步上游知识库

当用户提到“同步上游知识库”“更新知识库”“拉取 ohos_qt-skills”等，并且可能附带“本地路径为 xxx / git 路径为 xxx / 分支为 xxx”时：

1. 阅读并严格遵循 [`upstream-kb/AGENTS.md`](upstream-kb/AGENTS.md)。
2. 所有与上游的交互都通过 `upstream-kb/scripts/sync_upstream.py`（plan → 审阅 `.sync/review.tsv` → apply）和 `upstream-kb/scripts/verify_kb.py` 完成。
3. 不要手工编辑 `upstream-kb/knowledge/` 或 `upstream-kb/manifest.tsv`。在用户确认之前不要提交。
4. 同步只改 `upstream-kb/` 目录。不要把具体的知识库内容（某个页面、错误码或工具的介绍和用法）写进 `SKILL.md`、`README.md`、`references/` 或 `features/`；`SKILL.md` 只描述通用机制。

## 其他约定

- 提交信息使用英文祈使句，例如 `Sync upstream KB to 2f9e4a0`。
- `upstream-kb/knowledge/**` 与 `upstream-kb/manifest.tsv` 按字节保存（见 `.gitattributes`），不要转换它们的换行符。
