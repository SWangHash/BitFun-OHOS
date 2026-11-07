//! ArkWeb built-in browser host port and automation-target registry.
//!
//! OHOS-only. `browser_control::mod` compiles this module under
//! `#[cfg(any(target_env = "ohos", test))]`; the real page is an ArkUI `Web`
//! component created by `src/apps/ohos`'s `BrowserWebviewService.ets`, not a
//! desktop child WebView and not an external CDP Chromium.
//!
//! Upstream does not carry OHOS support. When merging `upstream/main`, keep this
//! file together with its `mod`/`pub use` lines in `mod.rs`: dropping the gate
//! still compiles, so a lost registration shows up only as a built-in browser
//! that cannot be automated.

use async_trait::async_trait;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock, RwLock};

#[async_trait]
pub trait ArkWebBrowserHostPort: Send + Sync {
    async fn create_webview(&self, label: &str, html: &str) -> Result<(), String>;
    async fn close_webview(&self, label: &str) -> Result<(), String>;
}

static ARKWEB_BROWSER_HOST_PORT: OnceLock<RwLock<Option<Arc<dyn ArkWebBrowserHostPort>>>> =
    OnceLock::new();

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ArkWebAutomationTarget {
    pub automation_id: String,
    pub webview_label: String,
    pub target_id: String,
}

#[derive(Default)]
struct ArkWebAutomationTargetRegistry {
    targets: HashMap<String, ArkWebAutomationTarget>,
    default_target_id: Option<String>,
    active_webview_labels: HashSet<String>,
}

static ARKWEB_AUTOMATION_TARGETS: OnceLock<RwLock<ArkWebAutomationTargetRegistry>> =
    OnceLock::new();

fn arkweb_browser_host_port() -> &'static RwLock<Option<Arc<dyn ArkWebBrowserHostPort>>> {
    ARKWEB_BROWSER_HOST_PORT.get_or_init(|| RwLock::new(None))
}

fn arkweb_automation_targets() -> &'static RwLock<ArkWebAutomationTargetRegistry> {
    ARKWEB_AUTOMATION_TARGETS.get_or_init(|| RwLock::new(ArkWebAutomationTargetRegistry::default()))
}

pub fn register_arkweb_browser_host_port(port: Arc<dyn ArkWebBrowserHostPort>) {
    if let Ok(mut slot) = arkweb_browser_host_port().write() {
        *slot = Some(port);
    }
}

pub fn arkweb_browser_host_available() -> bool {
    arkweb_browser_host_port()
        .read()
        .map(|slot| slot.is_some())
        .unwrap_or(false)
}

pub fn register_arkweb_automation_target(target: ArkWebAutomationTarget) {
    if let Ok(mut registry) = arkweb_automation_targets().write() {
        let target_id = target.target_id.clone();
        registry.targets.insert(target_id.clone(), target);
        registry.default_target_id = Some(target_id);
    }
}

pub fn remove_arkweb_automation_target(target_id: &str) {
    if let Ok(mut registry) = arkweb_automation_targets().write() {
        if let Some(target) = registry.targets.remove(target_id) {
            registry.active_webview_labels.remove(&target.webview_label);
        }
        if registry.default_target_id.as_deref() == Some(target_id) {
            registry.default_target_id = None;
        }
    }
}

/// Presentation acknowledgement from the native browser surface. Keep the
/// exact label, including acknowledgements that arrive before CDP registration.
pub fn set_arkweb_webview_active(label: &str, active: bool) {
    if let Ok(mut registry) = arkweb_automation_targets().write() {
        if active {
            registry.active_webview_labels.clear();
            registry.active_webview_labels.insert(label.to_string());
        } else {
            registry.active_webview_labels.remove(label);
        }
    }
}

pub fn arkweb_webview_is_active(label: &str) -> bool {
    arkweb_automation_targets()
        .read()
        .map(|registry| registry.active_webview_labels.contains(label))
        .unwrap_or(false)
}

pub fn set_default_arkweb_automation_target(target_id: &str) -> bool {
    let Ok(mut registry) = arkweb_automation_targets().write() else {
        return false;
    };
    if !registry.targets.contains_key(target_id) {
        return false;
    }
    registry.default_target_id = Some(target_id.to_string());
    true
}

pub fn list_arkweb_automation_targets() -> Vec<ArkWebAutomationTarget> {
    let Ok(registry) = arkweb_automation_targets().read() else {
        return Vec::new();
    };
    let mut targets: Vec<_> = registry.targets.values().cloned().collect();
    targets.sort_by(|left, right| left.target_id.cmp(&right.target_id));
    targets
}

pub fn default_arkweb_automation_target() -> Option<ArkWebAutomationTarget> {
    let registry = arkweb_automation_targets().read().ok()?;
    let target_id = registry.default_target_id.as_deref()?;
    registry.targets.get(target_id).cloned()
}

pub async fn create_arkweb_browser_webview(label: &str, html: &str) -> Result<(), String> {
    let port = arkweb_browser_host_port()
        .read()
        .map_err(|error| format!("failed to read ArkWeb browser host port: {error}"))?
        .clone()
        .ok_or_else(|| "ArkWeb browser host bridge is not registered".to_string())?;
    port.create_webview(label, html).await
}

pub async fn close_arkweb_browser_webview(label: &str) -> Result<(), String> {
    let port = arkweb_browser_host_port()
        .read()
        .map_err(|error| format!("failed to read ArkWeb browser host port: {error}"))?
        .clone()
        .ok_or_else(|| "ArkWeb browser host bridge is not registered".to_string())?;
    port.close_webview(label).await
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestArkWebBrowserHost;

    #[async_trait]
    impl ArkWebBrowserHostPort for TestArkWebBrowserHost {
        async fn create_webview(&self, _label: &str, _html: &str) -> Result<(), String> {
            Ok(())
        }

        async fn close_webview(&self, _label: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn registered_host_is_reported_as_available() {
        register_arkweb_browser_host_port(Arc::new(TestArkWebBrowserHost));
        assert!(arkweb_browser_host_available());
    }

    #[test]
    fn automation_targets_track_default_and_remove_closed_target() {
        let first_id = "arkweb-target-test-first";
        let second_id = "arkweb-target-test-second";
        remove_arkweb_automation_target(first_id);
        remove_arkweb_automation_target(second_id);

        register_arkweb_automation_target(ArkWebAutomationTarget {
            automation_id: "automation-first".to_string(),
            webview_label: "webview-first".to_string(),
            target_id: first_id.to_string(),
        });
        register_arkweb_automation_target(ArkWebAutomationTarget {
            automation_id: "automation-second".to_string(),
            webview_label: "webview-second".to_string(),
            target_id: second_id.to_string(),
        });

        assert_eq!(
            default_arkweb_automation_target()
                .expect("default target")
                .target_id,
            second_id
        );
        let targets = list_arkweb_automation_targets();
        assert!(targets.iter().any(|target| target.target_id == first_id));
        assert!(targets.iter().any(|target| target.target_id == second_id));

        assert!(set_default_arkweb_automation_target(first_id));
        assert_eq!(
            default_arkweb_automation_target()
                .expect("switched default target")
                .target_id,
            first_id
        );

        remove_arkweb_automation_target(second_id);
        assert!(list_arkweb_automation_targets()
            .iter()
            .all(|target| target.target_id != second_id));
        remove_arkweb_automation_target(first_id);
    }
}
