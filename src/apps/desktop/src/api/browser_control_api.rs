//! Browser control API — Tauri commands for CDP-based browser control.

use bitfun_core::agentic::tools::browser_control::browser_launcher::{
    BrowserKind, BrowserLauncher, LaunchResult, DEFAULT_CDP_PORT,
};
use bitfun_core::agentic::tools::browser_control::cdp_client::CdpClient;
use bitfun_core::service::config::{get_global_config_service, GlobalConfig};
#[cfg(target_env = "ohos")]
use bitfun_services_integrations::browser_control::{list_arkweb_automation_targets, CdpEndpoint};
use serde::{Deserialize, Serialize};

const BUILTIN_BROWSER_VALUE: &str = "builtin";
const BUILTIN_BROWSER_LABEL: &str = "BitFun Built-in Browser";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserControlStatusRequest {
    #[serde(default = "default_cdp_port")]
    pub port: u16,
}

fn default_cdp_port() -> u16 {
    DEFAULT_CDP_PORT
}

/// Reattach to a browser that is already running with remote debugging on.
///
/// The browser remembers the remote debugging preference across its own
/// restarts, and it keeps an approved connection grant for as long as it stays
/// running — but BitFun's connection registry lives in this process, so every
/// BitFun restart otherwise leaves Settings reporting "not connected" until
/// something asks for the browser. Reattaching here restores that connection
/// without the user having to click anything.
///
/// Opt-in, because the grant does not survive a browser restart: after one,
/// reattaching raises an approval dialog before the user has asked for the
/// browser at all.
///
/// This never starts a browser and never opens a settings page: when there is
/// no live endpoint to reattach to, it does nothing and leaves the on-demand
/// path to handle it.
pub fn init_on_startup() {
    tauri::async_runtime::spawn(async {
        if !auto_connect_on_startup_enabled().await {
            return;
        }
        let Ok(preference) = selected_browser_preference().await else {
            return;
        };
        if is_builtin_browser_preference(&preference) {
            return;
        }
        let Ok(kind) = BrowserLauncher::resolve_browser_kind(Some(&preference)) else {
            return;
        };
        let Some(endpoint) = BrowserLauncher::user_profile_debug_endpoint(&kind) else {
            return;
        };
        if CdpClient::browser_connection_for_kind(DEFAULT_CDP_PORT, &kind)
            .await
            .is_some()
        {
            return;
        }
        // A denial or an approval timeout is an ordinary outcome here, not an
        // error worth surfacing: the user never asked for this connection.
        match CdpClient::connect_user_profile_browser(
            DEFAULT_CDP_PORT,
            endpoint.port,
            &kind,
            &endpoint.web_socket_url,
        )
        .await
        {
            Ok(_) => log::info!("Reattached to the running {} profile on startup", kind),
            Err(error) => log::info!(
                "Could not reattach to the running {} profile on startup: {}",
                kind,
                error
            ),
        }
    });
}

async fn selected_browser_preference() -> Result<String, String> {
    let config = get_global_config_service()
        .await
        .map_err(|e| e.to_string())?
        .get_config::<GlobalConfig>(None)
        .await
        .map_err(|e| e.to_string())?;
    Ok(config.ai.browser_control_preferred_browser)
}

fn is_builtin_browser_preference(preference: &str) -> bool {
    #[cfg(target_env = "ohos")]
    {
        preference.trim().is_empty() || preference.eq_ignore_ascii_case(BUILTIN_BROWSER_VALUE)
    }
    #[cfg(not(target_env = "ohos"))]
    {
        let _ = preference;
        false
    }
}

fn canonical_browser_preference(preference: &str) -> String {
    if is_builtin_browser_preference(preference) {
        BUILTIN_BROWSER_VALUE.to_string()
    } else if preference.trim().is_empty() {
        "default".to_string()
    } else {
        preference.to_string()
    }
}

async fn auto_connect_on_startup_enabled() -> bool {
    let Ok(service) = get_global_config_service().await else {
        return false;
    };
    service
        .get_config::<GlobalConfig>(None)
        .await
        .map(|config| config.ai.browser_control_auto_connect_on_startup)
        .unwrap_or(false)
}

async fn selected_browser_kind() -> Result<BrowserKind, String> {
    let preference = selected_browser_preference().await?;
    BrowserLauncher::resolve_browser_kind(Some(&preference)).map_err(|e| e.to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserControlBrowserOption {
    pub value: String,
    pub label: String,
    pub installed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserControlBrowsersResponse {
    pub options: Vec<BrowserControlBrowserOption>,
}

/// List selectable browsers for CDP browser control.
#[tauri::command]
pub async fn browser_control_list_browsers() -> Result<BrowserControlBrowsersResponse, String> {
    #[cfg(target_env = "ohos")]
    {
        return Ok(BrowserControlBrowsersResponse {
            options: vec![
                BrowserControlBrowserOption {
                    value: BUILTIN_BROWSER_VALUE.to_string(),
                    label: BUILTIN_BROWSER_LABEL.to_string(),
                    installed: true,
                },
                BrowserControlBrowserOption {
                    value: "haitai".to_string(),
                    label: "Haitai Browser".to_string(),
                    installed: true,
                },
            ],
        });
    }

    #[cfg(not(target_env = "ohos"))]
    {
        let browsers = [
            ("default", "Default browser", true),
            (
                "chrome",
                "Google Chrome",
                BrowserLauncher::is_browser_installed(&BrowserKind::Chrome),
            ),
            (
                "edge",
                "Microsoft Edge",
                BrowserLauncher::is_browser_installed(&BrowserKind::Edge),
            ),
            (
                "brave",
                "Brave Browser",
                BrowserLauncher::is_browser_installed(&BrowserKind::Brave),
            ),
            (
                "chromium",
                "Chromium",
                BrowserLauncher::is_browser_installed(&BrowserKind::Chromium),
            ),
            (
                "arc",
                "Arc",
                BrowserLauncher::is_browser_installed(&BrowserKind::Arc),
            ),
        ];

        Ok(BrowserControlBrowsersResponse {
            options: browsers
                .into_iter()
                .map(|(value, label, installed)| BrowserControlBrowserOption {
                    value: value.to_string(),
                    label: label.to_string(),
                    installed,
                })
                .collect(),
        })
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserControlStatusResponse {
    pub cdp_available: bool,
    pub default_cdp_supported: bool,
    pub default_cdp_enabled: bool,
    /// The selected browser is running with remote debugging on, so BitFun can
    /// attach whenever it needs to. Distinguishes "ready, nothing attached yet"
    /// from "nothing to attach to", which both used to read as "not connected".
    pub browser_ready: bool,
    pub browser_kind: String,
    pub browser_version: Option<String>,
    pub port: u16,
    pub page_count: usize,
    pub selected_browser: String,
}

#[cfg(target_env = "ohos")]
async fn builtin_browser_status(preference: &str) -> Result<BrowserControlStatusResponse, String> {
    let targets = list_arkweb_automation_targets();
    let target_ids: std::collections::HashSet<_> = targets
        .iter()
        .map(|target| target.target_id.as_str())
        .collect();
    let endpoint = CdpEndpoint::arkweb_for_current_process();
    let pages = CdpClient::list_pages_at(&endpoint)
        .await
        .unwrap_or_default();
    let page_count = pages
        .iter()
        .filter(|page| {
            page.page_type.as_deref() == Some("page") && target_ids.contains(page.id.as_str())
        })
        .count();
    let version = CdpClient::get_version_at(&endpoint)
        .await
        .ok()
        .and_then(|version| version.browser);
    Ok(BrowserControlStatusResponse {
        cdp_available: page_count > 0,
        default_cdp_supported: false,
        default_cdp_enabled: false,
        browser_ready: true,
        browser_kind: BUILTIN_BROWSER_LABEL.to_string(),
        browser_version: version,
        port: 0,
        page_count,
        selected_browser: canonical_browser_preference(preference),
    })
}

/// Check CDP browser control status.
#[tauri::command]
pub async fn browser_control_get_status(
    request: BrowserControlStatusRequest,
) -> Result<BrowserControlStatusResponse, String> {
    let port = request.port;
    let preference = selected_browser_preference().await?;
    #[cfg(target_env = "ohos")]
    if is_builtin_browser_preference(&preference) {
        return builtin_browser_status(&preference).await;
    }
    let configured_kind = BrowserLauncher::resolve_browser_kind(Some(&preference))
        .map_err(|error| error.to_string())?;
    let default_cdp_supported = BrowserLauncher::supports_default_cdp(&configured_kind);
    // Probe the live endpoint once and answer both questions from it: whether
    // the persistent setting is on, and whether there is something to attach to
    // right now. The probe is a file read plus a short local TCP connect, so it
    // never prompts the browser the way attaching does.
    let user_profile_endpoint = BrowserLauncher::user_profile_debug_endpoint(&configured_kind);
    let default_cdp_enabled = default_cdp_supported
        && (user_profile_endpoint.is_some()
            || BrowserLauncher::is_default_cdp_enabled(&configured_kind));
    let user_profile_connection =
        CdpClient::browser_connection_for_kind(port, &configured_kind).await;
    let legacy_version =
        if user_profile_connection.is_none() && BrowserLauncher::is_cdp_available(port).await {
            CdpClient::get_version(port).await.ok()
        } else {
            None
        };
    // Chrome and Edge share the logical 9222 slot in Settings. Do not report
    // the selected browser as connected merely because the other one owns a
    // legacy fixed-port endpoint left from an earlier selection.
    let legacy_matches_selection = legacy_version.as_ref().is_some_and(|version| {
        let detected = version
            .browser
            .as_deref()
            .and_then(BrowserLauncher::browser_kind_from_cdp_version);
        match &configured_kind {
            BrowserKind::Chrome | BrowserKind::Edge => {
                detected.map(|kind| kind == configured_kind).unwrap_or(true)
            }
            _ => true,
        }
    });
    let available = user_profile_connection.is_some() || legacy_matches_selection;
    let browser_ready = available || user_profile_endpoint.is_some();

    let (version, page_count, actual_kind) = if available {
        let ver_info = if let Some(connection) = &user_profile_connection {
            connection.client.browser_version().await.ok()
        } else {
            legacy_version
        };
        let ver = ver_info.as_ref().and_then(|v| v.browser.clone());
        // Identify the actual browser from CDP version response.
        let kind = {
            #[cfg(target_env = "ohos")]
            {
                configured_kind.clone()
            }
            #[cfg(not(target_env = "ohos"))]
            {
                ver.as_deref()
                    .and_then(BrowserLauncher::browser_kind_from_cdp_version)
                    .unwrap_or_else(|| configured_kind.clone())
            }
        };
        // Only count targets of type "page" (real browser tabs),
        // not service workers, browser targets, etc.
        let pages = if let Some(connection) = &user_profile_connection {
            connection.client.browser_pages().await.ok()
        } else {
            CdpClient::list_pages(port).await.ok()
        }
        .map(|p| {
            p.iter()
                .filter(|t| t.page_type.as_deref() == Some("page"))
                .count()
        })
        .unwrap_or(0);
        (ver, pages, kind)
    } else {
        (None, 0, configured_kind)
    };

    Ok(BrowserControlStatusResponse {
        cdp_available: available,
        default_cdp_supported,
        default_cdp_enabled,
        browser_ready,
        browser_kind: actual_kind.to_string(),
        browser_version: version,
        port,
        page_count,
        selected_browser: canonical_browser_preference(&preference),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserControlLaunchRequest {
    #[serde(default = "default_cdp_port")]
    pub port: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserControlLaunchResponse {
    pub success: bool,
    pub status: String,
    pub message: Option<String>,
    pub browser_kind: String,
    /// Remote debugging settings URL, sent when the user has to open it
    /// themselves because the platform cannot open a `chrome://` URL for them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setup_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fallback_from: Option<String>,
}

fn to_launch_response(kind: &BrowserKind, result: LaunchResult) -> BrowserControlLaunchResponse {
    match result {
        LaunchResult::AlreadyConnected => BrowserControlLaunchResponse {
            success: true,
            status: "already_connected".into(),
            message: None,
            browser_kind: kind.to_string(),
            setup_url: None,
            fallback_from: None,
        },
        LaunchResult::Launched => BrowserControlLaunchResponse {
            success: true,
            status: "launched".into(),
            message: None,
            browser_kind: kind.to_string(),
            setup_url: None,
            fallback_from: None,
        },
        LaunchResult::UserProfileReady { .. } => BrowserControlLaunchResponse {
            success: false,
            status: "user_profile_ready".into(),
            message: None,
            browser_kind: kind.to_string(),
            setup_url: None,
            fallback_from: None,
        },
        LaunchResult::UserProfileSetupRequired {
            instructions,
            setup_url,
            opened,
            ..
        } => BrowserControlLaunchResponse {
            success: false,
            // The two cases need different guidance: one asks the user to
            // finish on a page that is already in front of them, the other
            // asks them to open that page first.
            status: if opened {
                "requires_user_profile_setup".into()
            } else {
                "requires_manual_user_profile_setup".into()
            },
            message: Some(instructions),
            browser_kind: kind.to_string(),
            setup_url: Some(setup_url),
            fallback_from: None,
        },
        LaunchResult::LaunchedButCdpNotReady { message, .. } => BrowserControlLaunchResponse {
            success: false,
            status: "cdp_not_ready".into(),
            message: Some(message),
            browser_kind: kind.to_string(),
            setup_url: None,
            fallback_from: None,
        },
        LaunchResult::BrowserRunningWithoutCdp { instructions, .. } => {
            BrowserControlLaunchResponse {
                success: false,
                status: "needs_restart".into(),
                message: Some(instructions),
                browser_kind: kind.to_string(),
                setup_url: None,
                fallback_from: None,
            }
        }
    }
}

async fn complete_launch(
    kind: &BrowserKind,
    logical_port: u16,
    result: LaunchResult,
) -> Result<BrowserControlLaunchResponse, String> {
    match result {
        LaunchResult::UserProfileReady { endpoint } => {
            let connection = CdpClient::connect_user_profile_browser(
                logical_port,
                endpoint.port,
                kind,
                &endpoint.web_socket_url,
            )
            .await;
            if let Err(error) = connection {
                return Ok(BrowserControlLaunchResponse {
                    success: false,
                    status: "user_profile_connection_failed".into(),
                    message: Some(error.to_string()),
                    browser_kind: kind.to_string(),
                    setup_url: None,
                    fallback_from: None,
                });
            }
            Ok(BrowserControlLaunchResponse {
                success: true,
                status: "connected_user_profile".into(),
                message: None,
                browser_kind: kind.to_string(),
                setup_url: None,
                fallback_from: None,
            })
        }
        other => Ok(to_launch_response(kind, other)),
    }
}

fn builtin_ready_response(fallback_from: Option<String>) -> BrowserControlLaunchResponse {
    BrowserControlLaunchResponse {
        success: true,
        status: if fallback_from.is_some() {
            "fallback_builtin".into()
        } else {
            "builtin_ready".into()
        },
        message: None,
        browser_kind: BUILTIN_BROWSER_LABEL.to_string(),
        setup_url: None,
        fallback_from,
    }
}

#[cfg(target_env = "ohos")]
async fn activate_builtin_fallback(
    fallback_from: &BrowserKind,
    reason: impl std::fmt::Display,
) -> Result<BrowserControlLaunchResponse, String> {
    match get_global_config_service().await {
        Ok(service) => {
            if let Err(error) = service
                .set_config("ai.browser_control_preferred_browser", "")
                .await
            {
                log::warn!(
                    "Could not persist built-in browser fallback preference: {}",
                    error
                );
            }
        }
        Err(error) => log::warn!(
            "Could not access browser preference while falling back to the built-in browser: {}",
            error
        ),
    }
    log::warn!(
        "Browser control falling back from {} to the built-in browser: {}",
        fallback_from,
        reason
    );
    Ok(builtin_ready_response(Some(fallback_from.to_string())))
}

/// Launch the user's default browser with CDP debug port.
#[tauri::command]
pub async fn browser_control_launch(
    request: BrowserControlLaunchRequest,
) -> Result<BrowserControlLaunchResponse, String> {
    let port = request.port;
    let preference = selected_browser_preference().await?;
    if is_builtin_browser_preference(&preference) {
        return Ok(builtin_ready_response(None));
    }
    let kind = BrowserLauncher::resolve_browser_kind(Some(&preference))
        .map_err(|error| error.to_string())?;

    if CdpClient::browser_connection_for_kind(port, &kind)
        .await
        .is_some()
    {
        return Ok(to_launch_response(&kind, LaunchResult::AlreadyConnected));
    }

    // The logical port is shared across browser choices. Drop only the lookup
    // entry when the user switches browsers; any already-attached page session
    // keeps its transport alive, but new actions cannot accidentally reuse it.
    if CdpClient::browser_connection(port).await.is_some() {
        CdpClient::remove_browser_connection(port).await;
    }

    let result = match BrowserLauncher::launch_with_cdp(&kind, port).await {
        Ok(result) => result,
        Err(error) => {
            #[cfg(target_env = "ohos")]
            return activate_builtin_fallback(&kind, error).await;

            #[cfg(not(target_env = "ohos"))]
            return Err(error.to_string());
        }
    };

    let response = complete_launch(&kind, port, result).await?;
    #[cfg(target_env = "ohos")]
    if !response.success {
        return activate_builtin_fallback(
            &kind,
            response
                .message
                .as_deref()
                .unwrap_or(response.status.as_str()),
        )
        .await;
    }
    Ok(response)
}

/// Open the selected browser's persistent guarded-CDP setting and wait for the
/// user-owned consent toggle. Once enabled, immediately request and retain the
/// real-profile connection so the Settings action is one continuous flow.
#[tauri::command]
pub async fn browser_control_enable_default_cdp(
    request: BrowserControlLaunchRequest,
) -> Result<BrowserControlLaunchResponse, String> {
    let port = request.port;
    let preference = selected_browser_preference().await?;
    if is_builtin_browser_preference(&preference) {
        return Ok(builtin_ready_response(None));
    }
    let kind = selected_browser_kind().await?;

    if !BrowserLauncher::supports_default_cdp(&kind) {
        return Ok(BrowserControlLaunchResponse {
            success: false,
            status: "default_cdp_unsupported".into(),
            message: Some(format!(
                "{} does not expose a supported persistent guarded-CDP setting",
                kind
            )),
            browser_kind: kind.to_string(),
            setup_url: None,
            fallback_from: None,
        });
    }

    if CdpClient::browser_connection_for_kind(port, &kind)
        .await
        .is_some()
    {
        return Ok(to_launch_response(&kind, LaunchResult::AlreadyConnected));
    }
    if CdpClient::browser_connection(port).await.is_some() {
        CdpClient::remove_browser_connection(port).await;
    }

    let result = BrowserLauncher::enable_default_cdp(&kind, port)
        .await
        .map_err(|e| e.to_string())?;
    complete_launch(&kind, port, result).await
}

/// Restart the user's default browser with CDP debug port enabled.
#[tauri::command]
pub async fn browser_control_restart_with_cdp(
    request: BrowserControlLaunchRequest,
) -> Result<BrowserControlLaunchResponse, String> {
    let port = request.port;
    let preference = selected_browser_preference().await?;
    if is_builtin_browser_preference(&preference) {
        return Ok(builtin_ready_response(None));
    }
    let kind = selected_browser_kind().await?;

    let result = BrowserLauncher::restart_with_cdp(&kind, port)
        .await
        .map_err(|e| e.to_string())?;

    complete_launch(&kind, port, result).await
}
