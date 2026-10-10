//! HTTP acquisition of the Qt toolchain archive.

use super::QtToolchainProvisionError;
use futures_util::StreamExt;
use reqwest::header::USER_AGENT;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Duration;
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

/// Browser user agent for every request.

/// Measured: GitCode answers `401` for the download endpoints
/// without a browser-looking agent, so this header is a functional requirement,
/// not cosmetic. The exact string is a current desktop Chrome agent.
pub(super) const QT_TOOLCHAIN_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
     AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// Wall-clock budget for a whole Qt archive transfer. The Qt6 package is 29 MB
/// today and the Qt5 kits are larger, so the overall timeout is generous while
/// the connect timeout stays tight (mirrors `speech/downloader.rs`).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const OVERALL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// HTTP client used for the archive and its checksum file.
pub(super) fn build_client() -> Result<reqwest::Client, QtToolchainProvisionError> {
    crate::reqwest_client_builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(OVERALL_TIMEOUT)
        .build()
        .map_err(|error| {
            QtToolchainProvisionError::DownloadFailed(format!(
                "failed to build the Qt toolchain HTTP client: {error}"
            ))
        })
}

/// A completed archive transfer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct QtArchiveDownload {
    /// Source the bytes came from (the winning candidate).
    pub(super) source_url: String,
    /// Bytes written.
    pub(super) bytes: u64,
    /// Lower-case hex SHA-256 of the transferred bytes, computed incrementally
    /// while streaming.
    pub(super) sha256: String,
}

/// Downloads `asset_urls[0]`, falling back to the remaining candidates in order,
/// into `target`.
pub(super) async fn download_archive<P>(
    asset_urls: &[String],
    client: &reqwest::Client,
    target: &Path,
    cancel: &CancellationToken,
    on_progress: &P,
) -> Result<QtArchiveDownload, QtToolchainProvisionError>
where
    P: Fn(u64, Option<u64>),
{
    let mut source_errors = Vec::with_capacity(asset_urls.len());
    for (source_index, source_url) in asset_urls.iter().enumerate() {
        if cancel.is_cancelled() {
            let _ = fs::remove_file(target).await;
            return Err(cancelled_error(source_url));
        }
        let _ = fs::remove_file(target).await;
        on_progress(0, None);

        match download_source(client, source_url, target, cancel, on_progress).await {
            Ok(download) => return Ok(download),
            Err(error) => {
                let _ = fs::remove_file(target).await;
                if error.is_cancelled() {
                    return Err(error);
                }
                log::warn!(
                    "Qt toolchain download source failed: source_index={}, url={}, error={}",
                    source_index,
                    source_url,
                    error
                );
                source_errors.push(format!("{source_url}: {error}"));
            }
        }
    }

    Err(QtToolchainProvisionError::DownloadFailed(format!(
        "Qt toolchain archive download failed from all {} configured sources: {}",
        asset_urls.len(),
        source_errors.join("; ")
    )))
}

/// Streams one source into `target`, hashing as it goes.
async fn download_source<P>(
    client: &reqwest::Client,
    source_url: &str,
    target: &Path,
    cancel: &CancellationToken,
    on_progress: &P,
) -> Result<QtArchiveDownload, QtToolchainProvisionError>
where
    P: Fn(u64, Option<u64>),
{
    let response_request = client
        .get(source_url)
        .header(USER_AGENT, QT_TOOLCHAIN_USER_AGENT)
        .send();
    let response = tokio::select! {
        _ = cancel.cancelled() => {
            return Err(cancelled_error(source_url));
        }
        response = response_request => response,
    }
    .map_err(|error| transport_error(source_url, "request failed", error))?
    .error_for_status()
    .map_err(|error| transport_error(source_url, "HTTP error", error))?;

    let total_bytes = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = fs::File::create(target).await.map_err(|error| {
        QtToolchainProvisionError::IoFailed(format!(
            "failed to create the Qt toolchain download file {}: {error}",
            target.display()
        ))
    })?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0u64;

    loop {
        let next_chunk = tokio::select! {
            _ = cancel.cancelled() => {
                drop(file);
                let _ = fs::remove_file(target).await;
                return Err(cancelled_error(source_url));
            }
            chunk = stream.next() => chunk,
        };
        let Some(chunk) = next_chunk else {
            break;
        };
        let chunk =
            chunk.map_err(|error| transport_error(source_url, "body read failed", error))?;
        file.write_all(&chunk).await.map_err(|error| {
            QtToolchainProvisionError::IoFailed(format!(
                "failed to write the Qt toolchain archive {}: {error}",
                target.display()
            ))
        })?;
        hasher.update(&chunk);
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        on_progress(downloaded, total_bytes);
    }
    file.flush().await.map_err(|error| {
        QtToolchainProvisionError::IoFailed(format!(
            "failed to flush the Qt toolchain archive {}: {error}",
            target.display()
        ))
    })?;
    drop(file);

    if cancel.is_cancelled() {
        let _ = fs::remove_file(target).await;
        return Err(cancelled_error(source_url));
    }

    Ok(QtArchiveDownload {
        source_url: source_url.to_string(),
        bytes: downloaded,
        sha256: format!("{:x}", hasher.finalize()),
    })
}

/// Fetches and parses the published `SHA256SUMS.txt` for `asset_name`.

/// Only reached for rows that declare
/// [`super::QtToolchainChecksumSource::Sha256Sums`]; a row that publishes no
/// checksum never calls this.
pub(super) async fn fetch_published_checksum(
    client: &reqwest::Client,
    checksum_urls: &[String],
    asset_name: &str,
    cancel: &CancellationToken,
) -> Result<String, QtToolchainProvisionError> {
    let mut source_errors = Vec::with_capacity(checksum_urls.len());
    for source_url in checksum_urls {
        if cancel.is_cancelled() {
            return Err(cancelled_error(source_url));
        }
        let response_request = client
            .get(source_url)
            .header(USER_AGENT, QT_TOOLCHAIN_USER_AGENT)
            .send();
        let response = tokio::select! {
            _ = cancel.cancelled() => {
                return Err(cancelled_error(source_url));
            }
            response = response_request => response,
        };
        let body = match response
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| transport_error(source_url, "checksum request failed", error))
        {
            Ok(response) => match response.text().await {
                Ok(body) => body,
                Err(error) => {
                    source_errors.push(format!("{source_url}: checksum body read failed: {error}"));
                    continue;
                }
            },
            Err(error) => {
                log::warn!(
                    "Qt toolchain checksum source failed: url={}, error={}",
                    source_url,
                    error
                );
                source_errors.push(format!("{source_url}: {error}"));
                continue;
            }
        };

        match parse_sha256sums(&body, asset_name) {
            Ok(sha256) => return Ok(sha256),
            Err(error) => {
                // The body length is part of the diagnostic on purpose: the
                // measured Qt6 release base answers the asset blob for any
                // trailing path (live probe), so an unusable body is often a
                // whole archive rather than a malformed checksum file. A bare
                // "no usable entry" would hide that.
                let body_bytes = body.len();
                log::warn!(
                    "Qt toolchain checksum file was unusable: url={}, body_bytes={}, error={}",
                    source_url,
                    body_bytes,
                    error
                );
                source_errors.push(format!("{source_url}: {error} (body_bytes={body_bytes})"));
            }
        }
    }

    Err(QtToolchainProvisionError::ChecksumFetchFailed(format!(
        "could not obtain a published checksum for {asset_name} from {} configured sources: {}",
        checksum_urls.len(),
        source_errors.join("; ")
    )))
}

/// Parses a `SHA256SUMS.txt` body into the digest that belongs to `asset_name`.
pub(super) fn parse_sha256sums(
    body: &str,
    asset_name: &str,
) -> Result<String, QtToolchainProvisionError> {
    let mut entries: Vec<(String, Option<String>)> = Vec::new();
    for raw_line in body.lines() {
        let line = raw_line.trim_start_matches('\u{feff}').trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut fields = line.split_ascii_whitespace();
        let Some(digest) = fields.next() else {
            continue;
        };
        if !is_sha256_hex(digest) {
            continue;
        }
        let name = fields
            .next()
            .map(|name| name.trim_start_matches('*').to_string())
            .filter(|name| !name.is_empty());
        entries.push((digest.to_ascii_lowercase(), name));
    }

    if let Some((digest, _)) = entries.iter().find(|(_, name)| {
        name.as_deref()
            .is_some_and(|name| names_asset(name, asset_name))
    }) {
        return Ok(digest.clone());
    }

    match entries.as_slice() {
        [(digest, None)] => Ok(digest.clone()),
        [] => Err(QtToolchainProvisionError::ChecksumFetchFailed(format!(
            "the published checksum file contains no usable SHA-256 entry for {asset_name}"
        ))),
        many => Err(QtToolchainProvisionError::ChecksumFetchFailed(format!(
            "the published checksum file contains {} entries but none for {asset_name}",
            many.len()
        ))),
    }
}

/// Whether a checksum-file entry names `asset_name`, tolerating a directory
/// prefix on the entry (for example `./dist/qt-…tar.gz`).
fn names_asset(entry_name: &str, asset_name: &str) -> bool {
    entry_name == asset_name
        || Path::new(entry_name)
            .file_name()
            .is_some_and(|name| name == asset_name)
}

/// Whether `value` is a 64-character hexadecimal SHA-256 digest.
fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn cancelled_error(source_url: &str) -> QtToolchainProvisionError {
    QtToolchainProvisionError::Cancelled(format!("Qt toolchain download cancelled: {source_url}"))
}

fn transport_error(
    source_url: &str,
    context: &str,
    error: reqwest::Error,
) -> QtToolchainProvisionError {
    QtToolchainProvisionError::DownloadFailed(format!("{source_url}: {context}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qt_toolchain::QtToolchainProvisionErrorCode;
    #[test]
    fn checksum_file_resolves_the_named_entry() {
        let digest = "a".repeat(64);
        let other = "b".repeat(64);
        let body = format!("# generated\n{other}  other.tar.gz\n{digest}  pkgs/qt.tar.gz\n");
        assert_eq!(parse_sha256sums(&body, "qt.tar.gz").unwrap(), digest);
    }

    #[test]
    fn checksum_file_accepts_bsd_style_and_windows_line_endings() {
        let digest = "c".repeat(64);
        let body = format!("{digest} *qt.tar.gz\r\n");
        assert_eq!(parse_sha256sums(&body, "qt.tar.gz").unwrap(), digest);

        let upper = "D".repeat(64);
        let body = format!("{upper}  qt.tar.gz");
        assert_eq!(
            parse_sha256sums(&body, "qt.tar.gz").unwrap(),
            "d".repeat(64)
        );
    }
    #[test]
    fn checksum_file_naming_only_other_assets_is_rejected() {
        let body = format!("{}  other.tar.gz\n", "f".repeat(64));
        let error = parse_sha256sums(&body, "qt.tar.gz").unwrap_err();
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::ChecksumFetchFailed
        );

        let error = parse_sha256sums("", "qt.tar.gz").unwrap_err();
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::ChecksumFetchFailed
        );

        // Malformed digests are not silently treated as entries.
        let error = parse_sha256sums("not-a-digest  qt.tar.gz\n", "qt.tar.gz").unwrap_err();
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::ChecksumFetchFailed
        );
    }
    #[test]
    fn sha256_hex_predicate_requires_64_hex_characters() {
        assert!(is_sha256_hex(&"0".repeat(64)));
        assert!(!is_sha256_hex(&"0".repeat(63)));
        assert!(!is_sha256_hex(&"g".repeat(64)));
        assert!(!is_sha256_hex(""));
    }
}
