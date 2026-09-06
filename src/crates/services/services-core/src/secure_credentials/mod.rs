//! Unified abstraction over a platform's secure credential vault.
//!
//! This is the shared seam that OpenBitFun surfaces use to persist secret
//! material outside the workspace. Today the consumers are subscription auth
//! (Codex/Antigravity/OpenCode OAuth tokens), the MiniApp and appearance
//! markets (GitHub OAuth), and feedback service credentials. Each consumer
//! owns its own serialization, alias format, and (on the system keyring
//! backend) its own `service` namespace; this trait only exposes a
//! key->bytes vault so platform differences stay inside one
//! implementation.
//!
//! # Alias uniqueness
//!
//! On the system keyring backend, aliases are scoped by the consumer's
//! `service` namespace and need not be globally unique. On a single-namespace
//! backend such as the OHOS AssetStoreKit, the desktop host injects one
//! shared vault and the alias formats already in use (`provider/v2/...`
//! for subscription chunks, `github-oauth` for the MiniApp/appearance
//! market, `openbitfun.feedback.*` for feedback) do not collide. New consumers
//! must choose an alias format that does not overlap with existing ones.
//!
//! # Failure semantics
//!
//! Missing entries are `Ok(None)` (or `Ok(())` for delete). Transient
//! platform unavailability (locked keychain, missing D-Bus session,
//! revoked AssetStoreKit access) must surface as `Err` so callers can
//! retry instead of treating the entry as absent — silent local fallback
//! would leak secrets to a remote controller or dispatch target.

use async_trait::async_trait;

/// Unified key->bytes secure credential vault.
///
/// Implementations must be `Send + Sync` and serialize concurrent access
/// internally because multiple consumers within the same process may share
/// one vault instance.
#[async_trait]
pub trait SecureCredentialVault: std::fmt::Debug + Send + Sync {
    /// Reads a raw secret entry by alias.
    ///
    /// Returns `Ok(None)` when the alias is absent. Returns `Err` when the
    /// underlying vault is unavailable so callers can distinguish a missing
    /// entry from a transiently locked vault.
    async fn get_secret(&self, alias: &str) -> Result<Option<Vec<u8>>, String>;

    /// Writes or replaces a raw secret entry by alias.
    ///
    /// Implementations may enforce a platform-specific size limit and
    /// surface it through `Err`. Callers that need to store arbitrary
    /// lengths should chunk the value before calling.
    async fn set_secret(&self, alias: &str, secret: &[u8]) -> Result<(), String>;

    /// Deletes a secret entry by alias.
    ///
    /// Idempotent: returns `Ok(())` when the alias is already absent.
    async fn delete_secret(&self, alias: &str) -> Result<(), String>;

    /// Reads a legacy text-encoded secret entry written through the older
    /// password API.
    ///
    /// On Windows, password entries are stored as UTF-16 and cannot be
    /// decoded through `get_secret`. Platforms without legacy data (e.g.
    /// OHOS, fresh installs on any platform) return `Ok(None)`, which is
    /// the default implementation. Callers use this only for one-time v1
    /// → v2 migration; new code must call `get_secret` instead.
    async fn get_legacy_secret_text(&self, _alias: &str) -> Result<Option<String>, String> {
        Ok(None)
    }
}

#[cfg(feature = "system-vault")]
pub mod system_vault;

#[cfg(feature = "system-vault")]
pub use system_vault::SystemSecureCredentialVault;
