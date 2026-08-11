//! Typed error type for Matrix API operations.
//!
//! All public functions in this crate return [`MatrixApiError`] so Tauri
//! commands can surface a stable, categorized error object to the frontend
//! (see `spec/matrix-skill-market/spec.md` FR-010). The error implements
//! `serde::Serialize` (derive on both the struct and the kind enum) so it can
//! be returned directly from `#[tauri::command]` functions.

use serde::Serialize;
use std::fmt;
use std::io;
use thiserror::Error;

/// Categorized kind of Matrix API failure.
///
/// Serialized with `#[serde(rename_all = "kebab-case")]` so the frontend can
/// branch on the `kind` string (e.g. `"network"`, `"http"`, `"integrity"`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum MatrixApiErrorKind {
    /// Network-layer failure (DNS, connect, TLS, timeout). Retryable.
    Network,
    /// Non-2xx HTTP response.
    Http { status: u16 },
    /// HTTP 200 but Matrix business code != `"20000"`.
    MatrixBusiness { code: String },
    /// JSON deserialization failed.
    Parse,
    /// Required runtime dependency is unavailable (e.g. zip feature disabled).
    RuntimeUnavailable,
    /// ZIP path traversal or symlink entry was rejected.
    Security,
    /// SHA-256 checksum mismatch between downloaded bytes and checksum endpoint.
    Integrity { expected: String, actual: String },
    /// Filesystem IO failure during install.
    Io,
}

impl fmt::Display for MatrixApiErrorKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MatrixApiErrorKind::Network => f.write_str("network"),
            MatrixApiErrorKind::Http { status } => write!(f, "http-{}", status),
            MatrixApiErrorKind::MatrixBusiness { code } => {
                write!(f, "matrix-business-{}", code)
            }
            MatrixApiErrorKind::Parse => f.write_str("parse"),
            MatrixApiErrorKind::RuntimeUnavailable => f.write_str("runtime-unavailable"),
            MatrixApiErrorKind::Security => f.write_str("security"),
            MatrixApiErrorKind::Integrity { expected, actual } => {
                write!(f, "integrity (expected={}, actual={})", expected, actual)
            }
            MatrixApiErrorKind::Io => f.write_str("io"),
        }
    }
}

/// Typed error returned by all Matrix API operations.
///
/// Implements `thiserror::Error` (for ergonomic `?` propagation) and
/// `serde::Serialize` (so Tauri commands can return it directly to the
/// frontend).
#[derive(Debug, Error, Serialize)]
#[error("matrix api error: {kind} - {message}")]
pub struct MatrixApiError {
    /// Categorized kind of failure.
    pub kind: MatrixApiErrorKind,
    /// Human-readable message describing the failure.
    pub message: String,
    /// Matrix business code, populated only when `kind == MatrixBusiness`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matrix_code: Option<String>,
}

impl MatrixApiError {
    /// Construct a new error with the given kind and message.
    pub fn new(kind: MatrixApiErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            matrix_code: None,
        }
    }

    /// Construct a `MatrixBusiness` error carrying the upstream code.
    pub fn business(code: impl Into<String>, message: impl Into<String>) -> Self {
        let code = code.into();
        Self {
            kind: MatrixApiErrorKind::MatrixBusiness { code: code.clone() },
            message: message.into(),
            matrix_code: Some(code),
        }
    }

    /// Construct a `Parse` error from any displayable error.
    pub fn parse(error: impl fmt::Display) -> Self {
        Self::new(MatrixApiErrorKind::Parse, error.to_string())
    }

    /// Construct a `Security` error.
    pub fn security(message: impl Into<String>) -> Self {
        Self::new(MatrixApiErrorKind::Security, message)
    }
}

impl From<reqwest::Error> for MatrixApiError {
    fn from(error: reqwest::Error) -> Self {
        Self::new(MatrixApiErrorKind::Network, error.to_string())
    }
}

impl From<io::Error> for MatrixApiError {
    fn from(error: io::Error) -> Self {
        Self::new(MatrixApiErrorKind::Io, error.to_string())
    }
}

impl From<serde_json::Error> for MatrixApiError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(MatrixApiErrorKind::Parse, error.to_string())
    }
}
