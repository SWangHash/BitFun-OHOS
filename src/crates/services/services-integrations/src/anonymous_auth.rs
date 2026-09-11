use async_trait::async_trait;
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use reqwest::{Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use uuid::Uuid;

const ACCESS_TOKEN_REFRESH_MARGIN_SECONDS: i64 = 600;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const DEBUG_INGRESS_BASE_URL: &str = "http://api-test.infra-bitfun.com";
const RELEASE_INGRESS_BASE_URL: &str = "https://api.infra-bitfun.com";

#[async_trait]
pub trait AnonymousCredentialStore: Send + Sync {
    async fn load(&self) -> anyhow::Result<Option<String>>;
    async fn store(&self, value: &str) -> anyhow::Result<()>;
}

#[async_trait]
pub trait AnonymousAccessTokenProvider: Send + Sync {
    async fn access_token(
        &self,
        required_scope: &str,
        force_refresh: bool,
    ) -> Result<String, AnonymousAuthError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnonymousAuthError {
    pub code: String,
    pub retryable: bool,
    pub request_id: Option<String>,
    pub retry_after_seconds: Option<u64>,
}

impl AnonymousAuthError {
    fn new(code: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            retryable,
            request_id: None,
            retry_after_seconds: None,
        }
    }
}

impl std::fmt::Display for AnonymousAuthError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.code)
    }
}

impl std::error::Error for AnonymousAuthError {}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct StoredAnonymousCredentials {
    #[serde(default)]
    enroll_key: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    enroll_idempotency_key: Option<String>,
    #[serde(default)]
    refresh_idempotency_key: Option<String>,
    #[serde(default)]
    anonymous_id: Option<String>,
    #[serde(flatten)]
    extra: Map<String, Value>,
}

#[derive(Clone)]
struct AccessToken {
    value: String,
    expires_at: DateTime<Utc>,
    scopes: Vec<String>,
}

#[derive(Default)]
struct RuntimeState {
    loaded: bool,
    stored: StoredAnonymousCredentials,
    access_token: Option<AccessToken>,
}

#[derive(Deserialize)]
struct TokenResponse {
    anonymous_id: String,
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    scope: String,
}

#[derive(Default, Deserialize)]
struct ServerErrorBody {
    error_code: Option<String>,
    request_id: Option<String>,
}

pub struct AnonymousAuthService {
    client: reqwest::Client,
    base_url: Option<String>,
    credential_store: Arc<dyn AnonymousCredentialStore>,
    state: Mutex<RuntimeState>,
}

impl std::fmt::Debug for AnonymousAuthService {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AnonymousAuthService")
            .field("configured", &self.base_url.is_some())
            .finish_non_exhaustive()
    }
}

impl AnonymousAuthService {
    pub fn from_environment(credential_store: Arc<dyn AnonymousCredentialStore>) -> Self {
        Self::new(
            Some(bitfun_ingress_base_url(cfg!(debug_assertions)).to_string()),
            credential_store,
            REQUEST_TIMEOUT,
        )
    }

    pub fn new(
        base_url: Option<String>,
        credential_store: Arc<dyn AnonymousCredentialStore>,
        timeout: Duration,
    ) -> Self {
        Self {
            client: crate::reqwest_client_builder()
                .timeout(timeout)
                .build()
                .expect("anonymous auth HTTP client must initialize"),
            base_url,
            credential_store,
            state: Mutex::new(RuntimeState::default()),
        }
    }

    pub async fn existing_access_token(
        &self,
        required_scope: &str,
        force_refresh: bool,
    ) -> Result<String, AnonymousAuthError> {
        self.access_token_inner(required_scope, force_refresh, false)
            .await
    }

    pub async fn combined_state(&self) -> Result<Option<String>, AnonymousAuthError> {
        let mut state = self.state.lock().await;
        self.ensure_existing_loaded(&mut state).await?;
        if state.stored.enroll_key.is_empty() && state.stored.extra.is_empty() {
            return Ok(None);
        }
        encode_credentials(&state.stored).map(Some)
    }

    pub async fn initialized_state(&self) -> Result<String, AnonymousAuthError> {
        let mut state = self.state.lock().await;
        self.ensure_loaded(&mut state).await?;
        encode_credentials(&state.stored)
    }

    pub async fn merge_external_state(&self, value: &str) -> Result<(), AnonymousAuthError> {
        let incoming: Value = serde_json::from_str(value)
            .map_err(|_| AnonymousAuthError::new("CREDENTIALS_INVALID", false))?;
        let mut extra = incoming
            .as_object()
            .cloned()
            .ok_or_else(|| AnonymousAuthError::new("CREDENTIALS_INVALID", false))?;
        for key in [
            "enroll_key",
            "refresh_token",
            "enroll_idempotency_key",
            "refresh_idempotency_key",
            "anonymous_id",
        ] {
            extra.remove(key);
        }

        let mut state = self.state.lock().await;
        self.ensure_existing_loaded(&mut state).await?;
        state.stored.extra = extra;
        self.persist(&state.stored).await
    }

    async fn access_token_inner(
        &self,
        required_scope: &str,
        force_refresh: bool,
        allow_enroll: bool,
    ) -> Result<String, AnonymousAuthError> {
        if !valid_scope(required_scope) {
            return Err(AnonymousAuthError::new("SCOPE_INVALID", false));
        }
        let mut state = self.state.lock().await;
        if allow_enroll {
            self.ensure_loaded(&mut state).await?;
        } else {
            self.ensure_existing_loaded(&mut state).await?;
        }
        if !force_refresh {
            if let Some(token) = state.access_token.as_ref() {
                if token.expires_at
                    > Utc::now() + ChronoDuration::seconds(ACCESS_TOKEN_REFRESH_MARGIN_SECONDS)
                    && token.scopes.iter().any(|scope| scope == required_scope)
                {
                    return Ok(token.value.clone());
                }
            }
        }

        let token = if state.stored.refresh_token.is_some() {
            match self.refresh(&mut state).await {
                Ok(token) => token,
                Err(error) if allow_enroll && refresh_requires_enroll(&error.code) => {
                    clear_identity_bound_state(&mut state.stored);
                    state.access_token = None;
                    self.persist(&state.stored).await?;
                    self.enroll(&mut state).await?
                }
                Err(error) if !allow_enroll && refresh_requires_enroll(&error.code) => {
                    return Err(AnonymousAuthError::new("ANONYMOUS_ACCESS_EXPIRED", false));
                }
                Err(error) => return Err(error),
            }
        } else if allow_enroll {
            self.enroll(&mut state).await?
        } else {
            return Err(AnonymousAuthError::new(
                "ANONYMOUS_ACCESS_UNAVAILABLE",
                false,
            ));
        };

        if !token.scopes.iter().any(|scope| scope == required_scope) {
            return Err(AnonymousAuthError::new("SCOPE_INSUFFICIENT", false));
        }
        let value = token.value.clone();
        state.access_token = Some(token);
        Ok(value)
    }

    async fn ensure_loaded(&self, state: &mut RuntimeState) -> Result<(), AnonymousAuthError> {
        self.ensure_existing_loaded(state).await?;
        if state.stored.enroll_key.is_empty() {
            state.stored.enroll_key = Uuid::new_v4().to_string();
        }
        Ok(())
    }

    async fn ensure_existing_loaded(
        &self,
        state: &mut RuntimeState,
    ) -> Result<(), AnonymousAuthError> {
        if state.loaded {
            return Ok(());
        }
        state.stored = match self
            .credential_store
            .load()
            .await
            .map_err(|_| AnonymousAuthError::new("CREDENTIAL_LOAD_FAILED", true))?
        {
            Some(value) => serde_json::from_str(&value)
                .map_err(|_| AnonymousAuthError::new("CREDENTIALS_INVALID", false))?,
            None => StoredAnonymousCredentials::default(),
        };
        state.loaded = true;
        Ok(())
    }

    async fn enroll(&self, state: &mut RuntimeState) -> Result<AccessToken, AnonymousAuthError> {
        let key = match state.stored.enroll_idempotency_key.clone() {
            Some(key) => key,
            None => {
                let key = Uuid::new_v4().to_string();
                state.stored.enroll_idempotency_key = Some(key.clone());
                self.persist(&state.stored).await?;
                key
            }
        };
        let response = self
            .client
            .post(self.url("/auth/v1/anonymous/enroll")?)
            .header("X-Request-ID", Uuid::new_v4().to_string())
            .header("Idempotency-Key", key)
            .json(&serde_json::json!({ "key": state.stored.enroll_key }))
            .send()
            .await
            .map_err(|_| AnonymousAuthError::new("AUTH_NETWORK_ERROR", true))?;
        let response = decode_token(response, StatusCode::CREATED).await?;
        self.commit_token(state, response, true).await
    }

    async fn refresh(&self, state: &mut RuntimeState) -> Result<AccessToken, AnonymousAuthError> {
        let refresh_token = state
            .stored
            .refresh_token
            .clone()
            .ok_or_else(|| AnonymousAuthError::new("REFRESH_TOKEN_MISSING", false))?;
        let key = match state.stored.refresh_idempotency_key.clone() {
            Some(key) => key,
            None => {
                let key = Uuid::new_v4().to_string();
                state.stored.refresh_idempotency_key = Some(key.clone());
                self.persist(&state.stored).await?;
                key
            }
        };
        let response = self
            .client
            .post(self.url("/auth/v1/anonymous/token")?)
            .header("X-Request-ID", Uuid::new_v4().to_string())
            .header("Idempotency-Key", key)
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await
            .map_err(|_| AnonymousAuthError::new("AUTH_NETWORK_ERROR", true))?;
        let response = decode_token(response, StatusCode::OK).await?;
        self.commit_token(state, response, false).await
    }

    async fn commit_token(
        &self,
        state: &mut RuntimeState,
        response: TokenResponse,
        enrolled: bool,
    ) -> Result<AccessToken, AnonymousAuthError> {
        let token = AccessToken {
            value: response.access_token,
            expires_at: Utc::now() + ChronoDuration::seconds(response.expires_in.max(0)),
            scopes: parse_scopes(&response.scope),
        };
        state.stored.anonymous_id = Some(response.anonymous_id);
        state.stored.refresh_token = Some(response.refresh_token);
        state.stored.refresh_idempotency_key = None;
        if enrolled {
            state.stored.enroll_idempotency_key = None;
        }
        self.persist(&state.stored).await?;
        Ok(token)
    }

    async fn persist(&self, stored: &StoredAnonymousCredentials) -> Result<(), AnonymousAuthError> {
        let encoded = encode_credentials(stored)?;
        self.credential_store
            .store(&encoded)
            .await
            .map_err(|_| AnonymousAuthError::new("CREDENTIAL_SAVE_FAILED", true))
    }

    fn url(&self, path: &str) -> Result<String, AnonymousAuthError> {
        self.base_url
            .as_ref()
            .map(|base| format!("{base}{path}"))
            .ok_or_else(|| AnonymousAuthError::new("AUTH_NOT_CONFIGURED", false))
    }
}

#[async_trait]
impl AnonymousAccessTokenProvider for AnonymousAuthService {
    async fn access_token(
        &self,
        required_scope: &str,
        force_refresh: bool,
    ) -> Result<String, AnonymousAuthError> {
        self.access_token_inner(required_scope, force_refresh, true)
            .await
    }
}

pub fn bitfun_ingress_base_url(debug: bool) -> &'static str {
    if debug {
        DEBUG_INGRESS_BASE_URL
    } else {
        RELEASE_INGRESS_BASE_URL
    }
}

fn encode_credentials(stored: &StoredAnonymousCredentials) -> Result<String, AnonymousAuthError> {
    serde_json::to_string(stored)
        .map_err(|_| AnonymousAuthError::new("CREDENTIAL_ENCODING_FAILED", false))
}

async fn decode_token(
    response: Response,
    expected: StatusCode,
) -> Result<TokenResponse, AnonymousAuthError> {
    if response.status() == expected {
        return response
            .json()
            .await
            .map_err(|_| AnonymousAuthError::new("AUTH_RESPONSE_INVALID", false));
    }
    let status = response.status();
    let retry_after_seconds = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok());
    let body = response.json::<ServerErrorBody>().await.unwrap_or_default();
    Err(AnonymousAuthError {
        code: body
            .error_code
            .unwrap_or_else(|| format!("AUTH_HTTP_{}", status.as_u16())),
        retryable: status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS,
        request_id: body.request_id,
        retry_after_seconds,
    })
}

fn parse_scopes(value: &str) -> Vec<String> {
    value
        .split(|character: char| character == ',' || character.is_whitespace())
        .map(str::trim)
        .filter(|scope| !scope.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn valid_scope(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b':' | b'-' | b'_')
        })
}

fn refresh_requires_enroll(code: &str) -> bool {
    matches!(
        code,
        "TOKEN_INVALID"
            | "TOKEN_EXPIRED"
            | "REFRESH_TOKEN_INVALID"
            | "REFRESH_TOKEN_REUSED"
            | "TOKEN_FAMILY_REVOKED"
    )
}

fn clear_identity_bound_state(credentials: &mut StoredAnonymousCredentials) {
    credentials.refresh_token = None;
    credentials.refresh_idempotency_key = None;
    credentials.anonymous_id = None;
    credentials.extra.clear();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct MemoryStore {
        value: std::sync::Mutex<Option<String>>,
    }

    #[async_trait]
    impl AnonymousCredentialStore for MemoryStore {
        async fn load(&self) -> anyhow::Result<Option<String>> {
            Ok(self.value.lock().unwrap().clone())
        }

        async fn store(&self, value: &str) -> anyhow::Result<()> {
            *self.value.lock().unwrap() = Some(value.to_string());
            Ok(())
        }
    }

    fn spawn_token_server(scope: &'static str) -> (String, Arc<AtomicUsize>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicUsize::new(0));
        let request_count = requests.clone();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 4096];
            let _ = stream.read(&mut buffer).unwrap();
            request_count.fetch_add(1, Ordering::SeqCst);
            let body = format!(
                "{{\"anonymous_id\":\"anon\",\"access_token\":\"access\",\"refresh_token\":\"refresh\",\"expires_in\":3600,\"scope\":\"{scope}\"}}"
            );
            let response = format!(
                "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        (endpoint, requests)
    }

    #[tokio::test]
    async fn concurrent_scope_requests_share_one_enrollment() {
        let (endpoint, requests) = spawn_token_server("otel:write feedback:write");
        let service = Arc::new(AnonymousAuthService::new(
            Some(endpoint),
            Arc::new(MemoryStore::default()),
            Duration::from_secs(2),
        ));
        let first = service.clone();
        let second = service.clone();
        let (left, right) = tokio::join!(
            async move { first.access_token("otel:write", false).await },
            async move { second.access_token("feedback:write", false).await },
        );

        assert_eq!(left.unwrap(), "access");
        assert_eq!(right.unwrap(), "access");
        assert_eq!(requests.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn required_scope_is_checked_without_exposing_the_token() {
        let (endpoint, _) = spawn_token_server("feedback:write");
        let service = AnonymousAuthService::new(
            Some(endpoint),
            Arc::new(MemoryStore::default()),
            Duration::from_secs(2),
        );
        let error = service.access_token("otel:write", false).await.unwrap_err();
        assert_eq!(error.code, "SCOPE_INSUFFICIENT");
        assert!(!error.to_string().contains("access"));
    }

    #[test]
    fn re_enrollment_clears_external_identity_state() {
        let mut credentials = StoredAnonymousCredentials {
            refresh_token: Some("refresh".to_string()),
            refresh_idempotency_key: Some("refresh-idempotency".to_string()),
            anonymous_id: Some("anonymous".to_string()),
            extra: Map::from_iter([(
                "capabilities".to_string(),
                serde_json::json!({"feedback-1": "capability"}),
            )]),
            ..StoredAnonymousCredentials::default()
        };

        clear_identity_bound_state(&mut credentials);

        assert!(credentials.refresh_token.is_none());
        assert!(credentials.refresh_idempotency_key.is_none());
        assert!(credentials.anonymous_id.is_none());
        assert!(credentials.extra.is_empty());
    }
}
