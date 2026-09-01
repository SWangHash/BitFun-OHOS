use bitfun_core::util::{open_dialog_file, JS_THREADSAFE_FUNCTION};
use napi_ohos::threadsafe_function::ThreadsafeFunctionCallMode;

/// Open the HarmonyOS file/folder picker.
///
/// `options` is a JSON string with the shape of `OpenDialogOptions` from
/// `@tauri-apps/plugin-dialog` (a subset): `{ multiple?, directory?, filters? }`.
/// When `None` (frontend did not send the arg), falls back to empty options,
/// i.e. single-select MIXED mode — the legacy behavior. Returns a single string
/// (bare path, `"null"` on cancel, or a JSON array string when multi-select)
/// so the Tauri command signature stays `Result<String, String>`.
#[tauri::command]
pub async fn open_oh_file_dialog(options: Option<String>) -> Result<String, String> {
    let opts = options.as_deref().unwrap_or("");
    open_dialog_file(opts).await
}

/// Tell the HarmonyOS shell which color mode the webview should adopt.
///
/// `mode` is one of `"light"`, `"dark"`, or `"system"`:
/// - `light`/`dark` — pin the app to that appearance; the ArkTS side returns `""`.
/// - `system` — release the override (`COLOR_MODE_NOT_SET`) and the ArkTS side
///   returns the real system color mode (`"light"` or `"dark"`) so the web-ui can
///   resolve a concrete theme without relying on `prefers-color-scheme`, which the
///   OHOS webview does not update live. The web-ui also polls this return value to
///   follow live system theme changes.
#[tauri::command]
pub async fn set_theme_mode(mode: String) -> Result<String, String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("set_theme_mode").cloned()
    };
    let Some(function) = function else {
        return Err("The Arkts has not register the function".to_owned());
    };
    // call_async + promise.await so the ArkTS callback's return value (the system
    // color mode for `system`) reaches the web-ui. Fixed modes return "".
    let promise = function
        .call_async(Ok(mode))
        .await
        .map_err(|e| e.to_string())?;
    let result = promise.await.map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn reveal_in_oh_explorer(path: String) -> Result<(), String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("reveal_in_explorer").cloned()
    };
    let Some(function) = function else {
        return Err("The Arkts has not register the function".to_owned());
    };
    function.call(Ok(path), ThreadsafeFunctionCallMode::NonBlocking);
    Ok(())
}

/// Save a binary blob to the HarmonyOS Download directory and return the
/// resolved file path so the web-ui can reveal it (parity with the desktop
/// `downloadDir` + `writeFile` save path). The ArkTS side decodes the base64
/// payload and writes it via `fileIo` under the app's
/// `READ_WRITE_DOWNLOAD_DIRECTORY` permission; `reveal_in_explorer` (already
/// registered) opens the file manager at the returned path.
///
/// `arg` is a JSON string `{ "fileName", "dataBase64" }` (the OHOS command
/// convention — single string arg, same as `set_theme_mode`); the ArkTS
/// callback returns the saved file path.
#[tauri::command]
pub async fn save_file_to_downloads_ohos(arg: String) -> Result<String, String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("save_file_to_downloads_ohos").cloned()
    };
    let Some(function) = function else {
        return Err("The Arkts has not register the function".to_owned());
    };
    // call_async + promise.await so the ArkTS callback's return value (the saved
    // file path) reaches the web-ui, mirroring `set_theme_mode`.
    let promise = function
        .call_async(Ok(arg))
        .await
        .map_err(|e| e.to_string())?;
    let result = promise.await.map_err(|e| e.to_string())?;
    Ok(result)
}

/// Send an OS-level notification on HarmonyOS via the Notification Kit. The
/// ArkTS side calls `notificationManager.requestEnableNotification()` (prompts
/// once, idempotent afterwards) then `notificationManager.publish` with a
/// basic-text content. `arg` is a JSON string `{ "title", "body" }`; the
/// ArkTS callback returns "" on success. Mirrors `set_theme_mode` routing.
#[tauri::command]
pub async fn send_system_notification_ohos(arg: String) -> Result<String, String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("send_system_notification_ohos").cloned()
    };
    let Some(function) = function else {
        return Err("The Arkts has not register the function".to_owned());
    };
    let promise = function
        .call_async(Ok(arg))
        .await
        .map_err(|e| e.to_string())?;
    let result = promise.await.map_err(|e| e.to_string())?;
    Ok(result)
}

/// Share a BitFun-generated/exported local file with a nearby HarmonyOS device
/// through the system Share Kit. `arg` is a JSON `FileShareRequest` string —
/// `{ "path": string, "mode": "knock" | "discover", "title"?, "description"? }` —
/// mirroring `save_file_to_downloads_ohos`'s single-string convention.
///
/// The ArkTS callback (registered as `share_file_ohos` in
/// `EntryAbility.onWindowStageCreate`) constructs a `systemShare.SharedData`
/// with the file URI + UTD resolved from the file extension, then either:
/// - `discover` — opens `systemShare.ShareController.show()` and resolves on
///   the panel `dismiss` callback with `{ ok: true, status: "dismissed" }`;
/// - `knock` — arms a pending file consumed by the existing
///   `harmonyShare.on('knockShare', ...)` listener the next time two devices
///   tap, resolving immediately with `{ ok: true, status: "pending_knock" }`.
///
/// Returns a JSON `FileShareResult` envelope on success and an `Err` only when
/// the ArkTS bridge itself is missing (non-OHOS host). Web UI callers gate on
/// the platform capability check before invoking; a missing bridge here is
/// treated as explicit `unsupported` rather than routed through desktop
/// fallback (per `platform-portability-design.md` §4).
#[tauri::command]
pub async fn share_file_ohos(arg: String) -> Result<String, String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("share_file_ohos").cloned()
    };
    let Some(function) = function else {
        return Err("The Arkts has not register the function".to_owned());
    };
    let promise = function
        .call_async(Ok(arg))
        .await
        .map_err(|e| e.to_string())?;
    let result = promise.await.map_err(|e| e.to_string())?;
    Ok(result)
}
