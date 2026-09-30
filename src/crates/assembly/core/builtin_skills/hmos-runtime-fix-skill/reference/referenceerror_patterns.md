# ReferenceError Crash Patterns

## Background

- `@Provide` / `@Consume` 用于父组件与后代组件双向数据同步，变量名或别名必须正确匹配。

## Pattern Matrix

| Error message keyword | Analysis conclusion | Fix suggestion |
| --- | --- | --- |
| `missing @Provide property` / `Fail to resolve @Consume` | 初始化 `@Consume` 变量时，没有定义对应名称的 `@Provide` 变量。 | 检查变量是否存在；若存在，在父组件中定义并赋值对应 `@Provide`。 |
| `duplicate @Provide property` / `@Provide override not allowed` | 同名 `@Provide` 属性在祖先组件中已存在，不允许重复提供或覆盖。 | 删除重复 `@Provide`，或更改变量名/别名，避免祖先链路冲突。 |
| `is not initialized` | 变量未初始化即被访问。 | 初始化对应变量，或在使用前增加空值/状态校验。 |

## Credibility Rules

- HIGH: `Reason`, complete `Error message`, `Error code` (if any) and top application stack frame all support the same pattern.
- MEDIUM: Missing error code or stack frame, but `Reason` and `Error message` clearly match a pattern.
- LOW: Only fragmented log, or needs SourceMap / business code to confirm.

## Related Files

- [Fault mode library](./fault-mode-library.md) — covers `super()` before `this`, `<name> is not defined`
