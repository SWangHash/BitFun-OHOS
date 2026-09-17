use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use log::{debug, warn};

use super::{ShellDetector, VERSION_PROBE_TIMEOUT_MS};

impl ShellDetector {
    pub(super) fn probe_powershell_version(path: &Path) -> Option<String> {
        Self::run_version_probe(
            path,
            &[
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$PSVersionTable.PSVersion.ToString()",
            ],
        )
    }

    pub(super) fn probe_shell_version(path: &Path) -> Option<String> {
        Self::run_version_probe(path, &["--version"])
    }

    fn run_version_probe(path: &Path, args: &[&str]) -> Option<String> {
        let mut command = Command::new(path);
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command
            .spawn()
            .map_err(|error| {
                log::warn!(
                    "======= Shell version probe spawn failed: path={:?}, args={:?}, error={}",
                    path,
                    args,
                    error
                );
            })
            .ok()?;
        let deadline = Instant::now() + Duration::from_millis(VERSION_PROBE_TIMEOUT_MS);
        debug!(
            "======= Shell version probe started: path={:?}, child_pid={}, timeout_ms={}",
            path,
            child.id(),
            VERSION_PROBE_TIMEOUT_MS
        );
        loop {
            match child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
                Ok(None) => {
                    warn!(
                        "======= Shell version probe timed out: path={:?}, timeout_ms={}",
                        path, VERSION_PROBE_TIMEOUT_MS
                    );
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                Err(error) => {
                    warn!(
                        "======= Shell version probe wait failed: path={:?}, error={}",
                        path, error
                    );
                    return None;
                }
            }
        }
        let output = child
            .wait_with_output()
            .map_err(|error| {
                warn!(
                    "======= Shell version probe output failed: path={:?}, error={}",
                    path, error
                );
            })
            .ok()?;
        debug!(
            "======= Shell version probe exited: path={:?}, status={}, stdout_bytes={}",
            path,
            output.status,
            output.stdout.len()
        );
        if !output.status.success() {
            return None;
        }
        let version = String::from_utf8(output.stdout)
            .map_err(|error| {
                debug!(
                    "======= Shell version probe invalid UTF-8: path={:?}, error={}",
                    path,
                    error.utf8_error()
                );
            })
            .ok()
            .and_then(|value| {
                value
                    .lines()
                    .find(|line| !line.trim().is_empty())
                    .map(str::to_owned)
            });
        debug!(
            "======= Shell version probe parsed: path={:?}, version={:?}",
            path, version
        );
        version
    }
}
