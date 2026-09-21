use crate::TelemetryRuntimeError;
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

pub type OtlpHeaders = HashMap<String, String>;

pub trait TelemetrySecretProvider: Send + Sync + 'static {
    fn resolve_headers(&self, secret_ref: &str) -> Result<OtlpHeaders, TelemetryRuntimeError>;
}

#[derive(Debug, Default)]
pub struct NoTelemetrySecrets;

impl TelemetrySecretProvider for NoTelemetrySecrets {
    fn resolve_headers(&self, _secret_ref: &str) -> Result<OtlpHeaders, TelemetryRuntimeError> {
        Err(TelemetryRuntimeError::Secret(
            "no telemetry credential provider is installed",
        ))
    }
}

/// Native Desktop/CLI secret provider. Values are JSON header objects stored
/// under the `BitFun Telemetry` service. Secret contents are never formatted or
/// included in diagnostics.
#[derive(Debug, Default)]
pub struct SystemKeyringTelemetrySecrets;

impl TelemetrySecretProvider for SystemKeyringTelemetrySecrets {
    fn resolve_headers(&self, secret_ref: &str) -> Result<OtlpHeaders, TelemetryRuntimeError> {
        #[cfg(target_env = "ohos")]
        {
            let _ = secret_ref;
            return Err(TelemetryRuntimeError::Secret(
                "system credential store is unsupported on OpenHarmony",
            ));
        }
        #[cfg(not(target_env = "ohos"))]
        {
            let entry_name = secret_ref
                .strip_prefix("keyring:")
                .filter(|value| valid_reference_component(value))
                .ok_or(TelemetryRuntimeError::Secret(
                    "keyring references must use keyring:ENTRY",
                ))?;
            let entry = open_native_keyring_entry(entry_name)?;
            let bytes = entry
                .get_secret()
                .map_err(|_| TelemetryRuntimeError::Secret("keyring entry is unavailable"))?;
            parse_headers(&bytes)
        }
    }
}

/// Server/Relay provider restricted to one deployment-owned directory. The
/// referenced file is read-only from this component and capped at 16 KiB.
#[derive(Debug, Clone)]
pub struct ReadOnlySecretFileProvider {
    root: PathBuf,
}

impl ReadOnlySecretFileProvider {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }
}

impl TelemetrySecretProvider for ReadOnlySecretFileProvider {
    fn resolve_headers(&self, secret_ref: &str) -> Result<OtlpHeaders, TelemetryRuntimeError> {
        let name = secret_ref
            .strip_prefix("file:")
            .filter(|value| valid_reference_component(value) && !value.contains('/'))
            .ok_or(TelemetryRuntimeError::Secret(
                "secret file references must use file:BASENAME",
            ))?;
        let path = self.root.join(name);
        let canonical_root = self
            .root
            .canonicalize()
            .map_err(|_| TelemetryRuntimeError::Secret("secret directory is unavailable"))?;
        let canonical_path = path
            .canonicalize()
            .map_err(|_| TelemetryRuntimeError::Secret("secret file is unavailable"))?;
        if !canonical_path.starts_with(&canonical_root) || !is_regular_file(&canonical_path) {
            return Err(TelemetryRuntimeError::Secret("secret file is invalid"));
        }
        let mut bytes = Vec::new();
        std::fs::File::open(canonical_path)
            .and_then(|file| file.take(16 * 1024 + 1).read_to_end(&mut bytes))
            .map_err(|_| TelemetryRuntimeError::Secret("secret file could not be read"))?;
        if bytes.len() > 16 * 1024 {
            return Err(TelemetryRuntimeError::Secret("secret file is too large"));
        }
        parse_headers(&bytes)
    }
}

fn is_regular_file(path: &Path) -> bool {
    path.metadata()
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

fn parse_headers(bytes: &[u8]) -> Result<OtlpHeaders, TelemetryRuntimeError> {
    let parsed: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| TelemetryRuntimeError::Secret("secret must be a JSON object"))?;
    let object = parsed.as_object().ok_or(TelemetryRuntimeError::Secret(
        "secret must be a JSON object",
    ))?;
    object
        .iter()
        .map(|(name, value)| {
            let value = value.as_str().ok_or(TelemetryRuntimeError::Secret(
                "secret header values must be strings",
            ))?;
            Ok((name.clone(), value.to_string()))
        })
        .collect()
}

fn valid_reference_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

#[cfg(any(
    target_os = "macos",
    target_os = "windows",
    all(
        unix,
        not(target_env = "ohos"),
        not(any(target_os = "macos", target_os = "ios", target_os = "android"))
    )
))]
fn open_native_keyring_entry(
    entry_name: &str,
) -> Result<keyring_core::Entry, TelemetryRuntimeError> {
    if keyring_core::get_default_store().is_none() {
        #[cfg(target_os = "macos")]
        let store = apple_native_keyring_store::keychain::Store::new();
        #[cfg(target_os = "windows")]
        let store = windows_native_keyring_store::Store::new();
        #[cfg(all(
            unix,
            not(target_env = "ohos"),
            not(any(target_os = "macos", target_os = "ios", target_os = "android"))
        ))]
        let store = zbus_secret_service_keyring_store::Store::new();
        let store = store
            .map_err(|_| TelemetryRuntimeError::Secret("system credential store is unavailable"))?;
        keyring_core::set_default_store(store);
    }
    keyring_core::Entry::new("BitFun Telemetry", entry_name)
        .map_err(|_| TelemetryRuntimeError::Secret("keyring entry could not be opened"))
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "windows",
    all(
        unix,
        not(target_env = "ohos"),
        not(any(target_os = "macos", target_os = "ios", target_os = "android"))
    )
)))]
fn open_native_keyring_entry(_entry_name: &str) -> Result<(), TelemetryRuntimeError> {
    Err(TelemetryRuntimeError::Secret(
        "system credential store is unsupported on this platform",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_references_reject_paths_and_control_characters() {
        assert!(valid_reference_component("collector-production"));
        assert!(!valid_reference_component("../collector"));
        assert!(!valid_reference_component("collector/token"));
    }
}
