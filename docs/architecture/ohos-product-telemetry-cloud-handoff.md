# OHOS 产品打点云侧协作说明

状态：端云对接提案，待双方确认。本文不代表云端已有接口，也不要求端侧团队实现云端代码。

已根据所提供 `api.zip` 中的 Telemetry API（变更记录至 1.3）、客户端遥测指南 v1.1、Auth API 和鉴权接入指南核对修订。完整冲突和证据索引见[API 兼容性核对](ohos-product-telemetry-api-compatibility.md)。HTTP 200、下游清洗和上墙是三个不同状态，本文不要求改变既有 ingress 的异步响应语义。

对应完整需求和端侧归属：[OHOS 产品使用打点端侧设计](ohos-product-telemetry-client-design.md)。本次全部点位作为同一范围实现，不拆批次；上线兼容通过云契约升级和部署确认解决，可另选自动能力协商。

## 1. 给云侧同事的说明

我们将为 OHOS PC / 平板 HAP 补齐功能使用、首次可观测转化、权限阻塞、鸿蒙开发、Qt 迁移、语音、分享、多端协作、扩展、MiniApp、记忆、定时、更新和稳定性事件。端侧继续通过现有匿名鉴权和 OTLP ingress 上传，不新增第三方行为分析 SDK，不上传用户内容或账号身份。

需要云侧配合提供三项能力：

1. 保留现有 V1 接收行为，增加本文约定的产品事件和字段白名单。
2. 按既有扩展流程分配并部署新的清洗 Schema 版本 N，完成样本上墙核对；端侧通过产品部署配置启用 N。能力查询属于可选新增需求，不是已有 API。
3. 在测试环境提供可核对的接收、拒绝和清洗结果，与端侧合成样本逐项验收。

端侧负责事实正确、类型和隐私校验、授权生命周期、关联与传输；云侧负责接收校验、去重、存储、查询与看板。本文中的活跃和漏斗定义用于避免双方口径不一致，看板实现与最终业务指标命名由云侧负责。

## 2. 保持不变的协议

| 项目 | 约定 |
|---|---|
| 测试 origin | `http://api-test.infra-bitfun.com`，仅 Debug 测试环境 |
| 生产 origin | `https://api.infra-bitfun.com`，Release 固定配置 |
| 信号入口 | `POST /otlp/v1/logs`、`POST /otlp/v1/traces`、`POST /otlp/v1/metrics` |
| 编码 | 标准 OTLP HTTP protobuf，`Content-Type: application/x-protobuf`；当前不启用 gzip |
| 鉴权 | 既有匿名 access token，`aud=bitfun-edge`、scope `otel:write`；不借用 Feedback capability token |
| 请求标识 | X-Request-ID 与 Idempotency-Key；同一 body 重试保持相同值 |
| 事件标识 | `bitfun.event_id` UUID；发生事件时生成，重试、拆包和 receipt 重发不变 |
| 授权 | 用户同意采集后开启；撤回立即停止和丢弃待发；不向云端发送撤回前后的补报 |
| 既有 schema | 旧客户端维持 Schema v1；新目录按云侧既有流程升级为 N，版本分配待确认；旧 Span、Metric、Event 名和单位不改 |
| 成功语义 | HTTP 200 + protobuf 空 ExportResponse（可为零字节）仅表示 MQ 已接受，不表示清洗、存储或可查 |

不能为了新事件把整个 ingress 放开为任意名称/字符串，也不能把旧 V1 客户端整体拒绝。旧模型/工具分类保持兼容；新分类用扩展字段表达。

## 3. 契约发布与可选能力查询

现有 `telemetry-client-guide.md` 第 5 节已经规定扩展流程：提出名称/属性/值域/用途 → 云侧更新 `deploy/telemetry/schema/telemetry-schema-v1.yaml` 并评审升级 Schema → 部署 → 端侧按新契约启用。本文沿用该流程，不能只增加一个端侧 product 子版本就绕过云 Schema 升级。

默认通过部署确认启用：端侧先完成完整代码和 mock，云侧确认 N 已部署且本目录全部合成样本上墙，随后 OHOS 产品部署配置固定启用 N。N 未确定/部署未确认时只发旧 V1，不自动探测不存在的接口。

附件没有定义 `/telemetry/capabilities` 或其他配置读取 endpoint。`auth-api.md` 的 scope 定义将“读取 endpoint、schema 和策略版本”归入 `config:read`，而 `otel:write` 仅允许 OTLP 写入。因此如双方决定自动协商，可另行提供如下接口；路径、响应格式和租约都是待开发提案，不计为现有能力：

```http
GET /telemetry/capabilities
Authorization: Bearer <anonymous-access-token-with-config:read>
Accept: application/json
```

响应示例：

```json
{
  "version": 1,
  "product_schemas": ["product_usage_v1"],
  "cloud_schema_version": 2,
  "max_age_seconds": 21600
}
```

| 情况 | 云侧响应 / 端侧解释 |
|---|---|
| 支持本契约且完整清洗链路已就绪 | 200，包含 `product_usage_v1` 和双方确定的 cloud_schema_version=N |
| 接口存在但尚不支持 | 200，空列表；端侧仅发送原 V1 |
| 旧服务没有接口 | 404；端侧仅发送原 V1 |
| token 失效 | 401；端侧复用一次强制刷新，不改业务登录状态 |
| 没有 scope/身份或 IP 被封禁 | 403；停止自动重试，不通过 enroll 或换 key 绕过；保留本地业务 |
| 限流 | 429 + Retry-After（如可用）；端侧退避 |
| 服务故障、超时、响应不合法 | 能力未知；端侧关闭新增产品准入，不猜支持 |

示例中的 cloud_schema_version=2 仅表示假设的 N，不代表云侧已分配 2。字段规则提案：version=1，product_schemas 最多 16 项，cloud_schema_version 取双方分配值，max_age_seconds 为 60..21600，响应最大 16 KiB；未知附加字段可忽略。能力缓存仅进程内保存，不向 UI 暴露凭据或网络配置。

能力声明是接收链路的租约：云侧撤下该 schema 前必须等待已发布租约过期，并额外保留至少 10 分钟导出宽限；不能查询时返回支持、清洗端仍静默丢弃。端侧租约过期未刷新就停新事件；产品队列和导出预算遵循端侧设计，receipt 必须在重新取得支持后才能补报。查询失败不改变原 V1 行为。

查询发生在用户同意之后，复用现有 AnonymousAuthService 获取 config:read token，不新增账号登录。能力请求本身不作为产品使用事件。此接口和租约不属于此次云端必需改造项；未采纳时用部署确认，不能因接口缺失把完成端侧打点的工作悬空。

## 4. 产品扩展的事件结构

新增及扩展后的 Log 可登记 `bitfun.product.schema.version = 1` 为目录子版本，清洗 Schema 仍按既有流程升为 N。`bitfun.telemetry.schema.version` 在新路径如何表达 N 必须与云侧冻结；下例假设 N=2，仅供结构说明。已有 body 如 `turn.completed` 保持原名，只增加获批字段，不改变旧 result 含义。

结构示意采用 OTLP JSON 映射便于阅读，实际线上仍为 protobuf：

```json
{
  "resourceLogs": [{
    "resource": {
      "attributes": [
        {"key": "os.type", "value": {"stringValue": "harmonyos"}},
        {"key": "bitfun.entrypoint", "value": {"stringValue": "desktop"}},
        {"key": "service.version", "value": {"stringValue": "2.0.0"}},
        {"key": "bitfun.telemetry.schema.version", "value": {"intValue": "2"}}
      ]
    },
    "scopeLogs": [{
      "scope": {"name": "bitfun-observability"},
      "logRecords": [{
        "timeUnixNano": "1793923200000000000",
        "severityNumber": 9,
        "severityText": "INFO",
        "body": {"stringValue": "product.harmony.build.finished"},
        "traceId": "aabbccddeeff00112233445566778899",
        "spanId": "0011223344556677",
        "attributes": [
          {"key": "bitfun.event_id", "value": {"stringValue": "10c8a152-352e-43ad-8799-847973261eff"}},
          {"key": "bitfun.product.schema.version", "value": {"intValue": "1"}},
          {"key": "bitfun.product.source", "value": {"stringValue": "service"}},
          {"key": "bitfun.product.trigger", "value": {"stringValue": "user"}},
          {"key": "bitfun.product.scenario", "value": {"stringValue": "local"}},
          {"key": "bitfun.product.toolchain", "value": {"stringValue": "devecocli"}},
          {"key": "bitfun.product.build_kind", "value": {"stringValue": "debug"}},
          {"key": "bitfun.result", "value": {"stringValue": "success"}},
          {"key": "bitfun.product.outcome", "value": {"stringValue": "success"}},
          {"key": "bitfun.duration_ms", "value": {"intValue": "12000"}}
        ]
      }]
    }]
  }]
}
```

上例为仅展示关键字段的合成记录，实际 Resource 仍带现有必填环境、实例和 scope 信息。字段并非任意 JSON properties，必须逐事件白名单验证；uint 在 OTLP 映射中为整型值，JSON 的 intValue 字符串只是标准映射。布尔值使用 OTLP boolValue，不用自由字符串代替。

### 4.1 公共字段

| 字段 | 用途 / 约束 |
|---|---|
| `bitfun.event_id` | 事件级去重，不是业务 ID |
| `bitfun.product.schema.version` | 待登记的产品目录子版本，提案为 1；不代替云侧 Schema N |
| `bitfun.product.source` | `native_host / web_ui / runtime / service` |
| `bitfun.product.trigger` | `user / agent / scheduled / system / restore / remote_user / unknown` |
| `bitfun.product.surface` | `ohos_main / ohos_floating / mobile_web / bot / peer / headless / unknown` |
| `bitfun.product.scenario` | `local / remote_workspace / remote_control / peer / detached / unknown` |
| `bitfun.product.workspace_location` | `local / ssh / docker / peer / none / unknown` |
| `bitfun.product.execution_location` | `local / remote_workspace / peer / dispatch_target / none / unknown` |
| `bitfun.product.execution_os` | `harmonyos / windows / darwin / linux / other / unknown` |
| `bitfun.result` | 保持现有 `success / error / cancelled / timeout`，不直接新增值 |
| `bitfun.product.outcome` | 待登记细分值：`success / error / cancelled / timeout / rejected / unsupported / partial / incomplete`；rejected/unsupported/partial/incomplete 粗映射为 result=error |
| `error.type` | 沿用云端 wire 分类，如 auth/network/validation/permission；不直接传内部 SafeErrorType 名或 error message |
| `bitfun.duration_ms` | 毫秒整数；缺失不是 0 |
| OTLP trace_id / span_id | 一次操作开始/终态的关联，可无导出的新 Span；不是 Session/Turn ID |
| OTLP 发生时间戳 | 端侧发生时间；云端另存 ingest time，不混用 |

canonical 匿名主体使用 ingress 注入的 Resource `bitfun.telemetry_subject`（鉴权 anonymous_id 的云侧独立 HMAC），同时存在 ingress 注入的 bitfun.request_id。端侧不计算、不发送这两个字段，不上传 anonymous_id 或 installation key。`service.instance.id` 是报告进程实例，不是稳定设备标识。

端侧现有 `bitfun.installation.pseudonymous_id` 是另一种 receiver-scoped HMAC，附件未明确其 Resource 白名单与 canonical 保留规则，不能假设它等同 telemetry_subject。新看板和去重不依赖前者；云侧需确认是否保留该字段，禁止未经定义进行两套主体的 join。新 enroll 和云 HMAC key 轮换可能产生新主体，安装留存应表述为“可观测匿名主体留存”，不承诺跨主体身份连续。

每事件最多 32 个业务属性、单条最大 8 KiB 是端侧安全预算提案，不是附件已有云端协议上限。body 固定字符串、enum 固定枚举，字段级缺失保持缺失。ingress 仍只做传输校验，业务 schema/隐私验证位于异步清洗层；未知属性被删、未知事件被丢弃的诊断从云侧看板核对，不要求通过 HTTP error 同步返回。

完整字段表和每个事件的条件见[端侧设计第 5、6 节](ohos-product-telemetry-client-design.md#5-字段与隐私契约)。实施交接时，端侧补充从静态 descriptor 导出的机器契约和合成样本；以双方确认的机器契约冻结所有枚举和必填性，不能让文档简称成为宽松接收规则。

## 5. 旧信号兼容

| 旧信号 | 本次处理 | 云侧解释 |
|---|---|---|
| `session.started` / `bitfun.session.count` | 补 session_operation、来源和路由字段，原计数保留 | create + resume；不可直接叫“新建会话数” |
| `turn.completed` | 补 Harness、trigger、Agent 来源和结束原因 | 是一轮执行终态，不能称用户任务成功 |
| `llm.request.completed` | 继续 Token/TTFT；补鉴权和 provider 权威 cache 数据 | TTFT 与用户可见首字不是同一个耗时；缺 cache usage 不是 0 |
| `tool.call.completed` | 保持旧 category，补有限 tool_id/source/fallback | 新分类不能倒改旧历史；动态第三方工具统一分类 |
| `client.error` | 保持原 operation 和错误分类 | 不把所有产品失败重复投影为第二个同义 client.error |
| `session.completed` / `client.crash` 保留名 | 本次不据此编造事实；产品故障用明确的新 body | 只有权威旧契约 owner 真正提供时才可启用，不能从 UI 关闭或进程消失推测 |
| Startup / Permission / Compression 内部事实 | 按第 6 节补成产品 Log 出站 | 原先内部存在不代表之前已上传 |

新增产品事件以 Log 为分析事实源。原有 Metric、Span 继续用于原用途；不能把 Log 次数、Metric 次数和 Span 次数相加。新操作的 started / finished 是同一操作两个阶段，使用次数按 started 或按约定终态计，不能合计成两次。

## 6. 需要接收的完整事件清单

下表 `started, finished` 表示两个具体 body；不是通配符接收规则。字段、owner 和判断依据以端侧设计同名表为准。全部属于本次契约，不是待定的后续批次。

| 域 | 固定 body / 必须覆盖的状态 |
|---|---|
| 应用与活跃 | `product.app.observed`、`product.app.startup.finished`、`product.app.lifecycle`、`product.app.activity` |
| 环境与可用性 | `product.environment.snapshot`、`product.configuration.snapshot`、`product.capability.snapshot` |
| 发现与首用 | `product.scene.visible`、`product.feature.exposed`、`product.feature.invoked`、`product.onboarding.milestone` |
| 工作区 | `product.workspace.operation.started`、`product.workspace.operation.finished` |
| 会话 | `session.started`（补字段）、`product.session.action` |
| 模型与 Agent | `product.model.configuration.started`、`product.model.configuration.finished`、`product.agent.configuration.started`、`product.agent.configuration.finished`、`product.harness.changed` |
| 对话 | `product.turn.started`、`turn.completed`（补字段）、`product.chat.action`、`product.chat.visible_response` |
| 模型与工具运行 | `llm.request.completed`、`tool.call.completed`（补字段） |
| 附件 | `product.attachment.prepare.started`、`product.attachment.prepare.finished`、`product.attachment.submitted` |
| 语音 | `product.voice.capture.started`、`product.voice.capture.finished`、`product.voice.submitted` |
| 产物 | `product.artifact.available`、`product.artifact.action.started`、`product.artifact.action.finished` |
| 编辑与搜索 | `product.editor.action`、`product.search.action` |
| 终端与 Git | `product.terminal.operation.started`、`product.terminal.operation.finished`、`product.git.operation.started`、`product.git.operation.finished` |
| 鸿蒙环境与工程 | `product.harmony.environment.started`、`product.harmony.environment.finished`、`product.harmony.project.started`、`product.harmony.project.finished` |
| 鸿蒙检查与构建 | `product.harmony.check.started`、`product.harmony.check.finished`、`product.harmony.build.started`、`product.harmony.build.finished` |
| 鸿蒙部署运行 | `product.harmony.install.started`、`product.harmony.install.finished`、`product.harmony.run.started`、`product.harmony.run.finished`、`product.harmony.device_result` |
| Qt 迁移 | `product.migration.started`、`product.migration.phase_result`、`product.migration.lifecycle` |
| 权限 | `product.permission.evaluation.finished`、`product.permission.prompt.started`、`product.permission.prompt.finished`、`product.system.permission.started`、`product.system.permission.finished` |
| 浏览器与电脑操作 | `product.browser.operation.started`、`product.browser.operation.finished`、`product.computer_use.operation.started`、`product.computer_use.operation.finished` |
| 系统设置 | `product.system.setting.started`、`product.system.setting.finished` |
| 分享 | `product.share.prepare.started`、`product.share.prepare.finished`、`product.share.transition` |
| 远程 | `product.remote.connection.started`、`product.remote.connection.finished`、`product.remote.transition`、`product.remote.transfer`、`product.dispatch.lifecycle` |
| 扩展与 ACP | `product.extension.operation.started`、`product.extension.operation.finished`、`product.extension.used`、`product.acp.lifecycle` |
| MiniApp | `product.miniapp.operation.started`、`product.miniapp.operation.finished`、`product.miniapp.interaction` |
| 记忆与定时 | `product.memory.operation`、`product.schedule.configuration.started`、`product.schedule.configuration.finished`、`product.schedule.execution` |
| Review 与上下文 | `product.review.lifecycle`、`product.compression.finished` |
| 账号状态与设置 | `product.account.operation.started`、`product.account.operation.finished`、`product.settings.changed` |
| 更新 | `product.update.check.started`、`product.update.check.finished`、`product.update.transition` |
| 反馈 | `product.feedback.submit.started`、`product.feedback.submit.finished` |
| 故障与恢复 | `product.client.fault`、`product.client.recovery` |
| 遥测健康 | `product.telemetry.health` |

以上 100 个 body 中，96 个为本次新增产品 body，4 个为既有 body 扩展。该数量是本提案目录的核对值，不是允许随意提高的审计基线；以静态契约导出结果做最终双向闭包检查。

## 7. 关键维度与口径

| 分析 | 端侧提供 | 云侧需要遵守 |
|---|---|---|
| 活跃 | app.observed、activity、用户来源操作 | 区分启动安装、前台可见安装、实际交互安装；后台定时/续跑不算主动活跃 |
| 首次可观测漏斗 | milestone、basis、baseline、startup_coverage | 不是下载/安装漏斗；既有用户基线不能当新安装 |
| D1/D7 | 云侧注入的 telemetry_subject、事件时间、用户活动 | 可观测匿名主体 cohort；主体轮换可切断连续性，不声称自然人或跨轮换安装留存 |
| 功能采用 | feature/capability、exposed、invoked、业务 started/finished | 分母区分所有活跃、具备能力的活跃、实际曝光安装；缺少 capability 样本不默认 available |
| 成功率 | result、product.outcome 和 operation 关联 | 新细分 outcome 单列；旧 result 不改；无终态不是自动失败 |
| 模型质量 | LLM TTFT、用户可见首响应、错误类别 | API 首 Token 与 UI 首可见响应分别统计；运行完成不等于满意 |
| 产物价值 | copy/export/run/accept/revert 等动作 | 是行为代理指标，不能直接叫满意度或任务成功率 |
| 语音 | 录音结果、是否有文本、是否提交、是否修改 | 录音次数、识别有结果次数、实际发送次数分别计；缺数据不能推断识别错误率 |
| 鸿蒙开发 | check/build/install/run 各自终态 | 构建成功不等于安装成功，launch_ack 不等于 app_ready |
| 分享 | armed、knock_detected、handoff、dismissed、receiver_ack | armed 和 dismiss 不算 delivered；无接收证据显示未知 |
| 多端 | scenario、surface、workspace/execution location 和 OS | 控制器 UI 与执行端结果分别归属；`os.type` 不等于 execution_os |
| 稳定性 | crash/unclean_exit 分类、证据、实际发生版本 | 强杀/断电/系统回收不自动算 crash；下次启动补报归原发生版本 |
| 更新 | 检查结果、交给系统、下次版本观测 | 检查失败为 unknown；handoff 不等于安装完成；仅版本变化不能断言该 prompt 导致升级 |
| 使用偏好 | 语言、主题、模式、非敏感规模分桶 | 匿名安装画像，不推断职业/年龄/身份，不尝试反查账户 |

推荐统一按 UTC+8 自然日提供默认产品分析；原始发生时间和接收时间均保留，重算可明确选择时区。端侧不输出“今天 DAU”或把自身本地日期当日界线。

当前客户端指南的“上报任意合法 trace，当日活跃匿名实例 +1”是现有接入活动口径，应保留其历史含义。本次新增 user activity 是另一指标，必须使用新的指标 ID/口径版本，不能直接覆盖原“活跃匿名安装实例”导致历史断层。

活跃区间里 `interactive_ms <= visible_ms <= interval_ms`。多窗口已在端侧合并，云端仍应按安装和时间区间并集检查进程重叠，不能把一台安装的多进程时间简单相加。长读可见时长和最近 60 秒有交互的时长是不同指标。

## 8. 去重、迟到与缺失

- 新版客户端指南已说明按 bitfun.event_id 做记录级去重，而旧一期 API/需求只保证请求和批次幂等；二者是不同阶段。请云侧确认二期当前部署的确切去重键、窗口及覆盖 canonical/curated 的范围，不能仅凭旧 API 文档认定没有去重，也不能假设有 8 天保证。
- 云侧主体分区建议使用 `(bitfun.telemetry_subject, bitfun.event_id)`；是否以全局 event_id 去重以实际 schema 为准。同 ID 不同内容属于异常。请求 ID 不能替代事件 ID，413 子批次有新的请求 ID。
- receipt 的拟定跨启动保留最多 7 天，因此建议去重存储窗口至少 8 天；未获确认前停用跨重启已发送/响应不明 receipt 补报，保留现有同批有界重试。新匿名身份不得重放旧代际 receipt。
- 开始和结束可能乱序到达；按 OTLP 关联上下文和 body/stage 配对。一个逻辑操作可以只有单侧记录；不得为了漏斗闭合补造另一侧。
- Metric 没有逐事件 ID，保留当前 OTLP temporality 和幂等处理，不能套用 Log 的相同去重方法，也不能将重新导出的聚合值当新增事件。
- 端侧默认是有界内存传输，离线进程退出会丢失，只有有限首用/故障 receipt 可跨重启。不能以某日没有事件判定卸载或零使用。
- receipt 使用原事件时间戳；云端保留 ingest time 并允许 7 天内迟到，汇总按发生日修正或标记尚未稳定。
- 时钟异常、未知来源、未协商期间和授权前的数据缺口必须可解释；不填 0、不归入成功、不当“用户未使用”。

所有已登记安全事件采样率为 1.0；曝光去重和活动区间合并是语义定义，不是随机采样。云端清洗不应再做未告知的抽样；如有成本要求需共同变更契约和统计口径。

## 9. 响应语义与异步清洗诊断

完全沿用既有 API：ingress 只确认 MQ publish，返回 HTTP 200 与对应空 ExportResponse；零字节 protobuf 是合法成功。未知业务 body/字段或隐私内容可在之后的清洗阶段被删/丢弃，ingress 不同步等待结果，不能要求它把 Collector 拒绝数反映到已返回的 partial_success。

| 请求结果 | 端侧行为 / 云侧配合 |
|---|---|
| 200 + protobuf 空 ExportResponse | 记 ingress_accepted；停止该批重试，不表示 cleaned/stored/queryable |
| 200 partial_success（现有 ingress 未承诺产生） | 兼容解析入口拒绝数，不重发已返回 partial_success 的批次或拒绝项；不作为清洗回执 |
| 400 | 只按 TELEMETRY_REQUEST_INVALID / IDEMPOTENCY_KEY_INVALID 等入口错误处理，不拿它表示业务 schema 拒绝 |
| 401 | 强制 refresh 最多一次，同一事件 ID 不变 |
| 403 | 记授权/策略问题，不无穷重试 |
| 409 / 415 | 按 IDEMPOTENCY_CONFLICT / 编码不支持处理；不重试原请求、不轮换身份绕过 |
| 413 | 端侧标准 protobuf 拆批，事件 ID 不变；单条超限拒绝并计健康 |
| 429 / 可重试 5xx | 既有退避和重试预算；429 按现有 API 必带 Retry-After，503 可带 |
| 网络超时/响应不明 | 可能已接收，端侧按预算重试；云端必须幂等 |

端侧 acknowledged/receipt 成功仅标记入口已接收；现有 health 的 server_rejected 只可能反映入口响应计数，不能覆盖异步清洗拒绝。云侧已有“消费 vs 清洗后存活”面板可用于联调，但差值未必能区分延迟、未知字段删除和记录丢弃，需结合固定合成 event_id 和清洗后字段逐项确认。不因看板暂未出现或字段被清理而重发已 200 的批次。

建议测试环境提供按合成 event_id 查询的接收/拒绝/清洗诊断，权限和工具由云侧选择。诊断不需要回显真实业务 payload，也不要求新建面向用户的产品接口。

## 10. 数据边界与保留

本次允许有限分类、布尔、计数、时长、固定产品 ID、已受限的模型名、匿名安装标识与随机事件/Trace 标识。禁止提示词、消息、代码、音频、截图、文件名/路径、URL、命令、剪贴板文本、反馈正文、账号/邮箱、设备序列号、凭据；也禁止这些值的哈希。

云侧不把 token、IP、User-Agent 原文、账户身份等网关信息拼回产品事件画像；网关必需的安全访问日志与产品分析数据分开管理。账号操作事件只说明某类登录操作的结果，不提供可关联身份。

已有明确保留规则：Kafka raw 72 小时，OBS raw/quarantine 两年，且允许在契约扩展后受控重放。不再把 raw 保留期列为完全未知。canonical/curated 保留期、删除渠道、主体删除定位与网关日志政策仍需云侧补充；鉴权 revoke 是吊销凭据，不是删除已归档遥测。本文不把端侧“撤回”表述为删除云端历史，也不依赖 raw 重放弥补端侧先发未登记事件。

## 11. 双方联调与交付

| 端侧提供 | 云侧提供 |
|---|---|
| 精确静态 descriptor 导出的机器契约及 digest | 同版本接收与清洗白名单确认 |
| 每个事件的合法样本、所有结果枚举的合成样本 | 对应样本的接收/拒绝和清洗后字段核对 |
| 重试、413、401、429、零字节成功、撤回的 mock 证据；partial_success 仅做兼容防护 | 既有 HTTP/OTLP 异步语义的测试环境或可控 fixture |
| OHOS 签名 HAP 真机发送记录和合成 event_id | 可按合成 event_id 查证的结果；不只确认 HTTP 200 |
| 字段和结果口径、已验证远程场景列表 | 聚合口径、迟到/去重策略、保留和删除答复 |

完整验收用例：

1. 旧客户端连接新云端：原 Span/Metric/Log 和计数不变。
2. 新客户端连接未升级云端：无 N 部署确认时不发送新事件；如采用可选能力接口，其 404 同样关闭新事件，不影响业务。
3. N 已部署并获确认：第 6 节全部 body 的合成样本经过接收与清洗，字段无缺失；HTTP 200 不能替代这个核对。
4. 同一事件相同批重试、拆批重试、跨启动 receipt 重试：最终仅一个逻辑事件。
5. 成功、失败、取消、超时、拒绝、不支持、部分完成均按契约保留；开始缺终态可见为数据不完整。
6. 分享 armed/dismissed 不进入送达；检查失败不进入“无更新”；unclean_exit 不进入 crash。
7. OHOS 主窗口与浮窗重叠、后台运行、远程驾驶、Peer 重连/历史重放：活跃与操作不重复。
8. 录音识别修订、模型流式 token、工具进度和自动配置恢复不产生按片段膨胀的使用事件。
9. 离线后恢复、7 天内迟到与系统时钟变化：不重复、不补造、不把接收日当发生日。
10. 未同意无能力请求和产品事件；撤回停止请求和待发；云端已接收历史的处理与约定相符。

对接前需云侧明确：Schema N 和完整白名单、Resource 保留与主体规则、事件去重窗口、迟到聚合策略、canonical/curated 保留和删除机制、测试环境诊断方式，以及 4 MiB 当前部署上限。32 属性/8 KiB 是端侧预算，500 条是指南建议，不混同协议硬限制。可选能力接口若采纳再确定路径/config:read/租约；不采纳则走部署确认。端侧完整代码和离线 mock 可以先完成，正式启用必须在 N 部署并完成全目录上墙核对之后。
