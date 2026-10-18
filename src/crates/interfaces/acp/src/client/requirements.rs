use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::time::Duration;

use bitfun_core::service::remote_ssh::{SSHCommandOptions, SSHConnectionManager};
use bitfun_core::util::errors::{BitFunError, BitFunResult};
use tokio::process::Command;

use super::builtin_clients::builtin_acp_client_preset;
use super::config::{AcpClientConfig, AcpClientRequirementProbe, AcpRequirementProbeItem};
use super::remote_shell::{remote_user_shell_command, render_remote_env_assignments, shell_escape};

const REQUIREMENT_PROBE_TIMEOUT: Duration = Duration::from_secs(3);
const ADAPTER_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(120);
const CLI_INSTALL_TIMEOUT: Duration = Duration::from_secs(600);

pub(crate) struct AcpRequirementSpec<'a> {
    pub(crate) tool_command: &'a str,
    pub(crate) install_package: Option<&'a str>,
    pub(crate) adapter: Option<AcpAdapterSpec<'a>>,
}

pub(crate) struct AcpAdapterSpec<'a> {
    pub(crate) package: &'a str,
    pub(crate) bin: &'a str,
}

pub(crate) fn acp_requirement_spec<'a>(
    client_id: &'a str,
    config: Option<&'a AcpClientConfig>,
) -> AcpRequirementSpec<'a> {
    if let Some(preset) = builtin_acp_client_preset(client_id) {
        return AcpRequirementSpec {
            tool_command: preset.tool_command,
            install_package: preset.install_package,
            adapter: match (preset.adapter_package, preset.adapter_bin) {
                (Some(package), Some(bin)) => Some(AcpAdapterSpec { package, bin }),
                _ => None,
            },
        };
    }

    AcpRequirementSpec {
        tool_command: config
            .map(|config| config.command.as_str())
            .unwrap_or(client_id),
        install_package: None,
        adapter: None,
    }
}

/// Resolve the same command and PATH used to launch the configured process.
/// Do not append --version: arbitrary ACP commands need not implement that flag.
pub(crate) fn probe_configured_executable(config: &AcpClientConfig) -> AcpRequirementProbeItem {
    let configured_path = configured_path_value(&config.env);
    let path = if config.command.trim().is_empty() {
        None
    } else {
        find_executable_with_path(&config.command, configured_path.as_deref())
    };
    let installed = path.is_some();
    AcpRequirementProbeItem {
        name: config.command.clone(),
        installed,
        version: None,
        path: path.map(|path| path.to_string_lossy().into_owned()),
        error: (!installed).then(|| "Configured ACP command could not be resolved".to_string()),
    }
}

fn remote_configured_executable_probe_command(config: &AcpClientConfig) -> String {
    let env_prefix = render_remote_env_prefix(Some(&config.env));
    remote_user_shell_command(&format!(
        "{env_prefix}command -v {}",
        shell_escape(config.command.trim())
    ))
}

/// Discover the configured remote entry without executing an arbitrary --version.
pub(crate) async fn probe_remote_configured_executable(
    ssh_manager: &SSHConnectionManager,
    connection_id: &str,
    config: &AcpClientConfig,
) -> AcpRequirementProbeItem {
    let mut item = AcpRequirementProbeItem {
        name: config.command.clone(),
        installed: false,
        version: None,
        path: None,
        error: None,
    };
    if config.command.trim().is_empty() {
        item.error = Some("Configured ACP command is empty".to_string());
        return item;
    }
    let command = remote_configured_executable_probe_command(config);
    match ssh_manager.execute_command(connection_id, &command).await {
        Ok((stdout, _, 0)) if !stdout.trim().is_empty() => {
            item.installed = true;
            item.path = Some(stdout.trim().to_string());
        }
        Ok(_) => {
            item.error =
                Some("Configured ACP command could not be resolved on remote PATH".to_string());
        }
        Err(error) => item.error = Some(error.to_string()),
    }
    item
}

pub(crate) async fn probe_executable(command: &str) -> AcpRequirementProbeItem {
    probe_executable_with_path(command, None).await
}

pub(crate) async fn probe_executable_with_path(
    command: &str,
    configured_path: Option<&OsStr>,
) -> AcpRequirementProbeItem {
    probe_executable_with_context(command, configured_path, None, None).await
}

pub(crate) async fn probe_executable_with_environment(
    command: &str,
    extra_env: Option<&HashMap<String, String>>,
    working_directory: Option<&Path>,
) -> AcpRequirementProbeItem {
    let configured_path = extra_env.and_then(configured_path_value);
    probe_executable_with_context(
        command,
        configured_path.as_deref(),
        extra_env,
        working_directory,
    )
    .await
}

pub(crate) async fn probe_node_platform(
    node: &str,
    environment: Option<&HashMap<String, String>>,
    working_directory: Option<&Path>,
) -> Result<String, String> {
    let output = run_command_with_timeout_in_context(
        OsStr::new(node),
        ["-p", "process.platform"],
        REQUIREMENT_PROBE_TIMEOUT,
        environment,
        working_directory,
    )
    .await?;
    if !output.status.success() {
        return Err(command_error_summary(&output.stderr, &output.stdout));
    }
    parse_version_text(&output.stdout).ok_or_else(|| "Node returned no platform".to_string())
}

/// Check the installed release, not the presence of an ACP command in source.
/// Node/npm and the development toolchain are informational: they are not
/// prerequisites for an already installed native ACP executable.
pub(crate) async fn check_deveco_requirements(
    probe: &mut AcpClientRequirementProbe,
    environment: &HashMap<String, String>,
    working_directory: Option<&Path>,
) {
    probe.runnable = probe.tool.installed && probe.tool.error.is_none();
    if probe.tool.installed && probe.tool.error.is_none() {
        if let Some(path) = probe.tool.path.as_deref() {
            let result = run_command_with_timeout_in_context(
                OsStr::new(path),
                ["acp", "--help"],
                REQUIREMENT_PROBE_TIMEOUT,
                Some(environment),
                working_directory,
            )
            .await;
            let error = match result {
                Ok(output) if output.status.success()
                    && (is_deveco_acp_help(&output.stdout) || is_deveco_acp_help(&output.stderr)) => None,
                Ok(output) => Some(format!(
                    "DevEco Code did not confirm an ACP subcommand. Check this installed release with `deveco acp --help`: {}",
                    command_error_summary(&output.stderr, &output.stdout)
                )),
                Err(error) => Some(format!("Could not check DevEco Code ACP support: {error}")),
            };
            if let Some(error) = error {
                probe.tool.error = Some(error.clone());
                probe.notes.push(error);
                probe.runnable = false;
            }
        }
    }

    let configured_path = configured_path_value(environment);
    if let Some(command) = find_executable_with_path("deveco", configured_path.as_deref()) {
        probe.notes.push(format!(
            "deveco is on the ACP search path at {}",
            command.display()
        ));
    } else if probe.tool.installed {
        probe.notes.push(
            "deveco is not on the ACP search path; the configured absolute executable is used."
                .to_string(),
        );
    }

    for name in ["node", "npm"] {
        let item =
            probe_executable_with_environment(name, Some(environment), working_directory).await;
        if !item.installed || item.error.is_some() {
            probe.notes.push(format!(
                "{name} is not available for npm installation. An installed native DevEco Code does not require it to start.{}",
                item.error.as_ref().map(|error| format!(" {error}")).unwrap_or_default()
            ));
        } else {
            probe.notes.push(format!(
                "{name}: {} ({})",
                item.path.as_deref().unwrap_or(name),
                item.version.as_deref().unwrap_or("version unknown")
            ));
            if name == "node" {
                if let Some(path) = item.path.as_deref() {
                    match probe_node_platform(path, Some(environment), working_directory).await {
                        Ok(platform) => probe.notes.push(format!(
                            "Detected Node process.platform={platform}. Managed npm installation requires HarmonyBrew Node reporting openharmony; this is not a native runtime requirement."
                        )),
                        Err(error) => probe.notes.push(format!("Could not check the detected Node platform: {error}")),
                    }
                }
            }
        }
    }

    let roots = deveco_toolchain_roots(Some(environment));
    if roots.is_empty() {
        probe.notes.push(
            "DevEco Studio / Command Line Tools was not detected. HarmonyOS build and device tools may be unavailable; this does not prevent DevEco Code installation or ACP startup.".to_string()
        );
    } else {
        probe.notes.push(format!(
            "DevEco toolchain directories detected: {}. Build and device operations were not tested.",
            roots.iter().map(|path| path.display().to_string()).collect::<Vec<_>>().join(", ")
        ));
    }
}

fn is_deveco_acp_help(output: &[u8]) -> bool {
    // Root help also lists `deveco acp`. Require the subcommand's usage header,
    // so a CLI that ignores the argument cannot be marked ACP-ready.
    String::from_utf8_lossy(output)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| {
            let mut words = line.split_whitespace();
            matches!(words.next(), Some("deveco" | "deveco.exe")) && words.next() == Some("acp")
        })
        .unwrap_or(false)
}

pub(crate) fn deveco_native_executable() -> Option<PathBuf> {
    let command = find_executable("deveco")?;
    native_deveco_entry(&command)
}

pub(crate) fn native_deveco_entry(command: &Path) -> Option<PathBuf> {
    let resolved = std::fs::canonicalize(command).unwrap_or_else(|_| command.to_path_buf());
    let Some(parent) = resolved.parent() else {
        return Some(resolved);
    };
    // Both layouts come from the npm packages: the portable launcher and the
    // platform package's cli.js wrapper. Keep the native binary beside vendor.
    let native = match resolved.file_name().and_then(OsStr::to_str) {
        Some("cli.js")
            if parent.file_name() == Some(OsStr::new("deveco-code-openharmony-arm64")) =>
        {
            parent.join("bin/deveco")
        }
        Some("deveco")
            if parent.file_name() == Some(OsStr::new("bin"))
                && parent.parent().and_then(Path::file_name) == Some(OsStr::new("deveco-code")) =>
        {
            parent.join("deveco.exe")
        }
        _ => return Some(resolved),
    };
    executable_file(&native).then_some(native)
}

async fn probe_executable_with_context(
    command: &str,
    configured_path: Option<&OsStr>,
    extra_env: Option<&HashMap<String, String>>,
    working_directory: Option<&Path>,
) -> AcpRequirementProbeItem {
    let mut item = AcpRequirementProbeItem {
        name: command.to_string(),
        installed: false,
        version: None,
        path: None,
        error: None,
    };

    let path = find_executable_with_path(command, configured_path);
    item.installed = path.is_some();
    item.path = path.as_ref().map(|path| path.to_string_lossy().to_string());

    if let Some(path) = path {
        match run_command_with_timeout_in_context(
            path.as_os_str(),
            ["--version"],
            REQUIREMENT_PROBE_TIMEOUT,
            extra_env,
            working_directory,
        )
        .await
        {
            Ok(output) if output.status.success() => {
                item.version = parse_version_text(&output.stdout)
                    .or_else(|| parse_version_text(&output.stderr));
            }
            Ok(output) => {
                item.error = Some(command_error_summary(&output.stderr, &output.stdout));
            }
            Err(error) => {
                item.error = Some(error);
            }
        }
    }

    item
}

pub(crate) async fn probe_npm_adapter(package: &str, bin: &str) -> AcpRequirementProbeItem {
    probe_npm_adapter_with_path(package, bin, None).await
}

async fn probe_npm_adapter_with_path(
    package: &str,
    bin: &str,
    configured_path: Option<&OsStr>,
) -> AcpRequirementProbeItem {
    let mut item = AcpRequirementProbeItem {
        name: package.to_string(),
        installed: false,
        version: None,
        path: None,
        error: None,
    };
    if let Some(bin_path) = find_executable_with_path(bin, configured_path) {
        item.installed = true;
        item.path = Some(bin_path.to_string_lossy().to_string());
        return item;
    }
    if find_executable_with_path("npx", configured_path).is_some() {
        return npx_adapter_probe_item(package);
    }

    let npm_path = find_executable_with_path("npm", configured_path);
    let Some(npm_path) = npm_path else {
        item.error = Some("npm and npx are not available on PATH".to_string());
        return item;
    };

    let global_args = ["ls", "-g", "--json", "--depth=0", package];
    match run_command_with_timeout(npm_path.as_os_str(), global_args, REQUIREMENT_PROBE_TIMEOUT)
        .await
    {
        Ok(output) if output.status.success() => {
            if let Some(version) = npm_ls_package_version(&output.stdout, package) {
                item.installed = true;
                item.version = Some(version);
                item.path = Some("npm global".to_string());
                return item;
            }
        }
        Ok(output) => {
            item.error = Some(command_error_summary(&output.stderr, &output.stdout));
        }
        Err(error) => {
            item.error = Some(error);
        }
    }

    let offline_args = npm_offline_probe_args(package, bin);
    match run_command_with_timeout(
        npm_path.as_os_str(),
        offline_args.iter().map(String::as_str),
        REQUIREMENT_PROBE_TIMEOUT,
    )
    .await
    {
        Ok(output) if output.status.success() => {
            item.installed = true;
            item.path = Some("npm offline cache".to_string());
            item.error = None;
        }
        Ok(output) => {
            item.error = Some(command_error_summary(&output.stderr, &output.stdout));
        }
        Err(error) => {
            item.error = Some(error);
        }
    }

    item
}

fn npm_offline_probe_args(package: &str, bin: &str) -> [String; 7] {
    [
        "exec".to_string(),
        "--offline".to_string(),
        "--yes".to_string(),
        format!("--package={package}"),
        "--".to_string(),
        bin.to_string(),
        "--help".to_string(),
    ]
}

fn npx_adapter_probe_item(package: &str) -> AcpRequirementProbeItem {
    AcpRequirementProbeItem {
        name: package.to_string(),
        installed: true,
        version: None,
        path: Some("npx auto-install".to_string()),
        error: None,
    }
}

pub(crate) async fn probe_remote_executable(
    ssh_manager: &SSHConnectionManager,
    connection_id: &str,
    command: &str,
    env: Option<&HashMap<String, String>>,
) -> AcpRequirementProbeItem {
    let mut item = AcpRequirementProbeItem {
        name: command.to_string(),
        installed: false,
        version: None,
        path: None,
        error: None,
    };

    let env_prefix = render_remote_env_prefix(env);
    let resolve_command =
        remote_user_shell_command(&format!("{env_prefix}command -v {}", shell_escape(command)));
    match ssh_manager
        .execute_command(connection_id, &resolve_command)
        .await
    {
        Ok((stdout, _stderr, 0)) => {
            let resolved_path = stdout
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(ToString::to_string);
            item.installed = resolved_path.is_some();
            item.path = resolved_path;
        }
        Ok((stdout, stderr, _)) => {
            let summary = remote_command_error_summary(&stderr, &stdout);
            if !summary.is_empty() {
                item.error = Some(summary);
            }
        }
        Err(error) => {
            item.error = Some(error.to_string());
        }
    }

    if item.installed {
        let version_command =
            remote_user_shell_command(&format!("{env_prefix}{} --version", shell_escape(command)));
        match ssh_manager
            .execute_command(connection_id, &version_command)
            .await
        {
            Ok((stdout, stderr, 0)) => {
                item.version = parse_version_text(stdout.as_bytes())
                    .or_else(|| parse_version_text(stderr.as_bytes()));
            }
            Ok((stdout, stderr, _)) => {
                item.error = Some(remote_command_error_summary(&stderr, &stdout));
            }
            Err(error) => {
                item.error = Some(error.to_string());
            }
        }
    }

    item
}

pub(crate) async fn probe_remote_npx_adapter(
    ssh_manager: &SSHConnectionManager,
    connection_id: &str,
    package: &str,
    env: Option<&HashMap<String, String>>,
) -> AcpRequirementProbeItem {
    let mut item = AcpRequirementProbeItem {
        name: package.to_string(),
        installed: false,
        version: None,
        path: None,
        error: None,
    };

    let env_prefix = render_remote_env_prefix(env);
    let resolve_command = remote_user_shell_command(&format!("{env_prefix}command -v npx"));
    match ssh_manager
        .execute_command(connection_id, &resolve_command)
        .await
    {
        Ok((stdout, _stderr, 0)) => {
            item.installed = true;
            item.path = stdout
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(ToString::to_string)
                .or_else(|| Some("remote npx auto-install".to_string()));
        }
        Ok((stdout, stderr, _)) => {
            let summary = remote_command_error_summary(&stderr, &stdout);
            item.error = Some(if summary.is_empty() {
                "npx is not available on remote PATH".to_string()
            } else {
                summary
            });
        }
        Err(error) => {
            item.error = Some(error.to_string());
        }
    }

    item
}

pub(crate) async fn predownload_npm_adapter(package: &str, bin: &str) -> BitFunResult<()> {
    let npm_path = find_executable("npm")
        .ok_or_else(|| BitFunError::service("npm is not available on PATH".to_string()))?;
    let args = npm_predownload_args(package, bin);

    match run_command_with_timeout(
        npm_path.as_os_str(),
        args.iter().map(String::as_str),
        ADAPTER_DOWNLOAD_TIMEOUT,
    )
    .await
    {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(BitFunError::service(format!(
            "Failed to predownload ACP adapter '{}': {}",
            package,
            command_error_summary(&output.stderr, &output.stdout)
        ))),
        Err(error) => Err(BitFunError::service(format!(
            "Failed to predownload ACP adapter '{}': {}",
            package, error
        ))),
    }
}

fn npm_predownload_args(package: &str, bin: &str) -> [String; 6] {
    [
        "exec".to_string(),
        "--yes".to_string(),
        format!("--package={package}"),
        "--".to_string(),
        bin.to_string(),
        "--help".to_string(),
    ]
}

pub(crate) async fn install_npm_cli_package(package: &str) -> BitFunResult<()> {
    let npm_path = find_executable("npm")
        .ok_or_else(|| BitFunError::service("npm is not available on PATH".to_string()))?;
    let args = ["install", "-g", package];

    match run_command_with_timeout(npm_path.as_os_str(), args, CLI_INSTALL_TIMEOUT).await {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => Err(BitFunError::service(format!(
            "Failed to install ACP agent CLI '{}': {}",
            package,
            command_error_summary(&output.stderr, &output.stdout)
        ))),
        Err(error) => Err(BitFunError::service(format!(
            "Failed to install ACP agent CLI '{}': {}",
            package, error
        ))),
    }
}

pub(crate) async fn install_remote_npm_cli_package(
    ssh_manager: &SSHConnectionManager,
    connection_id: &str,
    package: &str,
) -> BitFunResult<()> {
    let command = remote_user_shell_command(&format!("npm install -g {}", shell_escape(package)));
    let timeout_ms = u64::try_from(CLI_INSTALL_TIMEOUT.as_millis()).unwrap_or(u64::MAX);
    match ssh_manager
        .execute_command_with_options(
            connection_id,
            &command,
            SSHCommandOptions {
                timeout_ms: Some(timeout_ms),
                cancellation_token: None,
            },
        )
        .await
    {
        Ok(output) if output.exit_code == 0 && !output.timed_out && !output.interrupted => Ok(()),
        Ok(output) if output.timed_out => Err(BitFunError::service(format!(
            "Failed to install remote ACP agent CLI '{}': command timed out",
            package
        ))),
        Ok(output) if output.interrupted => Err(BitFunError::service(format!(
            "Failed to install remote ACP agent CLI '{}': command was cancelled",
            package
        ))),
        Ok(output) => Err(BitFunError::service(format!(
            "Failed to install remote ACP agent CLI '{}': {}",
            package,
            remote_command_error_summary(&output.stderr, &output.stdout)
        ))),
        Err(error) => Err(BitFunError::service(format!(
            "Failed to install remote ACP agent CLI '{}': {}",
            package, error
        ))),
    }
}

pub(crate) fn resolve_configured_command(
    command: &str,
    extra_env: &HashMap<String, String>,
) -> PathBuf {
    let configured_path = configured_path_value(extra_env);
    find_executable_with_path(command, configured_path.as_deref())
        .unwrap_or_else(|| PathBuf::from(command))
}

pub(crate) fn apply_command_environment(
    command: &mut Command,
    extra_env: Option<&HashMap<String, String>>,
) {
    let configured_path = extra_env.and_then(configured_path_value);
    let search_path = joined_command_search_path(configured_path.as_deref());
    if !search_path.is_empty() {
        command.env("PATH", search_path);
    }

    if let Some(extra_env) = extra_env {
        for (key, value) in extra_env {
            if !key.eq_ignore_ascii_case("PATH") {
                command.env(key, value);
            }
        }
    }
}

async fn run_command_with_timeout<I, S>(
    program: &OsStr,
    args: I,
    timeout: Duration,
) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_command_with_timeout_in_context(program, args, timeout, None, None).await
}

async fn run_command_with_timeout_in_context<I, S>(
    program: &OsStr,
    args: I,
    timeout: Duration,
    extra_env: Option<&HashMap<String, String>>,
    working_directory: Option<&Path>,
) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = bitfun_core::util::process_manager::create_tokio_command(program);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    apply_command_environment(&mut command, extra_env);
    if let Some(working_directory) = working_directory {
        command.current_dir(working_directory);
    }
    match tokio::time::timeout(timeout, command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("Timed out while checking command".to_string()),
    }
}

fn npm_ls_package_version(stdout: &[u8], package: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_slice(stdout).ok()?;
    value
        .get("dependencies")?
        .get(package)?
        .get("version")?
        .as_str()
        .map(ToString::to_string)
}

fn parse_version_text(output: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(output);
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn command_error_summary(stderr: &[u8], stdout: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    if !stderr.is_empty() {
        return truncate_error(stderr);
    }
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    if !stdout.is_empty() {
        return truncate_error(stdout);
    }
    "Command exited unsuccessfully".to_string()
}

fn remote_command_error_summary(stderr: &str, stdout: &str) -> String {
    let stderr = stderr.trim().to_string();
    if !stderr.is_empty() {
        return truncate_error(stderr);
    }
    let stdout = stdout.trim().to_string();
    if !stdout.is_empty() {
        return truncate_error(stdout);
    }
    String::new()
}

fn truncate_error(value: String) -> String {
    const MAX_LEN: usize = 240;
    if value.chars().count() <= MAX_LEN {
        return value;
    }
    format!("{}...", value.chars().take(MAX_LEN).collect::<String>())
}

fn render_remote_env_prefix(env: Option<&HashMap<String, String>>) -> String {
    let Some(env) = env else {
        return String::new();
    };
    let assignments = render_remote_env_assignments(env);
    if assignments.is_empty() {
        return String::new();
    }
    format!("{} ", assignments.join(" "))
}

fn find_executable(command: &str) -> Option<PathBuf> {
    find_executable_with_path(command, None)
}

fn find_executable_with_path(command: &str, configured_path: Option<&OsStr>) -> Option<PathBuf> {
    let command_path = PathBuf::from(command);
    if command_path.components().count() > 1 {
        return executable_file(&command_path).then_some(command_path);
    }

    for directory in command_search_paths(configured_path) {
        for candidate in executable_candidates(&directory, command) {
            if executable_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

fn configured_path_value(extra_env: &HashMap<String, String>) -> Option<OsString> {
    extra_env
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("PATH"))
        .map(|(_, value)| OsString::from(value))
}

fn joined_command_search_path(configured_path: Option<&OsStr>) -> OsString {
    let paths = command_search_paths(configured_path);
    if paths.is_empty() {
        return OsString::new();
    }
    env::join_paths(paths).unwrap_or_else(|_| env::var_os("PATH").unwrap_or_default())
}

fn command_search_paths(configured_path: Option<&OsStr>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();

    if let Some(configured_path) = configured_path {
        push_split_paths(&mut paths, &mut seen, configured_path);
    }
    if let Some(env_path) = env::var_os("PATH") {
        push_split_paths(&mut paths, &mut seen, &env_path);
    }

    push_user_bin_paths(&mut paths, &mut seen);
    push_system_bin_paths(&mut paths, &mut seen);
    paths
}

fn push_split_paths(paths: &mut Vec<PathBuf>, seen: &mut HashSet<OsString>, value: &OsStr) {
    for directory in env::split_paths(value) {
        push_search_path(paths, seen, directory);
    }
}

fn push_user_bin_paths(paths: &mut Vec<PathBuf>, seen: &mut HashSet<OsString>) {
    #[cfg(target_env = "ohos")]
    {
        for path in [
            "/storage/Users/currentUser/.harmonybrew/bin",
            "/storage/Users/currentUser/npm/bin",
            "/storage/Users/currentUser/npm",
        ] {
            push_existing_search_path(paths, seen, PathBuf::from(path));
        }
        for root in deveco_toolchain_roots(None) {
            push_deveco_node_paths(paths, seen, &root);
        }
    }

    let Some(home) = env::var_os("HOME") else {
        return;
    };
    let home = PathBuf::from(home);
    push_existing_search_path(paths, seen, home.join(".local/bin"));
    push_existing_search_path(paths, seen, home.join(".cargo/bin"));
    push_existing_search_path(paths, seen, home.join(".npm-global/bin"));
}

fn deveco_toolchain_roots(environment: Option<&HashMap<String, String>>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    for key in [
        "COMMAND_LINE_TOOL_PATH",
        "DEVECO_HOME",
        "DEVECO_CLI_STUDIO_PATH",
        "DEVECO_CLI_CLT_PATH",
    ] {
        if let Some(value) = environment
            .and_then(|env| env.get(key))
            .cloned()
            .or_else(|| env::var(key).ok())
        {
            if !value.trim().is_empty() {
                push_existing_search_path(&mut roots, &mut seen, PathBuf::from(value));
            }
        }
    }
    #[cfg(target_env = "ohos")]
    for package in child_directories(Path::new("/data/service/hnp")) {
        let name = package
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();
        if name.contains("deveco") || name.contains("hmos-clt") {
            for version in child_directories(&package) {
                push_existing_search_path(&mut roots, &mut seen, version);
            }
        }
    }
    roots
}

fn child_directories(root: &Path) -> Vec<PathBuf> {
    let mut paths = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn push_deveco_node_paths(paths: &mut Vec<PathBuf>, seen: &mut HashSet<OsString>, root: &Path) {
    for relative in ["node", "tools/node", "Contents/tools/node"] {
        let node_root = root.join(relative);
        push_existing_search_path(paths, seen, node_root.join("bin"));
        // Some toolchains version the Node directory independently of the HNP.
        for version in child_directories(&node_root) {
            push_existing_search_path(paths, seen, version.join("bin"));
        }
    }
}

fn push_system_bin_paths(paths: &mut Vec<PathBuf>, seen: &mut HashSet<OsString>) {
    #[cfg(target_os = "macos")]
    {
        for prefix in ["/opt/homebrew", "/usr/local"] {
            push_existing_search_path(paths, seen, PathBuf::from(format!("{prefix}/bin")));
            push_existing_search_path(paths, seen, PathBuf::from(format!("{prefix}/sbin")));
            for node in ["node", "node@18", "node@20", "node@22", "node@24"] {
                push_existing_search_path(
                    paths,
                    seen,
                    PathBuf::from(format!("{prefix}/opt/{node}/bin")),
                );
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (paths, seen);
    }
}

fn push_existing_search_path(
    paths: &mut Vec<PathBuf>,
    seen: &mut HashSet<OsString>,
    path: PathBuf,
) {
    if path.is_dir() {
        push_search_path(paths, seen, path);
    }
}

fn push_search_path(paths: &mut Vec<PathBuf>, seen: &mut HashSet<OsString>, path: PathBuf) {
    if path.as_os_str().is_empty() {
        return;
    }

    let key = search_path_key(&path);
    if seen.insert(key) {
        paths.push(path);
    }
}

fn search_path_key(path: &Path) -> OsString {
    #[cfg(windows)]
    {
        OsString::from(path.to_string_lossy().to_ascii_lowercase())
    }
    #[cfg(not(windows))]
    {
        path.as_os_str().to_os_string()
    }
}

fn executable_candidates(directory: &Path, command: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let command_path = PathBuf::from(command);
        if command_path.extension().is_some() {
            return vec![directory.join(command)];
        }
        let extensions = env::var_os("PATHEXT").unwrap_or_else(|| OsString::from(".EXE;.BAT;.CMD"));
        extensions
            .to_string_lossy()
            .split(';')
            .filter(|extension| !extension.is_empty())
            .map(|extension| directory.join(format!("{command}{extension}")))
            .collect()
    }

    #[cfg(not(windows))]
    {
        vec![directory.join(command)]
    }
}

fn executable_file(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(unix)]
    fn deveco_probe_checks_acp_but_does_not_require_installation_tools() {
        let root = env::temp_dir().join(format!("bitfun-deveco-probe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let cli = write_command_stub(&root, "deveco", "#!/bin/sh\nif [ \"$1\" = --version ]; then echo 0.2.3; else printf 'deveco acp\\nOptions:\\n'; fi\n");
        write_command_stub(&root, "node", "#!/bin/sh\nexit 1\n");
        write_command_stub(&root, "npm", "#!/bin/sh\nexit 1\n");
        let environment = HashMap::from([("PATH".to_string(), root.to_string_lossy().to_string())]);
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let tool = runtime.block_on(probe_executable_with_environment(
            cli.to_str().unwrap(),
            Some(&environment),
            Some(&root),
        ));
        let mut probe = AcpClientRequirementProbe {
            id: "deveco-code".to_string(),
            tool,
            adapter: None,
            runnable: true,
            notes: Vec::new(),
        };
        runtime.block_on(check_deveco_requirements(
            &mut probe,
            &environment,
            Some(&root),
        ));
        assert!(probe.runnable);
        assert_eq!(probe.tool.version.as_deref(), Some("0.2.3"));
        assert!(probe
            .notes
            .iter()
            .any(|note| note.starts_with("node is not available")));
        assert!(probe
            .notes
            .iter()
            .any(|note| note.starts_with("npm is not available")));
        // Some CLIs print root help and exit successfully for unknown commands.
        write_command_stub(
            &root,
            "deveco",
            "#!/bin/sh\nprintf 'deveco [project]\\nCommands:\\n deveco acp\\n'\n",
        );
        runtime.block_on(check_deveco_requirements(
            &mut probe,
            &environment,
            Some(&root),
        ));
        assert!(!probe.runnable);
        assert!(probe
            .tool
            .error
            .as_deref()
            .unwrap()
            .contains("ACP subcommand"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deveco_help_requires_the_acp_usage_header() {
        assert!(is_deveco_acp_help(
            b"deveco acp\n\nstart ACP (Agent Client Protocol) server\nOptions:\n --cwd"
        ));
        assert!(is_deveco_acp_help(b"\ndeveco acp [options]\n"));
        assert!(!is_deveco_acp_help(
            b"deveco [project]\nCommands:\n deveco acp  start ACP server"
        ));
        assert!(!is_deveco_acp_help(b"Unknown command: acp"));
        assert!(!is_deveco_acp_help(b""));
    }

    #[test]
    fn deveco_discovery_preserves_explicit_paths_and_resolves_packaged_native_entries() {
        let root = env::temp_dir().join(format!("bitfun-deveco-{}", uuid::Uuid::new_v4()));
        let toolchain = root.join("hmos-clt_2.0.0");
        let versioned_node = toolchain.join("node/node-v22/bin");
        std::fs::create_dir_all(&versioned_node).unwrap();
        let explicit = root.join("explicit");
        let mut paths = vec![explicit.clone()];
        let mut seen = HashSet::from([explicit.as_os_str().to_os_string()]);
        push_deveco_node_paths(&mut paths, &mut seen, &toolchain);
        push_deveco_node_paths(&mut paths, &mut seen, &root.join("missing"));
        assert_eq!(paths, vec![explicit, versioned_node]);

        let package = root.join("deveco-code/bin");
        std::fs::create_dir_all(&package).unwrap();
        let launcher = package.join("deveco");
        let native = package.join("deveco.exe");
        std::fs::write(&launcher, b"launcher").unwrap();
        std::fs::write(&native, b"native fixture, never executed").unwrap();
        assert_eq!(native_deveco_entry(&launcher), Some(native.clone()));
        std::fs::remove_file(&native).unwrap();
        assert_eq!(native_deveco_entry(&launcher), None);
        let custom = root.join("custom-wrapper");
        std::fs::write(&custom, b"custom").unwrap();
        assert_eq!(native_deveco_entry(&custom), Some(custom));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn npm_adapter_argument_builders_preserve_cli_order() {
        assert_eq!(
            npm_offline_probe_args("@agentclientprotocol/codex-acp", "codex-acp"),
            [
                "exec",
                "--offline",
                "--yes",
                "--package=@agentclientprotocol/codex-acp",
                "--",
                "codex-acp",
                "--help",
            ]
            .map(str::to_string)
        );
        assert_eq!(
            npm_predownload_args("@agentclientprotocol/codex-acp", "codex-acp"),
            [
                "exec",
                "--yes",
                "--package=@agentclientprotocol/codex-acp",
                "--",
                "codex-acp",
                "--help",
            ]
            .map(str::to_string)
        );
    }

    #[test]
    fn builtin_adapter_specs_use_maintained_agent_client_protocol_packages() {
        let claude = acp_requirement_spec("claude-code", None)
            .adapter
            .expect("Claude adapter");
        assert_eq!(claude.package, "@agentclientprotocol/claude-agent-acp");
        assert_eq!(claude.bin, "claude-agent-acp");

        let codex = acp_requirement_spec("codex", None)
            .adapter
            .expect("Codex adapter");
        assert_eq!(codex.package, "@agentclientprotocol/codex-acp");
        assert_eq!(codex.bin, "codex-acp");
    }

    #[test]
    fn command_search_paths_keep_configured_path_first() {
        let configured_paths = env::join_paths([
            PathBuf::from("/tmp/bitfun-acp-first"),
            PathBuf::from("/tmp/bitfun-acp-second"),
        ])
        .expect("test paths should be joinable");

        let paths = command_search_paths(Some(&configured_paths));

        assert_eq!(paths.first(), Some(&PathBuf::from("/tmp/bitfun-acp-first")));
        assert_eq!(paths.get(1), Some(&PathBuf::from("/tmp/bitfun-acp-second")));
    }

    #[test]
    fn find_executable_uses_configured_path() {
        let test_dir = env::temp_dir().join(format!("bitfun-acp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&test_dir).expect("test dir should be created");

        #[cfg(windows)]
        let file_name = "bitfun-test-tool.EXE";
        #[cfg(not(windows))]
        let file_name = "bitfun-test-tool";

        let executable = test_dir.join(file_name);
        std::fs::write(&executable, b"").expect("test executable should be written");

        let found = find_executable_with_path("bitfun-test-tool", Some(test_dir.as_os_str()));
        let mut config: AcpClientConfig = serde_json::from_value(serde_json::json!({
            "command": "bitfun-test-tool",
            "env": { "PATH": test_dir.to_string_lossy() }
        }))
        .expect("configured command");
        let probe = probe_configured_executable(&config);
        assert!(probe.installed);
        assert_eq!(probe.path.as_deref(), executable.to_str());
        // The empty fixture is never executed: entry discovery must not impose --version.
        config.command = "missing-bitfun-test-tool".to_string();
        assert!(!probe_configured_executable(&config).installed);
        config.command.clear();
        assert!(!probe_configured_executable(&config).installed);

        let _ = std::fs::remove_dir_all(&test_dir);
        assert_eq!(found, Some(executable));
    }

    #[test]
    fn remote_configured_probe_uses_the_launch_entry_and_environment() {
        for (entry, rendered_entry) in [
            (
                "/opt/custom tools/opencode",
                "'\\''/opt/custom tools/opencode'\\''",
            ),
            ("custom-acp", "custom-acp"),
        ] {
            let config: AcpClientConfig = serde_json::from_value(serde_json::json!({
                "command": entry,
                "args": ["acp", "--model", "custom-model"],
                "env": { "PATH": "/opt/tools:/usr/bin", "BASE": "custom" }
            }))
            .expect("configured command");
            let command = remote_configured_executable_probe_command(&config);
            assert!(command.contains(&format!("command -v {rendered_entry}")));
            assert!(!command.contains("--version"));
            assert!(!command.contains("--model"));
            assert!(command.contains("PATH=/opt/tools:/usr/bin"));
            assert!(command.contains("BASE=custom"));
        }
    }

    #[test]
    fn npx_adapter_probe_item_marks_auto_install_available() {
        let item = npx_adapter_probe_item("@agentclientprotocol/codex-acp");

        assert_eq!(item.name, "@agentclientprotocol/codex-acp");
        assert!(item.installed);
        assert_eq!(item.path.as_deref(), Some("npx auto-install"));
        assert!(item.error.is_none());
    }

    #[test]
    fn probe_npm_adapter_skips_npm_probe_when_npx_is_available() {
        let test_dir = env::temp_dir().join(format!("bitfun-acp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&test_dir).expect("test dir should be created");
        let npm_marker = test_dir.join("npm-was-run");

        write_command_stub(&test_dir, "npx", "");
        write_command_stub(&test_dir, "npm", &npm_probe_marker_script(&npm_marker));

        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should be created");
        let item = runtime.block_on(probe_npm_adapter_with_path(
            "@agentclientprotocol/codex-acp",
            "codex-acp",
            Some(test_dir.as_os_str()),
        ));

        assert!(item.installed);
        assert_eq!(item.path.as_deref(), Some("npx auto-install"));
        assert!(
            !npm_marker.exists(),
            "npm probe should not run when npx can launch the adapter"
        );
        let _ = std::fs::remove_dir_all(&test_dir);
    }

    #[test]
    fn executable_probe_uses_explicit_environment_and_readable_working_directory() {
        let test_root = env::temp_dir().join(format!("bitfun-acp-{}", uuid::Uuid::new_v4()));
        let bin_dir = test_root.join("bin");
        let working_directory = test_root.join("working");
        std::fs::create_dir_all(&bin_dir).expect("bin directory should be created");
        std::fs::create_dir_all(&working_directory).expect("working directory should be created");
        write_command_stub(&bin_dir, "bitfun-probe-context", &probe_context_script());
        let extra_env = HashMap::from([
            ("PATH".to_string(), bin_dir.to_string_lossy().to_string()),
            ("BITFUN_PROBE_MARKER".to_string(), "expected".to_string()),
        ]);

        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should be created");
        let item = runtime.block_on(probe_executable_with_environment(
            "bitfun-probe-context",
            Some(&extra_env),
            Some(&working_directory),
        ));

        assert!(item.installed);
        assert!(item.error.is_none());
        assert_eq!(
            item.version.as_deref(),
            Some(format!("{}|expected", working_directory.display()).as_str())
        );
        let _ = std::fs::remove_dir_all(&test_root);
    }

    #[test]
    fn remote_env_prefix_uses_valid_keys_in_stable_order() {
        let env = HashMap::from([
            ("INVALID-NAME".to_string(), "ignored".to_string()),
            ("PATH".to_string(), "/remote/bin:/usr/bin".to_string()),
            ("ACP_HOME".to_string(), "/tmp/acp home".to_string()),
        ]);

        assert_eq!(
            render_remote_env_prefix(Some(&env)),
            "ACP_HOME='/tmp/acp home' PATH=/remote/bin:/usr/bin "
        );
    }

    fn write_command_stub(directory: &Path, command: &str, body: &str) -> PathBuf {
        #[cfg(windows)]
        let path = directory.join(format!("{command}.cmd"));
        #[cfg(not(windows))]
        let path = directory.join(command);

        std::fs::write(&path, body).expect("command stub should be written");

        #[cfg(not(windows))]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&path)
                .expect("command stub metadata should be readable")
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&path, permissions)
                .expect("command stub should be executable");
        }

        path
    }

    fn npm_probe_marker_script(marker_path: &Path) -> String {
        #[cfg(windows)]
        {
            format!(
                "@echo off\r\necho called > \"{}\"\r\nexit /b 42\r\n",
                marker_path.display()
            )
        }
        #[cfg(not(windows))]
        {
            format!(
                "#!/bin/sh\necho called > '{}'\nexit 42\n",
                marker_path.display()
            )
        }
    }

    fn probe_context_script() -> String {
        #[cfg(windows)]
        {
            "@echo off\r\necho %CD%^|%BITFUN_PROBE_MARKER%\r\n".to_string()
        }
        #[cfg(not(windows))]
        {
            "#!/bin/sh\nprintf '%s|%s\\n' \"$PWD\" \"$BITFUN_PROBE_MARKER\"\n".to_string()
        }
    }
}
