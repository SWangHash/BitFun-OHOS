use crate::auth::TelemetryRequestAuthorizer;
use crate::diagnostics::{TelemetryHealthSnapshot, TelemetryHealthState, TransportDiagnostics};
use crate::scheduler::{BoundedBatchScheduler, SchedulerSnapshot};
use crate::settings::{OtlpCompression, TelemetryCapabilities, ValidatedTelemetrySettings};
use crate::transport::{GenerationGate, GuardedHttpClient};
use crate::TelemetryRuntimeError;
use bitfun_observability::{
    descriptor_registry, Attribute, AttributeValue, DebugLogRecord, LogRecord, MetricRecord,
    MetricUnit, MetricValue, Severity, SpanContext as BitFunSpanContext, SpanRecord,
    SpanStatus, TelemetryLevel, TelemetryResource, ValidatedRecord, DEBUG_BATCH_MAX_BYTES,
    DEBUG_INSTRUMENTATION_SCOPE_NAME, DEBUG_QUEUE_MAX_BYTES, DEBUG_QUEUE_MAX_RECORDS,
    DEBUG_TELEMETRY_SCHEMA_VERSION, INSTRUMENTATION_SCOPE_NAME, INSTRUMENTATION_SCOPE_VERSION,
};
use opentelemetry::logs::{
    AnyValue, LogRecord as _, Logger as _, LoggerProvider as _, Severity as OtelSeverity,
};
use opentelemetry::metrics::{Counter, Histogram, Meter, MeterProvider as _};
use opentelemetry::trace::{
    Link, SpanContext, SpanId, SpanKind, Status, TraceFlags, TraceId, TraceState,
};
use opentelemetry::{InstrumentationScope, KeyValue};
use opentelemetry_otlp::{WithExportConfig, WithHttpConfig};
use opentelemetry_sdk::error::{OTelSdkError, OTelSdkResult};
use opentelemetry_sdk::logs::{
    LogBatch, LogExporter as _, LogProcessor, SdkLogRecord, SdkLogger, SdkLoggerProvider,
};
use opentelemetry_sdk::metrics::{
    Aggregation, InstrumentKind, PeriodicReader, SdkMeterProvider, Stream, Temporality,
};
use opentelemetry_sdk::trace::{SpanData, SpanEvents, SpanExporter as _, SpanLinks};
use opentelemetry_sdk::Resource;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const TRACE_WORKERS: usize = 2;
const LOG_WORKERS: usize = 2;
const OTLP_HTTP_TRACES_PATH: &str = "/v1/traces";
const OTLP_HTTP_METRICS_PATH: &str = "/v1/metrics";
const OTLP_HTTP_LOGS_PATH: &str = "/v1/logs";

#[derive(Debug, Clone)]
struct QueuedLog {
    record: SdkLogRecord,
    scope: InstrumentationScope,
}

#[derive(Debug, Clone)]
struct QueueLogProcessor {
    scheduler: Arc<BoundedBatchScheduler<QueuedLog>>,
    flush_timeout: Duration,
}

impl LogProcessor for QueueLogProcessor {
    fn emit(&self, record: &mut SdkLogRecord, scope: &InstrumentationScope) {
        self.scheduler.try_enqueue(
            QueuedLog {
                record: record.clone(),
                scope: scope.clone(),
            },
            estimate_log_bytes(record),
        );
    }

    fn force_flush(&self) -> OTelSdkResult {
        if self.scheduler.force_flush(self.flush_timeout) {
            Ok(())
        } else {
            Err(OTelSdkError::Timeout(self.flush_timeout))
        }
    }

    fn shutdown_with_timeout(&self, timeout: Duration) -> OTelSdkResult {
        if self.scheduler.shutdown(timeout, true) {
            Ok(())
        } else {
            Err(OTelSdkError::Timeout(timeout))
        }
    }
}

#[derive(Debug)]
struct MetricInstruments {
    meter: Meter,
    counters: Mutex<HashMap<&'static str, Counter<u64>>>,
    histograms: Mutex<HashMap<&'static str, Histogram<f64>>>,
}

impl MetricInstruments {
    fn new(meter: Meter) -> Self {
        Self {
            meter,
            counters: Mutex::new(HashMap::new()),
            histograms: Mutex::new(HashMap::new()),
        }
    }

    fn record(&self, record: MetricRecord) {
        let attributes = otel_attributes(record.attributes());
        let unit = metric_unit(record.name());
        match record.value() {
            MetricValue::Counter(value) => {
                let mut counters = self
                    .counters
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let counter = counters.entry(record.name()).or_insert_with(|| {
                    self.meter
                        .u64_counter(record.name())
                        .with_unit(unit)
                        .build()
                });
                counter.add(*value, &attributes);
            }
            MetricValue::Histogram(value) => {
                let mut histograms = self
                    .histograms
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let histogram = histograms.entry(record.name()).or_insert_with(|| {
                    self.meter
                        .f64_histogram(record.name())
                        .with_unit(unit)
                        .build()
                });
                histogram.record(*value, &attributes);
            }
        }
    }
}

pub(crate) struct OtelGeneration {
    generation: u64,
    user_level: TelemetryLevel,
    capabilities: TelemetryCapabilities,
    gate: Arc<GenerationGate>,
    diagnostics: Arc<TransportDiagnostics>,
    trace_scheduler: Option<Arc<BoundedBatchScheduler<SpanData>>>,
    log_scheduler: Option<Arc<BoundedBatchScheduler<QueuedLog>>>,
    debug_log_scheduler: Option<Arc<BoundedBatchScheduler<QueuedLog>>>,
    logger: Option<SdkLogger>,
    logger_provider: Option<SdkLoggerProvider>,
    debug_logger: Option<SdkLogger>,
    debug_logger_provider: Option<SdkLoggerProvider>,
    metrics: Option<MetricInstruments>,
    meter_provider: Option<SdkMeterProvider>,
    shutdown_timeout: Duration,
}

impl std::fmt::Debug for OtelGeneration {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("OtelGeneration")
            .field("generation", &self.generation)
            .field("capabilities", &self.capabilities)
            .field("active", &self.gate.is_active())
            .finish_non_exhaustive()
    }
}

impl OtelGeneration {
    pub(crate) fn build(
        generation: u64,
        user_level: TelemetryLevel,
        settings: &ValidatedTelemetrySettings,
        capabilities: TelemetryCapabilities,
        resource: TelemetryResource,
        authorizer: Arc<dyn TelemetryRequestAuthorizer>,
    ) -> Result<Arc<Self>, TelemetryRuntimeError> {
        let gate = Arc::new(GenerationGate::new());
        let diagnostics = Arc::new(TransportDiagnostics::default());
        let otel_resource = otel_resource(&resource);
        let scope = instrumentation_scope();

        let trace_scheduler = if settings.signals.traces() {
            let client = GuardedHttpClient::new(
                settings,
                gate.clone(),
                diagnostics.clone(),
                authorizer.clone(),
            )?;
            let exporters = (0..TRACE_WORKERS)
                .map(|_| {
                    build_span_exporter(settings, client.clone(), &otel_resource).map(Mutex::new)
                })
                .collect::<Result<Vec<_>, TelemetryRuntimeError>>()?;
            let export = Arc::new(move |batch: Vec<SpanData>| {
                with_exporter(&exporters, |exporter| {
                    futures::executor::block_on(exporter.export(batch)).is_ok()
                })
            });
            Some(BoundedBatchScheduler::new(
                "trace",
                TRACE_WORKERS,
                settings.batch.max_records_per_signal,
                settings.batch.max_bytes_per_signal,
                settings.batch.max_export_batch_records,
                settings.batch.max_export_batch_bytes,
                settings.scheduled_delay(),
                diagnostics.clone(),
                export,
            ))
        } else {
            None
        };

        let (log_scheduler, logger_provider, logger) = if settings.signals.logs() {
            let client = GuardedHttpClient::new(
                settings,
                gate.clone(),
                diagnostics.clone(),
                authorizer.clone(),
            )?;
            let exporters = (0..LOG_WORKERS)
                .map(|_| {
                    build_log_exporter(settings, client.clone(), &otel_resource).map(Mutex::new)
                })
                .collect::<Result<Vec<_>, TelemetryRuntimeError>>()?;
            let export = Arc::new(move |batch: Vec<QueuedLog>| {
                let borrowed = batch
                    .iter()
                    .map(|item| (&item.record, &item.scope))
                    .collect::<Vec<_>>();
                with_exporter(&exporters, |exporter| {
                    futures::executor::block_on(exporter.export(LogBatch::new(&borrowed))).is_ok()
                })
            });
            let scheduler = BoundedBatchScheduler::new(
                "log",
                LOG_WORKERS,
                settings.batch.max_records_per_signal,
                settings.batch.max_bytes_per_signal,
                settings.batch.max_export_batch_records,
                settings.batch.max_export_batch_bytes,
                settings.scheduled_delay(),
                diagnostics.clone(),
                export,
            );
            let provider = SdkLoggerProvider::builder()
                .with_resource(otel_resource.clone())
                .with_log_processor(QueueLogProcessor {
                    scheduler: scheduler.clone(),
                    flush_timeout: settings.shutdown_timeout(),
                })
                .build();
            let logger = provider.logger_with_scope(scope.clone());
            (Some(scheduler), Some(provider), Some(logger))
        } else {
            (None, None, None)
        };

        let (debug_log_scheduler, debug_logger_provider, debug_logger) =
            if user_level == TelemetryLevel::Debug && settings.signals.logs() {
                let client = GuardedHttpClient::new(
                    settings,
                    gate.clone(),
                    diagnostics.clone(),
                    authorizer.clone(),
                )?;
                let exporters = (0..LOG_WORKERS)
                    .map(|_| {
                        build_log_exporter(settings, client.clone(), &otel_resource).map(Mutex::new)
                    })
                    .collect::<Result<Vec<_>, TelemetryRuntimeError>>()?;
                let export = Arc::new(move |batch: Vec<QueuedLog>| {
                    let borrowed = batch
                        .iter()
                        .map(|item| (&item.record, &item.scope))
                        .collect::<Vec<_>>();
                    with_exporter(&exporters, |exporter| {
                        futures::executor::block_on(exporter.export(LogBatch::new(&borrowed)))
                            .is_ok()
                    })
                });
                let scheduler = BoundedBatchScheduler::new(
                    "debug-log",
                    LOG_WORKERS,
                    DEBUG_QUEUE_MAX_RECORDS,
                    DEBUG_QUEUE_MAX_BYTES,
                    64,
                    DEBUG_BATCH_MAX_BYTES,
                    settings.scheduled_delay(),
                    diagnostics.clone(),
                    export,
                );
                let provider = SdkLoggerProvider::builder()
                    .with_resource(otel_resource.clone())
                    .with_log_processor(QueueLogProcessor {
                        scheduler: scheduler.clone(),
                        flush_timeout: settings.shutdown_timeout(),
                    })
                    .build();
                let logger = provider.logger_with_scope(debug_instrumentation_scope());
                (Some(scheduler), Some(provider), Some(logger))
            } else {
                (None, None, None)
            };

        let (meter_provider, metrics) = if settings.signals.metrics() {
            let client =
                GuardedHttpClient::new(settings, gate.clone(), diagnostics.clone(), authorizer)?;
            let mut builder = opentelemetry_otlp::MetricExporter::builder()
                .with_http()
                .with_temporality(Temporality::Cumulative)
                .with_endpoint(otlp_http_signal_endpoint(
                    &settings.endpoint,
                    settings.endpoint_layout,
                    OTLP_HTTP_METRICS_PATH,
                ))
                .with_timeout(settings.request_timeout())
                .with_http_client(client);
            if settings.compression == OtlpCompression::Gzip {
                builder = builder.with_compression(opentelemetry_otlp::Compression::Gzip);
            }
            let exporter = builder
                .build()
                .map_err(|error| TelemetryRuntimeError::exporter("metric", error))?;
            let reader = PeriodicReader::builder(exporter)
                .with_interval(settings.metrics_export_interval())
                .build();
            let provider = SdkMeterProvider::builder()
                .with_resource(otel_resource)
                .with_reader(reader)
                .with_view(metric_view)
                .build();
            let meter = provider.meter_with_scope(scope);
            let metrics = MetricInstruments::new(meter);
            (Some(provider), Some(metrics))
        } else {
            (None, None)
        };

        Ok(Arc::new(Self {
            generation,
            user_level,
            capabilities,
            gate,
            diagnostics,
            trace_scheduler,
            log_scheduler,
            debug_log_scheduler,
            logger,
            logger_provider,
            debug_logger,
            debug_logger_provider,
            metrics,
            meter_provider,
            shutdown_timeout: settings.shutdown_timeout(),
        }))
    }

    pub(crate) fn emit(&self, record: ValidatedRecord) {
        if !self.gate.is_active() {
            return;
        }
        match record {
            ValidatedRecord::Span(record) => {
                if let Some(scheduler) = &self.trace_scheduler {
                    let bytes = estimate_span_bytes(&record);
                    scheduler.try_enqueue(span_data(record), bytes);
                }
            }
            ValidatedRecord::Metric(record) => {
                if let Some(metrics) = &self.metrics {
                    metrics.record(record);
                }
            }
            ValidatedRecord::Log(record) => {
                if let Some(logger) = &self.logger {
                    logger.emit(log_data(logger, record));
                }
            }
        }
    }

    pub(crate) fn emit_debug(&self, record: DebugLogRecord) {
        if !self.gate.is_active() || self.user_level != TelemetryLevel::Debug {
            return;
        }
        if let Some(logger) = &self.debug_logger {
            logger.emit(debug_log_data(logger, record));
        }
    }

    pub(crate) fn deactivate(&self) {
        self.gate.deactivate();
    }

    pub(crate) fn force_flush(&self, timeout: Duration) -> bool {
        let deadline = std::time::Instant::now() + timeout;
        let traces = self
            .trace_scheduler
            .as_ref()
            .is_none_or(|scheduler| scheduler.force_flush(remaining(deadline)));
        let logs = self
            .log_scheduler
            .as_ref()
            .is_none_or(|scheduler| scheduler.force_flush(remaining(deadline)));
        let debug_logs = self
            .debug_log_scheduler
            .as_ref()
            .is_none_or(|scheduler| scheduler.force_flush(remaining(deadline)));
        let metrics = self.meter_provider.as_ref().is_none_or(|provider| {
            bounded_meter_call(provider, remaining(deadline), |provider| {
                provider.force_flush()
            })
        });
        traces && logs && debug_logs && metrics
    }

    pub(crate) fn shutdown(&self, graceful: bool) -> bool {
        let deadline = std::time::Instant::now() + self.shutdown_timeout;
        let flushed = if graceful {
            self.force_flush(remaining(deadline))
        } else {
            true
        };
        let traces = self
            .trace_scheduler
            .as_ref()
            .is_none_or(|scheduler| scheduler.shutdown(remaining(deadline), false));
        let logs = self
            .log_scheduler
            .as_ref()
            .is_none_or(|scheduler| scheduler.shutdown(remaining(deadline), false));
        let debug_logs = self
            .debug_log_scheduler
            .as_ref()
            .is_none_or(|scheduler| scheduler.shutdown(remaining(deadline), false));
        let metrics = self.meter_provider.as_ref().is_none_or(|provider| {
            if graceful && flushed {
                bounded_meter_call(provider, remaining(deadline), |provider| {
                    provider.shutdown_with_timeout(Duration::ZERO)
                })
            } else {
                true
            }
        });
        self.gate.deactivate();
        flushed && traces && logs && debug_logs && metrics
    }

    pub(crate) fn discard(&self) {
        self.gate.deactivate();
        if let Some(scheduler) = &self.trace_scheduler {
            scheduler.cancel_and_discard();
        }
        if let Some(scheduler) = &self.log_scheduler {
            scheduler.cancel_and_discard();
        }
        if let Some(scheduler) = &self.debug_log_scheduler {
            scheduler.cancel_and_discard();
        }
    }

    pub(crate) fn discard_debug(&self) {
        if let Some(scheduler) = &self.debug_log_scheduler {
            scheduler.cancel_and_discard();
        }
    }

    pub(crate) fn health(&self) -> TelemetryHealthSnapshot {
        let trace = self
            .trace_scheduler
            .as_ref()
            .map_or_else(SchedulerSnapshot::default, |scheduler| scheduler.snapshot());
        let logs = self
            .log_scheduler
            .as_ref()
            .map_or_else(SchedulerSnapshot::default, |scheduler| scheduler.snapshot());
        let debug_logs = self
            .debug_log_scheduler
            .as_ref()
            .map_or_else(SchedulerSnapshot::default, |scheduler| scheduler.snapshot());
        let transport = self.diagnostics.snapshot();
        let queued_records =
            trace.retained_records + logs.retained_records + debug_logs.retained_records;
        let queued_bytes = trace.retained_bytes + logs.retained_bytes + debug_logs.retained_bytes;
        let in_flight_batches =
            trace.in_flight_batches + logs.in_flight_batches + debug_logs.in_flight_batches;
        let state = if !self.gate.is_active() {
            TelemetryHealthState::ShuttingDown
        } else if queued_records >= 3_072 || queued_bytes >= 12 * 1024 * 1024 {
            TelemetryHealthState::Backlogged
        } else if transport.failed_batches != 0
            || transport.server_rejected != 0
            || trace.export_failures != 0
            || logs.export_failures != 0
            || debug_logs.export_failures != 0
        {
            TelemetryHealthState::Degraded
        } else {
            TelemetryHealthState::Healthy
        };
        TelemetryHealthSnapshot {
            state,
            user_level: self.user_level,
            effective_level: self.capabilities.effective_level,
            generation: self.generation,
            queued_records,
            queued_bytes,
            in_flight_batches,
            retry_attempts: transport.retry_attempts,
            locally_dropped: transport.locally_dropped,
            ambiguous: transport.ambiguous,
            acknowledged: transport.acknowledged,
            server_rejected: transport.server_rejected,
            last_success_unix_ms: transport.last_success_unix_ms,
        }
    }
}

impl Drop for OtelGeneration {
    fn drop(&mut self) {
        self.gate.deactivate();
        let _ = self.logger_provider.take();
        let _ = self.debug_logger_provider.take();
    }
}

fn span_data(record: SpanRecord) -> SpanData {
    let mut links = SpanLinks::default();
    links.links = record
        .links()
        .iter()
        .copied()
        .map(|context| Link::with_context(otel_span_context(context, false)))
        .collect();
    SpanData {
        span_context: otel_span_context(record.context(), false),
        parent_span_id: record
            .parent_span_id()
            .map_or(SpanId::INVALID, SpanId::from_bytes),
        parent_span_is_remote: false,
        span_kind: SpanKind::Internal,
        name: record.name().into(),
        start_time: system_time(record.started_unix_nanos()),
        end_time: system_time(record.ended_unix_nanos()),
        attributes: otel_attributes(record.attributes()),
        dropped_attributes_count: 0,
        events: SpanEvents::default(),
        links,
        status: match record.status() {
            SpanStatus::Ok => Status::Ok,
            SpanStatus::Error => Status::error("operation_failed"),
            SpanStatus::Unset => Status::Unset,
        },
        instrumentation_scope: instrumentation_scope(),
    }
}

fn log_data(logger: &SdkLogger, record: LogRecord) -> SdkLogRecord {
    let mut data = logger.create_log_record();
    data.set_event_name(record.event_name());
    data.set_timestamp(system_time(record.timestamp_unix_nanos()));
    data.set_observed_timestamp(system_time(record.observed_unix_nanos()));
    data.set_severity_number(match record.severity() {
        Severity::Info => OtelSeverity::Info,
        Severity::Warn => OtelSeverity::Warn,
        Severity::Error => OtelSeverity::Error,
    });
    data.set_body(AnyValue::from(record.body()));
    if let Some(context) = record.span_context() {
        data.set_trace_context(
            TraceId::from_bytes(context.trace_id()),
            SpanId::from_bytes(context.span_id()),
            context.is_sampled().then_some(TraceFlags::SAMPLED),
        );
    }
    for attribute in record.attributes() {
        data.add_attribute(attribute.key(), log_attribute_value(attribute.value()));
    }
    data
}

fn debug_log_data(logger: &SdkLogger, record: DebugLogRecord) -> SdkLogRecord {
    let mut data = logger.create_log_record();
    data.set_event_name(record.event_name());
    data.set_timestamp(system_time(record.timestamp_unix_nanos()));
    data.set_observed_timestamp(system_time(record.observed_unix_nanos()));
    data.set_severity_number(match record.severity() {
        Severity::Info => OtelSeverity::Info,
        Severity::Warn => OtelSeverity::Warn,
        Severity::Error => OtelSeverity::Error,
    });
    data.set_body(AnyValue::from(record.body().to_string()));
    if let Some(context) = record.span_context() {
        data.set_trace_context(
            TraceId::from_bytes(context.trace_id()),
            SpanId::from_bytes(context.span_id()),
            context.is_sampled().then_some(TraceFlags::SAMPLED),
        );
    }
    data.add_attribute("data_class", AnyValue::from("debug_sensitive"));
    data.add_attribute(
        "bitfun.debug.schema.version",
        AnyValue::from(i64::from(DEBUG_TELEMETRY_SCHEMA_VERSION)),
    );
    data.add_attribute(
        "bitfun.debug.original_size_bytes",
        AnyValue::from(i64::try_from(record.original_size_bytes()).unwrap_or(i64::MAX)),
    );
    data.add_attribute("bitfun.debug.truncated", AnyValue::from(record.truncated()));
    data
}

fn instrumentation_scope() -> InstrumentationScope {
    InstrumentationScope::builder(INSTRUMENTATION_SCOPE_NAME)
        .with_version(INSTRUMENTATION_SCOPE_VERSION)
        .build()
}

fn debug_instrumentation_scope() -> InstrumentationScope {
    InstrumentationScope::builder(DEBUG_INSTRUMENTATION_SCOPE_NAME)
        .with_version(env!("CARGO_PKG_VERSION"))
        .build()
}

fn otel_resource(resource: &TelemetryResource) -> Resource {
    let mut attributes = vec![
        KeyValue::new("bitfun.entrypoint", resource.entrypoint().as_str()),
        KeyValue::new("service.name", resource.service_name()),
        KeyValue::new("service.version", resource.service_version()),
        KeyValue::new(
            "service.instance.id",
            resource.service_instance_id().hyphenated().to_string(),
        ),
        KeyValue::new(
            "deployment.environment.name",
            resource.deployment_environment().as_str(),
        ),
        KeyValue::new(
            "bitfun.telemetry.schema.version",
            i64::from(resource.schema_version()),
        ),
    ];
    if let Some(value) = resource.host_arch() {
        attributes.push(KeyValue::new("host.arch", value.as_str()));
    }
    if let Some(value) = resource.os_type() {
        attributes.push(KeyValue::new("os.type", value.as_str()));
    }
    if let Some(value) = resource.release_channel() {
        attributes.push(KeyValue::new("bitfun.release.channel", value.as_str()));
    }
    if let Some(value) = resource.pseudonymous_installation_id() {
        attributes.push(KeyValue::new(
            "bitfun.installation.pseudonymous_id",
            value.as_str().to_string(),
        ));
    }
    Resource::builder_empty()
        .with_attributes(attributes)
        .build()
}

fn otel_span_context(context: BitFunSpanContext, remote: bool) -> SpanContext {
    SpanContext::new(
        TraceId::from_bytes(context.trace_id()),
        SpanId::from_bytes(context.span_id()),
        if context.is_sampled() {
            TraceFlags::SAMPLED
        } else {
            TraceFlags::NOT_SAMPLED
        },
        remote,
        TraceState::default(),
    )
}

fn otel_attributes(attributes: &[Attribute]) -> Vec<KeyValue> {
    attributes
        .iter()
        .map(|attribute| match attribute.value() {
            AttributeValue::Enum(value) => KeyValue::new(attribute.key(), *value),
            AttributeValue::Bool(value) => KeyValue::new(attribute.key(), *value),
            AttributeValue::U64(value) => {
                KeyValue::new(attribute.key(), i64::try_from(*value).unwrap_or(i64::MAX))
            }
        })
        .collect()
}

fn log_attribute_value(value: &AttributeValue) -> AnyValue {
    match value {
        AttributeValue::Enum(value) => AnyValue::from(*value),
        AttributeValue::Bool(value) => AnyValue::from(*value),
        AttributeValue::U64(value) => AnyValue::from(i64::try_from(*value).unwrap_or(i64::MAX)),
    }
}

fn metric_unit(name: &str) -> &'static str {
    match descriptor_registry()
        .iter()
        .find(|descriptor| descriptor.name() == name)
        .and_then(|descriptor| descriptor.metric_unit())
    {
        Some(MetricUnit::Seconds) => "s",
        Some(MetricUnit::Tokens) => "{token}",
        Some(MetricUnit::One) | None => "1",
    }
}

fn metric_view(instrument: &opentelemetry_sdk::metrics::Instrument) -> Option<Stream> {
    let mut builder = Stream::builder().with_cardinality_limit(256);
    if instrument.kind() == InstrumentKind::Histogram {
        let boundaries = match instrument.unit() {
            "s" => vec![
                0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0,
                120.0, 300.0,
            ],
            "{token}" => vec![1.0, 8.0, 32.0, 128.0, 512.0, 2_048.0, 8_192.0, 32_768.0],
            _ => vec![1.0, 2.0, 5.0, 10.0, 25.0, 50.0, 100.0, 250.0, 1_000.0],
        };
        builder = builder.with_aggregation(Aggregation::ExplicitBucketHistogram {
            boundaries,
            record_min_max: true,
        });
    }
    builder.build().ok()
}

fn system_time(unix_nanos: u128) -> SystemTime {
    let seconds = (unix_nanos / 1_000_000_000).min(u128::from(u64::MAX)) as u64;
    let nanos = (unix_nanos % 1_000_000_000) as u32;
    UNIX_EPOCH + Duration::new(seconds, nanos)
}

fn remaining(deadline: std::time::Instant) -> Duration {
    deadline.saturating_duration_since(std::time::Instant::now())
}

fn bounded_meter_call(
    provider: &SdkMeterProvider,
    timeout: Duration,
    operation: fn(&SdkMeterProvider) -> OTelSdkResult,
) -> bool {
    if timeout.is_zero() {
        return false;
    }
    let provider = provider.clone();
    let (completed, receiver) = std::sync::mpsc::sync_channel(1);
    if std::thread::Builder::new()
        .name("bitfun-otel-metric-lifecycle".to_string())
        .spawn(move || {
            let _ = completed.send(operation(&provider).is_ok());
        })
        .is_err()
    {
        return false;
    }
    receiver.recv_timeout(timeout).unwrap_or(false)
}

fn estimate_span_bytes(record: &SpanRecord) -> usize {
    192usize
        .saturating_add(record.name().len())
        .saturating_add(record.attributes().len().saturating_mul(48))
        .saturating_add(record.links().len().saturating_mul(32))
}

fn estimate_log_bytes(record: &SdkLogRecord) -> usize {
    192usize
        .saturating_add(record.event_name().map_or(0, str::len))
        .saturating_add(record.body().map_or(0, estimate_log_value_bytes))
        .saturating_add(record.attributes_iter().count().saturating_mul(48))
}

fn estimate_log_value_bytes(value: &AnyValue) -> usize {
    match value {
        AnyValue::Int(_) | AnyValue::Double(_) | AnyValue::Boolean(_) => 16,
        AnyValue::String(value) => value.as_str().len(),
        AnyValue::Bytes(value) => value.len(),
        AnyValue::ListAny(values) => values.iter().fold(0usize, |total, value| {
            total.saturating_add(estimate_log_value_bytes(value))
        }),
        AnyValue::Map(values) => values.iter().fold(0usize, |total, (key, value)| {
            total
                .saturating_add(key.as_str().len())
                .saturating_add(estimate_log_value_bytes(value))
        }),
        _ => 32,
    }
}

fn with_exporter<T, R>(exporters: &[Mutex<T>], operation: impl FnOnce(&T) -> R) -> R {
    let mut operation = Some(operation);
    for exporter in exporters {
        if let Ok(exporter) = exporter.try_lock() {
            return operation.take().expect("operation is available")(&exporter);
        }
    }
    let exporter = exporters[0]
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    operation.take().expect("operation is available")(&exporter)
}

fn otlp_http_signal_endpoint(
    base_endpoint: &str,
    layout: crate::TelemetryEndpointLayout,
    signal_path: &'static str,
) -> String {
    debug_assert!(signal_path.starts_with('/'));
    format!("{base_endpoint}{}", layout.signal_path(signal_path))
}

fn build_span_exporter(
    settings: &ValidatedTelemetrySettings,
    client: GuardedHttpClient,
    resource: &Resource,
) -> Result<opentelemetry_otlp::SpanExporter, TelemetryRuntimeError> {
    let mut builder = opentelemetry_otlp::SpanExporter::builder()
        .with_http()
        .with_endpoint(otlp_http_signal_endpoint(
            &settings.endpoint,
            settings.endpoint_layout,
            OTLP_HTTP_TRACES_PATH,
        ))
        .with_timeout(settings.request_timeout())
        .with_http_client(client);
    if settings.compression == OtlpCompression::Gzip {
        builder = builder.with_compression(opentelemetry_otlp::Compression::Gzip);
    }
    let mut exporter = builder
        .build()
        .map_err(|error| TelemetryRuntimeError::exporter("trace", error))?;
    exporter.set_resource(resource);
    Ok(exporter)
}

fn build_log_exporter(
    settings: &ValidatedTelemetrySettings,
    client: GuardedHttpClient,
    resource: &Resource,
) -> Result<opentelemetry_otlp::LogExporter, TelemetryRuntimeError> {
    let mut builder = opentelemetry_otlp::LogExporter::builder()
        .with_http()
        .with_endpoint(otlp_http_signal_endpoint(
            &settings.endpoint,
            settings.endpoint_layout,
            OTLP_HTTP_LOGS_PATH,
        ))
        .with_timeout(settings.request_timeout())
        .with_http_client(client);
    if settings.compression == OtlpCompression::Gzip {
        builder = builder.with_compression(opentelemetry_otlp::Compression::Gzip);
    }
    let mut exporter = builder
        .build()
        .map_err(|error| TelemetryRuntimeError::exporter("log", error))?;
    exporter.set_resource(resource);
    Ok(exporter)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_observability::{
        DeploymentEnvironment, PseudonymousInstallationId, ReleaseChannel, TelemetryEntrypoint,
    };
    use std::collections::BTreeMap;

    #[test]
    fn appends_standard_signal_paths_to_the_validated_base_endpoint() {
        let base_endpoint = "https://collector.example.com:4318";

        assert_eq!(
            otlp_http_signal_endpoint(
                base_endpoint,
                crate::TelemetryEndpointLayout::StandardOtlp,
                OTLP_HTTP_TRACES_PATH,
            ),
            "https://collector.example.com:4318/v1/traces"
        );
        assert_eq!(
            otlp_http_signal_endpoint(
                base_endpoint,
                crate::TelemetryEndpointLayout::StandardOtlp,
                OTLP_HTTP_METRICS_PATH,
            ),
            "https://collector.example.com:4318/v1/metrics"
        );
        assert_eq!(
            otlp_http_signal_endpoint(
                base_endpoint,
                crate::TelemetryEndpointLayout::StandardOtlp,
                OTLP_HTTP_LOGS_PATH,
            ),
            "https://collector.example.com:4318/v1/logs"
        );
    }

    #[test]
    fn appends_bitfun_ingress_signal_paths() {
        let base_endpoint = "https://api.example.com";
        assert_eq!(
            otlp_http_signal_endpoint(
                base_endpoint,
                crate::TelemetryEndpointLayout::BitFunIngressV1,
                OTLP_HTTP_TRACES_PATH,
            ),
            "https://api.example.com/otlp/v1/traces"
        );
        assert_eq!(
            otlp_http_signal_endpoint(
                base_endpoint,
                crate::TelemetryEndpointLayout::BitFunIngressV1,
                OTLP_HTTP_METRICS_PATH,
            ),
            "https://api.example.com/otlp/v1/metrics"
        );
        assert_eq!(
            otlp_http_signal_endpoint(
                base_endpoint,
                crate::TelemetryEndpointLayout::BitFunIngressV1,
                OTLP_HTTP_LOGS_PATH,
            ),
            "https://api.example.com/otlp/v1/logs"
        );
    }

    #[test]
    fn resource_and_scope_mapping_contains_only_registered_safe_facts() {
        let resource =
            TelemetryResource::current(TelemetryEntrypoint::Cli, DeploymentEnvironment::Test)
                .with_release_channel(ReleaseChannel::Development)
                .with_pseudonymous_installation_id(PseudonymousInstallationId::from_hmac_digest(
                    [7; 32],
                ));
        let attributes = otel_resource(&resource)
            .iter()
            .map(|(key, value)| (key.as_str().to_string(), value.to_string()))
            .collect::<BTreeMap<_, _>>();
        assert_eq!(
            attributes.get("bitfun.entrypoint").map(String::as_str),
            Some("cli")
        );
        assert_eq!(
            attributes.get("service.name").map(String::as_str),
            Some("bitfun-cli")
        );
        assert_eq!(
            attributes
                .get("deployment.environment.name")
                .map(String::as_str),
            Some("test")
        );
        assert_eq!(
            attributes
                .get("bitfun.installation.pseudonymous_id")
                .map(String::len),
            Some(32)
        );
        let encoded = format!("{attributes:?}");
        for forbidden in [
            "endpoint",
            "credential",
            "user_name",
            "machine_name",
            "os_version",
            "local_path",
        ] {
            assert!(!encoded.contains(forbidden));
        }

        let scope = instrumentation_scope();
        assert_eq!(scope.name(), INSTRUMENTATION_SCOPE_NAME);
        assert_eq!(scope.version(), Some(INSTRUMENTATION_SCOPE_VERSION));

        let debug_scope = debug_instrumentation_scope();
        assert_eq!(debug_scope.name(), DEBUG_INSTRUMENTATION_SCOPE_NAME);
        assert_eq!(debug_scope.version(), Some(env!("CARGO_PKG_VERSION")));
    }

    #[test]
    fn log_byte_estimate_includes_the_sensitive_body() {
        let provider = SdkLoggerProvider::builder().build();
        let logger = provider.logger_with_scope(debug_instrumentation_scope());
        let mut small = logger.create_log_record();
        small.set_body(AnyValue::from("small"));
        let mut large = logger.create_log_record();
        large.set_body(AnyValue::from("x".repeat(1024)));

        assert!(estimate_log_bytes(&large) >= estimate_log_bytes(&small) + 1000);
    }

    #[test]
    fn debug_log_mapping_uses_fixed_schema_and_trace_context() {
        let sink = std::sync::Arc::new(bitfun_observability::InMemorySink::default());
        let (telemetry, _) = bitfun_observability::Telemetry::build(
            bitfun_observability::PolicySnapshot::new(TelemetryLevel::Debug),
            sink.clone(),
        );
        let span = bitfun_observability::domains::start_turn_with_relation(
            &telemetry,
            bitfun_observability::domains::TurnStartFacts {
                mode_class: bitfun_observability::domains::AgentModeClass::Agentic,
                trigger: bitfun_observability::domains::TurnTrigger::User,
                remote: false,
                subagent: false,
            },
            bitfun_observability::TraceRelation::Root,
        );
        let context = span.context();
        telemetry.record_debug(
            bitfun_observability::DebugTelemetryRecord::TurnInput(
                bitfun_observability::DebugTurnRecord {
                    correlation: bitfun_observability::DebugCorrelation::default(),
                    content: Some(bitfun_observability::DebugContentField::text(
                        "Authorization: Bearer hidden-token",
                    )),
                    modified_file_paths: None,
                    modified_file_paths_original_count: None,
                    workspace_path: None,
                    repository: None,
                    branch: None,
                    base_commit: None,
                },
            ),
            context,
        );
        let record = sink.debug_records().pop().expect("Debug record");
        let provider = SdkLoggerProvider::builder().build();
        let logger = provider.logger_with_scope(debug_instrumentation_scope());
        let data = debug_log_data(&logger, record);

        assert_eq!(data.event_name(), Some("bitfun.agent.turn"));
        let body = match data.body().expect("Debug body") {
            AnyValue::String(value) => value.as_str(),
            value => panic!("unexpected Debug body: {value:?}"),
        };
        assert!(body.contains("[REDACTED]"));
        assert!(!body.contains("hidden-token"));
        assert!(data.trace_context().is_some());
        let attributes = data
            .attributes_iter()
            .map(|(key, value)| (key.as_str(), value.clone()))
            .collect::<HashMap<_, _>>();
        assert_eq!(
            attributes.get("data_class"),
            Some(&AnyValue::from("debug_sensitive"))
        );
        assert_eq!(
            attributes.get("bitfun.debug.schema.version"),
            Some(&AnyValue::Int(1))
        );
        assert!(attributes.contains_key("bitfun.debug.original_size_bytes"));
        assert_eq!(
            attributes.get("bitfun.debug.truncated"),
            Some(&AnyValue::Boolean(false))
        );
    }
}
