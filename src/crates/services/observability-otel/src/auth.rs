use crate::TelemetryRuntimeError;

/// A request-scoped authorization value. It intentionally has no `Debug` or
/// `Display` implementation so credentials cannot be formatted accidentally.
pub struct TelemetryAuthorization(String);

impl TelemetryAuthorization {
    pub fn bearer(access_token: String) -> Result<Self, TelemetryRuntimeError> {
        if access_token.is_empty()
            || access_token.len() > 8_192
            || access_token.bytes().any(|byte| byte.is_ascii_control())
        {
            return Err(TelemetryRuntimeError::Authorization(
                "telemetry access token is invalid",
            ));
        }
        Ok(Self(format!("Bearer {access_token}")))
    }

    pub(crate) fn header_value(&self) -> &str {
        &self.0
    }
}

#[async_trait::async_trait]
pub trait TelemetryRequestAuthorizer: Send + Sync + 'static {
    async fn authorization(
        &self,
        force_refresh: bool,
    ) -> Result<Option<TelemetryAuthorization>, TelemetryRuntimeError>;
}

#[derive(Debug, Default)]
pub struct NoTelemetryRequestAuthorizer;

#[async_trait::async_trait]
impl TelemetryRequestAuthorizer for NoTelemetryRequestAuthorizer {
    async fn authorization(
        &self,
        _force_refresh: bool,
    ) -> Result<Option<TelemetryAuthorization>, TelemetryRuntimeError> {
        Ok(None)
    }
}
