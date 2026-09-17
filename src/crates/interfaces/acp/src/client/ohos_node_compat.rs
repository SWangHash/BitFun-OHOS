use std::collections::HashMap;
use std::path::Path;

#[cfg(target_env = "ohos")]
use std::path::PathBuf;

use bitfun_core::infrastructure::PathManager;
#[cfg(target_env = "ohos")]
use bitfun_core::util::errors::BitFunError;
use bitfun_core::util::errors::BitFunResult;
use tokio::process::Command;

#[cfg(target_env = "ohos")]
const NODE_OPTIONS_ENV: &str = "NODE_OPTIONS";

#[cfg(target_env = "ohos")]
const OHOS_NODE_COMPAT_SHIM: &str = include_str!("ohos_node_compat.cjs");

pub(crate) fn is_node_program(program: &Path) -> bool {
    matches!(
        program.file_name().and_then(|name| name.to_str()),
        Some("node" | "nodejs")
    )
}

pub(crate) async fn prepare_node_command(
    path_manager: &PathManager,
    program: &Path,
    args: &mut Vec<String>,
) -> BitFunResult<()> {
    if is_node_program(program) {
        #[cfg(target_env = "ohos")]
        {
            let shim_path = ensure_ohos_node_compat_shim(path_manager).await?;
            let shim_argument = format!("--require={}", shim_path.display());
            if !args.iter().any(|arg| arg == &shim_argument) {
                args.insert(0, shim_argument);
            }
        }

        #[cfg(not(target_env = "ohos"))]
        let _ = (path_manager, args);
    }

    Ok(())
}

pub(crate) fn sanitize_node_environment(
    command: &mut Command,
    program: &Path,
    configured_env: &HashMap<String, String>,
) {
    if is_node_program(program) {
        #[cfg(target_env = "ohos")]
        {
            let node_options = configured_env
                .get(NODE_OPTIONS_ENV)
                .cloned()
                .or_else(|| std::env::var(NODE_OPTIONS_ENV).ok());

            command.env_remove(NODE_OPTIONS_ENV);
            if let Some(node_options) = node_options {
                let sanitized = strip_jitless_option(&node_options);
                if !sanitized.is_empty() {
                    command.env(NODE_OPTIONS_ENV, sanitized);
                }
            }
        }

        #[cfg(not(target_env = "ohos"))]
        let _ = (command, configured_env);
    }
}

#[cfg(target_env = "ohos")]
fn strip_jitless_option(value: &str) -> String {
    value
        .split_whitespace()
        .filter(|option| *option != "--jitless" && !option.starts_with("--jitless="))
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_env = "ohos")]
async fn ensure_ohos_node_compat_shim(path_manager: &PathManager) -> BitFunResult<PathBuf> {
    let path = path_manager.user_root_dir().join(".ohos-node-compat.cjs");
    let should_write = match tokio::fs::read(&path).await {
        Ok(contents) => contents != OHOS_NODE_COMPAT_SHIM.as_bytes(),
        Err(_) => true,
    };

    if should_write {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|error| {
                BitFunError::service(format!(
                    "Failed to create the HarmonyOS Node compatibility directory '{}': {}",
                    parent.display(),
                    error
                ))
            })?;
        }
        tokio::fs::write(&path, OHOS_NODE_COMPAT_SHIM)
            .await
            .map_err(|error| {
                BitFunError::service(format!(
                    "Failed to write the HarmonyOS Node compatibility shim '{}': {}",
                    path.display(),
                    error
                ))
            })?;
    }

    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::is_node_program;
    use std::path::Path;

    #[test]
    fn recognizes_node_runtime_names() {
        assert!(is_node_program(Path::new(
            "/storage/Users/currentUser/.harmonybrew/bin/node"
        )));
        assert!(is_node_program(Path::new("nodejs")));
        assert!(!is_node_program(Path::new("/usr/bin/npm")));
        assert!(!is_node_program(Path::new("/usr/bin/kimi")));
    }

    #[cfg(target_env = "ohos")]
    #[test]
    fn removes_jitless_without_dropping_other_node_options() {
        use super::strip_jitless_option;

        assert_eq!(
            strip_jitless_option("--jitless --trace-warnings --jitless=true"),
            "--trace-warnings"
        );
        assert_eq!(strip_jitless_option("--jitless"), "");
    }
}
