//! Unified abstraction over a platform's screen-capture capability.
//!
//! This is the shared seam that BitFun surfaces use to grab raw pixels of a
//! screen region or of the application's own main window. The concrete
//! backend is injected by the desktop host: a `screenshots`-crate backend on
//! macOS/Windows/Linux, and an ArkTS-bridged backend on HarmonyOS (where the
//! `screenshots` crate does not build). Consumers reach the active backend
//! through [`current_capture`].
//!
//! # Failure semantics
//!
//! A missing backend (none injected) surfaces an explicit `Err` from
//! [`UnavailableCapture`] so callers degrade loudly instead of silently
//! returning empty data. Transient platform unavailability (denied screen
//! recording permission, no foreground window) must also surface as `Err` so
//! callers can retry or report — silent local fallback would leak a remote
//! controller's expectation of a real capture.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock, RwLock};

/// Geometry of a single physical display, in global screen coordinates.
///
/// `x`/`y` are the display's origin in the global desktop coordinate space;
/// `width`/`height` are the display size in logical pixels. The
/// `screenshots`-crate backend populates this from
/// `screenshots::display_info::DisplayInfo`; the OHOS ArkTS backend
/// populates it from `@ohos.display`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayInfo {
    pub id: u32,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f32,
}

/// A captured image as raw RGBA8 pixels.
///
/// Callers own any downstream encoding (JPEG/PNG), resizing, and disk
/// persistence. The bytes are the visible pixel content only; no pointers,
/// overlays, or metadata are attached by the backend.
#[derive(Debug, Clone)]
pub struct CapturedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Unified screen-capture capability.
///
/// Implementations must be `Send + Sync` and serialize concurrent access
/// internally because multiple consumers within the same process may share
/// one backend instance.
#[async_trait]
pub trait ScreenCapture: std::fmt::Debug + Send + Sync {
    /// Enumerates the active displays in global screen coordinates.
    async fn list_displays(&self) -> Result<Vec<DisplayInfo>, String>;

    /// Captures a screen region at **global** coordinates `(x, y)` with the
    /// given pixel size. The backend resolves which display contains the
    /// region and maps global coordinates to that display's local space.
    ///
    /// Returns `Err` when the platform capture capability is unavailable
    /// (permission denied, no display, capture API failure) so callers can
    /// distinguish a failed capture from an empty one.
    async fn capture_region(
        &self,
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    ) -> Result<CapturedImage, String>;

    /// Captures this application's own main window.
    ///
    /// Used by callers that cannot resolve the window geometry from Rust
    /// (notably the OHOS desktop, where the Tauri `WebviewWindow` API does
    /// not expose reliable geometry and the ArkTS side resolves the window).
    /// Backends that always receive an explicit rect may return `Err`.
    async fn capture_application_window(&self) -> Result<CapturedImage, String>;
}

/// Process-wide injection seam for a custom screen-capture backend. The
/// desktop host sets this at startup (the `screenshots`-crate backend on
/// macOS/Windows/Linux, the ArkTS-backed backend on HarmonyOS). When unset,
/// [`current_capture`] returns an [`UnavailableCapture`] that surfaces an
/// explicit unavailable error.
fn capture_override() -> &'static RwLock<Option<Arc<dyn ScreenCapture>>> {
    static OVERRIDE: OnceLock<RwLock<Option<Arc<dyn ScreenCapture>>>> = OnceLock::new();
    OVERRIDE.get_or_init(|| RwLock::new(None))
}

/// Inject a custom screen-capture backend.
///
/// Called by the desktop host at startup. On macOS, Windows, and Linux it
/// injects the `screenshots`-crate backend; on HarmonyOS it injects the
/// ArkTS-backed backend.
pub fn set_screen_capture(capture: Arc<dyn ScreenCapture>) {
    if let Ok(mut guard) = capture_override().write() {
        *guard = Some(capture);
    }
}

/// Returns the screen-capture backend to use for the current call. When a
/// backend was injected via [`set_screen_capture`], returns it; otherwise
/// returns [`UnavailableCapture`] so callers degrade loudly instead of
/// silently returning empty data.
pub fn current_capture() -> Arc<dyn ScreenCapture> {
    if let Some(capture) = capture_override()
        .read()
        .ok()
        .and_then(|guard| guard.clone())
    {
        return capture;
    }
    Arc::new(UnavailableCapture)
}

/// Fallback backend for builds without an injected backend. Every call
/// surfaces an explicit unavailable error so callers know capture is not
/// configured instead of silently returning empty data. The desktop host is
/// expected to inject a real backend before any capture operation runs.
#[derive(Debug)]
struct UnavailableCapture;

#[async_trait]
impl ScreenCapture for UnavailableCapture {
    async fn list_displays(&self) -> Result<Vec<DisplayInfo>, String> {
        Err("screen capture unavailable: no backend injected".to_string())
    }
    async fn capture_region(
        &self,
        _x: i32,
        _y: i32,
        _width: u32,
        _height: u32,
    ) -> Result<CapturedImage, String> {
        Err("screen capture unavailable: no backend injected".to_string())
    }
    async fn capture_application_window(&self) -> Result<CapturedImage, String> {
        Err("screen capture unavailable: no backend injected".to_string())
    }
}
