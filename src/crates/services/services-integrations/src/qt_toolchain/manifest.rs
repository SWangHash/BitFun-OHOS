//! Static download manifest for the Qt migration toolchains.

use super::QtToolchainProvisionError;

/// Measured release base of the Qt5 assets.
pub const QT_QT5_RELEASE_BASE: &str =
    "https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/";

/// Name of the published checksum file in the Qt6 tree.
pub const QT_SHA256SUMS_FILE_NAME: &str = "SHA256SUMS.txt";

/// `<platform>` placeholder of [`QtToolchainManifestRow::asset_name_pattern`].
const PLATFORM_PLACEHOLDER: &str = "{platform}";

/// Measured Qt5 asset pattern. `{platform}` is substituted with the
/// layout's platform token; every Qt5 platform ships the `-gles` build and the
/// `arm64-v8a` OHOS target.
const QT5_ASSET_NAME_PATTERN: &str = "Qt-5.12.12-arm64-v8a-{platform}-gles.zip";

/// Archive container of a manifest row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QtToolchainArchiveKind {
    /// A `zip` archive (the Qt5 assets).
    Zip,
    /// A gzip-compressed tar archive (the Qt6 asset).
    TarGz,
}

impl QtToolchainArchiveKind {
    /// Stable, lower-case wire name for reporting.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Zip => "zip",
            Self::TarGz => "tar.gz",
        }
    }
}

/// Where the checksum of a manifest row comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QtToolchainChecksumSource {
    /// Upstream publishes no checksum for this asset (measured for the Qt5
    /// release, plan §7.1). Provisioning must skip verification **and report
    /// that it did**, never imply the archive was verified.
    NotPublished,
    /// A `SHA256SUMS.txt` next to the asset in the same release tree.
    Sha256Sums,
}

/// Whether a manifest row declares a **downloadable** source today.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QtToolchainSourceState {
    /// The row's asset is measured and downloadable.
    Published,
    /// Upstream publishes no download for this `(qt_major, platform)` pair.
    NotPublished,
}

/// One static manifest row: `(qt_major, platform) → asset`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QtToolchainManifestRow {
    /// Qt major version the row provides.
    pub qt_major: u8,
    /// Layout platform token the row provides (see `super::layout`).
    pub platform: &'static str,
    /// Whether the asset below is actually downloadable today.
    pub source: QtToolchainSourceState,
    /// Default release base; overridable per request. Empty when no source is
    /// published.
    pub release_base: &'static str,
    /// Asset file name, with `{platform}` where the name varies per platform.
    /// Empty when no source is published.
    pub asset_name_pattern: &'static str,
    /// Archive container of the asset. Declared even without a source, so the
    /// generation stays fully described.
    pub archive_kind: QtToolchainArchiveKind,
    /// Where the checksum comes from, if anywhere. Declared from what upstream
    /// publishes, independently of whether a URL can be resolved for it (see the
    /// module-level TODO on the checksum URL field).
    pub checksum: QtToolchainChecksumSource,
}

impl QtToolchainManifestRow {
    /// Whether this row declares a downloadable source today.
    pub fn has_published_source(&self) -> bool {
        self.source == QtToolchainSourceState::Published
    }
}

/// The complete, measured manifest table.
pub const QT_TOOLCHAIN_MANIFEST: &[QtToolchainManifestRow] = &[
    QtToolchainManifestRow {
        qt_major: 5,
        platform: "harmonyos",
        source: QtToolchainSourceState::Published,
        release_base: QT_QT5_RELEASE_BASE,
        asset_name_pattern: QT5_ASSET_NAME_PATTERN,
        archive_kind: QtToolchainArchiveKind::Zip,
        checksum: QtToolchainChecksumSource::NotPublished,
    },
    QtToolchainManifestRow {
        qt_major: 5,
        platform: "macos",
        source: QtToolchainSourceState::Published,
        release_base: QT_QT5_RELEASE_BASE,
        asset_name_pattern: QT5_ASSET_NAME_PATTERN,
        archive_kind: QtToolchainArchiveKind::Zip,
        checksum: QtToolchainChecksumSource::NotPublished,
    },
    QtToolchainManifestRow {
        qt_major: 5,
        platform: "windows",
        source: QtToolchainSourceState::Published,
        release_base: QT_QT5_RELEASE_BASE,
        asset_name_pattern: QT5_ASSET_NAME_PATTERN,
        archive_kind: QtToolchainArchiveKind::Zip,
        checksum: QtToolchainChecksumSource::NotPublished,
    },
    // No Qt6 download source is published today (module TODO): the row keeps the
    // generation, the layout platform token, and the `tar.gz` container the
    // measured package used, and declares neither a release base nor an asset
    // name. `source_not_published` is therefore the outcome of any Qt6
    // provisioning run that would have to download; every other Qt6 capability
    // (scan, version detection, layout, card option) is unaffected.
    QtToolchainManifestRow {
        qt_major: 6,
        platform: "ohos-pc-aarch64",
        source: QtToolchainSourceState::NotPublished,
        release_base: "",
        asset_name_pattern: "",
        archive_kind: QtToolchainArchiveKind::TarGz,
        // Measured: the Qt6 tree does publish a `SHA256SUMS.txt` next to its
        // package. No URL is resolved for it while the row has no source, and a
        // future source needs the dedicated checksum URL field the module TODO
        // describes.
        checksum: QtToolchainChecksumSource::Sha256Sums,
    },
];

/// A resolved download source for one `(qt_major, platform)` pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QtToolchainSource {
    /// Qt major version the source provides.
    pub qt_major: u8,
    /// Layout platform token the source provides.
    pub platform: String,
    /// Effective release base (the request override, or the row default).
    pub release_base: String,
    /// Effective asset file name.
    pub asset_name: String,
    /// Archive container of the asset.
    pub archive_kind: QtToolchainArchiveKind,
    /// Where the checksum comes from, if anywhere.
    pub checksum: QtToolchainChecksumSource,
    /// Candidate asset URLs in priority order. The table has exactly one source
    /// per row today; a future mirror appends here and the downloader needs no
    /// restructuring. **Empty** when the row declares no published source, which
    /// is what the download path turns into a fast `source_not_published`
    /// failure instead of a transfer attempt.
    pub asset_urls: Vec<String>,
    /// Candidate `SHA256SUMS.txt` URLs in priority order; empty when the row
    /// declares no published checksum, and empty whenever no source is published.
    pub checksum_urls: Vec<String>,
}

impl QtToolchainSource {
    /// Primary asset URL (the first candidate), `None` when the row has no
    /// published source.
    pub fn asset_url(&self) -> Option<&str> {
        self.asset_urls.first().map(String::as_str)
    }

    /// Whether a downloadable source is declared for this row.
    pub fn has_published_source(&self) -> bool {
        !self.asset_urls.is_empty()
    }

    /// Primary checksum URL, when the row publishes one.
    pub fn checksum_url(&self) -> Option<&str> {
        self.checksum_urls.first().map(String::as_str)
    }
}

/// Resolves the manifest row for `(qt_major, platform)`, applying an optional
/// release-base override.
pub fn qt_toolchain_source(
    qt_major: u8,
    platform: &str,
    release_base_override: Option<&str>,
) -> Result<QtToolchainSource, QtToolchainProvisionError> {
    if !QT_TOOLCHAIN_MANIFEST
        .iter()
        .any(|row| row.qt_major == qt_major)
    {
        return Err(QtToolchainProvisionError::UnsupportedQtVersion { qt_major });
    }
    let row = QT_TOOLCHAIN_MANIFEST
        .iter()
        .find(|row| row.qt_major == qt_major && row.platform == platform)
        .ok_or_else(|| QtToolchainProvisionError::UnsupportedPlatform {
            qt_major,
            platform: platform.to_string(),
        })?;

    // An empty override falls back to the row default instead of producing a
    // relative URL.
    let release_base = match release_base_override {
        Some(base) if !base.trim().is_empty() => base.trim().to_string(),
        _ => row.release_base.to_string(),
    };
    let published = row.has_published_source();
    let asset_name = if published {
        row.asset_name_pattern
            .replace(PLATFORM_PLACEHOLDER, platform)
    } else {
        String::new()
    };
    let asset_urls = if published && !asset_name.is_empty() && !release_base.is_empty() {
        vec![join_release_url(&release_base, &asset_name)]
    } else {
        Vec::new()
    };
    let checksum_urls = match row.checksum {
        QtToolchainChecksumSource::Sha256Sums if published && !release_base.is_empty() => {
            vec![join_release_url(&release_base, QT_SHA256SUMS_FILE_NAME)]
        }
        _ => Vec::new(),
    };

    Ok(QtToolchainSource {
        qt_major: row.qt_major,
        platform: platform.to_string(),
        release_base,
        asset_name,
        archive_kind: row.archive_kind,
        checksum: row.checksum,
        asset_urls,
        checksum_urls,
    })
}

/// Joins a release base and an asset name with exactly one separator.
fn join_release_url(release_base: &str, name: &str) -> String {
    format!("{}/{}", release_base.trim_end_matches('/'), name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::qt_toolchain::QtToolchainProvisionErrorCode;

    #[test]
    fn table_holds_exactly_the_measured_rows() {
        assert_eq!(QT_TOOLCHAIN_MANIFEST.len(), 4);
        let qt5_platforms: Vec<&str> = QT_TOOLCHAIN_MANIFEST
            .iter()
            .filter(|row| row.qt_major == 5)
            .map(|row| row.platform)
            .collect();
        assert_eq!(qt5_platforms, ["harmonyos", "macos", "windows"]);
        assert!(!qt5_platforms.contains(&"linux"));
        let qt6_platforms: Vec<&str> = QT_TOOLCHAIN_MANIFEST
            .iter()
            .filter(|row| row.qt_major == 6)
            .map(|row| row.platform)
            .collect();
        assert_eq!(qt6_platforms, ["ohos-pc-aarch64"]);
        for row in QT_TOOLCHAIN_MANIFEST {
            if row.has_published_source() {
                assert!(
                    !row.release_base.is_empty() && !row.asset_name_pattern.is_empty(),
                    "a published row must be fully declared: {row:?}"
                );
            } else {
                // No source: neither a base nor an asset name may linger, or the
                // download path could build a URL out of half-declared data.
                assert!(
                    row.release_base.is_empty() && row.asset_name_pattern.is_empty(),
                    "an unpublished row must declare no source data: {row:?}"
                );
            }
        }
    }

    #[test]
    fn only_the_qt5_rows_publish_a_download_source() {
        // Qt6 has no download source today (module TODO); the generation stays
        // representable through the row, without a resolvable asset.
        for row in QT_TOOLCHAIN_MANIFEST {
            assert_eq!(
                row.source,
                if row.qt_major == 5 {
                    QtToolchainSourceState::Published
                } else {
                    QtToolchainSourceState::NotPublished
                },
                "row {row:?} must keep the measured publish state"
            );
        }
        assert_eq!(
            QT_TOOLCHAIN_MANIFEST
                .iter()
                .filter(|row| !row.has_published_source())
                .map(|row| (row.qt_major, row.platform))
                .collect::<Vec<_>>(),
            vec![(6, "ohos-pc-aarch64")]
        );
    }

    #[test]
    fn qt5_assets_resolve_to_the_measured_release_urls() {
        for platform in ["harmonyos", "macos", "windows"] {
            let source = qt_toolchain_source(5, platform, None).unwrap();
            let expected_asset_name = format!("Qt-5.12.12-arm64-v8a-{platform}-gles.zip");
            let expected_url = format!(
                "https://gitcode.com/ohos-qt/qt-harmonyos-src/releases/download/v5.12.12/{expected_asset_name}"
            );
            assert_eq!(source.asset_url(), Some(expected_url.as_str()));
            assert_eq!(source.asset_name, expected_asset_name);
            assert_eq!(source.archive_kind, QtToolchainArchiveKind::Zip);
            // 实测：Qt5 release 没有发布 checksum。
            assert_eq!(source.checksum, QtToolchainChecksumSource::NotPublished);
            assert!(source.checksum_url().is_none());
            assert!(source.checksum_urls.is_empty());
            assert_eq!(source.release_base, QT_QT5_RELEASE_BASE);
        }
    }
    #[test]
    fn nonexistent_combinations_are_rejected_with_stable_codes() {
        // 实测：Qt5 没有 linux 变体。
        let error = qt_toolchain_source(5, "linux", None).unwrap_err();
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::UnsupportedPlatform
        );
        assert_eq!(error.code_str(), "unsupported_platform");

        // The Qt6 kit is the OHOS PC aarch64 native build; there is no host
        // variant, and there is no Qt5 ohos-pc-aarch64 asset.
        for (qt_major, platform) in [(6, "harmonyos"), (6, "windows"), (5, "ohos-pc-aarch64")] {
            let error = qt_toolchain_source(qt_major, platform, None).unwrap_err();
            assert_eq!(
                error.code(),
                QtToolchainProvisionErrorCode::UnsupportedPlatform,
                "({qt_major}, {platform}) must be rejected as an unsupported platform"
            );
        }

        for qt_major in [4, 7, 0] {
            let error = qt_toolchain_source(qt_major, "harmonyos", None).unwrap_err();
            assert_eq!(
                error.code(),
                QtToolchainProvisionErrorCode::UnsupportedQtVersion
            );
            assert_eq!(error.code_str(), "unsupported_qt_version");
        }
    }
}
