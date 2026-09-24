//! Direct DevEco SDK ArkTS checker — spawns DevEco Studio's bundled Node with
//! the embedded `arkts-check.cjs` script, which loads the SDK's
//! `ets_checker.js` standalone checker.
//!
//! This path does **not** depend on the `deveco-mcp` MCP server. All external
//! failures (missing DevEco, missing Node, missing SDK, timeout, cancellation,
//! malformed output) are returned as recoverable `BitFunError::tool` errors.

use crate::util::errors::{BitFunError, BitFunResult};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

/// Embedded ArkTS checker script (ported from deveco-code `arkts-check.cjs`).
const ARKTS_CHECK_SCRIPT: &str = include_str!("arkts-check.cjs");

/// Default checker timeout (5 minutes). The SDK checker can be slow on large
/// projects; this is generous but still bounded.
const DEFAULT_CHECK_TIMEOUT: Duration = Duration::from_secs(300);

/// Maximum stdout/stderr capture (256 KB per stream).
const OUTPUT_LIMIT: usize = 256 * 1024;

/// Minimum DevEco Studio version required.
const MIN_DEVECO_STUDIO_VERSION: &str = "6.0.0";

/// A single ArkTS diagnostic from the checker.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub(crate) struct ArktsDiagnostic {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub severity: String,
    pub message: String,
    #[serde(default)]
    pub rule: String,
}

/// Summary counts from the checker output.
#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct ArktsSummary {
    #[serde(default)]
    pub error_count: u32,
    #[serde(default)]
    pub warn_count: u32,
}

/// Structured checker JSON output.
#[derive(Debug, Clone, serde::Deserialize)]
pub(crate) struct ArktsCheckOutput {
    #[serde(default)]
    pub success: bool,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub errors: Vec<ArktsDiagnostic>,
    #[serde(default)]
    pub summary: Option<ArktsSummary>,
}

/// Result of a direct ArkTS check.
pub(crate) struct ArktsCheckResult {
    pub output: ArktsCheckOutput,
    pub files_checked: Vec<String>,
}

/// Run a direct ArkTS syntax check on the given `.ets` files using DevEco
/// Studio's bundled Node and SDK checker. Does not use MCP.
pub(crate) async fn run_arkts_check(
    files: &[String],
    project_root: &str,
) -> BitFunResult<ArktsCheckResult> {
    if files.is_empty() {
        return Err(BitFunError::tool(
            "No .ets files to check after filtering.".to_string(),
        ));
    }
    if project_root.trim().is_empty() {
        return Err(BitFunError::tool(
            "Project root is empty; cannot run ArkTS check.".to_string(),
        ));
    }
    if !Path::new(project_root).is_dir() {
        return Err(BitFunError::tool(format!(
            "Project root does not exist or is not a directory: {}",
            project_root
        )));
    }

    let deveco_home = resolve_deveco_home()
        .ok_or_else(|| {
            BitFunError::tool(format!(
                "DevEco Studio installation not found. Set DEVECO_HOME to your DevEco Studio \
                 installation directory (minimum version {}) and retry.",
                MIN_DEVECO_STUDIO_VERSION
            ))
        })?;

    let node = node_path(&deveco_home);
    if !node.is_file() {
        return Err(BitFunError::tool(format!(
            "Node binary not found in DevEco Studio at: {}. Ensure DevEco Studio is installed \
             correctly.",
            node.display()
        )));
    }

    let ets_loader = ets_loader_path(&deveco_home);
    if ets_loader.is_none() {
        return Err(BitFunError::tool(format!(
            "Cannot find ets-loader (lib/ets_checker.js) in DevEco SDK at: {}. Ensure the \
             HarmonyOS SDK is installed via DevEco Studio.",
            deveco_home.display()
        )));
    }

    let script_path = ensure_script_on_disk().await.map_err(|e| {
        BitFunError::tool(format!("Failed to materialize arkts-check script: {}", e))
    })?;

    let mut cmd = Command::new(&node);
    cmd.arg(&script_path)
        .arg("--project")
        .arg(project_root)
        .arg("--deveco-home")
        .arg(&deveco_home)
        .arg("--files")
        .args(files)
        .current_dir(project_root)
        .kill_on_drop(true)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

    cmd.env("DEVECO_HOME", &deveco_home);

    log::info!(
        "arkts_check: spawning Node {} with {} file(s) (project: {})",
        node.display(),
        files.len(),
        project_root
    );

    let child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(BitFunError::tool(format!(
                "Failed to spawn Node at {}: not found",
                node.display()
            )));
        }
        Err(e) => {
            return Err(BitFunError::tool(format!(
                "Failed to spawn Node for ArkTS check: {}",
                e
            )));
        }
    };

    let wait_future = child.wait_with_output();
    let output = match tokio::time::timeout(DEFAULT_CHECK_TIMEOUT, wait_future).await {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => {
            return Err(BitFunError::tool(format!(
                "ArkTS check process failed to collect output: {}",
                e
            )));
        }
        Err(_) => {
            return Err(BitFunError::tool(format!(
                "ArkTS check timed out after {:?}. The DevEco SDK checker may be stuck or the \
                 project is too large. Try checking fewer files.",
                DEFAULT_CHECK_TIMEOUT
            )));
        }
    };

    let stdout = truncate_utf8(&String::from_utf8_lossy(&output.stdout), OUTPUT_LIMIT);
    let stderr = truncate_utf8(&String::from_utf8_lossy(&output.stderr), OUTPUT_LIMIT);
    let exit_code = output.status.code().unwrap_or(-1);

    let stdout_trimmed = stdout.trim();
    if stdout_trimmed.is_empty() {
        let detail = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            format!("arkts-check exited with code {} but produced no output", exit_code)
        };
        return Err(BitFunError::tool(format!(
            "ArkTS check produced no output: {}",
            detail
        )));
    }

    let parsed: ArktsCheckOutput = match serde_json::from_str(stdout_trimmed) {
        Ok(parsed) => parsed,
        Err(e) => {
            let excerpt: String = stdout_trimmed.chars().take(500).collect();
            return Err(BitFunError::tool(format!(
                "Failed to parse arkts-check JSON output: {}. Output (first 500 chars): {}",
                e, excerpt
            )));
        }
    };

    if let Some(err_msg) = &parsed.error {
        if parsed.errors.is_empty() {
            return Err(BitFunError::tool(format!(
                "ArkTS checker reported an error: {}",
                err_msg
            )));
        }
    }

    Ok(ArktsCheckResult {
        output: parsed,
        files_checked: files.to_vec(),
    })
}

/// Resolve the DevEco Studio installation directory.
///
/// Checks `DEVECO_HOME` env first, then common platform defaults. Validates
/// that the Node binary exists and `product-info.json` is readable.
fn resolve_deveco_home() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("DEVECO_HOME") {
        let home = PathBuf::from(home);
        if is_valid_deveco_home(&home) {
            return Some(home);
        }
        if cfg!(target_os = "macos") {
            let contents = home.join("Contents");
            if is_valid_deveco_home(&contents) {
                return Some(contents);
            }
        }
    }

    for candidate in default_deveco_home_candidates() {
        if is_valid_deveco_home(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn default_deveco_home_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/Applications/DevEco-Studio.app"));
    } else if cfg!(target_os = "linux") {
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(PathBuf::from(&home).join("devecostudio"));
            candidates.push(PathBuf::from(&home).join("DevEco-Studio"));
        }
    } else {
        candidates.push(PathBuf::from("D:\\DevEco Studio"));
        candidates.push(PathBuf::from("C:\\Program Files\\Huawei\\DevEco Studio"));
        candidates.push(PathBuf::from("C:\\Program Files\\DevEco Studio"));
        candidates.push(PathBuf::from("C:\\Program Files (x86)\\DevEco Studio"));
        if let Some(home) = std::env::var_os("USERPROFILE") {
            candidates.push(PathBuf::from(&home).join("DevEco Studio"));
        }
    }
    candidates
}

fn is_valid_deveco_home(home: &Path) -> bool {
    if !home.is_dir() {
        return false;
    }
    let node = node_path(home);
    if !node.is_file() {
        return false;
    }
    let product_info = product_info_path(home);
    if !product_info.is_file() {
        return false;
    }
    match std::fs::read_to_string(&product_info) {
        Ok(text) => {
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(version) = data.get("version").and_then(|v| v.as_str()) {
                    return meets_min_version(version);
                }
            }
            false
        }
        Err(_) => false,
    }
}

fn meets_min_version(version: &str) -> bool {
    let parsed = parse_version(version);
    let min = parse_version(MIN_DEVECO_STUDIO_VERSION);
    match (parsed, min) {
        (Some(p), Some(m)) => p >= m,
        _ => false,
    }
}

/// Parse a version string like "6.1.0" or "6.1.0 Release" into (major, minor, patch).
fn parse_version(s: &str) -> Option<(u32, u32, u32)> {
    let parts: Vec<&str> = s.split(|c: char| !c.is_ascii_digit()).collect();
    let nums: Vec<u32> = parts
        .iter()
        .filter(|p| !p.is_empty())
        .filter_map(|p| p.parse::<u32>().ok())
        .collect();
    if nums.len() >= 3 {
        Some((nums[0], nums[1], nums[2]))
    } else if nums.len() == 2 {
        Some((nums[0], nums[1], 0))
    } else if nums.len() == 1 {
        Some((nums[0], 0, 0))
    } else {
        None
    }
}

fn node_path(home: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        home.join("tools").join("node").join("node.exe")
    } else {
        home.join("tools").join("node").join("bin").join("node")
    }
}

fn product_info_path(home: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Resources").join("product-info.json")
    } else {
        home.join("product-info.json")
    }
}

fn ets_loader_path(home: &Path) -> Option<PathBuf> {
    let candidates = [
        home.join("sdk")
            .join("default")
            .join("openharmony")
            .join("ets")
            .join("build-tools")
            .join("ets-loader"),
        home.join("sdk")
            .join("openharmony")
            .join("ets")
            .join("build-tools")
            .join("ets-loader"),
    ];
    for c in &candidates {
        let checker = c.join("lib").join("ets_checker.js");
        if checker.is_file() {
            return Some(c.clone());
        }
    }
    None
}

/// Write the embedded checker script to a temp cache directory, reusing it if
/// already present and matching.
async fn ensure_script_on_disk() -> BitFunResult<PathBuf> {
    let cache_dir = std::env::temp_dir().join("deveco-arkts-check");
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| BitFunError::tool(format!("Failed to create cache dir: {}", e)))?;
    let target = cache_dir.join("arkts-check.cjs");

    let needs_write = match tokio::fs::read_to_string(&target).await {
        Ok(existing) if existing == ARKTS_CHECK_SCRIPT => false,
        _ => true,
    };

    if needs_write {
        let temp_path = cache_dir.join(format!(".arkts-check.{}.tmp", uuid::Uuid::new_v4()));
        tokio::fs::write(&temp_path, ARKTS_CHECK_SCRIPT)
            .await
            .map_err(|e| BitFunError::tool(format!("Failed to write checker script: {}", e)))?;
        if let Err(e) = tokio::fs::rename(&temp_path, &target).await {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(BitFunError::tool(format!(
                "Failed to rename checker script into place: {}",
                e
            )));
        }
    }

    Ok(target)
}

fn truncate_utf8(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_string();
    }
    let mut end = limit.min(text.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n\n[output truncated at {} bytes]", &text[..end], limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_handles_clean_versions() {
        assert_eq!(parse_version("6.1.0"), Some((6, 1, 0)));
        assert_eq!(parse_version("6.0.0"), Some((6, 0, 0)));
        assert_eq!(parse_version("5.1.2"), Some((5, 1, 2)));
    }

    #[test]
    fn parse_version_handles_suffixes() {
        assert_eq!(parse_version("6.1.0 Release"), Some((6, 1, 0)));
        assert_eq!(parse_version("6.1.0 (Canary)"), Some((6, 1, 0)));
    }

    #[test]
    fn meets_min_version_accepts_newer_rejects_older() {
        assert!(meets_min_version("6.0.0"));
        assert!(meets_min_version("6.1.0"));
        assert!(meets_min_version("7.0.0"));
        assert!(!meets_min_version("5.9.9"));
    }

    #[test]
    fn node_path_resolves_platform_correctly() {
        let home = PathBuf::from("/fake/deveco");
        let node = node_path(&home);
        if cfg!(target_os = "windows") {
            assert!(node.ends_with("tools\\node\\node.exe"));
        } else {
            assert!(node.ends_with("tools/node/bin/node"));
        }
    }

    #[test]
    fn ets_loader_path_returns_none_for_nonexistent() {
        let home = PathBuf::from("/nonexistent");
        assert!(ets_loader_path(&home).is_none());
    }

    #[test]
    fn truncate_utf8_preserves_short_strings() {
        assert_eq!(truncate_utf8("hello", 100), "hello");
    }

    #[test]
    fn truncate_utf8_respects_char_boundary() {
        let text = "a".repeat(100);
        let truncated = truncate_utf8(&text, 50);
        assert!(truncated.contains("[output truncated at 50 bytes]"));
    }

    #[test]
    fn truncate_utf8_does_not_split_multibyte() {
        let text = "ü".repeat(100);
        let truncated = truncate_utf8(&text, 3);
        assert!(!truncated.is_empty());
    }

    #[test]
    fn arkts_check_output_deserializes_valid_json() {
        let json = r#"{
            "success": true,
            "errors": [],
            "summary": { "errorCount": 0, "warnCount": 0 }
        }"#;
        let parsed: ArktsCheckOutput = serde_json::from_str(json).unwrap();
        assert!(parsed.success);
        assert!(parsed.errors.is_empty());
        assert_eq!(parsed.summary.unwrap().error_count, 0);
    }

    #[test]
    fn arkts_check_output_deserializes_with_error() {
        let json = r#"{
            "success": false,
            "error": "Cannot find ets-loader",
            "errors": [],
            "summary": null
        }"#;
        let parsed: ArktsCheckOutput = serde_json::from_str(json).unwrap();
        assert!(!parsed.success);
        assert_eq!(parsed.error.as_deref(), Some("Cannot find ets-loader"));
        assert!(parsed.summary.is_none());
    }

    #[test]
    fn arkts_check_output_deserializes_diagnostics() {
        let json = r#"{
            "success": false,
            "errors": [
                {
                    "file": "src/Index.ets",
                    "line": 10,
                    "column": 5,
                    "severity": "error",
                    "message": "Cannot find name 'foo'",
                    "rule": "arkts-no-undeclared"
                }
            ],
            "summary": { "errorCount": 1, "warnCount": 0 }
        }"#;
        let parsed: ArktsCheckOutput = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.errors.len(), 1);
        let d = &parsed.errors[0];
        assert_eq!(d.file, "src/Index.ets");
        assert_eq!(d.line, 10);
        assert_eq!(d.severity, "error");
        assert_eq!(d.rule, "arkts-no-undeclared");
    }

    #[tokio::test]
    async fn ensure_script_on_disk_writes_and_reuses() {
        let target = ensure_script_on_disk().await.unwrap();
        assert!(target.is_file());
        let content = tokio::fs::read_to_string(&target).await.unwrap();
        assert_eq!(content, ARKTS_CHECK_SCRIPT);

        let second = ensure_script_on_disk().await.unwrap();
        assert_eq!(second, target);
    }

    #[test]
    fn embedded_script_is_not_empty() {
        assert!(!ARKTS_CHECK_SCRIPT.is_empty());
        assert!(ARKTS_CHECK_SCRIPT.contains("etsStandaloneChecker"));
    }

    #[tokio::test]
    async fn run_arkts_check_rejects_empty_files() {
        let result = run_arkts_check(&[], "/tmp").await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn run_arkts_check_rejects_nonexistent_project() {
        let result = run_arkts_check(&["foo.ets".to_string()], "/nonexistent/path/xyz").await;
        assert!(result.is_err());
    }
}
