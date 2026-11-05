//! Browser control API — Tauri commands for CDP-based browser control.

use bitfun_core::agentic::tools::browser_control::browser_launcher::{
    BrowserKind, BrowserLauncher, CdpPortProbe, LaunchResult, DEFAULT_CDP_PORT,
};
use bitfun_core::agentic::tools::browser_control::cdp_client::{
    CdpClient, UserProfileConnectError, USER_PROFILE_APPROVAL_TIMEOUT,
};
#[cfg(target_env = "ohos")]
use bitfun_core::agentic::tools::implementations::control_hub_tool::disconnect_builtin_browser;
use bitfun_core::agentic::tools::implementations::control_hub_tool::disconnect_external_browser;
use bitfun_core::service::config::{get_global_config_service, GlobalConfig};
#[cfg(target_env = "ohos")]
use bitfun_services_integrations::browser_control::{list_arkweb_automation_targets, CdpEndpoint};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::Instant;

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
        let Some(endpoint) =
            BrowserLauncher::user_profile_debug_endpoint_or_guarded_port(&kind, DEFAULT_CDP_PORT)
                .await
        else {
            return;
        };
        // Nobody asked for this connection, so never raise an approval prompt
        // in a browser that may not be the selected one: a port inferred from
        // a 404 probe is ambiguous while the other guarded browser runs too.
        if BrowserLauncher::is_inferred_guarded_endpoint(&endpoint)
            && BrowserLauncher::other_guarded_browser_running(&kind).await
        {
            log::info!(
                "Skipping startup reattach to {}: port {} has no DevToolsActivePort and another guarded browser is running",
                kind,
                endpoint.port
            );
            return;
        }
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
    /// Browser-owned settings URL for the guarded user-profile CDP flow. The
    /// UI always displays it while setup is pending so the user can recover if
    /// the platform-specific automatic open did not produce the right tab.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setup_url: Option<String>,
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
        cdp_available: page_count > 0 && !CdpClient::browser_connection_suppressed(0).await,
        default_cdp_supported: false,
        default_cdp_enabled: false,
        browser_ready: true,
        browser_kind: BUILTIN_BROWSER_LABEL.to_string(),
        browser_version: version,
        port: 0,
        page_count,
        selected_browser: canonical_browser_preference(preference),
        setup_url: None,
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
    // right now. The probe is a file read, a short local TCP connect and, when
    // no DevToolsActivePort file is published, one HTTP request to the port;
    // none of these opens a WebSocket, so it never prompts the browser the way
    // attaching does.
    let user_profile_endpoint =
        BrowserLauncher::user_profile_debug_endpoint_or_guarded_port(&configured_kind, port).await;
    // An endpoint inferred from a 404 port probe is only a candidate until
    // the browser accepts the WebSocket, so it makes the browser "ready" but
    // never proves the persistent setting is on.
    let published_endpoint = user_profile_endpoint
        .as_ref()
        .is_some_and(|endpoint| !BrowserLauncher::is_inferred_guarded_endpoint(endpoint));
    let default_cdp_enabled = default_cdp_supported
        && (published_endpoint
            || BrowserLauncher::is_default_cdp_enabled_async(&configured_kind).await);
    let user_profile_connection =
        CdpClient::browser_connection_for_kind(port, &configured_kind).await;
    let browser_connection_suppressed = CdpClient::browser_connection_suppressed(port).await;
    // Guarded remote debugging answers 404 on /json*, so only a legacy
    // HTTP endpoint is read through the HTTP discovery API.
    let legacy_version = if user_profile_connection.is_none()
        && BrowserLauncher::probe_cdp_port(port).await == CdpPortProbe::Http
    {
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
    // A listening debug port is ready, not connected on the user's behalf.
    // Keep the UI's Connect action available until its grant exists, matching
    // the Agent's access gate rather than showing a misleading Connected state.
    let legacy_authorized =
        CdpClient::authorized_browser_kind(port).await.as_ref() == Some(&configured_kind);
    let available = !browser_connection_suppressed
        && (user_profile_connection.is_some() || (legacy_matches_selection && legacy_authorized));
    let browser_ready = available || user_profile_endpoint.is_some() || legacy_matches_selection;

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
        setup_url: BrowserLauncher::user_profile_debugging_setup_url(&actual_kind)
            .map(str::to_string),
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

/// Overall budget for one Browser Control setup command, measured from its
/// start. It stays below the Peer host invoke limit for these commands
/// (`peer_host_invoke::BROWSER_CONTROL_SETUP_INVOKE_TIMEOUT`, 180 s) so a late
/// fallback cannot outlive the request that is waiting for it.
const BROWSER_CONTROL_SETUP_BUDGET: Duration = Duration::from_secs(170);
/// Approval time kept back when a late 404 sends the flow back to setup.
const FALLBACK_APPROVAL_RESERVE: Duration = Duration::from_secs(20);

/// Setup wait available to the late-404 fallback, leaving the approval
/// reserve. `None` means the overall budget cannot fit another round.
fn fallback_setup_wait(remaining: Duration) -> Option<Duration> {
    remaining
        .checked_sub(FALLBACK_APPROVAL_RESERVE)
        .filter(|wait| !wait.is_zero())
}

/// Approval wait for the next WebSocket attempt inside the overall deadline.
fn approval_budget(remaining: Duration) -> Duration {
    remaining.min(USER_PROFILE_APPROVAL_TIMEOUT)
}

fn setup_budget_exhausted(kind: &BrowserKind) -> BrowserControlLaunchResponse {
    BrowserControlLaunchResponse {
        success: false,
        status: "user_profile_connection_failed".into(),
        message: Some(format!(
            "Browser Control setup for {kind} ran out of time. Connect again from Settings > Browser control."
        )),
        browser_kind: kind.to_string(),
        setup_url: None,
        fallback_from: None,
    }
}

async fn complete_launch(
    kind: &BrowserKind,
    logical_port: u16,
    result: LaunchResult,
    wait_for_user_profile_setup: bool,
    deadline: Instant,
) -> Result<BrowserControlLaunchResponse, String> {
    let mut result = result;
    // An endpoint inferred from a 404 port probe gets one chance: a 404 on
    // the WebSocket upgrade falls back to setup. Authorization denials and
    // other handshake failures remain errors, never another setup attempt.
    let mut inferred_fallback_available = true;
    loop {
        let LaunchResult::UserProfileReady { endpoint } = result else {
            let response = to_launch_response(kind, result);
            if response.success {
                CdpClient::authorize_legacy_browser(logical_port, kind).await;
            }
            return Ok(response);
        };
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Ok(setup_budget_exhausted(kind));
        }
        // Attaching to a guarded real profile makes the browser show its own
        // approval request, and that prompt is only answerable from a
        // visible window. Browser control itself is background work, so
        // this is one of the few flows that must surface the browser.
        BrowserLauncher::activate_browser(kind);
        let connection = CdpClient::connect_user_profile_browser_within(
            logical_port,
            endpoint.port,
            kind,
            &endpoint.web_socket_url,
            approval_budget(remaining),
        )
        .await;
        match connection {
            Ok(_) => {
                return Ok(BrowserControlLaunchResponse {
                    success: true,
                    status: "connected_user_profile".into(),
                    message: None,
                    browser_kind: kind.to_string(),
                    setup_url: None,
                    fallback_from: None,
                })
            }
            Err(UserProfileConnectError::NotABrowserEndpoint(error))
                if inferred_fallback_available
                    && BrowserLauncher::is_inferred_guarded_endpoint(&endpoint) =>
            {
                log::info!(
                    "Port {} is not a guarded browser endpoint, continuing with {} setup: {}",
                    endpoint.port,
                    kind,
                    error
                );
                inferred_fallback_available = false;
                let Some(setup_wait) =
                    fallback_setup_wait(deadline.saturating_duration_since(Instant::now()))
                else {
                    return Ok(setup_budget_exhausted(kind));
                };
                result = BrowserLauncher::enable_default_cdp_without_port_fallback(
                    kind,
                    logical_port,
                    wait_for_user_profile_setup,
                    setup_wait,
                )
                .await
                .map_err(|e| e.to_string())?;
            }
            Err(error) => {
                return Ok(BrowserControlLaunchResponse {
                    success: false,
                    status: "user_profile_connection_failed".into(),
                    message: Some(error.into_error().to_string()),
                    browser_kind: kind.to_string(),
                    setup_url: None,
                    fallback_from: None,
                });
            }
        }
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

async fn prepare_explicit_browser_launch(port: u16, kind: &BrowserKind) -> bool {
    // Disconnect suppresses agent-driven reattachment. A user clicking Connect
    // is the explicit action that must clear that process-local guard.
    CdpClient::allow_browser_connection(port).await;
    CdpClient::browser_connection_for_kind(port, kind)
        .await
        .is_some()
}

/// Launch the user's default browser with CDP debug port.
#[tauri::command]
pub async fn browser_control_launch(
    request: BrowserControlLaunchRequest,
) -> Result<BrowserControlLaunchResponse, String> {
    let deadline = Instant::now() + BROWSER_CONTROL_SETUP_BUDGET;
    let port = request.port;
    let preference = selected_browser_preference().await?;
    if is_builtin_browser_preference(&preference) {
        CdpClient::allow_browser_connection(0).await;
        return Ok(builtin_ready_response(None));
    }
    let kind = BrowserLauncher::resolve_browser_kind(Some(&preference))
        .map_err(|error| error.to_string())?;
    if CdpClient::authorized_browser_kind(port)
        .await
        .is_some_and(|connected| connected != kind)
    {
        // Switching the selected browser revokes its previous page bindings,
        // even if the replacement connection subsequently fails.
        disconnect_external_browser(port).await;
    }
    CdpClient::allow_browser_connection(port).await;

    if prepare_explicit_browser_launch(port, &kind).await {
        return Ok(to_launch_response(&kind, LaunchResult::AlreadyConnected));
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

    let response = complete_launch(&kind, port, result, false, deadline).await?;
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
    let deadline = Instant::now() + BROWSER_CONTROL_SETUP_BUDGET;
    let port = request.port;
    let preference = selected_browser_preference().await?;
    if is_builtin_browser_preference(&preference) {
        CdpClient::allow_browser_connection(0).await;
        return Ok(builtin_ready_response(None));
    }
    let kind = selected_browser_kind().await?;
    if CdpClient::authorized_browser_kind(port)
        .await
        .is_some_and(|connected| connected != kind)
    {
        disconnect_external_browser(port).await;
    }
    CdpClient::allow_browser_connection(port).await;

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
    let result = BrowserLauncher::enable_default_cdp(&kind, port)
        .await
        .map_err(|e| e.to_string())?;
    complete_launch(&kind, port, result, true, deadline).await
}

/// Restart the user's default browser with CDP debug port enabled.
#[tauri::command]
pub async fn browser_control_restart_with_cdp(
    request: BrowserControlLaunchRequest,
) -> Result<BrowserControlLaunchResponse, String> {
    let deadline = Instant::now() + BROWSER_CONTROL_SETUP_BUDGET;
    let port = request.port;
    let preference = selected_browser_preference().await?;
    if is_builtin_browser_preference(&preference) {
        CdpClient::allow_browser_connection(0).await;
        return Ok(builtin_ready_response(None));
    }
    let kind = selected_browser_kind().await?;
    disconnect_external_browser(port).await;
    CdpClient::allow_browser_connection(port).await;

    let result = BrowserLauncher::restart_with_cdp(&kind, port)
        .await
        .map_err(|e| e.to_string())?;

    complete_launch(&kind, port, result, false, deadline).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserControlDisconnectResponse {
    pub success: bool,
    pub status: String,
    pub browser_kind: String,
}

/// Detach BitFun from the selected browser without closing browser tabs or
/// changing the browser-owned Remote debugging preference.
#[tauri::command]
pub async fn browser_control_disconnect(
    request: BrowserControlLaunchRequest,
) -> Result<BrowserControlDisconnectResponse, String> {
    #[cfg(target_env = "ohos")]
    if is_builtin_browser_preference(&selected_browser_preference().await?) {
        let disconnected_count = disconnect_builtin_browser().await;
        return Ok(BrowserControlDisconnectResponse {
            success: true,
            status: if disconnected_count > 0 {
                "disconnected".into()
            } else {
                "already_disconnected".into()
            },
            browser_kind: BUILTIN_BROWSER_LABEL.to_string(),
        });
    }
    let kind = selected_browser_kind().await?;
    let disconnected_count = disconnect_external_browser(request.port).await;

    Ok(BrowserControlDisconnectResponse {
        success: true,
        status: if disconnected_count > 0 {
            "disconnected".into()
        } else {
            "already_disconnected".into()
        },
        browser_kind: kind.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn explicit_launch_clears_disconnect_suppression() {
        let port = 61_339;
        CdpClient::suppress_browser_connection(port).await;
        assert!(CdpClient::browser_connection_suppressed(port).await);

        assert!(!prepare_explicit_browser_launch(port, &BrowserKind::Haitai).await);
        assert!(!CdpClient::browser_connection_suppressed(port).await);
    }

    #[test]
    fn setup_budget_fits_inside_the_peer_host_invoke_limit() {
        assert!(
            BROWSER_CONTROL_SETUP_BUDGET
                < super::super::peer_host_invoke::BROWSER_CONTROL_SETUP_INVOKE_TIMEOUT
        );
    }

    #[test]
    fn late_404_fallback_is_bounded_by_the_remaining_budget() {
        // A 404 arriving after the first setup wait leaves 110 s: the
        // fallback setup may use 90 s and approval keeps the reserve.
        assert_eq!(
            fallback_setup_wait(Duration::from_secs(110)),
            Some(Duration::from_secs(90))
        );
        assert_eq!(fallback_setup_wait(FALLBACK_APPROVAL_RESERVE), None);
        assert_eq!(fallback_setup_wait(Duration::from_secs(5)), None);
        assert_eq!(
            approval_budget(Duration::from_secs(30)),
            Duration::from_secs(30)
        );
        assert_eq!(
            approval_budget(Duration::from_secs(170)),
            USER_PROFILE_APPROVAL_TIMEOUT
        );
        // Worst case: setup (60 s) + approval (90 s) + late 404 fallback
        // setup + approval never exceeds the overall budget because every
        // step is capped by what remains of the same deadline.
        let after_first_round = BROWSER_CONTROL_SETUP_BUDGET - Duration::from_secs(60);
        let fallback = fallback_setup_wait(after_first_round).unwrap();
        assert!(fallback + FALLBACK_APPROVAL_RESERVE <= after_first_round);
    }

    #[tokio::test]
    async fn exhausted_budget_reports_a_clear_failure() {
        let response = complete_launch(
            &BrowserKind::Chrome,
            1,
            LaunchResult::UserProfileReady {
                endpoint: bitfun_core::agentic::tools::browser_control::browser_launcher::BrowserDebugEndpoint {
                    port: 1,
                    web_socket_url: "ws://127.0.0.1:1/devtools/browser".into(),
                },
            },
            false,
            Instant::now(),
        )
        .await
        .unwrap();
        assert!(!response.success);
        assert!(response.message.unwrap().contains("ran out of time"));
    }
}
