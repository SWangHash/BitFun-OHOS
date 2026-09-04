use async_trait::async_trait;
use bitfun_services_core::secure_credentials::SecureCredentialVault;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

const MARKET_ALIAS: &str = "bitfun.market.credentials.v1";
const KEYRING_SERVICE: &str = "openbitfun.bitfun.miniapp-market.v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMarketCredentials {
    pub access_token: String,
    pub access_expires_at: i64,
    pub refresh_token: String,
    pub refresh_expires_at: i64,
}

#[async_trait]
pub trait MarketCredentialStore: std::fmt::Debug + Send + Sync {
    async fn load(&self) -> Result<Option<StoredMarketCredentials>, String>;
    async fn save(&self, credentials: &StoredMarketCredentials) -> Result<(), String>;
    async fn clear(&self) -> Result<(), String>;
}

/// Default `MarketCredentialStore` backed by a `SecureCredentialVault`.
///
/// The same `SecureCredentialVault` instance can be shared by the MiniApp
/// and appearance market (both use the GitHub OAuth flow), subscription
/// auth, and feedback services — alias formats are consumer-specific and
/// do not collide inside the shared vault namespace. The market alias
/// `bitfun.market.credentials.v1` matches the pre-unification layout so
/// existing on-disk and keychain entries continue to read back without a
/// migration step.
#[derive(Debug)]
pub struct SystemMarketCredentialStore {
    vault: Arc<dyn SecureCredentialVault>,
}

impl SystemMarketCredentialStore {
    /// Construct a market credential store backed by `vault`. The desktop
    /// host on OHOS passes the shared ArkTS-backed vault here; on macOS,
    /// Windows, and Linux the default constructor wires a system keyring
    /// vault.
    pub fn with_vault(vault: Arc<dyn SecureCredentialVault>) -> Self {
        Self { vault }
    }
}

#[async_trait]
impl MarketCredentialStore for SystemMarketCredentialStore {
    async fn load(&self) -> Result<Option<StoredMarketCredentials>, String> {
        let Some(bytes) = self.vault.get_secret(MARKET_ALIAS).await? else {
            return Ok(None);
        };
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| format!("parse market credentials: {error}"))
    }
    async fn save(&self, credentials: &StoredMarketCredentials) -> Result<(), String> {
        let bytes = serde_json::to_vec(credentials)
            .map_err(|error| format!("serialize market credentials: {error}"))?;
        self.vault.set_secret(MARKET_ALIAS, &bytes).await
    }

    async fn clear(&self) -> Result<(), String> {
        self.vault.delete_secret(MARKET_ALIAS).await
    }
}

/// Returns the default market credential store backed by the system
/// keyring vault. Used when no `SecureCredentialVault` is injected; the
/// desktop host on OHOS injects an ArkTS-backed vault instead and calls
/// `SystemMarketCredentialStore::with_vault` directly.
pub fn system_market_credential_store() -> Arc<dyn MarketCredentialStore> {
    static DEFAULT: OnceLock<Arc<dyn MarketCredentialStore>> = OnceLock::new();
    DEFAULT
        .get_or_init(|| {
            Arc::new(SystemMarketCredentialStore::with_vault(default_vault()))
                as Arc<dyn MarketCredentialStore>
        })
        .clone()
}

/// Constructs the default `SecureCredentialVault` for the market service
/// namespace. On macOS, Windows, and Linux this is the system keyring
/// vault; on OHOS this returns an unavailable vault (the desktop host is
/// expected to inject an ArkTS-backed vault via
/// `SystemMarketCredentialStore::with_vault` before the market client is
/// constructed).
fn default_vault() -> Arc<dyn SecureCredentialVault> {
    #[cfg(feature = "system-vault")]
    {
        use bitfun_services_core::secure_credentials::SystemSecureCredentialVault;
        return Arc::new(SystemSecureCredentialVault::new(KEYRING_SERVICE));
    }
    #[cfg(not(feature = "system-vault"))]
    {
        return Arc::new(UnavailableVault);
    }
}

/// Fallback vault for targets without the system keyring backend. The
/// desktop host must inject a real vault via
/// `SystemMarketCredentialStore::with_vault`; if it does not, every
/// operation surfaces an explicit unavailable error rather than silently
/// returning empty data.
#[cfg(not(feature = "system-vault"))]
#[derive(Debug)]
struct UnavailableVault;

#[cfg(not(feature = "system-vault"))]
#[async_trait]
impl SecureCredentialVault for UnavailableVault {
    async fn get_secret(&self, _alias: &str) -> Result<Option<Vec<u8>>, String> {
        Err(
            "market credential vault unavailable: no system backend and no vault injected"
                .to_string(),
        )
    }
    async fn set_secret(&self, _alias: &str, _secret: &[u8]) -> Result<(), String> {
        Err(
            "market credential vault unavailable: no system backend and no vault injected"
                .to_string(),
        )
    }
    async fn delete_secret(&self, _alias: &str) -> Result<(), String> {
        Err(
            "market credential vault unavailable: no system backend and no vault injected"
                .to_string(),
        )
    }
}
