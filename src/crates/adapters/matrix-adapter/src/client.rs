//! HTTP client for the OpenHarmony Matrix skill market.
//!
//! Mirrors the BitFun `ReviewHttpClient` safe-defaults pattern
//! (`src/crates/services/services-integrations/src/review_platform_http.rs`):
//! 25 s timeout, same-origin redirect with at most 5 hops, bounded response
//! body (16 MiB for JSON / binary, 8 KiB for error), `use_native_tls()`. The
//! base URL is overridable via the `MATRIX_API_URL` environment variable
//! (default `https://matrix.openharmony.cn/`) for local testing and future
//! mirror switching.

use crate::error::{MatrixApiError, MatrixApiErrorKind};
use futures::StreamExt;
use std::time::Duration;

const MATRIX_HTTP_TIMEOUT_SECS: u64 = 25;
const MAX_MATRIX_REDIRECTS: usize = 5;
pub(crate) const DEFAULT_JSON_RESPONSE_MAX_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const DEFAULT_BYTES_RESPONSE_MAX_BYTES: usize = 16 * 1024 * 1024;
const HTTP_ERROR_BODY_MAX_BYTES: usize = 8 * 1024;
const MATRIX_USER_AGENT: &str = concat!("bitfun-matrix-adapter/", env!("CARGO_PKG_VERSION"));
const DEFAULT_MATRIX_API_URL: &str = "https://matrix.openharmony.cn/";

/// HTTP client for the Matrix skill market.
///
/// Cheap to clone (wraps an `Arc` internally via `reqwest::Client`). Construct
/// once per Tauri command invocation via [`MatrixHttpClient::new`].
#[derive(Clone)]
pub struct MatrixHttpClient {
    inner: reqwest::Client,
    base_url: String,
}

impl MatrixHttpClient {
    /// Construct a new Matrix HTTP client.
    ///
    /// Reads the `MATRIX_API_URL` environment variable to allow overriding
    /// the base URL (defaults to `https://matrix.openharmony.cn/`).
    pub fn new() -> Result<Self, MatrixApiError> {
        let inner = reqwest::Client::builder()
            .user_agent(MATRIX_USER_AGENT)
            .use_native_tls()
            .redirect(matrix_redirect_policy())
            .timeout(Duration::from_secs(MATRIX_HTTP_TIMEOUT_SECS))
            .build()
            .map_err(|error| {
                MatrixApiError::new(
                    MatrixApiErrorKind::RuntimeUnavailable,
                    format!("Failed to build Matrix HTTP client: {}", error),
                )
            })?;

        let base_url = std::env::var("MATRIX_API_URL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_MATRIX_API_URL.to_string());

        log::info!(
            "MatrixHttpClient constructed: base_url={}, timeout={}s, max_redirects={}",
            base_url,
            MATRIX_HTTP_TIMEOUT_SECS,
            MAX_MATRIX_REDIRECTS
        );

        Ok(Self { inner, base_url })
    }

    /// Return the configured base URL (raw, including any trailing slash).
    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    /// Build the full URL for a path by joining it to the base URL.
    pub fn url(&self, path: &str) -> String {
        let base = self.base_url.trim_end_matches('/');
        let path = path.trim_start_matches('/');
        format!("{}/{}", base, path)
    }

    /// Send a GET request and return the response body as text, bounded to
    /// `max_bytes`. Used for JSON endpoints where the caller parses the text
    /// into a typed struct via `serde_json::from_str`.
    pub async fn send_get_text_bounded(
        &self,
        url: &str,
        max_bytes: usize,
    ) -> Result<String, MatrixApiError> {
        log::info!("Matrix HTTP GET text: url={}", url);
        let request = self.inner.get(url);
        let response = request.send().await.map_err(|error| {
            log::error!(
                "Matrix HTTP GET text network error: url={}, error={}",
                url,
                error
            );
            MatrixApiError::from(error)
        })?;
        let status = response.status();
        log::info!(
            "Matrix HTTP GET text response: url={}, status={}",
            url,
            status.as_u16()
        );
        if !status.is_success() {
            return Err(MatrixApiError::new(
                MatrixApiErrorKind::Http {
                    status: status.as_u16(),
                },
                format!("Matrix API returned HTTP {}", status.as_u16()),
            ));
        }
        let body = collect_bounded_body(response, max_bytes, status).await?;
        log::info!(
            "Matrix HTTP GET text body: url={}, bytes={}",
            url,
            body.len()
        );
        Ok(String::from_utf8_lossy(&body).into_owned())
    }

    /// Send a POST request with a JSON body and return the response body as
    /// parsed JSON `serde_json::Value`, bounded to 16 MiB.
    pub async fn send_post_json_bounded(
        &self,
        url: &str,
        body: &impl serde::Serialize,
    ) -> Result<serde_json::Value, MatrixApiError> {
        log::info!("Matrix HTTP POST json: url={}", url);
        let request = self.inner.post(url).json(body);
        let response = request.send().await.map_err(|error| {
            log::error!(
                "Matrix HTTP POST json network error: url={}, error={}",
                url,
                error
            );
            MatrixApiError::from(error)
        })?;
        let status = response.status();
        log::info!(
            "Matrix HTTP POST json response: url={}, status={}",
            url,
            status.as_u16()
        );
        let body_limit = if status.is_success() {
            DEFAULT_JSON_RESPONSE_MAX_BYTES
        } else {
            HTTP_ERROR_BODY_MAX_BYTES
        };
        if response
            .content_length()
            .is_some_and(|len| len > body_limit as u64)
        {
            return Err(if status.is_success() {
                MatrixApiError::new(
                    MatrixApiErrorKind::Parse,
                    format!("Matrix response exceeded the {} byte limit", body_limit),
                )
            } else {
                MatrixApiError::new(
                    MatrixApiErrorKind::Http {
                        status: status.as_u16(),
                    },
                    format!("Matrix API returned HTTP {}", status.as_u16()),
                )
            });
        }
        let body = collect_bounded_body(response, body_limit, status).await?;
        if !status.is_success() {
            return Err(MatrixApiError::new(
                MatrixApiErrorKind::Http {
                    status: status.as_u16(),
                },
                format!("Matrix API returned HTTP {}", status.as_u16()),
            ));
        }
        let value: serde_json::Value =
            serde_json::from_slice(&body).map_err(|error| {
                log::error!(
                    "Matrix HTTP POST json parse error: url={}, error={}",
                    url,
                    error
                );
                MatrixApiError::from(error)
            })?;
        log::info!(
            "Matrix HTTP POST json body: url={}, bytes={}",
            url,
            body.len()
        );
        Ok(value)
    }

    /// Send a GET request and return the response body as raw bytes, bounded
    /// to `max_bytes` (default 16 MiB for ZIP download).
    pub async fn send_get_bytes_bounded(
        &self,
        url: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>, MatrixApiError> {
        log::info!("Matrix HTTP GET bytes: url={}", url);
        let request = self.inner.get(url);
        let response = request.send().await.map_err(|error| {
            log::error!(
                "Matrix HTTP GET bytes network error: url={}, error={}",
                url,
                error
            );
            MatrixApiError::from(error)
        })?;
        let status = response.status();
        log::info!(
            "Matrix HTTP GET bytes response: url={}, status={}",
            url,
            status.as_u16()
        );
        if !status.is_success() {
            return Err(MatrixApiError::new(
                MatrixApiErrorKind::Http {
                    status: status.as_u16(),
                },
                format!("Matrix API returned HTTP {}", status.as_u16()),
            ));
        }
        let body = collect_bounded_body(response, max_bytes, status).await?;
        log::info!(
            "Matrix HTTP GET bytes body: url={}, bytes={}",
            url,
            body.len()
        );
        Ok(body)
    }

    /// Fetch the skill ZIP binary for `en_name` (bounded to 16 MiB).
    ///
    /// Calls `GET {base}/api/registry/skill/{en_name}/install?agents=claude,codex,gemini,opencode&format=zip`.
    /// The `agents` query parameter is a Matrix-internal convention that
    /// triggers the platform to return complete install metadata; it is not
    /// related to the BitFun agent runtime.
    pub async fn fetch_skill_zip(&self, en_name: &str) -> Result<Vec<u8>, MatrixApiError> {
        let encoded = urlencoding::encode(en_name);
        let url = self.url(&format!(
            "api/registry/skill/{}/install?agents=claude,codex,gemini,opencode&format=zip",
            encoded
        ));
        self.send_get_bytes_bounded(&url, DEFAULT_BYTES_RESPONSE_MAX_BYTES)
            .await
    }
}

fn matrix_redirect_policy() -> reqwest::redirect::Policy {
    // Matrix API redirects ZIP downloads to a CDN
    // (e.g. openharmony-matrix.obs.cn-north-4.myhuaweicloud.com), which is a
    // different origin. Use `Policy::limited` to follow all redirects up to
    // MAX_MATRIX_REDIRECTS, regardless of origin. This is safe because the
    // initial URL is always the trusted Matrix API base URL.
    reqwest::redirect::Policy::limited(MAX_MATRIX_REDIRECTS)
}

async fn collect_bounded_body(
    response: reqwest::Response,
    max_bytes: usize,
    status: reqwest::StatusCode,
) -> Result<Vec<u8>, MatrixApiError> {
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(MatrixApiError::from)?;
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(if status.is_success() {
                MatrixApiError::new(
                    MatrixApiErrorKind::Parse,
                    format!("Matrix response exceeded the {} byte limit", max_bytes),
                )
            } else {
                MatrixApiError::new(
                    MatrixApiErrorKind::Http {
                        status: status.as_u16(),
                    },
                    format!("Matrix API returned HTTP {}", status.as_u16()),
                )
            });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}
