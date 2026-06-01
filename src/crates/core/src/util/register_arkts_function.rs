use lazy_static::lazy_static;
use napi_derive_ohos::napi;
use napi_ohos::bindgen_prelude::Promise;
use napi_ohos::threadsafe_function::ThreadsafeFunction;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;
use serde::{Deserialize, Serialize};

lazy_static! {
    pub static ref JS_THREADSAFE_FUNCTION: RwLock<HashMap<String, Arc<ThreadsafeFunction<String, Promise<String>>>>> =
        Default::default();
}

#[napi]
pub fn register_arkts_function(
    function_name: String,
    callback: ThreadsafeFunction<String, Promise<String>>,
) {
    JS_THREADSAFE_FUNCTION
        .write()
        .insert(function_name, Arc::new(callback));
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HuaweiAccountAuthResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_info: Option<UserInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserInfo {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

pub async fn check_huawei_account_auth() -> Result<HuaweiAccountAuthResult, String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("check_huawei_account_auth").cloned()
    };

    let Some(function) = function else {
        return Ok(HuaweiAccountAuthResult {
            success: true,
            error_code: None,
            error_message: None,
            user_info: None,
        });
    };

    let res = function.call_async(Ok("".to_string())).await;
    match res {
        Ok(promise) => match promise.await {
            Ok(result) => {
                let auth_result: HuaweiAccountAuthResult = serde_json::from_str(&result)
                    .map_err(|e| format!("Failed to parse auth result: {}", e))?;
                Ok(auth_result)
            }
            Err(err) => Err(err.to_string()),
        },
        Err(err) => Err(err.to_string()),
    }
}

pub async fn open_dialog_file() -> Result<String, String> {
    let function = {
        let lock = JS_THREADSAFE_FUNCTION.read();
        lock.get("open_dialog_file").cloned()
    };

    let Some(function) = function else {
        return Err("open_dialog_file has not register".to_owned());
    };

    let res = function.call_async(Ok("".to_string())).await;
    match res {
        Ok(err) => match err.await {
            Ok(result) => Ok(result),
            Err(err) => Err(err.to_string()),
        },

        Err(err) => Err(err.to_string()),
    }
}

