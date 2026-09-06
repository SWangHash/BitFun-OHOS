#![cfg(target_env = "ohos")]

//! OHOS `SecureCredentialVault` backed by the HarmonyOS `AssetStoreKit`
//! through an ArkTS bridge.
//!
//! This module is the OHOS counterpart of
//! `openbitfun_services_core::secure_credentials::SystemSecureCredentialVault`.
//! The Rust side serializes each call as JSON and delegates to the ArkTS
//! `secure_credentials` function registered in `EntryAbility.ets`. The
//! ArkTS side owns the AssetStoreKit alias/secret lifecycle, the upsert
//! fallback, and the error-code mapping.
//!
//! Subscription auth, MiniApp/appearance market, and feedback services
//! all share this one vault; alias formats are consumer-specific so they
//! do not collide inside the single AssetStoreKit namespace.

use async_trait::async_trait;
use openbitfun_services_core::secure_credentials::SecureCredentialVault;
use serde::{Deserialize, Serialize};

const ARKTS_FUNCTION: &str = "secure_credentials";

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum CredentialAction {
    Load,
    Store,
    Delete,
}

#[derive(Debug, Serialize)]
struct CredentialRequest<'a> {
    action: CredentialAction,
    alias: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
struct CredentialResponse {
    status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

/// `SecureCredentialVault` backed by the OHOS `AssetStoreKit` through an
/// ArkTS bridge registered as `secure_credentials`.
///
/// The store is stateless on the Rust side; every call serializes the
/// request as JSON and awaits the ArkTS-side response. The bridge returns
/// the raw secret bytes base64-encoded because the JSON wire envelope is
/// UTF-8 only and secret material is binary (OHOS keyring payloads, OAuth
/// refresh tokens with arbitrary UTF-8 boundaries, future binary formats).
#[derive(Debug)]
pub struct OhosSecureCredentialVault;

impl OhosSecureCredentialVault {
    pub fn new() -> Self {
        Self
    }

    async fn call(&self, request: CredentialRequest<'_>) -> Result<CredentialResponse, String> {
        let input = serde_json::to_string(&request)
            .map_err(|error| format!("encode secure credential request: {error}"))?;
        let output = openbitfun_core::util::call_arkts_string_function(ARKTS_FUNCTION, input)
            .await
            .map_err(|error| format!("call OpenHarmony secure credential store: {error}"))?;
        serde_json::from_str(&output)
            .map_err(|error| format!("decode secure credential response: {error}"))
    }
}

impl Default for OhosSecureCredentialVault {
    fn default() -> Self {
        Self::new()
    }
}

fn encode_secret(secret: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(secret)
}

fn decode_secret(value: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|error| format!("decode base64 secret from ArkTS response: {error}"))
}

#[async_trait]
impl SecureCredentialVault for OhosSecureCredentialVault {
    async fn get_secret(&self, alias: &str) -> Result<Option<Vec<u8>>, String> {
        let response = self
            .call(CredentialRequest {
                action: CredentialAction::Load,
                alias,
                value: None,
            })
            .await?;
        match response.status.as_str() {
            "ok" => response
                .value
                .ok_or_else(|| "secure credential response omitted its value".to_string())
                .and_then(|value| decode_secret(&value).map(Some)),
            "not_found" => Ok(None),
            _ => Err(format!(
                "OpenHarmony secure credential load failed: code={}",
                response.code.as_deref().unwrap_or("UNKNOWN")
            )),
        }
    }

    async fn set_secret(&self, alias: &str, secret: &[u8]) -> Result<(), String> {
        let value = encode_secret(secret);
        let response = self
            .call(CredentialRequest {
                action: CredentialAction::Store,
                alias,
                value: Some(&value),
            })
            .await?;
        if response.status == "ok" {
            Ok(())
        } else {
            Err(format!(
                "OpenHarmony secure credential store failed: code={}",
                response.code.as_deref().unwrap_or("UNKNOWN")
            ))
        }
    }

    async fn delete_secret(&self, alias: &str) -> Result<(), String> {
        let response = self
            .call(CredentialRequest {
                action: CredentialAction::Delete,
                alias,
                value: None,
            })
            .await?;
        if matches!(response.status.as_str(), "ok" | "not_found") {
            Ok(())
        } else {
            Err(format!(
                "OpenHarmony secure credential delete failed: code={}",
                response.code.as_deref().unwrap_or("UNKNOWN")
            ))
        }
    }

    /// OHOS is a fresh platform for OpenBitFun; there is no pre-existing v1
    /// password entry to migrate, so the legacy text read always returns
    /// `Ok(None)`. The store.rs migration code already treats `None` as
    /// "no v1 entry, proceed with v2" — no data is lost and no migration
    /// is attempted.
    async fn get_legacy_secret_text(&self, _alias: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
}
