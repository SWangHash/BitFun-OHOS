//! Data transfer objects for the OpenHarmony Matrix skill market API.
//!
//! All structs use `#[serde(rename_all = "camelCase")]` (Matrix's wire format
//! is camelCase JSON) and `#[serde(default)]` at the struct level so unknown
//! or missing fields are tolerated instead of failing the whole response
//! (per `spec/matrix-skill-market/spec.md` Edge Cases and FR-010).

use serde::{Deserialize, Serialize};

/// Generic Matrix API response envelope.
///
/// Matrix returns `{ "code": "20000", "message": "...", "data": <T> }` for all
/// successful JSON endpoints. `code == "20000"` indicates success; any other
/// code is a business error (see `MatrixApiErrorKind::MatrixBusiness`).
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixEnvelope<T> {
    pub code: String,
    pub message: String,
    pub data: T,
}

/// Helper struct for the `GET /api/model_base/model/tags?serviceType=skill`
/// endpoint. Only the `skill` field is parsed; other serviceType fields
/// (`registry`, `agent`, `model`, `datatest`) are silently ignored by serde.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixTagsData {
    pub skill: Vec<MatrixTag>,
}

/// Matrix platform skill tag.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixTag {
    pub id: String,
    pub service_type: String,
    pub name: String,
    pub en_name: String,
    #[serde(default)]
    pub r#type: Option<String>,
    pub create_time: Option<String>,
    pub update_time: Option<String>,
    pub linked: Option<bool>,
}

/// Matrix skill owner.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixSkillOwner {
    pub id: Option<String>,
    pub user_id: Option<String>,
    pub source: Option<String>,
    pub account: Option<String>,
    pub en_name: Option<String>,
    pub cn_name: Option<String>,
    pub image: Option<String>,
}

/// Matrix skill organization.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixSkillOrganization {
    pub id: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    pub name: Option<String>,
    pub en_name: Option<String>,
    pub image: Option<String>,
    pub description: Option<String>,
    pub link: Option<String>,
    pub source: Option<String>,
    pub creator: Option<String>,
    pub status: Option<String>,
}

/// Matrix skill category.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixSkillCategory {
    pub id: Option<String>,
    pub module_type: Option<String>,
    pub en_name: Option<String>,
    pub cn_name: Option<String>,
    pub en_description: Option<String>,
    pub cn_description: Option<String>,
    pub sort_order: Option<u32>,
}

/// Matrix skill summary (single element of `MatrixSkillsPage.list`).
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixSkillSummary {
    pub id: String,
    pub name: String,
    pub en_name: String,
    pub owner: Option<MatrixSkillOwner>,
    pub category_list: Option<Vec<MatrixSkillCategory>>,
    pub org_id: Option<String>,
    pub tag_ids: Option<Vec<String>>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub repository: Option<String>,
    pub download: Option<u64>,
    pub view: Option<u64>,
    pub favor: Option<u64>,
    pub zip_sha256: Option<String>,
    pub zip_obs_size: Option<u64>,
    pub zip_obs_create_time: Option<String>,
    pub latest_version: Option<String>,
    pub version_count: Option<u32>,
    pub is_featured: Option<bool>,
    pub tags: Option<Vec<MatrixTag>>,
    pub organization: Option<MatrixSkillOrganization>,
    pub source_url: Option<String>,
    pub status: Option<u32>,
}

/// Paginated Matrix skill list response (`data` field of the envelope for
/// `POST /api/registry/skill/skills`).
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixSkillsPage {
    pub count: u64,
    pub list: Vec<MatrixSkillSummary>,
}

/// Matrix skill checksum (`data` field of the envelope for
/// `GET /api/registry/skill/{enName}/checksum`).
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixSkillChecksum {
    pub en_name: String,
    pub sha256: String,
    pub size: u64,
    pub create_time: Option<String>,
}

/// Client-side request body for `POST /api/registry/skill/skills`.
///
/// Serializes to the JSON body expected by Matrix (camelCase keys).
/// `pageNum` and `pageSize` are strings per Matrix's wire contract.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixSkillsListRequest {
    pub page_num: String,
    pub page_size: String,
    pub keyword: Option<String>,
    pub category_id: Option<String>,
    pub org_id: Option<String>,
    pub tag_ids: Option<Vec<String>>,
}

/// Result returned by `install_skill` and the `install_matrix_skill` Tauri
/// command. Carries the verified install metadata back to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatrixSkillInstallResult {
    pub en_name: String,
    pub version: Option<String>,
    pub install_path: String,
    pub sha256: String,
    pub size: u64,
    pub source_id: String,
    pub skill_md_present: bool,
}
