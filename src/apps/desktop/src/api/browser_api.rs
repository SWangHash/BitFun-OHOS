//! Browser API — commands for the embedded browser feature.
//!
//! Browser webviews are created on the Rust side so that we can attach an
//! `on_page_load` handler that safely catches panics from the upstream wry
//! `url_from_webview` bug (WKWebView.URL() returning nil).
//! See: <https://github.com/tauri-apps/wry/pull/1554>

use serde::Deserialize;
use tauri::Manager;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewEvalRequest {
    pub label: String,
    pub script: String,
}

#[tauri::command]
pub async fn browser_webview_eval(
    app: tauri::AppHandle,
    request: WebviewEvalRequest,
) -> Result<(), String> {
    #[cfg(not(target_env = "ohos"))]
    {
        let webview = app
            .get_webview(&request.label)
            .ok_or_else(|| format!("Webview not found: {}", request.label))?;

        webview
            .eval(&request.script)
            .map_err(|e| format!("eval failed: {e}"))
    }
    #[cfg(target_env = "ohos")]
    {
        use bitfun_core::util::JS_THREADSAFE_FUNCTION;
        use napi_ohos::threadsafe_function::ThreadsafeFunctionCallMode;
        use serde_json;

        let _ = app;
        let function = {
            let lock = JS_THREADSAFE_FUNCTION.read();
            lock.get("browser_webview_eval").cloned()
        };
        let Some(function) = function else {
            return Err("The Arkts has not register the function browser_webview_eval".to_owned());
        };
        let payload = serde_json::to_string(&request)
            .map_err(|e| format!("Failed to serialize request: {e}"))?;
        function.call(Ok(payload), ThreadsafeFunctionCallMode::NonBlocking);
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewLabelRequest {
    pub label: String,
}

/// Return the current URL of a browser webview.
///
/// Uses `catch_unwind` to guard against a known wry bug where
/// `WKWebView::URL()` returns nil (e.g. after navigating to an invalid
/// address), causing an `unwrap()` panic inside `url_from_webview`.
#[tauri::command]
pub async fn browser_get_url(
    app: tauri::AppHandle,
    request: WebviewLabelRequest,
) -> Result<String, String> {
    #[cfg(not(target_env = "ohos"))]
    {
        let webview = app
            .get_webview(&request.label)
            .ok_or_else(|| format!("Webview not found: {}", request.label))?;

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| webview.url()));

        match result {
            Ok(Ok(url)) => Ok(url.to_string()),
            Ok(Err(e)) => Err(format!("url failed: {e}")),
            Err(_) => Err("url unavailable (webview URL is nil)".to_string()),
        }
    }
    #[cfg(target_env = "ohos")]
    {
        use bitfun_core::util::JS_THREADSAFE_FUNCTION;

        let _ = app;
        let function = {
            let lock = JS_THREADSAFE_FUNCTION.read();
            lock.get("browser_get_url").cloned()
        };
        let Some(function) = function else {
            return Err("The Arkts has not register the function browser_get_url".to_owned());
        };
        let res = function.call_async(Ok(request.label)).await;
        match res {
            Ok(promise) => match promise.await {
                Ok(url) => Ok(url),
                Err(err) => Err(err.to_string()),
            },
            Err(err) => Err(err.to_string()),
        }
    }
}
