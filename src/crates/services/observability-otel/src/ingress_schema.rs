use bitfun_observability::{
    Attribute, AttributeValue, LogRecord, MetricRecord, MetricValue, Severity, SpanRecord,
};
use std::borrow::Cow;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectedSpanKind {
    Internal,
    Client,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ProjectedValue {
    Text(Cow<'static, str>),
    U64(u64),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ProjectedAttribute {
    pub key: &'static str,
    pub value: ProjectedValue,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ProjectedSpan {
    pub name: &'static str,
    pub kind: ProjectedSpanKind,
    pub attributes: Vec<ProjectedAttribute>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ProjectedMetricValue {
    Counter(u64),
    Histogram(f64),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ProjectedMetric {
    pub name: &'static str,
    pub unit: &'static str,
    pub value: ProjectedMetricValue,
    pub attributes: Vec<ProjectedAttribute>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ProjectedEvent {
    pub body: &'static str,
    pub severity: Severity,
    pub attributes: Vec<ProjectedAttribute>,
}

#[derive(Debug, Clone, Copy)]
struct OperationProjection {
    operation: &'static str,
    outcome_key: &'static str,
    span_name: &'static str,
    span_kind: ProjectedSpanKind,
}

pub(crate) fn project_span(record: &SpanRecord) -> Option<ProjectedSpan> {
    let operation = operation_projection(record.name())?;
    let mut attributes = common_attributes(operation, record.attributes());
    match record.name() {
        "bitfun.inference.request" => {
            project_inference_attributes(record.attributes(), &mut attributes)
        }
        "bitfun.tool.execute" => project_tool_attributes(record.attributes(), &mut attributes),
        "bitfun.auth.refresh" => project_auth_attributes(record.attributes(), &mut attributes),
        _ => {}
    }
    Some(ProjectedSpan {
        name: operation.span_name,
        kind: operation.span_kind,
        attributes,
    })
}

pub(crate) fn project_span_metrics(record: &SpanRecord) -> Vec<ProjectedMetric> {
    let Some(operation) = operation_projection(record.name()) else {
        return Vec::new();
    };
    let labels = metric_labels(operation, record.attributes());
    let mut metrics = Vec::new();
    if record.name() == "bitfun.inference.request" {
        if let Some(ttft_ms) =
            u64_attribute(record.attributes(), "bitfun.inference.request.ttft_ms")
        {
            metrics.push(ProjectedMetric {
                name: "bitfun.llm.request.ttft",
                unit: "ms",
                value: ProjectedMetricValue::Histogram(ttft_ms as f64),
                attributes: labels.clone(),
            });
        }
    }
    if let Some(retry_count) = u64_attribute(record.attributes(), "bitfun.retry_count") {
        if retry_count > 0 {
            metrics.push(ProjectedMetric {
                name: "bitfun.operation.retry.count",
                unit: "{retry}",
                value: ProjectedMetricValue::Counter(retry_count.min(10)),
                attributes: labels,
            });
        }
    }
    metrics
}

pub(crate) fn project_metric(record: &MetricRecord) -> Vec<ProjectedMetric> {
    let projected = match record.name() {
        "bitfun.agent.session.total" => {
            let operation = enum_attribute(record.attributes(), "bitfun.agent.session.operation");
            if !matches!(operation, Some("create" | "resume")) {
                return Vec::new();
            }
            if result(record.attributes()) == Some("success") {
                project_operation_metric(record, "bitfun.session.count", "{session}", false)
            } else {
                None
            }
        }
        "bitfun.agent.turn.total" => {
            project_operation_metric(record, "bitfun.turn.count", "{turn}", false)
        }
        "bitfun.inference.request.total" => {
            project_operation_metric(record, "bitfun.llm.request.count", "{request}", false)
        }
        "bitfun.inference.request.duration" => {
            project_operation_metric(record, "bitfun.llm.request.duration", "ms", true)
        }
        "bitfun.tool.execute.total" => {
            project_operation_metric(record, "bitfun.tool.call.count", "{call}", false)
        }
        "bitfun.tool.execute.duration" => {
            project_operation_metric(record, "bitfun.tool.call.duration", "ms", true)
        }
        "bitfun.inference.usage.input_tokens" => project_token_metric(record, "input"),
        "bitfun.inference.usage.output_tokens" => project_token_metric(record, "output"),
        _ => None,
    };
    let mut metrics = projected.into_iter().collect::<Vec<_>>();
    if record.name().ends_with(".total")
        && result(record.attributes()).is_some_and(|value| value != "success")
        && enum_attribute(record.attributes(), "error.type").is_some()
    {
        if let Some(operation) = operation_projection(metric_operation_name(record.name())) {
            metrics.push(ProjectedMetric {
                name: "bitfun.operation.error.count",
                unit: "{error}",
                value: ProjectedMetricValue::Counter(1),
                attributes: metric_labels(operation, record.attributes()),
            });
        }
    }
    metrics
}

pub(crate) fn project_event(record: &LogRecord) -> Option<ProjectedEvent> {
    let operation = operation_projection(record.event_name())?;
    let result = result_from_key(record.attributes(), operation.outcome_key)?;
    let mut attributes = Vec::new();
    let body = match record.event_name() {
        "bitfun.agent.session" => {
            let session_operation =
                enum_attribute(record.attributes(), "bitfun.agent.session.operation");
            if result == "success" && matches!(session_operation, Some("create" | "resume")) {
                "session.started"
            } else if result != "success" {
                project_client_error(operation, record.attributes(), &mut attributes)?
            } else {
                return None;
            }
        }
        "bitfun.agent.turn" => {
            attributes.push(text("bitfun.result", result));
            push_u64(
                &mut attributes,
                record.attributes(),
                "bitfun.agent.turn.duration_ms",
                "bitfun.duration_ms",
            );
            "turn.completed"
        }
        "bitfun.inference.request" => {
            attributes.push(text("bitfun.result", result));
            if let Some(model) = string_attribute(record.attributes(), "gen_ai.request.model") {
                attributes.push(owned_text("gen_ai.request.model", model.to_string()));
            }
            push_u64(
                &mut attributes,
                record.attributes(),
                "bitfun.inference.usage.input_tokens",
                "gen_ai.usage.input_tokens",
            );
            push_u64(
                &mut attributes,
                record.attributes(),
                "bitfun.inference.usage.output_tokens",
                "gen_ai.usage.output_tokens",
            );
            push_u64(
                &mut attributes,
                record.attributes(),
                "bitfun.inference.request.ttft_ms",
                "bitfun.ttft_ms",
            );
            "llm.request.completed"
        }
        "bitfun.tool.execute" => {
            attributes.push(text("bitfun.result", result));
            if let Some(category) = tool_category(record.attributes()) {
                attributes.push(text("bitfun.tool.category", category));
            }
            push_u64(
                &mut attributes,
                record.attributes(),
                "bitfun.tool.execute.duration_ms",
                "bitfun.duration_ms",
            );
            "tool.call.completed"
        }
        "bitfun.auth.refresh" if result != "success" => {
            project_client_error(operation, record.attributes(), &mut attributes)?
        }
        _ => return None,
    };
    Some(ProjectedEvent {
        body,
        severity: record.severity(),
        attributes,
    })
}

fn project_operation_metric(
    record: &MetricRecord,
    name: &'static str,
    unit: &'static str,
    seconds_to_ms: bool,
) -> Option<ProjectedMetric> {
    let operation = operation_projection(metric_operation_name(record.name()))?;
    let value = match record.value() {
        MetricValue::Counter(value) => ProjectedMetricValue::Counter(*value),
        MetricValue::Histogram(value) => ProjectedMetricValue::Histogram(if seconds_to_ms {
            *value * 1_000.0
        } else {
            *value
        }),
    };
    Some(ProjectedMetric {
        name,
        unit,
        value,
        attributes: metric_labels(operation, record.attributes()),
    })
}

fn project_token_metric(
    record: &MetricRecord,
    token_type: &'static str,
) -> Option<ProjectedMetric> {
    let value = match record.value() {
        MetricValue::Counter(value) => *value,
        MetricValue::Histogram(value) if value.is_finite() && *value >= 0.0 => *value as u64,
        MetricValue::Histogram(_) => return None,
    };
    let operation = operation_projection("bitfun.inference.request")?;
    let mut attributes = metric_labels(operation, record.attributes());
    attributes.push(text("bitfun.token.type", token_type));
    Some(ProjectedMetric {
        name: "bitfun.llm.token.usage",
        unit: "{token}",
        value: ProjectedMetricValue::Counter(value),
        attributes,
    })
}

fn common_attributes(
    operation: OperationProjection,
    source: &[Attribute],
) -> Vec<ProjectedAttribute> {
    let mut attributes = vec![text("bitfun.operation", operation.operation)];
    if let Some(result) = result_from_key(source, operation.outcome_key) {
        attributes.push(text("bitfun.result", result));
    }
    if let Some(error_type) = error_type(source) {
        attributes.push(text("error.type", error_type));
    }
    if let Some(retry_count) = u64_attribute(source, "bitfun.retry_count") {
        attributes.push(number("bitfun.retry_count", retry_count.min(10)));
    }
    attributes
}

fn metric_labels(operation: OperationProjection, source: &[Attribute]) -> Vec<ProjectedAttribute> {
    let mut attributes = vec![text("bitfun.operation", operation.operation)];
    if let Some(result) = result_from_key(source, operation.outcome_key) {
        attributes.push(text("bitfun.result", result));
    }
    if let Some(error_type) = error_type(source) {
        attributes.push(text("error.type", error_type));
    }
    match operation.operation {
        "llm.request" => {
            if let Some(provider) = provider_name(source) {
                attributes.push(text("gen_ai.system", provider));
            }
            if let Some(model) = string_attribute(source, "gen_ai.request.model") {
                attributes.push(owned_text("gen_ai.request.model", model.to_string()));
            }
        }
        "tool.call" => {
            if let Some(category) = tool_category(source) {
                attributes.push(text("bitfun.tool.category", category));
            }
        }
        _ => {}
    }
    attributes
}

fn project_inference_attributes(source: &[Attribute], target: &mut Vec<ProjectedAttribute>) {
    if let Some(provider) = provider_name(source) {
        target.push(text("gen_ai.system", provider));
    }
    if let Some(model) = string_attribute(source, "gen_ai.request.model") {
        target.push(owned_text("gen_ai.request.model", model.to_string()));
    }
    push_u64(
        target,
        source,
        "bitfun.inference.usage.input_tokens",
        "gen_ai.usage.input_tokens",
    );
    push_u64(
        target,
        source,
        "bitfun.inference.usage.output_tokens",
        "gen_ai.usage.output_tokens",
    );
    push_u64(
        target,
        source,
        "bitfun.inference.request.ttft_ms",
        "bitfun.ttft_ms",
    );
}

fn project_tool_attributes(source: &[Attribute], target: &mut Vec<ProjectedAttribute>) {
    if let Some(category) = tool_category(source) {
        target.push(text("bitfun.tool.category", category));
    }
}

fn project_auth_attributes(source: &[Attribute], target: &mut Vec<ProjectedAttribute>) {
    if let Some(value) = enum_attribute(source, "bitfun.auth.result") {
        target.push(text("bitfun.auth.result", value));
    }
}

fn project_client_error(
    operation: OperationProjection,
    source: &[Attribute],
    target: &mut Vec<ProjectedAttribute>,
) -> Option<&'static str> {
    target.push(text("bitfun.operation", operation.operation));
    target.push(text("error.type", error_type(source)?));
    if let Some(retry_count) = u64_attribute(source, "bitfun.retry_count") {
        target.push(number("bitfun.retry_count", retry_count.min(10)));
    }
    Some("client.error")
}

fn operation_projection(name: &str) -> Option<OperationProjection> {
    match name {
        "bitfun.agent.session" => Some(OperationProjection {
            operation: "session",
            outcome_key: "bitfun.agent.session.outcome",
            span_name: "bitfun.session",
            span_kind: ProjectedSpanKind::Internal,
        }),
        "bitfun.agent.turn" => Some(OperationProjection {
            operation: "turn",
            outcome_key: "bitfun.agent.turn.outcome",
            span_name: "bitfun.turn",
            span_kind: ProjectedSpanKind::Internal,
        }),
        "bitfun.inference.request" => Some(OperationProjection {
            operation: "llm.request",
            outcome_key: "bitfun.inference.request.outcome",
            span_name: "bitfun.llm.request",
            span_kind: ProjectedSpanKind::Client,
        }),
        "bitfun.tool.execute" => Some(OperationProjection {
            operation: "tool.call",
            outcome_key: "bitfun.tool.execute.outcome",
            span_name: "bitfun.tool.call",
            span_kind: ProjectedSpanKind::Internal,
        }),
        "bitfun.auth.refresh" => Some(OperationProjection {
            operation: "auth.refresh",
            outcome_key: "bitfun.auth.refresh.outcome",
            span_name: "bitfun.auth.refresh",
            span_kind: ProjectedSpanKind::Client,
        }),
        _ => None,
    }
}

fn metric_operation_name(name: &str) -> &str {
    name.strip_suffix(".total")
        .or_else(|| name.strip_suffix(".duration"))
        .unwrap_or(name)
}

fn result(attributes: &[Attribute]) -> Option<&'static str> {
    for key in [
        "bitfun.agent.session.outcome",
        "bitfun.agent.turn.outcome",
        "bitfun.inference.request.outcome",
        "bitfun.tool.execute.outcome",
        "bitfun.auth.refresh.outcome",
    ] {
        if let Some(value) = result_from_key(attributes, key) {
            return Some(value);
        }
    }
    None
}

fn result_from_key(attributes: &[Attribute], key: &str) -> Option<&'static str> {
    match enum_attribute(attributes, key)? {
        "completed" => Some("success"),
        "cancelled" => Some("cancelled"),
        "timeout" => Some("timeout"),
        "failed" | "rejected" | "degraded" | "incomplete" => Some("error"),
        _ => None,
    }
}

fn provider_name(attributes: &[Attribute]) -> Option<&'static str> {
    match enum_attribute(attributes, "bitfun.inference.provider_class")? {
        "openai_compatible" => Some("openai"),
        "anthropic_compatible" => Some("anthropic"),
        "google_compatible" => Some("google"),
        "local" => Some("local"),
        "other" => Some("other"),
        _ => None,
    }
}

fn error_type(attributes: &[Attribute]) -> Option<&'static str> {
    match enum_attribute(attributes, "error.type")? {
        "cancelled" => Some("cancelled"),
        "timeout" => Some("timeout"),
        "authentication" => Some("auth"),
        "rate_limited" => Some("rate_limited"),
        "network_unavailable" | "network_protocol" => Some("network"),
        "invalid_request" => Some("invalid_request"),
        "context_overflow" => Some("context_overflow"),
        "tool_validation" => Some("validation"),
        "permission_denied" => Some("permission"),
        "persistence" => Some("persistence"),
        "provider" => Some("provider"),
        "internal" => Some("internal"),
        "other" => Some("other"),
        _ => None,
    }
}

fn tool_category(attributes: &[Attribute]) -> Option<&'static str> {
    if enum_attribute(attributes, "bitfun.tool.source_class") == Some("mcp") {
        return Some("mcp");
    }
    match enum_attribute(attributes, "bitfun.tool.kind")? {
        "shell" => Some("shell"),
        "filesystem" | "search" | "git" => Some("filesystem"),
        "browser" | "protocol" => Some("network"),
        "computer_use" => Some("editor"),
        "task" | "other" => Some("other"),
        _ => None,
    }
}

fn enum_attribute(attributes: &[Attribute], key: &str) -> Option<&'static str> {
    attributes.iter().find_map(|attribute| {
        if attribute.key() != key {
            return None;
        }
        match attribute.value() {
            AttributeValue::Enum(value) => Some(*value),
            _ => None,
        }
    })
}

fn u64_attribute(attributes: &[Attribute], key: &str) -> Option<u64> {
    attributes.iter().find_map(|attribute| {
        if attribute.key() != key {
            return None;
        }
        match attribute.value() {
            AttributeValue::U64(value) => Some(*value),
            _ => None,
        }
    })
}

fn string_attribute<'a>(attributes: &'a [Attribute], key: &str) -> Option<&'a str> {
    attributes.iter().find_map(|attribute| {
        if attribute.key() != key {
            return None;
        }
        match attribute.value() {
            AttributeValue::String(value) => Some(value.as_str()),
            _ => None,
        }
    })
}

fn push_u64(
    target: &mut Vec<ProjectedAttribute>,
    source: &[Attribute],
    source_key: &str,
    target_key: &'static str,
) {
    if let Some(value) = u64_attribute(source, source_key) {
        target.push(number(target_key, value));
    }
}

fn text(key: &'static str, value: &'static str) -> ProjectedAttribute {
    ProjectedAttribute {
        key,
        value: ProjectedValue::Text(Cow::Borrowed(value)),
    }
}

fn owned_text(key: &'static str, value: String) -> ProjectedAttribute {
    ProjectedAttribute {
        key,
        value: ProjectedValue::Text(Cow::Owned(value)),
    }
}

const fn number(key: &'static str, value: u64) -> ProjectedAttribute {
    ProjectedAttribute {
        key,
        value: ProjectedValue::U64(value),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_observability::{
        domains::{
            record_inference_usage, start_auth_refresh, start_inference, start_tool, AttemptBucket,
            AuthRefreshFinishFacts, AuthRefreshResult, CompletionFacts, InferenceAuthClass,
            InferenceContextClass, InferenceFinishFacts, InferenceProtocolClass,
            InferenceStartFacts, InferenceUsageFacts, ModelClass, NormalizedModelName,
            ProviderClass, SafeErrorType, ToolArgumentState, ToolClass, ToolFinishFacts, ToolKind,
            ToolSourceClass, ToolStartFacts,
        },
        InMemorySink, PolicySnapshot, Telemetry, TelemetryLevel, ValidatedRecord,
    };
    use std::sync::Arc;

    #[test]
    fn inference_records_match_cloud_schema_v1() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic)
                .with_trace_sample_ratio(1.0)
                .with_success_log_sample_ratio(1.0),
            sink.clone(),
        );
        start_inference(
            &telemetry,
            InferenceStartFacts {
                provider_class: ProviderClass::OpenAiCompatible,
                model_class: ModelClass::Code,
                model_name: NormalizedModelName::new("GPT-5.2-Codex"),
                protocol_class: InferenceProtocolClass::Responses,
                context_class: InferenceContextClass::Turn,
                auth_class: Some(InferenceAuthClass::ApiKey),
            },
            None,
        )
        .finish(InferenceFinishFacts {
            completion: CompletionFacts::completed(),
            attempt_bucket: AttemptBucket::Two,
            retry_count: 1,
            status_class: None,
            retryable: Some(false),
            ttft_ms: Some(25),
            input_tokens: Some(10),
            output_tokens: Some(4),
            reasoning_tokens: None,
            cache_read_tokens: None,
            cache_creation_tokens: None,
            total_tokens: Some(14),
            context_window_tokens: None,
            tool_definition_tokens_estimate: None,
        });
        record_inference_usage(
            &telemetry,
            InferenceUsageFacts {
                provider_class: ProviderClass::OpenAiCompatible,
                model_class: ModelClass::Code,
                model_name: NormalizedModelName::new("GPT-5.2-Codex"),
                subagent: false,
                input_tokens: 10,
                output_tokens: Some(4),
                reasoning_tokens: None,
                cache_read_tokens: None,
                cache_creation_tokens: None,
                total_tokens: Some(14),
            },
        );

        let records = sink.records();
        let span = records
            .iter()
            .find_map(|record| match record {
                ValidatedRecord::Span(record) => Some(record),
                _ => None,
            })
            .unwrap();
        let projected = project_span(span).unwrap();
        assert_eq!(projected.name, "bitfun.llm.request");
        assert_eq!(projected.kind, ProjectedSpanKind::Client);
        assert!(projected.attributes.contains(&owned_text(
            "gen_ai.request.model",
            "gpt-5.2-codex".to_string(),
        )));
        assert!(projected.attributes.iter().all(|attribute| matches!(
            attribute.key,
            "bitfun.operation"
                | "bitfun.result"
                | "bitfun.retry_count"
                | "gen_ai.system"
                | "gen_ai.request.model"
                | "gen_ai.usage.input_tokens"
                | "gen_ai.usage.output_tokens"
                | "bitfun.ttft_ms"
        )));
        assert_eq!(project_span_metrics(span).len(), 2);

        let token_metric = records
            .iter()
            .filter_map(|record| match record {
                ValidatedRecord::Metric(record) => Some(project_metric(record)),
                _ => None,
            })
            .flatten()
            .find(|metric| metric.name == "bitfun.llm.token.usage")
            .expect("token metric");
        assert!(token_metric.attributes.contains(&owned_text(
            "gen_ai.request.model",
            "gpt-5.2-codex".to_string(),
        )));

        let event = records
            .iter()
            .find_map(|record| match record {
                ValidatedRecord::Log(record) => project_event(record),
                _ => None,
            })
            .unwrap();
        assert_eq!(event.body, "llm.request.completed");
    }

    #[test]
    fn tool_projection_uses_only_supported_category() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic)
                .with_trace_sample_ratio(1.0)
                .with_success_log_sample_ratio(1.0),
            sink.clone(),
        );
        start_tool(
            &telemetry,
            ToolStartFacts {
                tool_class: ToolClass::Custom,
                source_class: ToolSourceClass::Mcp,
                tool_kind: ToolKind::Protocol,
                parallel: false,
                remote: false,
                background: false,
                argument_state: ToolArgumentState::Unchanged,
                arguments_truncated: false,
            },
            None,
        )
        .finish(ToolFinishFacts {
            completion: CompletionFacts::completed(),
            queue_ms: None,
            preflight_ms: None,
            confirmation_ms: None,
            execution_ms: None,
            failure_source: None,
            exit_status_class: None,
            content_length: None,
            content_truncated: None,
            retryable: Some(false),
            programming_language: None,
        });

        let event = sink
            .records()
            .iter()
            .find_map(|record| match record {
                ValidatedRecord::Log(record) => project_event(record),
                _ => None,
            })
            .unwrap();
        assert_eq!(event.body, "tool.call.completed");
        assert!(event
            .attributes
            .contains(&text("bitfun.tool.category", "mcp")));
    }

    #[test]
    fn auth_refresh_failure_projects_to_span_error_and_retry_metric() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(
            PolicySnapshot::new(TelemetryLevel::Diagnostic)
                .with_trace_sample_ratio(1.0)
                .with_success_log_sample_ratio(1.0),
            sink.clone(),
        );
        start_auth_refresh(&telemetry, None).finish(AuthRefreshFinishFacts {
            completion: CompletionFacts::failed(SafeErrorType::Authentication),
            result: AuthRefreshResult::Revoked,
            retry_count: 1,
        });

        let records = sink.records();
        let span = records
            .iter()
            .find_map(|record| match record {
                ValidatedRecord::Span(record) => Some(record),
                _ => None,
            })
            .unwrap();
        let projected = project_span(span).unwrap();
        assert_eq!(projected.name, "bitfun.auth.refresh");
        assert!(projected
            .attributes
            .contains(&text("bitfun.auth.result", "revoked")));
        assert!(projected.attributes.contains(&text("error.type", "auth")));
        assert_eq!(
            project_span_metrics(span)[0].name,
            "bitfun.operation.retry.count"
        );

        let event = records
            .iter()
            .find_map(|record| match record {
                ValidatedRecord::Log(record) => project_event(record),
                _ => None,
            })
            .unwrap();
        assert_eq!(event.body, "client.error");

        let error_metric = records
            .iter()
            .filter_map(|record| match record {
                ValidatedRecord::Metric(record) => Some(project_metric(record)),
                _ => None,
            })
            .flatten()
            .find(|metric| metric.name == "bitfun.operation.error.count")
            .expect("auth error metric");
        assert_eq!(error_metric.unit, "{error}");
    }
}
