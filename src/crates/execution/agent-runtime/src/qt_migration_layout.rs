//! On-disk layout of the BitFun-managed Qt migration toolchains.

use std::path::{Path, PathBuf};

/// Directory name of the managed toolchains root under the Qt migration root.
pub const QT_MANAGED_TOOLCHAINS_DIR_NAME: &str = "toolchains";

/// One managed Qt generation declared by the layout table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QtManagedKitGeneration {
    /// Version directory name directly under `toolchains/`, and the kit root.
    pub version_dir: &'static str,
    /// Qt major version the generation provides. Reported so callers can select
    /// or order by generation without parsing the directory name; it is never a
    /// substitute for measuring the kit on disk.
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

/// A declared managed kit root: the Qt major version the layout declares plus
/// `<toolchains>/<version_dir>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QtManagedKitRoot {
    /// Qt major version declared for this kit root.
    pub qt_major: u8,
    /// Declared kit root; may not exist on disk.
    pub kit_root: PathBuf,
}

/// Every kit root the layout declares under `managed_toolchains_root`, in layout
/// order (Qt5 first, then Qt6).
pub fn qt_managed_kit_roots(managed_toolchains_root: &Path) -> Vec<QtManagedKitRoot> {
    QT_MANAGED_KIT_LAYOUT
        .iter()
        .map(|generation| QtManagedKitRoot {
            qt_major: generation.qt_major,
            kit_root: managed_toolchains_root.join(generation.version_dir),
        })
        .collect()
}

/// Declared version directory name for a Qt major version, or `None` when the
/// layout declares no kit of that generation.
pub fn qt_managed_version_dir(qt_major: u8) -> Option<&'static str> {
    QT_MANAGED_KIT_LAYOUT
        .iter()
        .find(|generation| generation.qt_major == qt_major)
        .map(|generation| generation.version_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_declares_both_generations_by_version_directory() {
        assert_eq!(QT_MANAGED_KIT_LAYOUT.len(), 2);
        assert_eq!(QT_MANAGED_KIT_LAYOUT[0].version_dir, "qt5.12.12");
        assert_eq!(QT_MANAGED_KIT_LAYOUT[0].qt_major, 5);
        assert_eq!(QT_MANAGED_KIT_LAYOUT[1].version_dir, "qt6.13.0");
        assert_eq!(QT_MANAGED_KIT_LAYOUT[1].qt_major, 6);
    }

    #[test]
    fn declared_kit_roots_are_the_version_directories() {
        let root = Path::new("/data/qt-migration/toolchains");

        assert_eq!(
            qt_managed_kit_roots(root),
            vec![
                QtManagedKitRoot {
                    qt_major: 5,
                    kit_root: root.join("qt5.12.12"),
                },
                QtManagedKitRoot {
                    qt_major: 6,
                    kit_root: root.join("qt6.13.0"),
                },
            ]
        );
    }

    #[test]
    fn declared_kit_root_is_one_level_below_the_toolchains_root() {
        // 一台机器只装一个平台的 kit：kit root 不再带平台层。
        let root = Path::new("/data/qt-migration/toolchains");
        for kit in qt_managed_kit_roots(root) {
            let relative = kit
                .kit_root
                .strip_prefix(root)
                .expect("declared root lives under the toolchains root");
            assert_eq!(
                relative.components().count(),
                1,
                "declared kit root must be <version_dir>"
            );
        }
    }
}
