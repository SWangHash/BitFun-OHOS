# RangeError Crash Patterns

## Pattern Matrix

| Error message keyword | Analysis conclusion | Fix suggestion |
| --- | --- | --- |
| `Invalid array length` | 数组长度为负数或超长。 | 检查长度计算逻辑，限制数组长度范围。 |
| `Stack overflow` | 函数递归调用导致栈空间溢出。 | 检查递归终止条件；必要时改写为循环形式。 |

## Credibility Rules

- HIGH: `Reason`, complete `Error message`, `Error code` (if any) and top application stack frame all support the same pattern.
- MEDIUM: Missing error code or stack frame, but `Reason` and `Error message` clearly match a pattern.
- LOW: Only fragmented log, or needs SourceMap / business code to confirm.

