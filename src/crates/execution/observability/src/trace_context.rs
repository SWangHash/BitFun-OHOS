use crate::SpanContext;
use serde::{Deserialize, Serialize};
use std::fmt::Write;

const ENVELOPE_VERSION: u8 = 1;
const TRACEPARENT_VERSION: &str = "00";
const BITFUN_TRACESTATE_KEY: &str = "bitfun";

/// Minimal cross-process context for authenticated BitFun peers.
///
/// There is deliberately no baggage or arbitrary business metadata field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraceContextEnvelope {
    version: u8,
    traceparent: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tracestate: Option<String>,
}

impl TraceContextEnvelope {
    pub fn from_span_context(context: SpanContext) -> Self {
        let flags = if context.is_sampled() { 1 } else { 0 };
        Self {
            version: ENVELOPE_VERSION,
            traceparent: format!(
                "{TRACEPARENT_VERSION}-{}-{}-{flags:02x}",
                encode_hex(&context.trace_id()),
                encode_hex(&context.span_id())
            ),
            tracestate: None,
        }
    }

    pub fn version(&self) -> u8 {
        self.version
    }
    pub fn traceparent(&self) -> &str {
        &self.traceparent
    }
    pub fn tracestate(&self) -> Option<&str> {
        self.tracestate.as_deref()
    }

    /// Adopt a remote parent only after the transport authenticated the source
    /// as a BitFun peer. Unknown or third-party boundaries are ignored.
    pub fn remote_parent(
        &self,
        trust: TraceContextTrust,
    ) -> Result<Option<SpanContext>, TraceContextError> {
        if trust != TraceContextTrust::AuthenticatedBitFunPeer {
            return Ok(None);
        }
        if self.version != ENVELOPE_VERSION {
            return Err(TraceContextError::UnsupportedEnvelopeVersion);
        }
        validate_tracestate(self.tracestate.as_deref())?;
        parse_traceparent(&self.traceparent).map(Some)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TraceContextTrust {
    AuthenticatedBitFunPeer,
    UntrustedBoundary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum TraceContextError {
    #[error("unsupported trace context envelope version")]
    UnsupportedEnvelopeVersion,
    #[error("unsupported trace state")]
    UnsupportedTraceState,
    #[error("invalid W3C traceparent")]
    InvalidTraceparent,
}

fn validate_tracestate(value: Option<&str>) -> Result<(), TraceContextError> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return Ok(());
    };
    if value.len() > 256 {
        return Err(TraceContextError::UnsupportedTraceState);
    }
    let mut entries = value.split(',');
    let entry = entries
        .next()
        .ok_or(TraceContextError::UnsupportedTraceState)?
        .trim();
    if entries.next().is_some() {
        return Err(TraceContextError::UnsupportedTraceState);
    }
    let (key, vendor_value) = entry
        .split_once('=')
        .ok_or(TraceContextError::UnsupportedTraceState)?;
    if key != BITFUN_TRACESTATE_KEY
        || vendor_value.is_empty()
        || !vendor_value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
    {
        return Err(TraceContextError::UnsupportedTraceState);
    }
    Ok(())
}

fn parse_traceparent(value: &str) -> Result<SpanContext, TraceContextError> {
    if value.len() != 55 {
        return Err(TraceContextError::InvalidTraceparent);
    }
    let mut fields = value.split('-');
    let version = fields.next().ok_or(TraceContextError::InvalidTraceparent)?;
    let trace_id = fields.next().ok_or(TraceContextError::InvalidTraceparent)?;
    let span_id = fields.next().ok_or(TraceContextError::InvalidTraceparent)?;
    let flags = fields.next().ok_or(TraceContextError::InvalidTraceparent)?;
    if fields.next().is_some() || version != TRACEPARENT_VERSION {
        return Err(TraceContextError::InvalidTraceparent);
    }
    let trace_id = decode_hex::<16>(trace_id)?;
    let span_id = decode_hex::<8>(span_id)?;
    let flags = decode_hex::<1>(flags)?[0];
    if trace_id == [0; 16] || span_id == [0; 8] {
        return Err(TraceContextError::InvalidTraceparent);
    }
    Ok(SpanContext::remote_parent(
        trace_id,
        span_id,
        flags & 1 == 1,
    ))
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

fn decode_hex<const N: usize>(value: &str) -> Result<[u8; N], TraceContextError> {
    if value.len() != N * 2
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(TraceContextError::InvalidTraceparent);
    }
    let mut decoded = [0; N];
    for (index, target) in decoded.iter_mut().enumerate() {
        *target = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| TraceContextError::InvalidTraceparent)?;
    }
    Ok(decoded)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authenticated_peer_round_trips_context() {
        let original = SpanContext::root(1.0);
        let envelope = TraceContextEnvelope::from_span_context(original);
        assert_eq!(
            envelope
                .remote_parent(TraceContextTrust::AuthenticatedBitFunPeer)
                .unwrap(),
            Some(original)
        );
    }

    #[test]
    fn untrusted_boundary_never_adopts_context() {
        let envelope = TraceContextEnvelope::from_span_context(SpanContext::root(1.0));
        assert_eq!(
            envelope
                .remote_parent(TraceContextTrust::UntrustedBoundary)
                .unwrap(),
            None
        );
    }

    #[test]
    fn envelope_has_no_identity_or_baggage_fields() {
        let encoded = serde_json::to_string(&TraceContextEnvelope::from_span_context(
            SpanContext::root(1.0),
        ))
        .unwrap();
        for forbidden in [
            "baggage",
            "installation",
            "session",
            "user",
            "device",
            "path",
        ] {
            assert!(!encoded.contains(forbidden));
        }
    }

    #[test]
    fn only_registered_bitfun_tracestate_is_accepted() {
        assert_eq!(validate_tracestate(Some("bitfun=v1")), Ok(()));
        assert_eq!(
            validate_tracestate(Some("vendor=value")),
            Err(TraceContextError::UnsupportedTraceState)
        );
        assert_eq!(
            validate_tracestate(Some("bitfun=v1,other=value")),
            Err(TraceContextError::UnsupportedTraceState)
        );
    }
}
