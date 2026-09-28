//! Explicit OHOS fallbacks for desktop staged-update commands.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdateRequest {}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DownloadUpdateRequest {
    #[serde(default)]
    pub expected_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallPendingUpdateRequest {
    pub version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUpdateResponse {
    pub version: String,
}

#[tauri::command]
pub async fn get_pending_update(
    request: PendingUpdateRequest,
) -> Result<Option<PendingUpdateResponse>, String> {
    let _ = request;
    Ok(None)
}

#[tauri::command]
pub async fn download_update(
    request: DownloadUpdateRequest,
) -> Result<PendingUpdateResponse, String> {
    let _ = request;
    Err("Application updates are handled by the OHOS system update flow".to_string())
}

#[tauri::command]
pub async fn install_pending_update(request: InstallPendingUpdateRequest) -> Result<(), String> {
    let _ = request;
    Err("Application updates are handled by the OHOS system update flow".to_string())
}
