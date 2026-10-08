---
name: hmos-runtime-fix-skill-cn
description: ArkTS Runtime Fix 的中文参考版本，仅用于保留中文说明，不作为主入口 skill。
---

# ArkTS Runtime Fix（中文参考）

本技能通过 `devecocli` 完成设备发现与日志采集，通过 **skill 私有脚本**（Node）完成结构化解析和本地快照处理。不得直接调用 `hdc`、读取 `DEVECO_HOME` 或依赖 DevEco Code 专用 Tool。执行前若环境无 `node`，须停止并向用户说明。

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

所有脚本和 `devecocli` 命令均通过 Shell 执行：

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

若用户未指定设备，先运行 `devecocli device list`。只有一个设备时直接使用；多个设备时须请用户选择；无设备时请求连接设备或提供本地日志。

用户在选定设备上复现后，获取并解析最新的匹配崩溃日志：

```bash
node "{SKILL_DIR}/scripts/jscrash-report.mjs" --bundle-name "{bundleName}" --device-id "{deviceId}" --include-text
```

未提供 `--log-text` 或 `--log-file` 时，`jscrash-report.mjs` 内部执行 `devecocli log --crash --device ... --bundle-name ...` 并解析输出。若没有匹配日志，应让用户立即复现后重试，不得仅凭症状猜测。

若崩溃日志不可用或证据不足，再进入 hilog 兜底采集。采集脚本内部执行 `devecocli log --device ... --tail ...`，自身仅负责写入本地快照：

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

## JSCrash 修复知识库

知识来源（已同步）：[hmos-jscrash-analysis](https://gitcode.com/HarmonyOS_Skills/harmonyos-agent-skills/tree/main/03-solutions/quality/stability/hmos-jscrash-analysis)。

解析崩溃证据并获取 `error_type` 后，必须按知识库匹配模式并应用对应修复建议。不得编造知识库以外的根因或修复方案。

### 知识库使用方法

1. 通过脚本解析崩溃证据，获取 `error_type`、`error_message` 和 `top_stack`。
2. 先读取 [reference/fault-mode-library.md](./reference/fault-mode-library.md)，按 `Reason` / `Error name` / `Error message` 匹配 `JSError` → 二级根因 → 三级根因。
3. 根据 `error_type`，只读对应的 patterns 文件：
   - `ReferenceError` → [reference/referenceerror_patterns.md](./reference/referenceerror_patterns.md)
   - `TypeError` → [reference/typeerror_patterns.md](./reference/typeerror_patterns.md)
   - `Error` → [reference/error_patterns.md](./reference/error_patterns.md)
   - `BusinessError` → [reference/businesserror_patterns.md](./reference/businesserror_patterns.md)
   - `SyntaxError` → [reference/syntaxerror_patterns.md](./reference/syntaxerror_patterns.md)
   - `RangeError` → [reference/rangeerror_patterns.md](./reference/rangeerror_patterns.md)
   - `OutOfMemoryError` → [reference/outofmemoryerror_patterns.md](./reference/outofmemoryerror_patterns.md)
   - `URIError` → [reference/urierror_patterns.md](./reference/urierror_patterns.md)
4. 多个模式命中时，优先选择 `Error message` + `Error code` + 栈顶应用帧同时支持的结论（见各 reference 文件可信度规则）。
5. 对堆栈中的疑似文件做最小定向修复，不做大范围重构。

### 快速参考

| 错误类型 / message 关键词 | 根因 | Reference 文件 |
|---|---|---|
| ReferenceError + `@Provide` / `@Consume` | @Provide/@Consume 缺失或重复 | [referenceerror_patterns.md](./reference/referenceerror_patterns.md) |
| ReferenceError + `is not initialized` | 变量在赋值前使用 | [referenceerror_patterns.md](./reference/referenceerror_patterns.md) |
| ReferenceError + `<name> is not defined` | 变量作用域或 import 缺失 | [fault-mode-library.md](./reference/fault-mode-library.md) |
| ReferenceError + `super()` 前访问 `this` | super() 未先于 this 调用 | [fault-mode-library.md](./reference/fault-mode-library.md) |
| TypeError + `Cannot read property` / `null or undefined` | 访问 undefined/null 的属性 | [typeerror_patterns.md](./reference/typeerror_patterns.md) |
| TypeError + `is not callable` | 调用了非函数值 | [typeerror_patterns.md](./reference/typeerror_patterns.md) |
| TypeError + `circular structure` | JSON.stringify 遇到循环引用 | [typeerror_patterns.md](./reference/typeerror_patterns.md) |
| TypeError + `Receiver is not a JSObject` / N-API scope | N-API receiver 类型不匹配 | [typeerror_patterns.md](./reference/typeerror_patterns.md) |
| SyntaxError + `Unexpected Text in JSON` / `Invalid Token` | JSON.parse 输入格式错误 | [syntaxerror_patterns.md](./reference/syntaxerror_patterns.md) |
| RangeError + `Invalid array length` | 数组长度为负或非整数 | [rangeerror_patterns.md](./reference/rangeerror_patterns.md) |
| RangeError + `Stack overflow` | 无限递归 | [rangeerror_patterns.md](./reference/rangeerror_patterns.md) |
| URIError + `DecodeURI: invalid character` | decodeURI 输入格式错误 | [urierror_patterns.md](./reference/urierror_patterns.md) |
| Error + `UI execution context not found` / `100001` | UI 上下文未绑定到 router | [error_patterns.md](./reference/error_patterns.md) |
| Error + `WebviewController must be associated` / `17100001` | WebviewController 未关联 Web 组件 | [error_patterns.md](./reference/error_patterns.md) |
| Error + `ForEach id` / id 生成函数 | ForEach keyGenerator 缺失或无效 | [error_patterns.md](./reference/error_patterns.md) |
| Error + `ArrayBuffer is null or detached` | 使用了已 detach 的 ArrayBuffer | [fault-mode-library.md](./reference/fault-mode-library.md) |
| Error + `Map's constructor cannot be directly invoked` | ArkTS Map 构造函数误用 | [fault-mode-library.md](./reference/fault-mode-library.md) |
| Error + SQLite / RDB / 资源 ID / 窗口状态 | DB 句柄、资源 ID 或窗口 API 误用 | [error_patterns.md](./reference/error_patterns.md) |
| BusinessError + `Parameter error` / URL / JSON / XML | API 参数类型或值无效 | [businesserror_patterns.md](./reference/businesserror_patterns.md) |
| OutOfMemoryError + 分配 / 泄漏 | 堆内存分配失败或内存泄漏 | [outofmemoryerror_patterns.md](./reference/outofmemoryerror_patterns.md) |
| TerminationError + `Terminate execution!` | 运行时强制终止 | [fault-mode-library.md](./reference/fault-mode-library.md) |
| AggregateError + `Promise.any()` 全部 reject | Promise.any() 中所有 promise 均 reject | [fault-mode-library.md](./reference/fault-mode-library.md) |

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
