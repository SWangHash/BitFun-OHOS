//! Desktop telemetry lifecycle controlled by the privacy consent state.

use bitfun_observability::{TelemetryLevel, TelemetryUserConfig};
use bitfun_observability_otel::{TelemetryDeploymentConfig, TelemetryRuntimeHandle};
use std::sync::{Arc, Weak};
use std::time::Duration;

const CONSENTED_TELEMETRY_LEVEL: TelemetryLevel = TelemetryLevel::Diagnostic;

pub struct OhosTelemetryController {
    runtime: TelemetryRuntimeHandle,
    deployment: TelemetryDeploymentConfig,
}

impl OhosTelemetryController {
    pub fn new(runtime: TelemetryRuntimeHandle, deployment: TelemetryDeploymentConfig) -> Self {
        Self {
            runtime,
            deployment,
        }
    }

    pub fn reconcile(&self, collection_allowed: bool) -> Result<(), String> {
        let config = telemetry_config_for_privacy(collection_allowed);
        if config.effective_level() == TelemetryLevel::Off {
            self.disable();
            return Ok(());
        }
        if self.deployment.endpoint.is_none() {
            self.disable();
            return Ok(());
        }
        if let Err(error) = self.runtime.apply_config(&config, &self.deployment) {
            self.disable();
            return Err(error.to_string());
        }
        Ok(())
    }

    pub fn disable(&self) {
        let _ = self.runtime.apply_config(
            &TelemetryUserConfig::new(TelemetryLevel::Off),
            &self.deployment,
        );
        self.runtime.cancel_and_discard();
    }

    pub fn spawn_health_summary_logger(self: &Arc<Self>) {
        let controller: Weak<Self> = Arc::downgrade(self);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60 * 60));
            loop {
                interval.tick().await;
                let Some(controller) = controller.upgrade() else {
                    break;
                };
                let health = controller.runtime.health();
                let diagnostics = controller.runtime.telemetry().diagnostics();
                log::info!(
                    "Telemetry stats: state={:?}, user_level={:?}, effective_level={:?}, generation={}, queued_records={}, queued_bytes={}, in_flight_batches={}, retry_attempts={}, locally_dropped={}, ambiguous={}, acknowledged={}, server_rejected={}, debug_accepted={}, debug_rejected={}, debug_skipped={}",
                    health.state,
                    health.user_level,
                    health.effective_level,
                    health.generation,
                    health.queued_records,
                    health.queued_bytes,
                    health.in_flight_batches,
                    health.retry_attempts,
                    health.locally_dropped,
                    health.ambiguous,
                    health.acknowledged,
                    health.server_rejected,
                    diagnostics.accepted(),
                    diagnostics.rejected(),
                    diagnostics.skipped(),
                );
            }
        });
    }
}

fn telemetry_config_for_privacy(collection_allowed: bool) -> TelemetryUserConfig {
    TelemetryUserConfig::new(if collection_allowed {
        CONSENTED_TELEMETRY_LEVEL
    } else {
        TelemetryLevel::Off
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telemetry_is_off_without_privacy_consent() {
        let config = telemetry_config_for_privacy(false);

        assert_eq!(config.effective_level(), TelemetryLevel::Off);
        assert!(!config.sensitive_content_consent());
    }

    #[test]
    fn privacy_consent_enables_diagnostic_only() {
        let config = telemetry_config_for_privacy(true);

        assert_eq!(config.effective_level(), TelemetryLevel::Diagnostic);
        assert_ne!(config.effective_level(), TelemetryLevel::Basic);
        assert_ne!(config.effective_level(), TelemetryLevel::Debug);
        assert!(!config.sensitive_content_consent());
    }
}
