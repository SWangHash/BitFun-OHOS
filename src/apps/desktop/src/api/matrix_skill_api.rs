//! Tauri commands for the OpenHarmony Matrix skill market.
//!
//! These commands wrap the independent `bitfun-matrix-adapter` crate so the
//! frontend can invoke Matrix market operations (`list_matrix_tags`,
//! `list_matrix_skills`, `list_matrix_categories`, `list_matrix_organizations`,
//! `install_matrix_skill`, `check_matrix_skill_checksum`) via the standard
//! Tauri `invoke` bridge.
//!
//! Design notes:
//! - Commands construct a fresh `MatrixHttpClient` per invocation. The client
//!   is cheap to build (an `Arc`-backed `reqwest::Client`) and stateless.
//! - Errors are typed (`MatrixApiError`) and implement `serde::Serialize` so
//!   Tauri can return them directly to the frontend catch handler.
//! - These commands are intentionally separate from `skill_api.rs` (which owns
//!   the legacy skills.sh integration) per `spec.md` FR-008 (code
//!   independence).
//! - Remote-workspace policy: `LocalOnly` for all six commands (Matrix
//!   download and install require local filesystem access to
//!   `~/.bitfun/skills/matrix/`; the browse commands are co-located for
//!   policy simplicity and because they only matter for local install).

use tauri::State;

use crate::api::AppState;
use bitfun_core::agentic::tools::implementations::skills::SkillLocation;
use bitfun_core::service::remote_ssh::workspace_state::is_remote_path;
use bitfun_matrix_adapter::{
    check_checksum, install_skill_to_root, list_categories, list_organizations, list_skills,
    list_tags, resolve_matrix_skills_root, MatrixApiError, MatrixApiErrorKind, MatrixCategoryItem,
    MatrixHttpClient, MatrixOrgSidebarPage, MatrixOrgSidebarRequest, MatrixSkillChecksum,
    MatrixSkillInstallResult, MatrixSkillsListRequest, MatrixSkillsPage, MatrixTag,
};
use std::path::PathBuf;

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
    log::info!(
        "Tauri list_matrix_tags invoked: service_type={}",
        resolved_service_type
    );
    let result = list_tags(&client, &resolved_service_type).await;
    match &result {
        Ok(tags) => log::info!(
            "Tauri list_matrix_tags ok: service_type={}, count={}",
            resolved_service_type,
            tags.len()
        ),
        Err(error) => log::error!(
            "Tauri list_matrix_tags failed: service_type={}, error={:?}",
            resolved_service_type,
            error
        ),
    }
    result
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
    log::info!(
        "Tauri list_matrix_skills invoked: page_num={}, page_size={}",
        request.page_num,
        request.page_size
    );
    let result = list_skills(&client, &request).await;
    match &result {
        Ok(page) => log::info!(
            "Tauri list_matrix_skills ok: page_num={}, count={}, returned={}",
            request.page_num,
            page.count,
            page.list.len()
        ),
        Err(error) => log::error!(
            "Tauri list_matrix_skills failed: page_num={}, error={:?}",
            request.page_num,
            error
        ),
    }
    result
}

/// Browse Matrix skill categories with counts (sidebar for "按分类").
///
/// Wraps `bitfun_matrix_adapter::list_categories`, which calls
/// `POST /api/registry/skill/countByCategory` with an empty body. Returns the
/// category list used to populate the "by category" browse section chips.
#[tauri::command]
pub async fn list_matrix_categories(
    _app_state: State<'_, AppState>,
) -> Result<Vec<MatrixCategoryItem>, MatrixApiError> {
    let client = MatrixHttpClient::new()?;
    log::info!("Tauri list_matrix_categories invoked");
    let result = list_categories(&client).await;
    match &result {
        Ok(items) => log::info!(
            "Tauri list_matrix_categories ok: count={}",
            items.len()
        ),
        Err(error) => log::error!(
            "Tauri list_matrix_categories failed: error={:?}",
            error
        ),
    }
    result
}

/// Browse Matrix skill organizations with counts (sidebar for "按组织").
///
/// Wraps `bitfun_matrix_adapter::list_organizations`, which calls
/// `POST /api/registry/skill/org/list`. The frontend passes an optional
/// `MatrixOrgSidebarRequest` (keyword / pageNum / pageSize); when omitted or
/// incomplete, `pageNum=1` and `pageSize=1000` defaults are applied so the
/// full organization universe is fetched in one request. Returns the
/// organization list page used to populate the "by organization" browse
/// section chips.
#[tauri::command]
pub async fn list_matrix_organizations(
    _app_state: State<'_, AppState>,
    request: Option<MatrixOrgSidebarRequest>,
) -> Result<MatrixOrgSidebarPage, MatrixApiError> {
    let client = MatrixHttpClient::new()?;
    let mut req = request.unwrap_or_default();
    if req.page_num.is_none() {
        req.page_num = Some(1);
    }
    if req.page_size.is_none() {
        req.page_size = Some(1000);
    }
    log::info!(
        "Tauri list_matrix_organizations invoked: keyword={:?}, page_num={:?}, page_size={:?}",
        req.keyword,
        req.page_num,
        req.page_size
    );
    let result = list_organizations(&client, &req).await;
    match &result {
        Ok(page) => log::info!(
            "Tauri list_matrix_organizations ok: count={}",
            page.list.len()
        ),
        Err(error) => log::error!(
            "Tauri list_matrix_organizations failed: error={:?}",
            error
        ),
    }
    result
}

/// Download, verify, and install a Matrix skill by `en_name`.
///
/// Wraps `bitfun_matrix_adapter::install_skill_to_root`. The full flow:
/// download ZIP → fetch SHA-256 → verify → unzip to staging dir with path
/// traversal guard → atomic rename to `<install_root>/<en_name>/`. Returns a
/// `MatrixSkillInstallResult` on success. Staging directories are cleaned up
/// on any error path.
///
/// Install scope:
/// - `level = "user"` (default): install to `~/.bitfun/skills/matrix/<en_name>/`.
/// - `level = "project"`: install to `<workspace>/.bitfun/skills/matrix/<en_name>/`.
///   Requires `workspace_path`; project-level install into remote workspaces is
///   rejected (use user-level instead).
#[tauri::command]
pub async fn install_matrix_skill(
    _app_state: State<'_, AppState>,
    en_name: String,
    level: Option<SkillLocation>,
    workspace_path: Option<String>,
) -> Result<MatrixSkillInstallResult, MatrixApiError> {
    let client = MatrixHttpClient::new()?;
    let trimmed = en_name.trim().to_string();
    let resolved_level = level.unwrap_or(SkillLocation::User);
    log::info!(
        "Tauri install_matrix_skill invoked: en_name={}, level={}",
        trimmed,
        resolved_level.as_str()
    );

    let install_root = match resolved_level {
        SkillLocation::User => resolve_matrix_skills_root()?,
        SkillLocation::Project => {
            let workspace = workspace_path
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    MatrixApiError::new(
                        MatrixApiErrorKind::RuntimeUnavailable,
                        "No workspace open, cannot add project-level Matrix skill",
                    )
                })?;
            if is_remote_path(&workspace).await {
                return Err(MatrixApiError::new(
                    MatrixApiErrorKind::RuntimeUnavailable,
                    "Downloading project-level Matrix skills into remote workspaces is not supported",
                ));
            }
            PathBuf::from(workspace)
                .join(".bitfun")
                .join("skills")
                .join("matrix")
        }
    };

    let result = install_skill_to_root(&trimmed, &client, &install_root).await;
    match &result {
        Ok(r) => log::info!(
            "Tauri install_matrix_skill ok: en_name={}, path={}, size={}, level={}",
            r.en_name,
            r.install_path,
            r.size,
            resolved_level.as_str()
        ),
        Err(error) => log::error!(
            "Tauri install_matrix_skill failed: en_name={}, level={}, error={:?}",
            trimmed,
            resolved_level.as_str(),
            error
        ),
    }
    result
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
    log::info!(
        "Tauri check_matrix_skill_checksum invoked: en_name={}",
        trimmed
    );
    let result = check_checksum(&client, &trimmed).await;
    match &result {
        Ok(c) => log::info!(
            "Tauri check_matrix_skill_checksum ok: en_name={}, size={}, sha256={}",
            c.en_name,
            c.size,
            c.sha256
        ),
        Err(error) => log::error!(
            "Tauri check_matrix_skill_checksum failed: en_name={}, error={:?}",
            trimmed,
            error
        ),
    }
    result
}
