//! Concrete OpenTelemetry transport and runtime for BitFun.
//!
//! Product code depends on `bitfun-observability`; this crate is instantiated
//! only by application entrypoints and owns identity, secrets, batching, OTLP,
//! reconfiguration, and health reporting.

mod auth;
mod diagnostics;
mod environment;
mod error;
mod identity;
mod pipeline;
mod runtime;
mod scheduler;
mod secrets;
mod settings;
mod transport;

pub use auth::{NoTelemetryRequestAuthorizer, TelemetryAuthorization, TelemetryRequestAuthorizer};
pub use diagnostics::{TelemetryHealthSnapshot, TelemetryHealthState};
pub use environment::{telemetry_level_from_env, telemetry_secret_dir_from_env};
pub use error::TelemetryRuntimeError;
pub use identity::InstallationIdentityStore;
pub use runtime::{
    TelemetryRuntimeHandle, TelemetryRuntimeMetadata, TelemetryRuntimeShutdownGuard,
    TelemetryStartupGuard,
};
pub use secrets::{
    NoTelemetrySecrets, OtlpHeaders, ReadOnlySecretFileProvider, SystemKeyringTelemetrySecrets,
    TelemetrySecretProvider,
};
pub use settings::{
    OtlpCompression, TelemetryBatchConfig, TelemetryCapabilities, TelemetryDeploymentConfig,
    TelemetryEndpointLayout, TelemetryRetryConfig, TelemetrySamplingConfig,
    TelemetrySignalTightening,
};
