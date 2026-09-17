# BitFun → BitFun Data Migrator

将旧版 BitFun 的配置、会话、工作区及其他受支持数据迁移到 BitFun。迁移器保留旧版数据，不会自动删除 BitFun 的数据目录。

Migrate settings, sessions, workspaces, and other supported data from BitFun to BitFun. The migrator preserves the original BitFun data and does not automatically delete its data directories.

最新版本与使用指南：[中文](https://github.com/GCWing/BitFun/blob/main/src/apps/data-migrator/README.zh-CN.md) · Latest release and guide: [English](https://github.com/GCWing/BitFun/blob/main/src/apps/data-migrator/README.md)

## 中文

### 支持版本

- **来源：BitFun 0.2.17～0.2.19 正式版。**
- **目标：BitFun 1.0。**
- 暂不支持直接迁移 BitFun 0.2.16 及更早版本。请先升级旧版 BitFun，并启动确认原有数据正常后再迁移。

### 如何使用

1. 下载本 Release 中适合你系统的迁移器，完成解压（如有）。Windows 用户解压 ZIP 后双击迁移器运行。
2. 完全退出 BitFun 和 BitFun。
3. 使用原来运行 BitFun 的系统用户启动迁移器。
4. 按界面提示确认来源和目标目录，选择需要迁移的数据，然后开始迁移。
5. 迁移完成后，检查结果中的警告和跳过项，再启动 BitFun 确认数据。

建议迁移前备份数据，并在确认迁移结果前保留旧版 BitFun 数据。中断的迁移可以从已保存的迁移任务中恢复。

### 异常排障

**迁移完成，但工作区或会话为空、部分数据缺失**

如果之前已经启动过 BitFun 或执行过迁移，目标目录中的已有数据可能被优先保留，重试时不会覆盖。

如果 BitFun 中没有需要保留的新数据，可以清空目标数据后重新迁移：

1. 完全退出 BitFun、BitFun 和迁移器。
2. 备份以下目录，然后删除它们。**这会清除 BitFun 的现有配置、会话及其他本地数据。**
3. 重新运行迁移器，完成后再启动 BitFun。

Windows 目标目录：

```text
%APPDATA%\bitfun
%USERPROFILE%\.bitfun
%LOCALAPPDATA%\BitFun
```

**重试后仍然异常**

请在 [GitHub Issues](https://github.com/GCWing/BitFun/issues) 提交问题，或在 BitFun 用户微信群中反馈，并提供：

- 操作系统、BitFun 版本、BitFun 版本和迁移器版本。
- 操作步骤、预期结果及实际结果。
- 缺失数据所属的工作区、会话名称或 ID。
- 对应运行的迁移日志。

Windows 迁移日志目录：

```text
%APPDATA%\bitfun\data\migrations\bitfun-to-bitfun\runs\<运行ID>\
```

请提供对应运行目录中的日志文件，例如 `report.json`、`plan.json`、`journal.jsonl`、`locations.json` 和 `release-observation.json`（如存在）。`stage` 和 `backup` 目录包含个人数据，是否一并提供可自行选择；初次反馈通常只需上述日志文件。如果准备清空目标目录重试，请先保存这份日志。

提交前请检查日志中的用户名、路径等个人信息，按需脱敏。

### 下载校验

每个安装包均附带 SHA-256 校验文件和 minisign 分离签名。该发布流程未配置平台代码签名或 macOS 公证。兼容性、恢复及签名校验说明请参阅本 Release 标签下的迁移器 README。

## English

### Supported versions

- **Source: stable BitFun releases 0.2.17–0.2.19.**
- **Target: BitFun 1.0.**
- Direct migration from BitFun 0.2.16 or earlier is not supported. Upgrade BitFun first, then launch it and verify that your existing data is accessible before migrating.

### How to use

1. Download the migrator for your system from this release and extract it if necessary. On Windows, extract the ZIP and double-click the migrator.
2. Fully quit BitFun and BitFun.
3. Run the migrator under the same system account you used for BitFun.
4. Follow the prompts to confirm the source and destination directories, select the data to migrate, and start migration.
5. Review any warnings or skipped items, then launch BitFun and check your data.

Back up your data before migrating. Keep the original BitFun data until you have verified the results. Interrupted runs can be resumed from saved migration tasks.

### Troubleshooting

**Migration finishes, but workspaces or sessions are empty, or some data is missing**

If you have already launched BitFun or run a migration, existing destination data may take precedence and remain unchanged during retries.

If BitFun contains no new data you need to keep, you can clear its destination data and retry:

1. Fully quit BitFun, BitFun, and the migrator.
2. Back up the following directories, then delete them. **This removes existing BitFun settings, sessions, and other local data.**
3. Run the migrator again, then launch BitFun after migration finishes.

Windows destination directories:

```text
%APPDATA%\bitfun
%USERPROFILE%\.bitfun
%LOCALAPPDATA%\BitFun
```

**The issue persists after retrying**

Open a report in [GitHub Issues](https://github.com/GCWing/BitFun/issues) or share your feedback in the BitFun user WeChat group. Include:

- Your operating system and the BitFun, BitFun, and migrator versions.
- Steps to reproduce, the expected result, and the actual result.
- The workspace and session name or ID associated with missing data.
- Migration logs from the affected run.

Windows migration log location:

```text
%APPDATA%\bitfun\data\migrations\bitfun-to-bitfun\runs\<run-id>\
```

Provide the log files from the affected run, such as `report.json`, `plan.json`, `journal.jsonl`, `locations.json`, and `release-observation.json` when present. The `stage` and `backup` directories contain personal data, so sharing them is optional and at your discretion; the log files listed above are usually sufficient for an initial report. Save the logs before clearing the destination directories for another attempt.

Review the logs for personal information, such as usernames and paths, and redact it as needed before submitting.

### Download verification

Each package includes a SHA-256 checksum file and a detached minisign signature. Platform code signing and macOS notarization are not configured by this release workflow. See the migrator README at this release tag for compatibility, recovery, and signature verification details.
