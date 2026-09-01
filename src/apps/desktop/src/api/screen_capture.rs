#![cfg(not(target_env = "ohos"))]

//! Non-OHOS `ScreenCapture` backend backed by the `screenshots` crate.
//!
//! This is the non-OHOS counterpart of
//! `api::ohos::screen_capture::OhosScreenCapture`. It wraps the
//! cross-platform `screenshots` crate (macOS/Windows/Linux) and is only
//! compiled on non-OHOS targets because the `screenshots` crate does not
//! build for the OHOS target (it is excluded via
//! `[target.'cfg(not(target_env = "ohos"))'.dependencies]` in
//! `src/apps/desktop/Cargo.toml`).
//!
//! `capture_region` mirrors the display-resolution + area-capture flow that
//! the MiniApp "截取当前画面" command used to inline: resolve the display
//! containing the region's center via `Screen::from_point`, map the global
//! rect to that display's local space, and `capture_area`.

use async_trait::async_trait;
use bitfun_services_core::screen_capture::{CapturedImage, DisplayInfo, ScreenCapture};

/// `ScreenCapture` backed by the `screenshots` crate.
#[derive(Debug)]
pub struct SystemScreenCapture;

impl SystemScreenCapture {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SystemScreenCapture {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ScreenCapture for SystemScreenCapture {
    async fn list_displays(&self) -> Result<Vec<DisplayInfo>, String> {
        tokio::task::spawn_blocking(|| -> Result<Vec<DisplayInfo>, String> {
            let infos = screenshots::display_info::DisplayInfo::all()
                .map_err(|error| format!("enumerate displays: {error}"))?;
            Ok(infos
                .into_iter()
                .map(|d| DisplayInfo {
                    id: d.id,
                    x: d.x,
                    y: d.y,
                    width: d.width,
                    height: d.height,
                    scale_factor: d.scale_factor,
                })
                .collect())
        })
        .await
        .map_err(|error| format!("join display enumeration task: {error}"))?
    }

    async fn capture_region(
        &self,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    ) -> Result<CapturedImage, String> {
        tokio::task::spawn_blocking(move || -> Result<CapturedImage, String> {
            let center_x = x.saturating_add((width / 2) as i32);
            let center_y = y.saturating_add((height / 2) as i32);
            let screen = screenshots::Screen::from_point(center_x, center_y)
                .map_err(|error| format!("access display for capture region: {error}"))?;
            let relative_x = x.saturating_sub(screen.display_info.x);
            let relative_y = y.saturating_sub(screen.display_info.y);
            let captured = screen
                .capture_area(relative_x, relative_y, width, height)
                .map_err(|error| format!("capture screen region: {error}"))?;
            let (captured_width, captured_height) = captured.dimensions();
            Ok(CapturedImage {
                width: captured_width,
                height: captured_height,
                rgba: captured.into_raw(),
            })
        })
        .await
        .map_err(|error| format!("join screen capture task: {error}"))?
    }

    async fn capture_application_window(&self) -> Result<CapturedImage, String> {
        Err(
            "capture_application_window is not supported by the screenshots backend; pass the window rect to capture_region"
                .to_string(),
        )
    }
}
