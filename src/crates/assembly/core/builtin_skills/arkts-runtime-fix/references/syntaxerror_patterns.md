# SyntaxError Crash Patterns

## Pattern Matrix

| Error message keyword | Analysis conclusion | Fix suggestion |
| --- | --- | --- |
| `Unexpected Text in JSON` / `Invalid Token` | 字符串格式不符合 JSON 语法，常在 `JSON.parse` 时触发。 | 解析前检查内容是否为有效 JSON，避免解析非 JSON 数据或包含非法字符的数据。 |

## Credibility Rules

- HIGH: `Reason`, complete `Error message`, `Error code` (if any) and top application stack frame all support the same pattern.
- MEDIUM: Missing error code or stack frame, but `Reason` and `Error message` clearly match a pattern.
- LOW: Only fragmented log, or needs SourceMap / business code to confirm.

