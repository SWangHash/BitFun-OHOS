#![cfg(target_env = "ohos")]

//! OHOS `ScreenCapture` backend through an ArkTS bridge.
//!
//! This module is the OHOS counterpart of
//! `api::screen_capture::SystemScreenCapture` (the `screenshots`-crate
//! backend). The Rust side serializes each call as JSON and delegates to the
//! ArkTS `screen_capture` function registered in `EntryAbility.ets`. The
//! ArkTS side owns the HarmonyOS screenshot / display / window APIs, the
//! region crop, and the error-code mapping. Captured pixels are returned
//! base64-encoded RGBA because the JSON wire envelope is UTF-8 only and the
//! pixel buffer is binary.
//!
//! The MiniApp "截取当前画面" feature and (eventually) the Computer Use
//! screenshot subsystem reach this backend through the process-wide
//! `current_capture()` seam injected at startup.

use async_trait::async_trait;
use bitfun_services_core::screen_capture::{CapturedImage, DisplayInfo, ScreenCapture};
use serde::{Deserialize, Serialize};

const ARKTS_FUNCTION: &str = "screen_capture";

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum CaptureAction {
    ListDisplays,
    CaptureRegion,
    CaptureWindow,
}

#[derive(Debug, Serialize)]
struct CaptureRequest {
    action: CaptureAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct CaptureResponse {
    status: String,
    /// Base64-encoded RGBA pixel buffer for `capture_region` / `capture_window`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    height: Option<u32>,
    /// Display list for `list_displays`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    displays: Option<Vec<DisplayInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

/// `ScreenCapture` backed by the HarmonyOS screenshot APIs through an ArkTS
/// bridge registered as `screen_capture`.
///
/// The store is stateless on the Rust side; every call serializes the request
/// as JSON and awaits the ArkTS-side response.
#[derive(Debug)]
pub struct OhosScreenCapture;

impl OhosScreenCapture {
    pub fn new() -> Self {
        Self
    }

    async fn call(&self, request: CaptureRequest) -> Result<CaptureResponse, String> {
        let input = serde_json::to_string(&request)
            .map_err(|error| format!("encode screen capture request: {error}"))?;
        let output = bitfun_core::util::call_arkts_string_function(ARKTS_FUNCTION, input)
            .await
            .map_err(|error| format!("call OpenHarmony screen capture: {error}"))?;
        serde_json::from_str(&output)
            .map_err(|error| format!("decode screen capture response: {error}"))
    }

    fn decode_image_response(
        response: CaptureResponse,
        op: &str,
    ) -> Result<CapturedImage, String> {
        if response.status != "ok" {
            return Err(format!(
                "OpenHarmony screen capture {op} failed: code={}",
                response.code.as_deref().unwrap_or("UNKNOWN")
            ));
        }
        let value = response
            .value
            .ok_or_else(|| format!("screen capture {op} response omitted its value"))?;
        let rgba = decode_pixels(&value)?;
        let width = response
            .width
            .ok_or_else(|| format!("screen capture {op} response omitted width"))?;
        let height = response
            .height
            .ok_or_else(|| format!("screen capture {op} response omitted height"))?;
        // Guard against a truncated pixel buffer so downstream `RgbaImage::from_raw`
        // does not panic on a short slice.
        let expected = (width as usize)
            .checked_mul(height as usize)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| format!("screen capture {op} dimensions overflow"))?;
        if rgba.len() < expected {
            return Err(format!(
                "screen capture {op} pixel buffer is truncated: got {} bytes, expected {expected}",
                rgba.len()
            ));
        }
        Ok(CapturedImage {
            width,
            height,
            rgba,
        })
    }
}

impl Default for OhosScreenCapture {
    fn default() -> Self {
        Self::new()
    }
}

fn decode_pixels(value: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(value)
        .map_err(|error| format!("decode base64 pixels from ArkTS response: {error}"))
}

#[async_trait]
impl ScreenCapture for OhosScreenCapture {
    async fn list_displays(&self) -> Result<Vec<DisplayInfo>, String> {
        let response = self
            .call(CaptureRequest {
                action: CaptureAction::ListDisplays,
                x: None,
                y: None,
                width: None,
                height: None,
            })
            .await?;
        match response.status.as_str() {
            "ok" => response
                .displays
                .ok_or_else(|| "screen capture response omitted displays".to_string()),
            _ => Err(format!(
                "OpenHarmony screen capture list_displays failed: code={}",
                response.code.as_deref().unwrap_or("UNKNOWN")
            )),
        }
    }

    async fn capture_region(
        &self,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    ) -> Result<CapturedImage, String> {
        let response = self
            .call(CaptureRequest {
                action: CaptureAction::CaptureRegion,
                x: Some(x),
                y: Some(y),
                width: Some(width),
                height: Some(height),
            })
            .await?;
        Self::decode_image_response(response, "capture_region")
    }

    async fn capture_application_window(&self) -> Result<CapturedImage, String> {
        let response = self
            .call(CaptureRequest {
                action: CaptureAction::CaptureWindow,
                x: None,
                y: None,
                width: None,
                height: None,
            })
            .await?;
        Self::decode_image_response(response, "capture_window")
    }
}
