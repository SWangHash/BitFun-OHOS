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
//! Inherited Git configuration overrides are preserved during discovery. When
//! the reported file set cannot be represented safely, alignment is skipped
//! and retried later.

use openbitfun_services_core::process_manager;
use git2::{opts, ConfigLevel};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::process::Command as TokioCommand;

const GIT_CONFIG_GLOBAL: &str = "GIT_CONFIG_GLOBAL";
const GLOBAL_CONFIG_FILENAME: &str = ".gitconfig";
const CONFIG_RETRY_DELAY: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GlobalGitConfig {
    /// File pinned on Git child processes through `GIT_CONFIG_GLOBAL`. `None`
    /// when Git's effective global file set cannot be reproduced by pinning a
    /// single file or when nothing needs pinning; child processes then keep
    /// Git's default lookup.
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

    fn clear_retry(&mut self) {
        self.retry_after = None;
    }
}

/// Clears the retry deadline after a successful global-config write.
pub(crate) fn resume_alignment_after_global_write() {
    let mut attempt = GLOBAL_CONFIG_ATTEMPT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    attempt.clear_retry();
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
    if !output.status.success() {
        return Err(format_git_probe_failure(
            "git config --global --list --show-origin",
            &output,
        ));
    }

    let files = parse_show_origin_files(&output.stdout);
    match plan_from_origin_files(&files)? {
        Some(config) => Ok(config),
        // Retry discovery for a file set that cannot be described safely.
        None => Err(discovery_gave_up_reason(files.is_empty())),
    }
}

/// Why [`plan_from_origin_files`] reported an undescribable listing.
fn discovery_gave_up_reason(listing_empty: bool) -> String {
    if listing_empty {
        "no global configuration exists yet; Git children keep their default lookup until \
         the first global write"
            .to_string()
    } else {
        "Git merges several global-scope configuration files this layer cannot pin or align \
         consistently; Git children keep their default merged lookup"
            .to_string()
    }
}

fn run_git_probe(args: &[&str]) -> Result<std::process::Output, String> {
    // This probe is global-only. A neutral directory avoids making discovery
    // depend on the active repository's ownership or validity.
    //
    // Preserve inherited Git configuration overrides while probing.
    let working_directory = std::env::temp_dir();

    process_manager::create_command("git")
        .current_dir(working_directory)
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

/// Collects unique `file:<path>` origins from Git's global-config listing.
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

        let file = normalize_git_path(PathBuf::from(path.trim_matches(['\'', '"'])));
        if !files.contains(&file) {
            files.push(file);
        }
    }

    files
}

/// Whether the path's basename is the conventional primary global file. XDG
/// paths end in `git/config`, so the two shapes are disjoint.
fn is_primary_git_config(path: &Path) -> bool {
    path.file_name().and_then(|name| name.to_str()) == Some(GLOBAL_CONFIG_FILENAME)
}

/// Decides how to align the backends from the global-scope files Git reported.
/// Returns `None` when this layer cannot describe the file set well enough to
/// reproduce it for children: no origins at all, several files competing for
/// one libgit2 config level, or a filename libgit2 cannot discover. The
/// caller keeps both backends on their process defaults for that outcome
/// instead of picking a guess.
fn plan_from_origin_files(files: &[PathBuf]) -> Result<Option<GlobalGitConfig>, String> {
    if files.is_empty() {
        return Ok(None);
    }

    // Included config files can appear before the primary global file, so
    // prefer an origin whose basename is `.gitconfig`. This keeps an included
    // file from becoming the write target when the main file also appears in
    // the listing.
    let primary = files.iter().find(|path| is_primary_git_config(path));
    let xdg = files.iter().find(|path| is_xdg_git_config(path));

    // Multiple files of one shape cannot be represented by a single libgit2
    // search path without dropping configuration.
    if files
        .iter()
        .filter(|path| is_primary_git_config(path))
        .count()
        > 1
        || files.iter().filter(|path| is_xdg_git_config(path)).count() > 1
    {
        return Ok(None);
    }

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
        // Do not guess a libgit2 level for an unknown filename.
        (None, None) => Ok(None),
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
                ".openbitfun-global-config-disabled-{}",
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
    fn leaves_an_unnamed_single_file_origin_undescribed_instead_of_pinning_it() {
        let paths = vec![PathBuf::from(
            "/storage/Users/currentUser/custom-global-config",
        )];

        // libgit2 cannot discover this filename, so do not pin it.
        let plan = plan_from_origin_files(&paths).expect("hands-off plan");
        assert_eq!(plan, None);
    }

    #[test]
    fn treats_an_empty_listing_as_nothing_to_align() {
        let plan = plan_from_origin_files(&[]).expect("empty listing plan");
        assert_eq!(plan, None);
    }

    #[test]
    fn refuses_to_pick_between_two_competing_primary_gitconfigs() {
        // Multiple primary files cannot be represented by one libgit2 level.
        let paths = vec![
            PathBuf::from("/storage/Users/currentUser/.ohos_git/.gitconfig"),
            PathBuf::from("/storage/Users/currentUser/.gitconfig"),
        ];

        let plan = plan_from_origin_files(&paths).expect("ambiguous listing plan");
        assert_eq!(plan, None);
    }

    #[test]
    fn dedupes_origins_that_reappear_once_per_entry() {
        let output = b"file:/home/currentUser/.gitconfig\tsafe.directory\t/home/repo\n\
                       file:/home/currentUser/.gitconfig\tuser.name\tOpenBitFun\n";

        assert_eq!(
            parse_show_origin_files(output),
            vec![PathBuf::from("/home/currentUser/.gitconfig")]
        );
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
        const CHILD_ENV: &str = "OPENBITFUN_GIT_CONFIG_ROUNDTRIP_CHILD";
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

    #[test]
    fn a_global_write_clears_the_discovery_cooldown_immediately() {
        let now = Instant::now();
        let mut attempt = GlobalConfigAttempt::default();

        attempt.record_failure(now, "no global configuration yet".to_string());
        assert!(!attempt.is_ready(now));

        attempt.clear_retry();
        assert!(attempt.is_ready(now));
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
