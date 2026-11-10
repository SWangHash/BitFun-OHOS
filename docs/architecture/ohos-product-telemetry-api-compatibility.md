# OHOS 产品打点与现有云 API 兼容性核对

状态：文档静态审查完成，未调用云侧线上接口，也未取得云服务代码、清洗 YAML 或实际部署配置。下文“已有”表示附件记载，不能代替线上验证。

核对对象：[端侧设计](ohos-product-telemetry-client-design.md)、[云侧协作说明](ohos-product-telemetry-cloud-handoff.md)及用户提供的两个压缩包。附件中的“必须修复”等文字作为接口资料和审查依据，不作为用户要求执行鉴权重构、调用管理接口或发送消息的授权。

## 1. 资料版本与层次

| 资料 | 核对定位 |
|---|---|
| `telemetry-api.zip / telemetry-api.md` | 一期接口 v1.2，变更记录至 2026-08-25 |
| `telemetry-api.zip / telemetry-phase1.md` | 一期需求，传输/MQ/raw 存储和请求/对象幂等；不是当前清洗闭集的完整说明 |
| `api.zip / api/telemetry-api.md` | 标题仍写 v1.2，但变更记录已到 v1.3；相较前一份增加云端 Resource 主体和 request_id 注入条款 |
| `api.zip / api/telemetry-client-guide.md` | v1.1，Schema v1 闭集、二期清洗与上墙、记录级 ID/去重、扩展流程 |
| `api.zip / api/auth-api.md` | 匿名鉴权、scope、enroll/refresh 幂等和轮换 |
| `api.zip / api/auth-client-guide.md` | v1.0，2026-09-28，针对持久化/重试的补充规范 |
| `api.zip / api/feedback-api.md`、`admin-api.md` | 独立反馈与管理协议；不作为遥测出口或遥测历史删除接口 |

传输 API 的“一期不检查业务字段”和新指南的“二期清洗按白名单丢弃”并不矛盾：前者是 ingress 入队前校验，后者发生在异步清洗层。不能因为 HTTP 接口接受 protobuf，就认为里面任意事件和字段能上墙。

## 2. 结论

路径、protobuf、匿名 Bearer、audience、otel:write、UUID 请求幂等、401 刷新、413 拆批和隐私限制可以继续复用。前一版设计有几处不能按现有 API 直接实现的假设，已修正两份设计文档；完整功能目录仍保留 100 个 body（96 个新增、4 个旧 body 补字段）。

| 项目 | 冲突或缺口 | 修订决定 | 附件证据 |
|---|---|---|---|
| **清洗拒绝与 HTTP 回执** | 先前要求 partial_success 反映清洗拒绝，不符合 MQ 异步链路 | 200/空 protobuf 只记 ingress_accepted；清洗和上墙另由云侧核对；不因未上墙重发已 200 批次 | Telemetry API §1.6，行 102–129；客户端指南 §1，行 19–24 |
| **96 个新增事件** | 全部不在现有 7 个 Event body 中 | 云侧先扩展清洗契约并部署；未知事件不能先上线发送；4 个旧 body 的新属性也需登记 | 客户端指南 §2.4，行 75–89；§5，行 133–140 |
| **共享结果值** | 先前给 bitfun.result 增加 rejected/unsupported/partial/incomplete，当前只允许 4 值 | bitfun.result 保持 4 值，新增 product.outcome 承载细分并纳入新契约 | 客户端指南 §2.2，行 44–46 |
| **Schema 版本** | 只加 product.schema.version=1、继续宣称云 Schema 不变，与已有扩展流程不符 | 申请云契约 N；目录子版本只作附加字段；wire Resource 版本表达待双方冻结，不擅自指定 2 | 客户端指南 §5，行 135–140 |
| **能力查询接口** | `/telemetry/capabilities` 在附件中不存在；前版把它设为唯一准入前提 | 默认使用 N 部署确认后的产品配置启用；自动查询降为可选新需求，不能当现有 API | 全部附带 API 的接口清单；Auth API §Scope 定义 |
| **查询 scope** | 前版拟用 otel:write 读取 schema 能力，现有职责是 OTLP 写入 | 若增加查询，应按 config:read 设计，鉴权由共享服务提供 | Auth API 行 635–646 |
| **分析主体** | 前版依赖端侧 receiver-scoped installation HMAC，云侧实际上注入另一主体 | canonical 使用云注入 telemetry_subject；不伪造、不等同两个 HMAC；端侧字段保留规则待确认 | 新 Telemetry API §1.11，行 227；旧压缩包无此条 |
| **主体轮换与 receipt** | 新 enroll 会变 anonymous identity；相同 event_id 若按主体分区可能再次计数 | 待报 receipt 绑定端内凭据代际，新身份不补报旧代际；不宣称跨主体稳定安装留存 | Auth 客户端指南 §1、§3.5；Telemetry API §1.11 |
| **去重窗口** | 新指南已说二期按 event_id 去重，但没有给窗口/键；前版假设至少 8 天 | 8 天只保留为支撑 7 天 receipt 的协作要求；未确认前不启用跨重启已发送/响应不明 receipt 重放 | 客户端指南行 89、116、153；一期 API §1.9 仅请求/批次幂等 |
| **错误分类** | 内部 SafeErrorType 如 authentication/network_unavailable 不等于已有 wire 分类 auth/network | 继续现有 ingress 映射，不把内部枚举直接出站；完整 error.type 值域仍以云 YAML 为准 | 客户端指南行 46；本仓库 ingress_schema.rs::error_type |
| **既有活跃指标** | 云侧当前“任何合法 Trace 活跃 +1”与新增交互/可见活跃不同 | 新建 user activity 指标口径，保留原接入活跃历史，不能直接替换 | 客户端指南 §4，行 129；一期需求 §5.5.3 |
| **raw 保留** | 前版把保留期完全列为未知；附件已明确 raw 归档 | 写明 Kafka 72 小时、OBS raw/quarantine 两年；仍询问 canonical/curated 和删除机制 | Telemetry API §1.11；客户端指南行 22 |

## 3. 可以直接沿用的部分

- 三条写入口仍为 `/otlp/v1/traces`、`/otlp/v1/metrics`、`/otlp/v1/logs`；protobuf 二进制，不使用 JSON envelope。
- 写请求使用有效匿名 Access Token，aud=bitfun-edge，scope=otel:write；Feedback capability 和管理员 Session 不可替代。
- Idempotency-Key 是批次级 UUID，同一原始 body 重试不变；413 产生不同子 body，需要新的批次 key，但 record ID 保持不变。401 同一匿名身份刷新后仍复用当前批次 key；如果重新 enroll 改变 principal，则终止旧身份待报，不能带新 principal 盲目重试旧批。
- 200 可以有零字节 ExportResponse；400/403/409/415 不重试原错误请求，401 有界刷新，413 拆包，429 遵循必需 Retry-After，500/503 有界退避。
- 不启用 gzip 是合法的 identity 编码选择，不与 API 支持 gzip 冲突；既有测试环境 gzip 经验仍保留为实现限制。
- UUID v4/v7 event_id、稳定 Trace/Span ID、全量安全事实、INFO/WARN/ERROR/FATAL 和不上传正文的方向相符。

## 4. 建议值与硬约束要分开

| 项目 | 云资料 | 端侧设计处理 |
|---|---|---|
| 单批条数 | 指南建议 ≤500；API 按环境大小配置 | OHOS 产品 Log profile 取 500，不把代码已有 512 认定为协议错误 |
| 导出周期 | 指南建议 10–30 秒；代码默认 5 秒 | OHOS 安全 Log 取 10 秒，不全局修改其他宿主 |
| 请求体 | 指南称 4 MiB；API 说部署配置 | 保持更小 1 MiB 导出批，要求核实部署值，保留 413 处理 |
| 离线队列 | 建议约 5000 条、优先故障，未明确全事件磁盘持久化 | 当前严格有界内存方案不冒称完整补传；只保留受条件约束的小 receipt |
| 属性和单条大小 | 附件未给 32 项/8 KiB 的硬限制 | 作为端侧安全预算，需与云清洗规则兼容，不要求云 endpoint 因此同步逐事件拒绝 |

## 5. 云文档自身需澄清的地方

1. Telemetry API 文档头仍为 1.2，但末尾已记录 1.3；应统一版本标识，避免同名文件选错。
2. 一期 API“不做跨请求记录去重”与二期指南“按 event_id 去重”应明确适用阶段和当前部署；缺确切去重键、保留窗口、跨主体轮换和 raw 重放后的覆盖范围。
3. Resource allowlist 未完整列出：需明确 service.instance.id、os.type、现有 bitfun.installation.pseudonymous_id、版本字段是否保留，以及云注入字段覆盖客户端同名字段的规则。
4. Auth scope 表定义 config:read，但所附包没有对应配置读取 endpoint，不能推断已有 `/telemetry/capabilities`。
5. Auth 接入指南 §3.3 对修正 400/409 后重试有例外，而 §3.6 泛称禁止 400/409 重试；应以具体错误矩阵并限定“原请求原样重试”澄清，不写无条件循环。
6. canonical/curated 保留、历史删除渠道、时区、迟到重算窗口和已有活跃指标定义尚不足以冻结全部产品统计。

这些都是文档边界或信息缺失，不据此断言云服务存在实现缺陷。

## 6. 端云最小协作清单

云侧继续现有 HTTP/MQ 架构，无需为本次打点新增同步清洗回执。必需工作是：申请 Schema N、登记所有新 body/字段/枚举、保持旧 V1 兼容、确认云主体/去重/迟到窗口、部署后验证每种合成样本的清洗结果。端侧完成强类型目录、owner 接线、权限与传输安全和本地验证，再根据部署确认启用。

自动能力 API、按 event_id 的独立诊断工具均为可选新增协作项；已有看板可先用于核对，但最终需验证字段和逐事件覆盖，不能只看 HTTP 200 或总量差值。

本次只检查并修订设计文档，未修改 Auth、OTLP 或业务运行代码；未发送线上数据，未使用 Feedback/Admin 接口。全目录联调、签名 HAP 真机和四种远程场景仍属于后续实现验收。
