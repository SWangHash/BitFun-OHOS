---
name: arkts-runtime-fix-cn
description: ArkTS Runtime Fix 的中文参考版本，仅用于保留中文说明，不作为主入口 skill。
---

# ArkTS Runtime Fix（中文参考）

本技能通过 **skill 私有脚本**（Node）完成证据采集与结构化解析，不再使用全局崩溃分析工具。设备枚举与日志采集优先走 `devecocli device list` / `devecocli log`。执行前若环境无 `node`，须停止并向用户说明。

## 症状与触发

在以下情况必须加载本技能：

- 日志中出现 `TypeError`、`ReferenceError`、`RangeError`、`SyntaxError`、`BusinessError` 等运行时异常
- 应用启动闪退、白屏、点击后崩溃
- 用户提供 `jscrash` 日志、堆栈、`@file` 临时日志文件
- 构建成功但运行期立即失败

## 证据优先约束

在已拿到以下锚点之前，避免对工程做大规模 `Read` / `Glob` / `Explore`：

- `error_type`
- `error_message`
- `suspected_file`
- `top_stack`
- 或者用户明确指出的崩溃页面 / 模块

在证据不足时，可以执行本节的私有脚本、向用户追问复现与包名、或读取用户已显式给出的单个日志文件路径。

一旦锚点齐备，再定向读取疑似 `ets/ts/js` 与相关导航入口，做最小修改。

## 私有脚本执行约定

所有脚本通过 Shell 执行，形式与 `deveco-create-project` 一致：

```bash
node "{SKILL_DIR}/scripts/<script>.mjs" ...
```

`{SKILL_DIR}` 由执行环境替换为当前技能根目录的绝对路径。脚本 `stdout` 采用稳定 `key: value` 行文本；退出码非 0 表示当前步骤无法继续，应向用户报告 `next_action` 中的原因并停止。

## 场景 A：用户已提供原始日志文本

```bash
node "{SKILL_DIR}/scripts/jscrash-report.mjs" --log-text "{crashLog}" --bundle-name "{bundleName}" --include-text
```

## 场景 B：用户提供 `@file` 或本地日志路径

```bash
node "{SKILL_DIR}/scripts/parse-jscrash-log.mjs" --log-file "{logFilePath}" --bundle-name "{bundleName}" --include-text
```

## 场景 C：仅有症状，无日志

设备采证前必须先读取 `AppScope/app.json5` 中的 `app.bundleName`，作为后续 `--bundle-name` 的精确值；禁止用 `vendor`、`com.example` 或模块目录名猜测。

先探测 faultlogger 近期 `jscrash-*.log`：

```bash
node "{SKILL_DIR}/scripts/probe-faultlogger.mjs" --bundle-name "{bundleName}" --device-id "{deviceId}" --max-age-minutes "30" --limit "10"
```

- 若输出 `status: found`：读取 `latest_faultlog` 或 `candidates`，再拉取并解析：

```bash
node "{SKILL_DIR}/scripts/fetch-faultlog.mjs" --faultlog-name "{latestFaultlog}" --device-id "{deviceId}" --output-dir "{tempDir}"
node "{SKILL_DIR}/scripts/parse-jscrash-log.mjs" --log-file "{localFaultlogPath}" --bundle-name "{bundleName}" --source file --include-text
```

- 若输出 `status: not_found` 或 `status: probe_failed`：可按需进入基于 `devecocli log` 的 hilog 兜底采集：

```bash
node "{SKILL_DIR}/scripts/collect-hilog.mjs" --device-id "{deviceId}" --lines "4000" --output-dir "{tempDir}"
node "{SKILL_DIR}/scripts/parse-jscrash-log.mjs" --log-file "{hilogPathFromCollect}" --bundle-name "{bundleName}" --source hilog --include-text
```

## 解析输出字段契约

`jscrash-report.mjs` 和 `parse-jscrash-log.mjs` 首段 `key: value` 行包含：

- `status`: `detected` | `no_crash_signature` | `parse_failed`
- `source`: `file` | `text` | `hilog` 等
- `error_type`
- `error_message`
- `suspected_file`
- `top_stack`: 以 `|` 分隔的帧列表
- `keywords`: 逗号分隔
- `next_action`

`--include-text` 会在其后追加人类可读完整报告。

若 `status: no_crash_signature`，须向用户说明证据不足，请求复现或更完整日志后再读代码。

## 常见崩溃签名

解析出信号后先定位根因，再对照 `references/` 对应文件确认后修改。必须同时用 `Error message` + `Error code` + 栈顶应用帧三者相互印证，单一弱信号不足以定性。

| 错误类型 / 消息关键字 | 根因 | 参考文件 |
|---|---|---|
| `ReferenceError` + `@Provide` / `@Consume` | @Provide/@Consume 缺失或重复 | `references/referenceerror_patterns.md` |
| `ReferenceError` + `is not initialized` | 变量在使用前赋值 | `references/referenceerror_patterns.md` |
| `ReferenceError` + `<name> is not defined` | 作用域或导入缺失 | `references/fault-mode-library.md` |
| `TypeError` + `Cannot read property` / `null or undefined` | 渲染 / 生命周期中访问 undefined/null 属性 | `references/typeerror_patterns.md` |
| `TypeError` + `is not callable` | 调用了非函数值 | `references/typeerror_patterns.md` |
| `TypeError` + `circular structure` | JSON.stringify 循环引用 | `references/typeerror_patterns.md` |
| `SyntaxError` + `Unexpected Text in JSON` / `Invalid Token` | JSON.parse 输入非法 | `references/syntaxerror_patterns.md` |
| `RangeError` + `Invalid array length` / `Stack overflow` | 数组长度非法或递归无界 | `references/rangeerror_patterns.md` |
| `URIError` + `DecodeURI: invalid character` | decodeURI 传入非法 URI | `references/urierror_patterns.md` |
| `Error` + `UI execution context not found` / `100001` | UI 上下文未绑定；改用 `Navigation` 或 `UIContext.getRouter()` | `references/error_patterns.md` |
| `Error` + `WebviewController must be associated` / `17100001` | WebviewController 未与 Web 组件关联 | `references/error_patterns.md` |
| `Error` + `ForEach id` / id 生成器 | `ForEach` keyGenerator 缺失或非法 | `references/error_patterns.md` |
| `Error` + SQLite / RDB / 资源 ID / 窗口状态 | 数据库句柄、资源 ID 或窗口 API 误用 | `references/error_patterns.md` |
| `BusinessError` + `Parameter error` / URL / JSON / XML | API 参数类型或取值非法 | `references/businesserror_patterns.md` |
| `OutOfMemoryError` + allocate / leak | 堆分配失败或内存泄漏 | `references/outofmemoryerror_patterns.md` |
| `TerminationError` / `AggregateError` / `ArrayBuffer` 已分离 | 运行时生命周期与 ArkTS 集合 / 类型陷阱 | `references/fault-mode-library.md` |

## 错误模式知识库

修改前先读取本技能目录下匹配的 `references/` 文件。每个文件包含模式矩阵与可信度规则，用于确认命中而不是凭单个关键字臆断：

| 文件 | 覆盖范围 |
|---|---|
| `references/typeerror_patterns.md` | TypeError：空值访问、不可调用、循环引用、N-API 接收者 |
| `references/referenceerror_patterns.md` | ReferenceError：@Provide/@Consume、变量未初始化 |
| `references/syntaxerror_patterns.md` | SyntaxError：JSON.parse 输入非法 |
| `references/rangeerror_patterns.md` | RangeError：数组长度非法、栈溢出 |
| `references/urierror_patterns.md` | URIError：decodeURI 非法字符 |
| `references/error_patterns.md` | 框架/API Error：UI 上下文、WebviewController、ForEach、SQLite/RDB、资源 ID、窗口状态 |
| `references/businesserror_patterns.md` | BusinessError：API 参数非法（URL/JSON/XML、权限、调用时机） |
| `references/outofmemoryerror_patterns.md` | OutOfMemoryError：堆分配失败或泄漏 |
| `references/fault-mode-library.md` | 跨场景 ArkTS 陷阱：N-API、ArrayBuffer、Map 构造、TerminationError、AggregateError |

拿到 anchor 后的步骤：按 `error_type` 选候选文件 → 用消息 + 错误码 + 栈顶应用帧三者确认 → 对栈中疑似文件做最小修复，不做大范围重构。

## 解释规则

- 应用栈优先于框架噪声；首个具体 `.ets/.ts/.js` 路径是起点而非唯一根因。
- 若用户给出复现步骤，步骤优先于单纯堆栈推断。
- 若堆栈指向非入口页，默认视为交互触发路径，除非证据表明仅冷启动。
- 不做大范围重构，先消除崩溃路径。

## 交互建议

1. 先说明当前已有的证据。
2. 如果证据不足，再说明是否按需检查 faultlogger 或 hilog。
3. 一旦拿到锚点，就切换到定向读代码和最小修复。

## 约束

- 不得仅凭推理声称已修复崩溃。
- 不得用重试、随意延时或大面积防御性改写替代根因修复。
- 涉及不熟悉的 `@ohos.*` / `@kit.*` API 时，应先查证约束再改代码。
- 本技能不决定最终的编译 / 运行 / 验证顺序；主 Agent 负责后续验证。
