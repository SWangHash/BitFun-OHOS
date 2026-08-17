//! Data transfer objects for the OpenHarmony Matrix skill market API.
//!
//! All structs use `#[serde(rename_all = "camelCase")]` (Matrix's wire format
//! is camelCase JSON) and `#[serde(default)]` at the struct level so unknown
//! or missing fields are tolerated instead of failing the whole response
//! (per `spec/matrix-skill-market/spec.md` Edge Cases and FR-010).

use serde::{Deserialize, Serialize};
use serde::de::{Deserializer, Error};

/// Custom deserializer that accepts both a JSON number and a JSON string
/// containing a number. The Matrix API is inconsistent: some fields
/// (e.g. `count`, `download`, `view`, `favor`, `zipObsSize`, `size`) may be
/// returned as strings like `"114688"` or as numbers like `114688` depending
/// on the endpoint and value magnitude. This helper makes the DTOs resilient
/// to both wire formats.
pub fn deserialize_u64_from_string_or_number<'de, D>(deserializer: D) -> Result<u64, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    if let Some(n) = value.as_u64() {
        Ok(n)
    } else if let Some(s) = value.as_str() {
        s.parse::<u64>()
            .map_err(|e| Error::custom(format!("invalid u64 string '{}': {}", s, e)))
    } else if let Some(f) = value.as_f64() {
        Ok(f as u64)
    } else if value.is_null() {
        Ok(0)
    } else {
        Err(Error::custom(format!(
            "expected u64 or numeric string, got: {}",
            value
        )))
    }
}

/// Custom deserializer for `Option<u64>` fields that accepts both numbers
/// and strings. Returns `None` for JSON `null` or missing fields.
pub fn deserialize_optional_u64_from_string_or_number<'de, D>(
    deserializer: D,
) -> Result<Option<u64>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt = Option::<serde_json::Value>::deserialize(deserializer)?;
    match opt {
        None => Ok(None),
        Some(value) if value.is_null() => Ok(None),
        Some(value) => {
            if let Some(n) = value.as_u64() {
                Ok(Some(n))
            } else if let Some(s) = value.as_str() {
                s.parse::<u64>()
                    .map(Some)
                    .map_err(|e| Error::custom(format!("invalid u64 string '{}': {}", s, e)))
            } else if let Some(f) = value.as_f64() {
                Ok(Some(f as u64))
            } else {
                Err(Error::custom(format!(
                    "expected u64 or numeric string, got: {}",
                    value
                )))
            }
        }
    }
}

/// Custom deserializer for `Option<u32>` fields that accepts both numbers
/// and strings.
pub fn deserialize_optional_u32_from_string_or_number<'de, D>(
    deserializer: D,
) -> Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    let opt = Option::<serde_json::Value>::deserialize(deserializer)?;
    match opt {
        None => Ok(None),
        Some(value) if value.is_null() => Ok(None),
        Some(value) => {
            if let Some(n) = value.as_u64() {
                Ok(Some(n as u32))
            } else if let Some(s) = value.as_str() {
                s.parse::<u32>()
                    .map(Some)
                    .map_err(|e| Error::custom(format!("invalid u32 string '{}': {}", s, e)))
            } else if let Some(f) = value.as_f64() {
                Ok(Some(f as u32))
            } else {
                Err(Error::custom(format!(
                    "expected u32 or numeric string, got: {}",
                    value
                )))
            }
        }
    }
}

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
    #[serde(default, deserialize_with = "deserialize_optional_u32_from_string_or_number")]
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
    #[serde(default, deserialize_with = "deserialize_optional_u64_from_string_or_number")]
    pub download: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64_from_string_or_number")]
    pub view: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u64_from_string_or_number")]
    pub favor: Option<u64>,
    pub zip_sha256: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_u64_from_string_or_number")]
    pub zip_obs_size: Option<u64>,
    pub zip_obs_create_time: Option<String>,
    pub latest_version: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_u32_from_string_or_number")]
    pub version_count: Option<u32>,
    pub is_featured: Option<bool>,
    pub tags: Option<Vec<MatrixTag>>,
    pub organization: Option<MatrixSkillOrganization>,
    pub source_url: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_u32_from_string_or_number")]
    pub status: Option<u32>,
}

/// Paginated Matrix skill list response (`data` field of the envelope for
/// `POST /api/registry/skill/skills`).
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixSkillsPage {
    #[serde(deserialize_with = "deserialize_u64_from_string_or_number")]
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
    #[serde(deserialize_with = "deserialize_u64_from_string_or_number")]
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
    /// Filter to featured skills only (the "精品集" browse section). Omitted
    /// from the serialized body when `None` so the Matrix API treats it as
    /// no filter, matching the website's `delete o.isFeatured` behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_featured: Option<bool>,
}

/// Sidebar facet item returned by the Matrix "count by facet" endpoints
/// (`countByScenario` / `countByTag` / `org/list`). Carries the facet `id`,
/// localized display names, and the skill `count` for that facet. `count` may
/// arrive as either a JSON number or a numeric string (see
/// [`deserialize_optional_u64_from_string_or_number`]).
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixSidebarItem {
    pub id: String,
    pub name: Option<String>,
    pub en_name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_u64_from_string_or_number")]
    pub count: Option<u64>,
}

/// Sidebar category item returned by `POST /api/registry/skill/countByCategory`.
/// Categories use `cnName` (the localized Chinese name) for display instead of
/// `name`, plus an optional `sortOrder` for stable ordering.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixCategoryItem {
    pub id: String,
    pub cn_name: Option<String>,
    pub en_name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_u64_from_string_or_number")]
    pub count: Option<u64>,
    #[serde(default, deserialize_with = "deserialize_optional_u32_from_string_or_number")]
    pub sort_order: Option<u32>,
}

/// Paginated organization sidebar page (`data` field of the envelope for
/// `POST /api/registry/skill/org/list`).
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixOrgSidebarPage {
    pub list: Vec<MatrixSidebarItem>,
}

/// Client-side request body for `POST /api/registry/skill/org/list`.
///
/// `pageNum` and `pageSize` are numbers on the wire (unlike the skills list
/// endpoint which uses strings) to match the Matrix org/list contract. All
/// fields are optional and omitted when `None`.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct MatrixOrgSidebarRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keyword: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_num: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_size: Option<u32>,
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
