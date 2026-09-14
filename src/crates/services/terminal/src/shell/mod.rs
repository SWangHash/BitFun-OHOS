//! Shell module - Shell detection and configuration
//!
//! This module provides shell type detection, profile management,
//! and shell integration script handling.

mod detection;
pub mod integration;
mod profiles;
mod scripts_manager;

pub(crate) use detection::invalidate_cached_executable;
pub use detection::{DetectedShell, ShellDetector, ShellDiscoverySource};
pub use integration::{
    get_injection_command, get_integration_script_content, get_integration_script_path,
    CommandState, OscSequence, ShellIntegration, ShellIntegrationEvent, ShellIntegrationManager,
};
pub use profiles::ShellProfile;
pub use scripts_manager::ScriptsManager;

use serde::{Deserialize, Serialize};

/// Supported shell types
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
pub enum ShellType {
    /// Bash shell
    #[cfg_attr(not(windows), default)]
    Bash,
    /// Zsh shell
    Zsh,
    /// Fish shell
    Fish,
    /// PowerShell (Windows PowerShell)
    PowerShell,
    /// PowerShell Core (cross-platform)
    #[cfg_attr(windows, default)]
    PowerShellCore,
    /// Windows CMD
    Cmd,
    /// Sh (POSIX shell)
    Sh,
    /// Ksh (Korn shell)
    Ksh,
    /// Csh (C shell)
    Csh,
    /// Custom shell with name
    Custom(String),
}

impl ShellType {
    /// Check if this shell honors an inherited `PWD` environment variable.
    ///
    /// POSIX shells initialize their working-directory state (and bash's
    /// fallback `getcwd` implementation, used when the binary was built with
    /// `GETCWD_BROKEN`) from `PWD` at startup, so seeding it from the spawn
    /// cwd avoids `shell-init: error retrieving current directory` failures on
    /// filesystems where `readdir` inode numbers do not match `stat` (FUSE,
    /// hmdfs, overlayfs).
    pub fn inherits_pwd(&self) -> bool {
        matches!(
            self,
            ShellType::Bash | ShellType::Zsh | ShellType::Sh | ShellType::Ksh | ShellType::Csh
        )
    }

    /// Get the display name for this shell type (platform-specific)
    pub fn name(&self) -> &str {
        match self {
            #[cfg(windows)]
            ShellType::Bash => "Git Bash",
            #[cfg(not(windows))]
            ShellType::Bash => "Bash",
            ShellType::Zsh => "Zsh",
            ShellType::Fish => "Fish",
            ShellType::PowerShell => "Windows PowerShell",
            ShellType::PowerShellCore => "PowerShell 7",
            ShellType::Cmd => "Command Prompt",
            ShellType::Sh => "sh",
            ShellType::Ksh => "Ksh",
            ShellType::Csh => "Csh",
            ShellType::Custom(name) => name,
        }
    }

    /// Get the default executable name for this shell type
    pub fn default_executable(&self) -> &str {
        match self {
            ShellType::Bash => "bash",
            ShellType::Zsh => "zsh",
            ShellType::Fish => "fish",
            ShellType::PowerShell => {
                #[cfg(windows)]
                {
                    "powershell.exe"
                }
                #[cfg(not(windows))]
                {
                    "pwsh"
                }
            }
            ShellType::PowerShellCore => "pwsh",
            ShellType::Cmd => "cmd.exe",
            ShellType::Sh => "sh",
            ShellType::Ksh => "ksh",
            ShellType::Csh => "csh",
            ShellType::Custom(name) => name,
        }
    }

    /// Check if this is a POSIX-compatible shell
    pub fn is_posix(&self) -> bool {
        matches!(
            self,
            ShellType::Bash | ShellType::Zsh | ShellType::Sh | ShellType::Ksh | ShellType::Csh
        )
    }

    /// Check if this shell supports shell integration
    pub fn supports_integration(&self) -> bool {
        matches!(
            self,
            ShellType::Bash
                | ShellType::Zsh
                | ShellType::Fish
                | ShellType::PowerShell
                | ShellType::PowerShellCore
        )
    }

    /// Parse shell type from executable path
    pub fn from_executable(path: &str) -> Self {
        let name = std::path::Path::new(path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(path)
            .to_lowercase();

        match name.as_str() {
            "bash" => ShellType::Bash,
            "zsh" => ShellType::Zsh,
            "fish" => ShellType::Fish,
            "powershell" => ShellType::PowerShell,
            "pwsh" => ShellType::PowerShellCore,
            "cmd" => ShellType::Cmd,
            "sh" => ShellType::Sh,
            "ksh" => ShellType::Ksh,
            "csh" | "tcsh" => ShellType::Csh,
            _ => ShellType::Custom(name),
        }
    }
}

impl std::fmt::Display for ShellType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ShellType::Bash => write!(f, "bash"),
            ShellType::Zsh => write!(f, "zsh"),
            ShellType::Fish => write!(f, "fish"),
            ShellType::PowerShell => write!(f, "powershell"),
            ShellType::PowerShellCore => write!(f, "pwsh"),
            ShellType::Cmd => write!(f, "cmd"),
            ShellType::Sh => write!(f, "sh"),
            ShellType::Ksh => write!(f, "ksh"),
            ShellType::Csh => write!(f, "csh"),
            ShellType::Custom(name) => write!(f, "{}", name),
        }
    }
}

/// Return the `PWD` value to seed into a spawned shell's environment.
///
/// Some filesystems (FUSE, hmdfs, overlayfs) return inode numbers from
/// `readdir` that do not match `stat`, which breaks bash's fallback `getcwd`
/// implementation with `shell-init: error retrieving current directory`.
/// POSIX shells initialize their working-directory state from an inherited,
/// consistent `PWD`, so seeding it from the spawn cwd keeps those shells
/// functional without changing the process working directory itself.
/// The value is only injected when the target directory actually exists;
/// otherwise the child keeps whatever the environment already provides.
pub fn pwd_seed_for_cwd(cwd: &std::path::Path) -> Option<String> {
    if !cwd.is_dir() {
        return None;
    }
    let candidate = cwd.to_string_lossy().into_owned();
    if candidate.starts_with('/') {
        Some(candidate)
    } else {
        std::env::current_dir()
            .ok()
            .map(|base| base.join(cwd).to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::{pwd_seed_for_cwd, ShellType};

    #[test]
    fn shell_default_remains_platform_specific() {
        #[cfg(windows)]
        assert_eq!(ShellType::default(), ShellType::PowerShellCore);
        #[cfg(not(windows))]
        assert_eq!(ShellType::default(), ShellType::Bash);
    }

    #[test]
    fn posix_shells_inherit_pwd_and_others_do_not() {
        assert!(ShellType::Bash.inherits_pwd());
        assert!(ShellType::Zsh.inherits_pwd());
        assert!(ShellType::Sh.inherits_pwd());
        assert!(ShellType::Ksh.inherits_pwd());
        assert!(ShellType::Csh.inherits_pwd());
        assert!(!ShellType::Fish.inherits_pwd());
        assert!(!ShellType::PowerShellCore.inherits_pwd());
        assert!(!ShellType::Cmd.inherits_pwd());
    }

    #[test]
    fn pwd_seed_requires_existing_directory_and_absolute_result() {
        assert_eq!(
            pwd_seed_for_cwd(std::path::Path::new("/definitely/not/a/dir")),
            None
        );

        let temp = std::env::temp_dir();
        let seeded = pwd_seed_for_cwd(&temp).expect("temp dir exists");
        let seeded_path = std::path::PathBuf::from(&seeded);
        assert!(seeded_path.is_absolute());
        assert_eq!(seeded_path.file_name(), temp.file_name());
    }
}
