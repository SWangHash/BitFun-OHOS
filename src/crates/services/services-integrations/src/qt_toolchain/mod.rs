//! Qt migration toolchain provisioner.

mod downloader;
mod extract;
mod layout;
mod manifest;

use std::path::{Path, PathBuf};
use tokio::fs;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub use self::layout::{
    qt_managed_generation, qt_managed_kit_root, qt_managed_version_dir, QtManagedKitGeneration,
    QT_MANAGED_KIT_LAYOUT, QT_MANAGED_TOOLCHAINS_DIR_NAME,
};
pub use self::manifest::{
    qt_toolchain_source, QtToolchainArchiveKind, QtToolchainChecksumSource, QtToolchainManifestRow,
    QtToolchainSource, QtToolchainSourceState, QT_QT5_RELEASE_BASE, QT_SHA256SUMS_FILE_NAME,
    QT_TOOLCHAIN_MANIFEST,
};

use self::downloader::{build_client, download_archive, fetch_published_checksum};

/// `lib/cmake/Qt6` relative to a kit root: the deciding Qt6 version signal
/// .
pub const QT6_KIT_CMAKE_PACKAGE_DIR: &str = "lib/cmake/Qt6";

/// `lib/cmake/Qt5` relative to a kit root: the Qt5 counterpart. The measured Qt6
/// package ships no `lib/cmake/Qt5`, so the two signals cannot both match.
pub const QT5_KIT_CMAKE_PACKAGE_DIR: &str = "lib/cmake/Qt5";

/// OHOS platform plugin relative to a kit root: shipped by a HarmonyOS target
/// kit and absent from a desktop host kit.
pub const QT_KIT_OHOS_PLATFORM_PLUGIN: &str = "plugins/platforms/libqohos.so";

/// Executable names that mark a directory the scanner treats as a qmake hit.
/// `qmake.exe` is included because the scan's own hit predicate accepts both
/// (`qt_migration_candidates::QMAKE_EXECUTABLES`), and the measured Qt6 package
/// ships `bin/qmake` next to `bin/qmake6` and `bin/qt-cmake`.
pub const QT_KIT_QMAKE_EXECUTABLES: &[&str] = &["qmake", "qmake.exe"];

/// Directory prefix of an in-flight install, directly under the toolchains root
/// and never at the final path. The head is also what the scanner's
/// noise rule matches, so a download in flight is never mistaken for a kit.
const STAGING_DIR_PREFIX: &str = ".installing-";

/// Subdirectory of the staging directory holding the downloaded archive.
const STAGING_DOWNLOAD_DIR_NAME: &str = "download";

/// Subdirectory of the staging directory holding the extracted kit.
const STAGING_PAYLOAD_DIR_NAME: &str = "payload";

// ---------------------------------------------------------------------------
// Public request / outcome / progress types
// ---------------------------------------------------------------------------

/// What the coordinator asks for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QtToolchainProvisionRequest {
    /// Qt major version to provision: `5` or `6`.
    pub qt_major: u8,
    /// Layout platform token, for example `harmonyos` or `ohos-pc-aarch64`.
    pub platform: String,
    /// The managed toolchains root (C1:
    /// `path_manager.qt_migration_toolchains_dir`). The kit is installed below
    /// it as `<version_dir>`.
    pub toolchains_root: PathBuf,
    /// Optional release-base override. `None` uses the measured default from the
    /// manifest table, so moving the mirror is a data change.
    pub release_base: Option<String>,
}

impl QtToolchainProvisionRequest {
    /// Request against the measured release base.
    pub fn new(
        qt_major: u8,
        platform: impl Into<String>,
        toolchains_root: impl Into<PathBuf>,
    ) -> Self {
        Self {
            qt_major,
            platform: platform.into(),
            toolchains_root: toolchains_root.into(),
            release_base: None,
        }
    }

    /// Request against another release base (a mirror, or a fixture tree in
    /// tests).
    pub fn with_release_base(mut self, release_base: impl Into<String>) -> Self {
        self.release_base = Some(release_base.into());
        self
    }
}

/// Whether the archive integrity was verifiable from a published checksum.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QtToolchainChecksumStatus {
    /// The manifest row declares no published checksum (the measured Qt5 rows),
    /// so integrity could not be verified. This state must reach the user
    /// instead of implying the archive was verified.
    NotPublished,
    /// The row publishes a checksum that has not been matched against the
    /// archive yet. Only reported while a download is in flight; a successful
    /// outcome never carries it.
    Pending,
    /// The published checksum was fetched and the downloaded archive matched it.
    Verified,
    /// The archive came from a local file
    /// ([`provision_qt_toolchain_from_archive`]), so no published checksum
    /// applied to it.
    NotApplicable,
}

impl QtToolchainChecksumStatus {
    /// Whether the bytes that produced the kit were checksum-verified.
    pub fn is_verified(self) -> bool {
        self == Self::Verified
    }
}

/// What the coordinator reports back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QtToolchainProvisionOutcome {
    /// Qt major version of the published kit.
    pub qt_major: u8,
    /// Layout platform token of the published kit.
    pub platform: String,
    /// The published kit root: `<toolchains_root>/<version_dir>`.
    /// This is the path the caller writes into the field resolution (D7).
    pub kit_root: PathBuf,
    /// `true` when an already installed kit was reused (C4) and nothing was
    /// downloaded or written.
    pub reused_existing_kit: bool,
    /// File name of the archive that provided the kit.
    pub asset_name: String,
    /// URL of the archive (the primary candidate of the manifest row).
    pub asset_url: String,
    /// Archive container of the asset.
    pub archive_kind: QtToolchainArchiveKind,
    /// Whether the archive integrity was actually verified.
    pub checksum_status: QtToolchainChecksumStatus,
    /// Bytes of the archive: transferred this run, `0` when the kit was reused.
    pub downloaded_bytes: u64,
}

/// Progress stage of a provisioning run, for the caller's own progress channel
/// .
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QtToolchainInstallStage {
    /// Looking for a kit that is already installed (C4).
    CheckingExisting,
    /// An installed kit was found; nothing else happens.
    Reused,
    /// Fetching the published `SHA256SUMS.txt` (only rows that declare one).
    FetchingChecksum,
    /// Streaming the archive into the staging directory.
    Downloading,
    /// Comparing the streamed digest with the published checksum.
    VerifyingArchive,
    /// Extracting the archive and stripping its top-level directory.
    Extracting,
    /// Checking the extracted kit against the scan criteria (C2).
    VerifyingInstall,
    /// Moving the verified kit to the final layout path.
    Publishing,
    /// The kit is published and the staging directory is gone.
    Completed,
}

impl QtToolchainInstallStage {
    /// Stable, lower-case wire name for the caller's event payload.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CheckingExisting => "checking_existing",
            Self::Reused => "reused",
            Self::FetchingChecksum => "fetching_checksum",
            Self::Downloading => "downloading",
            Self::VerifyingArchive => "verifying_archive",
            Self::Extracting => "extracting",
            Self::VerifyingInstall => "verifying_install",
            Self::Publishing => "publishing",
            Self::Completed => "completed",
        }
    }
}

/// One progress report. `total_bytes` is `None` when the server sent no
/// `Content-Length`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QtToolchainInstallProgress {
    /// Qt major version being provisioned.
    pub qt_major: u8,
    /// Layout platform token being provisioned.
    pub platform: String,
    /// Stage this report belongs to.
    pub stage: QtToolchainInstallStage,
    /// Bytes of the archive transferred so far (or already transferred).
    pub downloaded_bytes: u64,
    /// Expected archive size, when the server declared one.
    pub total_bytes: Option<u64>,
    /// Current checksum state, so a UI can say "not verified" from the first
    /// report on.
    pub checksum_status: QtToolchainChecksumStatus,
}

// ---------------------------------------------------------------------------
// Public error type and stable codes (C6)
// ---------------------------------------------------------------------------

/// Stable, machine-readable failure codes. Callers surface
/// the code, not the message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QtToolchainProvisionErrorCode {
    /// No manifest row exists for the requested Qt major version.
    UnsupportedQtVersion,
    /// The generation exists, but not for this layout platform token (for
    /// example the measured absence of a Qt5 `linux` asset).
    UnsupportedPlatform,
    /// The download was requested for a platform other than the one BitFun is
    /// running on. Scoped to the download: a kit already on the device is never
    /// rejected for its platform.
    HostPlatformMismatch,
    /// The generation and the platform exist, but upstream publishes **no
    /// download** for them. Raised before any
    /// transfer is attempted, so the caller can report it instead of a
    /// network-shaped failure.
    SourceNotPublished,
    /// The archive could not be transferred from any configured source.
    DownloadFailed,
    /// The published checksum file could not be fetched or does not identify the
    /// archive.
    ChecksumFetchFailed,
    /// The archive did not match the published checksum; nothing is published.
    ChecksumMismatch,
    /// The archive could not be opened or extracted.
    ArchiveExtractFailed,
    /// The extracted kit does not satisfy the scan criteria, or declares the
    /// wrong Qt generation; nothing is published.
    InstallVerificationFailed,
    /// The verified kit could not be moved to the final layout path.
    PublishFailed,
    /// The run was cancelled; staging was removed and nothing is published.
    Cancelled,
    /// A local filesystem operation failed.
    IoFailed,
}

impl QtToolchainProvisionErrorCode {
    /// Stable wire name of the code.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::UnsupportedQtVersion => "unsupported_qt_version",
            Self::UnsupportedPlatform => "unsupported_platform",
            Self::HostPlatformMismatch => "host_platform_mismatch",
            Self::SourceNotPublished => "source_not_published",
            Self::DownloadFailed => "download_failed",
            Self::ChecksumFetchFailed => "checksum_fetch_failed",
            Self::ChecksumMismatch => "checksum_mismatch",
            Self::ArchiveExtractFailed => "archive_extract_failed",
            Self::InstallVerificationFailed => "install_verification_failed",
            Self::PublishFailed => "publish_failed",
            Self::Cancelled => "cancelled",
            Self::IoFailed => "io_failed",
        }
    }
}

/// The layout platform token of the kit BitFun can download on this host.
pub fn qt_toolchain_host_platform() -> &'static str {
    if cfg!(target_env = "ohos") {
        // The OpenHarmony PC host runs the OHOS kit.
        "harmonyos"
    } else {
        // `windows` and `macos` name their own layout rows; `linux` has none, so a
        // Linux host resolves to no downloadable Qt5 row and reports
        // `unsupported_platform`, as it does today.
        std::env::consts::OS
    }
}

/// Rejects a download for a platform other than the one BitFun runs on.

/// The layout installs every kit at `<toolchains>/<version_dir>` with no platform
/// level, so a kit downloaded for another platform would land where this host's
/// kit belongs.
fn require_host_platform(platform: &str) -> Result<(), QtToolchainProvisionError> {
    let host_platform = qt_toolchain_host_platform();
    if platform == host_platform {
        return Ok(());
    }
    Err(QtToolchainProvisionError::HostPlatformMismatch {
        platform: platform.to_string(),
        host_platform,
    })
}

/// Typed provisioner failure. [`Self::code`] is the stable contract; the message
/// is for logs and diagnostics.
#[derive(Debug, thiserror::Error)]
pub enum QtToolchainProvisionError {
    /// See [`QtToolchainProvisionErrorCode::UnsupportedQtVersion`].
    #[error("unsupported Qt version: Qt{qt_major} is not in the toolchain manifest")]
    UnsupportedQtVersion {
        /// Requested Qt major version.
        qt_major: u8,
    },
    /// See [`QtToolchainProvisionErrorCode::UnsupportedPlatform`].
    #[error("Qt{qt_major} has no managed toolchain for platform `{platform}`")]
    UnsupportedPlatform {
        /// Requested Qt major version.
        qt_major: u8,
        /// Requested layout platform token.
        platform: String,
    },
    /// See [`QtToolchainProvisionErrorCode::HostPlatformMismatch`].
    #[error(
        "the Qt toolchain download for `{platform}` cannot run on this `{host_platform}` host"
    )]
    HostPlatformMismatch {
        /// Platform the download was requested for.
        platform: String,
        /// Platform BitFun is running on.
        host_platform: &'static str,
    },
    /// See [`QtToolchainProvisionErrorCode::SourceNotPublished`].
    #[error(
        "no Qt{qt_major} toolchain source is published for platform `{platform}`: this generation cannot be downloaded"
    )]
    SourceNotPublished {
        /// Requested Qt major version.
        qt_major: u8,
        /// Requested layout platform token.
        platform: String,
    },
    /// See [`QtToolchainProvisionErrorCode::DownloadFailed`].
    #[error("Qt toolchain download failed: {0}")]
    DownloadFailed(String),
    /// See [`QtToolchainProvisionErrorCode::ChecksumFetchFailed`].
    #[error("Qt toolchain checksum download failed: {0}")]
    ChecksumFetchFailed(String),
    /// See [`QtToolchainProvisionErrorCode::ChecksumMismatch`].
    #[error("Qt toolchain checksum mismatch for {asset_name}: expected {expected}, got {actual}")]
    ChecksumMismatch {
        /// Archive the checksum refers to.
        asset_name: String,
        /// Checksum published upstream.
        expected: String,
        /// Checksum computed from the transferred bytes.
        actual: String,
    },
    /// See [`QtToolchainProvisionErrorCode::ArchiveExtractFailed`].
    #[error("Qt toolchain archive extraction failed: {0}")]
    ArchiveExtractFailed(String),
    /// See [`QtToolchainProvisionErrorCode::InstallVerificationFailed`].
    #[error("Qt toolchain install verification failed: {0}")]
    InstallVerificationFailed(String),
    /// See [`QtToolchainProvisionErrorCode::PublishFailed`].
    #[error("Qt toolchain publish failed: {0}")]
    PublishFailed(String),
    /// See [`QtToolchainProvisionErrorCode::Cancelled`].
    #[error("Qt toolchain provisioning cancelled: {0}")]
    Cancelled(String),
    /// See [`QtToolchainProvisionErrorCode::IoFailed`].
    #[error("Qt toolchain provisioning I/O failed: {0}")]
    IoFailed(String),
}

impl QtToolchainProvisionError {
    /// Stable machine-readable code (C6).
    pub fn code(&self) -> QtToolchainProvisionErrorCode {
        match self {
            Self::UnsupportedQtVersion { .. } => {
                QtToolchainProvisionErrorCode::UnsupportedQtVersion
            }
            Self::UnsupportedPlatform { .. } => QtToolchainProvisionErrorCode::UnsupportedPlatform,
            Self::HostPlatformMismatch { .. } => {
                QtToolchainProvisionErrorCode::HostPlatformMismatch
            }
            Self::SourceNotPublished { .. } => QtToolchainProvisionErrorCode::SourceNotPublished,
            Self::DownloadFailed(_) => QtToolchainProvisionErrorCode::DownloadFailed,
            Self::ChecksumFetchFailed(_) => QtToolchainProvisionErrorCode::ChecksumFetchFailed,
            Self::ChecksumMismatch { .. } => QtToolchainProvisionErrorCode::ChecksumMismatch,
            Self::ArchiveExtractFailed(_) => QtToolchainProvisionErrorCode::ArchiveExtractFailed,
            Self::InstallVerificationFailed(_) => {
                QtToolchainProvisionErrorCode::InstallVerificationFailed
            }
            Self::PublishFailed(_) => QtToolchainProvisionErrorCode::PublishFailed,
            Self::Cancelled(_) => QtToolchainProvisionErrorCode::Cancelled,
            Self::IoFailed(_) => QtToolchainProvisionErrorCode::IoFailed,
        }
    }

    /// Stable wire name of [`Self::code`].
    pub fn code_str(&self) -> &'static str {
        self.code().as_str()
    }

    /// Whether the failure is a cancellation.
    pub fn is_cancelled(&self) -> bool {
        matches!(self, Self::Cancelled(_))
    }
}

impl From<std::io::Error> for QtToolchainProvisionError {
    fn from(error: std::io::Error) -> Self {
        Self::IoFailed(error.to_string())
    }
}

// ---------------------------------------------------------------------------
// Scan criteria (C2): the same three facts the stage-1 scan measures
// ---------------------------------------------------------------------------

/// What a kit root on disk declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QtKitProbe {
    /// `Some(6)` when `lib/cmake/Qt6` is a directory, `Some(5)` for
    /// `lib/cmake/Qt5`, `None` when neither identifies the tree. Never guessed.
    pub qt_major: Option<u8>,
    /// A qmake executable exists directly in `bin/`.
    pub has_qmake: bool,
    /// `plugins/platforms/libqohos.so` exists: an OHOS target kit rather than a
    /// desktop host kit.
    pub has_ohos_platform_plugin: bool,
}

impl QtKitProbe {
    /// Whether the stage-1 scan accepts this tree as a usable toolchain.
    pub fn is_usable_kit(&self) -> bool {
        self.qt_major.is_some() && self.has_qmake && self.has_ohos_platform_plugin
    }
}

/// Measures `kit_root` against the scan criteria (C2). Never guesses a version:
/// an unrecognized layout reports `qt_major: None`.
pub fn probe_qt_kit(kit_root: &Path) -> QtKitProbe {
    QtKitProbe {
        qt_major: detect_qt_major(kit_root),
        has_qmake: QT_KIT_QMAKE_EXECUTABLES
            .iter()
            .any(|name| kit_root.join("bin").join(name).is_file()),
        has_ohos_platform_plugin: kit_root.join(QT_KIT_OHOS_PLATFORM_PLUGIN).is_file(),
    }
}

/// Qt major version a kit root declares, or `None` when the on-disk layout does
/// not identify one
/// .
pub fn detect_qt_major(kit_root: &Path) -> Option<u8> {
    if kit_root.join(QT6_KIT_CMAKE_PACKAGE_DIR).is_dir() {
        Some(6)
    } else if kit_root.join(QT5_KIT_CMAKE_PACKAGE_DIR).is_dir() {
        Some(5)
    } else {
        None
    }
}

/// C2: the tree must pass the scan criteria **and** declare the requested Qt
/// generation, so a mislabeled or half-extracted archive can never be published
/// under a layout path that claims another generation.
fn verify_kit(kit_root: &Path, expected_qt_major: u8) -> Result<(), QtToolchainProvisionError> {
    let probe = probe_qt_kit(kit_root);
    let mut problems: Vec<String> = Vec::new();
    match probe.qt_major {
        None => problems.push(format!(
            "no `{QT5_KIT_CMAKE_PACKAGE_DIR}` or `{QT6_KIT_CMAKE_PACKAGE_DIR}` directory"
        )),
        Some(detected) if detected != expected_qt_major => problems.push(format!(
            "declares Qt{detected} while Qt{expected_qt_major} was requested"
        )),
        Some(_) => {}
    }
    if !probe.has_qmake {
        problems.push("no `bin/qmake` (or `bin/qmake.exe`)".to_string());
    }
    if !probe.has_ohos_platform_plugin {
        problems.push(format!("no `{QT_KIT_OHOS_PLATFORM_PLUGIN}`"));
    }
    if problems.is_empty() {
        return Ok(());
    }

    let mut message = format!(
        "kit at {} does not satisfy the Qt migration scan criteria: {}",
        kit_root.display(),
        problems.join(", ")
    );
    if let Some(nested) = single_nested_directory(kit_root) {
        message.push_str(&format!(
            "; the tree holds a single nested directory `{nested}`, which means the archive's top-level directory was not stripped"
        ));
    }
    Err(QtToolchainProvisionError::InstallVerificationFailed(
        message,
    ))
}

/// Name of the only entry of `kit_root` when that entry is a lone directory,
/// used to explain an unstripped archive layout.
fn single_nested_directory(kit_root: &Path) -> Option<String> {
    let mut entries = std::fs::read_dir(kit_root).ok()?;
    let first = entries.next()?.ok()?;
    if entries.next().is_some() || !first.file_type().ok()?.is_dir() {
        return None;
    }
    Some(first.file_name().to_string_lossy().into_owned())
}

/// C4: the Qt major version the final path already provides, when it holds a kit
/// the scan accepts. A tree of the other generation is **not** a reuse, because
/// it would keep the requested generation permanently unavailable.
fn reusable_kit_major(kit_root: &Path, expected_qt_major: u8) -> Option<u8> {
    let probe = probe_qt_kit(kit_root);
    if probe.is_usable_kit() && probe.qt_major == Some(expected_qt_major) {
        probe.qt_major
    } else {
        None
    }
}

/// C6: the checksum decision as a pure function, so the mismatch contract is
/// covered without transferring anything.
fn verify_archive_checksum(
    expected_sha256: Option<&str>,
    actual_sha256: &str,
    asset_name: &str,
) -> Result<(), QtToolchainProvisionError> {
    let Some(expected) = expected_sha256 else {
        return Ok(());
    };
    if expected.eq_ignore_ascii_case(actual_sha256) {
        return Ok(());
    }
    Err(QtToolchainProvisionError::ChecksumMismatch {
        asset_name: asset_name.to_string(),
        expected: expected.to_ascii_lowercase(),
        actual: actual_sha256.to_ascii_lowercase(),
    })
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Provisions the Qt migration toolchain for `request`.
pub async fn provision_qt_toolchain<F>(
    request: &QtToolchainProvisionRequest,
    cancel: CancellationToken,
    on_progress: F,
) -> Result<QtToolchainProvisionOutcome, QtToolchainProvisionError>
where
    F: Fn(QtToolchainInstallProgress) + Send + Sync,
{
    let plan = ProvisionPlan::resolve(request)?;
    // Building the client is pure setup (no request is sent), so an already
    // cancelled token still short-circuits before any network use.
    let client = build_client()?;
    provision_resolved(
        plan,
        ArchiveSource::Download(&client),
        &cancel,
        &on_progress,
    )
    .await
}

/// Provisions from an archive that already exists on disk: the same install,
/// verification, idempotency, and cleanup pipeline without the download step.
pub async fn provision_qt_toolchain_from_archive<F>(
    request: &QtToolchainProvisionRequest,
    archive_path: &Path,
    cancel: CancellationToken,
    on_progress: F,
) -> Result<QtToolchainProvisionOutcome, QtToolchainProvisionError>
where
    F: Fn(QtToolchainInstallProgress) + Send + Sync,
{
    let plan = ProvisionPlan::resolve(request)?;
    provision_resolved(
        plan,
        ArchiveSource::Local(archive_path.to_path_buf()),
        &cancel,
        &on_progress,
    )
    .await
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/// Where the archive comes from: the network, or a local file.
enum ArchiveSource<'a> {
    /// Transfer the manifest asset.
    Download(&'a reqwest::Client),
    /// Use an archive that already exists on disk.
    Local(PathBuf),
}

/// Everything resolved up front: where the kit goes, and where the archive is.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ProvisionPlan {
    qt_major: u8,
    platform: String,
    /// The managed toolchains root. Staging directories are created here, never
    /// inside `version_dir`, because `version_dir` *is* the publish target.
    toolchains_root: PathBuf,
    version_dir: PathBuf,
    kit_root: PathBuf,
    source: QtToolchainSource,
    checksum_status: QtToolchainChecksumStatus,
}

impl ProvisionPlan {
    fn resolve(request: &QtToolchainProvisionRequest) -> Result<Self, QtToolchainProvisionError> {
        let source = qt_toolchain_source(
            request.qt_major,
            &request.platform,
            request.release_base.as_deref(),
        )?;
        // Both paths come from the layout table. A kit root *is* its version
        // directory, so reversing one with `parent` would land on the whole
        // toolchains root and let stale-staging cleanup reach a sibling
        // generation's install.
        let version_dir = qt_managed_version_dir(source.qt_major)
            .map(|version_dir| request.toolchains_root.join(version_dir))
            .ok_or_else(|| QtToolchainProvisionError::UnsupportedQtVersion {
                qt_major: source.qt_major,
            })?;
        let kit_root =
            qt_managed_kit_root(&request.toolchains_root, source.qt_major).ok_or_else(|| {
                QtToolchainProvisionError::UnsupportedQtVersion {
                    qt_major: source.qt_major,
                }
            })?;
        let checksum_status = match source.checksum {
            QtToolchainChecksumSource::NotPublished => QtToolchainChecksumStatus::NotPublished,
            QtToolchainChecksumSource::Sha256Sums => QtToolchainChecksumStatus::Pending,
        };
        Ok(Self {
            qt_major: source.qt_major,
            platform: source.platform.clone(),
            toolchains_root: request.toolchains_root.clone(),
            version_dir,
            kit_root,
            source,
            checksum_status,
        })
    }

    fn progress_context(&self) -> ProgressContext {
        ProgressContext {
            qt_major: self.qt_major,
            platform: self.platform.clone(),
            checksum_status: self.checksum_status,
        }
    }

    fn outcome(
        &self,
        reused_existing_kit: bool,
        downloaded_bytes: u64,
    ) -> QtToolchainProvisionOutcome {
        QtToolchainProvisionOutcome {
            qt_major: self.qt_major,
            platform: self.platform.clone(),
            kit_root: self.kit_root.clone(),
            reused_existing_kit,
            asset_name: self.source.asset_name.clone(),
            asset_url: self.source.asset_url().unwrap_or_default().to_string(),
            archive_kind: self.source.archive_kind,
            checksum_status: self.checksum_status,
            downloaded_bytes,
        }
    }

    /// Makes sure the toolchains root exists and that no stale staging directory
    /// from a crashed or cancelled run survives for this generation.
    async fn prepare_install_root(&self) -> Result<(), QtToolchainProvisionError> {
        fs::create_dir_all(&self.toolchains_root)
            .await
            .map_err(|error| {
                QtToolchainProvisionError::IoFailed(format!(
                    "failed to create the managed toolchains directory {}: {error}",
                    self.toolchains_root.display()
                ))
            })?;
        remove_stale_staging_dirs(&self.toolchains_root, &self.staging_prefix()).await
    }

    /// Names this generation's staging directories inside the toolchains root.

    /// The version directory namespaces them so cleaning up one generation cannot
    /// delete a sibling generation's in-flight download, and keeping the
    /// [`STAGING_DIR_PREFIX`] head keeps the scanner's noise rule skipping them.
    fn staging_prefix(&self) -> String {
        let version_dir = self
            .version_dir
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        format!("{STAGING_DIR_PREFIX}{version_dir}-")
    }

    /// Creates a fresh `.installing-<version-dir>-<uuid>` directory beside the kit
    /// root, never inside it.
    async fn create_staging_dir(&self) -> Result<PathBuf, QtToolchainProvisionError> {
        let staging = self.toolchains_root.join(format!(
            "{}{}",
            self.staging_prefix(),
            Uuid::new_v4().simple()
        ));
        fs::create_dir_all(&staging).await.map_err(|error| {
            QtToolchainProvisionError::IoFailed(format!(
                "failed to create the Qt toolchain staging directory {}: {error}",
                staging.display()
            ))
        })?;
        Ok(staging)
    }
}

/// Progress report source: the values that stay fixed during a run.
#[derive(Debug, Clone)]
struct ProgressContext {
    qt_major: u8,
    platform: String,
    checksum_status: QtToolchainChecksumStatus,
}

impl ProgressContext {
    fn emit<F>(
        &self,
        on_progress: &F,
        stage: QtToolchainInstallStage,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
    ) where
        F: Fn(QtToolchainInstallProgress),
    {
        on_progress(QtToolchainInstallProgress {
            qt_major: self.qt_major,
            platform: self.platform.clone(),
            stage,
            downloaded_bytes,
            total_bytes,
            checksum_status: self.checksum_status,
        });
    }
}

/// The shared pipeline: idempotency, staging lifecycle, archive acquisition,
/// install verification, atomic publish, cleanup.
async fn provision_resolved<F>(
    mut plan: ProvisionPlan,
    archive_source: ArchiveSource<'_>,
    cancel: &CancellationToken,
    on_progress: &F,
) -> Result<QtToolchainProvisionOutcome, QtToolchainProvisionError>
where
    F: Fn(QtToolchainInstallProgress) + Send + Sync,
{
    let ctx = plan.progress_context();
    ctx.emit(
        on_progress,
        QtToolchainInstallStage::CheckingExisting,
        0,
        None,
    );

    if let Some(installed_major) = reusable_kit_major(&plan.kit_root, plan.qt_major) {
        log::info!(
            "Reusing the installed Qt{} toolchain kit: path={}",
            installed_major,
            plan.kit_root.display()
        );
        ctx.emit(on_progress, QtToolchainInstallStage::Reused, 0, None);
        ctx.emit(on_progress, QtToolchainInstallStage::Completed, 0, None);
        return Ok(plan.outcome(true, 0));
    }

    if cancel.is_cancelled() {
        return Err(QtToolchainProvisionError::Cancelled(format!(
            "provisioning Qt{} for {} was cancelled before it started",
            plan.qt_major, plan.platform
        )));
    }

    // Stage A: a generation without a published source fails fast, before any
    // filesystem or network work, with a dedicated code — never as a
    // network-shaped `download_failed`. The check sits after the reuse path, so a
    // kit the user installed into the managed directory is still reused (C4), and
    // it never applies to the local-archive entry point: installing an archive
    // the caller already has needs no source.
    if matches!(&archive_source, ArchiveSource::Download(_)) && !plan.source.has_published_source()
    {
        return Err(QtToolchainProvisionError::SourceNotPublished {
            qt_major: plan.qt_major,
            platform: plan.platform.clone(),
        });
    }

    // The platform restriction is scoped to the download, which is why it sits
    // here: after the reuse path, so a kit already installed in the managed
    // directory is returned on any host, and never on the local-archive entry
    // point, which downloads nothing.
    if matches!(&archive_source, ArchiveSource::Download(_)) {
        require_host_platform(&plan.platform)?;
    }

    plan.prepare_install_root().await?;
    let staging = plan.create_staging_dir().await?;

    let result =
        install_into_staging(&mut plan, &staging, archive_source, cancel, on_progress).await;
    // C5: the staging directory never survives a run, successful or not.
    remove_staging_dir(&staging).await;

    let outcome = result?;
    let ctx = plan.progress_context();
    ctx.emit(
        on_progress,
        QtToolchainInstallStage::Completed,
        outcome.downloaded_bytes,
        None,
    );
    Ok(outcome)
}

/// Acquires the archive, then installs it into the final layout path.
async fn install_into_staging<F>(
    plan: &mut ProvisionPlan,
    staging: &Path,
    archive_source: ArchiveSource<'_>,
    cancel: &CancellationToken,
    on_progress: &F,
) -> Result<QtToolchainProvisionOutcome, QtToolchainProvisionError>
where
    F: Fn(QtToolchainInstallProgress) + Send + Sync,
{
    let (archive_path, downloaded_bytes) = match archive_source {
        ArchiveSource::Download(client) => {
            let download_dir = staging.join(STAGING_DOWNLOAD_DIR_NAME);
            fs::create_dir_all(&download_dir).await?;
            let archive_path = download_dir.join(&plan.source.asset_name);

            let expected_sha256 = if plan.source.checksum_urls.is_empty() {
                None
            } else {
                plan.progress_context().emit(
                    on_progress,
                    QtToolchainInstallStage::FetchingChecksum,
                    0,
                    None,
                );
                Some(
                    fetch_published_checksum(
                        client,
                        &plan.source.checksum_urls,
                        &plan.source.asset_name,
                        cancel,
                    )
                    .await?,
                )
            };

            let download_ctx = plan.progress_context();
            let download_progress = |transferred: u64, total: Option<u64>| {
                download_ctx.emit(
                    on_progress,
                    QtToolchainInstallStage::Downloading,
                    transferred,
                    total,
                );
            };
            let download = download_archive(
                &plan.source.asset_urls,
                client,
                &archive_path,
                cancel,
                &download_progress,
            )
            .await?;

            plan.progress_context().emit(
                on_progress,
                QtToolchainInstallStage::VerifyingArchive,
                download.bytes,
                None,
            );
            // A mismatch fails loudly instead of falling through to another
            // candidate: the archive and the whole staging directory are removed
            // by the caller, and nothing reaches the final path.
            verify_archive_checksum(
                expected_sha256.as_deref(),
                &download.sha256,
                &plan.source.asset_name,
            )?;
            plan.checksum_status = if expected_sha256.is_some() {
                QtToolchainChecksumStatus::Verified
            } else {
                QtToolchainChecksumStatus::NotPublished
            };
            (archive_path, download.bytes)
        }
        ArchiveSource::Local(path) => {
            let bytes = fs::metadata(&path).await.map_err(|error| {
                QtToolchainProvisionError::IoFailed(format!(
                    "failed to inspect the local Qt toolchain archive {}: {error}",
                    path.display()
                ))
            })?;
            plan.checksum_status = QtToolchainChecksumStatus::NotApplicable;
            (path, bytes.len())
        }
    };

    plan.progress_context().emit(
        on_progress,
        QtToolchainInstallStage::Extracting,
        downloaded_bytes,
        None,
    );
    let payload = staging.join(STAGING_PAYLOAD_DIR_NAME);
    let archive_kind = plan.source.archive_kind;
    let archive_for_task = archive_path.clone();
    let payload_for_task = payload.clone();
    tokio::task::spawn_blocking(move || {
        extract::extract_archive_stripping_top_level(
            &archive_for_task,
            archive_kind,
            &payload_for_task,
        )
    })
    .await
    .map_err(|error| {
        QtToolchainProvisionError::ArchiveExtractFailed(format!(
            "the Qt toolchain extraction task failed: {error}"
        ))
    })??;

    plan.progress_context().emit(
        on_progress,
        QtToolchainInstallStage::VerifyingInstall,
        downloaded_bytes,
        None,
    );
    verify_kit(&payload, plan.qt_major)?;

    plan.progress_context().emit(
        on_progress,
        QtToolchainInstallStage::Publishing,
        downloaded_bytes,
        None,
    );
    if plan.kit_root.exists() {
        // Only an invalid or incomplete tree can be here, because a usable kit
        // returned early. Removing it first is also what makes the rename work
        // on Windows.
        fs::remove_dir_all(&plan.kit_root).await.map_err(|error| {
            QtToolchainProvisionError::PublishFailed(format!(
                "failed to clear the incomplete kit at {}: {error}",
                plan.kit_root.display()
            ))
        })?;
    }
    fs::rename(&payload, &plan.kit_root)
        .await
        .map_err(|error| {
            QtToolchainProvisionError::PublishFailed(format!(
                "failed to move the verified kit into {}: {error}",
                plan.kit_root.display()
            ))
        })?;

    // C2/C5: the published tree has to pass the same criteria; if it somehow
    // does not, it is removed instead of left behind as a half install.
    if let Err(error) = verify_kit(&plan.kit_root, plan.qt_major) {
        let _ = fs::remove_dir_all(&plan.kit_root).await;
        return Err(error);
    }
    Ok(plan.outcome(false, downloaded_bytes))
}

/// C5: removes a staging directory, logging instead of failing so cleanup never
/// masks the real result.
async fn remove_staging_dir(staging: &Path) {
    match fs::remove_dir_all(staging).await {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            log::warn!(
                "Failed to remove the Qt toolchain staging directory: path={}, error={}",
                staging.display(),
                error
            );
        }
    }
}

/// Removes this generation's `.installing-*` directories, left behind by a
/// crashed or cancelled run, from the toolchains root.
async fn remove_stale_staging_dirs(
    root: &Path,
    prefix: &str,
) -> Result<(), QtToolchainProvisionError> {
    let mut entries = match fs::read_dir(root).await {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(QtToolchainProvisionError::from(error)),
    };
    let mut removed = 0usize;
    while let Some(entry) = entries.next_entry().await? {
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        if !file_name.starts_with(prefix) {
            continue;
        }
        if !entry
            .file_type()
            .await
            .map(|kind| kind.is_dir())
            .unwrap_or(false)
        {
            continue;
        }
        let path = entry.path();
        match fs::remove_dir_all(&path).await {
            Ok(()) => {
                removed += 1;
                log::warn!(
                    "Removed a stale Qt toolchain staging directory left by a previous run: {}",
                    path.display()
                );
            }
            Err(error) => {
                log::warn!(
                    "Failed to remove a stale Qt toolchain staging directory: path={}, error={}",
                    path.display(),
                    error
                );
            }
        }
    }
    if removed > 0 {
        log::info!(
            "Removed {} stale Qt toolchain staging directories under {}",
            removed,
            root.display()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::Mutex;
    use tempfile::tempdir;

    // -----------------------------------------------------------------------
    // Fixtures
    // -----------------------------------------------------------------------

    /// Files of a valid Qt5 OHOS kit, relative to the kit root.
    const QT5_KIT_FILES: &[(&str, &str)] = &[
        ("bin/qmake", "#!/bin/sh\n"),
        ("lib/cmake/Qt5/Qt5Config.cmake", "qt5\n"),
        ("plugins/platforms/libqohos.so", "plugin\n"),
    ];

    /// Files of a valid Qt6 OHOS kit, relative to the kit root. `bin/qmake` is
    /// measured: the GitCode Qt6 package ships it.
    const QT6_KIT_FILES: &[(&str, &str)] = &[
        ("bin/qmake", "#!/bin/sh\n"),
        ("bin/qt-cmake", "#!/bin/sh\n"),
        ("lib/cmake/Qt6/Qt6Config.cmake", "qt6\n"),
        ("plugins/platforms/libqohos.so", "plugin\n"),
    ];

    /// The top-level directory the measured Qt5 zip ships.
    const QT5_ARCHIVE_TOP_LEVEL: &str = "Qt5.12.12-arm64-v8a-gles";

    /// The top-level directory the measured Qt6 tar.gz ships.
    const QT6_ARCHIVE_TOP_LEVEL: &str = "qt-6.13.0-dev";

    fn write_kit(root: &Path, files: &[(&str, &str)]) {
        for (relative, contents) in files {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, contents).unwrap();
        }
    }

    /// Builds a zip whose entries sit under `top_level`, like the Qt5 asset.
    fn write_qt5_zip(archive: &Path, top_level: &str, files: &[(&str, &str)]) {
        let file = std::fs::File::create(archive).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (relative, contents) in files {
            writer
                .start_file(format!("{top_level}/{relative}"), options)
                .unwrap();
            writer.write_all(contents.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
    }

    /// Builds a gzip tar whose entries sit under `top_level`, like the Qt6 asset.
    fn write_qt6_tar_gz(archive: &Path, top_level: &str, files: &[(&str, &str)]) {
        let encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        for (relative, contents) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(contents.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder
                .append_data(
                    &mut header,
                    format!("{top_level}/{relative}"),
                    contents.as_bytes(),
                )
                .unwrap();
        }
        let encoder = builder.into_inner().unwrap();
        std::fs::write(archive, encoder.finish().unwrap()).unwrap();
    }

    /// Writes an archive of the kind the manifest declares for `qt_major`, so a
    /// fixture always matches the real row it stands in for.
    fn write_manifest_shaped_archive(
        archive: &Path,
        qt_major: u8,
        top_level: &str,
        files: &[(&str, &str)],
    ) {
        match qt_major {
            6 => write_qt6_tar_gz(archive, top_level, files),
            _ => write_qt5_zip(archive, top_level, files),
        }
    }

    fn version_dir_for(toolchains_root: &Path, qt_major: u8) -> PathBuf {
        toolchains_root
            .join(qt_managed_version_dir(qt_major).expect("the layout declares both generations"))
    }

    fn staging_dirs(version_dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(version_dir)
            .map(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .filter(|name| name.starts_with(STAGING_DIR_PREFIX))
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    fn no_progress(_: QtToolchainInstallProgress) {}

    /// Runs the offline install pipeline for a fixture kit and returns its error.
    async fn install_fixture_and_expect_failure(
        qt_major: u8,
        platform: &str,
        top_level: &str,
        files: &[(&str, &str)],
    ) -> QtToolchainProvisionError {
        let root = tempdir().unwrap();
        let toolchains = root.path().join("toolchains");
        let archive = root.path().join("fixture-archive");
        write_manifest_shaped_archive(&archive, qt_major, top_level, files);

        let error = provision_qt_toolchain_from_archive(
            &QtToolchainProvisionRequest::new(qt_major, platform, &toolchains),
            &archive,
            CancellationToken::new(),
            no_progress,
        )
        .await
        .unwrap_err();

        // C5: nothing was published and no staging directory survived.
        let version_dir = version_dir_for(&toolchains, qt_major);
        assert!(!version_dir.exists());
        assert!(staging_dirs(&toolchains).is_empty());
        error
    }

    // -----------------------------------------------------------------------
    // Layout resolution, install, idempotency
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn install_publishes_the_kit_at_the_layout_path_for_each_generation() {
        let root = tempdir().unwrap();
        let toolchains = root.path().join("toolchains");

        // Qt5 zip: the upstream `Qt5.12.12-arm64-v8a-gles/` top level is stripped.
        let qt5_archive = root.path().join("Qt-5.12.12-arm64-v8a-harmonyos-gles.zip");
        write_qt5_zip(&qt5_archive, QT5_ARCHIVE_TOP_LEVEL, QT5_KIT_FILES);
        let outcome = provision_qt_toolchain_from_archive(
            &QtToolchainProvisionRequest::new(5, "harmonyos", &toolchains),
            &qt5_archive,
            CancellationToken::new(),
            no_progress,
        )
        .await
        .unwrap();

        assert_eq!(outcome.kit_root, toolchains.join("qt5.12.12"));
        assert!(!outcome.reused_existing_kit);
        assert_eq!(outcome.qt_major, 5);
        assert_eq!(outcome.archive_kind, QtToolchainArchiveKind::Zip);
        assert_eq!(
            outcome.downloaded_bytes,
            std::fs::metadata(&qt5_archive).unwrap().len()
        );
        assert!(outcome.kit_root.join("bin/qmake").is_file());
        assert!(outcome
            .kit_root
            .join("lib/cmake/Qt5/Qt5Config.cmake")
            .is_file());
        assert!(probe_qt_kit(&outcome.kit_root).is_usable_kit());
        assert!(staging_dirs(&toolchains).is_empty());

        // Qt6 tar.gz: the upstream `qt-6.13.0-dev/` top level is stripped.
        let qt6_archive = root
            .path()
            .join("qt-6.13.0-alpha1-ohos-pc-aarch64-sdk_20260922.tar.gz");
        write_qt6_tar_gz(&qt6_archive, QT6_ARCHIVE_TOP_LEVEL, QT6_KIT_FILES);
        let outcome = provision_qt_toolchain_from_archive(
            &QtToolchainProvisionRequest::new(6, "ohos-pc-aarch64", &toolchains),
            &qt6_archive,
            CancellationToken::new(),
            no_progress,
        )
        .await
        .unwrap();

        assert_eq!(outcome.kit_root, toolchains.join("qt6.13.0"));
        assert_eq!(outcome.archive_kind, QtToolchainArchiveKind::TarGz);
        assert!(outcome.kit_root.join("bin/qmake").is_file());
        assert!(outcome
            .kit_root
            .join("lib/cmake/Qt6/Qt6Config.cmake")
            .is_file());
        assert!(outcome
            .kit_root
            .join("plugins/platforms/libqohos.so")
            .is_file());
        // A local archive carries no published checksum to check against.
        assert_eq!(
            outcome.checksum_status,
            QtToolchainChecksumStatus::NotApplicable
        );
        assert!(staging_dirs(&toolchains).is_empty());
    }

    #[tokio::test]
    async fn a_valid_kit_is_reused_without_touching_the_archive() {
        let root = tempdir().unwrap();
        let toolchains = root.path().join("toolchains");
        let kit_root = toolchains.join("qt6.13.0");
        write_kit(&kit_root, QT6_KIT_FILES);

        let observed = Mutex::new(Vec::new());
        let outcome = provision_qt_toolchain_from_archive(
            &QtToolchainProvisionRequest::new(6, "ohos-pc-aarch64", &toolchains),
            // Proves the archive is never opened: this path does not exist.
            &root.path().join("missing.tar.gz"),
            CancellationToken::new(),
            |progress| observed.lock().unwrap().push(progress.stage),
        )
        .await
        .unwrap();

        assert!(outcome.reused_existing_kit);
        assert_eq!(outcome.downloaded_bytes, 0);
        assert_eq!(outcome.kit_root, kit_root);
        assert!(kit_root.join("bin/qmake").is_file());
        assert_eq!(
            *observed.lock().unwrap(),
            vec![
                QtToolchainInstallStage::CheckingExisting,
                QtToolchainInstallStage::Reused,
                QtToolchainInstallStage::Completed,
            ]
        );
    }

    #[tokio::test]
    async fn a_kit_of_the_other_generation_is_not_reused() {
        let root = tempdir().unwrap();
        let toolchains = root.path().join("toolchains");
        // A Qt5 tree sitting at the Qt6 path must not satisfy a Qt6 request.
        let kit_root = toolchains.join("qt6.13.0");
        write_kit(&kit_root, QT5_KIT_FILES);

        let archive = root.path().join("qt6.tar.gz");
        write_qt6_tar_gz(&archive, QT6_ARCHIVE_TOP_LEVEL, QT6_KIT_FILES);
        let outcome = provision_qt_toolchain_from_archive(
            &QtToolchainProvisionRequest::new(6, "ohos-pc-aarch64", &toolchains),
            &archive,
            CancellationToken::new(),
            no_progress,
        )
        .await
        .unwrap();

        assert!(!outcome.reused_existing_kit);
        assert_eq!(detect_qt_major(&outcome.kit_root), Some(6));
        assert!(outcome
            .kit_root
            .join("lib/cmake/Qt6/Qt6Config.cmake")
            .is_file());
        assert!(!kit_root.join("lib/cmake/Qt5").exists());
    }
    #[tokio::test]
    async fn install_reports_every_stage_in_order() {
        let root = tempdir().unwrap();
        let toolchains = root.path().join("toolchains");
        let archive = root.path().join("Qt-5.12.12-arm64-v8a-windows-gles.zip");
        write_qt5_zip(&archive, "Qt5.12.12-arm64-v8a-windows", QT5_KIT_FILES);

        let observed = Mutex::new(Vec::new());
        provision_qt_toolchain_from_archive(
            &QtToolchainProvisionRequest::new(5, "windows", &toolchains),
            &archive,
            CancellationToken::new(),
            |progress| {
                let mut observed = observed.lock().unwrap();
                observed.push((progress.stage, progress.checksum_status));
                assert_eq!(progress.qt_major, 5);
                assert_eq!(progress.platform, "windows");
            },
        )
        .await
        .unwrap();

        assert_eq!(
            *observed.lock().unwrap(),
            vec![
                // A Qt5 row publishes no checksum, and a local archive has none
                // to check against either, so the state changes once the run
                // stops being a download.
                (
                    QtToolchainInstallStage::CheckingExisting,
                    QtToolchainChecksumStatus::NotPublished
                ),
                (
                    QtToolchainInstallStage::Extracting,
                    QtToolchainChecksumStatus::NotApplicable
                ),
                (
                    QtToolchainInstallStage::VerifyingInstall,
                    QtToolchainChecksumStatus::NotApplicable
                ),
                (
                    QtToolchainInstallStage::Publishing,
                    QtToolchainChecksumStatus::NotApplicable
                ),
                (
                    QtToolchainInstallStage::Completed,
                    QtToolchainChecksumStatus::NotApplicable
                ),
            ]
        );
    }

    // -----------------------------------------------------------------------
    // C2: post-install verification
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn verification_rejects_a_tree_without_a_qt_cmake_package() {
        let files: Vec<(&str, &str)> = QT5_KIT_FILES
            .iter()
            .copied()
            .filter(|(relative, _)| !relative.starts_with("lib/cmake/"))
            .collect();
        let error =
            install_fixture_and_expect_failure(5, "harmonyos", QT5_ARCHIVE_TOP_LEVEL, &files).await;
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::InstallVerificationFailed
        );
        assert!(
            error.to_string().contains("lib/cmake/Qt5"),
            "unexpected message: {error}"
        );
    }

    #[tokio::test]
    async fn verification_requires_the_ohos_platform_plugin() {
        let files: Vec<(&str, &str)> = QT5_KIT_FILES
            .iter()
            .copied()
            .filter(|(relative, _)| *relative != QT_KIT_OHOS_PLATFORM_PLUGIN)
            .collect();
        let error =
            install_fixture_and_expect_failure(5, "harmonyos", QT5_ARCHIVE_TOP_LEVEL, &files).await;
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::InstallVerificationFailed
        );
        assert!(
            error.to_string().contains(QT_KIT_OHOS_PLATFORM_PLUGIN),
            "unexpected message: {error}"
        );
    }
    #[tokio::test]
    async fn verification_rejects_a_kit_declaring_the_other_generation() {
        // The payload declares Qt5 while Qt6 was requested, so it must not be
        // published under the Qt6 layout path.
        let files: Vec<(&str, &str)> = vec![
            ("bin/qmake", "#!/bin/sh\n"),
            ("lib/cmake/Qt5/Qt5Config.cmake", "qt5\n"),
            ("plugins/platforms/libqohos.so", "plugin\n"),
        ];
        let error =
            install_fixture_and_expect_failure(6, "ohos-pc-aarch64", QT6_ARCHIVE_TOP_LEVEL, &files)
                .await;
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::InstallVerificationFailed
        );
        assert!(error.to_string().contains("declares Qt5"), "{error}");
    }
    // -----------------------------------------------------------------------
    // C5: staging hygiene
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn a_stale_staging_directory_is_not_an_install_and_is_removed() {
        let root = tempdir().unwrap();
        let toolchains = root.path().join("toolchains");
        let version_dir = version_dir_for(&toolchains, 5);
        // A crashed run left a *valid* kit inside a staging directory. Staging
        // lives in the toolchains root, and its name is scoped to the generation
        // it belongs to, so the fixture has to carry the real prefix.
        let stale = toolchains.join(format!("{STAGING_DIR_PREFIX}qt5.12.12-deadbeef"));
        write_kit(&stale.join(STAGING_PAYLOAD_DIR_NAME), QT5_KIT_FILES);

        // The final path is what counts, and it holds nothing.
        assert_eq!(reusable_kit_major(&version_dir, 5), None);
        assert!(!version_dir.exists());

        let archive = root.path().join("qt5.zip");
        write_qt5_zip(&archive, QT5_ARCHIVE_TOP_LEVEL, QT5_KIT_FILES);
        let outcome = provision_qt_toolchain_from_archive(
            &QtToolchainProvisionRequest::new(5, "harmonyos", &toolchains),
            &archive,
            CancellationToken::new(),
            no_progress,
        )
        .await
        .unwrap();

        assert!(
            !outcome.reused_existing_kit,
            "a stale staging tree is not an install"
        );
        assert!(outcome.kit_root.join("bin/qmake").is_file());
        assert!(
            staging_dirs(&toolchains).is_empty(),
            "the stale staging directory must be removed"
        );
    }
    #[tokio::test]
    async fn a_cancelled_run_publishes_nothing_and_cleans_staging() {
        let root = tempdir().unwrap();
        let toolchains = root.path().join("toolchains");
        let version_dir = version_dir_for(&toolchains, 5);
        let archive = root.path().join("kit.zip");
        write_qt5_zip(&archive, QT5_ARCHIVE_TOP_LEVEL, QT5_KIT_FILES);

        let cancel = CancellationToken::new();
        cancel.cancel();
        let error = provision_qt_toolchain_from_archive(
            &QtToolchainProvisionRequest::new(5, "harmonyos", &toolchains),
            &archive,
            cancel,
            no_progress,
        )
        .await
        .unwrap_err();

        assert_eq!(error.code(), QtToolchainProvisionErrorCode::Cancelled);
        assert_eq!(error.code_str(), "cancelled");
        assert!(error.is_cancelled());
        assert!(!version_dir.exists());
        assert!(staging_dirs(&toolchains).is_empty());
    }

    // -----------------------------------------------------------------------
    // Entry-point behaviour that needs no network
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn the_network_entry_point_returns_the_reused_kit_without_downloading() {
        let root = tempdir().unwrap();
        let toolchains = root.path().join("toolchains");
        write_kit(&toolchains.join("qt5.12.12"), QT5_KIT_FILES);

        let outcome = provision_qt_toolchain(
            &QtToolchainProvisionRequest::new(5, "harmonyos", &toolchains),
            CancellationToken::new(),
            no_progress,
        )
        .await
        .unwrap();

        assert!(outcome.reused_existing_kit);
        assert!(outcome.asset_name.ends_with("harmonyos-gles.zip"));
        assert_eq!(
            outcome.checksum_status,
            QtToolchainChecksumStatus::NotPublished
        );
        assert!(!outcome.checksum_status.is_verified());
    }
    #[tokio::test]
    async fn a_generation_without_a_published_source_fails_fast_with_its_own_code() {
        let root = tempdir().unwrap();
        let toolchains = root.path().join("toolchains");

        // Qt6 download is expected to be absent, not broken: the failure carries
        // its own code instead of a network-shaped one, and nothing was written.
        let error = provision_qt_toolchain(
            &QtToolchainProvisionRequest::new(6, "ohos-pc-aarch64", &toolchains),
            CancellationToken::new(),
            no_progress,
        )
        .await
        .unwrap_err();
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::SourceNotPublished
        );
        assert_eq!(error.code_str(), "source_not_published");
        assert!(!error.is_cancelled());
        assert!(error.to_string().contains("cannot be downloaded"));
        assert!(!toolchains.join("qt6.13.0").exists());

        // A mirror override cannot resurrect a row that declares no source.
        let error = provision_qt_toolchain(
            &QtToolchainProvisionRequest::new(6, "ohos-pc-aarch64", &toolchains)
                .with_release_base("https://mirror.example/qt6/"),
            CancellationToken::new(),
            no_progress,
        )
        .await
        .unwrap_err();
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::SourceNotPublished
        );

        // C4 still wins: a Qt6 kit the user installed into the managed layout is
        // reused, because no transfer is needed at all.
        write_kit(&toolchains.join("qt6.13.0"), QT6_KIT_FILES);
        let outcome = provision_qt_toolchain(
            &QtToolchainProvisionRequest::new(6, "ohos-pc-aarch64", &toolchains),
            CancellationToken::new(),
            no_progress,
        )
        .await
        .unwrap();
        assert!(outcome.reused_existing_kit);

        // The local-archive entry point is not a download: an archive the caller
        // already has installs normally, which is what keeps the offline test
        // pipeline (and a future mirror/manual install) working for Qt6.
        let offline_root = tempdir().unwrap();
        let offline_toolchains = offline_root.path().join("toolchains");
        let archive = offline_root.path().join("qt6.tar.gz");
        write_qt6_tar_gz(&archive, QT6_ARCHIVE_TOP_LEVEL, QT6_KIT_FILES);
        let outcome = provision_qt_toolchain_from_archive(
            &QtToolchainProvisionRequest::new(6, "ohos-pc-aarch64", &offline_toolchains),
            &archive,
            CancellationToken::new(),
            no_progress,
        )
        .await
        .expect("a local archive installs without a published source");
        assert!(!outcome.reused_existing_kit);
        assert!(outcome.kit_root.join("lib/cmake/Qt6").is_dir());
    }
    // -----------------------------------------------------------------------
    // C6: checksum decisions, codes, and stage names
    // -----------------------------------------------------------------------

    #[test]
    fn a_matching_published_checksum_is_accepted_and_a_mismatch_fails_loudly() {
        let digest = "a".repeat(64);
        assert!(verify_archive_checksum(Some(&digest), &digest, "qt.tar.gz").is_ok());
        assert!(
            verify_archive_checksum(Some(&digest.to_ascii_uppercase()), &digest, "qt.tar.gz")
                .is_ok()
        );
        // A row that publishes no checksum skips verification by contract.
        assert!(verify_archive_checksum(None, &digest, "Qt-5.12.12.zip").is_ok());

        let error =
            verify_archive_checksum(Some(&digest), &"b".repeat(64), "qt.tar.gz").unwrap_err();
        assert_eq!(
            error.code(),
            QtToolchainProvisionErrorCode::ChecksumMismatch
        );
        assert_eq!(error.code_str(), "checksum_mismatch");
        match error {
            QtToolchainProvisionError::ChecksumMismatch {
                asset_name,
                expected,
                actual,
            } => {
                assert_eq!(asset_name, "qt.tar.gz");
                assert_eq!(expected, digest);
                assert_eq!(actual, "b".repeat(64));
            }
            other => panic!("unexpected error: {other}"),
        }
    }
    #[test]
    fn every_error_code_has_a_stable_distinct_wire_name() {
        let codes = [
            (
                QtToolchainProvisionError::UnsupportedQtVersion { qt_major: 4 },
                "unsupported_qt_version",
            ),
            (
                QtToolchainProvisionError::UnsupportedPlatform {
                    qt_major: 5,
                    platform: "linux".to_string(),
                },
                "unsupported_platform",
            ),
            (
                QtToolchainProvisionError::HostPlatformMismatch {
                    platform: "harmonyos".to_string(),
                    host_platform: "windows",
                },
                "host_platform_mismatch",
            ),
            (
                QtToolchainProvisionError::SourceNotPublished {
                    qt_major: 6,
                    platform: "ohos-pc-aarch64".to_string(),
                },
                "source_not_published",
            ),
            (
                QtToolchainProvisionError::DownloadFailed("x".to_string()),
                "download_failed",
            ),
            (
                QtToolchainProvisionError::ChecksumFetchFailed("x".to_string()),
                "checksum_fetch_failed",
            ),
            (
                QtToolchainProvisionError::ChecksumMismatch {
                    asset_name: "a".to_string(),
                    expected: "b".to_string(),
                    actual: "c".to_string(),
                },
                "checksum_mismatch",
            ),
            (
                QtToolchainProvisionError::ArchiveExtractFailed("x".to_string()),
                "archive_extract_failed",
            ),
            (
                QtToolchainProvisionError::InstallVerificationFailed("x".to_string()),
                "install_verification_failed",
            ),
            (
                QtToolchainProvisionError::PublishFailed("x".to_string()),
                "publish_failed",
            ),
            (
                QtToolchainProvisionError::Cancelled("x".to_string()),
                "cancelled",
            ),
            (
                QtToolchainProvisionError::IoFailed("x".to_string()),
                "io_failed",
            ),
        ];
        for (error, expected) in &codes {
            assert_eq!(error.code_str(), *expected, "unexpected code for {error}");
        }

        let mut names: Vec<&str> = codes.iter().map(|(error, _)| error.code_str()).collect();
        names.sort_unstable();
        let mut unique = names.clone();
        unique.dedup();
        assert_eq!(
            unique.len(),
            names.len(),
            "codes must be distinct: {names:?}"
        );

        // Only the cancellation variant reports a cancellation.
        assert!(QtToolchainProvisionError::Cancelled("x".to_string()).is_cancelled());
        assert!(!QtToolchainProvisionError::IoFailed("x".to_string()).is_cancelled());
    }

    #[test]
    fn every_progress_stage_has_a_stable_wire_name() {
        let stages = [
            (
                QtToolchainInstallStage::CheckingExisting,
                "checking_existing",
            ),
            (QtToolchainInstallStage::Reused, "reused"),
            (
                QtToolchainInstallStage::FetchingChecksum,
                "fetching_checksum",
            ),
            (QtToolchainInstallStage::Downloading, "downloading"),
            (
                QtToolchainInstallStage::VerifyingArchive,
                "verifying_archive",
            ),
            (QtToolchainInstallStage::Extracting, "extracting"),
            (
                QtToolchainInstallStage::VerifyingInstall,
                "verifying_install",
            ),
            (QtToolchainInstallStage::Publishing, "publishing"),
            (QtToolchainInstallStage::Completed, "completed"),
        ];
        for (stage, expected) in stages {
            assert_eq!(stage.as_str(), expected);
        }
    }
    #[test]
    fn the_kit_criteria_mirror_the_scan_owner_constants() {
        // These strings are the values the stage-1 scan measures; this crate
        // does not link the scan owner, so if the owner changes them, this
        // provisioning gate has to be changed with it.
        assert_eq!(QT5_KIT_CMAKE_PACKAGE_DIR, "lib/cmake/Qt5");
        assert_eq!(QT6_KIT_CMAKE_PACKAGE_DIR, "lib/cmake/Qt6");
        assert_eq!(QT_KIT_OHOS_PLATFORM_PLUGIN, "plugins/platforms/libqohos.so");
        assert_eq!(QT_KIT_QMAKE_EXECUTABLES, ["qmake", "qmake.exe"]);
    }
}
