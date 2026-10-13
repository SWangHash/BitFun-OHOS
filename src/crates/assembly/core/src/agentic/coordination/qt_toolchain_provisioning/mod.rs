//! Host wiring of the Qt migration toolchain provisioning: the
//! `ProvisioningTaskPort` implementation that provisions the managed kit on
//! an answer submit and wakes the waiting tool.

mod decision;
mod report;

use std::sync::{Arc, LazyLock};

use bitfun_qt_migration::state::qt_migration_apply_validated_answers;
use bitfun_runtime_ports::{
    ProvisioningProgressBridge, ProvisioningReport, ProvisioningRequest, ProvisioningSubmit,
    ProvisioningTaskPort, QT_MIGRATION_OFFICIAL_QT_MAJOR, QT_MIGRATION_PROVISIONED_FIELD,
    QT_TOOLCHAIN_PROVISION_EVENT_NAME, REMOTE_WORKSPACE_UNSUPPORTED_ERROR_CODE,
};
use bitfun_services_integrations::qt_toolchain::{
    provision_qt_toolchain, QtToolchainInstallProgress, QtToolchainProvisionRequest,
};
use log::{info, warn};

use crate::agentic::session::SessionManager;
use crate::infrastructure::events::{emit_global_event, BackendEvent};

/// Serializes provisioning runs process-wide.
static PROVISIONING_SERIALIZER: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// The port implementation for the managed Qt toolchain kit.
pub(crate) struct OfficialToolchainProvisioning {
    session_manager: Arc<SessionManager>,
}

impl OfficialToolchainProvisioning {
    pub(crate) fn new(session_manager: Arc<SessionManager>) -> Self {
        Self { session_manager }
    }
}

impl ProvisioningTaskPort for OfficialToolchainProvisioning {
    fn plan(&self, submit: &ProvisioningSubmit) -> Option<ProvisioningRequest> {
        if !decision::binding_requires_toolchain_provisioning(&submit.bindings) {
            return None;
        }
        Some(ProvisioningRequest {
            session_id: submit.session_id.clone(),
            tool_id: submit.tool_id.clone(),
            answers: submit.answers.clone(),
            remote_workspace: submit.remote_workspace,
            cancel: submit.cancel.clone(),
            qt_major: QT_MIGRATION_OFFICIAL_QT_MAJOR,
            // The provisioner resolves the same layout platform tokens the
            // knowledge-base scripts use, so manual and runtime paths cannot
            // drift apart.
            platform: bitfun_qt_migration::instructions::download_platform().to_string(),
            // Managed toolchains root (`path_manager.qt_migration_toolchains_dir`).
            toolchains_root: crate::infrastructure::get_path_manager_arc()
                .qt_migration_toolchains_dir(),
        })
    }

    fn spawn(&self, request: ProvisioningRequest) {
        info!(
            "Starting runtime Qt toolchain provisioning: session_id={}, tool_id={}, qt_major={}, platform={}, toolchains_root={}, remote_workspace={}",
            request.session_id,
            request.tool_id,
            request.qt_major,
            request.platform,
            request.toolchains_root.display(),
            request.remote_workspace
        );
        tokio::spawn(run_official_toolchain_provisioning(
            request,
            Arc::clone(&self.session_manager),
        ));
    }
}

/// The provisioning task: install, resolve the field, wake the turn — always
/// waking it, including on failure.
async fn run_official_toolchain_provisioning(
    request: ProvisioningRequest,
    session_manager: Arc<SessionManager>,
) {
    let tool_id = request.tool_id.clone();
    let session_id = request.session_id.clone();
    let answers = request.answers.clone();
    let provision_request = QtToolchainProvisionRequest::new(
        request.qt_major,
        request.platform.clone(),
        request.toolchains_root.clone(),
    );

    let finished = if request.remote_workspace {
        warn!(
            "Qt toolchain provisioning is not supported for a remote workspace: session_id={}, tool_id={}, platform={}, code={}",
            session_id, tool_id, provision_request.platform, REMOTE_WORKSPACE_UNSUPPORTED_ERROR_CODE
        );
        report::report_from_wiring_failure(
            &session_id,
            &tool_id,
            &provision_request,
            REMOTE_WORKSPACE_UNSUPPORTED_ERROR_CODE,
        )
    } else {
        let result = {
            // Serialize process-wide (see PROVISIONING_SERIALIZER). A turn
            // cancelled while waiting reaches the provisioner with an already
            // cancelled token, which fails as `cancelled` immediately.
            let _serialized = PROVISIONING_SERIALIZER.lock().await;
            let bridge = Arc::new(ProvisioningProgressBridge::new(
                session_id.clone(),
                tool_id.clone(),
                request.qt_major,
                request.platform.clone(),
            ));
            let on_progress = {
                let bridge = Arc::clone(&bridge);
                move |progress: QtToolchainInstallProgress| {
                    if let Some(report) = bridge.take_report(report::neutral_progress(&progress)) {
                        // Fire-and-forget: the callback is synchronous and must not
                        // block the transfer on event delivery.
                        tokio::spawn(emit_provisioning_event(report));
                    }
                }
            };
            provision_qt_toolchain(&provision_request, request.cancel.clone(), on_progress).await
        };

        match result {
            Ok(outcome) => {
                let kit_root = outcome.kit_root.to_string_lossy().into_owned();
                info!(
                    "Qt toolchain provisioning succeeded: session_id={}, tool_id={}, qt_major={}, platform={}, reused_existing_kit={}, checksum_verified={}, kit_root={}",
                    session_id,
                    tool_id,
                    outcome.qt_major,
                    outcome.platform,
                    outcome.reused_existing_kit,
                    outcome.checksum_status.is_verified(),
                    kit_root
                );
                // D7: the field resolution the engine renders now carries the real
                // path. The recorded answers (and the persisted intake write that
                // already happened) stay untouched.
                resolve_bound_toolchain_field(&session_manager, &session_id, &kit_root).await;
                report::report_from_outcome(&session_id, &tool_id, &outcome)
            }
            Err(error) => {
                warn!(
                    "Qt toolchain provisioning failed: session_id={}, tool_id={}, qt_major={}, platform={}, code={}, error={}",
                    session_id,
                    tool_id,
                    provision_request.qt_major,
                    provision_request.platform,
                    error.code_str(),
                    error
                );
                report::report_from_error(&session_id, &tool_id, &provision_request, &error)
            }
        }
    };
    emit_provisioning_event(finished).await;

    // The install is finished, so the bound toolchain value is now a real kit path and
    // the generation check can measure it. It runs here, on the success *and* the
    // failure path, because this is the point where the turn is about to be woken: a
    // measured mismatch records the pending strategy question (derived `Blocked`) and
    // the model is told to ask the user before any migration side effect
    // (`qt_migration_version_gate`).
    crate::agentic::coordination::record_version_mismatch_if_any(&session_manager, &session_id)
        .await;

    // C7: the turn is woken on both paths. Failing here is not a deadlock (the
    // waiting tool's own cancellation settles it), but it is worth a warning: it
    // means nobody will consume the answers.
    if let Err(error) = crate::agentic::tools::user_input_manager::get_user_input_manager()
        .send_answer(&tool_id, answers)
    {
        warn!(
            "Qt toolchain provisioning could not deliver the submitted answers: session_id={}, tool_id={}, error={}",
            session_id, tool_id, error
        );
    }
}

/// Writes the installed kit root into the session intake snapshot, so the field
/// keeps its resolved state and takes the real path as its value.
async fn resolve_bound_toolchain_field(
    session_manager: &SessionManager,
    session_id: &str,
    kit_root: &str,
) {
    use bitfun_qt_migration::admission::QT_MIGRATION_SLOT_INTAKE_STATE;
    use bitfun_qt_migration::state::{
        intake_snapshot_from_slot_value, intake_snapshot_to_slot_value,
    };
    let current = intake_snapshot_from_slot_value(
        session_manager.domain_state_get(session_id, &QT_MIGRATION_SLOT_INTAKE_STATE),
    );
    if !current.fields.contains_key(QT_MIGRATION_PROVISIONED_FIELD) {
        warn!(
            "Qt toolchain provisioning finished for a session whose intake snapshot no longer holds the toolchain field; leaving it unchanged: session_id={}",
            session_id
        );
        return;
    }
    let mut bindings = std::collections::BTreeMap::new();
    bindings.insert(
        QT_MIGRATION_PROVISIONED_FIELD.to_string(),
        kit_root.to_string(),
    );
    let updated = qt_migration_apply_validated_answers(&current, &bindings);
    session_manager
        .domain_state_set(
            session_id,
            &QT_MIGRATION_SLOT_INTAKE_STATE,
            intake_snapshot_to_slot_value(&updated),
        )
        .await;
}

/// Emits one report on the provisioning channel. A failed emission is logged, not
/// propagated: the channel is an observation surface, and the turn must be woken
/// regardless.
async fn emit_provisioning_event(report: ProvisioningReport) {
    let payload = report.payload();
    if let Err(error) = emit_global_event(BackendEvent::Custom {
        event_name: QT_TOOLCHAIN_PROVISION_EVENT_NAME.to_string(),
        payload,
    })
    .await
    {
        warn!(
            "Failed to emit the Qt toolchain provisioning event: status={}, error={}",
            report.status, error
        );
    }
}
