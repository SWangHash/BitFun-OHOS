# 本地 AI 模型接口文档

> 端侧大模型服务（`com.huawei.hmos.hmmodelfoundation`），Ollama 兼容 HTTP API，监听 `127.0.0.1:11434`。
>
> 本文档记录 BitFun 实际使用的请求/响应参数，供本地模型对接与联调参考。

---

## 1. 接口列表

| 接口 | 方法 | 路径 | 用途 |
|---|---|---|---|
| 模型列表 | GET | `/api/tags` | 获取已安装模型 |
| 服务信息 | GET | `/api/version` | 服务名称与版本 |
| 对话补全 | POST | `/v1/chat/completions` | 发送消息并获取回复（流式） |
| 模型下载 | POST | `/api/pull` | 下载端侧模型 |

---

## 2. 对话补全 — 请求参数（POST /v1/chat/completions）

| 参数 | 二级参数 | 类型 | 必选 | 描述 |
|---|---|---|---|---|
| `model` | — | string | 是 | 模型名称 |
| `messages` | — | array | 是 | 聊天的消息，可用于保存聊天记忆。消息的role是system、user、assistant之一，第一条消息的role是system或user，最后一条消息的role是user：如不满足，通过HTTP接口返回400报错信息 |
| | `role` | string | 是 |消息的角色，可选system、user、assistant。 system:系统角色，当role为system时，content字段文本是系统prompt user：用户角色，当role为user时，content字段文本是用户输入的文本 assistant：模型·角色，当role为assistant时，content字段文本是模型输出的结果 |
| | `content` | string | 是 | 消息的内容 |
| | `name` | string | 否 | 不支持该项 |
| | `tool_call_id` | string | 否 | 不支持该项 |
| `stream` | — | boolean | 否 | 是否流式返回结果，不设置则为false。设置为false将按单个响应对象返回，而不是对象流 |
| `seed` | — | int | 否 | 固定seed且其他参数不变时，模型返回结果相同 |
| `max_completion_tokens` | — | Int | 否 | 生成文本的最大token数。不传递该参数（或者该参数值为-1）则不限制，实际端侧最大输出长度有上限（如8k） 取值范围>0 |
| `repeat_penalty` | — | Float | 否 | 设置对重复项的惩罚程度。较高的值（如1.5）将更强烈地惩罚重复，而较低的值（如0.9）将更宽松。取值范围：abs(repeat_penalty)>=1e-6。注意：这是 llama.cpp 命名，对应 OpenAI 的 frequency_penalty |
| `stream_options` | — | object | 否 | 不支持 |
| | `include_usage` | boolean | 否 | 不支持 |
| `tools` | — | array | 否 | 不支持 |
| `tool_choice` | — | string | 否 | 不支持 |
| `max_tokens` | — | integer | 否 | 不支持。或者与max_completion_tokens相同？ |
| `temperature` | — | number | 否 | 模型的温度。提高温度将更有创意地回复 |
| `top_p` | — | number | 否 | 采样参数，保留概率质量前top_p的token。较高的值将导致文本多样化，而较低的值将生成更集中和保守的文本。取值范围[0,1] |
| `stop` | — | String/Array | 否 | 用于控制模型何时停止生成文本并返回。可以指定多个单独的stop参数 |

---

## 3. 对话补全 — 响应参数（POST /v1/chat/completions）

| 参数 | 二级参数 | 三级参数 | 类型 | 必选 | 描述 |
|---|---|---|---|---|---|
| `id` | — | — | string | | 不支持该项？ |
| `object` | — | — | string | 是 | 返回的对象类型。OpenAI有两种：-"chat.completion.chunk":流式输出对象类型 - "chat.completion"：非流式输出对象类型 |
| `created` | — | — | integer | 是 | 生成响应的时间戳（单位：秒） |
| `model` | — | — | string | 是 | 模型名称 |
| `choices` | — | — | array | 是 | 聊天的消息 |
| | `index` | — | integer | 是 | 索引号。Index含义是同一个输入、要求输出不同个数的消息，比如为2时则每条响应消息对应index=0,1两条数据。这个能力暂不具备，因此index都是0 |
| | `delta` | — | object | 否 | 消息的内容（流式输出独有）。流式输出仅最后一块返回null |
| | | `role` | string | 否 | 仅支持assistant.流式输出中，仅第一个增量块包含此字段 |
| | | `content` | string | 是 | 消息的内容 |
| | | `reasoning_content` | string | | 不支持 |
| | | `tool_calls` | array | | 不支持 |
| | `finish_reason` | — | string | 否 | 停止生成的原因（仅流式输出最后一个数据块返回非null）。支持的值： -"stop" ：模型自然结束（例如：生成了停止标记） -"abort":由于其他原因中止（例如：模型推理过程中用户手动从内存中卸载模型） |
| | `message` | — | object | 否 | 消息的内容（非流式输出独有） |
| | | `role` | string | 是 | 仅支持assistant.非流式输出中，包含此字段 |
| | | `content` | string | 是 | 消息的内容 |
| `usage` | — | — | object | 否 | Token消耗统计 |
| | `prompt_tokens` | — | integer | 否 | 输入的token数量 |
| | `completion_tokens` | — | integer | 否 | 输出的token数量 |
| | `total_tokens` | — | integer | 否 | 总token数量 |

---

## 4. 模型下载 — 请求参数（POST /api/pull）

| 参数 | 二级参数 | 类型 | 必选 | 描述 |
|---|---|---|---|---|
| `model` | — | string | 是 | 模型名称|
| `stream` | — | boolean | 否 | 流式输出，不设置则为true。设置为false将作为单个响应对象返回，而不是对象流 |

---

## 5. 模型下载 — 响应参数（POST /api/pull，NDJSON 流式）

| 参数 | 二级参数 | 三级参数 | 类型 | 必选 | 描述 |
|---|---|---|---|---|---|
| `status` | — | — | string | 是 | 状态。 -"pulling digestname"：下载中 -"verifying sha256 digest"：验证中  -"success"：完成 -"paused":下载暂停状态 |
| `digest` | — | — | string | 是 | 模型文件校验码（sha256） |
| `total` | — | — | integer | 是 | 模型文件总大小（字节数） |
| `completed` | — | — | integer | 是 | 模型文件已下载大小（字节数） |
| `error` | — | — | string | 否 | 错误信息，仅在下载失败时出现。 |

---

## 6. 已知限制

- `role` 支持 `system`（仅第一条）、`user`、`assistant`；**不支持 `tool` / `function`**（设备实测确认）
- `content` 必须为非 null 字符串，不支持数组（content blocks）
- `tool_calls` 字段不被识别，工具调用协议未实现
- `finish_reason` 支持 `"stop"` / `"abort"`（自定义值，非 OpenAI 标准枚举）
- 流式最后一块 `delta` 为 `null`（非空对象，与 OpenAI 的 `{}` 不同）
- `stream_options` 不支持（usage 统计在流式模式下不可用）
- `max_tokens` 不支持（需用 `max_completion_tokens`）
- `frequency_penalty` 不支持（需用 `repeat_penalty`，BitFun 当前未发送此参数）
- 从 curl / shell 调用受 UID 白名单限制（`Call is not allowed, app is not in the whitelist`）
- 服务在无客户端连接时被系统回收，需持有 service-ability 连接保活

## 7. 上下文窗口限制（关键）

**超限行为**：服务不返回 400 报错，而是返回 HTTP 200 + 空 SSE 流（0 个内容 chunk），表现为应用侧 `"no effective output was received"` 循环重试。

**原因**：端侧 7B/8B 模型上下文窗口约 4K–8K token，长会话（30+ 轮）的完整历史远超窗口。推理引擎 token 化失败后静默产出 0 个 token，HTTP 层面一切"正常"。

**BitFun 适配**（`9cb0945ca`）：发请求前按 token 估算截断消息历史，只保留 system prompt + 最近消息（总计 ≤ 4096 token），确保不超窗口。

## 8. BitFun 适配器归一化规则（仅本地端点生效）

| 归一项 | 处理 | 提交 |
|---|---|---|
| `content: null` / 缺失 | 替换为空字符串 `""` | `07e0ac680` |
| `content: [...]`（Anthropic 数组） | 展平为拼接文本 | `dde7880b7` |
| `role: "tool"` / `"function"` | 改为 `"user"` | `db3711899` |
| `role: "system"` | **保留**（服务支持，设备实测确认） | `3a29cfed6` |
| `tool_calls` / `name` / `tool_call_id` / `reasoning_content` 等扩展字段 | 全部剥离（仅保留 `role` + `content`） | `dde7880b7` |
| `max_tokens` | 改用 `max_completion_tokens` | `3a29cfed6` |
| `stream_options` | 跳过不发 | `3a29cfed6` |
| SSE 最后一块 `delta: null` | 按 `Option<Delta>` 处理，`unwrap_or_default()` | `e05471086` |
| 消息历史超上下文窗口 | 截断至 ≤ 4096 token（保留 system + 最近消息） | `9cb0945ca` |

**云端模型不受任何影响**：归一化仅在 URL 为 `http://localhost:*` / `http://127.0.0.1:*` 时触发（`is_local_inference_endpoint` 判定）。云端走 `normalize_message_content_cloud`（仅填空 content + 展平数组，不动 role/字段）。
