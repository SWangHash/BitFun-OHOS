use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::{Duration, Instant};

use bitfun_core::infrastructure::PathManager;
use bitfun_core::util::errors::{BitFunError, BitFunResult};
use serde::{Deserialize, Serialize};

use super::builtin_clients::{
    builtin_acp_client_preset, BuiltinAcpClientPreset, OhosNpmManagedPreset,
};
use super::config::{AcpClientRequirementProbe, AcpClientRuntimeOverride, AcpRequirementProbeItem};
use super::ohos_node_compat::{prepare_node_command, sanitize_node_environment};
use super::requirements::probe_executable_with_environment;

const HARMONYBREW_PREFIX: &str = "/storage/Users/currentUser/.harmonybrew";
const HARMONYBREW_BIN: &str = "/storage/Users/currentUser/.harmonybrew/bin";
const HARMONYBREW_EXECUTABLE: &str = "/storage/Users/currentUser/.harmonybrew/bin/brew";
const HARMONYBREW_NODE: &str = "/storage/Users/currentUser/.harmonybrew/bin/node";
const HARMONYBREW_NPM_CLI: &str =
    "/storage/Users/currentUser/.harmonybrew/lib/node_modules/npm/bin/npm-cli.js";
const HARMONYOS_USER_HOME: &str = "/storage/Users/currentUser";
const MANAGED_INSTALL_TIMEOUT: Duration = Duration::from_secs(600);
const MANAGED_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(100);

pub const PROVISIONING_PROGRESS_EVENT: &str = "agentic://acp-provisioning-progress";
pub(crate) const PROVISIONING_CANCELLED_CODE: &str = "ACP_PROVISIONING_CANCELLED";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AcpManagedProvisioningStage {
    Detecting,
    Installing,
    Configuring,
    Verifying,
    Ready,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AcpManagedProvisioningProgress {
    pub client_id: String,
    pub stage: AcpManagedProvisioningStage,
    pub percent: u8,
}

impl AcpManagedProvisioningProgress {
    pub(crate) fn new(client_id: &str, stage: AcpManagedProvisioningStage, percent: u8) -> Self {
        Self {
            client_id: client_id.to_string(),
            stage,
            percent,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AcpClientInstallStatus {
    CliInstalled,
    ManagedReady,
    CancellationRequested,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcpClientInstallOutcome {
    pub client_id: String,
    pub status: AcpClientInstallStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub probe: Option<AcpClientRequirementProbe>,
}

impl AcpClientInstallOutcome {
    pub fn cli_installed(client_id: &str) -> Self {
        Self {
            client_id: client_id.to_string(),
            status: AcpClientInstallStatus::CliInstalled,
            install_root: None,
            probe: None,
        }
    }

    pub fn cancellation_requested(client_id: &str) -> Self {
        Self {
            client_id: client_id.to_string(),
            status: AcpClientInstallStatus::CancellationRequested,
            install_root: None,
            probe: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ManagedProvisioningRecipe {
    HarmonyBrewFormula(&'static str),
    HarmonyBrewNpm(OhosNpmManagedPreset),
}

#[derive(Debug, Clone)]
pub(crate) struct ManagedProvisioningPlan {
    pub(crate) client_id: String,
    pub(crate) brew_path: PathBuf,
    recipe: ManagedProvisioningRecipe,
    pub(crate) tool_path: PathBuf,
    runtime_path: PathBuf,
    runtime_args: Vec<String>,
    tool_was_runnable: bool,
    node_was_runnable: bool,
    npm_cli_was_runnable: bool,
}

#[derive(Debug)]
pub(crate) struct ManagedInstallation {
    /// Package-manager-owned formulas must survive ACP configuration rollback.
    /// This remains optional so a future BitFun-owned payload can opt into
    /// guarded cleanup without deleting user-managed HarmonyBrew content.
    pub(crate) cleanup_path: Option<PathBuf>,
    pub(crate) probe: AcpClientRequirementProbe,
    pub(crate) runtime_override: AcpClientRuntimeOverride,
}

pub(crate) async fn build_managed_provisioning_plan(
    client_id: &str,
    path_manager: &PathManager,
) -> BitFunResult<ManagedProvisioningPlan> {
    let preset = managed_ohos_preset(client_id)?;
    let environment = harmonybrew_process_environment();
    let working_directory = Path::new(HARMONYOS_USER_HOME);
    if preset.ohos.formula().is_some() {
        let expected_tool_path = format!("{HARMONYBREW_BIN}/{}", preset.tool_command);
        let (brew, tool) = tokio::join!(
            probe_executable_with_environment(
                HARMONYBREW_EXECUTABLE,
                Some(&environment),
                Some(working_directory),
            ),
            probe_executable_with_environment(
                &expected_tool_path,
                Some(&environment),
                Some(working_directory),
            ),
        );
        if !preset.ohos.allows_managed_install()
            && !requirement_is_exact_runnable(&tool, Path::new(&expected_tool_path))
        {
            return Err(BitFunError::service(format!(
                "[ACP_PROVISIONING_CLIENT_NOT_DETECTED] ACP client '{}' is not runnable at '{}'. No installation was attempted.",
                client_id, expected_tool_path
            )));
        }
        let plan = build_formula_plan_from_environment(client_id, &brew, &tool)?;
        return Ok(plan);
    }

    let npm = preset.ohos.npm().expect("validated HarmonyBrew npm recipe");
    let tool_path = PathBuf::from(format!("{HARMONYBREW_PREFIX}/{}", npm.entry_relative_path));
    let (brew, node, npm_cli, tool) = tokio::join!(
        probe_executable_with_environment(
            HARMONYBREW_EXECUTABLE,
            Some(&environment),
            Some(working_directory),
        ),
        probe_executable_with_environment(
            HARMONYBREW_NODE,
            Some(&environment),
            Some(working_directory),
        ),
        probe_node_script_with_environment(
            HARMONYBREW_NPM_CLI,
            "npm",
            &environment,
            working_directory,
            path_manager,
        ),
        probe_node_script_with_environment(
            &tool_path,
            preset.tool_command,
            &environment,
            working_directory,
            path_manager,
        ),
    );
    build_npm_plan_from_environment(client_id, &brew, &node, &npm_cli, &tool)
}

#[cfg(target_env = "ohos")]
pub(crate) async fn probe_existing_managed_client(
    client_id: &str,
    path_manager: &PathManager,
) -> BitFunResult<(ManagedProvisioningPlan, AcpClientRequirementProbe)> {
    let preset = managed_ohos_preset(client_id)?;
    let plan = managed_plan_for_preset(preset, true, true, true);
    let probe = probe_managed_installation(&plan, path_manager).await;
    Ok((plan, probe))
}

fn build_formula_plan_from_environment(
    client_id: &str,
    brew: &AcpRequirementProbeItem,
    tool: &AcpRequirementProbeItem,
) -> BitFunResult<ManagedProvisioningPlan> {
    let preset = harmonybrew_formula_preset(client_id)?;
    let tool_path = PathBuf::from(format!("{HARMONYBREW_BIN}/{}", preset.tool_command));
    let tool_was_runnable = requirement_is_exact_runnable(tool, &tool_path);

    if !tool_was_runnable {
        let expected_brew_path = Path::new(HARMONYBREW_EXECUTABLE);
        if !requirement_is_exact_runnable(brew, expected_brew_path) {
            return Err(BitFunError::service(format!(
                "[ACP_PROVISIONING_PREREQUISITE_MISSING] HarmonyBrew is missing or unusable at '{}'. Install or repair HarmonyBrew/HiShell, then retry.{}",
                expected_brew_path.display(),
                requirement_detail(brew)
            )));
        }
    }

    Ok(managed_plan_for_preset(
        preset,
        tool_was_runnable,
        true,
        true,
    ))
}

fn build_npm_plan_from_environment(
    client_id: &str,
    brew: &AcpRequirementProbeItem,
    node: &AcpRequirementProbeItem,
    npm_cli: &AcpRequirementProbeItem,
    tool: &AcpRequirementProbeItem,
) -> BitFunResult<ManagedProvisioningPlan> {
    let preset = harmonybrew_npm_preset(client_id)?;
    let npm = preset.ohos.npm().expect("validated HarmonyBrew npm recipe");
    let tool_path = PathBuf::from(format!("{HARMONYBREW_PREFIX}/{}", npm.entry_relative_path));
    let node_path = Path::new(HARMONYBREW_NODE);
    let npm_cli_path = Path::new(HARMONYBREW_NPM_CLI);
    let node_was_runnable = requirement_is_exact_runnable(node, node_path);
    let npm_cli_was_runnable = requirement_is_exact_runnable(npm_cli, npm_cli_path);
    let tool_was_runnable = node_was_runnable && requirement_is_exact_runnable(tool, &tool_path);

    if !tool_was_runnable
        && !(node_was_runnable && npm_cli_was_runnable)
        && !requirement_is_exact_runnable(brew, Path::new(HARMONYBREW_EXECUTABLE))
    {
        return Err(BitFunError::service(format!(
            "[ACP_PROVISIONING_PREREQUISITE_MISSING] CodeBuddy requires HarmonyBrew's exact Node/npm runtime or a usable HarmonyBrew launcher at '{}'. Install or repair HarmonyBrew/HiShell, then retry.{}",
            HARMONYBREW_EXECUTABLE,
            requirement_detail(brew)
        )));
    }

    Ok(managed_plan_for_preset(
        preset,
        tool_was_runnable,
        node_was_runnable,
        npm_cli_was_runnable,
    ))
}

pub(crate) async fn install_managed_client(
    plan: &ManagedProvisioningPlan,
    cancelled: &Arc<AtomicBool>,
    path_manager: &PathManager,
) -> BitFunResult<ManagedInstallation> {
    ensure_not_cancelled(cancelled)?;

    // A working HarmonyBrew-owned Agent installation should be reused. This
    // keeps the one-click action idempotent and avoids replacing user state.
    if !plan.tool_was_runnable {
        match plan.recipe {
            ManagedProvisioningRecipe::HarmonyBrewFormula(formula) => {
                run_brew_install(plan, formula, cancelled).await?;
            }
            ManagedProvisioningRecipe::HarmonyBrewNpm(npm) => {
                if !plan.node_was_runnable || !plan.npm_cli_was_runnable {
                    run_brew_install(plan, "node", cancelled).await?;
                }
                ensure_harmonybrew_node_toolchain(path_manager).await?;
                run_harmonybrew_npm_install(plan, npm, cancelled, path_manager).await?;
            }
        }
    }
    ensure_not_cancelled(cancelled)?;

    let probe = probe_managed_installation(plan, path_manager).await;
    if !probe.runnable {
        return Err(BitFunError::service(format!(
            "[ACP_PROVISIONING_PACKAGE_INCOMPATIBLE] Managed package for '{}' did not expose a runnable OHOS entry point at '{}': {}",
            plan.client_id,
            plan.tool_path.display(),
            probe.notes.join("; ")
        )));
    }
    let runtime_override = runtime_override_from_plan(plan, &probe)?;

    Ok(ManagedInstallation {
        cleanup_path: None,
        probe,
        runtime_override,
    })
}

async fn run_brew_install(
    plan: &ManagedProvisioningPlan,
    formula: &str,
    cancelled: &Arc<AtomicBool>,
) -> BitFunResult<()> {
    let mut command = bitfun_core::util::process_manager::create_tokio_command(&plan.brew_path);
    command
        .arg("install")
        .arg(formula)
        .current_dir(HARMONYOS_USER_HOME)
        .env("HOME", HARMONYOS_USER_HOME)
        .env("HOMEBREW_PREFIX", HARMONYBREW_PREFIX)
        .env("PATH", format!("{HARMONYBREW_BIN}:/system/bin"))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let child = command.spawn().map_err(|error| {
        BitFunError::service(format!(
            "[ACP_PROVISIONING_PROCESS_DENIED] Failed to start HarmonyBrew '{}': {}",
            plan.brew_path.display(),
            error
        ))
    })?;
    let mut wait = Box::pin(child.wait_with_output());
    let started_at = Instant::now();

    loop {
        tokio::select! {
            output = &mut wait => {
                let output = output.map_err(|error| {
                    BitFunError::service(format!(
                        "[ACP_PROVISIONING_INSTALL_FAILED] HarmonyBrew install failed: {}",
                        error
                    ))
                })?;
                if output.status.success() {
                    return Ok(());
                }
                let detail = command_error_summary(&output.stderr, &output.stdout);
                return Err(classify_install_failure(&detail));
            }
            _ = tokio::time::sleep(CANCELLATION_POLL_INTERVAL) => {
                ensure_not_cancelled(cancelled)?;
                if started_at.elapsed() >= MANAGED_INSTALL_TIMEOUT {
                    return Err(BitFunError::service(
                        "[ACP_PROVISIONING_TIMEOUT] HarmonyBrew install timed out".to_string(),
                    ));
                }
            }
        }
    }
}

async fn ensure_harmonybrew_node_toolchain(path_manager: &PathManager) -> BitFunResult<()> {
    let environment = harmonybrew_process_environment();
    let working_directory = Path::new(HARMONYOS_USER_HOME);
    let (node, npm_cli) = tokio::join!(
        probe_executable_with_environment(
            HARMONYBREW_NODE,
            Some(&environment),
            Some(working_directory),
        ),
        probe_node_script_with_environment(
            HARMONYBREW_NPM_CLI,
            "npm",
            &environment,
            working_directory,
            path_manager,
        ),
    );
    if !requirement_is_exact_runnable(&node, Path::new(HARMONYBREW_NODE))
        || !requirement_is_exact_runnable(&npm_cli, Path::new(HARMONYBREW_NPM_CLI))
    {
        return Err(BitFunError::service(format!(
            "[ACP_PROVISIONING_PACKAGE_INCOMPATIBLE] HarmonyBrew's Node installation did not expose runnable Node/npm entries at '{}' and '{}'. Node:{} npm:{}",
            HARMONYBREW_NODE,
            HARMONYBREW_NPM_CLI,
            requirement_detail(&node),
            requirement_detail(&npm_cli)
        )));
    }
    Ok(())
}

async fn run_harmonybrew_npm_install(
    plan: &ManagedProvisioningPlan,
    npm: OhosNpmManagedPreset,
    cancelled: &Arc<AtomicBool>,
    path_manager: &PathManager,
) -> BitFunResult<()> {
    let package = format!("{}@{}", npm.package, npm.install_version);
    let environment = harmonybrew_process_environment();
    let mut args = vec![
        HARMONYBREW_NPM_CLI.to_string(),
        "install".to_string(),
        "--global".to_string(),
        "--prefix".to_string(),
        HARMONYBREW_PREFIX.to_string(),
        "--omit=optional".to_string(),
        "--no-audit".to_string(),
        "--no-fund".to_string(),
        package.clone(),
    ];
    prepare_node_command(path_manager, Path::new(HARMONYBREW_NODE), &mut args).await?;
    let mut command = bitfun_core::util::process_manager::create_tokio_command(HARMONYBREW_NODE);
    command
        .args(&args)
        .current_dir(HARMONYOS_USER_HOME)
        .envs(&environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    sanitize_node_environment(&mut command, Path::new(HARMONYBREW_NODE), &environment);

    let child = command.spawn().map_err(|error| {
        BitFunError::service(format!(
            "[ACP_PROVISIONING_PROCESS_DENIED] Failed to start HarmonyBrew Node '{}' for '{}': {}",
            HARMONYBREW_NODE, plan.client_id, error
        ))
    })?;
    let mut wait = Box::pin(child.wait_with_output());
    let started_at = Instant::now();

    loop {
        tokio::select! {
            output = &mut wait => {
                let output = output.map_err(|error| {
                    BitFunError::service(format!(
                        "[ACP_PROVISIONING_INSTALL_FAILED] npm install for '{}' failed: {}",
                        package, error
                    ))
                })?;
                if output.status.success() {
                    return Ok(());
                }
                let detail = command_error_summary(&output.stderr, &output.stdout);
                return Err(classify_install_failure(&detail));
            }
            _ = tokio::time::sleep(CANCELLATION_POLL_INTERVAL) => {
                ensure_not_cancelled(cancelled)?;
                if started_at.elapsed() >= MANAGED_INSTALL_TIMEOUT {
                    return Err(BitFunError::service(format!(
                        "[ACP_PROVISIONING_TIMEOUT] npm install for '{}' timed out",
                        package
                    )));
                }
            }
        }
    }
}

async fn probe_managed_installation(
    plan: &ManagedProvisioningPlan,
    path_manager: &PathManager,
) -> AcpClientRequirementProbe {
    let preset = managed_ohos_preset(&plan.client_id)
        .expect("managed provisioning plan must reference a built-in recipe");
    let environment = harmonybrew_process_environment();
    let working_directory = Path::new(HARMONYOS_USER_HOME);
    let mut tool = match plan.recipe {
        ManagedProvisioningRecipe::HarmonyBrewFormula(_) => {
            probe_executable_with_environment(
                &plan.tool_path.to_string_lossy(),
                Some(&environment),
                Some(working_directory),
            )
            .await
        }
        ManagedProvisioningRecipe::HarmonyBrewNpm(_) => {
            probe_node_script_with_environment(
                &plan.tool_path,
                preset.tool_command,
                &environment,
                working_directory,
                path_manager,
            )
            .await
        }
    };
    tool.name = preset.tool_command.to_string();
    let runnable = requirement_is_exact_runnable(&tool, &plan.tool_path);
    let notes = if runnable {
        Vec::new()
    } else {
        vec![tool.error.clone().unwrap_or_else(|| {
            format!(
                "{} is not runnable at {}",
                preset.tool_command,
                plan.tool_path.display()
            )
        })]
    };

    AcpClientRequirementProbe {
        id: plan.client_id.clone(),
        tool,
        adapter: None,
        runnable,
        notes,
    }
}

async fn probe_node_script_with_environment(
    script_path: impl AsRef<Path>,
    name: &str,
    environment: &HashMap<String, String>,
    working_directory: &Path,
    path_manager: &PathManager,
) -> AcpRequirementProbeItem {
    let script_path = script_path.as_ref();
    let mut item = AcpRequirementProbeItem {
        name: name.to_string(),
        installed: false,
        version: None,
        path: Some(script_path.to_string_lossy().to_string()),
        error: None,
    };
    item.installed = tokio::fs::metadata(script_path)
        .await
        .map(|metadata| metadata.is_file())
        .unwrap_or(false);
    if !item.installed {
        item.error = Some(format!("{} does not exist", script_path.display()));
        return item;
    }

    let mut args = vec![
        script_path.to_string_lossy().to_string(),
        "--version".to_string(),
    ];
    if let Err(error) =
        prepare_node_command(path_manager, Path::new(HARMONYBREW_NODE), &mut args).await
    {
        item.error = Some(error.to_string());
        return item;
    }

    let mut command = bitfun_core::util::process_manager::create_tokio_command(HARMONYBREW_NODE);
    command
        .args(&args)
        .current_dir(working_directory)
        .envs(environment)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    sanitize_node_environment(&mut command, Path::new(HARMONYBREW_NODE), environment);
    match tokio::time::timeout(MANAGED_PROBE_TIMEOUT, command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            item.version =
                parse_version_text(&output.stdout).or_else(|| parse_version_text(&output.stderr));
        }
        Ok(Ok(output)) => {
            item.error = Some(command_error_summary(&output.stderr, &output.stdout));
        }
        Ok(Err(error)) => {
            item.error = Some(error.to_string());
        }
        Err(_) => {
            item.error = Some(format!(
                "{} --version timed out after {} seconds",
                name,
                MANAGED_PROBE_TIMEOUT.as_secs()
            ));
        }
    }
    item
}

fn parse_version_text(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
}

fn harmonybrew_process_environment() -> HashMap<String, String> {
    HashMap::from([
        ("HOME".to_string(), HARMONYOS_USER_HOME.to_string()),
        (
            "HOMEBREW_PREFIX".to_string(),
            HARMONYBREW_PREFIX.to_string(),
        ),
        ("PATH".to_string(), format!("{HARMONYBREW_BIN}:/system/bin")),
    ])
}

fn managed_plan_for_preset(
    preset: &'static BuiltinAcpClientPreset,
    tool_was_runnable: bool,
    node_was_runnable: bool,
    npm_cli_was_runnable: bool,
) -> ManagedProvisioningPlan {
    if let Some(formula) = preset.ohos.formula() {
        let tool_path = PathBuf::from(format!("{HARMONYBREW_BIN}/{}", preset.tool_command));
        return ManagedProvisioningPlan {
            client_id: preset.id.to_string(),
            brew_path: PathBuf::from(HARMONYBREW_EXECUTABLE),
            recipe: ManagedProvisioningRecipe::HarmonyBrewFormula(formula),
            runtime_path: tool_path.clone(),
            runtime_args: preset.args.iter().map(|arg| (*arg).to_string()).collect(),
            tool_path,
            tool_was_runnable,
            node_was_runnable,
            npm_cli_was_runnable,
        };
    }

    let npm = preset.ohos.npm().expect("validated HarmonyBrew npm recipe");
    let tool_path = PathBuf::from(format!("{HARMONYBREW_PREFIX}/{}", npm.entry_relative_path));
    let mut runtime_args = vec![tool_path.to_string_lossy().to_string()];
    runtime_args.extend(preset.args.iter().map(|arg| (*arg).to_string()));
    ManagedProvisioningPlan {
        client_id: preset.id.to_string(),
        brew_path: PathBuf::from(HARMONYBREW_EXECUTABLE),
        recipe: ManagedProvisioningRecipe::HarmonyBrewNpm(npm),
        tool_path,
        runtime_path: PathBuf::from(HARMONYBREW_NODE),
        runtime_args,
        tool_was_runnable,
        node_was_runnable,
        npm_cli_was_runnable,
    }
}

fn runtime_override_from_plan(
    plan: &ManagedProvisioningPlan,
    probe: &AcpClientRequirementProbe,
) -> BitFunResult<AcpClientRuntimeOverride> {
    if !probe.runnable {
        return Err(BitFunError::service(format!(
            "Managed ACP client '{}' is not runnable",
            plan.client_id
        )));
    }
    required_absolute_path(&probe.tool, "Agent")?;
    if !plan.runtime_path.to_string_lossy().starts_with('/') {
        return Err(BitFunError::service(format!(
            "[ACP_PROVISIONING_PATH_INVALID] Agent runtime path is not absolute: {}",
            plan.runtime_path.display()
        )));
    }

    Ok(AcpClientRuntimeOverride {
        command: plan.runtime_path.to_string_lossy().to_string(),
        args: plan.runtime_args.clone(),
        env: HashMap::from([
            ("HOME".to_string(), HARMONYOS_USER_HOME.to_string()),
            ("PATH".to_string(), format!("{HARMONYBREW_BIN}:/system/bin")),
        ]),
    })
}

pub(crate) async fn cleanup_managed_installation(path: Option<&Path>) {
    // HarmonyBrew content belongs to the user's package manager and is never
    // removed when BitFun rolls back an ACP config. Keep this guard for future
    // BitFun-owned generations only.
    const BITFUN_MANAGED_ROOT: &str = "/storage/Users/currentUser/.bitfun/managed-agents/";
    let Some(path) = path else {
        return;
    };
    if path.to_string_lossy().starts_with(BITFUN_MANAGED_ROOT) {
        let _ = tokio::fs::remove_dir_all(path).await;
    }
}

fn managed_ohos_preset(client_id: &str) -> BitFunResult<&'static BuiltinAcpClientPreset> {
    let preset = builtin_acp_client_preset(client_id).ok_or_else(|| {
        BitFunError::config(format!(
            "ACP client '{}' is not a built-in preset",
            client_id
        ))
    })?;
    if !preset.supports_ohos() {
        return Err(BitFunError::config(format!(
            "[ACP_PROVISIONING_METHOD_UNSUPPORTED] ACP client '{}' has no verified HarmonyOS installation recipe",
            client_id
        )));
    }
    Ok(preset)
}

fn harmonybrew_formula_preset(client_id: &str) -> BitFunResult<&'static BuiltinAcpClientPreset> {
    let preset = managed_ohos_preset(client_id)?;
    if preset.ohos.formula().is_none() {
        return Err(BitFunError::config(format!(
            "[ACP_PROVISIONING_METHOD_UNSUPPORTED] ACP client '{}' does not use a HarmonyBrew formula recipe",
            client_id
        )));
    }
    Ok(preset)
}

fn harmonybrew_npm_preset(client_id: &str) -> BitFunResult<&'static BuiltinAcpClientPreset> {
    let preset = managed_ohos_preset(client_id)?;
    if preset.ohos.npm().is_none() {
        return Err(BitFunError::config(format!(
            "[ACP_PROVISIONING_METHOD_UNSUPPORTED] ACP client '{}' does not use a HarmonyBrew npm recipe",
            client_id
        )));
    }
    Ok(preset)
}

fn requirement_is_exact_runnable(item: &AcpRequirementProbeItem, expected: &Path) -> bool {
    item.installed
        && item.error.is_none()
        && item.path.as_deref() == Some(expected.to_string_lossy().as_ref())
}

fn requirement_detail(item: &AcpRequirementProbeItem) -> String {
    let mut details = Vec::new();
    if let Some(path) = item.path.as_deref() {
        details.push(format!("resolved path: {path}"));
    }
    if let Some(error) = item.error.as_deref() {
        details.push(format!("error: {error}"));
    }
    if details.is_empty() {
        String::new()
    } else {
        format!(" ({})", details.join(", "))
    }
}

fn required_absolute_path(item: &AcpRequirementProbeItem, name: &str) -> BitFunResult<PathBuf> {
    let Some(raw_path) = item.path.as_deref() else {
        return Err(BitFunError::service(format!(
            "[ACP_PROVISIONING_PATH_INVALID] {} did not resolve to an executable path",
            name
        )));
    };
    // These are paths on the HarmonyOS execution host. Keep their POSIX
    // semantics even when unit tests are compiled on a Windows controller.
    if !raw_path.starts_with('/') {
        return Err(BitFunError::service(format!(
            "[ACP_PROVISIONING_PATH_INVALID] {} path is not absolute: {}",
            name, raw_path
        )));
    }
    Ok(PathBuf::from(raw_path))
}

fn ensure_not_cancelled(cancelled: &Arc<AtomicBool>) -> BitFunResult<()> {
    if cancelled.load(Ordering::Acquire) {
        return Err(BitFunError::service(format!(
            "[{PROVISIONING_CANCELLED_CODE}] Managed ACP installation was cancelled"
        )));
    }
    Ok(())
}

fn command_error_summary(stderr: &[u8], stdout: &[u8]) -> String {
    let stderr = String::from_utf8_lossy(stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    let mut chars = detail.chars();
    let truncated = chars.by_ref().take(2_000).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}…")
    } else if truncated.is_empty() {
        "Installer exited without diagnostic output".to_string()
    } else {
        truncated
    }
}

fn classify_install_failure(detail: &str) -> BitFunError {
    let lower = detail.to_ascii_lowercase();
    let code = if lower.contains("permission denied")
        || lower.contains("operation not permitted")
        || lower.contains("access denied")
    {
        "ACP_PROVISIONING_PERMISSION_DENIED"
    } else if lower.contains("unsupported")
        || lower.contains("incompatible")
        || lower.contains("no bottle")
        || lower.contains("formula unavailable")
    {
        "ACP_PROVISIONING_PACKAGE_INCOMPATIBLE"
    } else if lower.contains("connection")
        || lower.contains("network")
        || lower.contains("proxy")
        || lower.contains("certificate")
        || lower.contains("download")
    {
        "ACP_PROVISIONING_NETWORK_FAILED"
    } else {
        "ACP_PROVISIONING_INSTALL_FAILED"
    };
    BitFunError::service(format!(
        "[{code}] Managed Agent installation failed: {detail}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(name: &str, installed: bool, path: Option<&str>) -> AcpRequirementProbeItem {
        AcpRequirementProbeItem {
            name: name.to_string(),
            installed,
            version: None,
            path: path.map(ToString::to_string),
            error: None,
        }
    }

    #[test]
    fn kimi_plan_uses_the_harmonybrew_formula_and_exact_paths() {
        let plan = build_formula_plan_from_environment(
            "kimi-code",
            &probe("brew", true, Some(HARMONYBREW_EXECUTABLE)),
            &probe("kimi", false, Some("/data/service/hnp/bin/kimi")),
        )
        .expect("plan");

        assert_eq!(
            plan.recipe,
            ManagedProvisioningRecipe::HarmonyBrewFormula("kimi-code")
        );
        assert_eq!(plan.brew_path, PathBuf::from(HARMONYBREW_EXECUTABLE));
        assert_eq!(
            plan.tool_path,
            PathBuf::from("/storage/Users/currentUser/.harmonybrew/bin/kimi")
        );
        assert!(!plan.tool_was_runnable);
    }

    #[test]
    fn qwen_plan_uses_the_harmonybrew_formula_and_exact_paths() {
        let plan = build_formula_plan_from_environment(
            "qwen-code",
            &probe("brew", true, Some(HARMONYBREW_EXECUTABLE)),
            &probe("qwen", false, Some("/data/service/hnp/bin/qwen")),
        )
        .expect("plan");

        assert_eq!(
            plan.recipe,
            ManagedProvisioningRecipe::HarmonyBrewFormula("qwen-code")
        );
        assert_eq!(plan.brew_path, PathBuf::from(HARMONYBREW_EXECUTABLE));
        assert_eq!(
            plan.tool_path,
            PathBuf::from("/storage/Users/currentUser/.harmonybrew/bin/qwen")
        );
        assert!(!plan.tool_was_runnable);
    }

    #[test]
    fn existing_harmonybrew_kimi_does_not_require_a_working_brew_launcher() {
        let plan = build_formula_plan_from_environment(
            "kimi-code",
            &probe("brew", false, None),
            &probe(
                "kimi",
                true,
                Some("/storage/Users/currentUser/.harmonybrew/bin/kimi"),
            ),
        )
        .expect("existing Kimi can be configured directly");

        assert!(plan.tool_was_runnable);
    }

    #[test]
    fn wrong_source_kimi_does_not_bypass_the_harmonybrew_prerequisite() {
        let error = build_formula_plan_from_environment(
            "kimi-code",
            &probe("brew", false, None),
            &probe("kimi", true, Some("/data/service/hnp/bin/kimi")),
        )
        .expect_err("non-HarmonyBrew Kimi must not be reused")
        .to_string();

        assert!(error.contains("ACP_PROVISIONING_PREREQUISITE_MISSING"));
        assert!(error.contains(HARMONYBREW_EXECUTABLE));
    }

    #[test]
    fn opencode_formula_is_detect_only() {
        let preset = managed_ohos_preset("opencode").expect("managed OpenCode preset");
        assert_eq!(preset.ohos.formula(), Some("opencode"));
        assert!(!preset.ohos.allows_managed_install());
        assert!(managed_ohos_preset("kimi-code")
            .expect("managed Kimi preset")
            .ohos
            .allows_managed_install());
    }

    #[test]
    fn runtime_override_uses_external_user_home_and_harmonybrew_path() {
        let plan = build_formula_plan_from_environment(
            "kimi-code",
            &probe("brew", false, None),
            &probe(
                "kimi",
                true,
                Some("/storage/Users/currentUser/.harmonybrew/bin/kimi"),
            ),
        )
        .expect("plan");
        let runtime = runtime_override_from_plan(
            &plan,
            &AcpClientRequirementProbe {
                id: "kimi-code".to_string(),
                tool: probe(
                    "kimi",
                    true,
                    Some("/storage/Users/currentUser/.harmonybrew/bin/kimi"),
                ),
                adapter: None,
                runnable: true,
                notes: Vec::new(),
            },
        )
        .expect("runtime override");

        assert_eq!(
            runtime.command,
            "/storage/Users/currentUser/.harmonybrew/bin/kimi"
        );
        assert_eq!(runtime.args, vec!["acp"]);
        assert_eq!(
            runtime.env.get("HOME").map(String::as_str),
            Some(HARMONYOS_USER_HOME)
        );
        assert_eq!(
            runtime.env.get("PATH").map(String::as_str),
            Some("/storage/Users/currentUser/.harmonybrew/bin:/system/bin")
        );
    }

    #[test]
    fn codebuddy_plan_uses_exact_harmonybrew_node_and_pinned_package() {
        let tool_path =
            "/storage/Users/currentUser/.harmonybrew/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy";
        let plan = build_npm_plan_from_environment(
            "codebuddy-code",
            &probe("brew", false, None),
            &probe("node", true, Some(HARMONYBREW_NODE)),
            &probe("npm", true, Some(HARMONYBREW_NPM_CLI)),
            &probe("codebuddy", true, Some(tool_path)),
        )
        .expect("existing CodeBuddy can be configured directly");

        assert_eq!(
            plan.recipe,
            ManagedProvisioningRecipe::HarmonyBrewNpm(OhosNpmManagedPreset {
                package: "@tencent-ai/codebuddy-code",
                install_version: "2.138.0",
                entry_relative_path: "lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy",
            })
        );
        assert_eq!(plan.tool_path, PathBuf::from(tool_path));
        assert_eq!(plan.runtime_path, PathBuf::from(HARMONYBREW_NODE));
        assert_eq!(plan.runtime_args, vec![tool_path, "--acp"]);
        assert!(plan.tool_was_runnable);

        let runtime = runtime_override_from_plan(
            &plan,
            &AcpClientRequirementProbe {
                id: "codebuddy-code".to_string(),
                tool: probe("codebuddy", true, Some(tool_path)),
                adapter: None,
                runnable: true,
                notes: Vec::new(),
            },
        )
        .expect("runtime override");
        assert_eq!(runtime.command, HARMONYBREW_NODE);
        assert_eq!(runtime.args, vec![tool_path, "--acp"]);
    }

    #[test]
    fn codebuddy_rejects_an_hnp_node_as_the_managed_runtime() {
        let error = build_npm_plan_from_environment(
            "codebuddy-code",
            &probe("brew", false, None),
            &probe("node", true, Some("/data/service/hnp/bin/node")),
            &probe("npm", false, None),
            &probe(
                "codebuddy",
                true,
                Some(
                    "/storage/Users/currentUser/.harmonybrew/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy",
                ),
            ),
        )
        .expect_err("HNP Node must not qualify for the HarmonyBrew-managed recipe")
        .to_string();

        assert!(error.contains("ACP_PROVISIONING_PREREQUISITE_MISSING"));
        assert!(error.contains("HarmonyBrew's exact Node/npm runtime"));
    }

    #[test]
    fn formula_failure_classification_distinguishes_platform_and_network() {
        let platform_error =
            classify_install_failure("No bottle is available for this platform").to_string();
        assert!(platform_error.contains("ACP_PROVISIONING_PACKAGE_INCOMPATIBLE"));
        assert!(platform_error.contains("Managed Agent installation failed"));
        assert!(!platform_error.contains("formula install failed"));

        let network_error =
            classify_install_failure("network connection reset during download").to_string();
        assert!(network_error.contains("ACP_PROVISIONING_NETWORK_FAILED"));
        assert!(network_error.contains("Managed Agent installation failed"));
    }
}
