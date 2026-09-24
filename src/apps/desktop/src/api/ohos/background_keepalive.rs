//! HarmonyOS background keepalive bridge.
//!
//! HarmonyOS freezes the app process shortly after it is minimized or the
//! screen turns off, which suspends every in-process timer — including the
//! tokio loop behind the cron (scheduled jobs) service — until the app
//! returns to the foreground. The cron start paths call
//! [`ensure_background_keepalive`], which delegates to the ArkTS
//! `background_keepalive_start` function registered in `EntryAbility.ets`
//! to request a `taskKeeping` continuous task through Background Tasks Kit.
//!
//! Desktop and server builds never register that ArkTS function and use the
//! no-op stub below, so call sites stay platform-neutral.

const ARKTS_FUNCTION: &str = "background_keepalive_start";

#[cfg(target_env = "ohos")]
pub async fn ensure_background_keepalive() {
    match bitfun_core::util::call_arkts_string_function(ARKTS_FUNCTION, "{}".to_string()).await {
        Ok(response) => log::info!("HarmonyOS background keepalive response: {response}"),
        Err(error) => log::warn!("Failed to request HarmonyOS background keepalive: {error}"),
    }
}

#[cfg(not(target_env = "ohos"))]
pub async fn ensure_background_keepalive() {}
