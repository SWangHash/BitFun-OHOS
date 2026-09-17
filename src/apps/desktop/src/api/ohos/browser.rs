#[cfg(target_env = "ohos")]
use async_trait::async_trait;
use bitfun_core::util::JS_THREADSAFE_FUNCTION;
#[cfg(target_env = "ohos")]
use bitfun_services_integrations::browser_control::{
    ArkWebBrowserHostPort, HaitaiBrowserLaunchPort, HaitaiBrowserLaunchRequest,
};
use log::{error, info};
#[cfg(target_env = "ohos")]
use serde_json::json;

#[cfg(target_env = "ohos")]
#[derive(Debug, Default)]
pub struct HaitaiBrowserLaunchHost;

#[cfg(target_env = "ohos")]
#[derive(Debug, Default)]
pub struct ArkWebBrowserHost;

#[cfg(target_env = "ohos")]
async fn call_arkts_browser_function(
    name: &str,
    payload: String,
) -> Result<serde_json::Value, String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get(name).cloned()
    };
    let Some(function) = function else {
        return Err(format!(
            "The ArkTS browser function {name} is not registered"
        ));
    };
    let response = function
        .call_async(Ok(payload))
        .await
        .map_err(|error| error.to_string())?
        .await
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&response)
        .map_err(|error| format!("invalid response from ArkTS browser function {name}: {error}"))
}

#[cfg(target_env = "ohos")]
#[async_trait]
impl ArkWebBrowserHostPort for ArkWebBrowserHost {
    async fn create_webview(&self, label: &str, html: &str) -> Result<(), String> {
        let value = call_arkts_browser_function(
            "browser_webview_create_ohos",
            json!({
                "label": label,
                "url": "",
                "html": html,
                // Keep the native surface offscreen until the web UI has
                // measured the browser panel and explicitly adopts it.
                "x": -10000,
                "y": -10000,
                "width": 1280,
                "height": 720,
            })
            .to_string(),
        )
        .await?;
        if value.get("ok").and_then(|value| value.as_bool()) == Some(true) {
            Ok(())
        } else {
            Err(value
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("ArkTS ArkWeb create failed")
                .to_string())
        }
    }

    async fn close_webview(&self, label: &str) -> Result<(), String> {
        let value = call_arkts_browser_function(
            "browser_webview_close_ohos",
            json!({ "label": label }).to_string(),
        )
        .await?;
        if value.get("ok").and_then(|value| value.as_bool()) == Some(true) {
            Ok(())
        } else {
            Err(value
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("ArkTS ArkWeb close failed")
                .to_string())
        }
    }
}

#[cfg(target_env = "ohos")]
#[async_trait]
impl HaitaiBrowserLaunchPort for HaitaiBrowserLaunchHost {
    async fn launch_haitai(&self, request: HaitaiBrowserLaunchRequest) -> Result<(), String> {
        let payload = json!({
            "port": request.port,
            "initialUrl": request.initial_url,
        })
        .to_string();
        let value = call_arkts_browser_function("launch_haitai_browser_cdp", payload).await?;
        if value.get("ok").and_then(|value| value.as_bool()) == Some(true) {
            Ok(())
        } else {
            Err(value
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("ArkTS Haitai CDP launch failed")
                .to_string())
        }
    }
}

#[tauri::command]
pub async fn open_browser(url: String) -> Result<(), String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("open_browser").cloned()
    };
    let Some(function) = function else {
        return Err("The Arkts has not register the function".to_owned());
    };
    let res = function.call_async(Ok(url)).await;
    match res {
        Ok(res) => match res.await {
            Ok(_) => {
                info!("open_browser successfully");
                Ok(())
            }
            Err(err) => {
                error!("open_browser failed: {}", err);
                Err(err.to_string())
            }
        },
        Err(err) => Err(err.to_string()),
    }
}
