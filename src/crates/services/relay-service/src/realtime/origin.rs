//! Browser origin policy shared by every realtime scope.
use axum::http::{header, HeaderMap};

pub(crate) fn is_websocket_origin_allowed(headers: &HeaderMap, allowed_origins: &[String]) -> bool {
    let Some(origin) = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
    else {
        // Native clients do not send Origin and authenticate at the protocol
        // layer. Origin is a browser boundary, not a replacement for auth.
        return true;
    };
    if origin.eq_ignore_ascii_case("null") {
        return false;
    }
    let Some(origin) = crate::normalized_browser_origin(origin) else {
        return false;
    };
    if allowed_origins
        .iter()
        .any(|allowed| allowed == "*" || allowed.eq_ignore_ascii_case(&origin))
    {
        return true;
    }

    let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
    else {
        return false;
    };
    let origin_authority = origin
        .split_once("://")
        .map(|(_, authority)| authority)
        .and_then(|authority| authority.split('/').next());
    origin_authority.is_some_and(|authority| authority.eq_ignore_ascii_case(host))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn websocket_browser_origin_is_same_origin_or_explicitly_allowed() {
        let mut headers = HeaderMap::new();
        headers.insert(header::HOST, "relay.example.com".parse().unwrap());
        headers.insert(header::ORIGIN, "https://relay.example.com".parse().unwrap());
        assert!(is_websocket_origin_allowed(&headers, &[]));

        headers.insert(header::ORIGIN, "https://app.example.com".parse().unwrap());
        assert!(!is_websocket_origin_allowed(&headers, &[]));
        assert!(is_websocket_origin_allowed(
            &headers,
            &["https://app.example.com".to_string()]
        ));

        headers.insert(header::ORIGIN, "null".parse().unwrap());
        assert!(!is_websocket_origin_allowed(&headers, &["*".to_string()]));

        for invalid in [
            "file://relay.example.com",
            "https://relay.example.com/path",
            "https://user@relay.example.com",
        ] {
            headers.insert(header::ORIGIN, invalid.parse().unwrap());
            assert!(!is_websocket_origin_allowed(&headers, &[]));
        }
    }
}
