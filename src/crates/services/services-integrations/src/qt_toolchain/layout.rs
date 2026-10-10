//! On-disk layout of the BitFun-managed Qt migration toolchains.

use std::path::{Path, PathBuf};

/// Directory name of the managed toolchains root under the Qt migration root.
pub const QT_MANAGED_TOOLCHAINS_DIR_NAME: &str = "toolchains";

/// One managed Qt generation declared by the layout table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QtManagedKitGeneration {
    /// Version directory name directly under the toolchains root, and the kit root.
    pub version_dir: &'static str,
    /// Qt major version the generation provides.
    pub qt_major: u8,
}

/// Declared managed kit layout.
pub const QT_MANAGED_KIT_LAYOUT: &[QtManagedKitGeneration] = &[
    QtManagedKitGeneration {
        version_dir: "qt5.12.12",
        qt_major: 5,
    },
    QtManagedKitGeneration {
        version_dir: "qt6.13.0",
        qt_major: 6,
    },
];

/// Declared generation for a Qt major version.
pub fn qt_managed_generation(qt_major: u8) -> Option<&'static QtManagedKitGeneration> {
    QT_MANAGED_KIT_LAYOUT
        .iter()
        .find(|generation| generation.qt_major == qt_major)
}

/// Declared version directory name for a Qt major version, or `None` when the
/// layout declares no kit of that generation.
pub fn qt_managed_version_dir(qt_major: u8) -> Option<&'static str> {
    qt_managed_generation(qt_major).map(|generation| generation.version_dir)
}

/// Kit root the layout declares for a Qt major version:
pub fn qt_managed_kit_root(toolchains_root: &Path, qt_major: u8) -> Option<PathBuf> {
    let version_dir = qt_managed_version_dir(qt_major)?;
    Some(toolchains_root.join(version_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected values are copied verbatim from the layout table owned by
    // `bitfun_agent_runtime::qt_migration_layout`. This crate does
    // not link that owner, so these assertions mirror its content: an edit to
    // this table that disagrees with the measured layout fails here instead of
    // silently provisioning into a directory the scanner ignores. A change to
    // the owner's table must still be mirrored here by hand.
    #[test]
    fn layout_table_matches_the_scan_owner_table() {
        assert_eq!(QT_MANAGED_TOOLCHAINS_DIR_NAME, "toolchains");
        assert_eq!(QT_MANAGED_KIT_LAYOUT.len(), 2);
        assert_eq!(QT_MANAGED_KIT_LAYOUT[0].version_dir, "qt5.12.12");
        assert_eq!(QT_MANAGED_KIT_LAYOUT[0].qt_major, 5);
        assert_eq!(QT_MANAGED_KIT_LAYOUT[1].version_dir, "qt6.13.0");
        assert_eq!(QT_MANAGED_KIT_LAYOUT[1].qt_major, 6);
    }

    #[test]
    fn kit_root_is_the_version_directory_under_the_toolchains_root() {
        let root = Path::new("/data/qt-migration/toolchains");
        assert_eq!(qt_managed_kit_root(root, 5), Some(root.join("qt5.12.12")));
        assert_eq!(qt_managed_kit_root(root, 6), Some(root.join("qt6.13.0")));
    }

    #[test]
    fn kit_root_is_one_level_below_the_toolchains_root_for_both_generations() {
        // 一台机器只装一个平台的 kit：kit root 不再带平台层。
        let root = Path::new("/data/qt-migration/toolchains");
        for generation in QT_MANAGED_KIT_LAYOUT {
            let kit_root = qt_managed_kit_root(root, generation.qt_major)
                .expect("declared generation resolves");
            let relative = kit_root
                .strip_prefix(root)
                .expect("declared root lives under the toolchains root");
            assert_eq!(relative.components().count(), 1);
        }
    }
    #[test]
    fn version_dir_is_reported_per_generation() {
        assert_eq!(qt_managed_version_dir(5), Some("qt5.12.12"));
        assert_eq!(qt_managed_version_dir(6), Some("qt6.13.0"));
        assert_eq!(qt_managed_version_dir(4), None);
        assert_eq!(qt_managed_version_dir(7), None);
    }
}
