//! Maps the concrete `qt_toolchain` provisioner's outcomes and progress onto
//! the neutral provisioning-report port types; kept dependency-free for the
//! isolated contract tests.

use bitfun_runtime_ports::{ProvisioningProgress, ProvisioningReport};
use bitfun_services_integrations::qt_toolchain::{
    QtToolchainChecksumStatus, QtToolchainInstallProgress, QtToolchainInstallStage,
    QtToolchainProvisionError, QtToolchainProvisionOutcome, QtToolchainProvisionRequest,
};

/// A report after a published kit exists.
pub(crate) fn report_from_outcome(
    session_id: &str,
    tool_id: &str,
    outcome: &QtToolchainProvisionOutcome,
) -> ProvisioningReport {
    ProvisioningReport::succeeded(
        session_id,
        tool_id,
        outcome.qt_major,
        &outcome.platform,
        QtToolchainInstallStage::Completed.as_str(),
        Some(checksum_status_name(outcome.checksum_status)),
        &outcome.kit_root.to_string_lossy(),
    )
}

/// A report after a failed run, carrying the provisioner's stable code.
pub(crate) fn report_from_error(
    session_id: &str,
    tool_id: &str,
    request: &QtToolchainProvisionRequest,
    error: &QtToolchainProvisionError,
) -> ProvisioningReport {
    report_from_wiring_failure(session_id, tool_id, request, error.code_str())
}

/// A wiring-layer failure with no provisioner cause, reported in the same shape.
pub(crate) fn report_from_wiring_failure(
    session_id: &str,
    tool_id: &str,
    request: &QtToolchainProvisionRequest,
    error_code: &'static str,
) -> ProvisioningReport {
    ProvisioningReport::failed(
        session_id,
        tool_id,
        request.qt_major,
        &request.platform,
        error_code,
    )
}

/// One progress step of a transfer; run identity is carried by the bridge.
pub(crate) fn neutral_progress(progress: &QtToolchainInstallProgress) -> ProvisioningProgress {
    ProvisioningProgress {
        stage: progress.stage.as_str(),
        downloaded_bytes: progress.downloaded_bytes,
        total_bytes: progress.total_bytes,
        checksum_status: checksum_status_name(progress.checksum_status),
    }
}

/// Stable wire name of a checksum state: the payload reports what the provisioner
/// measured instead of implying the archive was verified.
pub(crate) fn checksum_status_name(status: QtToolchainChecksumStatus) -> &'static str {
    match status {
        QtToolchainChecksumStatus::NotPublished => "not_published",
        QtToolchainChecksumStatus::Pending => "pending",
        QtToolchainChecksumStatus::Verified => "verified",
        QtToolchainChecksumStatus::NotApplicable => "not_applicable",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> QtToolchainProvisionRequest {
        QtToolchainProvisionRequest::new(5, "harmonyos", "/root/toolchains")
    }

    #[test]
    fn outcome_maps_to_a_succeeded_payload() {
        let outcome = QtToolchainProvisionOutcome {
            qt_major: 5,
            platform: "harmonyos".to_string(),
            kit_root: std::path::PathBuf::from("/root/toolchains/qt5.12.12"),
            reused_existing_kit: true,
            asset_name: "Qt-5.12.12-arm64-v8a-harmonyos-gles.zip".to_string(),
            asset_url: "https://example/qt5.zip".to_string(),
            archive_kind: bitfun_services_integrations::qt_toolchain::QtToolchainArchiveKind::Zip,
            checksum_status: QtToolchainChecksumStatus::NotPublished,
            downloaded_bytes: 0,
        };
        let payload = report_from_outcome("session-1", "tool-1", &outcome).payload();
        assert_eq!(payload["toolId"], "tool-1");
        assert_eq!(payload["sessionId"], "session-1");
        assert_eq!(payload["qtMajor"], 5);
        assert_eq!(payload["platform"], "harmonyos");
        assert_eq!(payload["status"], "succeeded");
        assert_eq!(payload["stage"], "completed");
        assert_eq!(payload["kitRoot"], "/root/toolchains/qt5.12.12");
        assert_eq!(payload["checksumStatus"], "not_published");
        assert!(payload["errorCode"].is_null());
    }

    #[test]
    fn provisioner_error_maps_to_its_stable_code() {
        let error = QtToolchainProvisionError::ChecksumMismatch {
            asset_name: "Qt-5.12.12-arm64-v8a-harmonyos-gles.zip".to_string(),
            expected: "aa".to_string(),
            actual: "bb".to_string(),
        };
        let payload = report_from_error("session-1", "tool-1", &request(), &error).payload();
        assert_eq!(payload["status"], "failed");
        assert_eq!(payload["errorCode"], "checksum_mismatch");
        assert_eq!(payload["qtMajor"], 5);
        assert_eq!(payload["platform"], "harmonyos");
        assert!(payload["kitRoot"].is_null());
        assert!(payload["stage"].is_null());
        assert!(payload["checksumStatus"].is_null());
    }

    #[test]
    fn wiring_failure_reports_the_same_shape() {
        let payload = report_from_wiring_failure(
            "session-1",
            "tool-1",
            &request(),
            "remote_workspace_unsupported",
        )
        .payload();
        assert_eq!(payload["status"], "failed");
        assert_eq!(payload["errorCode"], "remote_workspace_unsupported");
        assert!(payload["kitRoot"].is_null());
    }

    #[test]
    fn progress_maps_to_the_neutral_step() {
        let progress = QtToolchainInstallProgress {
            qt_major: 5,
            platform: "harmonyos".to_string(),
            stage: QtToolchainInstallStage::Downloading,
            downloaded_bytes: 4096,
            total_bytes: Some(16 * 1024 * 1024),
            checksum_status: QtToolchainChecksumStatus::NotPublished,
        };
        let step = neutral_progress(&progress);
        assert_eq!(step.stage, "downloading");
        assert_eq!(step.downloaded_bytes, 4096);
        assert_eq!(step.total_bytes, Some(16 * 1024 * 1024));
        assert_eq!(step.checksum_status, "not_published");
    }
}
