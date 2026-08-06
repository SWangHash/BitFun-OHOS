use serde::{Deserialize, Serialize};

use async_trait::async_trait;

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ElementScreenshotMetadata {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(rename = "devicePixelRatio", default = "default_dpr")]
    pub device_pixel_ratio: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PrintOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scale: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "pageWidth")]
    pub page_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "pageHeight")]
    pub page_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "marginTop")]
    pub margin_top: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "marginBottom")]
    pub margin_bottom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "marginLeft")]
    pub margin_left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "marginRight")]
    pub margin_right: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "shrinkToFit")]
    pub shrink_to_fit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "pageRanges")]
    pub page_ranges: Option<Vec<String>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WindowRect {
    #[serde(default)]
    pub x: i32,
    #[serde(default)]
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct WindowCapabilities {
    pub set_window_rect: bool,
}

/// Host-owned application-window operations used by the WebDriver protocol.
///
/// Page JavaScript/navigation remains on the WebView bridge. Keeping native
/// application-window operations behind this port lets Tauri and HarmonyOS
/// WindowStage provide equivalent protocol behavior without leaking either
/// host API into the WebDriver adapter.
#[async_trait]
pub trait WebDriverWindowHost: Send + Sync {
    fn window_handles(&self) -> Vec<String>;

    fn capabilities(&self) -> WindowCapabilities;

    async fn get_rect(&self, label: &str) -> Result<WindowRect, String>;

    async fn set_rect(&self, label: &str, rect: WindowRect) -> Result<WindowRect, String>;

    async fn maximize(&self, label: &str) -> Result<WindowRect, String>;

    async fn minimize(&self, label: &str) -> Result<(), String>;

    async fn fullscreen(&self, label: &str) -> Result<WindowRect, String>;

    async fn close(&self, label: &str) -> Result<Vec<String>, String>;
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Cookie {
    pub name: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(default)]
    pub secure: bool,
    #[serde(default, rename = "httpOnly")]
    pub http_only: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expiry: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "sameSite")]
    pub same_site: Option<String>,
}

fn default_dpr() -> f64 {
    1.0
}
