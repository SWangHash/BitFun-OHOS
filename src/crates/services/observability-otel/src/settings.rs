use crate::environment;
use crate::secrets::{OtlpHeaders, TelemetrySecretProvider};
use crate::TelemetryRuntimeError;
use bitfun_observability::{
    DeploymentEnvironment, ReleaseChannel, SignalPolicy, TelemetryLevel, TelemetryUserConfig,
};
use serde::{Deserialize, Serialize};
use std::fmt;
use std::time::Duration;
use url::Url;

const MAX_ENDPOINT_LENGTH: usize = 2_048;
const MAX_HEADER_VALUE_LENGTH: usize = 8_192;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OtlpCompression {
    None,
    #[default]
    Gzip,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelemetryEndpointLayout {
    #[default]
    StandardOtlp,
    BitFunIngressV1,
}

impl TelemetryEndpointLayout {
    pub(crate) fn signal_path(self, standard_path: &'static str) -> &'static str {
        match (self, standard_path) {
            (Self::BitFunIngressV1, "/v1/traces") => "/otlp/v1/traces",
            (Self::BitFunIngressV1, "/v1/metrics") => "/otlp/v1/metrics",
            (Self::BitFunIngressV1, "/v1/logs") => "/otlp/v1/logs",
            _ => standard_path,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TelemetrySignalTightening {
    pub traces: bool,
    pub metrics: bool,
    pub logs: bool,
}

impl Default for TelemetrySignalTightening {
    fn default() -> Self {
        Self {
            traces: true,
            metrics: true,
            logs: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TelemetryBatchConfig {
    pub max_records_per_signal: usize,
    pub max_bytes_per_signal: usize,
    pub max_export_batch_records: usize,
    pub max_export_batch_bytes: usize,
    pub scheduled_delay_ms: u64,
    pub metrics_export_interval_ms: u64,
    pub request_timeout_ms: u64,
    pub shutdown_timeout_ms: u64,
}

impl Default for TelemetryBatchConfig {
    fn default() -> Self {
        Self {
            max_records_per_signal: 2_048,
            max_bytes_per_signal: 8 * 1024 * 1024,
            max_export_batch_records: 512,
            max_export_batch_bytes: 1024 * 1024,
            scheduled_delay_ms: 5_000,
            metrics_export_interval_ms: 60_000,
            request_timeout_ms: 10_000,
            shutdown_timeout_ms: 2_000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TelemetrySamplingConfig {
    pub diagnostic_trace_ratio: f64,
    pub basic_success_log_ratio: f64,
    pub diagnostic_success_log_ratio: f64,
}

impl Default for TelemetrySamplingConfig {
    fn default() -> Self {
        Self {
            diagnostic_trace_ratio: 1.0,
            basic_success_log_ratio: 0.1,
            diagnostic_success_log_ratio: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct TelemetryRetryConfig {
    pub max_retries: u8,
    pub initial_delay_ms: u64,
    pub max_delay_ms: u64,
    pub total_budget_ms: u64,
}

impl Default for TelemetryRetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 8,
            initial_delay_ms: 1_000,
            max_delay_ms: 30_000,
            total_budget_ms: 5 * 60_000,
        }
    }
}

/// Product/deployment-owned settings. This type must never be projected into
/// frontend config DTOs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TelemetryDeploymentConfig {
    pub endpoint: Option<String>,
    pub environment: DeploymentEnvironment,
    pub release_channel: ReleaseChannel,
    pub credential_namespace: String,
    pub headers_secret_ref: Option<String>,
    pub allow_insecure_loopback: bool,
    pub endpoint_layout: TelemetryEndpointLayout,
    pub compression: OtlpCompression,
    pub signals: TelemetrySignalTightening,
    pub batch: TelemetryBatchConfig,
    pub sampling: TelemetrySamplingConfig,
    pub retry: TelemetryRetryConfig,
}

impl Default for TelemetryDeploymentConfig {
    fn default() -> Self {
        Self {
            endpoint: None,
            environment: DeploymentEnvironment::Development,
            release_channel: ReleaseChannel::Development,
            credential_namespace: "anonymous".to_string(),
            headers_secret_ref: None,
            allow_insecure_loopback: false,
            endpoint_layout: TelemetryEndpointLayout::StandardOtlp,
            compression: OtlpCompression::Gzip,
            signals: TelemetrySignalTightening::default(),
            batch: TelemetryBatchConfig::default(),
            sampling: TelemetrySamplingConfig::default(),
            retry: TelemetryRetryConfig::default(),
        }
    }
}

impl TelemetryDeploymentConfig {
    /// Desktop/CLI/SDK product-owned settings. Receiver and credential values
    /// are compiled into the product build rather than read from user config.
    pub fn from_product_build() -> Self {
        let mut config = Self {
            endpoint: environment::product_otlp_endpoint().map(ToOwned::to_owned),
            credential_namespace: environment::product_credential_namespace()
                .unwrap_or("bitfun-product")
                .to_string(),
            headers_secret_ref: environment::product_headers_secret_ref().map(ToOwned::to_owned),
            environment: if cfg!(debug_assertions) {
                DeploymentEnvironment::Development
            } else {
                DeploymentEnvironment::Production
            },
            release_channel: release_channel(environment::product_release_channel().unwrap_or(
                if cfg!(debug_assertions) {
                    "development"
                } else {
                    "stable"
                },
            )),
            ..Self::default()
        };
        if cfg!(debug_assertions) {
            config.allow_insecure_loopback = true;
        }
        config
    }

    /// Server/Relay deployment-owned settings. These variables belong to the
    /// process deployment, not to user-importable BitFun configuration.
    pub fn from_deployment_env() -> Self {
        let mut config = Self {
            endpoint: environment::deployment_otlp_endpoint(),
            credential_namespace: environment::deployment_credential_namespace(),
            headers_secret_ref: environment::deployment_headers_secret_ref(),
            environment: deployment_environment(&environment::deployment_environment_name()),
            release_channel: release_channel(&environment::deployment_release_channel()),
            ..Self::default()
        };
        config.allow_insecure_loopback = environment::deployment_allows_loopback_http();
        config
    }
}

fn deployment_environment(value: &str) -> DeploymentEnvironment {
    match value.trim().to_ascii_lowercase().as_str() {
        "production" => DeploymentEnvironment::Production,
        "staging" => DeploymentEnvironment::Staging,
        "test" => DeploymentEnvironment::Test,
        _ => DeploymentEnvironment::Development,
    }
}

fn release_channel(value: &str) -> ReleaseChannel {
    match value.trim().to_ascii_lowercase().as_str() {
        "stable" => ReleaseChannel::Stable,
        "beta" => ReleaseChannel::Beta,
        "nightly" => ReleaseChannel::Nightly,
        _ => ReleaseChannel::Development,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetryCapabilities {
    pub configured: bool,
    pub effective_level: TelemetryLevel,
    pub traces: bool,
    pub metrics: bool,
    pub logs: bool,
}

impl TelemetryCapabilities {
    pub const fn disabled() -> Self {
        Self {
            configured: false,
            effective_level: TelemetryLevel::Off,
            traces: false,
            metrics: false,
            logs: false,
        }
    }
}

pub(crate) struct ValidatedTelemetrySettings {
    pub endpoint: String,
    pub audience: String,
    pub headers: OtlpHeaders,
    pub endpoint_layout: TelemetryEndpointLayout,
    pub compression: OtlpCompression,
    pub signals: SignalPolicy,
    pub batch: TelemetryBatchConfig,
    pub sampling: TelemetrySamplingConfig,
    pub retry: TelemetryRetryConfig,
    pub environment: DeploymentEnvironment,
    pub release_channel: ReleaseChannel,
}

impl fmt::Debug for ValidatedTelemetrySettings {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ValidatedTelemetrySettings")
            .field("compression", &self.compression)
            .field("signals", &self.signals)
            .field("batch", &self.batch)
            .field("sampling", &self.sampling)
            .field("retry", &self.retry)
            .field("environment", &self.environment)
            .field("release_channel", &self.release_channel)
            .finish_non_exhaustive()
    }
}

impl ValidatedTelemetrySettings {
    pub(crate) fn request_timeout(&self) -> Duration {
        Duration::from_millis(self.batch.request_timeout_ms)
    }

    pub(crate) fn shutdown_timeout(&self) -> Duration {
        Duration::from_millis(self.batch.shutdown_timeout_ms)
    }

    pub(crate) fn scheduled_delay(&self) -> Duration {
        Duration::from_millis(self.batch.scheduled_delay_ms)
    }

    pub(crate) fn metrics_export_interval(&self) -> Duration {
        Duration::from_millis(self.batch.metrics_export_interval_ms)
    }
}

pub(crate) fn validate_enabled_config(
    user: &TelemetryUserConfig,
    deployment: &TelemetryDeploymentConfig,
    secrets: &dyn TelemetrySecretProvider,
) -> Result<(ValidatedTelemetrySettings, TelemetryCapabilities), TelemetryRuntimeError> {
    let level = user.effective_level();
    if level == TelemetryLevel::Off {
        return Err(TelemetryRuntimeError::InvalidConfig(
            "telemetry user level is off",
        ));
    }
    validate_batch(deployment.batch)?;
    validate_sampling(deployment.sampling)?;
    validate_retry(deployment.retry)?;

    let endpoint = deployment
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(TelemetryRuntimeError::InvalidConfig(
            "product telemetry endpoint is unavailable",
        ))?;
    let (endpoint, receiver) = validate_endpoint(endpoint, deployment)?;
    if !valid_namespace(&deployment.credential_namespace) {
        return Err(TelemetryRuntimeError::InvalidConfig(
            "credential namespace is invalid",
        ));
    }
    let headers = match deployment.headers_secret_ref.as_deref() {
        Some(reference) => validate_headers(secrets.resolve_headers(reference)?)?,
        None => OtlpHeaders::new(),
    };
    let traces = matches!(level, TelemetryLevel::Diagnostic | TelemetryLevel::Debug)
        && deployment.signals.traces;
    let metrics = deployment.signals.metrics;
    let logs = deployment.signals.logs;
    if !traces && !metrics && !logs {
        return Err(TelemetryRuntimeError::InvalidConfig(
            "deployment disabled every telemetry signal",
        ));
    }
    let signals = SignalPolicy::new(traces, metrics, logs);
    let capabilities = TelemetryCapabilities {
        configured: true,
        effective_level: level,
        traces,
        metrics,
        logs,
    };
    Ok((
        ValidatedTelemetrySettings {
            endpoint,
            audience: format!("{receiver}|{}", deployment.credential_namespace),
            headers,
            endpoint_layout: deployment.endpoint_layout,
            compression: deployment.compression,
            signals,
            batch: deployment.batch,
            sampling: deployment.sampling,
            retry: deployment.retry,
            environment: deployment.environment,
            release_channel: deployment.release_channel,
        },
        capabilities,
    ))
}

fn validate_endpoint(
    endpoint: &str,
    deployment: &TelemetryDeploymentConfig,
) -> Result<(String, String), TelemetryRuntimeError> {
    if endpoint.len() > MAX_ENDPOINT_LENGTH {
        return Err(TelemetryRuntimeError::InvalidConfig("endpoint is too long"));
    }
    let parsed = Url::parse(endpoint)
        .map_err(|_| TelemetryRuntimeError::InvalidConfig("endpoint is not a valid URL"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(TelemetryRuntimeError::InvalidConfig(
            "endpoint must be an HTTP or HTTPS URL with a host",
        ));
    }
    if !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || !matches!(parsed.path(), "" | "/")
    {
        return Err(TelemetryRuntimeError::InvalidConfig(
            "endpoint must be a base URL without credentials, query, fragment, or path",
        ));
    }
    let loopback_http = parsed.scheme() == "http"
        && deployment.allow_insecure_loopback
        && matches!(
            deployment.environment,
            DeploymentEnvironment::Development | DeploymentEnvironment::Test
        )
        && is_loopback(&parsed);
    let debug_ingress_http = cfg!(debug_assertions)
        && parsed.scheme() == "http"
        && deployment.endpoint_layout == TelemetryEndpointLayout::BitFunIngressV1
        && parsed.host_str() == Some("api-test.infra-bitfun.com")
        && parsed.port_or_known_default() == Some(80);
    if parsed.scheme() != "https" && !loopback_http && !debug_ingress_http {
        return Err(TelemetryRuntimeError::InvalidConfig(
            "non-loopback collectors must use HTTPS",
        ));
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let port = parsed
        .port_or_known_default()
        .ok_or(TelemetryRuntimeError::InvalidConfig(
            "endpoint port is unknown",
        ))?;
    let receiver = format!("{}://{host}:{port}", parsed.scheme());
    Ok((endpoint.trim_end_matches('/').to_string(), receiver))
}

fn validate_batch(config: TelemetryBatchConfig) -> Result<(), TelemetryRuntimeError> {
    if !(1..=2_048).contains(&config.max_records_per_signal)
        || !(1..=8 * 1024 * 1024).contains(&config.max_bytes_per_signal)
        || !(1..=512).contains(&config.max_export_batch_records)
        || config.max_export_batch_records > config.max_records_per_signal
        || !(1..=1024 * 1024).contains(&config.max_export_batch_bytes)
        || config.max_export_batch_bytes > config.max_bytes_per_signal
    {
        return Err(TelemetryRuntimeError::InvalidConfig(
            "batch capacity exceeds the telemetry safety ceiling",
        ));
    }
    for value in [
        config.scheduled_delay_ms,
        config.metrics_export_interval_ms,
        config.request_timeout_ms,
        config.shutdown_timeout_ms,
    ] {
        if !(10..=300_000).contains(&value) {
            return Err(TelemetryRuntimeError::InvalidConfig(
                "telemetry duration is outside the safety range",
            ));
        }
    }
    Ok(())
}

fn validate_sampling(config: TelemetrySamplingConfig) -> Result<(), TelemetryRuntimeError> {
    for ratio in [
        config.diagnostic_trace_ratio,
        config.basic_success_log_ratio,
        config.diagnostic_success_log_ratio,
    ] {
        if !ratio.is_finite() || !(0.0..=1.0).contains(&ratio) {
            return Err(TelemetryRuntimeError::InvalidConfig(
                "sampling ratio must be between zero and one",
            ));
        }
    }
    let defaults = TelemetrySamplingConfig::default();
    if config.diagnostic_trace_ratio > defaults.diagnostic_trace_ratio
        || config.basic_success_log_ratio > defaults.basic_success_log_ratio
        || config.diagnostic_success_log_ratio > defaults.diagnostic_success_log_ratio
    {
        return Err(TelemetryRuntimeError::InvalidConfig(
            "deployment sampling may only tighten product defaults",
        ));
    }
    Ok(())
}

fn validate_retry(config: TelemetryRetryConfig) -> Result<(), TelemetryRuntimeError> {
    if config.max_retries > 8
        || config.initial_delay_ms == 0
        || config.max_delay_ms < config.initial_delay_ms
        || config.max_delay_ms > 30_000
        || config.total_budget_ms > 300_000
    {
        return Err(TelemetryRuntimeError::InvalidConfig(
            "retry settings exceed the telemetry safety ceiling",
        ));
    }
    Ok(())
}

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(host)) => host.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    }
}

fn valid_namespace(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn validate_headers(headers: OtlpHeaders) -> Result<OtlpHeaders, TelemetryRuntimeError> {
    if headers.len() > 32 {
        return Err(TelemetryRuntimeError::Secret(
            "secret contains too many headers",
        ));
    }
    headers
        .into_iter()
        .map(|(name, value)| {
            let name = name.to_ascii_lowercase();
            if name.is_empty()
                || name.len() > 128
                || name.ends_with("-bin")
                || reserved_transport_header(&name)
                || !name.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || matches!(byte, b'-' | b'_' | b'.')
                })
            {
                return Err(TelemetryRuntimeError::Secret(
                    "secret contains an invalid header name",
                ));
            }
            if value.len() > MAX_HEADER_VALUE_LENGTH
                || value.bytes().any(|byte| matches!(byte, b'\r' | b'\n' | 0))
            {
                return Err(TelemetryRuntimeError::Secret(
                    "secret contains an invalid header value",
                ));
            }
            Ok((name, value))
        })
        .collect()
}

fn reserved_transport_header(name: &str) -> bool {
    matches!(
        name,
        "host"
            | "connection"
            | "content-type"
            | "content-length"
            | "content-encoding"
            | "transfer-encoding"
            | "user-agent"
            | "traceparent"
            | "tracestate"
            | "baggage"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NoTelemetrySecrets;
    use bitfun_observability::TelemetryUserConfigV1;

    fn local_config() -> TelemetryDeploymentConfig {
        TelemetryDeploymentConfig {
            endpoint: Some("http://127.0.0.1:4318".to_string()),
            environment: DeploymentEnvironment::Test,
            allow_insecure_loopback: true,
            ..Default::default()
        }
    }

    #[test]
    fn user_config_cannot_supply_receiver_or_capacity() {
        let serialized =
            serde_json::to_value(TelemetryUserConfigV1::new(TelemetryLevel::Diagnostic)).unwrap();
        assert_eq!(serialized.as_object().unwrap().len(), 2);
        assert!(serialized.get("endpoint").is_none());
        assert!(serialized.get("headers").is_none());
    }

    #[test]
    fn diagnostic_sampling_defaults_to_full() {
        let sampling = TelemetrySamplingConfig::default();

        assert_eq!(sampling.diagnostic_trace_ratio, 1.0);
        assert_eq!(sampling.diagnostic_success_log_ratio, 1.0);
        validate_sampling(sampling).unwrap();
    }

    #[test]
    fn deployment_sampling_can_only_tighten_product_defaults() {
        let tightened = TelemetrySamplingConfig {
            diagnostic_trace_ratio: 0.25,
            basic_success_log_ratio: 0.05,
            diagnostic_success_log_ratio: 0.5,
        };
        validate_sampling(tightened).unwrap();

        let raised_basic = TelemetrySamplingConfig {
            basic_success_log_ratio: 0.11,
            ..TelemetrySamplingConfig::default()
        };
        assert!(validate_sampling(raised_basic).is_err());
    }

    #[test]
    fn endpoint_accepts_only_a_base_url_and_scopes_receiver_audience() {
        let user = TelemetryUserConfig::V1(TelemetryUserConfigV1::new(TelemetryLevel::Basic));
        let first = validate_enabled_config(&user, &local_config(), &NoTelemetrySecrets)
            .unwrap()
            .0;
        assert_eq!(first.audience, "http://127.0.0.1:4318|anonymous");

        let mut invalid = local_config();
        invalid.endpoint = Some("http://127.0.0.1:4318/tenant".to_string());
        assert!(validate_enabled_config(&user, &invalid, &NoTelemetrySecrets).is_err());
    }

    #[test]
    fn production_rejects_plain_http_even_when_loopback_flag_is_set() {
        let user = TelemetryUserConfig::V1(TelemetryUserConfigV1::new(TelemetryLevel::Basic));
        let mut deployment = local_config();
        deployment.environment = DeploymentEnvironment::Production;
        assert!(validate_enabled_config(&user, &deployment, &NoTelemetrySecrets).is_err());
    }
}
