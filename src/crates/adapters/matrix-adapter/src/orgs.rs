//! `POST /api/registry/skill/org/list` — Matrix skill organization sidebar.
//!
//! Returns the universe of skill-owning organizations with per-org skill
//! counts, used to drive the "按组织" (by organization) browse section. The
//! response `data.list` is an array of `{id, name, enName, count}`.

use crate::client::MatrixHttpClient;
use crate::error::MatrixApiError;
use crate::models::{MatrixEnvelope, MatrixOrgSidebarPage, MatrixOrgSidebarRequest};

/// Fetch the list of Matrix skill organizations with counts.
///
/// Calls `POST {base}/api/registry/skill/org/list` with the JSON body
/// described by `MatrixOrgSidebarRequest` (keyword / pageNum / pageSize).
/// Returns the `data` field of the envelope as a `MatrixOrgSidebarPage`.
/// Returns a `MatrixBusiness` error if the response `code` is not `"20000"`.
pub async fn list_organizations(
    client: &MatrixHttpClient,
    req: &MatrixOrgSidebarRequest,
) -> Result<MatrixOrgSidebarPage, MatrixApiError> {
    log::info!(
        "Matrix list_organizations: keyword={:?}, page_num={:?}, page_size={:?}, base_url={}",
        req.keyword,
        req.page_num,
        req.page_size,
        client.base_url()
    );
    let url = client.url("api/registry/skill/org/list");
    let value = client.send_post_json_bounded(&url, req).await?;
    let envelope: MatrixEnvelope<MatrixOrgSidebarPage> =
        serde_json::from_value(value).map_err(|error| {
            log::error!("Matrix list_organizations parse error: error={}", error);
            MatrixApiError::from(error)
        })?;
    if envelope.code != "20000" {
        log::error!(
            "Matrix list_organizations business error: code={}, message={}",
            envelope.code,
            envelope.message
        );
        return Err(MatrixApiError::business(envelope.code, envelope.message));
    }
    log::info!(
        "Matrix list_organizations success: count={}",
        envelope.data.list.len()
    );
    Ok(envelope.data)
}
