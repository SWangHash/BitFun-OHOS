//! `POST /api/registry/skill/skills` — paginated Matrix skill list query.
//!
//! Used to browse the Matrix skill catalog with pagination, keyword search,
//! and tag/category/org filtering. Returns a `MatrixSkillsPage` containing
//! `count` and `list: Vec<MatrixSkillSummary>`.

use crate::client::MatrixHttpClient;
use crate::error::MatrixApiError;
use crate::models::{MatrixEnvelope, MatrixSkillsListRequest, MatrixSkillsPage};

/// Fetch a paginated list of Matrix skills.
///
/// Calls `POST {base}/api/registry/skill/skills` with the JSON body described
/// by `MatrixSkillsListRequest` (pageNum / pageSize / keyword / categoryId /
/// orgId / tagIds). Returns the `data` field of the envelope as a
/// `MatrixSkillsPage`. Returns a `MatrixBusiness` error if the response
/// `code` is not `"20000"`.
pub async fn list_skills(
    client: &MatrixHttpClient,
    req: &MatrixSkillsListRequest,
) -> Result<MatrixSkillsPage, MatrixApiError> {
    let url = client.url("api/registry/skill/skills");
    let value = client.send_post_json_bounded(&url, req).await?;
    let envelope: MatrixEnvelope<MatrixSkillsPage> =
        serde_json::from_value(value).map_err(MatrixApiError::from)?;
    if envelope.code != "20000" {
        return Err(MatrixApiError::business(envelope.code, envelope.message));
    }
    Ok(envelope.data)
}
