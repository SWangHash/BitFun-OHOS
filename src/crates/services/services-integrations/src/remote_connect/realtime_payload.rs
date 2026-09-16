//! Opaque bulk data lane shared by Rust Relay hosts and controllers.
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::time::Duration;

const INLINE_BYTES: usize = 128 * 1024;
const MAX_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone)]
pub(super) struct PayloadClient {
    endpoint: reqwest::Url,
    token: String,
}
impl PayloadClient {
    pub(super) fn new(base: &reqwest::Url, token: &str) -> Result<Self> {
        Ok(Self {
            endpoint: base.join("v1/rpc/payloads")?,
            token: token.into(),
        })
    }
    pub(super) async fn upload_if_large(&self, value: Value) -> Result<Value> {
        let bytes = serde_json::to_vec(&value)?;
        if bytes.len() <= INLINE_BYTES {
            return Ok(value);
        }
        if bytes.len() > MAX_BYTES {
            bail!("RPC payload exceeds a transfer block; use paginated or chunked operations");
        }
        let response = super::relay_http::relay_http_client()
            .post(self.endpoint.clone())
            .bearer_auth(&self.token)
            .header("content-type", "application/octet-stream")
            .timeout(Duration::from_secs(120))
            .body(bytes)
            .send()
            .await
            .context("RPC payload upload failed")?
            .error_for_status()
            .context("RPC payload upload rejected")?;
        let reference: Value = response.json().await?;
        validate_reference(&reference)?;
        Ok(reference)
    }
    pub(super) async fn resolve(&self, value: Value) -> Result<Value> {
        if value.get("$relayPayload").is_none() {
            return Ok(value);
        }
        let (id, expected) = validate_reference(&value)?;
        let mut endpoint = self.endpoint.clone();
        endpoint
            .path_segments_mut()
            .map_err(|_| anyhow::anyhow!("Invalid Relay endpoint"))?
            .push(id);
        let mut response = super::relay_http::relay_http_client()
            .get(endpoint)
            .bearer_auth(&self.token)
            .timeout(Duration::from_secs(120))
            .send()
            .await
            .context("RPC payload download failed")?
            .error_for_status()
            .context("RPC payload download rejected")?;
        if response
            .content_length()
            .is_some_and(|size| size != expected as u64)
        {
            bail!("Relay payload length mismatch");
        }
        let mut bytes = Vec::with_capacity(expected.min(INLINE_BYTES));
        while let Some(chunk) = response.chunk().await? {
            if chunk.len() > expected.saturating_sub(bytes.len()) {
                bail!("Relay payload length mismatch");
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.len() != expected {
            bail!("Incomplete Relay payload transfer");
        }
        Ok(serde_json::from_slice(&bytes)?)
    }
}

fn validate_reference(value: &Value) -> Result<(&str, usize)> {
    let reference = &value["$relayPayload"];
    let id = reference["id"]
        .as_str()
        .filter(|id| uuid::Uuid::parse_str(id).is_ok())
        .ok_or_else(|| anyhow::anyhow!("Invalid Relay payload id"))?;
    let size = reference["bytes"]
        .as_u64()
        .filter(|size| *size > 0 && *size <= MAX_BYTES as u64)
        .ok_or_else(|| anyhow::anyhow!("Invalid Relay payload size"))?;
    Ok((id, size as usize))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn references_cannot_select_a_url_or_escape_payload_route() {
        for id in [
            "../../account",
            "https://example.com/secret",
            "?token=x",
            "",
        ] {
            assert!(validate_reference(&json!({"$relayPayload":{"id":id,"bytes":1}})).is_err());
        }
        let id = uuid::Uuid::new_v4().to_string();
        assert!(
            validate_reference(&json!({"$relayPayload":{"id":id,"bytes":MAX_BYTES+1}})).is_err()
        );
        assert!(validate_reference(&json!({"$relayPayload":{"id":id,"bytes":10}})).is_ok());
    }
}
