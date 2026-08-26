#[cfg(target_env = "ohos")]
use async_trait::async_trait;
use bitfun_core::util::JS_THREADSAFE_FUNCTION;
#[cfg(target_env = "ohos")]
use bitfun_services_integrations::browser_control::{
    HaitaiBrowserLaunchPort, HaitaiBrowserLaunchRequest,
};
use log::{error, info};
#[cfg(target_env = "ohos")]
use serde_json::json;

#[cfg(target_env = "ohos")]
#[derive(Debug, Default)]
pub struct HaitaiBrowserLaunchHost;

#[cfg(target_env = "ohos")]
#[async_trait]
impl HaitaiBrowserLaunchPort for HaitaiBrowserLaunchHost {
    async fn launch_haitai(&self, request: HaitaiBrowserLaunchRequest) -> Result<(), String> {
        let function = {
            let lock = JS_THREADSAFE_FUNCTION.read();
            lock.get("launch_haitai_browser_cdp").cloned()
        };
        let Some(function) = function else {
            return Err("The ArkTS Haitai CDP launch function is not registered".to_owned());
        };
        let payload = json!({
            "port": request.port,
            "initialUrl": request.initial_url,
        })
        .to_string();
        let response = function
            .call_async(Ok(payload))
            .await
            .map_err(|error| error.to_string())?
            .await
            .map_err(|error| error.to_string())?;
        let value: serde_json::Value = serde_json::from_str(&response)
            .map_err(|error| format!("invalid ArkTS Haitai launch response: {error}"))?;
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
