//! Wire contracts for the Qt migration domain crate: the persisted intake
//! snapshot shape and the question-card wire types keep their serialized
//! field names. Exercise them through the crate's public API only, the way
//! core and the hosts consume it.

use std::collections::HashMap;

use bitfun_product_domains::qt_migration::{
    QtMigrationFieldResolutionState, QtMigrationIntakeStateSnapshot, QtMigrationVersionStrategy,
};
use bitfun_qt_migration::state::{
    qt_migration_derive_intake_status, qt_migration_set_version_strategy, QtMigrationIntakeStatus,
    QtMigrationLoadedSkillReceipt,
};
use bitfun_qt_migration::templates::{
    resolve_question_template, resolve_question_template_full, QT_MIGRATION_PATHS_TEMPLATE_ID,
};

#[test]
fn legacy_intake_snapshot_without_version_strategy_still_loads() {
    // Snapshots written before `version_strategy` existed must keep loading
    // through the domain crate and stay upgrade-compatible.
    let legacy = serde_json::json!({
        "schema_version": 1,
        "fields": {
            "source_project": {"state": "resolved", "value": "/ws/app"},
            "output_project": {"state": "resolved", "value": "/ws/out"},
            "toolchain": {"state": "resolved", "value": "__official__"},
            "template": {"state": "resolved", "value": "__official__"}
        },
        "status": "ready"
    });

    let snapshot: QtMigrationIntakeStateSnapshot =
        serde_json::from_value(legacy).expect("legacy snapshot must deserialize");
    assert_eq!(
        snapshot.version_strategy,
        QtMigrationVersionStrategy::NotNeeded
    );
    assert_eq!(snapshot.status, QtMigrationIntakeStatus::Ready);

    // The decision layer still drives the persisted status: a measured mismatch
    // blocks, and the recorded generations travel with the snapshot.
    let pending = qt_migration_set_version_strategy(
        &snapshot,
        QtMigrationVersionStrategy::Pending {
            project: 6,
            toolchain: 5,
        },
    );
    assert_eq!(pending.status, QtMigrationIntakeStatus::Blocked);
    assert_eq!(
        qt_migration_derive_intake_status(&pending),
        QtMigrationIntakeStatus::Blocked
    );
}

#[test]
fn empty_snapshot_round_trips_with_stable_field_names() {
    let snapshot = QtMigrationIntakeStateSnapshot::empty();
    let encoded = serde_json::to_value(&snapshot).expect("snapshot must serialize");
    assert_eq!(encoded["schema_version"], 1);
    assert_eq!(encoded["status"], "not_applicable");
    for field in ["source_project", "output_project", "toolchain", "template"] {
        assert_eq!(encoded["fields"][field]["state"], "missing");
    }
    // Off-default values stay off the wire so historical shapes are unchanged.
    assert!(encoded.get("loaded_skill_receipt").is_none());
    // `version_strategy` carries only `#[serde(default)]` (legacy snapshots
    // upgrade on load), so the default itself stays on the wire.
    assert_eq!(encoded["version_strategy"], "not_needed");

    let decoded: QtMigrationIntakeStateSnapshot =
        serde_json::from_value(encoded).expect("round trip must deserialize");
    assert_eq!(decoded, snapshot);
}

#[test]
fn qt_migration_paths_template_keeps_its_wire_shape() {
    // The generic projection the tool waits on: four questions, each a real
    // text input (no options, non-empty placeholder) so the shared
    // ask-user-question validation accepts it template-backed.
    let questions = resolve_question_template(QT_MIGRATION_PATHS_TEMPLATE_ID)
        .expect("qt-migration-paths template must resolve");
    assert_eq!(questions.len(), 4);
    assert!(questions.iter().all(|q| q
        .input_placeholder
        .as_deref()
        .is_some_and(|s| !s.trim().is_empty())));
    assert!(resolve_question_template("unknown-template").is_none());

    let resolved = resolve_question_template_full(QT_MIGRATION_PATHS_TEMPLATE_ID, &HashMap::new())
        .expect("qt-migration-paths template must resolve");
    assert_eq!(resolved.template_version, "1");
    assert_eq!(resolved.questions.len(), 4);
    assert!(!resolved.presentation.allow_timeout);

    let qt_questions = resolved
        .qt_migration_questions
        .as_ref()
        .expect("the Qt template ships its own question shape");
    let toolchain = &qt_questions[2];
    assert_eq!(toolchain.field, "toolchain");

    // The card's own question shape round-trips through serde with the same
    // field names the frontend deserializes.
    let encoded = serde_json::to_value(toolchain).expect("Qt question must serialize");
    assert_eq!(encoded["field"], "toolchain");
    assert_eq!(encoded["header"], "askUser.qtMigration.field.toolchain");
    let decoded: bitfun_product_domains::qt_migration::QtMigrationQuestion =
        serde_json::from_value(encoded).expect("Qt question must deserialize");
    assert_eq!(&decoded, toolchain);
}

#[test]
fn managed_skill_receipt_decision_stays_provider_neutral() {
    let receipt = QtMigrationLoadedSkillReceipt {
        skill_key: "system.ohos-qt-skills".to_string(),
        source_slot: "bitfun-system".to_string(),
        dir_name: "ohos-qt-skills".to_string(),
        content_hash: "abc123".to_string(),
    };
    let mut snapshot = QtMigrationIntakeStateSnapshot::empty();
    for field in ["source_project", "output_project", "toolchain", "template"] {
        snapshot.fields.insert(
            field.to_string(),
            bitfun_product_domains::qt_migration::QtMigrationIntakeFieldState {
                state: QtMigrationFieldResolutionState::Resolved,
                value: Some("/bound".to_string()),
            },
        );
    }
    snapshot.loaded_skill_receipt = Some(receipt);
    snapshot.status = qt_migration_derive_intake_status(&snapshot);
    assert_eq!(snapshot.status, QtMigrationIntakeStatus::Ready);
}
