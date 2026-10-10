//! Stable facts of the Qt toolchain provisioning channel
//! , kept free of session, event, and runtime dependencies.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use bitfun_agent_runtime::qt_migration_intake_state::QT_MIGRATION_OFFICIAL_VALUE;
use bitfun_services_integrations::qt_toolchain::{
    QtToolchainChecksumStatus, QtToolchainInstallProgress, QtToolchainInstallStage,
    QtToolchainProvisionError, QtToolchainProvisionOutcome, QtToolchainProvisionRequest,
};

/// Stable name of the provisioning progress channel
/// .
pub(crate) const QT_TOOLCHAIN_PROVISION_EVENT_NAME: &str = "backend-event-qttoolchainprovision";

/// The bound field this module resolves. Only the toolchain has a provisioner.
pub(crate) const QT_MIGRATION_PROVISIONED_FIELD: &str = "toolchain";

/// Qt generation provisioned for an `__official__` binding.
pub(crate) const QT_MIGRATION_OFFICIAL_QT_MAJOR: u8 = 5;

/// Stable code for the one failure the wiring layer raises itself (D12): the
/// session workspace is remote, so the kit cannot be installed where the build
/// runs. The provisioner has no code for it because the provisioner is never
/// called.
pub(crate) const REMOTE_WORKSPACE_UNSUPPORTED_ERROR_CODE: &str = "remote_workspace_unsupported";

/// Byte delta that forces a progress report during a transfer. The provisioner
/// reports once per HTTP chunk (thousands of times for a real archive), so
/// reports are coalesced to one per stage change plus one per this many bytes.
const PROGRESS_BYTE_STEP: u64 = 512 * 1024;

/// Whether the submitted bindings delegate toolchain preparation to the runtime.
pub(crate) fn binding_requires_toolchain_provisioning(bindings: &BTreeMap<String, String>) -> bool {
    bindings
        .get(QT_MIGRATION_PROVISIONED_FIELD)
        .is_some_and(|value| value == QT_MIGRATION_OFFICIAL_VALUE)
}

/// One report on [`QT_TOOLCHAIN_PROVISION_EVENT_NAME`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProvisioningReport {
    pub(crate) tool_id: String,
    pub(crate) session_id: String,
    pub(crate) qt_major: u8,
    pub(crate) platform: String,
    pub(crate) status: &'static str,
    pub(crate) stage: Option<&'static str>,
    pub(crate) downloaded_bytes: u64,
    pub(crate) total_bytes: Option<u64>,
    pub(crate) checksum_status: Option<&'static str>,
    pub(crate) error_code: Option<&'static str>,
    pub(crate) kit_root: Option<String>,
}

impl ProvisioningReport {
    /// A report while a run is in flight.
    pub(crate) fn from_progress(
        session_id: &str,
        tool_id: &str,
        progress: &QtToolchainInstallProgress,
    ) -> Self {
        Self {
            tool_id: tool_id.to_string(),
            session_id: session_id.to_string(),
            qt_major: progress.qt_major,
            platform: progress.platform.clone(),
            status: "running",
            stage: Some(progress.stage.as_str()),
            downloaded_bytes: progress.downloaded_bytes,
            total_bytes: progress.total_bytes,
            checksum_status: Some(checksum_status_name(progress.checksum_status)),
            error_code: None,
            kit_root: None,
        }
    }

    /// A report after a published kit exists.
    pub(crate) fn from_outcome(
        session_id: &str,
        tool_id: &str,
        outcome: &QtToolchainProvisionOutcome,
    ) -> Self {
        Self {
            tool_id: tool_id.to_string(),
            session_id: session_id.to_string(),
            qt_major: outcome.qt_major,
            platform: outcome.platform.clone(),
            status: "succeeded",
            stage: Some(QtToolchainInstallStage::Completed.as_str()),
            downloaded_bytes: outcome.downloaded_bytes,
            total_bytes: None,
            checksum_status: Some(checksum_status_name(outcome.checksum_status)),
            error_code: None,
            kit_root: Some(outcome.kit_root.to_string_lossy().into_owned()),
        }
    }

    /// A report after a failed run, carrying the provisioner's stable code (C6).
    pub(crate) fn from_error(
        session_id: &str,
        tool_id: &str,
        request: &QtToolchainProvisionRequest,
        error: &QtToolchainProvisionError,
    ) -> Self {
        Self::from_wiring_failure(session_id, tool_id, request, error.code_str())
    }

    /// A failure the wiring layer decides on its own (there is no provisioner
    /// failure to carry), reported on the same channel and in the same shape.
    pub(crate) fn from_wiring_failure(
        session_id: &str,
        tool_id: &str,
        request: &QtToolchainProvisionRequest,
        error_code: &'static str,
    ) -> Self {
        Self {
            tool_id: tool_id.to_string(),
            session_id: session_id.to_string(),
            qt_major: request.qt_major,
            platform: request.platform.clone(),
            status: "failed",
            stage: None,
            downloaded_bytes: 0,
            total_bytes: None,
            checksum_status: None,
            error_code: Some(error_code),
            kit_root: None,
        }
    }

    pub(crate) fn payload(&self) -> serde_json::Value {
        serde_json::json!({
            "toolId": self.tool_id,
            "sessionId": self.session_id,
            "field": QT_MIGRATION_PROVISIONED_FIELD,
            "qtMajor": self.qt_major,
            "platform": self.platform,
            "status": self.status,
            "stage": self.stage,
            "downloadedBytes": self.downloaded_bytes,
            "totalBytes": self.total_bytes,
            "checksumStatus": self.checksum_status,
            "errorCode": self.error_code,
            "kitRoot": self.kit_root,
        })
    }
}

/// Stable wire name of a checksum state: the payload reports what the provisioner
/// measured instead of implying the archive was verified.
fn checksum_status_name(status: QtToolchainChecksumStatus) -> &'static str {
    match status {
        QtToolchainChecksumStatus::NotPublished => "not_published",
        QtToolchainChecksumStatus::Pending => "pending",
        QtToolchainChecksumStatus::Verified => "verified",
        QtToolchainChecksumStatus::NotApplicable => "not_applicable",
    }
}

/// Bridges the provisioner's synchronous per-chunk callback onto the event
/// channel, coalescing reports so a real archive cannot flood the frontend.
pub(crate) struct ProvisioningProgressBridge {
    session_id: String,
    tool_id: String,
    qt_major: u8,
    platform: String,
    last_emitted_bytes: AtomicU64,
    last_emitted_stage: Mutex<Option<QtToolchainInstallStage>>,
}

impl ProvisioningProgressBridge {
    pub(crate) fn new(session_id: String, tool_id: String, qt_major: u8, platform: String) -> Self {
        Self {
            session_id,
            tool_id,
            qt_major,
            platform,
            last_emitted_bytes: AtomicU64::new(0),
            last_emitted_stage: Mutex::new(None),
        }
    }

    /// Coalescing decision and report construction, separated from emission so the
    /// rule is testable without a runtime. `None` means "coalesced away".
    pub(crate) fn take_report(
        &self,
        progress: QtToolchainInstallProgress,
    ) -> Option<ProvisioningReport> {
        let stage_changed = {
            let mut last = self
                .last_emitted_stage
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if *last == Some(progress.stage) {
                false
            } else {
                *last = Some(progress.stage);
                true
            }
        };
        let last_bytes = self.last_emitted_bytes.load(Ordering::Relaxed);
        let bytes_delta = progress.downloaded_bytes.saturating_sub(last_bytes);
        if !stage_changed && bytes_delta < PROGRESS_BYTE_STEP {
            return None;
        }
        self.last_emitted_bytes
            .store(progress.downloaded_bytes, Ordering::Relaxed);

        let mut report =
            ProvisioningReport::from_progress(&self.session_id, &self.tool_id, &progress);
        report.qt_major = self.qt_major;
        report.platform = self.platform.clone();
        Some(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn official_bindings() -> BTreeMap<String, String> {
        let mut bindings = BTreeMap::new();
        bindings.insert("source_project".to_string(), "D:/work/myqt".to_string());
        bindings.insert(
            "toolchain".to_string(),
            QT_MIGRATION_OFFICIAL_VALUE.to_string(),
        );
        bindings
    }

    fn progress(
        stage: QtToolchainInstallStage,
        downloaded_bytes: u64,
    ) -> QtToolchainInstallProgress {
        QtToolchainInstallProgress {
            qt_major: 5,
            platform: "harmonyos".to_string(),
            stage,
            downloaded_bytes,
            total_bytes: Some(16 * 1024 * 1024),
            checksum_status: QtToolchainChecksumStatus::NotPublished,
        }
    }

    fn bridge() -> ProvisioningProgressBridge {
        ProvisioningProgressBridge::new(
            "session-1".to_string(),
            "tool-1".to_string(),
            5,
            "windows".to_string(),
        )
    }

    #[test]
    fn only_the_official_toolchain_binding_triggers_provisioning() {
        assert!(binding_requires_toolchain_provisioning(&official_bindings()));

        // A concrete path keeps the existing path: the user supplied the kit.
        let mut explicit = official_bindings();
        explicit.insert("toolchain".to_string(), "D:/sdk/qt5.12.12".to_string());
        assert!(!binding_requires_toolchain_provisioning(&explicit));

        // A template-only `__official__` binding has no provisioner (the manifest
        // holds no template download), so it must not start one.
        let mut template_only = official_bindings();
        template_only.insert("toolchain".to_string(), "D:/sdk/qt5.12.12".to_string());
        template_only.insert(
            "template".to_string(),
            QT_MIGRATION_OFFICIAL_VALUE.to_string(),
        );
        assert!(!binding_requires_toolchain_provisioning(&template_only));

        // Missing field: nothing to provision.
        let mut missing = official_bindings();
        missing.remove("toolchain");
        assert!(!binding_requires_toolchain_provisioning(&missing));
    }

    #[test]
    fn running_payload_keeps_the_documented_schema() {
        let report = ProvisioningReport::from_progress(
            "session-1",
            "tool-1",
            &progress(QtToolchainInstallStage::Downloading, 4096),
        );
        let payload = report.payload();
        assert_eq!(payload["toolId"], "tool-1");
        assert_eq!(payload["sessionId"], "session-1");
        assert_eq!(payload["field"], "toolchain");
        assert_eq!(payload["qtMajor"], 5);
        assert_eq!(payload["platform"], "harmonyos");
        assert_eq!(payload["status"], "running");
        assert_eq!(payload["stage"], "downloading");
        assert_eq!(payload["downloadedBytes"], 4096);
        assert_eq!(payload["totalBytes"], 16 * 1024 * 1024);
        assert_eq!(payload["checksumStatus"], "not_published");
        assert!(payload["errorCode"].is_null());
        assert!(payload["kitRoot"].is_null());
        // The schema is closed: every documented key is always present.
        assert_eq!(payload.as_object().expect("object payload").len(), 12);
    }

    #[test]
    fn failure_payload_carries_the_stable_provisioner_code() {
        let request = QtToolchainProvisionRequest::new(5, "harmonyos", "/root/toolchains");
        let error = QtToolchainProvisionError::ChecksumMismatch {
            asset_name: "Qt-5.12.12-arm64-v8a-harmonyos-gles.zip".to_string(),
            expected: "aa".to_string(),
            actual: "bb".to_string(),
        };
        let payload =
            ProvisioningReport::from_error("session-1", "tool-1", &request, &error).payload();
        assert_eq!(payload["status"], "failed");
        assert_eq!(payload["errorCode"], "checksum_mismatch");
        assert!(payload["kitRoot"].is_null());
        assert!(payload["stage"].is_null());
        assert!(payload["checksumStatus"].is_null());
    }
    #[test]
    fn success_payload_carries_the_kit_root() {
        let outcome = QtToolchainProvisionOutcome {
            qt_major: 5,
            platform: "harmonyos".to_string(),
            kit_root: PathBuf::from("/root/toolchains/qt5.12.12"),
            reused_existing_kit: true,
            asset_name: "Qt-5.12.12-arm64-v8a-harmonyos-gles.zip".to_string(),
            asset_url: "https://example/qt5.zip".to_string(),
            archive_kind: bitfun_services_integrations::qt_toolchain::QtToolchainArchiveKind::Zip,
            checksum_status: QtToolchainChecksumStatus::NotPublished,
            downloaded_bytes: 0,
        };
        let payload = ProvisioningReport::from_outcome("session-1", "tool-1", &outcome).payload();
        assert_eq!(payload["status"], "succeeded");
        assert_eq!(payload["stage"], "completed");
        assert_eq!(payload["kitRoot"], "/root/toolchains/qt5.12.12");
        assert!(payload["errorCode"].is_null());
        assert_eq!(payload["checksumStatus"], "not_published");
    }

    #[test]
    fn progress_reports_are_coalesced_by_stage_and_byte_step() {
        let bridge = bridge();
        // First report of a stage is always emitted.
        assert!(bridge
            .take_report(progress(QtToolchainInstallStage::Downloading, 1024))
            .is_some());
        // Same stage, tiny delta: coalesced away.
        assert!(bridge
            .take_report(progress(QtToolchainInstallStage::Downloading, 2048))
            .is_none());
        // Same stage, the byte step was reached: emitted.
        assert!(bridge
            .take_report(progress(
                QtToolchainInstallStage::Downloading,
                1024 + PROGRESS_BYTE_STEP
            ))
            .is_some());
        // A stage change is always emitted, even without new bytes.
        assert!(bridge
            .take_report(progress(
                QtToolchainInstallStage::Extracting,
                1024 + PROGRESS_BYTE_STEP
            ))
            .is_some());
    }

    #[test]
    fn progress_reports_carry_the_run_identity() {
        // The frontend routes the update by tool id, so a coalesced report must
        // keep the identity of the run it belongs to.
        let report = bridge()
            .take_report(progress(QtToolchainInstallStage::Downloading, 4096))
            .expect("first report is emitted");
        assert_eq!(report.tool_id, "tool-1");
        assert_eq!(report.session_id, "session-1");
        assert_eq!(report.qt_major, 5);
        assert_eq!(report.platform, "windows");
        assert_eq!(report.stage, Some("downloading"));
        assert_eq!(report.status, "running");
    }

    #[test]
    fn provisioning_channel_name_is_stable_and_surface_routable() {
        assert_eq!(
            QT_TOOLCHAIN_PROVISION_EVENT_NAME,
            "backend-event-qttoolchainprovision"
        );
        assert!(QT_TOOLCHAIN_PROVISION_EVENT_NAME.starts_with("backend-event-"));
    }
}
