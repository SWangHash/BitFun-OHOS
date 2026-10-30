//! Clipboard File API

use bitfun_core::service::remote_ssh::workspace_state::is_remote_path;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Returns the first path in `paths` that belongs to a registered remote workspace.
async fn first_remote_path<'a>(paths: impl Iterator<Item = &'a str>) -> Option<String> {
    for path in paths {
        if is_remote_path(path.trim()).await {
            return Some(path.to_string());
        }
    }
    None
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFilesResponse {
    pub files: Vec<String>,
    pub is_cut: bool,
    /// Per-candidate pasteboard read failures (OHOS bridge only; empty
    /// elsewhere). A folder the engine cannot expand lands here so the
    /// frontend can tell a silent miss from an empty clipboard.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyFilesToClipboardRequest {
    pub source_paths: Vec<String>,
    pub is_cut: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteFilesRequest {
    pub source_paths: Vec<String>,
    pub target_directory: String,
    pub is_cut: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteFilesResponse {
    pub success_count: usize,
    pub failed_files: Vec<FailedFile>,
    pub directory_count: usize,
}

#[derive(Debug, Serialize)]
pub struct FailedFile {
    pub path: String,
    pub error: String,
}

fn normalize_decoded_file_path(mut path: String) -> String {
    path = path.replace('\\', "/");

    while path.starts_with("//") {
        path = path[1..].to_string();
    }

    if let Some(rest) = path.strip_prefix('/') {
        if rest.len() >= 2 {
            let bytes = rest.as_bytes();
            if bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
                path = rest.to_string();
            }
        }
    }

    if path.len() >= 2 {
        let bytes = path.as_bytes();
        if bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            path = format!("{}{}", bytes[0].to_ascii_uppercase() as char, &path[1..]);
        }
    }

    path
}

fn decode_file_uri(uri: &str) -> Option<String> {
    let trimmed = uri.trim();
    if !trimmed.starts_with("file://") {
        return None;
    }

    let rest = trimmed.strip_prefix("file://")?;
    let path_part = if rest.starts_with('/') {
        rest.to_string()
    } else if let Some(slash_idx) = rest.find('/') {
        let host = &rest[..slash_idx];
        if host.eq_ignore_ascii_case("localhost") {
            rest[slash_idx..].to_string()
        } else {
            return None;
        }
    } else {
        return None;
    };

    let decoded = urlencoding::decode(&path_part)
        .map(|value| value.into_owned())
        .unwrap_or(path_part);

    Some(normalize_decoded_file_path(decoded))
}

#[allow(dead_code)]
fn parse_uri_list(content: &str) -> Vec<String> {
    content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(decode_file_uri)
        .collect()
}

#[cfg(any(target_os = "macos", test))]
fn parse_clipboard_path_segments(content: &str) -> Vec<String> {
    content
        .split(['\n', '\r'])
        .flat_map(|segment| segment.split(','))
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(|segment| decode_file_uri(segment).unwrap_or_else(|| segment.to_string()))
        .collect()
}

#[cfg(target_os = "windows")]
mod windows_clipboard {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;

    const CF_HDROP: u32 = 15;

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: *mut std::ffi::c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn GetClipboardData(format: u32) -> *mut std::ffi::c_void;
        fn IsClipboardFormatAvailable(format: u32) -> i32;
    }

    #[link(name = "shell32")]
    extern "system" {
        fn DragQueryFileW(
            hdrop: *mut std::ffi::c_void,
            file_index: u32,
            file_name: *mut u16,
            buffer_size: u32,
        ) -> u32;
    }

    pub(super) fn get_clipboard_files() -> Result<Vec<String>, String> {
        unsafe {
            if IsClipboardFormatAvailable(CF_HDROP) == 0 {
                return Ok(Vec::new());
            }

            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Err("Failed to open clipboard".to_string());
            }

            struct ClipboardGuard;
            impl Drop for ClipboardGuard {
                fn drop(&mut self) {
                    unsafe {
                        CloseClipboard();
                    }
                }
            }
            let _guard = ClipboardGuard;

            let hdrop = GetClipboardData(CF_HDROP);
            if hdrop.is_null() {
                return Ok(Vec::new());
            }

            let file_count = DragQueryFileW(hdrop, u32::MAX, std::ptr::null_mut(), 0);
            if file_count == 0 {
                return Ok(Vec::new());
            }

            let mut files = Vec::with_capacity(file_count as usize);
            for index in 0..file_count {
                let len = DragQueryFileW(hdrop, index, std::ptr::null_mut(), 0);
                if len == 0 {
                    continue;
                }

                let mut buffer = vec![0_u16; len as usize + 1];
                let actual_len = DragQueryFileW(hdrop, index, buffer.as_mut_ptr(), len + 1);
                if actual_len > 0 {
                    files.push(
                        OsString::from_wide(&buffer[..actual_len as usize])
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
            }

            Ok(files)
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_clipboard {
    use super::parse_clipboard_path_segments;
    use std::process::Command;

    pub(super) fn get_clipboard_files() -> Result<Vec<String>, String> {
        let output = Command::new("osascript")
            .args([
                "-e",
                r#"
                set theFiles to {}
                set linefeed to ASCII character 10
                set output to ""
                try
                    set theClip to the clipboard as «class furl»
                    set output to (POSIX path of theClip) & linefeed
                on error
                    try
                        set theClip to the clipboard as list
                        repeat with aFile in theClip
                            try
                                set output to output & (POSIX path of (aFile as alias)) & linefeed
                            end try
                        end repeat
                    end try
                end try
                return output
                "#,
            ])
            .output()
            .map_err(|e| format!("Failed to execute osascript: {}", e))?;

        if output.status.success() {
            let paths_str = String::from_utf8_lossy(&output.stdout);
            Ok(parse_clipboard_path_segments(&paths_str))
        } else {
            Ok(Vec::new())
        }
    }
}

#[cfg(all(target_os = "linux", not(target_env = "ohos")))]
mod linux_clipboard {
    use super::parse_uri_list;
    use std::process::Command;

    fn read_xclip_uri_list() -> Option<String> {
        let output = Command::new("xclip")
            .args(["-selection", "clipboard", "-t", "text/uri-list", "-o"])
            .output()
            .ok()?;

        if output.status.success() {
            Some(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            None
        }
    }

    fn read_wl_paste_uri_list() -> Option<String> {
        let output = Command::new("wl-paste")
            .args(["-t", "text/uri-list"])
            .output()
            .ok()?;

        if output.status.success() {
            Some(String::from_utf8_lossy(&output.stdout).into_owned())
        } else {
            None
        }
    }

    pub(super) fn get_clipboard_files() -> Result<Vec<String>, String> {
        let content = read_xclip_uri_list()
            .or_else(read_wl_paste_uri_list)
            .unwrap_or_default();

        Ok(parse_uri_list(&content))
    }
}

/// HarmonyOS clipboard reader.
///
/// On OHOS `target_os` is `"linux"` with `target_env = "ohos"`, so the linux
/// `xclip`/`wl-paste` path is unreachable here. Instead we bridge into the
/// ArkTS layer (`bitfun_core::util::get_clipboard_files`), which reads
/// `@ohos.pasteboard` via a registered threadsafe function and returns the
/// same `{ paths: [...] }` envelope the file picker uses. This is the only
/// way to reach the system pasteboard from the Rust side on OHOS.
#[cfg(target_env = "ohos")]
mod ohos_clipboard {
    pub(super) async fn get_clipboard_files()
    -> Result<bitfun_core::util::ClipboardReadEnvelope, String> {
        bitfun_core::util::get_clipboard_files().await
    }
}

#[cfg(not(target_env = "ohos"))]
fn get_clipboard_files_internal() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        windows_clipboard::get_clipboard_files()
    }

    #[cfg(target_os = "macos")]
    {
        macos_clipboard::get_clipboard_files()
    }

    #[cfg(all(target_os = "linux", not(target_env = "ohos")))]
    {
        linux_clipboard::get_clipboard_files()
    }

    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        all(target_os = "linux", not(target_env = "ohos"))
    )))]
    {
        Err("Reading clipboard files is not supported on this platform".to_string())
    }
}

async fn get_clipboard_files_for_platform()
-> Result<(Vec<String>, Vec<String>), String> {
    #[cfg(target_env = "ohos")]
    {
        let envelope = ohos_clipboard::get_clipboard_files().await?;
        Ok((envelope.paths, envelope.errors))
    }

    #[cfg(not(target_env = "ohos"))]
    {
        Ok((get_clipboard_files_internal()?, Vec::new()))
    }
}

#[tauri::command]
pub async fn get_clipboard_files() -> Result<ClipboardFilesResponse, String> {
    match get_clipboard_files_for_platform().await {
        Ok((files, read_errors)) => {
            if !read_errors.is_empty() {
                log::warn!(
                    "Clipboard read skipped {} candidate(s): {}",
                    read_errors.len(),
                    read_errors.join("; ")
                );
            }
            Ok(ClipboardFilesResponse {
                files,
                is_cut: false,
                errors: read_errors,
            })
        }
        Err(e) => {
            log::error!("Failed to read clipboard files: {}", e);
            Err(e)
        }
    }
}

/// Write workspace paths to the system clipboard as a file selection so
/// external file managers can paste them (issue #326).
///
/// Every platform writes CF_HDROP-equivalent content where the OS provides
/// one; the OHOS path bridges into the ArkTS pasteboard
/// (`CommonUtils.write_clipboard_files`). The cut flag is best-effort: only
/// Windows carries a "Preferred DropEffect" move hint.
#[cfg(target_os = "windows")]
mod windows_clipboard_write {
    use std::ffi::c_void;

    const CF_HDROP: u32 = 15;
    const GMEM_MOVEABLE: u32 = 0x0002;
    const DROPEFFECT_COPY: u32 = 1;
    const DROPEFFECT_MOVE: u32 = 2;

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalLock(hmem: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(hmem: *mut c_void) -> i32;
        fn GlobalFree(hmem: *mut c_void) -> *mut c_void;
    }

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, handle: *mut c_void) -> *mut c_void;
        fn RegisterClipboardFormatW(format_name: *const u16) -> u32;
    }

    /// Build the CF_HDROP payload: a DROPFILES header followed by a wide,
    /// double-NUL-terminated path list.
    fn build_hdrop_buffer(paths: &[String]) -> Result<Vec<u8>, String> {
        let mut wide: Vec<u16> = Vec::new();
        for path in paths {
            let encoded: Vec<u16> = path.encode_utf16().collect();
            if encoded.contains(&0) {
                return Err(format!("Path contains interior NUL: {path}"));
            }
            wide.extend_from_slice(&encoded);
            wide.push(0);
        }
        wide.push(0);

        // DROPFILES { pFiles: u32 = 20, pt: (x=0, y=0), fNC: 0, fWide: 1 }.
        let mut buffer = Vec::with_capacity(20 + wide.len() * 2);
        buffer.extend_from_slice(&20_u32.to_le_bytes());
        buffer.extend_from_slice(&0_i32.to_le_bytes());
        buffer.extend_from_slice(&0_i32.to_le_bytes());
        buffer.extend_from_slice(&0_i32.to_le_bytes());
        buffer.extend_from_slice(&1_i32.to_le_bytes());
        for unit in wide {
            buffer.extend_from_slice(&unit.to_le_bytes());
        }
        Ok(buffer)
    }

    fn set_global_bytes(handle: *mut c_void, bytes: &[u8]) -> Result<(), String> {
        let locked = unsafe { GlobalLock(handle) };
        if locked.is_null() {
            return Err("Failed to lock clipboard memory".to_string());
        }
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), locked as *mut u8, bytes.len());
            GlobalUnlock(handle);
        }
        Ok(())
    }

    pub(super) fn set_clipboard_files(paths: &[String], is_cut: bool) -> Result<(), String> {
        if paths.is_empty() {
            return Err("No files to copy to the clipboard".to_string());
        }
        let buffer = build_hdrop_buffer(paths)?;

        unsafe {
            if OpenClipboard(std::ptr::null_mut()) == 0 {
                return Err("Failed to open clipboard".to_string());
            }
            struct ClipboardGuard;
            impl Drop for ClipboardGuard {
                fn drop(&mut self) {
                    unsafe {
                        CloseClipboard();
                    }
                }
            }
            let _guard = ClipboardGuard;

            if EmptyClipboard() == 0 {
                return Err("Failed to empty clipboard".to_string());
            }

            let hdrop = GlobalAlloc(GMEM_MOVEABLE, buffer.len());
            if hdrop.is_null() {
                return Err("Failed to allocate clipboard memory".to_string());
            }
            if let Err(error) = set_global_bytes(hdrop, &buffer) {
                unsafe {
                    GlobalFree(hdrop);
                }
                return Err(error);
            }
            // On success the system owns the allocation; on failure it is freed above.
            if SetClipboardData(CF_HDROP, hdrop).is_null() {
                unsafe {
                    GlobalFree(hdrop);
                }
                return Err("Failed to set clipboard data".to_string());
            }

            // "Preferred DropEffect" tells Explorer whether a paste moves the files.
            let format_name: Vec<u16> = "Preferred DropEffect\0".encode_utf16().collect();
            let format = RegisterClipboardFormatW(format_name.as_ptr());
            if format != 0 {
                let effect = if is_cut {
                    DROPEFFECT_MOVE
                } else {
                    DROPEFFECT_COPY
                };
                let effect_handle = GlobalAlloc(GMEM_MOVEABLE, 4);
                if !effect_handle.is_null() {
                    let effect_bytes = effect.to_le_bytes();
                    let set_effect =
                        set_global_bytes(effect_handle, &effect_bytes).and_then(|()| {
                            if SetClipboardData(format, effect_handle).is_null() {
                                Err("Failed to set Preferred DropEffect".to_string())
                            } else {
                                Ok(())
                            }
                        });
                    if set_effect.is_err() {
                        unsafe {
                            GlobalFree(effect_handle);
                        }
                    }
                }
            }

            Ok(())
        }
    }

    #[cfg(test)]
    mod tests {
        use super::build_hdrop_buffer;

        #[test]
        fn hdrop_buffer_has_dropfiles_header_and_terminators() {
            let buffer =
                build_hdrop_buffer(&["C:/tmp/a.txt".to_string(), "C:/tmp/b.bin".to_string()])
                    .expect("build hdrop buffer");

            let p_files = u32::from_le_bytes(buffer[0..4].try_into().expect("pFiles"));
            assert_eq!(p_files, 20);
            assert_eq!(
                i32::from_le_bytes(buffer[4..8].try_into().expect("pt.x")),
                0
            );
            assert_eq!(
                i32::from_le_bytes(buffer[8..12].try_into().expect("pt.y")),
                0
            );
            assert_eq!(
                i32::from_le_bytes(buffer[12..16].try_into().expect("fNC")),
                0
            );
            // fWide: the path list is UTF-16.
            assert_eq!(
                i32::from_le_bytes(buffer[16..20].try_into().expect("fWide")),
                1
            );

            let wide: Vec<u16> = buffer[20..]
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            let text = String::from_utf16_lossy(&wide);
            assert_eq!(text, "C:/tmp/a.txt\0C:/tmp/b.bin\0\0");
        }

        #[test]
        fn hdrop_buffer_rejects_interior_nul_paths() {
            let result = build_hdrop_buffer(&["bad\0path".to_string()]);
            assert!(result.is_err());
        }
    }
}

/// macOS writes an AppleScript file list; a single file keeps full Finder
/// fidelity, multiple files are a best-effort alias list.
#[cfg(target_os = "macos")]
mod macos_clipboard_write {
    use std::process::Command;

    pub(super) fn set_clipboard_files(paths: &[String], _is_cut: bool) -> Result<(), String> {
        if paths.is_empty() {
            return Err("No files to copy to the clipboard".to_string());
        }
        let mut script = String::from("set theFileList to {}\n");
        for path in paths {
            let escaped = path.replace('\\', "\\\\").replace('"', "\\\"");
            script.push_str(&format!(
                "set end of theFileList to POSIX file \"{escaped}\"\n"
            ));
        }
        script.push_str("set the clipboard to theFileList\n");

        let output = Command::new("osascript")
            .args(["-e", &script])
            .output()
            .map_err(|e| format!("Failed to execute osascript: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "osascript failed: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }
}

/// Linux writes a text/uri-list through xclip or wl-copy.
#[cfg(all(target_os = "linux", not(target_env = "ohos")))]
mod linux_clipboard_write {
    use std::io::Write;
    use std::process::{Command, Stdio};

    fn uri_list(paths: &[String]) -> String {
        paths
            .iter()
            .map(|path| format!("file://{}", urlencoding::encode(path)))
            .collect::<Vec<String>>()
            .join("\r\n")
    }

    fn write_through(command: &mut Command, content: &str) -> bool {
        let mut child = match command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => child,
            Err(_) => return false,
        };
        if let Some(stdin) = child.stdin.as_mut() {
            if stdin.write_all(content.as_bytes()).is_err() {
                return false;
            }
        }
        child.wait().map(|status| status.success()).unwrap_or(false)
    }

    pub(super) fn set_clipboard_files(paths: &[String], _is_cut: bool) -> Result<(), String> {
        if paths.is_empty() {
            return Err("No files to copy to the clipboard".to_string());
        }
        let content = uri_list(paths);
        if write_through(
            &mut Command::new("xclip").args([
                "-selection",
                "clipboard",
                "-t",
                "text/uri-list",
                "-i",
            ]),
            &content,
        ) {
            return Ok(());
        }
        if write_through(
            &mut Command::new("wl-copy").arg("--type").arg("text/uri-list"),
            &content,
        ) {
            return Ok(());
        }
        Err("Neither xclip nor wl-copy is available".to_string())
    }
}

/// OHOS writes the selection through the ArkTS pasteboard bridge.
#[cfg(target_env = "ohos")]
mod ohos_clipboard_write {
    pub(super) async fn set_clipboard_files(paths: &[String], _is_cut: bool) -> Result<(), String> {
        bitfun_core::util::write_clipboard_files(paths).await
    }
}

#[cfg(not(target_env = "ohos"))]
fn copy_files_to_clipboard_internal(paths: &[String], is_cut: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_clipboard_write::set_clipboard_files(paths, is_cut)
    }

    #[cfg(target_os = "macos")]
    {
        macos_clipboard_write::set_clipboard_files(paths, is_cut)
    }

    #[cfg(all(target_os = "linux", not(target_env = "ohos")))]
    {
        linux_clipboard_write::set_clipboard_files(paths, is_cut)
    }

    #[cfg(not(any(
        target_os = "windows",
        target_os = "macos",
        all(target_os = "linux", not(target_env = "ohos"))
    )))]
    {
        let _ = (paths, is_cut);
        Err("Writing clipboard files is not supported on this platform".to_string())
    }
}

async fn copy_files_to_clipboard_for_platform(
    paths: &[String],
    is_cut: bool,
) -> Result<(), String> {
    #[cfg(target_env = "ohos")]
    {
        ohos_clipboard_write::set_clipboard_files(paths, is_cut).await
    }

    #[cfg(not(target_env = "ohos"))]
    {
        copy_files_to_clipboard_internal(paths, is_cut)
    }
}

#[tauri::command]
pub async fn copy_files_to_clipboard(request: CopyFilesToClipboardRequest) -> Result<(), String> {
    copy_files_to_clipboard_for_platform(&request.source_paths, request.is_cut).await
}

/// Pastes clipboard files between controller-local paths.
///
/// The remote file provider exposes no copy primitive, so a remote workspace path is refused here
/// instead of being served by a controller-side copy that would silently target the wrong machine.
#[tauri::command]
pub async fn paste_files(request: PasteFilesRequest) -> Result<PasteFilesResponse, String> {
    if let Some(remote_path) = first_remote_path(
        std::iter::once(request.target_directory.as_str())
            .chain(request.source_paths.iter().map(String::as_str)),
    )
    .await
    {
        return Err(format!(
            "paste_files cannot copy remote workspace path '{}': the remote file provider has no copy primitive; local filesystem fallback was not attempted",
            remote_path
        ));
    }

    let target_dir = Path::new(&request.target_directory);

    if !target_dir.exists() {
        return Err(format!(
            "Target directory does not exist: {}",
            request.target_directory
        ));
    }

    if !target_dir.is_dir() {
        return Err(format!(
            "Target path is not a directory: {}",
            request.target_directory
        ));
    }

    let mut success_count = 0;
    let mut directory_count = 0;
    let mut failed_files = Vec::new();

    for source_path in &request.source_paths {
        let source = Path::new(source_path);

        if !source.exists() {
            failed_files.push(FailedFile {
                path: source_path.clone(),
                error: "Source file does not exist".to_string(),
            });
            continue;
        }

        let file_name = match source.file_name() {
            Some(name) => name,
            None => {
                failed_files.push(FailedFile {
                    path: source_path.clone(),
                    error: "Failed to get file name".to_string(),
                });
                continue;
            }
        };

        let target_path = target_dir.join(file_name);

        let final_target = if target_path.exists() {
            generate_unique_path(&target_path)
        } else {
            target_path
        };

        let is_dir = source.is_dir();
        let result = if is_dir {
            copy_directory_recursive(source, &final_target)
        } else {
            std::fs::copy(source, &final_target)
                .map(|_| ())
                .map_err(|e| e.to_string())
        };

        match result {
            Ok(_) => {
                success_count += 1;
                if is_dir {
                    directory_count += 1;
                }

                if request.is_cut {
                    if is_dir {
                        if let Err(e) = std::fs::remove_dir_all(source) {
                            log::warn!("Failed to remove source directory after cut: {}", e);
                        }
                    } else if let Err(e) = std::fs::remove_file(source) {
                        log::warn!("Failed to remove source file after cut: {}", e);
                    }
                }
            }
            Err(e) => {
                failed_files.push(FailedFile {
                    path: source_path.clone(),
                    error: e,
                });
            }
        }
    }

    Ok(PasteFilesResponse {
        success_count,
        failed_files,
        directory_count,
    })
}

fn generate_unique_path(path: &Path) -> std::path::PathBuf {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let extension = path.extension().and_then(|s| s.to_str());

    let mut counter = 1;
    loop {
        let new_name = if let Some(ext) = extension {
            format!("{} ({}).{}", stem, counter, ext)
        } else {
            format!("{} ({})", stem, counter)
        };

        let new_path = parent.join(&new_name);
        if !new_path.exists() {
            return new_path;
        }
        counter += 1;
    }
}

pub(crate) fn copy_directory_recursive(source: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|e| format!("Failed to create directory: {}", e))?;

    for entry in
        std::fs::read_dir(source).map_err(|e| format!("Failed to read directory: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());

        if source_path.is_dir() {
            copy_directory_recursive(&source_path, &target_path)?;
        } else {
            std::fs::copy(&source_path, &target_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        copy_directory_recursive, decode_file_uri, generate_unique_path,
        parse_clipboard_path_segments, parse_uri_list, ClipboardFilesResponse,
    };
    use std::path::Path;

    #[test]
    fn clipboard_files_response_uses_camel_case() {
        let value = serde_json::to_value(ClipboardFilesResponse {
            files: vec!["C:/example.txt".to_string()],
            is_cut: true,
            errors: vec!["file://docs/dir: denied".to_string()],
        })
        .expect("serialize clipboard response");

        assert_eq!(value["isCut"], true);
        assert_eq!(value["errors"], serde_json::json!(["file://docs/dir: denied"]));
        assert!(value.get("is_cut").is_none());
    }

    #[test]
    fn clipboard_files_response_omits_empty_errors() {
        let value = serde_json::to_value(ClipboardFilesResponse {
            files: vec!["C:/example.txt".to_string()],
            is_cut: false,
            errors: Vec::new(),
        })
        .expect("serialize clipboard response");

        assert!(value.get("errors").is_none());
    }

    #[test]
    fn decode_unix_file_uri() {
        assert_eq!(
            decode_file_uri("file:///tmp/example.txt").as_deref(),
            Some("/tmp/example.txt")
        );
    }

    #[test]
    fn decode_localhost_file_uri() {
        assert_eq!(
            decode_file_uri("file://localhost/home/user/example.txt").as_deref(),
            Some("/home/user/example.txt")
        );
    }

    #[test]
    fn decode_windows_file_uri() {
        assert_eq!(
            decode_file_uri("file:///C:/Users/dev/example.txt").as_deref(),
            Some("C:/Users/dev/example.txt")
        );
    }

    #[test]
    fn decode_windows_file_uri_lowercases_drive_letter() {
        assert_eq!(
            decode_file_uri("file:///c:/Users/dev/example.txt").as_deref(),
            Some("C:/Users/dev/example.txt")
        );
    }

    #[test]
    fn parse_clipboard_path_segments_handles_posix_paths() {
        assert_eq!(
            parse_clipboard_path_segments("/tmp/a.txt\n/tmp/b.txt"),
            vec!["/tmp/a.txt".to_string(), "/tmp/b.txt".to_string()]
        );
    }

    #[test]
    fn parse_clipboard_path_segments_handles_comma_separated_paths() {
        assert_eq!(
            parse_clipboard_path_segments("/tmp/a.txt,/tmp/b.txt"),
            vec!["/tmp/a.txt".to_string(), "/tmp/b.txt".to_string()]
        );
    }

    #[test]
    fn parse_clipboard_path_segments_decodes_file_uris() {
        assert_eq!(
            parse_clipboard_path_segments("file:///tmp/a.txt\r\nfile:///tmp/b.txt"),
            vec!["/tmp/a.txt".to_string(), "/tmp/b.txt".to_string()]
        );
    }

    #[test]
    fn generate_unique_path_uses_current_dir_when_parent_missing() {
        let unique = generate_unique_path(Path::new("example.txt"));
        assert_eq!(
            unique.file_name(),
            Some(std::ffi::OsStr::new("example (1).txt"))
        );
    }

    #[test]
    fn parse_uri_list_ignores_comments_and_blank_lines() {
        let files =
            parse_uri_list("# comment\n\nfile:///tmp/a.txt\r\nfile://localhost/tmp/b.txt\n");
        assert_eq!(
            files,
            vec!["/tmp/a.txt".to_string(), "/tmp/b.txt".to_string()]
        );
    }

    #[test]
    fn copy_directory_recursive_copies_nested_binary_files() {
        let root = std::env::temp_dir().join(format!(
            "bitfun-directory-copy-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source = root.join("source");
        let target = root.join("target");
        std::fs::create_dir_all(source.join("nested")).expect("create source directory");
        std::fs::write(source.join("root.bin"), [0_u8, 255, 128]).expect("write root file");
        std::fs::write(source.join("nested").join("child.txt"), b"child")
            .expect("write nested file");

        copy_directory_recursive(&source, &target).expect("copy directory recursively");

        assert_eq!(
            std::fs::read(target.join("root.bin")).expect("read copied root file"),
            [0_u8, 255, 128]
        );
        assert_eq!(
            std::fs::read(target.join("nested").join("child.txt"))
                .expect("read copied nested file"),
            b"child"
        );

        std::fs::remove_dir_all(root).expect("remove test directory");
    }
}

#[cfg(test)]
mod remote_guard_tests {
    use super::{paste_files, PasteFilesRequest};
    use bitfun_core::service::remote_ssh::workspace_state::init_remote_workspace_manager;

    const REMOTE_ROOT: &str = "/remote-audit-paste";
    const CONNECTION_ID: &str = "remote-audit-paste-connection";

    #[tokio::test]
    async fn paste_files_refuses_remote_target_and_leaves_controller_untouched() {
        init_remote_workspace_manager()
            .register_remote_workspace(
                REMOTE_ROOT.to_string(),
                CONNECTION_ID.to_string(),
                "remote-audit-paste".to_string(),
                "remote-audit-paste.invalid".to_string(),
            )
            .await;

        let source = std::env::temp_dir().join("bitfun-remote-audit-paste-source.txt");
        std::fs::write(&source, b"local bytes").expect("write controller source");
        let sentinel = std::env::temp_dir().join("bitfun-remote-audit-paste-source.txt.copy");
        let _ = std::fs::remove_file(&sentinel);

        let error = paste_files(PasteFilesRequest {
            source_paths: vec![source.to_string_lossy().to_string()],
            target_directory: format!("{REMOTE_ROOT}/src"),
            is_cut: true,
        })
        .await
        .expect_err("remote paste target must be refused");

        assert!(error.starts_with("paste_files cannot copy remote workspace path"));
        assert!(error.contains("local filesystem fallback was not attempted"));
        assert!(
            source.exists(),
            "a refused cut must not delete the controller source"
        );
        assert!(!sentinel.exists());

        let _ = std::fs::remove_file(&source);
        init_remote_workspace_manager()
            .unregister_remote_workspace(CONNECTION_ID, REMOTE_ROOT)
            .await;
    }
}
