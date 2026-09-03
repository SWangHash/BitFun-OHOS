use async_trait::async_trait;
use bitfun_services_core::secure_credentials::SecureCredentialVault;
use serde::{Deserialize, Serialize};
#[cfg(not(target_os = "macos"))]
use std::sync::{Mutex, OnceLock};

#[cfg(not(target_os = "macos"))]
const KEYRING_SERVICE: &str = "openbitfun.bitfun.miniapp-market.v1";
const CREDENTIAL_ENTRY: &str = "github-oauth";
const MARKET_ALIAS: &str = "bitfun.market.credentials.v1";

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


#[cfg(not(target_os = "macos"))]
fn keyring_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(not(target_os = "macos"))]
fn open_entry() -> Result<keyring_core::Entry, String> {
    if keyring_core::get_default_store().is_none() {
        #[cfg(target_os = "windows")]
        let store = windows_native_keyring_store::Store::new();
        #[cfg(all(
            unix,
            not(any(target_os = "macos", target_os = "ios", target_os = "android"))
        ))]
        let store = zbus_secret_service_keyring_store::Store::new();
        #[cfg(not(any(
            target_os = "windows",
            all(
                unix,
                not(any(target_os = "macos", target_os = "ios", target_os = "android"))
            )
        )))]
        let store: keyring_core::Result<std::sync::Arc<keyring_core::CredentialStore>> =
            Err(keyring_core::Error::NoDefaultStore);

impl SystemMarketCredentialStore {
    /// Construct a market credential store backed by `vault`. The desktop
    /// host on OHOS passes the shared ArkTS-backed vault here; on macOS,
    /// Windows, and Linux the default constructor wires a system keyring
    /// vault.
    pub fn with_vault(vault: Arc<dyn SecureCredentialVault>) -> Self {
        Self { vault }
    }
    keyring_core::Entry::new(KEYRING_SERVICE, CREDENTIAL_ENTRY)
        .map_err(|error| format!("open market credential entry: {error}"))
}

#[cfg(target_os = "macos")]
fn macos_credential_vault(
) -> Result<bitfun_services_core::credential_vault::CredentialVault, String> {
    let base = dirs::config_dir()
        .ok_or_else(|| "system config directory unavailable".to_string())?
        .join("bitfun")
        .join("data");
    Ok(
        bitfun_services_core::credential_vault::CredentialVault::new(
            base.join(".market_credentials_vault.key"),
            base.join("market_credentials_vault.json"),
        ),
    )
}

pub async fn load_market_credentials() -> Result<Option<StoredMarketCredentials>, String> {
    #[cfg(target_os = "macos")]
    {
        let Some(secret) = macos_credential_vault()?
            .get(CREDENTIAL_ENTRY)
            .await
            .map_err(|error| format!("read market credentials: {error:#}"))?
        else {
            return Ok(None);
        };
        return serde_json::from_slice(&secret)
            .map(Some)
            .map_err(|error| format!("parse market credentials: {error}"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "market credential lock poisoned".to_string())?;
            let entry = open_entry()?;
            let secret = match entry.get_secret() {
                Ok(secret) => secret,
                Err(keyring_core::Error::NoEntry) => return Ok(None),
                Err(error) => return Err(format!("read market credentials: {error}")),
            };
            serde_json::from_slice(&secret)
                .map(Some)
                .map_err(|error| format!("parse market credentials: {error}"))
        })
        .await
        .map_err(|error| format!("join market credential read: {error}"))?
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

pub async fn save_market_credentials(credentials: &StoredMarketCredentials) -> Result<(), String> {
    let secret = serde_json::to_vec(credentials)
        .map_err(|error| format!("serialize market credentials: {error}"))?;
    #[cfg(target_os = "macos")]
    {
        return macos_credential_vault()?
            .set(CREDENTIAL_ENTRY, &secret)
            .await
            .map_err(|error| format!("write market credentials: {error:#}"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "market credential lock poisoned".to_string())?;
            open_entry()?
                .set_secret(&secret)
                .map_err(|error| format!("write market credentials: {error}"))
        })
        .await
        .map_err(|error| format!("join market credential write: {error}"))?
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

pub async fn clear_market_credentials() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macos_credential_vault()?
            .remove(CREDENTIAL_ENTRY)
            .await
            .map_err(|error| format!("delete market credentials: {error:#}"));
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "market credential lock poisoned".to_string())?;
            match open_entry()?.delete_credential() {
                Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
                Err(error) => Err(format!("delete market credentials: {error}")),
            }
        })
        .await
        .map_err(|error| format!("join market credential delete: {error}"))?
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
        Err("market credential vault unavailable: no system backend and no vault injected".to_string())
    }
    async fn set_secret(&self, _alias: &str, _secret: &[u8]) -> Result<(), String> {
        Err("market credential vault unavailable: no system backend and no vault injected".to_string())
    }
    async fn delete_secret(&self, _alias: &str) -> Result<(), String> {
        Err("market credential vault unavailable: no system backend and no vault injected".to_string())
    }
}
