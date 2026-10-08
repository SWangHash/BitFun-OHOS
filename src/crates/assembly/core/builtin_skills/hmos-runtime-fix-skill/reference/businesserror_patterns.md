# BusinessError Crash Patterns

## Pattern Matrix

| Error message keyword | Analysis conclusion | Fix suggestion |
| --- | --- | --- |
| `Unexpected Text in JSON` + `SyntaxError` | 应用捕获 JSON `SyntaxError` 后通过 `BusinessError` 抛出，未处理导致闪退。 | 结合栈顶代码定位异常抛出位置；解析 JSON 前校验格式，并在抛出点捕获处理。 |
| `Parameter error` | 参数类型或取值错误，未处理导致闪退。 | 对照接口文档传入正确参数类型和范围；在调用前校验。 |
| `unterminated entity ref` | XML/HTML 中特殊字符未正确转义。 | 检查解析文本中的特殊字符，例如 `&` 需要正确转义为 `&amp;`。 |
| `Syntax Error. Invalid Url string` / `10200002` | URL 字符串格式非法。 | 检查 URL 格式是否符合 `parseURL` 等接口要求。 |
| `Syntax Error. Invalid Uri string` / `10200002` | URI 字符串非法，例如 path 不符合规则或 `#` 位于首字符。 | 检查 URI 格式、路径、片段和编码，按 `@ohos.uri` 规范构造。 |

## Credibility Rules

- HIGH: `Reason`, complete `Error message`, `Error code` (if any) and top application stack frame all support the same pattern.
- MEDIUM: Missing error code or stack frame, but `Reason` and `Error message` clearly match a pattern.
- LOW: Only fragmented log, or needs SourceMap / business code to confirm.
