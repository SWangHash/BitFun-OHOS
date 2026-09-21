use crate::admission::{AdmissionController, OperationBudget};
use crate::model::{
    Attribute, LogRecord, MetricRecord, MetricValue, ObservationContext, Severity, SpanRecord,
    SpanStatus, TelemetryLevel, TraceRelation, ValidatedRecord,
};
use crate::schema::{
    event_schema, metric_attributes, operation_schema, validate, EventKind, OperationKind,
    OperationSchema, TokenMetricKind,
};
use crate::sink::{NoopSink, TelemetrySink};
use crate::{debug::prepare_debug_record, DebugTelemetryRecord};
use crate::{DeploymentEnvironment, TelemetryEntrypoint, TelemetryResource};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SignalPolicy {
    traces: bool,
    metrics: bool,
    logs: bool,
}

impl SignalPolicy {
    pub const fn all() -> Self {
        Self {
            traces: true,
            metrics: true,
            logs: true,
        }
    }

    pub const fn new(traces: bool, metrics: bool, logs: bool) -> Self {
        Self {
            traces,
            metrics,
            logs,
        }
    }

    pub fn traces(&self) -> bool {
        self.traces
    }
    pub fn metrics(&self) -> bool {
        self.metrics
    }
    pub fn logs(&self) -> bool {
        self.logs
    }
}

impl Default for SignalPolicy {
    fn default() -> Self {
        Self::all()
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PolicySnapshot {
    level: TelemetryLevel,
    signals: SignalPolicy,
    trace_sample_ratio: f64,
    success_log_sample_ratio: f64,
}

impl PolicySnapshot {
    pub fn new(level: TelemetryLevel) -> Self {
        let (trace_sample_ratio, success_log_sample_ratio) = match level {
            TelemetryLevel::Off => (0.0, 0.0),
            TelemetryLevel::Basic => (0.0, 0.1),
            TelemetryLevel::Diagnostic => (0.1, 0.5),
            TelemetryLevel::Debug => (1.0, 1.0),
        };
        Self {
            level,
            signals: SignalPolicy::all(),
            trace_sample_ratio,
            success_log_sample_ratio,
        }
    }

    pub fn with_signals(mut self, signals: SignalPolicy) -> Self {
        self.signals = signals;
        self
    }

    pub fn with_trace_sample_ratio(mut self, ratio: f64) -> Self {
        self.trace_sample_ratio = ratio.clamp(0.0, 1.0);
        self
    }

    pub fn with_success_log_sample_ratio(mut self, ratio: f64) -> Self {
        self.success_log_sample_ratio = ratio.clamp(0.0, 1.0);
        self
    }

    pub fn level(&self) -> TelemetryLevel {
        self.level
    }

    pub fn signals(&self) -> SignalPolicy {
        self.signals
    }
}

impl Default for PolicySnapshot {
    fn default() -> Self {
        Self::new(TelemetryLevel::Off)
    }
}

#[derive(Debug, Default)]
struct DiagnosticCounters {
    accepted: AtomicU64,
    rejected: AtomicU64,
    skipped: AtomicU64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TelemetryDiagnostics {
    accepted: u64,
    rejected: u64,
    skipped: u64,
}

impl TelemetryDiagnostics {
    pub fn accepted(&self) -> u64 {
        self.accepted
    }
    pub fn rejected(&self) -> u64 {
        self.rejected
    }
    pub fn skipped(&self) -> u64 {
        self.skipped
    }
}

struct TelemetryInner {
    resource: TelemetryResource,
    policy: RwLock<PolicySnapshot>,
    enabled: AtomicBool,
    policy_revision: AtomicU64,
    sample_sequence: AtomicU64,
    sink: Arc<dyn TelemetrySink>,
    admission: Arc<AdmissionController>,
    diagnostics: DiagnosticCounters,
}

#[derive(Clone)]
pub struct Telemetry {
    inner: Arc<TelemetryInner>,
}

impl std::fmt::Debug for Telemetry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Telemetry")
            .field("policy", &self.policy_snapshot())
            .field("diagnostics", &self.diagnostics())
            .finish_non_exhaustive()
    }
}

impl Default for Telemetry {
    fn default() -> Self {
        Self::noop()
    }
}

impl Telemetry {
    pub fn build(policy: PolicySnapshot, sink: Arc<dyn TelemetrySink>) -> (Self, TelemetryControl) {
        Self::build_with_resource(policy, TelemetryResource::default(), sink)
    }

    pub fn build_for_entrypoint(
        policy: PolicySnapshot,
        entrypoint: TelemetryEntrypoint,
        sink: Arc<dyn TelemetrySink>,
    ) -> (Self, TelemetryControl) {
        Self::build_with_resource(
            policy,
            TelemetryResource::current(entrypoint, DeploymentEnvironment::Development),
            sink,
        )
    }

    pub fn build_with_resource(
        policy: PolicySnapshot,
        resource: TelemetryResource,
        sink: Arc<dyn TelemetrySink>,
    ) -> (Self, TelemetryControl) {
        sink.configure_resource(resource.clone());
        let telemetry = Self {
            inner: Arc::new(TelemetryInner {
                resource,
                policy: RwLock::new(policy),
                enabled: AtomicBool::new(policy.level != TelemetryLevel::Off),
                policy_revision: AtomicU64::new(1),
                sample_sequence: AtomicU64::new(0),
                sink,
                admission: Arc::new(AdmissionController::default()),
                diagnostics: DiagnosticCounters::default(),
            }),
        };
        let control = TelemetryControl {
            telemetry: telemetry.clone(),
        };
        (telemetry, control)
    }

    pub fn noop() -> Self {
        Self::build(PolicySnapshot::default(), Arc::new(NoopSink)).0
    }

    pub fn policy_snapshot(&self) -> PolicySnapshot {
        *self
            .inner
            .policy
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn resource(&self) -> TelemetryResource {
        self.inner.resource.clone()
    }

    pub fn diagnostics(&self) -> TelemetryDiagnostics {
        TelemetryDiagnostics {
            accepted: self.inner.diagnostics.accepted.load(Ordering::Relaxed),
            rejected: self.inner.diagnostics.rejected.load(Ordering::Relaxed),
            skipped: self.inner.diagnostics.skipped.load(Ordering::Relaxed),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.inner.enabled.load(Ordering::Acquire)
    }

    pub fn is_debug_enabled(&self) -> bool {
        self.is_enabled() && self.policy_snapshot().level == TelemetryLevel::Debug
    }

    pub fn record_debug_lazy<F>(&self, build: F, context: Option<ObservationContext>)
    where
        F: FnOnce() -> DebugTelemetryRecord,
    {
        if !self.is_debug_enabled() {
            self.inner
                .diagnostics
                .skipped
                .fetch_add(1, Ordering::Relaxed);
            return;
        }
        self.record_debug(build(), context);
    }

    pub(crate) fn start_operation<F>(
        &self,
        kind: OperationKind,
        attributes: F,
        parent: Option<ObservationContext>,
    ) -> TelemetrySpan
    where
        F: FnOnce() -> Vec<Attribute>,
    {
        let relation = parent.map_or(TraceRelation::Root, TraceRelation::Parent);
        self.start_operation_with_relation(kind, attributes, relation)
    }

    pub(crate) fn start_operation_with_relation<F>(
        &self,
        kind: OperationKind,
        attributes: F,
        relation: TraceRelation,
    ) -> TelemetrySpan
    where
        F: FnOnce() -> Vec<Attribute>,
    {
        let revision = self.inner.policy_revision.load(Ordering::Acquire);
        if !self.is_enabled() {
            return TelemetrySpan::disabled(self.clone(), kind, revision);
        }
        let policy = self.policy_snapshot();
        if !matches!(
            policy.level,
            TelemetryLevel::Diagnostic | TelemetryLevel::Debug
        ) || !policy.signals.traces
        {
            return TelemetrySpan::terminal_only(self.clone(), kind, revision, attributes());
        }
        let (context, parent_span_id, links, budget) = match relation {
            TraceRelation::Root => {
                let Some(budget) = self.inner.admission.new_operation() else {
                    return self.rejected_span(kind, revision, attributes());
                };
                let span = crate::SpanContext::root(policy.trace_sample_ratio);
                (
                    ObservationContext::local(span, budget.clone()),
                    None,
                    Vec::new(),
                    budget,
                )
            }
            TraceRelation::Parent(parent) => {
                let Some(budget) = parent
                    .budget
                    .clone()
                    .or_else(|| self.inner.admission.new_operation())
                else {
                    return self.rejected_span(kind, revision, attributes());
                };
                let parent_span = parent.span_context();
                let span = crate::SpanContext::child(parent_span);
                (
                    ObservationContext::local(span, budget.clone()),
                    Some(parent_span.span_id()),
                    Vec::new(),
                    budget,
                )
            }
            TraceRelation::Link(link) => {
                let Some(budget) = self.inner.admission.new_operation() else {
                    return self.rejected_span(kind, revision, attributes());
                };
                let span = crate::SpanContext::root(policy.trace_sample_ratio);
                (
                    ObservationContext::local(span, budget.clone()),
                    None,
                    vec![link.span_context()],
                    budget,
                )
            }
        };
        if !context.span_context().is_sampled() || !self.inner.admission.admit_span(&budget) {
            return TelemetrySpan::terminal_only(self.clone(), kind, revision, attributes());
        }
        TelemetrySpan {
            telemetry: self.clone(),
            kind,
            schema: operation_schema(kind),
            policy_revision: revision,
            started_at: Instant::now(),
            started_unix_nanos: unix_nanos(),
            context: Some(context),
            parent_span_id,
            links,
            attributes: attributes(),
            budget: Some(budget),
            span_slot_active: true,
            active: true,
            terminal_active: kind != OperationKind::InferenceAttempt,
            closed: false,
        }
    }

    fn rejected_span(
        &self,
        kind: OperationKind,
        revision: u64,
        attributes: Vec<Attribute>,
    ) -> TelemetrySpan {
        self.inner
            .diagnostics
            .rejected
            .fetch_add(1, Ordering::Relaxed);
        TelemetrySpan::terminal_only(self.clone(), kind, revision, attributes)
    }

    pub(crate) fn accepts_terminal_projection(&self) -> bool {
        if !self.is_enabled() {
            return false;
        }
        let policy = self.policy_snapshot();
        policy.signals.metrics || policy.signals.logs
    }

    pub(crate) fn record_instant_event(&self, kind: EventKind, attributes: Vec<Attribute>) {
        let revision = self.inner.policy_revision.load(Ordering::Acquire);
        if !self.accepts_terminal_projection() {
            return;
        }
        let schema = event_schema(kind);
        self.emit_if_allowed(
            ValidatedRecord::Metric(MetricRecord {
                descriptor_version: schema.total.version(),
                name: schema.total.name(),
                timestamp_unix_nanos: unix_nanos(),
                value: MetricValue::Counter(1),
                attributes: attributes.clone(),
            }),
            revision,
            None,
        );
        let policy = self.policy_snapshot();
        if sample(
            policy.success_log_sample_ratio,
            self.inner.sample_sequence.fetch_add(1, Ordering::Relaxed),
        ) {
            self.emit_if_allowed(
                ValidatedRecord::Log(LogRecord {
                    descriptor_version: schema.log.version(),
                    event_name: schema.log.name(),
                    timestamp_unix_nanos: unix_nanos(),
                    observed_unix_nanos: unix_nanos(),
                    severity: Severity::Info,
                    body: schema.log.body().unwrap_or_default(),
                    attributes,
                    span_context: None,
                }),
                revision,
                None,
            );
        }
    }

    /// Emit one content-bearing record from its authoritative business owner.
    pub fn record_debug(&self, record: DebugTelemetryRecord, context: Option<ObservationContext>) {
        let revision = self.inner.policy_revision.load(Ordering::Acquire);
        if !self.is_enabled() || self.policy_snapshot().level != TelemetryLevel::Debug {
            self.inner
                .diagnostics
                .skipped
                .fetch_add(1, Ordering::Relaxed);
            return;
        }
        let prepared = prepare_debug_record(record, context);
        if self.inner.policy_revision.load(Ordering::Acquire) != revision {
            self.inner
                .diagnostics
                .skipped
                .fetch_add(1, Ordering::Relaxed);
            return;
        }
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.inner.sink.emit_debug(prepared)
        }))
        .is_ok()
        {
            self.inner
                .diagnostics
                .accepted
                .fetch_add(1, Ordering::Relaxed);
        } else {
            self.inner
                .diagnostics
                .rejected
                .fetch_add(1, Ordering::Relaxed);
        }
    }

    fn record_terminal_projection_at_revision(
        &self,
        kind: OperationKind,
        attributes: Vec<Attribute>,
        duration_ms: Option<u64>,
        severity: Severity,
        span_context: Option<ObservationContext>,
        revision: u64,
    ) {
        let schema = operation_schema(kind);
        let metric_attributes = metric_attributes(kind, &attributes);
        self.emit_if_allowed(
            ValidatedRecord::Metric(MetricRecord {
                descriptor_version: schema.total.version(),
                name: schema.total.name(),
                timestamp_unix_nanos: unix_nanos(),
                value: MetricValue::Counter(1),
                attributes: metric_attributes.clone(),
            }),
            revision,
            span_context
                .as_ref()
                .and_then(|context| context.budget.as_deref()),
        );
        if let Some(duration_ms) = duration_ms {
            self.emit_if_allowed(
                ValidatedRecord::Metric(MetricRecord {
                    descriptor_version: schema.duration.version(),
                    name: schema.duration.name(),
                    timestamp_unix_nanos: unix_nanos(),
                    value: MetricValue::Histogram(duration_ms as f64 / 1000.0),
                    attributes: metric_attributes,
                }),
                revision,
                span_context
                    .as_ref()
                    .and_then(|context| context.budget.as_deref()),
            );
        }
        let policy = self.policy_snapshot();
        if severity != Severity::Info
            || sample(
                policy.success_log_sample_ratio,
                self.inner.sample_sequence.fetch_add(1, Ordering::Relaxed),
            )
        {
            self.emit_if_allowed(
                ValidatedRecord::Log(LogRecord {
                    descriptor_version: schema.log.version(),
                    event_name: schema.log.name(),
                    timestamp_unix_nanos: unix_nanos(),
                    observed_unix_nanos: unix_nanos(),
                    severity,
                    body: schema.log.body().expect("log descriptor has a fixed body"),
                    span_context: span_context
                        .as_ref()
                        .map(ObservationContext::span_context)
                        .filter(|context| context.is_sampled()),
                    attributes,
                }),
                revision,
                span_context
                    .as_ref()
                    .and_then(|context| context.budget.as_deref()),
            );
        }
    }

    pub(crate) fn record_token_metric(
        &self,
        kind: TokenMetricKind,
        tokens: u64,
        attributes: Vec<Attribute>,
    ) {
        let revision = self.inner.policy_revision.load(Ordering::Acquire);
        let descriptor = crate::schema::token_metric_descriptor(kind);
        self.emit_if_allowed(
            ValidatedRecord::Metric(MetricRecord {
                descriptor_version: descriptor.version(),
                name: descriptor.name(),
                timestamp_unix_nanos: unix_nanos(),
                value: MetricValue::Histogram(tokens as f64),
                attributes,
            }),
            revision,
            None,
        );
    }

    fn finish_span(
        &self,
        span: &mut TelemetrySpan,
        mut finish_attributes: Vec<Attribute>,
        status: SpanStatus,
    ) {
        if !span.active || span.closed {
            return;
        }
        span.closed = true;
        span.release_span_slot();
        if self.inner.policy_revision.load(Ordering::Acquire) != span.policy_revision {
            self.inner
                .diagnostics
                .skipped
                .fetch_add(1, Ordering::Relaxed);
            return;
        }
        let duration_ms = span
            .started_at
            .elapsed()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        finish_attributes.push(Attribute::u64(duration_key(span.kind), duration_ms));
        let mut attributes = std::mem::take(&mut span.attributes);
        attributes.extend(finish_attributes);
        if let Some(context) = span
            .context
            .as_ref()
            .filter(|context| context.span_context().is_sampled())
        {
            self.emit_if_allowed(
                ValidatedRecord::Span(SpanRecord {
                    descriptor_version: span.schema.span.version(),
                    name: span.schema.span.name(),
                    context: context.span_context(),
                    parent_span_id: span.parent_span_id,
                    links: std::mem::take(&mut span.links),
                    started_unix_nanos: span.started_unix_nanos,
                    ended_unix_nanos: unix_nanos(),
                    status,
                    attributes,
                }),
                span.policy_revision,
                span.budget.as_deref(),
            );
        }
    }

    fn emit_if_allowed(
        &self,
        record: ValidatedRecord,
        revision: u64,
        budget: Option<&OperationBudget>,
    ) {
        if self.inner.policy_revision.load(Ordering::Acquire) != revision {
            self.inner
                .diagnostics
                .skipped
                .fetch_add(1, Ordering::Relaxed);
            return;
        }
        let policy = self.policy_snapshot();
        let enabled = match record.signal_kind() {
            crate::SignalKind::Trace => {
                matches!(
                    policy.level,
                    TelemetryLevel::Diagnostic | TelemetryLevel::Debug
                ) && policy.signals.traces
            }
            crate::SignalKind::Metric => {
                policy.level != TelemetryLevel::Off && policy.signals.metrics
            }
            crate::SignalKind::Log => policy.level != TelemetryLevel::Off && policy.signals.logs,
        };
        if !enabled {
            self.inner
                .diagnostics
                .skipped
                .fetch_add(1, Ordering::Relaxed);
            return;
        }
        if validate(&record).is_err() {
            self.inner
                .diagnostics
                .rejected
                .fetch_add(1, Ordering::Relaxed);
            return;
        }
        if !self.inner.admission.admit_signal(
            record.signal_kind(),
            record.name(),
            record.attributes(),
            budget,
        ) {
            self.inner
                .diagnostics
                .rejected
                .fetch_add(1, Ordering::Relaxed);
            return;
        }
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.inner.sink.emit(record)
        }))
        .is_ok()
        {
            self.inner
                .diagnostics
                .accepted
                .fetch_add(1, Ordering::Relaxed);
        } else {
            self.inner
                .diagnostics
                .rejected
                .fetch_add(1, Ordering::Relaxed);
        }
    }
}

#[derive(Clone)]
pub struct TelemetryControl {
    telemetry: Telemetry,
}

impl TelemetryControl {
    /// Stop accepting new records and invalidate active observations without
    /// discarding records already accepted by the sink. Runtime owners use
    /// this before a bounded graceful flush.
    pub fn close_admission(&self) {
        self.telemetry.inner.enabled.store(false, Ordering::Release);
        self.telemetry
            .inner
            .policy_revision
            .fetch_add(1, Ordering::AcqRel);
    }

    pub fn apply(&self, policy: PolicySnapshot) {
        let previous_level = self.telemetry.policy_snapshot().level;
        if policy.level == TelemetryLevel::Off {
            self.telemetry.inner.enabled.store(false, Ordering::Release);
        }
        self.telemetry
            .inner
            .policy_revision
            .fetch_add(1, Ordering::AcqRel);
        *self
            .telemetry
            .inner
            .policy
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = policy;
        if policy.level == TelemetryLevel::Off {
            self.telemetry.inner.sink.discard_pending();
        } else if previous_level == TelemetryLevel::Debug && policy.level != TelemetryLevel::Debug {
            self.telemetry.inner.sink.discard_debug_pending();
        } else {
            self.telemetry.inner.enabled.store(true, Ordering::Release);
        }
        if policy.level != TelemetryLevel::Off {
            self.telemetry.inner.enabled.store(true, Ordering::Release);
        }
    }
}

pub struct TelemetrySpan {
    telemetry: Telemetry,
    kind: OperationKind,
    schema: OperationSchema,
    policy_revision: u64,
    started_at: Instant,
    started_unix_nanos: u128,
    context: Option<ObservationContext>,
    parent_span_id: Option<[u8; 8]>,
    links: Vec<crate::SpanContext>,
    attributes: Vec<Attribute>,
    budget: Option<Arc<OperationBudget>>,
    span_slot_active: bool,
    active: bool,
    terminal_active: bool,
    closed: bool,
}

impl std::fmt::Debug for TelemetrySpan {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TelemetrySpan")
            .field("name", &self.schema.span.name())
            .field("context", &self.context)
            .field("active", &self.active)
            .field("closed", &self.closed)
            .finish_non_exhaustive()
    }
}

impl TelemetrySpan {
    fn disabled(telemetry: Telemetry, kind: OperationKind, policy_revision: u64) -> Self {
        Self {
            telemetry,
            kind,
            schema: operation_schema(kind),
            policy_revision,
            started_at: Instant::now(),
            started_unix_nanos: 0,
            context: None,
            parent_span_id: None,
            links: Vec::new(),
            attributes: Vec::new(),
            budget: None,
            span_slot_active: false,
            active: false,
            terminal_active: false,
            closed: false,
        }
    }

    fn terminal_only(
        telemetry: Telemetry,
        kind: OperationKind,
        policy_revision: u64,
        attributes: Vec<Attribute>,
    ) -> Self {
        Self {
            telemetry,
            kind,
            schema: operation_schema(kind),
            policy_revision,
            started_at: Instant::now(),
            started_unix_nanos: 0,
            context: None,
            parent_span_id: None,
            links: Vec::new(),
            attributes,
            budget: None,
            span_slot_active: false,
            active: false,
            terminal_active: kind != OperationKind::InferenceAttempt,
            closed: false,
        }
    }

    pub fn context(&self) -> Option<ObservationContext> {
        self.context.clone()
    }

    pub(crate) fn finish_terminal(
        mut self,
        finish_attributes: Vec<Attribute>,
        status: SpanStatus,
        severity: Severity,
    ) {
        if self.closed {
            return;
        }

        let duration_ms = self
            .started_at
            .elapsed()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        let mut terminal_attributes = self.attributes.clone();
        terminal_attributes.extend(finish_attributes.clone());
        terminal_attributes.push(Attribute::u64(duration_key(self.kind), duration_ms));
        let span_context = self.context.clone();
        let telemetry = self.telemetry.clone();
        let revision = self.policy_revision;
        let terminal_active = self.terminal_active;

        telemetry.finish_span(&mut self, finish_attributes, status);
        if terminal_active {
            telemetry.record_terminal_projection_at_revision(
                self.kind,
                terminal_attributes,
                Some(duration_ms),
                severity,
                span_context,
                revision,
            );
        }
        self.closed = true;
    }

    fn release_span_slot(&mut self) {
        if !self.span_slot_active {
            return;
        }
        self.span_slot_active = false;
        if let Some(budget) = self.budget.as_deref() {
            self.telemetry.inner.admission.release_span(budget);
        }
    }
}

impl Drop for TelemetrySpan {
    fn drop(&mut self) {
        if self.active && !self.closed {
            let attributes = vec![Attribute::enumeration(outcome_key(self.kind), "incomplete")];
            let mut terminal_attributes = self.attributes.clone();
            terminal_attributes.extend(attributes.clone());
            let span_context = self.context.clone();
            let revision = self.policy_revision;
            let terminal_active = self.terminal_active;
            let telemetry = self.telemetry.clone();
            telemetry.finish_span(self, attributes, SpanStatus::Unset);
            if terminal_active {
                telemetry.record_terminal_projection_at_revision(
                    self.kind,
                    terminal_attributes,
                    None,
                    Severity::Warn,
                    span_context,
                    revision,
                );
            }
        } else if self.terminal_active && !self.closed {
            let telemetry = self.telemetry.clone();
            let mut attributes = self.attributes.clone();
            attributes.push(Attribute::enumeration(outcome_key(self.kind), "incomplete"));
            telemetry.record_terminal_projection_at_revision(
                self.kind,
                attributes,
                None,
                Severity::Warn,
                self.context.clone(),
                self.policy_revision,
            );
            self.closed = true;
        } else {
            self.release_span_slot();
        }
    }
}

const fn outcome_key(kind: OperationKind) -> &'static str {
    match kind {
        OperationKind::Startup => "bitfun.app.startup.outcome",
        OperationKind::Session => "bitfun.agent.session.outcome",
        OperationKind::Turn => "bitfun.agent.turn.outcome",
        OperationKind::Round => "bitfun.agent.round.outcome",
        OperationKind::Inference => "bitfun.inference.request.outcome",
        OperationKind::InferenceAttempt => "bitfun.inference.attempt.outcome",
        OperationKind::Tool => "bitfun.tool.execute.outcome",
        OperationKind::PermissionEvaluate => "bitfun.permission.evaluate.outcome",
        OperationKind::PermissionConfirmation => "bitfun.permission.confirmation.outcome",
        OperationKind::Compression => "bitfun.agent.compression.outcome",
    }
}

const fn duration_key(kind: OperationKind) -> &'static str {
    match kind {
        OperationKind::Startup => "bitfun.app.startup.duration_ms",
        OperationKind::Session => "bitfun.agent.session.duration_ms",
        OperationKind::Turn => "bitfun.agent.turn.duration_ms",
        OperationKind::Round => "bitfun.agent.round.duration_ms",
        OperationKind::Inference => "bitfun.inference.request.duration_ms",
        OperationKind::InferenceAttempt => "bitfun.inference.attempt.duration_ms",
        OperationKind::Tool => "bitfun.tool.execute.duration_ms",
        OperationKind::PermissionEvaluate => "bitfun.permission.evaluate.duration_ms",
        OperationKind::PermissionConfirmation => "bitfun.permission.confirmation.duration_ms",
        OperationKind::Compression => "bitfun.agent.compression.duration_ms",
    }
}

fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn sample(ratio: f64, sequence: u64) -> bool {
    if ratio <= 0.0 {
        return false;
    }
    if ratio >= 1.0 {
        return true;
    }
    let threshold = (ratio * 10_000.0) as u64;
    sequence.wrapping_mul(6_364_136_223_846_793_005) % 10_000 < threshold
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DebugCorrelation, DebugTelemetryRecord, DebugTurnRecord, InMemorySink};

    #[test]
    fn debug_defaults_to_full_trace_and_success_log_sampling() {
        let policy = PolicySnapshot::new(TelemetryLevel::Debug);

        assert_eq!(policy.trace_sample_ratio, 1.0);
        assert_eq!(policy.success_log_sample_ratio, 1.0);
    }

    fn content_record(content: &str) -> DebugTelemetryRecord {
        DebugTelemetryRecord::TurnInput(DebugTurnRecord {
            correlation: DebugCorrelation {
                session_id: Some("session-debug".to_string()),
                ..Default::default()
            },
            content: Some(crate::DebugContentField::text(content)),
            modified_file_paths: None,
            modified_file_paths_original_count: None,
            workspace_path: None,
            repository: None,
            branch: None,
            base_commit: None,
        })
    }

    #[test]
    fn only_debug_accepts_sensitive_records_without_sampling() {
        for level in [
            TelemetryLevel::Off,
            TelemetryLevel::Basic,
            TelemetryLevel::Diagnostic,
        ] {
            let sink = Arc::new(InMemorySink::default());
            let (telemetry, _) = Telemetry::build(PolicySnapshot::new(level), sink.clone());
            telemetry.record_debug(content_record("secret-free"), None);
            assert!(
                sink.debug_records().is_empty(),
                "level {level:?} leaked Debug"
            );
        }

        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) =
            Telemetry::build(PolicySnapshot::new(TelemetryLevel::Debug), sink.clone());
        for index in 0..10 {
            telemetry.record_debug(content_record(&format!("argument-{index}")), None);
        }
        assert_eq!(sink.debug_records().len(), 10);
    }

    #[test]
    fn lazy_debug_builder_is_not_called_outside_debug() {
        for level in [TelemetryLevel::Off, TelemetryLevel::Diagnostic] {
            let sink = Arc::new(InMemorySink::default());
            let (telemetry, _) = Telemetry::build(PolicySnapshot::new(level), sink);
            let built = Arc::new(AtomicU64::new(0));
            let built_clone = built.clone();
            telemetry.record_debug_lazy(
                move || {
                    built_clone.fetch_add(1, Ordering::Relaxed);
                    content_record("should-not-be-built")
                },
                None,
            );
            assert_eq!(built.load(Ordering::Relaxed), 0);
        }

        let sink = Arc::new(InMemorySink::default());
        let (telemetry, _) = Telemetry::build(PolicySnapshot::new(TelemetryLevel::Debug), sink);
        let built = Arc::new(AtomicU64::new(0));
        let built_clone = built.clone();
        telemetry.record_debug_lazy(
            move || {
                built_clone.fetch_add(1, Ordering::Relaxed);
                content_record("built")
            },
            None,
        );
        assert_eq!(built.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn lowering_debug_discards_only_pending_sensitive_records() {
        let sink = Arc::new(InMemorySink::default());
        let (telemetry, control) =
            Telemetry::build(PolicySnapshot::new(TelemetryLevel::Debug), sink.clone());
        telemetry.record_debug(content_record("discard-me"), None);
        assert_eq!(sink.debug_records().len(), 1);

        control.apply(PolicySnapshot::new(TelemetryLevel::Diagnostic));

        assert!(sink.debug_records().is_empty());
        assert!(telemetry.is_enabled());
        assert_eq!(
            telemetry.policy_snapshot().level(),
            TelemetryLevel::Diagnostic
        );
    }
}
