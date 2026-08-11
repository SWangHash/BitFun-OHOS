//! Tauri commands for the OpenHarmony Matrix skill market.
//!
//! These commands wrap the independent `bitfun-matrix-adapter` crate so the
//! frontend can invoke Matrix market operations (`list_matrix_tags`,
//! `list_matrix_skills`, `install_matrix_skill`,
//! `check_matrix_skill_checksum`) via the standard Tauri `invoke` bridge.
//!
//! Design notes:
//! - Commands construct a fresh `MatrixHttpClient` per invocation. The client
//!   is cheap to build (an `Arc`-backed `reqwest::Client`) and stateless.
//! - Errors are typed (`MatrixApiError`) and implement `serde::Serialize` so
//!   Tauri can return them directly to the frontend catch handler.
//! - These commands are intentionally separate from `skill_api.rs` (which owns
//!   the legacy skills.sh integration) per `spec.md` FR-008 (code
//!   independence).
//! - Remote-workspace policy: `LocalOnly` for all four commands (Matrix
//!   download and install require local filesystem access to
//!   `~/.bitfun/skills/matrix/`).

use tauri::State;

use crate::api::AppState;
use bitfun_matrix_adapter::{
    check_checksum, install_skill, list_skills, list_tags, MatrixApiError, MatrixHttpClient,
    MatrixSkillChecksum, MatrixSkillInstallResult, MatrixSkillsListRequest, MatrixSkillsPage,
    MatrixTag,
};

/// Browse Matrix platform skill tags.
///
/// Wraps `bitfun_matrix_adapter::list_tags` with `serviceType=skill` by
/// default. The frontend can pass `serviceType=agent`/`model`/`datatest` to
/// browse other taxonomies; only the `skill` array is parsed in any case.
#[tauri::command]
pub async fn list_matrix_tags(
    _app_state: State<'_, AppState>,
    service_type: Option<String>,
) -> Result<Vec<MatrixTag>, MatrixApiError> {
    let client = MatrixHttpClient::new()?;
    let resolved_service_type = service_type
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "skill".to_string());
    list_tags(&client, &resolved_service_type).await
}

/// Paginate-query the Matrix skill list.
///
/// Wraps `bitfun_matrix_adapter::list_skills` with the
/// `MatrixSkillsListRequest` body (pageNum / pageSize / keyword / categoryId
/// / orgId / tagIds). Returns a `MatrixSkillsPage` containing `count` and
/// `list`.
#[tauri::command]
pub async fn list_matrix_skills(
    _app_state: State<'_, AppState>,
    request: MatrixSkillsListRequest,
) -> Result<MatrixSkillsPage, MatrixApiError> {
    let client = MatrixHttpClient::new()?;
    list_skills(&client, &request).await
}

/// Download, verify, and install a Matrix skill by `en_name`.
///
/// Wraps `bitfun_matrix_adapter::install_skill`. The full flow:
/// download ZIP → fetch SHA-256 → verify → unzip to staging dir with path
/// traversal guard → atomic rename to `~/.bitfun/skills/matrix/<en_name>/`.
/// Returns a `MatrixSkillInstallResult` on success. Staging directories are
/// cleaned up on any error path.
#[tauri::command]
pub async fn install_matrix_skill(
    _app_state: State<'_, AppState>,
    en_name: String,
) -> Result<MatrixSkillInstallResult, MatrixApiError> {
    let client = MatrixHttpClient::new()?;
    let trimmed = en_name.trim().to_string();
    install_skill(&trimmed, &client).await
}

/// Fetch the latest SHA-256 for a Matrix skill (standalone).
///
/// Wraps `bitfun_matrix_adapter::check_checksum`. Useful for future
/// "check for updates" flows: the frontend can call this independently of
/// `install_matrix_skill` to compare the latest Matrix SHA-256 against a
/// previously-installed skill's hash and decide whether to re-install.
#[tauri::command]
pub async fn check_matrix_skill_checksum(
    _app_state: State<'_, AppState>,
    en_name: String,
) -> Result<MatrixSkillChecksum, MatrixApiError> {
    let client = MatrixHttpClient::new()?;
    let trimmed = en_name.trim().to_string();
    check_checksum(&client, &trimmed).await
}
