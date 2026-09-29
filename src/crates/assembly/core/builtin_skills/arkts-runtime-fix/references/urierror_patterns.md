# URIError Crash Patterns

## Pattern Matrix

| Error message keyword | Analysis conclusion | Fix suggestion |
| --- | --- | --- |
| `DecodeURI: invalid character` | URL 无效，`DecodeURI` 抛出异常导致闪退。 | 确保 URL 真实有效、编码合法；使用 `try-catch` 捕获并处理异常。 |

## Credibility Rules

- HIGH: `Reason`, complete `Error message`, `Error code` (if any) and top application stack frame all support the same pattern.
- MEDIUM: Missing error code or stack frame, but `Reason` and `Error message` clearly match a pattern.
- LOW: Only fragmented log, or needs SourceMap / business code to confirm.

## Related Files

- [Fault mode library](./fault-mode-library.md) — covers `DecodeURI: invalid character: <string>`
