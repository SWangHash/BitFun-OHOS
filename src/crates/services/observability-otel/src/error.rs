use thiserror::Error;

#[derive(Debug, Error)]
pub enum TelemetryRuntimeError {
    #[error("invalid telemetry configuration: {0}")]
    InvalidConfig(&'static str),
    #[error("telemetry secret provider failed: {0}")]
    Secret(&'static str),
    #[error("telemetry request authorization failed: {0}")]
    Authorization(&'static str),
    #[error("telemetry identity storage failed: {0}")]
    Identity(#[source] std::io::Error),
    #[error("telemetry exporter setup failed for {signal}")]
    Exporter { signal: &'static str },
    #[error("telemetry lifecycle operation failed: {0}")]
    Lifecycle(&'static str),
}

impl TelemetryRuntimeError {
    pub(crate) fn exporter(signal: &'static str, _error: impl std::fmt::Display) -> Self {
        // Exporter errors can contain a receiver URL. Keep diagnostics classified
        // without carrying deployment configuration across the service boundary.
        Self::Exporter { signal }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exporter_errors_do_not_expose_receiver_details() {
        let error = TelemetryRuntimeError::exporter(
            "trace",
            "request to https://collector.example/private failed",
        );
        let rendered = error.to_string();

        assert_eq!(rendered, "telemetry exporter setup failed for trace");
        assert!(!rendered.contains("collector.example"));
    }
}
