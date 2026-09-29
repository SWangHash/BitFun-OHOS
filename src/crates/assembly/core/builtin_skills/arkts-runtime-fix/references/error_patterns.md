# Error (Framework / API) Crash Patterns

## Pattern Matrix

| Error message keyword | Analysis conclusion | Fix suggestion |
| --- | --- | --- |
| 应用自定义错误，如 `ApiError ...` | 应用业务代码主动抛出异常且未处理，导致闪退。 | 避免异常路径直达进程边界；使用 `try-catch` 捕获并转为可恢复状态或错误提示。 |
| `Invalid parameter` / `The parameter invalid` / `Invalid argument` | 非法参数触发异常，通常需结合栈顶代码确认具体入参。 | 修正参数类型、范围和必填项；调用前做输入校验。 |
| `No such file or directory` | 目录或文件不存在。 | 检查路径、权限、解压/下载时序；用 `try-catch` 处理缺失文件。 |
| `WebviewController must be associated with a Web component` / `17100001` | `WebviewController` 尚未和具体 Web 组件关联。 | 检查关联时序，可通过 `onControllerAttached()` 确认后再操作。 |
| `Invalid url` / `17100002` | URL 无效，或 URL 长度超过限制。 | 校验 URL 格式、协议、编码和长度，避免传入空值或超长值。 |
| `ForEach id` + `Need to specify id generator function` | 提供的数据结构不能被默认键值生成函数处理。 | 确保数据可被默认 key 生成函数序列化，或显式传入 `ForEach` 第三个参数作为自定义 key 生成函数。 |
| `SQLite: Generic error` / `14800021` | SQL 执行过程中出现通用错误。 | 分析并修正 SQL 语句、表结构、参数绑定和事务状态。 |
| `Column out of bounds` / `14800013` | 当前列号超出 `[0, columnCount - 1]`，或列值/列类型与接口不兼容。 | 检查 ResultSet 当前列号、列名、列数量和查询结果。 |
| `Invalid resource ID` | 传入资源 ID 不存在或不适用于当前包形态。 | 排查 HAR 开启混淆、中间码 HAR、字节码 HAR、跨 HAP/HSP 包等场景；优先通过资源名称方法如 `getStringByName()` 获取资源。 |
| `UI execution context not found` / `100001` | 在上下文不明确处使用全局 Router 等 UI 上下文相关能力。 | 推荐使用 `Navigation` 作为路由框架；或通过 `UIContext.getRouter()` 获取当前上下文关联的 Router。 |
| `Session not config` | 在会话未配置前调用需要会话配置的操作。 | 先调用对应 `commitConfig` 等配置接口，再执行后续操作。 |
| `This window state is abnormal` | 目标窗口未创建或已被销毁。 | 操作窗口前检查窗口存在且状态正常。 |
| `Already closed` / `14800014` | 数据库或 ResultSet 已关闭。 | 重新打开 `RdbStore` 或重新查询获取 `ResultSet`，确保对象未 `close`。 |
| `Invalid relative path` | 传入相对路径不符合预期。 | 校验相对路径格式、根目录和调用接口要求。 |
| `Service exception` + `invalid N-API status` | 服务或 N-API 调用状态异常，文档示例指向 motion 接口调用逻辑问题。 | 检查相关接口的参数、调用时序，尤其是 `on` / `off` 配对和状态管理。 |

## Credibility Rules

- HIGH: `Reason`, complete `Error message`, `Error code` (if any) and top application stack frame all support the same pattern.
- MEDIUM: Missing error code or stack frame, but `Reason` and `Error message` clearly match a pattern.
- LOW: Only fragmented log, or needs SourceMap / business code to confirm.

## Related Files

- [Fault mode library](./fault-mode-library.md) — covers `ArrayBuffer detached`, `Map constructor`
