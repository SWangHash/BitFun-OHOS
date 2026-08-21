//! Synchronizes the global Git configuration used by Git CLI and libgit2.
//!
//! HarmonyOS ships a Git implementation whose global configuration can live in
//! a platform-specific location. libgit2 does not automatically use the same
//! location, so a process that mixes both backends can otherwise read two
//! different `safe.directory`, identity, and credential-related settings.
//!
//! The system Git process is the source of truth. We discover the global files
//! it actually loaded, align the matching libgit2 configuration levels, and
//! pin Git children only when doing so preserves the same effective file set.
//!
//! Two deliberate degradations keep this layer from changing behavior for
//! users whose setup it cannot describe:
//!
//! - When Git merges several global-scope files (an XDG `git/config` next to
//!   `~/.gitconfig`), pinning one file through `GIT_CONFIG_GLOBAL` would drop
//!   the others for child processes, so the CLI keeps Git's default lookup and
//!   only libgit2's search path is aligned. `--show-origin` does not mark
//!   which file Git loaded at global scope, so any extra `git/config`-shaped
//!   origin is treated as a potential XDG file.
//! - When discovery or alignment fails, Git operations must keep working
//!   exactly as before this layer existed: no new CLI pin or libgit2 path is
//!   applied, existing process defaults/overrides stay intact, and alignment
//!   is retried later.

use bitfun_services_core::process_manager;
use git2::{opts, ConfigLevel};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::process::Command as TokioCommand;

const GIT_CONFIG_GLOBAL: &str = "GIT_CONFIG_GLOBAL";
const GLOBAL_CONFIG_FILENAME: &str = ".gitconfig";
const CONFIG_RETRY_DELAY: Duration = Duration::from_secs(30);
// Git config keys do not permit underscores, so keep the probe alias hyphenated.
const GIT_HOME_ALIAS: &str = "bitfun-home";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GlobalGitConfig {
    /// File pinned on Git child processes through `GIT_CONFIG_GLOBAL`. `None`
    /// when Git merges multiple global-scope files (XDG plus `~/.gitconfig`);
    /// child processes then keep Git's default lookup.
    pub(crate) cli_pin: Option<PathBuf>,
    /// Every libgit2 config level that must be redirected for its effective
    /// config to match the files reported by Git CLI.
    pub(crate) libgit2_search_paths: Vec<(ConfigLevel, PathBuf)>,
}

#[derive(Debug, Default)]
struct GlobalConfigAttempt {
    retry_after: Option<Instant>,
    last_error: Option<String>,
}

impl GlobalConfigAttempt {
    fn is_ready(&self, now: Instant) -> bool {
        self.retry_after
            .is_none_or(|retry_after| retry_after <= now)
    }

    fn record_failure(&mut self, now: Instant, message: String) {
        self.last_error = Some(message);
        self.retry_after = Some(now + CONFIG_RETRY_DELAY);
    }
}

static GLOBAL_CONFIG: OnceLock<GlobalGitConfig> = OnceLock::new();
static GLOBAL_CONFIG_ATTEMPT: Mutex<GlobalConfigAttempt> = Mutex::new(GlobalConfigAttempt {
    retry_after: None,
    last_error: None,
});

/// Ensures both Git backends use the same global configuration for this
/// process. Only a completely applied result is cached because libgit2's search
/// paths are process-wide. A discovery or alignment failure leaves both
/// backends unchanged and is retried after a short delay; callers must treat
/// `None` as a degradation, never as an operation failure.
pub(crate) fn ensure_global_config() -> Option<&'static GlobalGitConfig> {
    if let Some(config) = GLOBAL_CONFIG.get() {
        return Some(config);
    }

    let mut attempt = GLOBAL_CONFIG_ATTEMPT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(config) = GLOBAL_CONFIG.get() {
        return Some(config);
    }

    let now = Instant::now();
    if !attempt.is_ready(now) {
        return None;
    }

    let initialized = resolve_global_config().and_then(|config| {
        set_libgit2_search_paths(&config.libgit2_search_paths)?;
        Ok(config)
    });
    match initialized {
        Ok(config) => {
            let libgit2_paths = config
                .libgit2_search_paths
                .iter()
                .map(|(level, path)| format!("{level:?}={}", path.display()))
                .collect::<Vec<_>>()
                .join(", ");
            log::info!(
                "Aligned Git global configuration: cli_pin={}, libgit2_paths=[{}]",
                config
                    .cli_pin
                    .as_deref()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|| "<git-default>".to_string()),
                libgit2_paths
            );
            let _ = GLOBAL_CONFIG.set(config);
            attempt.retry_after = None;
            attempt.last_error = None;
            GLOBAL_CONFIG.get()
        }
        Err(message) => {
            if attempt.last_error.as_deref() != Some(message.as_str()) {
                log::warn!("Failed to align the Git global configuration: {message}");
            }
            attempt.record_failure(now, message);
            None
        }
    }
}

/// Applies the resolved global config to an asynchronous Git child process.
pub(crate) fn configure_tokio_command(command: &mut TokioCommand) {
    if let Some(file) = ensure_global_config().and_then(|config| config.cli_pin.as_ref()) {
        command.env(GIT_CONFIG_GLOBAL, file);
    }
}

/// Applies the resolved global config to a synchronous Git child process.
pub(crate) fn configure_command(command: &mut std::process::Command) {
    if let Some(file) = ensure_global_config().and_then(|config| config.cli_pin.as_ref()) {
        command.env(GIT_CONFIG_GLOBAL, file);
    }
}

fn resolve_global_config() -> Result<GlobalGitConfig, String> {
    match std::env::var_os(GIT_CONFIG_GLOBAL) {
        Some(value) if !value.is_empty() => {
            let file = absolutize_path(normalize_git_path(PathBuf::from(value)))?;
            plan_for_single_file(file)
        }
        _ => discover_global_config_from_git(),
    }
}

fn discover_global_config_from_git() -> Result<GlobalGitConfig, String> {
    let output = run_git_probe(&["config", "--global", "--list", "--show-origin"])?;
    if output.status.success() {
        let files = parse_show_origin_files(&output.stdout);
        if let Some(config) = plan_from_origin_files(&files)? {
            return Ok(config);
        }
    }

    // The listing is empty (no global configuration yet) or this Git build
    // rejected the probe: fall back to the default global file inside the
    // HOME that Git itself reports.
    let home = discover_git_home()?;
    plan_for_single_file(home.join(GLOBAL_CONFIG_FILENAME))
}

fn discover_git_home() -> Result<PathBuf, String> {
    let output = run_git_probe(&[
        "-c",
        "alias.bitfun-home=!printf %s \"$HOME\"",
        GIT_HOME_ALIAS,
    ])?;
    if !output.status.success() {
        return Err(format_git_probe_failure(
            "git -c alias.bitfun-home=... bitfun-home",
            &output,
        ));
    }

    let home = String::from_utf8_lossy(&output.stdout)
        .trim_end_matches(['\r', '\n'])
        .to_string();
    if home.is_empty() {
        return Err("Git reported an empty HOME while resolving its global config".to_string());
    }

    Ok(normalize_git_path(PathBuf::from(home)))
}

fn run_git_probe(args: &[&str]) -> Result<std::process::Output, String> {
    // This probe is global-only. A neutral directory avoids making discovery
    // depend on the active repository's ownership or validity.
    let working_directory = std::env::temp_dir();

    process_manager::create_command("git")
        .current_dir(working_directory)
        .env_remove(GIT_CONFIG_GLOBAL)
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .env("LANGUAGE", "C")
        .args(args)
        .output()
        .map_err(|error| format!("Failed to execute Git config probe: {error}"))
}

fn format_git_probe_failure(command: &str, output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    if detail.is_empty() {
        format!("{command} exited with status {}", output.status)
    } else {
        format!("{command} failed: {detail}")
    }
}

/// Collects the `file:<path>` origins from `git config --global --list
/// --show-origin` output, in listing order.
fn parse_show_origin_files(output: &[u8]) -> Vec<PathBuf> {
    let mut files = Vec::new();

    for line in String::from_utf8_lossy(output).lines() {
        let origin = line
            .split_once('\t')
            .map(|(origin, _)| origin)
            .unwrap_or(line);
        let Some(path) = origin.strip_prefix("file:") else {
            continue;
        };
        let path = path.trim_end_matches(['\r', '\n']);
        if path.is_empty() {
            continue;
        }

        files.push(normalize_git_path(PathBuf::from(
            path.trim_matches(['\'', '"']),
        )));
    }

    files
}

/// Decides how to align the backends from the global-scope files Git reported.
/// Returns `None` when the listing contained no file origins at all.
fn plan_from_origin_files(files: &[PathBuf]) -> Result<Option<GlobalGitConfig>, String> {
    if files.is_empty() {
        return Ok(None);
    }

    // Included config files can appear before the primary global file, so
    // prefer an origin whose basename is `.gitconfig`. This keeps an included
    // file from becoming the write target when the main file also appears in
    // the listing.
    let primary = files.iter().find(|path| {
        path.file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == GLOBAL_CONFIG_FILENAME)
    });
    let xdg = files.iter().find(|path| is_xdg_git_config(path));

    match (primary, xdg) {
        (Some(primary), Some(xdg)) => {
            // Git merges the XDG config with the primary global file. Pinning
            // either one through GIT_CONFIG_GLOBAL would silently drop the
            // other for child processes, so keep the CLI on Git's default
            // lookup and only align libgit2 (which reads its own XDG path).
            Ok(Some(GlobalGitConfig {
                cli_pin: None,
                libgit2_search_paths: vec![
                    libgit2_search_path_for(primary)?,
                    libgit2_search_path_for(xdg)?,
                ],
            }))
        }
        (Some(primary), None) => plan_for_single_file(primary.clone()).map(Some),
        (None, Some(xdg)) => plan_for_single_file(xdg.clone()).map(Some),
        (None, None) => plan_for_single_file(files[0].clone()).map(Some),
    }
}

/// Git's XDG global file is `$XDG_CONFIG_HOME/git/config` or
/// `~/.config/git/config`; both end in a `git` directory holding `config`.
/// The origin listing cannot distinguish that file from an included file that
/// happens to share the shape, so every match is treated as a real XDG file.
fn is_xdg_git_config(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some("config")
        && path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            == Some("git")
}

fn plan_for_single_file(file: PathBuf) -> Result<GlobalGitConfig, String> {
    let libgit2_search_path = libgit2_search_path_for(&file)?;
    Ok(GlobalGitConfig {
        cli_pin: Some(file),
        libgit2_search_paths: vec![libgit2_search_path],
    })
}

fn absolutize_path(path: PathBuf) -> Result<PathBuf, String> {
    if path.is_absolute() || is_disabled_global_config(&path) {
        return Ok(path);
    }

    let current_directory = std::env::current_dir().map_err(|error| {
        format!(
            "Failed to resolve Git config path '{}': {error}",
            path.display()
        )
    })?;
    Ok(current_directory.join(path))
}

/// Git for Windows may report POSIX-style MSYS paths such as `/c/Users/...`
/// even though the Rust process uses native Windows paths. HarmonyOS and Unix
/// paths do not match this shape and are left unchanged.
fn normalize_git_path(path: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        let mut components = value.strip_prefix('/').map(str::chars);
        if let Some(mut components) = components.take() {
            let drive = components.next();
            if drive.is_some_and(|drive| drive.is_ascii_alphabetic())
                && components.next() == Some('/')
            {
                let drive = drive.expect("checked above");
                let rest = components.as_str().replace('/', "\\");
                return PathBuf::from(format!("{drive}:\\{rest}"));
            }
        }
    }

    path
}

fn libgit2_search_path_for(file: &Path) -> Result<(ConfigLevel, PathBuf), String> {
    if is_disabled_global_config(file) {
        // libgit2 has no equivalent of Git's `/dev/null` global-config file.
        // Point it at a process-private, non-existing directory instead so it
        // cannot fall back to the user's normal `.gitconfig`.
        return Ok((
            ConfigLevel::Global,
            std::env::temp_dir().join(format!(
                ".bitfun-global-config-disabled-{}",
                std::process::id()
            )),
        ));
    }

    let level = if is_xdg_git_config(file) {
        ConfigLevel::XDG
    } else if file.file_name().and_then(|name| name.to_str()) == Some(GLOBAL_CONFIG_FILENAME) {
        ConfigLevel::Global
    } else {
        return Err(format!(
            "Git global config '{}' does not use a filename libgit2 can discover",
            file.display()
        ));
    };
    let search_path = file
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| format!("Git global config path has no parent: {}", file.display()))?;
    Ok((level, search_path))
}

fn is_disabled_global_config(path: &Path) -> bool {
    #[cfg(windows)]
    {
        path == Path::new("NUL")
            || path.to_string_lossy().eq_ignore_ascii_case("NUL")
            || path.to_string_lossy().eq_ignore_ascii_case("/dev/null")
    }

    #[cfg(not(windows))]
    {
        path == Path::new("/dev/null")
    }
}

fn set_libgit2_search_paths(paths: &[(ConfigLevel, PathBuf)]) -> Result<(), String> {
    // libgit2's options mutate process-global state. `GLOBAL_CONFIG_ATTEMPT` is
    // the single initialization gate, so no two production initializers can
    // race here. Snapshot every level first so a later failure cannot leave a
    // partially aligned process behind.
    let mut originals = Vec::with_capacity(paths.len());
    for (level, _) in paths {
        let original = unsafe { opts::get_search_path(*level) }.map_err(|error| {
            format!("Failed to read libgit2 {level:?} config search path: {error}")
        })?;
        originals.push((*level, original));
    }

    for (index, (level, path)) in paths.iter().enumerate() {
        if let Err(error) = unsafe { opts::set_search_path(*level, path) } {
            let mut rollback_errors = Vec::new();
            for (rollback_level, original) in originals.iter().take(index + 1) {
                if let Err(rollback_error) =
                    unsafe { opts::set_search_path(*rollback_level, original.clone()) }
                {
                    rollback_errors.push(format!("{rollback_level:?}: {rollback_error}"));
                }
            }
            let rollback = if rollback_errors.is_empty() {
                String::new()
            } else {
                format!("; rollback also failed for {}", rollback_errors.join(", "))
            };
            return Err(format!(
                "Failed to set libgit2 {level:?} config search path to '{}': {error}{rollback}",
                path.display()
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::CString;

    struct SearchPathRestore(Vec<(ConfigLevel, CString)>);

    impl Drop for SearchPathRestore {
        fn drop(&mut self) {
            for (level, path) in &self.0 {
                unsafe { opts::set_search_path(*level, path.clone()) }
                    .expect("restore libgit2 search path");
            }
        }
    }

    fn replace_search_paths(paths: &[(ConfigLevel, PathBuf)]) -> SearchPathRestore {
        let originals = paths
            .iter()
            .map(|(level, _)| {
                (
                    *level,
                    unsafe { opts::get_search_path(*level) }.expect("read libgit2 search path"),
                )
            })
            .collect();
        set_libgit2_search_paths(paths).expect("set libgit2 search paths");
        SearchPathRestore(originals)
    }

    fn plan(files: &[&str]) -> Option<GlobalGitConfig> {
        let paths: Vec<PathBuf> = files.iter().map(PathBuf::from).collect();
        plan_from_origin_files(&paths).expect("plan")
    }

    #[test]
    fn prefers_the_primary_gitconfig_origin_over_included_files() {
        let config = plan(&[
            "/storage/Users/currentUser/.gitconfig.d/company.inc",
            "/storage/Users/currentUser/.gitconfig",
        ])
        .expect("config");

        assert_eq!(
            config.cli_pin,
            Some(PathBuf::from("/storage/Users/currentUser/.gitconfig"))
        );
        assert_eq!(
            config.libgit2_search_paths,
            vec![(
                ConfigLevel::Global,
                PathBuf::from("/storage/Users/currentUser")
            )]
        );
    }

    #[test]
    fn accepts_harmony_global_config_paths_with_nested_directories() {
        let config =
            plan(&["/storage/Users/currentUser/.gitconfig/.ohos_git/.gitconfig"]).expect("config");

        assert_eq!(
            config.cli_pin,
            Some(PathBuf::from(
                "/storage/Users/currentUser/.gitconfig/.ohos_git/.gitconfig"
            ))
        );
        assert_eq!(
            config.libgit2_search_paths,
            vec![(
                ConfigLevel::Global,
                PathBuf::from("/storage/Users/currentUser/.gitconfig/.ohos_git")
            )]
        );
    }

    #[test]
    fn refuses_to_claim_alignment_for_a_filename_libgit2_cannot_discover() {
        let paths = vec![PathBuf::from(
            "/storage/Users/currentUser/custom-global-config",
        )];

        let error = plan_from_origin_files(&paths).expect_err("custom filename is not alignable");
        assert!(error.contains("does not use a filename libgit2 can discover"));
    }

    #[test]
    fn keeps_git_default_cli_lookup_when_xdg_and_primary_configs_merge() {
        let config = plan(&[
            "/home/currentUser/.config/git/config",
            "/home/currentUser/.gitconfig",
        ])
        .expect("config");

        assert_eq!(config.cli_pin, None);
        assert_eq!(
            config.libgit2_search_paths,
            vec![
                (ConfigLevel::Global, PathBuf::from("/home/currentUser")),
                (
                    ConfigLevel::XDG,
                    PathBuf::from("/home/currentUser/.config/git")
                )
            ]
        );
    }

    #[test]
    fn pins_an_xdg_only_global_config() {
        let config = plan(&["/home/currentUser/.config/git/config"]).expect("config");

        assert_eq!(
            config.cli_pin,
            Some(PathBuf::from("/home/currentUser/.config/git/config"))
        );
        assert_eq!(
            config.libgit2_search_paths,
            vec![(
                ConfigLevel::XDG,
                PathBuf::from("/home/currentUser/.config/git")
            )]
        );
    }

    #[test]
    fn treats_any_git_config_shaped_origin_as_a_potential_xdg_file() {
        let config = plan(&[
            "/home/currentUser/tools/git/config",
            "/home/currentUser/.gitconfig",
        ])
        .expect("config");

        // The listing cannot tell an included file from Git's XDG location,
        // so the CLI conservatively keeps Git's default merged lookup.
        assert_eq!(config.cli_pin, None);
    }

    #[test]
    fn git_cli_write_is_visible_through_the_aligned_libgit2_config() {
        const CHILD_ENV: &str = "BITFUN_GIT_CONFIG_ROUNDTRIP_CHILD";
        if std::env::var_os(CHILD_ENV).is_none() {
            // libgit2 search paths are process-global. Run the actual mutation
            // in an isolated test process so a parallel repository test can
            // never observe the temporary path.
            let output = std::process::Command::new(std::env::current_exe().expect("test binary"))
                .args([
                    "--exact",
                    "git::config::tests::git_cli_write_is_visible_through_the_aligned_libgit2_config",
                    "--nocapture",
                ])
                .env(CHILD_ENV, "1")
                .output()
                .expect("run isolated config roundtrip");
            assert!(
                output.status.success(),
                "isolated config roundtrip failed:\nstdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        let config_home = tempfile::tempdir().expect("config tempdir");
        let repository = tempfile::tempdir().expect("repository tempdir");
        let config_file = config_home.path().join(GLOBAL_CONFIG_FILENAME);
        let plan = plan_for_single_file(config_file.clone()).expect("alignment plan");
        let _restore = replace_search_paths(&plan.libgit2_search_paths);
        git2::Repository::init(repository.path()).expect("repository");
        let repository_path = repository.path().to_string_lossy().to_string();

        let write = process_manager::create_command("git")
            .current_dir(repository.path())
            .env(GIT_CONFIG_GLOBAL, &config_file)
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .args([
                "config",
                "--global",
                "--add",
                "safe.directory",
                repository_path.as_str(),
            ])
            .output()
            .expect("write global config through Git CLI");
        assert!(
            write.status.success(),
            "Git config write failed: {}",
            String::from_utf8_lossy(&write.stderr)
        );

        let config = git2::Config::open_default().expect("open aligned libgit2 config");
        assert_eq!(
            config.get_string("safe.directory").expect("safe.directory"),
            repository_path
        );
        git2::Repository::open(repository.path()).expect("open repository with aligned config");
    }

    #[test]
    fn a_failed_alignment_is_delayed_but_never_cached_as_the_result() {
        let now = Instant::now();
        let mut attempt = GlobalConfigAttempt::default();

        assert!(attempt.is_ready(now));
        attempt.record_failure(now, "temporary failure".to_string());
        assert!(!attempt.is_ready(now));
        assert!(attempt.is_ready(now + CONFIG_RETRY_DELAY));
    }

    #[cfg(windows)]
    #[test]
    fn converts_msys_home_paths_for_windows() {
        assert_eq!(
            normalize_git_path(PathBuf::from("/c/Users/currentUser")),
            PathBuf::from(r"C:\Users\currentUser")
        );
    }
}
