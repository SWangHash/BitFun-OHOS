//! The Qt migration generation-mismatch gate.

use bitfun_qt_migration::admission::QT_MIGRATION_SLOT_INTAKE_STATE;
use bitfun_qt_migration::state::{
    intake_snapshot_from_slot_value, intake_snapshot_to_slot_value,
    qt_migration_set_version_strategy, QtMigrationVersionStrategy,
};
use log::info;

use crate::agentic::session::SessionManager;
use bitfun_qt_migration::strategy::{
    measure_bound_generation_mismatch, pending_generation_mismatch,
    read_replacement_toolchain_answer, read_version_strategy_answer, rebind_strategy_toolchain,
    QtMigrationGenerationMismatch, QtMigrationStrategyAnswer,
};

/// Generation of the official Qt package, when this build can install it.
fn official_qt_major() -> Option<u8> {
    #[cfg(feature = "qt-toolchain")]
    {
        Some(bitfun_runtime_ports::QT_MIGRATION_OFFICIAL_QT_MAJOR)
    }
    #[cfg(not(feature = "qt-toolchain"))]
    {
        None
    }
}

/// Measures the bound project and toolchain, and records the pending strategy
/// question when they are different generations.
pub(crate) async fn record_version_mismatch_if_any(
    session_manager: &SessionManager,
    session_id: &str,
) -> Option<QtMigrationGenerationMismatch> {
    let snapshot = intake_snapshot_from_slot_value(
        session_manager.domain_state_get(session_id, &QT_MIGRATION_SLOT_INTAKE_STATE),
    );
    if snapshot.version_strategy != QtMigrationVersionStrategy::NotNeeded {
        return None;
    }
    let (project, toolchain) = measure_bound_generation_mismatch(&snapshot, official_qt_major())?;

    let updated = qt_migration_set_version_strategy(
        &snapshot,
        QtMigrationVersionStrategy::Pending { project, toolchain },
    );
    session_manager
        .domain_state_set(
            session_id,
            &QT_MIGRATION_SLOT_INTAKE_STATE,
            intake_snapshot_to_slot_value(&updated),
        )
        .await;
    info!(
        "Qt migration generation mismatch requires a user decision: session_id={}, project_qt={}, toolchain_qt={}",
        session_id, project, toolchain
    );
    Some(QtMigrationGenerationMismatch::from_generations(
        project, toolchain,
    ))
}

/// Apply a submitted version-strategy answer to the session intake snapshot. A Qt
/// kit typed as free text replaces the bound toolchain.
pub(crate) async fn apply_version_strategy_answer(
    session_manager: &SessionManager,
    session_id: &str,
    answers: &serde_json::Value,
) -> Option<QtMigrationVersionStrategy> {
    let snapshot = intake_snapshot_from_slot_value(
        session_manager.domain_state_get(session_id, &QT_MIGRATION_SLOT_INTAKE_STATE),
    );
    let mismatch = pending_generation_mismatch(&snapshot)?;
    let Some(answer) = read_version_strategy_answer(answers) else {
        let toolchain = read_replacement_toolchain_answer(answers)?;
        let updated = rebind_strategy_toolchain(&snapshot, &toolchain, official_qt_major());
        session_manager
            .domain_state_set(
                session_id,
                &QT_MIGRATION_SLOT_INTAKE_STATE,
                intake_snapshot_to_slot_value(&updated),
            )
            .await;
        info!(
            "Qt migration toolchain replaced from the version strategy answer: session_id={}, strategy={:?}",
            session_id, updated.version_strategy
        );
        return Some(updated.version_strategy);
    };
    let (project, toolchain) = mismatch.measured_generations()?;

    let strategy = match answer {
        QtMigrationStrategyAnswer::Abort => {
            QtMigrationVersionStrategy::Abort { project, toolchain }
        }
        QtMigrationStrategyAnswer::Proceed => match mismatch {
            QtMigrationGenerationMismatch::ProjectNewer { .. } => {
                QtMigrationVersionStrategy::Downgrade { project, toolchain }
            }
            QtMigrationGenerationMismatch::ProjectOlder { .. } => {
                QtMigrationVersionStrategy::Continue { project, toolchain }
            }
            QtMigrationGenerationMismatch::Unknown | QtMigrationGenerationMismatch::Matching(_) => {
                return None
            }
        },
    };

    let updated = qt_migration_set_version_strategy(&snapshot, strategy);
    session_manager
        .domain_state_set(
            session_id,
            &QT_MIGRATION_SLOT_INTAKE_STATE,
            intake_snapshot_to_slot_value(&updated),
        )
        .await;
    info!(
        "Qt migration version strategy decided: session_id={}, project_qt={}, toolchain_qt={}, strategy={:?}",
        session_id, project, toolchain, strategy
    );
    Some(strategy)
}
