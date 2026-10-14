//! OHOS AppGallery detail-page bridge.
//!
//! HarmonyOS resolves the store listing from the running app's own bundle name
//! through the AppGallery Deep Link (`ohos.want.action.appdetail`), so neither a
//! store URL nor an AppGallery APP ID has to be compiled into the frontend, and a
//! product flavor that ships under another bundle name still opens its own
//! listing. The ArkTS side launches the AppGallery application itself with
//! `startAbility`, so the listing opens in AppGallery rather than as an in-app
//! surface; this bridge surfaces the registration and transport failures the
//! Rust side can observe.

use bitfun_core::util::JS_THREADSAFE_FUNCTION;
use log::info;

/// Opens the AppGallery detail page of the running application.
pub async fn open_product_page() -> Result<(), String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("open_app_market_ohos").cloned()
    };
    let Some(function) = function else {
        return Err("The Arkts has not register the function".to_owned());
    };
    let res = function.call_async(Ok(String::new())).await;
    match res {
        Ok(res) => match res.await {
            Ok(response) => {
                let value =
                    serde_json::from_str::<serde_json::Value>(&response).map_err(|error| {
                        format!("invalid response from open_app_market_ohos: {error}")
                    })?;
                if value.get("ok").and_then(|ok| ok.as_bool()) == Some(true) {
                    info!("AppGallery product page requested");
                    Ok(())
                } else {
                    Err(value
                        .get("error")
                        .and_then(|error| error.as_str())
                        .unwrap_or("AppGallery product page could not be opened")
                        .to_string())
                }
            }
            Err(err) => Err(err.to_string()),
        },
        Err(err) => Err(err.to_string()),
    }
}
