//! Host integration for the installed DevEco Code account management API.

use super::AppState;
use bitfun_acp::client::AcpClientRuntimeOverride;
use bitfun_core::deveco_account::{
    DevEcoAccountOptions, DevEcoAccountService, DevEcoAccountSnapshot, DevEcoBrowserOpener,
};
use bitfun_core::service::workspace::WorkspaceKind;
use serde::Deserialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use tauri::State;
use tokio::sync::Mutex;

struct ManagedAccount {
    launch: AcpClientRuntimeOverride,
    service: Arc<DevEcoAccountService>,
}

#[derive(Default)]
struct AccountHost {
    closed: bool,
    managed: Option<ManagedAccount>,
}

static ACCOUNT: OnceLock<StdMutex<AccountHost>> = OnceLock::new();
static ACCOUNT_REFRESH: OnceLock<Mutex<()>> = OnceLock::new();

fn account_host() -> std::sync::MutexGuard<'static, AccountHost> {
    ACCOUNT
        .get_or_init(|| StdMutex::new(AccountHost::default()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Deserialize)]
pub struct DevecoAccountRequest {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevecoAccountCancelRequest {
    pub session_id: String,
}

fn browser_opener() -> Option<DevEcoBrowserOpener> {
    #[cfg(target_env = "ohos")]
    {
        Some(Arc::new(|url| {
            Box::pin(super::system_api::open_external_ohos(url))
        }))
    }
    #[cfg(not(target_env = "ohos"))]
    {
        None
    }
}

async fn account_service(state: &AppState) -> Result<Option<Arc<DevEcoAccountService>>, String> {
    if state
        .workspace_service
        .get_current_workspace()
        .await
        .is_some_and(|workspace| workspace.workspace_kind == WorkspaceKind::Remote)
    {
        return Err("deveco_account_remote_unsupported".to_string());
    }
    let _refresh = ACCOUNT_REFRESH.get_or_init(|| Mutex::new(())).lock().await;
    if account_host().closed {
        return Err("deveco_auth_closed".to_string());
    }
    let acp = state
        .acp_client_service
        .as_ref()
        .ok_or_else(|| "deveco_auth_unavailable".to_string())?;
    let launch = acp
        .local_client_launch("deveco-code")
        .await
        .map_err(|_| "deveco_auth_unavailable".to_string())?
        .filter(|launch| PathBuf::from(&launch.command).is_file());
    {
        let mut host = account_host();
        if host.closed {
            return Err("deveco_auth_closed".to_string());
        }
        if let (Some(existing), Some(launch)) = (host.managed.as_ref(), launch.as_ref()) {
            if existing.launch == *launch {
                return Ok(Some(Arc::clone(&existing.service)));
            }
        }
        if let Some(previous) = host.managed.take() {
            previous.service.shutdown_now();
        }
    }
    let Some(launch) = launch else {
        return Ok(None);
    };
    let executable = PathBuf::from(&launch.command);
    // Retain a configured runtime wrapper, such as Node plus a CLI entrypoint,
    // while replacing only the ACP subcommand with the management server.
    let prefix_arguments = management_prefix_arguments(&launch.args)?;
    let working_directory = launch
        .env
        .get("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(dirs::home_dir);
    let service = DevEcoAccountService::new(DevEcoAccountOptions {
        executable,
        prefix_arguments,
        environment: launch.env.clone(),
        working_directory,
        browser_opener: browser_opener(),
        browser_temporary_directory: cfg!(target_env = "ohos").then(|| {
            state
                .workspace_service
                .path_manager()
                .temp_dir()
                .join("deveco-account")
        }),
    })?;
    let mut host = account_host();
    if host.closed {
        service.shutdown_now();
        return Err("deveco_auth_closed".to_string());
    }
    host.managed = Some(ManagedAccount {
        launch,
        service: Arc::clone(&service),
    });
    Ok(Some(service))
}

fn management_prefix_arguments(arguments: &[String]) -> Result<Vec<String>, String> {
    let index = arguments
        .iter()
        .position(|argument| argument == "acp")
        .ok_or_else(|| "deveco_auth_unsupported".to_string())?;
    Ok(arguments[..index].to_vec())
}

#[tauri::command]
pub async fn deveco_account_status(
    state: State<'_, AppState>,
    request: DevecoAccountRequest,
) -> Result<DevEcoAccountSnapshot, String> {
    let DevecoAccountRequest {} = request;
    match account_service(&state).await? {
        Some(service) => service.status().await,
        None => Ok(DevEcoAccountSnapshot {
            available: false,
            credential_present: None,
            login: None,
        }),
    }
}

#[tauri::command]
pub async fn deveco_account_start_login(
    state: State<'_, AppState>,
    request: DevecoAccountRequest,
) -> Result<DevEcoAccountSnapshot, String> {
    let DevecoAccountRequest {} = request;
    account_service(&state)
        .await?
        .ok_or_else(|| "deveco_auth_unavailable".to_string())?
        .start_login()
        .await
}

#[tauri::command]
pub async fn deveco_account_cancel_login(
    state: State<'_, AppState>,
    request: DevecoAccountCancelRequest,
) -> Result<DevEcoAccountSnapshot, String> {
    account_service(&state)
        .await?
        .ok_or_else(|| "deveco_auth_unavailable".to_string())?
        .cancel_login(&request.session_id)
        .await
}

#[tauri::command]
pub async fn deveco_account_logout(
    state: State<'_, AppState>,
    request: DevecoAccountRequest,
) -> Result<DevEcoAccountSnapshot, String> {
    let DevecoAccountRequest {} = request;
    account_service(&state)
        .await?
        .ok_or_else(|| "deveco_auth_unavailable".to_string())?
        .logout()
        .await
}

pub(crate) fn shutdown_now() {
    let mut host = account_host();
    host.closed = true;
    if let Some(managed) = host.managed.take() {
        managed.service.shutdown_now();
    }
}

#[cfg(test)]
mod tests {
    use super::management_prefix_arguments;

    #[test]
    fn preserves_native_and_node_launch_prefixes_but_rejects_opaque_wrappers() {
        assert_eq!(
            management_prefix_arguments(&["acp".to_string()]).unwrap(),
            Vec::<String>::new()
        );
        assert_eq!(
            management_prefix_arguments(&["/runtime/deveco.js".to_string(), "acp".to_string()])
                .unwrap(),
            vec!["/runtime/deveco.js".to_string()]
        );
        assert_eq!(
            management_prefix_arguments(&["-c".to_string(), "deveco acp".to_string()]).unwrap_err(),
            "deveco_auth_unsupported"
        );
        assert!(management_prefix_arguments(&[]).is_err());
    }
}
