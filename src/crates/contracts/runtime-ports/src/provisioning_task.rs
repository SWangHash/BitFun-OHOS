//! Provisioning-task port.
//!
//! Long-running resource provisioning runs as a detached task kicked off by
//! an answer submit: the submit path is acknowledged immediately, progress is
//! reported on a stable event channel, and the waiting tool is woken at the
//! end — success or failure, so a failed install cannot deadlock the turn.
//! The concrete download/extract/manifest work stays in the service
//! provisioner the port implementation wires.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use tokio_util::sync::CancellationToken;

/// Stable name of the provisioning progress channel.
pub const QT_TOOLCHAIN_PROVISION_EVENT_NAME: &str = "backend-event-qttoolchainprovision";

/// The bound field a provisioning run resolves. Only the toolchain has a
/// provisioner today.
pub const QT_MIGRATION_PROVISIONED_FIELD: &str = "toolchain";

/// Qt generation provisioned for an `__official__` binding.
pub const QT_MIGRATION_OFFICIAL_QT_MAJOR: u8 = 5;

/// Stable code for the one failure the provisioning wiring raises itself: the
/// session workspace is remote, so the kit cannot be installed where the build
/// runs. The provisioner has no code for it because the provisioner is never
/// called.
pub const REMOTE_WORKSPACE_UNSUPPORTED_ERROR_CODE: &str = "remote_workspace_unsupported";

/// Byte delta that forces a progress report during a transfer. The provisioner
/// reports once per HTTP chunk (thousands of times for a real archive), so
/// reports are coalesced to one per stage change plus one per this many bytes.
const PROGRESS_BYTE_STEP: u64 = 512 * 1024;

/// One answer submit that may delegate a field's preparation to a provisioning
/// run. Captured while the submit is still on the stack; the port call returns
/// before the run finishes.
pub struct ProvisioningSubmit {
    /// Session the waiting question belongs to.
    pub session_id: String,
    /// Tool call that must be woken when the run finishes.
    pub tool_id: String,
    /// Validated field bindings the submit normalized.
    pub bindings: BTreeMap<String, String>,
    /// Raw submitted answers, delivered unchanged to the waiting tool.
    pub answers: serde_json::Value,
    /// The session workspace lives on another host: the run reports
    /// [`REMOTE_WORKSPACE_UNSUPPORTED_ERROR_CODE`] instead of installing
    /// locally.
    pub remote_workspace: bool,
    /// Cancellation of the dialog turn that owns the waiting question.
    /// Cancelling the turn stops the run and cleans its staging directory.
    pub cancel: CancellationToken,
}

/// What to provision, resolved by the port implementation from a submit.
pub struct ProvisioningRequest {
    /// Session the waiting question belongs to.
    pub session_id: String,
    /// Tool call that must be woken when the run finishes.
    pub tool_id: String,
    /// Raw submitted answers, delivered unchanged to the waiting tool.
    pub answers: serde_json::Value,
    /// Whether the session workspace is remote (see
    /// [`ProvisioningSubmit::remote_workspace`]).
    pub remote_workspace: bool,
    /// Cancellation of the dialog turn that owns the waiting question.
    pub cancel: CancellationToken,
    /// Qt generation of the managed kit this run installs.
    pub qt_major: u8,
    /// Layout platform token, matching the manifest and layout tokens the
    /// provisioner resolves.
    pub platform: String,
    /// Managed toolchains root the kit installs into.
    pub toolchains_root: PathBuf,
}

/// A provisioning run started by an answer submit. Implementations are
/// registered at product-assembly construction time; the submit path only
/// sees this trait.
pub trait ProvisioningTaskPort: Send + Sync {
    /// Whether these validated bindings delegate a field's preparation to a
    /// provisioning run, and the facts that run needs. `None` means this
    /// submit provisions nothing and the caller continues its own path.
    fn plan(&self, submit: &ProvisioningSubmit) -> Option<ProvisioningRequest>;

    /// Start the run for `request` on a detached task and return immediately:
    /// this is the submit's early ack. The run owns progress reporting on
    /// [`QT_TOOLCHAIN_PROVISION_EVENT_NAME`] and must wake the waiting tool at
    /// the end whether the install succeeded or failed, so a failure cannot
    /// deadlock the turn.
    fn spawn(&self, request: ProvisioningRequest);
}

/// One progress step of a provisioning run, as the port sees it. The run
/// identity (session, tool, kit generation, platform) is carried by the
/// [`ProvisioningProgressBridge`], not by the step.
pub struct ProvisioningProgress {
    /// Provisioner stage token as it appears on the wire.
    pub stage: &'static str,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    /// Stable wire name of the checksum state.
    pub checksum_status: &'static str,
}

/// One report on [`QT_TOOLCHAIN_PROVISION_EVENT_NAME`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProvisioningReport {
    pub tool_id: String,
    pub session_id: String,
    pub qt_major: u8,
    pub platform: String,
    pub status: &'static str,
    pub stage: Option<&'static str>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub checksum_status: Option<&'static str>,
    pub error_code: Option<&'static str>,
    pub kit_root: Option<String>,
}

impl ProvisioningReport {
    /// A report while a run is in flight.
    pub fn running(
        session_id: &str,
        tool_id: &str,
        qt_major: u8,
        platform: &str,
        stage: &'static str,
        downloaded_bytes: u64,
        total_bytes: Option<u64>,
        checksum_status: Option<&'static str>,
    ) -> Self {
        Self {
            tool_id: tool_id.to_string(),
            session_id: session_id.to_string(),
            qt_major,
            platform: platform.to_string(),
            status: "running",
            stage: Some(stage),
            downloaded_bytes,
            total_bytes,
            checksum_status,
            error_code: None,
            kit_root: None,
        }
    }

    /// A report after a published kit exists.
    pub fn succeeded(
        session_id: &str,
        tool_id: &str,
        qt_major: u8,
        platform: &str,
        stage: &'static str,
        checksum_status: Option<&'static str>,
        kit_root: &str,
    ) -> Self {
        Self {
            tool_id: tool_id.to_string(),
            session_id: session_id.to_string(),
            qt_major,
            platform: platform.to_string(),
            status: "succeeded",
            stage: Some(stage),
            downloaded_bytes: 0,
            total_bytes: None,
            checksum_status,
            error_code: None,
            kit_root: Some(kit_root.to_string()),
        }
    }

    /// A report after a failed run, carrying the provisioner's stable code.
    pub fn failed(
        session_id: &str,
        tool_id: &str,
        qt_major: u8,
        platform: &str,
        error_code: &'static str,
    ) -> Self {
        Self {
            tool_id: tool_id.to_string(),
            session_id: session_id.to_string(),
            qt_major,
            platform: platform.to_string(),
            status: "failed",
            stage: None,
            downloaded_bytes: 0,
            total_bytes: None,
            checksum_status: None,
            error_code: Some(error_code),
            kit_root: None,
        }
    }

    /// The event payload. The schema is closed: every documented key is
    /// always present, and absent facts serialize as `null`.
    pub fn payload(&self) -> serde_json::Value {
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

/// Bridges the provisioner's synchronous per-chunk callback onto the event
/// channel, coalescing reports so a real archive cannot flood the frontend.
pub struct ProvisioningProgressBridge {
    session_id: String,
    tool_id: String,
    qt_major: u8,
    platform: String,
    last_emitted_bytes: AtomicU64,
    last_emitted_stage: Mutex<Option<&'static str>>,
}

impl ProvisioningProgressBridge {
    pub fn new(session_id: String, tool_id: String, qt_major: u8, platform: String) -> Self {
        Self {
            session_id,
            tool_id,
            qt_major,
            platform,
            last_emitted_bytes: AtomicU64::new(0),
            last_emitted_stage: Mutex::new(None),
        }
    }

    /// Coalescing decision and report construction, separated from emission so
    /// the rule is testable without a runtime. `None` means "coalesced away".
    pub fn take_report(&self, progress: ProvisioningProgress) -> Option<ProvisioningReport> {
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

        Some(ProvisioningReport::running(
            &self.session_id,
            &self.tool_id,
            self.qt_major,
            &self.platform,
            progress.stage,
            progress.downloaded_bytes,
            progress.total_bytes,
            Some(progress.checksum_status),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn progress(stage: &'static str, downloaded_bytes: u64) -> ProvisioningProgress {
        ProvisioningProgress {
            stage,
            downloaded_bytes,
            total_bytes: Some(16 * 1024 * 1024),
            checksum_status: "not_published",
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
    fn running_payload_keeps_the_documented_schema() {
        let report = ProvisioningReport::running(
            "session-1",
            "tool-1",
            5,
            "harmonyos",
            "downloading",
            4096,
            Some(16 * 1024 * 1024),
            Some("not_published"),
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
        let payload =
            ProvisioningReport::failed("session-1", "tool-1", 5, "harmonyos", "checksum_mismatch")
                .payload();
        assert_eq!(payload["status"], "failed");
        assert_eq!(payload["errorCode"], "checksum_mismatch");
        assert!(payload["kitRoot"].is_null());
        assert!(payload["stage"].is_null());
        assert!(payload["checksumStatus"].is_null());
    }

    #[test]
    fn success_payload_carries_the_kit_root() {
        let payload = ProvisioningReport::succeeded(
            "session-1",
            "tool-1",
            5,
            "harmonyos",
            "completed",
            Some("not_published"),
            "/root/toolchains/qt5.12.12",
        )
        .payload();
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
        assert!(bridge.take_report(progress("downloading", 1024)).is_some());
        // Same stage, tiny delta: coalesced away.
        assert!(bridge.take_report(progress("downloading", 2048)).is_none());
        // Same stage, the byte step was reached: emitted.
        assert!(bridge
            .take_report(progress("downloading", 1024 + PROGRESS_BYTE_STEP))
            .is_some());
        // A stage change is always emitted, even without new bytes.
        assert!(bridge
            .take_report(progress("extracting", 1024 + PROGRESS_BYTE_STEP))
            .is_some());
    }

    #[test]
    fn progress_reports_carry_the_run_identity() {
        // The frontend routes the update by tool id, so a coalesced report must
        // keep the identity of the run it belongs to.
        let report = bridge()
            .take_report(progress("downloading", 4096))
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
