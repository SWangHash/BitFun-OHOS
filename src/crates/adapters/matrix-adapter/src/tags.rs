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
    log::info!(
        "Matrix list_tags: service_type={}, base_url={}",
        service_type,
        client.base_url()
    );
    let encoded = urlencoding::encode(service_type);
    let url = client.url(&format!(
        "api/model_base/model/tags?serviceType={}",
        encoded
    ));
    let text = client
        .send_get_text_bounded(&url, DEFAULT_JSON_RESPONSE_MAX_BYTES)
        .await?;
    let envelope: MatrixEnvelope<MatrixTagsData> =
        serde_json::from_str(&text).map_err(|error| {
            log::error!(
                "Matrix list_tags parse error: service_type={}, error={}",
                service_type,
                error
            );
            MatrixApiError::from(error)
        })?;
    if envelope.code != "20000" {
        log::error!(
            "Matrix list_tags business error: service_type={}, code={}, message={}",
            service_type,
            envelope.code,
            envelope.message
        );
        return Err(MatrixApiError::business(envelope.code, envelope.message));
    }
    log::info!(
        "Matrix list_tags success: service_type={}, count={}",
        service_type,
        envelope.data.skill.len()
    );
    Ok(envelope.data.skill)
}
