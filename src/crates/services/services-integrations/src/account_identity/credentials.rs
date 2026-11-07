use serde::{Deserialize, Serialize};
#[cfg(target_env = "ohos")]
use std::sync::{Arc, OnceLock};
#[cfg(not(any(target_os = "macos", target_env = "ohos")))]
use std::sync::{Mutex, OnceLock};

// Current and pre-rename service names. The system keyring has no cross-name
// migration, so load reads the legacy name as a fallback, copies the entry
// forward, and save mirrors it back so a downgrade keeps the sign-in.
#[cfg(not(any(target_os = "macos", target_env = "ohos")))]
const KEYRING_SERVICE: &str = "bitfun.miniapp-market.v1";
#[cfg(not(any(target_os = "macos", target_env = "ohos")))]
const LEGACY_KEYRING_SERVICE: &str = "openbitfun.miniapp-market.v1";
const CREDENTIAL_ENTRY: &str = "github-oauth";

#[cfg(any(target_env = "ohos", test))]
const OHOS_MARKET_ALIAS: &str = "bitfun.market.credentials.v1";
// Builds after the brand rename stored the same credentials under this alias.
// It is read as a fallback so an in-place upgrade keeps the market sign-in.
#[cfg(any(target_env = "ohos", test))]
const OHOS_LEGACY_MARKET_ALIAS: &str = "openbitfun.market.credentials.v1";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMarketCredentials {
    pub access_token: String,
    pub access_expires_at: i64,
    pub refresh_token: String,
    pub refresh_expires_at: i64,
}

#[cfg(target_env = "ohos")]
static INJECTED_OHOS_VAULT: OnceLock<
    Arc<dyn bitfun_services_core::secure_credentials::SecureCredentialVault>,
> = OnceLock::new();

/// Install the host-provided credential vault used for market identity
/// storage on OHOS. The desktop host must call this before any market or
/// account identity operation runs; OHOS has no keyring backend, so without
/// an injected vault every credential operation surfaces an explicit
/// unavailable error instead of silently returning empty data.
#[cfg(target_env = "ohos")]
pub fn inject_ohos_credential_vault(
    vault: Arc<dyn bitfun_services_core::secure_credentials::SecureCredentialVault>,
) {
    let _ = INJECTED_OHOS_VAULT.set(vault);
}

#[cfg(target_env = "ohos")]
fn injected_ohos_vault(
) -> Option<Arc<dyn bitfun_services_core::secure_credentials::SecureCredentialVault>> {
    INJECTED_OHOS_VAULT.get().cloned()
}

#[cfg(not(any(target_os = "macos", target_env = "ohos")))]
fn keyring_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(not(any(target_os = "macos", target_env = "ohos")))]
fn open_entry(service: &str) -> Result<keyring_core::Entry, String> {
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

        let store =
            store.map_err(|error| format!("initialize system credential store: {error}"))?;
        keyring_core::set_default_store(store);
    }
    keyring_core::Entry::new(service, CREDENTIAL_ENTRY)
        .map_err(|error| format!("open market credential entry: {error}"))
}

#[cfg(not(any(target_os = "macos", target_env = "ohos")))]
fn read_secret(entry: &keyring_core::Entry) -> Result<Option<Vec<u8>>, String> {
    match entry.get_secret() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring_core::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!("read market credentials: {error}")),
    }
}

#[cfg(target_os = "macos")]
fn macos_credential_vault(
) -> Result<bitfun_services_core::credential_vault::CredentialVault, String> {
    let base = dirs::config_dir()
        .ok_or_else(|| "system config directory unavailable".to_string())?
        .join(bitfun_services_core::product_identity::data_namespace())
        .join("data");
    Ok(
        bitfun_services_core::credential_vault::CredentialVault::new(
            base.join(".market_credentials_vault.key"),
            base.join("market_credentials_vault.json"),
        ),
    )
}

/// Reads the market credentials from the OHOS vault. The pre-rename alias is a
/// read-only fallback: it is copied to the current alias and left in place, so
/// a downgrade or a failed copy never loses the sign-in.
#[cfg(any(target_env = "ohos", test))]
async fn load_from_ohos_vault(
    vault: &dyn bitfun_services_core::secure_credentials::SecureCredentialVault,
) -> Result<Option<StoredMarketCredentials>, String> {
    if let Some(secret) = vault
        .get_secret(OHOS_MARKET_ALIAS)
        .await
        .map_err(|error| format!("read market credentials: {error}"))?
    {
        return serde_json::from_slice(&secret)
            .map(Some)
            .map_err(|error| format!("parse market credentials: {error}"));
    }
    let Some(secret) = vault
        .get_secret(OHOS_LEGACY_MARKET_ALIAS)
        .await
        .map_err(|error| format!("read market credentials: {error}"))?
    else {
        return Ok(None);
    };
    let credentials: StoredMarketCredentials = serde_json::from_slice(&secret)
        .map_err(|error| format!("parse market credentials: {error}"))?;
    if let Err(error) = vault.set_secret(OHOS_MARKET_ALIAS, &secret).await {
        log::warn!("Failed to carry legacy market credentials to the current alias: {error}");
    }
    Ok(Some(credentials))
}

/// Deletes both aliases so an explicit sign-out cannot resurrect the legacy entry.
#[cfg(any(target_env = "ohos", test))]
async fn clear_from_ohos_vault(
    vault: &dyn bitfun_services_core::secure_credentials::SecureCredentialVault,
) -> Result<(), String> {
    for alias in [OHOS_MARKET_ALIAS, OHOS_LEGACY_MARKET_ALIAS] {
        vault
            .delete_secret(alias)
            .await
            .map_err(|error| format!("delete market credentials: {error}"))?;
    }
    Ok(())
}

pub async fn load_market_credentials() -> Result<Option<StoredMarketCredentials>, String> {
    #[cfg(target_env = "ohos")]
    {
        let vault = injected_ohos_vault().ok_or_else(|| {
            "market credential vault unavailable: OHOS vault not injected".to_string()
        })?;
        return load_from_ohos_vault(vault.as_ref()).await;
    }
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
    #[cfg(not(any(target_os = "macos", target_env = "ohos")))]
    {
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "market credential lock poisoned".to_string())?;
            let current = open_entry(KEYRING_SERVICE)?;
            let secret = match read_secret(&current)? {
                Some(secret) => secret,
                None => {
                    let legacy = open_entry(LEGACY_KEYRING_SERVICE)?;
                    let Some(secret) = read_secret(&legacy)? else {
                        return Ok(None);
                    };
                    if let Err(error) = current.set_secret(&secret) {
                        log::warn!(
                            "Failed to carry legacy market credentials to the current keyring entry: {error}"
                        );
                    }
                    secret
                }
            };
            serde_json::from_slice(&secret)
                .map(Some)
                .map_err(|error| format!("parse market credentials: {error}"))
        })
        .await
        .map_err(|error| format!("join market credential read: {error}"))?
    }
}

pub async fn save_market_credentials(credentials: &StoredMarketCredentials) -> Result<(), String> {
    let secret = serde_json::to_vec(credentials)
        .map_err(|error| format!("serialize market credentials: {error}"))?;
    #[cfg(target_env = "ohos")]
    {
        let vault = injected_ohos_vault().ok_or_else(|| {
            "market credential vault unavailable: OHOS vault not injected".to_string()
        })?;
        vault
            .set_secret(OHOS_MARKET_ALIAS, &secret)
            .await
            .map_err(|error| format!("write market credentials: {error}"))?;
        // Mirror the pre-rename alias so a downgrade keeps the sign-in.
        if let Err(error) = vault.set_secret(OHOS_LEGACY_MARKET_ALIAS, &secret).await {
            log::warn!("Failed to mirror market credentials to the legacy alias: {error}");
        }
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        return macos_credential_vault()?
            .set(CREDENTIAL_ENTRY, &secret)
            .await
            .map_err(|error| format!("write market credentials: {error:#}"));
    }
    #[cfg(not(any(target_os = "macos", target_env = "ohos")))]
    {
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "market credential lock poisoned".to_string())?;
            let current = open_entry(KEYRING_SERVICE)?;
            current
                .set_secret(&secret)
                .map_err(|error| format!("write market credentials: {error}"))?;
            // Keep the pre-rename entry in sync: an older build reads only that
            // name, and a downgrade must not lose the sign-in.
            match open_entry(LEGACY_KEYRING_SERVICE) {
                Ok(legacy) => {
                    if let Err(error) = legacy.set_secret(&secret) {
                        log::warn!(
                            "Failed to mirror market credentials to the legacy keyring entry: {error}"
                        );
                    }
                }
                Err(error) => log::warn!(
                    "Failed to open the legacy market credential entry for mirroring: {error}"
                ),
            }
            Ok(())
        })
        .await
        .map_err(|error| format!("join market credential write: {error}"))?
    }
}

pub async fn clear_market_credentials() -> Result<(), String> {
    #[cfg(target_env = "ohos")]
    {
        let vault = injected_ohos_vault().ok_or_else(|| {
            "market credential vault unavailable: OHOS vault not injected".to_string()
        })?;
        return clear_from_ohos_vault(vault.as_ref()).await;
    }
    #[cfg(target_os = "macos")]
    {
        return macos_credential_vault()?
            .remove(CREDENTIAL_ENTRY)
            .await
            .map_err(|error| format!("delete market credentials: {error:#}"));
    }
    #[cfg(not(any(target_os = "macos", target_env = "ohos")))]
    {
        tokio::task::spawn_blocking(move || {
            let _guard = keyring_lock()
                .lock()
                .map_err(|_| "market credential lock poisoned".to_string())?;
            // Remove both names so an explicit sign-out cannot resurrect the
            // pre-rename entry on the next read.
            for service in [KEYRING_SERVICE, LEGACY_KEYRING_SERVICE] {
                match open_entry(service)?.delete_credential() {
                    Ok(()) | Err(keyring_core::Error::NoEntry) => {}
                    Err(error) => {
                        return Err(format!("delete market credentials: {error}"));
                    }
                }
            }
            Ok(())
        })
        .await
        .map_err(|error| format!("join market credential delete: {error}"))?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bitfun_services_core::secure_credentials::SecureCredentialVault;
    use std::collections::HashMap;
    use std::future::Future;
    use std::pin::Pin;
    use std::sync::Mutex;

    #[derive(Debug, Default)]
    struct MemoryVault {
        entries: Mutex<HashMap<String, Vec<u8>>>,
        fail_writes: bool,
    }

    impl MemoryVault {
        fn with(alias: &str, secret: &[u8]) -> Self {
            let vault = Self::default();
            vault
                .entries
                .lock()
                .unwrap()
                .insert(alias.to_string(), secret.to_vec());
            vault
        }

        fn contains(&self, alias: &str) -> bool {
            self.entries.lock().unwrap().contains_key(alias)
        }
    }

    // Written out by hand: `async-trait` is not a dependency of this feature.
    impl SecureCredentialVault for MemoryVault {
        fn get_secret<'a, 'b, 'c>(
            &'a self,
            alias: &'b str,
        ) -> Pin<Box<dyn Future<Output = Result<Option<Vec<u8>>, String>> + Send + 'c>>
        where
            'a: 'c,
            'b: 'c,
            Self: 'c,
        {
            Box::pin(async move { Ok(self.entries.lock().unwrap().get(alias).cloned()) })
        }

        fn set_secret<'a, 'b, 'c, 'd>(
            &'a self,
            alias: &'b str,
            secret: &'c [u8],
        ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'd>>
        where
            'a: 'd,
            'b: 'd,
            'c: 'd,
            Self: 'd,
        {
            Box::pin(async move {
                if self.fail_writes {
                    return Err("vault is read-only".to_string());
                }
                self.entries
                    .lock()
                    .unwrap()
                    .insert(alias.to_string(), secret.to_vec());
                Ok(())
            })
        }

        fn delete_secret<'a, 'b, 'c>(
            &'a self,
            alias: &'b str,
        ) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'c>>
        where
            'a: 'c,
            'b: 'c,
            Self: 'c,
        {
            Box::pin(async move {
                self.entries.lock().unwrap().remove(alias);
                Ok(())
            })
        }
    }

    fn credentials_json() -> Vec<u8> {
        serde_json::to_vec(&StoredMarketCredentials {
            access_token: "access".to_string(),
            access_expires_at: 10,
            refresh_token: "refresh".to_string(),
            refresh_expires_at: 20,
        })
        .unwrap()
    }

    #[tokio::test]
    async fn legacy_alias_is_read_and_carried_to_the_current_alias() {
        assert_eq!(OHOS_MARKET_ALIAS, "bitfun.market.credentials.v1");
        assert_eq!(OHOS_LEGACY_MARKET_ALIAS, "openbitfun.market.credentials.v1");
        let vault = MemoryVault::with(OHOS_LEGACY_MARKET_ALIAS, &credentials_json());

        let loaded = load_from_ohos_vault(&vault).await.unwrap().unwrap();

        assert_eq!(loaded.refresh_token, "refresh");
        assert!(vault.contains(OHOS_MARKET_ALIAS));
        assert!(vault.contains(OHOS_LEGACY_MARKET_ALIAS));
    }

    #[tokio::test]
    async fn current_alias_wins_over_the_legacy_alias() {
        let mut newer =
            serde_json::from_slice::<StoredMarketCredentials>(&credentials_json()).unwrap();
        newer.refresh_token = "rotated".to_string();
        let vault = MemoryVault::with(OHOS_LEGACY_MARKET_ALIAS, &credentials_json());
        vault.entries.lock().unwrap().insert(
            OHOS_MARKET_ALIAS.to_string(),
            serde_json::to_vec(&newer).unwrap(),
        );

        let loaded = load_from_ohos_vault(&vault).await.unwrap().unwrap();

        assert_eq!(loaded.refresh_token, "rotated");
    }

    #[tokio::test]
    async fn legacy_read_survives_a_failed_copy_and_unparsable_legacy_data_is_kept() {
        let mut readonly = MemoryVault::with(OHOS_LEGACY_MARKET_ALIAS, &credentials_json());
        readonly.fail_writes = true;
        assert!(load_from_ohos_vault(&readonly).await.unwrap().is_some());
        assert!(!readonly.contains(OHOS_MARKET_ALIAS));

        let garbled = MemoryVault::with(OHOS_LEGACY_MARKET_ALIAS, b"not json");
        assert!(load_from_ohos_vault(&garbled).await.is_err());
        assert!(garbled.contains(OHOS_LEGACY_MARKET_ALIAS));
        assert!(!garbled.contains(OHOS_MARKET_ALIAS));
    }

    #[tokio::test]
    async fn sign_out_removes_both_aliases() {
        let vault = MemoryVault::with(OHOS_LEGACY_MARKET_ALIAS, &credentials_json());
        vault
            .entries
            .lock()
            .unwrap()
            .insert(OHOS_MARKET_ALIAS.to_string(), credentials_json());

        clear_from_ohos_vault(&vault).await.unwrap();

        assert!(load_from_ohos_vault(&vault).await.unwrap().is_none());
    }
}
