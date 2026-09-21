#![cfg(target_env = "ohos")]

use async_trait::async_trait;
use bitfun_observability_otel::{
    TelemetryAuthorization, TelemetryRequestAuthorizer, TelemetryRuntimeError,
};
use bitfun_services_integrations::anonymous_auth::{
    AnonymousAccessTokenProvider, AnonymousAuthService,
};
use std::sync::Arc;

pub struct OhosTelemetryRequestAuthorizer {
    auth: Arc<AnonymousAuthService>,
}

impl OhosTelemetryRequestAuthorizer {
    pub fn new(auth: Arc<AnonymousAuthService>) -> Self {
        Self { auth }
    }
}

#[async_trait]
impl TelemetryRequestAuthorizer for OhosTelemetryRequestAuthorizer {
    async fn authorization(
        &self,
        force_refresh: bool,
    ) -> Result<Option<TelemetryAuthorization>, TelemetryRuntimeError> {
        if !bitfun_core::util::wait_for_arkts_function(
            "feedback_secure_credentials",
            std::time::Duration::from_secs(10),
        )
        .await
        {
            return Err(TelemetryRuntimeError::Authorization(
                "OpenHarmony credential store is not ready",
            ));
        }
        let token = self
            .auth
            .access_token("otel:write", force_refresh)
            .await
            .map_err(|error| match error.code.as_str() {
                "SCOPE_INSUFFICIENT" => {
                    TelemetryRuntimeError::Authorization("otel:write scope is unavailable")
                }
                _ => TelemetryRuntimeError::Authorization("anonymous access is unavailable"),
            })?;
        TelemetryAuthorization::bearer(token).map(Some)
    }
}
