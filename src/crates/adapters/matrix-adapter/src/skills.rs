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
    log::info!(
        "Matrix list_skills: page_num={}, page_size={}, keyword={:?}, tag_ids={:?}, base_url={}",
        req.page_num,
        req.page_size,
        req.keyword,
        req.tag_ids,
        client.base_url()
    );
    let url = client.url("api/registry/skill/skills");
    let value = client.send_post_json_bounded(&url, req).await?;
    let envelope: MatrixEnvelope<MatrixSkillsPage> =
        serde_json::from_value(value).map_err(|error| {
            log::error!(
                "Matrix list_skills parse error: page_num={}, error={}",
                req.page_num,
                error
            );
            MatrixApiError::from(error)
        })?;
    if envelope.code != "20000" {
        log::error!(
            "Matrix list_skills business error: page_num={}, code={}, message={}",
            req.page_num,
            envelope.code,
            envelope.message
        );
        return Err(MatrixApiError::business(envelope.code, envelope.message));
    }
    log::info!(
        "Matrix list_skills success: page_num={}, count={}, returned={}",
        req.page_num,
        envelope.data.count,
        envelope.data.list.len()
    );
    Ok(envelope.data)
}
