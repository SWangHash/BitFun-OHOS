//! System command utilities
//!
//! Provides command detection and execution.

use crate::process_manager;
use log::error;
use std::path::PathBuf;
#[cfg(any(test, target_os = "macos", target_env = "ohos"))]
use std::{
    collections::HashSet,
    ffi::{OsStr, OsString},
};
#[cfg(any(target_os = "macos", target_env = "ohos"))]
use std::{process::Command, sync::OnceLock};

/// Command check result
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CheckCommandResult {
    /// Whether the command exists
    pub exists: bool,
    /// Full path to the command (if it exists)
    pub path: Option<String>,
}

/// Command execution result
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CommandOutput {
    /// Exit code
    pub exit_code: i32,
    /// Stdout
    pub stdout: String,
    /// Stderr
    pub stderr: String,
    /// Whether the command succeeded (`exit_code == 0`)
    pub success: bool,
}

/// System command error
#[derive(Debug, thiserror::Error)]
pub enum SystemError {
    #[error("Command execution failed: {0}")]
    ExecutionFailed(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("Command not found: {0}")]
    CommandNotFound(String),
}

/// Platform-specific PATH entries that are commonly used but may not be present in GUI app
/// environments (e.g. macOS apps launched from Finder, or a HarmonyOS HAP that does not
/// source the user login profile).
pub fn platform_path_entries() -> Vec<PathBuf> {
    platform_path_entries_impl()
}

/// Merges the process PATH with platform extras the same way macOS child
/// processes already do: keep the current PATH first, then append platform
/// directories, dropping empty and duplicate entries.
///
/// Returns `None` when both sides are empty so callers leave the child
/// environment untouched.
#[cfg(any(test, target_os = "macos", target_env = "ohos"))]
pub(crate) fn merge_platform_path(
    existing: Option<&OsStr>,
    platform: &[PathBuf],
) -> Option<OsString> {
    let mut entries = Vec::new();
    if let Some(existing) = existing {
        entries.extend(std::env::split_paths(existing));
    }
    entries.extend(platform.iter().cloned());

    if entries.is_empty() {
        return None;
    }

    let mut merged = Vec::new();
    let mut seen = HashSet::new();
    for path in entries {
        if path.as_os_str().is_empty() {
            continue;
        }
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            merged.push(path);
        }
    }

    std::env::join_paths(merged).ok()
}

/// PATH value child processes should inherit when the host does not receive the
/// user login environment. Same order as [`merge_platform_path`].
#[cfg(any(target_os = "macos", target_env = "ohos"))]
pub(crate) fn merged_platform_path() -> Option<OsString> {
    merge_platform_path(
        std::env::var_os("PATH").as_deref(),
        &platform_path_entries(),
    )
}

#[cfg(target_os = "macos")]
fn platform_path_entries_impl() -> Vec<PathBuf> {
    let candidates = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/opt/local/bin",
        "/opt/local/sbin",
    ];

    let mut entries: Vec<PathBuf> = candidates.iter().map(PathBuf::from).collect();
    entries.extend(homebrew_node_opt_bin_entries());
    entries.extend(login_shell_path_entries());

    dedup_existing_dirs(entries)
}

/// HarmonyOS HAP processes keep the system PATH and do not source the user
/// profile. Read it the same way macOS does, with the `.zshrc` load the review
/// git probe already uses: login `sh` does not read `.zshrc` on its own.
#[cfg(target_env = "ohos")]
fn platform_path_entries_impl() -> Vec<PathBuf> {
    login_shell_path_entries()
}

#[cfg(all(not(target_os = "macos"), not(target_env = "ohos")))]
fn platform_path_entries_impl() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(any(target_os = "macos", target_env = "ohos"))]
static LOGIN_SHELL_PATH_ENTRIES: OnceLock<Vec<PathBuf>> = OnceLock::new();

#[cfg(any(target_os = "macos", target_env = "ohos"))]
fn login_shell_path_entries() -> Vec<PathBuf> {
    LOGIN_SHELL_PATH_ENTRIES
        .get_or_init(resolve_login_shell_path_entries)
        .clone()
}

#[cfg(any(target_os = "macos", target_env = "ohos"))]
fn resolve_login_shell_path_entries() -> Vec<PathBuf> {
    let mut shell_candidates = Vec::new();
    if let Ok(shell) = std::env::var("SHELL") {
        let shell = shell.trim();
        if !shell.is_empty() {
            shell_candidates.push(shell.to_string());
        }
    }
    #[cfg(target_os = "macos")]
    {
        shell_candidates.push("/bin/zsh".to_string());
        shell_candidates.push("/bin/bash".to_string());
    }
    #[cfg(target_env = "ohos")]
    shell_candidates.push("/bin/sh".to_string());

    // Mutated only on HarmonyOS; macOS returns from the first successful shell.
    #[allow(unused_mut)]
    let mut entries = Vec::new();
    let mut seen = HashSet::new();
    for shell in shell_candidates {
        if !seen.insert(shell.clone()) {
            continue;
        }
        if let Some(path_value) = read_path_from_login_shell(&shell) {
            let shell_entries: Vec<PathBuf> = std::env::split_paths(&path_value)
                .filter(|path| path.is_dir())
                .collect();
            if !shell_entries.is_empty() {
                // macOS login shells already export the user PATH. The first
                // successful shell is the one Finder apps should inherit.
                #[cfg(target_os = "macos")]
                return dedup_existing_dirs(shell_entries);
                #[cfg(target_env = "ohos")]
                {
                    entries.extend(shell_entries);
                    break;
                }
            }
        }
    }

    // A HarmonyOS login shell often prints its own PATH even when sourcing the
    // user profile failed (the profile runs `brew`, and that executable can be
    // rejected). The profile text still names the package prefix. Read it
    // directly so a non-empty system PATH cannot hide those bin directories.
    #[cfg(target_env = "ohos")]
    {
        let profile_entries = profile_package_bin_entries();
        if !profile_entries.is_empty() {
            log::info!(
                "Loaded HarmonyOS package bin directories from the user profile: {}",
                profile_entries
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
        entries.extend(profile_entries);
    }

    dedup_existing_dirs(entries)
}

/// Bin directories named by a user profile's `brew shellenv` line.
///
/// The shell probe is still preferred when it works. This reads the same
/// profile instead of guessing an install prefix, and it does not execute
/// `brew`.
#[cfg(any(test, target_env = "ohos"))]
fn profile_package_bin_entries() -> Vec<PathBuf> {
    let Ok(home) = std::env::var("HOME") else {
        return Vec::new();
    };
    let home = PathBuf::from(home);
    let mut entries = Vec::new();
    for name in [".zshrc", ".bashrc", ".bash_profile", ".profile"] {
        let Ok(text) = std::fs::read_to_string(home.join(name)) else {
            continue;
        };
        entries.extend(package_bins_from_profile(&text));
    }
    entries
}

#[cfg(any(test, target_env = "ohos"))]
fn package_bins_from_profile(text: &str) -> Vec<PathBuf> {
    let marker = "/bin/brew";
    let mut entries = Vec::new();
    let mut rest = text;
    while let Some(index) = rest.find(marker) {
        let before = &rest[..index];
        let start = before
            .rfind(|ch: char| ch.is_whitespace() || matches!(ch, '"' | '\'' | '=' | '('))
            .map(|offset| offset + 1)
            .unwrap_or(0);
        let brew_path = &rest[start..index + marker.len()];
        if let Some(prefix) = std::path::Path::new(brew_path)
            .parent()
            .and_then(|bin| bin.parent())
            .filter(|prefix| prefix.is_absolute())
        {
            entries.push(prefix.join("bin"));
            entries.push(prefix.join("sbin"));
        }
        rest = &rest[index + marker.len()..];
    }
    entries
}

#[cfg(target_os = "macos")]
fn homebrew_node_opt_bin_entries() -> Vec<PathBuf> {
    let opt_roots = ["/opt/homebrew/opt", "/usr/local/opt"];
    let mut entries = Vec::new();

    for root in opt_roots {
        let root_path = PathBuf::from(root);
        if !root_path.is_dir() {
            continue;
        }

        // Include common fixed paths first.
        let node_bin = root_path.join("node").join("bin");
        if node_bin.is_dir() {
            entries.push(node_bin);
        }

        let read_dir = match std::fs::read_dir(&root_path) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Also include versioned formulas like node@20/node@22.
        for entry in read_dir.flatten() {
            let entry_path = entry.path();
            // Homebrew formula entries under opt are often symlinks; follow links when checking.
            if !entry_path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("node@") {
                continue;
            }

            let bin_dir = entry_path.join("bin");
            if bin_dir.is_dir() {
                entries.push(bin_dir);
            }
        }
    }

    dedup_existing_dirs(entries)
}

#[cfg(any(target_os = "macos", target_env = "ohos"))]
fn read_path_from_login_shell(shell: &str) -> Option<String> {
    // macOS login shells already export the user PATH. HarmonyOS `sh -lc` does
    // not read `.zshrc`, so load it explicitly — the same profile step
    // `resolve_git_program` uses before `command -v git`.
    let script = if cfg!(target_env = "ohos") {
        "[ -r \"$HOME/.zshrc\" ] && . \"$HOME/.zshrc\"; printf '%s' \"$PATH\""
    } else {
        "printf '%s' \"$PATH\""
    };
    // HarmonyOS login `sh -l` can abort on `set -e` while sourcing the user
    // profile, and then the original system PATH is all that remains. Run the
    // profile load as a normal command so HOME stays the process home.
    let mut command = Command::new(shell);
    if cfg!(target_env = "ohos") {
        command.arg("-c");
    } else {
        command.arg("-lc");
    }
    let output = command.arg(script).output().ok()?;
    if !output.status.success() {
        return None;
    }

    let path_value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path_value.is_empty() {
        None
    } else {
        Some(path_value)
    }
}

#[cfg(any(target_os = "macos", target_env = "ohos"))]
fn dedup_existing_dirs(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut deduped = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        if !path.is_dir() {
            continue;
        }
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            deduped.push(path);
        }
    }
    deduped
}

/// Checks whether a command exists.
///
/// Uses the `which` crate for cross-platform command detection.
///
/// # Parameters
/// - `cmd`: Command name (e.g. "git", "npm", "cargo")
///
/// # Returns
/// - `CheckCommandResult`: Contains existence and full path
///
/// # Example
/// ```rust
/// use bitfun_services_core::system::check_command;
///
/// let result = check_command("git");
/// if result.exists {
///     if let Some(path) = result.path.as_deref() {
///         println!("Git path: {}", path);
///     }
/// }
/// ```
pub fn check_command(cmd: &str) -> CheckCommandResult {
    match which::which(cmd) {
        Ok(path) => CheckCommandResult {
            exists: true,
            path: Some(path.to_string_lossy().to_string()),
        },
        Err(_) => {
            // GUI and HAP hosts often do not inherit the interactive shell PATH.
            // Look again with the same merged PATH child processes receive.
            #[cfg(any(target_os = "macos", target_env = "ohos"))]
            if let Some(joined) = merged_platform_path() {
                let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                if let Ok(path) = which::which_in(cmd, Some(joined), cwd) {
                    return CheckCommandResult {
                        exists: true,
                        path: Some(path.to_string_lossy().to_string()),
                    };
                }
            }

            CheckCommandResult {
                exists: false,
                path: None,
            }
        }
    }
}

/// Checks multiple commands in batch.
///
/// # Parameters
/// - `commands`: List of command names
///
/// # Returns
/// - `Vec<(String, CheckCommandResult)>`: List of command names and results
pub fn check_commands(commands: &[&str]) -> Vec<(String, CheckCommandResult)> {
    commands
        .iter()
        .map(|cmd| (cmd.to_string(), check_command(cmd)))
        .collect()
}

/// Runs a system command.
///
/// # Parameters
/// - `cmd`: Command name
/// - `args`: Command arguments
/// - `cwd`: Working directory (optional)
/// - `env`: Environment variables (optional)
///
/// # Returns
/// - `Result<CommandOutput, SystemError>`: Command output or error
pub async fn run_command(
    cmd: &str,
    args: &[String],
    cwd: Option<&str>,
    env: Option<&[(String, String)]>,
) -> Result<CommandOutput, SystemError> {
    let mut command = process_manager::create_tokio_command(cmd);

    command.args(args);

    if let Some(dir) = cwd {
        command.current_dir(dir);
    }

    if let Some(env_vars) = env {
        for (key, value) in env_vars {
            command.env(key, value);
        }
    }

    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let output = command.output().await.map_err(|e| {
        error!("Command execution failed: command={}, error={}", cmd, e);
        SystemError::ExecutionFailed(e.to_string())
    })?;

    let exit_code = output.status.code().unwrap_or(-1);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let success = output.status.success();

    Ok(CommandOutput {
        exit_code,
        stdout,
        stderr,
        success,
    })
}

/// Runs a system command (simplified version, without environment variables).
pub async fn run_command_simple(
    cmd: &str,
    args: &[String],
    cwd: Option<&str>,
) -> Result<CommandOutput, SystemError> {
    run_command(cmd, args, cwd, None).await
}

#[cfg(test)]
mod tests {
    use super::merge_platform_path;
    use std::path::PathBuf;

    #[test]
    fn merge_platform_path_keeps_existing_entries_ahead_of_platform_dirs() {
        let existing_entries = vec![
            PathBuf::from("/data/app/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/bin"),
        ];
        let existing = std::env::join_paths(&existing_entries).expect("joined existing path");
        let platform = vec![PathBuf::from("/storage/Users/currentUser/.harmonybrew/bin")];
        let merged = merge_platform_path(Some(existing.as_os_str()), &platform)
            .expect("joined path");
        let entries: Vec<_> = std::env::split_paths(&merged).collect();
        assert_eq!(
            entries,
            existing_entries
                .into_iter()
                .chain(platform)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn merge_platform_path_skips_empty_and_duplicate_entries() {
        let platform = vec![
            PathBuf::new(),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ];
        let merged = merge_platform_path(None, &platform).expect("joined path");
        let entries: Vec<_> = std::env::split_paths(&merged).collect();
        assert_eq!(
            entries,
            vec![PathBuf::from("/bin"), PathBuf::from("/usr/bin")]
        );
    }

    #[test]
    fn merge_platform_path_returns_none_when_both_sides_are_empty() {
        assert!(merge_platform_path(None, &[]).is_none());
    }

    #[cfg(any(target_os = "macos", target_env = "ohos"))]
    #[test]
    fn profile_package_bins_follow_brew_shellenv_path() {
        let text = "eval \"$(/storage/Users/currentUser/.harmonybrew/bin/brew shellenv)\"\n";
        let entries = super::package_bins_from_profile(text);
        assert_eq!(
            entries,
            vec![
                PathBuf::from("/storage/Users/currentUser/.harmonybrew/bin"),
                PathBuf::from("/storage/Users/currentUser/.harmonybrew/sbin"),
            ]
        );
    }

    #[test]
    fn host_without_a_package_prefix_exposes_no_platform_path_entries() {
        if cfg!(target_os = "macos") || cfg!(target_env = "ohos") {
            return;
        }
        assert!(super::platform_path_entries().is_empty());
    }
}
