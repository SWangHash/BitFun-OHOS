//! Stage-3 wiring of the Qt migration toolchain provisioning
//! .

mod contracts;

use std::path::PathBuf;
use std::sync::{Arc, LazyLock};

use bitfun_agent_runtime::qt_migration_intake_state::{
    qt_migration_apply_validated_answers, QtMigrationIntakeStateSnapshot,
};
use bitfun_services_integrations::qt_toolchain::{
    provision_qt_toolchain, QtToolchainInstallProgress, QtToolchainProvisionRequest,
};
use log::{info, warn};
use tokio_util::sync::CancellationToken;

use crate::agentic::session::SessionManager;
use crate::infrastructure::events::{emit_global_event, BackendEvent};

pub(crate) use contracts::{
    binding_requires_toolchain_provisioning, QT_MIGRATION_OFFICIAL_QT_MAJOR,
    QT_MIGRATION_PROVISIONED_FIELD, QT_TOOLCHAIN_PROVISION_EVENT_NAME,
    REMOTE_WORKSPACE_UNSUPPORTED_ERROR_CODE,
};
use contracts::{ProvisioningProgressBridge, ProvisioningReport};

/// Serializes provisioning runs process-wide.
static PROVISIONING_SERIALIZER: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Everything the provisioning task needs, captured while the submit is still on
/// the stack (the port call returns before the transfer finishes).
pub(crate) struct OfficialToolchainProvisioningPlan {
    /// Session the waiting question belongs to (intake snapshot + events).
    pub(crate) session_id: String,
    /// Tool call that must be woken when the run finishes, successfully or not.
    pub(crate) tool_id: String,
    /// The answers to deliver unchanged once the run finished.
    pub(crate) answers: serde_json::Value,
    /// Managed toolchains root (`path_manager.qt_migration_toolchains_dir`, C1).
    pub(crate) toolchains_root: PathBuf,
    /// Layout platform token, from the existing
    /// [`crate::agentic::execution::execution_engine::qt_migration_download_platform`]
    /// convention (`ohos` → `harmonyos`), which matches the manifest and layout
    /// tokens the provisioner resolves.
    pub(crate) platform: String,
    /// Cancellation of the dialog turn that owns the waiting question. A cancelled
    /// turn stops the transfer and cleans the staging directory.
    pub(crate) cancel: CancellationToken,
    /// The session workspace lives on another host (D12): the kit cannot be
    /// installed there from this process, so the run reports
    /// [`REMOTE_WORKSPACE_UNSUPPORTED_ERROR_CODE`] instead of writing locally.
    pub(crate) remote_workspace: bool,
}

/// Runs the provisioning for `plan` on its own task and wakes the waiting tool
/// when it finishes. Returns immediately: this is the caller's early ack.
pub(crate) fn spawn_official_toolchain_provisioning(
    plan: OfficialToolchainProvisioningPlan,
    session_manager: Arc<SessionManager>,
) {
    info!(
        "Starting runtime Qt toolchain provisioning: session_id={}, tool_id={}, qt_major={}, platform={}, toolchains_root={}, remote_workspace={}",
        plan.session_id,
        plan.tool_id,
        QT_MIGRATION_OFFICIAL_QT_MAJOR,
        plan.platform,
        plan.toolchains_root.display(),
        plan.remote_workspace
    );
    tokio::spawn(async move {
        run_official_toolchain_provisioning(plan, session_manager).await;
    });
}

/// The provisioning task: install, resolve the field, wake the turn — always
/// waking it, including on failure (C7).
async fn run_official_toolchain_provisioning(
    plan: OfficialToolchainProvisioningPlan,
    session_manager: Arc<SessionManager>,
) {
    let tool_id = plan.tool_id.clone();
    let session_id = plan.session_id.clone();
    let answers = plan.answers.clone();
    let request = QtToolchainProvisionRequest::new(
        QT_MIGRATION_OFFICIAL_QT_MAJOR,
        plan.platform.clone(),
        plan.toolchains_root.clone(),
    );

    let finished = if plan.remote_workspace {
        warn!(
            "Qt toolchain provisioning is not supported for a remote workspace: session_id={}, tool_id={}, platform={}, code={}",
            session_id, tool_id, request.platform, REMOTE_WORKSPACE_UNSUPPORTED_ERROR_CODE
        );
        ProvisioningReport::from_wiring_failure(
            &session_id,
            &tool_id,
            &request,
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
                plan.platform.clone(),
            ));
            let on_progress = {
                let bridge = Arc::clone(&bridge);
                move |progress: QtToolchainInstallProgress| {
                    if let Some(report) = bridge.take_report(progress) {
                        // Fire-and-forget: the callback is synchronous and must not
                        // block the transfer on event delivery.
                        tokio::spawn(emit_provisioning_event(report));
                    }
                }
            };
            provision_qt_toolchain(&request, plan.cancel.clone(), on_progress).await
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
                ProvisioningReport::from_outcome(&session_id, &tool_id, &outcome)
            }
            Err(error) => {
                warn!(
                    "Qt toolchain provisioning failed: session_id={}, tool_id={}, qt_major={}, platform={}, code={}, error={}",
                    session_id,
                    tool_id,
                    request.qt_major,
                    request.platform,
                    error.code_str(),
                    error
                );
                ProvisioningReport::from_error(&session_id, &tool_id, &request, &error)
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
    let current = session_manager
        .qt_migration_intake_state(session_id)
        .unwrap_or_else(QtMigrationIntakeStateSnapshot::empty);
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
        .remember_qt_migration_intake_state(session_id, updated)
        .await;
}

/// Emits one report on the provisioning channel. A failed emission is logged, not
/// propagated: the channel is an observation surface, and the turn must be woken
/// regardless (C7).
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
