//! Default `SecureCredentialVault` backed by the operating-system credential
//! store (macOS Keychain, Windows Credential Manager, or Linux Secret
//! Service via `keyring-core`).
//!
//! This module is gated to non-OHOS targets. The OHOS target has no D-Bus
//! Secret Service provider and pulls in `zbus` if compiled here; the
//! desktop host injects an ArkTS-backed vault at startup instead.

use crate::secure_credentials::SecureCredentialVault;
use async_trait::async_trait;
use std::sync::{Mutex, OnceLock};

/// Serializes all `keyring-core` calls within the process. `keyring-core`
/// keeps a process-wide default store that is mutated by
/// `set_default_store`; concurrent first-time callers would otherwise race
/// on initialization across OHOS and native targets.
fn keyring_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Lazily initializes the platform-default keyring store and opens an
/// `Entry` for `alias` under `service`.
///
/// The cfg ladder mirrors the platform branches used by every previous
/// OpenBitFun keyring call site, with the explicit `target_env = "ohos"`
/// exclusion so this module never selects the Linux Secret Service on
/// HarmonyOS — there is no D-Bus session there, and the desktop host
/// injects an ArkTS-backed vault instead.
fn open_entry(service: &str, alias: &str) -> Result<keyring_core::Entry, String> {
    if keyring_core::get_default_store().is_none() {
        #[cfg(target_os = "macos")]
        let store = apple_native_keyring_store::keychain::Store::new();
        #[cfg(target_os = "windows")]
        let store = windows_native_keyring_store::Store::new();
        #[cfg(all(
            unix,
            not(any(
                target_os = "macos",
                target_os = "ios",
                target_os = "android",
                target_env = "ohos"
            ))
        ))]
        let store = zbus_secret_service_keyring_store::Store::new();
        #[cfg(not(any(
            target_os = "macos",
            target_os = "windows",
            all(
                unix,
                not(any(
                    target_os = "macos",
                    target_os = "ios",
                    target_os = "android",
                    target_env = "ohos"
                ))
            )
        )))]
        let store: keyring_core::Result<std::sync::Arc<keyring_core::CredentialStore>> =
            Err(keyring_core::Error::NoDefaultStore);

        // Unlike the keyring v1 facade, failed initialization leaves no
        // sticky once flag. A later UI retry can reconnect to the platform
        // vault.
        let store = store.map_err(|error| format!("initialize system credential store: {error}"))?;
        keyring_core::set_default_store(store);
    }
    keyring_core::Entry::new(service, alias)
        .map_err(|error| format!("open system credential entry: {error}"))
}

/// Default `SecureCredentialVault` backed by the OS credential store.
///
/// The `service` argument is the keyring namespace. Each consumer
/// (subscription auth, MiniApp/appearance market, feedback) preserves its
/// pre-unification service name so existing on-disk and keychain entries
/// continue to read back without a migration step. New code does not need
/// to know about service names — the consumer constructs its vault once
/// and injects it.
#[derive(Debug)]
pub struct SystemSecureCredentialVault {
    service: &'static str,
}

impl SystemSecureCredentialVault {
    pub fn new(service: &'static str) -> Self {
        Self { service }
    }
}

#[async_trait]
impl SecureCredentialVault for SystemSecureCredentialVault {
    async fn get_secret(&self, alias: &str) -> Result<Option<Vec<u8>>, String> {
        let service = self.service;
        let alias = alias.to_string();
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "credential vault lock poisoned".to_string())?;
            let entry = open_entry(service, &alias)?;
            match entry.get_secret() {
                Ok(secret) => Ok(Some(secret)),
                Err(keyring_core::Error::NoEntry) => Ok(None),
                Err(err) => Err(format!("read system credential entry: {err}")),
            }
        })
        .await
        .map_err(|error| format!("join system credential read task: {error}"))?
    }

    async fn set_secret(&self, alias: &str, secret: &[u8]) -> Result<(), String> {
        let service = self.service;
        let alias = alias.to_string();
        let secret = secret.to_vec();
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "credential vault lock poisoned".to_string())?;
            let entry = open_entry(service, &alias)?;
            entry
                .set_secret(&secret)
                .map_err(|err| format!("write system credential entry: {err}"))
        })
        .await
        .map_err(|error| format!("join system credential write task: {error}"))?
    }

    async fn delete_secret(&self, alias: &str) -> Result<(), String> {
        let service = self.service;
        let alias = alias.to_string();
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "credential vault lock poisoned".to_string())?;
            let entry = open_entry(service, &alias)?;
            match entry.delete_credential() {
                Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
                Err(err) => Err(format!("delete system credential entry: {err}")),
            }
        })
        .await
        .map_err(|error| format!("join system credential delete task: {error}"))?
    }

    /// Reads a legacy text-encoded secret entry. On Windows, the keyring
    /// password API stores values as UTF-16 with a null terminator; reading
    /// them via `get_secret` would yield garbled bytes. Other platforms
    /// store passwords as plain UTF-8 bytes, so `get_password` returns the
    /// same string `get_secret` would have produced — but going through
    /// the password API keeps the Windows path correct.
    async fn get_legacy_secret_text(&self, alias: &str) -> Result<Option<String>, String> {
        let service = self.service;
        let alias = alias.to_string();
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "credential vault lock poisoned".to_string())?;
            let entry = open_entry(service, &alias)?;
            match entry.get_password() {
                Ok(secret) => Ok(Some(secret)),
                Err(keyring_core::Error::NoEntry) => Ok(None),
                Err(err) => Err(format!("read legacy system credential entry: {err}")),
            }
        })
        .await
        .map_err(|error| format!("join legacy credential read task: {error}"))?
    }
}

