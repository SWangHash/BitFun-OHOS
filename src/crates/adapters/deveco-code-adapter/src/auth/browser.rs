//! Child-local browser opening for DevEco Code's `xdg-open` call on HarmonyOS.

use super::{DevEcoBrowserOpener, UNAVAILABLE};
use std::fs;
use std::path::Path;
use std::time::Duration;
use tempfile::TempDir;
use tokio::process::Command;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};

pub(super) struct BrowserBridge {
    directory: TempDir,
    watcher: JoinHandle<()>,
}

impl BrowserBridge {
    pub(super) fn new(opener: DevEcoBrowserOpener, parent: &Path) -> Result<Self, String> {
        fs::create_dir_all(parent).map_err(|_| UNAVAILABLE.to_string())?;
        let directory = tempfile::Builder::new()
            .prefix("bitfun-deveco-browser-")
            .tempdir_in(parent)
            .map_err(|_| UNAVAILABLE.to_string())?;
        write_shim(directory.path())?;
        let path = directory.path().to_path_buf();
        let watcher = tokio::spawn(async move {
            loop {
                let request = fs::read_dir(&path).ok().and_then(|entries| {
                    entries.filter_map(Result::ok).find_map(|entry| {
                        let name = entry.file_name();
                        let id = name.to_str()?.strip_prefix("request-")?;
                        if id.ends_with(".tmp") {
                            return None;
                        }
                        Some((entry.path(), id.to_string()))
                    })
                });
                if let Some((request, id)) = request {
                    let Ok(url) = fs::read_to_string(&request) else {
                        sleep(Duration::from_millis(50)).await;
                        continue;
                    };
                    let _ = fs::remove_file(&request);
                    // This channel only opens browser URLs. It never forwards
                    // a scheme that could invoke another local application.
                    let parsed = reqwest::Url::parse(&url);
                    let valid = parsed.as_ref().is_ok_and(|url| {
                        matches!(url.scheme(), "https" | "http")
                            && url.username().is_empty()
                            && url.password().is_none()
                    });
                    let opened = valid
                        && matches!(
                            timeout(Duration::from_secs(10), opener(url)).await,
                            Ok(Ok(()))
                        );
                    let acknowledgement = path.join(format!("ack-{id}"));
                    let temporary = path.join(format!("ack-{id}.tmp"));
                    if fs::write(&temporary, if opened { "ok\n" } else { "error\n" }).is_ok() {
                        let _ = fs::rename(temporary, acknowledgement);
                    }
                }
                sleep(Duration::from_millis(50)).await;
            }
        });
        Ok(Self { directory, watcher })
    }

    pub(super) fn prepare_login(&self) -> Result<(), String> {
        for entry in fs::read_dir(self.directory.path()).map_err(|_| UNAVAILABLE.to_string())? {
            let entry = entry.map_err(|_| UNAVAILABLE.to_string())?;
            let name = entry.file_name();
            if name
                .to_str()
                .is_some_and(|name| name.starts_with("request-") || name.starts_with("ack-"))
            {
                match fs::remove_file(entry.path()) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err(UNAVAILABLE.to_string()),
                }
            }
        }
        fs::write(
            self.directory.path().join("generation"),
            format!("{}\n", uuid::Uuid::new_v4()),
        )
        .map_err(|_| UNAVAILABLE.to_string())?;
        Ok(())
    }

    pub(super) fn configure_command(&self, command: &mut Command) -> Result<(), String> {
        // Preserve the command's platform-enriched PATH and explicit launch
        // overrides. Rebuilding it from the parent would discard OHOS tools.
        let path = command
            .as_std()
            .get_envs()
            .find(|(key, _)| *key == std::ffi::OsStr::new("PATH"))
            .and_then(|(_, value)| value.map(std::ffi::OsStr::to_os_string))
            .or_else(|| std::env::var_os("PATH"))
            .unwrap_or_default();
        let paths = std::iter::once(self.directory.path().to_path_buf())
            .chain(std::env::split_paths(&path));
        let path = std::env::join_paths(paths).map_err(|_| UNAVAILABLE.to_string())?;
        command
            .env("PATH", path)
            .env("BITFUN_DEVECO_BROWSER_DIR", self.directory.path());
        Ok(())
    }
}

impl Drop for BrowserBridge {
    fn drop(&mut self) {
        self.watcher.abort();
        // TempDir removes URL requests, acknowledgements, and the executable.
    }
}

fn write_shim(directory: &Path) -> Result<(), String> {
    let shell = if cfg!(target_env = "ohos") {
        "/system/bin/sh"
    } else {
        "/bin/sh"
    };
    let script = format!(
        "#!{shell}\n\
set -eu\n\
[ \"$#\" -eq 1 ] || exit 1\n\
dir=\"${{BITFUN_DEVECO_BROWSER_DIR:?}}\"\n\
umask 077\n\
IFS= read -r generation < \"$dir/generation\"\n\
request=\"$dir/request-$generation\"\n\
ack=\"$dir/ack-$generation\"\n\
printf '%s' \"$1\" > \"$request.tmp\"\n\
mv \"$request.tmp\" \"$request\"\n\
i=0\n\
while [ \"$i\" -lt 15 ]; do\n\
  if [ -f \"$ack\" ]; then\n\
    IFS= read -r result < \"$ack\" || true\n\
    [ \"$result\" = ok ] && exit 0\n\
    exit 1\n\
  fi\n\
  sleep 1\n\
  i=$((i + 1))\n\
done\n\
exit 1\n"
    );
    let executable = directory.join("xdg-open");
    fs::write(&executable, script).map_err(|_| UNAVAILABLE.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .and_then(|()| fs::set_permissions(executable, fs::Permissions::from_mode(0o700)))
            .map_err(|_| UNAVAILABLE.to_string())?;
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use bitfun_services_core::process_manager::create_tokio_command;
    use std::sync::{Arc, Mutex};

    #[test]
    fn private_shim_delivers_url_and_propagates_open_result() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let received = Arc::new(Mutex::new(Vec::new()));
            let recorded = received.clone();
            let parent = tempfile::tempdir().unwrap();
            let bridge = BrowserBridge::new(
                Arc::new(move |url| {
                    let fail = {
                        let mut urls = recorded.lock().unwrap();
                        urls.push(url);
                        urls.len() == 1
                    };
                    Box::pin(async move {
                        if fail {
                            Err("fixture_open_failed".to_string())
                        } else {
                            Ok(())
                        }
                    })
                }),
                parent.path(),
            )
            .unwrap();
            let directory = bridge.directory.path().to_path_buf();
            assert!(directory.starts_with(parent.path()));
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
                    0o700
                );
                assert_eq!(
                    fs::metadata(directory.join("xdg-open"))
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o700
                );
            }
            let mut configured = create_tokio_command(directory.join("xdg-open"));
            configured.env("PATH", "/fixture/platform-tools");
            bridge.configure_command(&mut configured).unwrap();
            let path = configured
                .as_std()
                .get_envs()
                .find(|(key, _)| *key == std::ffi::OsStr::new("PATH"))
                .and_then(|(_, value)| value)
                .unwrap();
            assert_eq!(
                std::env::split_paths(path).collect::<Vec<_>>(),
                [directory.clone(), "/fixture/platform-tools".into()]
            );
            bridge.prepare_login().unwrap();
            let mut command = create_tokio_command(directory.join("xdg-open"));
            bridge.configure_command(&mut command).unwrap();
            let url = "https://example.test/login?code=private-fixture";
            assert!(!command.arg(url).status().await.unwrap().success());
            assert_eq!(received.lock().unwrap().as_slice(), [url]);
            bridge.prepare_login().unwrap();
            let mut retry = create_tokio_command(directory.join("xdg-open"));
            bridge.configure_command(&mut retry).unwrap();
            assert!(retry.arg(url).status().await.unwrap().success());
            assert_eq!(received.lock().unwrap().as_slice(), [url, url]);
            drop(bridge);
            assert!(!directory.exists());
        });
    }
}
