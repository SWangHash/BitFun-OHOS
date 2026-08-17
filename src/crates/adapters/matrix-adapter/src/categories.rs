//! `POST /api/registry/skill/countByCategory` — Matrix skill category sidebar.
//!
//! Returns the universe of skill categories with per-category skill counts,
//! used to drive the "按分类" (by category) browse section. Each item carries
//! `id`, `cnName`, `enName`, `count`, and an optional `sortOrder`.

use crate::client::MatrixHttpClient;
use crate::error::MatrixApiError;
use crate::models::{MatrixCategoryItem, MatrixEnvelope};

/// Fetch the list of Matrix skill categories with counts.
///
/// Calls `POST {base}/api/registry/skill/countByCategory` with an empty JSON
/// body `{}`. Returns the `data` field of the envelope as a
/// `Vec<MatrixCategoryItem>`. Returns a `MatrixBusiness` error if the response
/// `code` is not `"20000"`.
pub async fn list_categories(
    client: &MatrixHttpClient,
) -> Result<Vec<MatrixCategoryItem>, MatrixApiError> {
    log::info!("Matrix list_categories: base_url={}", client.base_url());
    let url = client.url("api/registry/skill/countByCategory");
    let body = serde_json::json!({});
    let value = client.send_post_json_bounded(&url, &body).await?;
    let envelope: MatrixEnvelope<Vec<MatrixCategoryItem>> =
        serde_json::from_value(value).map_err(|error| {
            log::error!("Matrix list_categories parse error: error={}", error);
            MatrixApiError::from(error)
        })?;
    if envelope.code != "20000" {
        log::error!(
            "Matrix list_categories business error: code={}, message={}",
            envelope.code,
            envelope.message
        );
        return Err(MatrixApiError::business(envelope.code, envelope.message));
    }
    log::info!(
        "Matrix list_categories success: count={}",
        envelope.data.len()
    );
    Ok(envelope.data)
}
