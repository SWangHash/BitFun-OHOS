//! The Qt migration generation-mismatch gate.

use bitfun_agent_runtime::qt_migration_intake_state::{
    qt_migration_set_version_strategy, QtMigrationIntakeStateSnapshot, QtMigrationVersionStrategy,
};
use log::info;

use crate::agentic::session::SessionManager;
use crate::agentic::tools::qt_migration_candidates::{
    measure_bound_generation_mismatch, pending_generation_mismatch, read_version_strategy_answer,
    QtMigrationGenerationMismatch, QtMigrationStrategyAnswer,
};

/// Generation of the official Qt package, when this build can install it.
fn official_qt_major() -> Option<u8> {
    #[cfg(feature = "qt-toolchain")]
    {
        Some(crate::agentic::coordination::QT_MIGRATION_OFFICIAL_QT_MAJOR)
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
    let snapshot = session_manager
        .qt_migration_intake_state(session_id)
        .unwrap_or_else(QtMigrationIntakeStateSnapshot::empty);
    if snapshot.version_strategy != QtMigrationVersionStrategy::NotNeeded {
        return None;
    }
    let (project, toolchain) = measure_bound_generation_mismatch(&snapshot, official_qt_major())?;

    let updated = qt_migration_set_version_strategy(
        &snapshot,
        QtMigrationVersionStrategy::Pending { project, toolchain },
    );
    session_manager
        .remember_qt_migration_intake_state(session_id, updated)
        .await;
    info!(
        "Qt migration generation mismatch requires a user decision: session_id={}, project_qt={}, toolchain_qt={}",
        session_id, project, toolchain
    );
    Some(QtMigrationGenerationMismatch::from_generations(
        project, toolchain,
    ))
}

/// Apply a submitted version-strategy answer to the session intake snapshot.
pub(crate) async fn apply_version_strategy_answer(
    session_manager: &SessionManager,
    session_id: &str,
    answers: &serde_json::Value,
) -> Option<QtMigrationVersionStrategy> {
    let answer = read_version_strategy_answer(answers)?;
    let snapshot = session_manager
        .qt_migration_intake_state(session_id)
        .unwrap_or_else(QtMigrationIntakeStateSnapshot::empty);
    let mismatch = pending_generation_mismatch(&snapshot)?;
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
        .remember_qt_migration_intake_state(session_id, updated)
        .await;
    info!(
        "Qt migration version strategy decided: session_id={}, project_qt={}, toolchain_qt={}, strategy={:?}",
        session_id, project, toolchain, strategy
    );
    Some(strategy)
}
