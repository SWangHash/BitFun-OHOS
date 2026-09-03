//! `GET /api/registry/skill/{enName}/checksum` — fetch the latest SHA-256
//! for a Matrix skill.
//!
//! Used both internally by `install_skill` (to verify the downloaded ZIP) and
//! exposed standalone via the `check_matrix_skill_checksum` Tauri command for
//! future "check for updates" flows (per `spec.md` User Story 4).

use crate::client::{MatrixHttpClient, DEFAULT_JSON_RESPONSE_MAX_BYTES};
use crate::error::MatrixApiError;
use crate::models::{MatrixEnvelope, MatrixSkillChecksum};

/// Fetch the latest SHA-256 checksum for a Matrix skill.
///
/// Calls `GET {base}/api/registry/skill/{url_encoded_en_name}/checksum`.
/// Returns the `data` field of the envelope as a `MatrixSkillChecksum`
/// containing `sha256` (64-char hex) and `size` (bytes). Returns a
/// `MatrixBusiness` error if the response `code` is not `"20000"`.
///
/// Per the Matrix documentation note (see `spec.md` US4 acceptance scenario
/// 3): the SHA-256 may be updated in real time, so callers should fetch it
/// **after** downloading the ZIP binary to ensure a correct comparison.
pub async fn check_checksum(
    client: &MatrixHttpClient,
    en_name: &str,
) -> Result<MatrixSkillChecksum, MatrixApiError> {
    log::info!("Matrix check_checksum: en_name={}", en_name);
    let encoded = urlencoding::encode(en_name);
    let url = client.url(&format!("api/registry/skill/{}/checksum", encoded));
    let text = client
        .send_get_text_bounded(&url, DEFAULT_JSON_RESPONSE_MAX_BYTES)
        .await?;
    let envelope: MatrixEnvelope<MatrixSkillChecksum> =
        serde_json::from_str(&text).map_err(|error| {
            log::error!(
                "Matrix check_checksum parse error: en_name={}, error={}",
                en_name,
                error
            );
            MatrixApiError::from(error)
        })?;
    if envelope.code != "20000" {
        log::error!(
            "Matrix check_checksum business error: en_name={}, code={}, message={}",
            en_name,
            envelope.code,
            envelope.message
        );
        return Err(MatrixApiError::business(envelope.code, envelope.message));
    }
    log::info!(
        "Matrix check_checksum success: en_name={}, size={}, sha256={}",
        en_name,
        envelope.data.size,
        envelope.data.sha256
    );
    Ok(envelope.data)
}
