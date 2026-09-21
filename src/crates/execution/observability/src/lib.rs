//! Portable observability contracts for BitFun.
//!
//! Business owners submit typed lifecycle facts through [`domains`]. Records
//! reach a sink only after the schema and privacy gate accept them. This crate
//! has no dependency on an OpenTelemetry SDK, product assembly, application
//! entrypoints, or external transports.

mod admission;
mod debug;
mod facade;
mod model;
mod resource;
mod schema;
mod sink;
mod trace_context;

pub mod config;
pub mod domains;

pub use config::{
    TelemetryUserConfig, TelemetryUserConfigV1, TelemetryUserConfigV2,
    TELEMETRY_USER_CONFIG_VERSION,
};
pub use debug::{
    DebugApprovalPhase, DebugApprovalRecord, DebugContentField, DebugCorrelation,
    DebugInferenceRecord, DebugLogRecord, DebugTelemetryRecord, DebugToolRecord, DebugTurnRecord,
    DEBUG_BATCH_MAX_BYTES, DEBUG_INSTRUMENTATION_SCOPE_NAME, DEBUG_QUEUE_MAX_BYTES,
    DEBUG_QUEUE_MAX_RECORDS, DEBUG_RECORD_MAX_BYTES, DEBUG_TELEMETRY_SCHEMA_VERSION,
};
pub use facade::{
    PolicySnapshot, SignalPolicy, Telemetry, TelemetryControl, TelemetryDiagnostics, TelemetrySpan,
};
pub use model::{
    Attribute, AttributeValue, LogRecord, MetricRecord, MetricValue, ObservationContext, Severity,
    SignalKind, SpanContext, SpanRecord, SpanStatus, TelemetryLevel, TraceRelation,
    ValidatedRecord,
};
pub use resource::{
    resource_descriptor, DeploymentEnvironment, HostArch, OsType, PseudonymousInstallationId,
    ReleaseChannel, ResourceFieldView, ResourceValueType, TelemetryEntrypoint, TelemetryResource,
    INSTRUMENTATION_SCOPE_NAME, INSTRUMENTATION_SCOPE_VERSION, TELEMETRY_SCHEMA_VERSION,
};
pub use schema::{
    descriptor_registry, DescriptorView, FieldType, FieldView, FrequencyClass, MetricUnit,
    PrivacyError,
};
pub use sink::{InMemorySink, NoopSink, TelemetrySink};
pub use trace_context::{TraceContextEnvelope, TraceContextError, TraceContextTrust};
