//! `GET /api/model_base/model/tags?serviceType=...` — Matrix platform tag list.
//!
//! Used to browse the Matrix skill taxonomy (HMOS / DevEco / ArkUI / ArkTS /
//! OpenHarmony / DFX / Flutter, etc.). Only the `skill` array of the
//! response's `data` object is parsed; other serviceType fields
//! (`registry`, `agent`, `model`, `datatest`) are silently ignored via
//! `#[serde(default)]` so callers can pass `serviceType=agent` or
//! `serviceType=model` without parse errors (per `spec.md` US1 acceptance
//! scenario 3).

use crate::client::{MatrixHttpClient, DEFAULT_JSON_RESPONSE_MAX_BYTES};
use crate::error::MatrixApiError;
use crate::models::{MatrixEnvelope, MatrixTag, MatrixTagsData};

/// Fetch the list of Matrix tags for the given `service_type`.
///
/// Calls `GET {base}/api/model_base/model/tags?serviceType={service_type}`.
/// On success, returns the `data.skill` array (other serviceType fields are
/// ignored). Returns a `MatrixBusiness` error if the response `code` is not
/// `"20000"`.
pub async fn list_tags(
    client: &MatrixHttpClient,
    service_type: &str,
) -> Result<Vec<MatrixTag>, MatrixApiError> {
    let encoded = urlencoding::encode(service_type);
    let url = client.url(&format!(
        "api/model_base/model/tags?serviceType={}",
        encoded
    ));
    let text = client
        .send_get_text_bounded(&url, DEFAULT_JSON_RESPONSE_MAX_BYTES)
        .await?;
    let envelope: MatrixEnvelope<MatrixTagsData> =
        serde_json::from_str(&text).map_err(MatrixApiError::from)?;
    if envelope.code != "20000" {
        return Err(MatrixApiError::business(envelope.code, envelope.message));
    }
    Ok(envelope.data.skill)
}
