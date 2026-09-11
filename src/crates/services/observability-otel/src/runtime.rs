use crate::auth::{NoTelemetryRequestAuthorizer, TelemetryRequestAuthorizer};
use crate::diagnostics::{TelemetryHealthSnapshot, TelemetryHealthState};
use crate::identity::InstallationIdentityStore;
use crate::pipeline::OtelGeneration;
use crate::secrets::TelemetrySecretProvider;
use crate::settings::{validate_enabled_config, TelemetryCapabilities, TelemetryDeploymentConfig};
use crate::TelemetryRuntimeError;
use bitfun_observability::{
    domains::{
        start_startup, CompletionFacts, SafeErrorType, StartupFinishFacts, StartupObservation,
    },
    DebugLogRecord, DeploymentEnvironment, PolicySnapshot, Telemetry, TelemetryControl,
    TelemetryEntrypoint, TelemetryLevel, TelemetryResource, TelemetrySink, TelemetryUserConfig,
    ValidatedRecord,
};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct TelemetryRuntimeMetadata {
    pub entrypoint: TelemetryEntrypoint,
    pub product_data_directory: PathBuf,
}

impl TelemetryRuntimeMetadata {
    pub fn new(
        entrypoint: TelemetryEntrypoint,
        product_data_directory: impl Into<PathBuf>,
    ) -> Self {
        Self {
            entrypoint,
            product_data_directory: product_data_directory.into(),
        }
    }
}

#[derive(Default)]
struct RuntimeRouter {
    generation: RwLock<Option<Arc<OtelGeneration>>>,
}

impl std::fmt::Debug for RuntimeRouter {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RuntimeRouter")
            .field("configured", &self.current().is_some())
            .finish()
    }
}

impl RuntimeRouter {
    fn current(&self) -> Option<Arc<OtelGeneration>> {
        self.generation
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn replace(&self, generation: Option<Arc<OtelGeneration>>) -> Option<Arc<OtelGeneration>> {
        std::mem::replace(
            &mut *self
                .generation
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
            generation,
        )
    }
}

impl TelemetrySink for RuntimeRouter {
    fn emit(&self, record: ValidatedRecord) {
        if let Some(generation) = self.current() {
            generation.emit(record);
        }
    }

    fn emit_debug(&self, record: DebugLogRecord) {
        if let Some(generation) = self.current() {
            generation.emit_debug(record);
        }
    }

    fn discard_pending(&self) {
        if let Some(generation) = self.current() {
            generation.discard();
        }
    }

    fn discard_debug_pending(&self) {
        if let Some(generation) = self.current() {
            generation.discard_debug();
        }
    }
}

struct RuntimeState {
    generation: u64,
    user_level: TelemetryLevel,
    effective_level: TelemetryLevel,
    lifecycle: TelemetryHealthState,
    capabilities: TelemetryCapabilities,
    config_fingerprint: Option<u64>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            generation: 0,
            user_level: TelemetryLevel::Off,
            effective_level: TelemetryLevel::Off,
            lifecycle: TelemetryHealthState::Closed,
            capabilities: TelemetryCapabilities::disabled(),
            config_fingerprint: None,
        }
    }
}

struct TelemetryRuntimeInner {
    metadata: TelemetryRuntimeMetadata,
    telemetry: Telemetry,
    control: TelemetryControl,
    router: Arc<RuntimeRouter>,
    identity: InstallationIdentityStore,
    secrets: Arc<dyn TelemetrySecretProvider>,
    authorizer: Arc<dyn TelemetryRequestAuthorizer>,
    lifecycle_lock: Mutex<()>,
    state: Mutex<RuntimeState>,
}

impl Drop for TelemetryRuntimeInner {
    fn drop(&mut self) {
        self.control.close_admission();
        if let Some(generation) = self.router.replace(None) {
            generation.discard();
            let _ = generation.shutdown(false);
        }
    }
}

#[derive(Clone)]
pub struct TelemetryRuntimeHandle {
    inner: Arc<TelemetryRuntimeInner>,
}

pub struct TelemetryStartupGuard {
    observation: Option<StartupObservation>,
}

impl TelemetryStartupGuard {
    pub fn complete(mut self) {
        self.finish(CompletionFacts::completed());
    }

    pub fn fail(mut self, error_type: SafeErrorType) {
        self.finish(CompletionFacts::failed(error_type));
    }

    fn finish(&mut self, completion: CompletionFacts) {
        let facts = StartupFinishFacts { completion };
        if let Some(observation) = self.observation.take() {
            observation.finish(facts);
        }
    }
}

impl Drop for TelemetryStartupGuard {
    fn drop(&mut self) {
        if self.observation.is_some() {
            self.finish(CompletionFacts::failed(SafeErrorType::Internal));
        }
    }
}

pub struct TelemetryRuntimeShutdownGuard {
    handle: TelemetryRuntimeHandle,
    armed: bool,
}

impl TelemetryRuntimeShutdownGuard {
    pub fn shutdown(mut self) -> bool {
        self.armed = false;
        self.handle.shutdown()
    }
}

impl Drop for TelemetryRuntimeShutdownGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        if std::thread::panicking() {
            self.handle.cancel_and_discard();
        } else {
            let _ = self.handle.shutdown();
        }
    }
}

impl std::fmt::Debug for TelemetryRuntimeHandle {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TelemetryRuntimeHandle")
            .field("health", &self.health())
            .finish_non_exhaustive()
    }
}

impl TelemetryRuntimeHandle {
    pub fn new(
        metadata: TelemetryRuntimeMetadata,
        secrets: Arc<dyn TelemetrySecretProvider>,
    ) -> Self {
        Self::new_with_authorizer(metadata, secrets, Arc::new(NoTelemetryRequestAuthorizer))
    }

    pub fn new_with_authorizer(
        metadata: TelemetryRuntimeMetadata,
        secrets: Arc<dyn TelemetrySecretProvider>,
        authorizer: Arc<dyn TelemetryRequestAuthorizer>,
    ) -> Self {
        let router = Arc::new(RuntimeRouter::default());
        let resource =
            TelemetryResource::current(metadata.entrypoint, DeploymentEnvironment::Development);
        let (telemetry, control) = Telemetry::build_with_resource(
            PolicySnapshot::new(TelemetryLevel::Off),
            resource,
            router.clone(),
        );
        let identity =
            InstallationIdentityStore::new(metadata.product_data_directory.join("telemetry"));
        Self {
            inner: Arc::new(TelemetryRuntimeInner {
                metadata,
                telemetry,
                control,
                router,
                identity,
                secrets,
                authorizer,
                lifecycle_lock: Mutex::new(()),
                state: Mutex::new(RuntimeState::default()),
            }),
        }
    }

    pub fn telemetry(&self) -> Telemetry {
        self.inner.telemetry.clone()
    }

    pub fn startup_guard(&self) -> TelemetryStartupGuard {
        TelemetryStartupGuard {
            observation: Some(start_startup(&self.inner.telemetry)),
        }
    }

    pub fn shutdown_guard(&self) -> TelemetryRuntimeShutdownGuard {
        TelemetryRuntimeShutdownGuard {
            handle: self.clone(),
            armed: true,
        }
    }

    pub fn capabilities(&self) -> TelemetryCapabilities {
        self.inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .capabilities
    }

    pub fn apply_config(
        &self,
        user: &TelemetryUserConfig,
        deployment: &TelemetryDeploymentConfig,
    ) -> Result<TelemetryCapabilities, TelemetryRuntimeError> {
        let _lifecycle = self
            .inner
            .lifecycle_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let user_level = user.effective_level();
        let config_fingerprint = config_fingerprint(user, deployment);
        let previous_level = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if state.config_fingerprint == Some(config_fingerprint)
                && state.effective_level == user_level
                && state.lifecycle == TelemetryHealthState::Healthy
            {
                return Ok(state.capabilities);
            }
            state.user_level = user_level;
            state.lifecycle = TelemetryHealthState::Starting;
            state.effective_level
        };

        if user_level == TelemetryLevel::Off {
            self.disable_locked(TelemetryHealthState::Closed);
            return Ok(TelemetryCapabilities::disabled());
        }

        let lowering = level_rank(user_level) < level_rank(previous_level);
        if lowering {
            self.inner.control.apply(PolicySnapshot::default());
            self.revoke_current_locked();
        }

        let (settings, capabilities) =
            match validate_enabled_config(user, deployment, self.inner.secrets.as_ref()) {
                Ok(settings) => settings,
                Err(error) => {
                    self.disable_locked(TelemetryHealthState::Degraded);
                    return Err(error);
                }
            };
        let scoped_id = match self.inner.identity.scoped_id(&settings.audience) {
            Ok(identity) => identity,
            Err(error) => {
                self.disable_locked(TelemetryHealthState::Degraded);
                return Err(error);
            }
        };
        let generation_number = {
            let state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.generation.saturating_add(1)
        };
        let resource =
            TelemetryResource::current(self.inner.metadata.entrypoint, settings.environment)
                .with_release_channel(settings.release_channel)
                .with_pseudonymous_installation_id(scoped_id);
        let generation = match OtelGeneration::build(
            generation_number,
            user_level,
            &settings,
            capabilities,
            resource,
            self.inner.authorizer.clone(),
        ) {
            Ok(generation) => generation,
            Err(error) => {
                self.disable_locked(TelemetryHealthState::Degraded);
                return Err(error);
            }
        };

        self.inner.control.close_admission();
        let old = self.inner.router.replace(Some(generation));
        if let Some(old) = old {
            old.deactivate();
            old.discard();
            let _ = old.shutdown(false);
        }
        let (trace_sample_ratio, success_log_ratio) =
            effective_sample_ratios(user_level, settings.sampling);
        self.inner.control.apply(
            PolicySnapshot::new(user_level)
                .with_signals(settings.signals)
                .with_trace_sample_ratio(trace_sample_ratio)
                .with_success_log_sample_ratio(success_log_ratio),
        );
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.generation = generation_number;
        state.effective_level = user_level;
        state.lifecycle = TelemetryHealthState::Healthy;
        state.capabilities = capabilities;
        state.config_fingerprint = Some(config_fingerprint);
        Ok(capabilities)
    }

    pub fn force_flush(&self) -> bool {
        let timeout = Duration::from_secs(2);
        self.inner
            .router
            .current()
            .is_none_or(|generation| generation.force_flush(timeout))
    }

    pub fn shutdown(&self) -> bool {
        let _lifecycle = self
            .inner
            .lifecycle_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.inner.control.close_admission();
        {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.lifecycle = TelemetryHealthState::ShuttingDown;
        }
        let flushed = self
            .inner
            .router
            .replace(None)
            .is_none_or(|generation| generation.shutdown(true));
        self.set_closed_locked();
        flushed
    }

    pub fn cancel_and_discard(&self) {
        let _lifecycle = self
            .inner
            .lifecycle_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.inner.control.close_admission();
        self.revoke_current_locked();
        self.set_closed_locked();
    }

    pub fn reset_identity(&self) -> Result<bool, TelemetryRuntimeError> {
        let _lifecycle = self
            .inner
            .lifecycle_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.inner.control.close_admission();
        self.revoke_current_locked();
        let removed = self.inner.identity.reset()?;
        self.set_closed_locked();
        Ok(removed)
    }

    pub fn health(&self) -> TelemetryHealthSnapshot {
        let (lifecycle, user_level, effective_level, generation) = {
            let state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            (
                state.lifecycle,
                state.user_level,
                state.effective_level,
                state.generation,
            )
        };
        if let Some(current) = self.inner.router.current() {
            let mut health = current.health();
            if matches!(
                lifecycle,
                TelemetryHealthState::Starting | TelemetryHealthState::ShuttingDown
            ) {
                health.state = lifecycle;
            }
            return health;
        }
        TelemetryHealthSnapshot {
            state: lifecycle,
            user_level,
            effective_level,
            generation,
            ..TelemetryHealthSnapshot::default()
        }
    }

    fn disable_locked(&self, lifecycle: TelemetryHealthState) {
        self.inner.control.apply(PolicySnapshot::default());
        self.revoke_current_locked();
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.effective_level = TelemetryLevel::Off;
        state.lifecycle = lifecycle;
        state.capabilities = TelemetryCapabilities::disabled();
        state.config_fingerprint = None;
    }

    fn revoke_current_locked(&self) {
        if let Some(generation) = self.inner.router.replace(None) {
            generation.deactivate();
            generation.discard();
            let _ = generation.shutdown(false);
        }
    }

    fn set_closed_locked(&self) {
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.effective_level = TelemetryLevel::Off;
        state.lifecycle = TelemetryHealthState::Closed;
        state.capabilities = TelemetryCapabilities::disabled();
        state.config_fingerprint = None;
    }
}

const fn level_rank(level: TelemetryLevel) -> u8 {
    match level {
        TelemetryLevel::Off => 0,
        TelemetryLevel::Basic => 1,
        TelemetryLevel::Diagnostic => 2,
        TelemetryLevel::Debug => 3,
    }
}

fn effective_sample_ratios(
    level: TelemetryLevel,
    sampling: crate::settings::TelemetrySamplingConfig,
) -> (f64, f64) {
    match level {
        TelemetryLevel::Off => (0.0, 0.0),
        TelemetryLevel::Basic => (0.0, sampling.basic_success_log_ratio),
        TelemetryLevel::Diagnostic => (
            sampling.diagnostic_trace_ratio,
            sampling.diagnostic_success_log_ratio,
        ),
        TelemetryLevel::Debug => (1.0, 1.0),
    }
}

fn config_fingerprint(user: &TelemetryUserConfig, deployment: &TelemetryDeploymentConfig) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_vec(user)
        .unwrap_or_default()
        .hash(&mut hasher);
    serde_json::to_vec(deployment)
        .unwrap_or_default()
        .hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NoTelemetrySecrets;
    use crate::{TelemetryBatchConfig, TelemetrySamplingConfig, TelemetrySignalTightening};
    use bitfun_observability::domains::{
        record_slash_command, SlashCommandClass, SlashCommandFacts, SlashCommandSource,
    };
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    #[test]
    fn diagnostic_defaults_to_full_sampling() {
        assert_eq!(
            effective_sample_ratios(
                TelemetryLevel::Diagnostic,
                crate::settings::TelemetrySamplingConfig::default(),
            ),
            (1.0, 1.0)
        );
    }

    #[tokio::test]
    async fn periodic_metrics_reader_exports_to_collector() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let (path_sender, path_receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let mut buffer = [0u8; 16 * 1024];
            let bytes = stream.read(&mut buffer).unwrap_or(0);
            let request = String::from_utf8_lossy(&buffer[..bytes]);
            let path = request
                .lines()
                .next()
                .and_then(|line| line.split_whitespace().nth(1))
                .unwrap_or_default()
                .to_string();
            let _ = path_sender.send(path);
            let response = b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            let _ = stream.write_all(response);
        });

        let mut deployment = TelemetryDeploymentConfig {
            endpoint: Some(endpoint),
            environment: DeploymentEnvironment::Test,
            allow_insecure_loopback: true,
            signals: TelemetrySignalTightening {
                traces: false,
                metrics: true,
                logs: false,
            },
            batch: TelemetryBatchConfig {
                metrics_export_interval_ms: 10,
                ..TelemetryBatchConfig::default()
            },
            ..TelemetryDeploymentConfig::default()
        };
        deployment.sampling = TelemetrySamplingConfig::default();

        let temporary = tempfile::tempdir().unwrap();
        let handle = TelemetryRuntimeHandle::new(
            TelemetryRuntimeMetadata::new(TelemetryEntrypoint::Cli, temporary.path()),
            Arc::new(NoTelemetrySecrets),
        );
        handle
            .apply_config(
                &TelemetryUserConfig::new(TelemetryLevel::Diagnostic),
                &deployment,
            )
            .unwrap();
        record_slash_command(
            &handle.telemetry(),
            SlashCommandFacts {
                command_class: SlashCommandClass::Workspace,
                source: SlashCommandSource::BuiltIn,
                has_arguments: false,
            },
        );

        let path = tokio::task::spawn_blocking(move || {
            path_receiver
                .recv_timeout(Duration::from_secs(2))
                .expect("PeriodicReader should export metrics")
        })
        .await
        .unwrap();
        assert_eq!(path, "/v1/metrics");
        let _ = handle.shutdown();
    }

    #[test]
    fn debug_sampling_is_full_while_lower_levels_keep_deployment_ratios() {
        let sampling = crate::settings::TelemetrySamplingConfig {
            diagnostic_trace_ratio: 0.03,
            basic_success_log_ratio: 0.04,
            diagnostic_success_log_ratio: 0.05,
        };

        assert_eq!(
            effective_sample_ratios(TelemetryLevel::Basic, sampling),
            (0.0, 0.04)
        );
        assert_eq!(
            effective_sample_ratios(TelemetryLevel::Diagnostic, sampling),
            (0.03, 0.05)
        );
        assert_eq!(
            effective_sample_ratios(TelemetryLevel::Debug, sampling),
            (1.0, 1.0)
        );
    }

    #[test]
    fn default_runtime_is_closed_and_does_not_create_identity() {
        let temporary = tempfile::tempdir().unwrap();
        let handle = TelemetryRuntimeHandle::new(
            TelemetryRuntimeMetadata::new(TelemetryEntrypoint::Cli, temporary.path()),
            Arc::new(NoTelemetrySecrets),
        );

        assert_eq!(handle.health().state, TelemetryHealthState::Closed);
        assert!(!temporary.path().join("telemetry").exists());
        assert!(!handle.telemetry().is_enabled());
    }

    #[test]
    fn enabled_preference_without_product_endpoint_effectively_stays_off() {
        let temporary = tempfile::tempdir().unwrap();
        let handle = TelemetryRuntimeHandle::new(
            TelemetryRuntimeMetadata::new(TelemetryEntrypoint::Cli, temporary.path()),
            Arc::new(NoTelemetrySecrets),
        );
        let user = TelemetryUserConfig::V1(bitfun_observability::TelemetryUserConfigV1::new(
            TelemetryLevel::Basic,
        ));

        assert!(handle
            .apply_config(&user, &TelemetryDeploymentConfig::default())
            .is_err());
        let health = handle.health();
        assert_eq!(health.user_level, TelemetryLevel::Basic);
        assert_eq!(health.effective_level, TelemetryLevel::Off);
        assert_eq!(health.state, TelemetryHealthState::Degraded);
        assert!(!temporary.path().join("telemetry").exists());
    }

    fn loopback_deployment() -> TelemetryDeploymentConfig {
        TelemetryDeploymentConfig {
            endpoint: Some("http://127.0.0.1:9".to_string()),
            environment: DeploymentEnvironment::Test,
            release_channel: bitfun_observability::ReleaseChannel::Development,
            allow_insecure_loopback: true,
            ..TelemetryDeploymentConfig::default()
        }
    }

    #[test]
    fn applying_identical_config_is_idempotent_and_level_changes_rotate_generation() {
        let temporary = tempfile::tempdir().unwrap();
        let handle = TelemetryRuntimeHandle::new(
            TelemetryRuntimeMetadata::new(TelemetryEntrypoint::Cli, temporary.path()),
            Arc::new(NoTelemetrySecrets),
        );
        let deployment = loopback_deployment();
        let basic = TelemetryUserConfig::new(TelemetryLevel::Basic);
        handle.apply_config(&basic, &deployment).unwrap();
        let first = handle.health();
        assert_eq!(first.state, TelemetryHealthState::Healthy);
        assert_eq!(first.generation, 1);
        assert!(temporary
            .path()
            .join("telemetry/installation-root-id")
            .exists());

        handle.apply_config(&basic, &deployment).unwrap();
        assert_eq!(handle.health().generation, 1);

        let diagnostic = TelemetryUserConfig::new(TelemetryLevel::Diagnostic);
        handle.apply_config(&diagnostic, &deployment).unwrap();
        assert_eq!(handle.health().generation, 2);
        assert_eq!(handle.health().effective_level, TelemetryLevel::Diagnostic);

        handle
            .apply_config(&TelemetryUserConfig::new(TelemetryLevel::Off), &deployment)
            .unwrap();
        assert_eq!(handle.health().state, TelemetryHealthState::Closed);
        assert!(!handle.telemetry().is_enabled());
    }

    #[test]
    fn reset_identity_closes_runtime_discards_generation_and_deletes_root() {
        let temporary = tempfile::tempdir().unwrap();
        let handle = TelemetryRuntimeHandle::new(
            TelemetryRuntimeMetadata::new(TelemetryEntrypoint::Desktop, temporary.path()),
            Arc::new(NoTelemetrySecrets),
        );
        handle
            .apply_config(
                &TelemetryUserConfig::new(TelemetryLevel::Basic),
                &loopback_deployment(),
            )
            .unwrap();
        let identity = temporary.path().join("telemetry/installation-root-id");
        assert!(identity.exists());

        assert!(handle.reset_identity().unwrap());
        assert!(!identity.exists());
        assert_eq!(handle.health().state, TelemetryHealthState::Closed);
        assert!(!handle.telemetry().is_enabled());
    }
}
