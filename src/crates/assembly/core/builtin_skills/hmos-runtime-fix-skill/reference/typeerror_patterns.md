# TypeError Crash Patterns

## Pattern Matrix

| Error message keyword | Analysis conclusion | Fix suggestion |
| --- | --- | --- |
| `Cannot read property` + `undefined/null` / `Cannot load property of null or undefined` | 变量不是预期对象，不能访问目标属性。 | 使用变量前校验对象存在，并检查接口返回、异步时序和默认值。 |
| `is not callable` | 变量或 `this` 不是预期函数对象，不能调用目标方法。 | 检查方法是否存在、`this` 绑定是否正确、对象类型是否符合预期。 |
| `Receiver is not a JSObject` | 传入值不是有效 JavaScript 对象。 | 校验传入对象类型和结构，必要时在边界处做严格数据校验。 |
| `Can not get Prototype on non ECMA Object` | `napi_value` 的使用范围可能超出 `napi_handle_scope` 作用域。 | 检查 N-API handle scope 的打开、关闭和 `napi_value` 生命周期。 |
| `Cannot convert a illegal value to a Primitive` | 非法值无法转换为原始类型。 | 确保对象正确实现 `valueOf()` 或 `toString()`，且返回有效原始值。 |
| `stack contains value` / `circular structure` | 对象存在循环引用，常在 `JSON.stringify` 或深拷贝时触发。 | 使用 `WeakSet` 检测并过滤循环引用，或重构数据结构避免环。 |

## Credibility Rules

- HIGH: `Reason`, complete `Error message`, `Error code` (if any) and top application stack frame all support the same pattern.
- MEDIUM: Missing error code or stack frame, but `Reason` and `Error message` clearly match a pattern.
- LOW: Only fragmented log, or needs SourceMap / business code to confirm.

