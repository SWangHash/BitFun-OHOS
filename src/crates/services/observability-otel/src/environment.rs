//! Telemetry environment-variable ownership shared by service hosts.

use bitfun_observability::TelemetryLevel;
use std::path::PathBuf;

const OTLP_ENDPOINT: &str = "BITFUN_TELEMETRY_OTLP_ENDPOINT";
const CREDENTIAL_NAMESPACE: &str = "BITFUN_TELEMETRY_CREDENTIAL_NAMESPACE";
const HEADERS_SECRET_REF: &str = "BITFUN_TELEMETRY_HEADERS_SECRET_REF";
const DEPLOYMENT_ENVIRONMENT: &str = "BITFUN_TELEMETRY_ENVIRONMENT";
const RELEASE_CHANNEL: &str = "BITFUN_RELEASE_CHANNEL";
const ALLOW_LOOPBACK_HTTP: &str = "BITFUN_TELEMETRY_ALLOW_LOOPBACK_HTTP";
const SECRET_DIR: &str = "BITFUN_TELEMETRY_SECRET_DIR";
const LEVEL: &str = "BITFUN_TELEMETRY_LEVEL";
const DEFAULT_SECRET_DIR: &str = "/run/secrets/bitfun";

pub(crate) const fn product_otlp_endpoint() -> Option<&'static str> {
    option_env!("BITFUN_TELEMETRY_OTLP_ENDPOINT")
}

pub(crate) const fn product_credential_namespace() -> Option<&'static str> {
    option_env!("BITFUN_TELEMETRY_CREDENTIAL_NAMESPACE")
}

pub(crate) const fn product_headers_secret_ref() -> Option<&'static str> {
    option_env!("BITFUN_TELEMETRY_HEADERS_SECRET_REF")
}

pub(crate) const fn product_release_channel() -> Option<&'static str> {
    option_env!("BITFUN_RELEASE_CHANNEL")
}

pub(crate) fn deployment_otlp_endpoint() -> Option<String> {
    std::env::var(OTLP_ENDPOINT).ok()
}

pub(crate) fn deployment_credential_namespace() -> String {
    std::env::var(CREDENTIAL_NAMESPACE).unwrap_or_else(|_| "bitfun-service".to_string())
}

pub(crate) fn deployment_headers_secret_ref() -> Option<String> {
    std::env::var(HEADERS_SECRET_REF).ok()
}

pub(crate) fn deployment_environment_name() -> String {
    std::env::var(DEPLOYMENT_ENVIRONMENT).unwrap_or_else(|_| "production".to_string())
}

pub(crate) fn deployment_release_channel() -> String {
    std::env::var(RELEASE_CHANNEL).unwrap_or_else(|_| "stable".to_string())
}

pub(crate) fn deployment_allows_loopback_http() -> bool {
    std::env::var(ALLOW_LOOPBACK_HTTP)
        .is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

pub fn telemetry_secret_dir_from_env() -> PathBuf {
    std::env::var_os(SECRET_DIR)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_SECRET_DIR))
}

pub fn telemetry_level_from_env() -> TelemetryLevel {
    telemetry_level(&std::env::var(LEVEL).unwrap_or_default())
}

fn telemetry_level(value: &str) -> TelemetryLevel {
    match value.trim().to_ascii_lowercase().as_str() {
        "basic" => TelemetryLevel::Basic,
        "diagnostic" => TelemetryLevel::Diagnostic,
        "debug" => TelemetryLevel::Debug,
        _ => TelemetryLevel::Off,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deployment_level_is_bounded_and_case_insensitive() {
        assert_eq!(telemetry_level(" BASIC "), TelemetryLevel::Basic);
        assert_eq!(telemetry_level("Diagnostic"), TelemetryLevel::Diagnostic);
        assert_eq!(telemetry_level("debug"), TelemetryLevel::Debug);
        assert_eq!(telemetry_level("unsupported"), TelemetryLevel::Off);
    }
}
