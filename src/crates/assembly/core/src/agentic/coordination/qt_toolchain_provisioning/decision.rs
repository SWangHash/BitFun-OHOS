//! The submit-path provisioning decision, kept free of session and runtime
//! dependencies so the contract tests can compile it in isolation.

use std::collections::BTreeMap;

use bitfun_qt_migration::state::QT_MIGRATION_OFFICIAL_VALUE;
use bitfun_runtime_ports::QT_MIGRATION_PROVISIONED_FIELD;

/// Whether the submitted bindings delegate toolchain preparation to the runtime.
pub(crate) fn binding_requires_toolchain_provisioning(bindings: &BTreeMap<String, String>) -> bool {
    bindings
        .get(QT_MIGRATION_PROVISIONED_FIELD)
        .is_some_and(|value| value == QT_MIGRATION_OFFICIAL_VALUE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn official_bindings() -> BTreeMap<String, String> {
        let mut bindings = BTreeMap::new();
        bindings.insert("source_project".to_string(), "D:/work/myqt".to_string());
        bindings.insert(
            "toolchain".to_string(),
            QT_MIGRATION_OFFICIAL_VALUE.to_string(),
        );
        bindings
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
}
