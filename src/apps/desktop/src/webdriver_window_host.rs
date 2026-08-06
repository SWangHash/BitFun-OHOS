use std::sync::Arc;
#[cfg(not(target_env = "ohos"))]
use std::time::Duration;

use async_trait::async_trait;
use bitfun_webdriver::{WebDriverWindowHost, WindowCapabilities, WindowRect};
use tauri::AppHandle;
#[cfg(not(target_env = "ohos"))]
use tauri::{Manager, PhysicalPosition, PhysicalSize, Position, Size};

pub(crate) fn create(app: AppHandle) -> Arc<dyn WebDriverWindowHost> {
    Arc::new(DesktopWindowHost { app })
}

struct DesktopWindowHost {
    app: AppHandle,
}

impl DesktopWindowHost {
    #[cfg(not(target_env = "ohos"))]
    fn window(&self, label: &str) -> Result<tauri::WebviewWindow, String> {
        self.app
            .get_webview_window(label)
            .ok_or_else(|| format!("Window not found: {label}"))
    }

    #[cfg(target_env = "ohos")]
    async fn call_ohos(
        &self,
        action: &str,
        label: &str,
        rect: Option<WindowRect>,
    ) -> Result<OhosWindowResponse, String> {
        let request = OhosWindowRequest {
            action,
            label,
            rect,
        };
        let input = serde_json::to_string(&request)
            .map_err(|error| format!("Failed to encode HarmonyOS window request: {error}"))?;
        let output =
            bitfun_core::util::call_arkts_string_function("webdriver_window_ohos", input).await?;
        let response: OhosWindowResponse = serde_json::from_str(&output)
            .map_err(|error| format!("Invalid HarmonyOS window response: {error}: {output}"))?;
        if response.ok {
            Ok(response)
        } else {
            Err(response
                .error
                .unwrap_or_else(|| "HarmonyOS window operation failed".to_string()))
        }
    }
}

#[cfg(target_env = "ohos")]
#[derive(serde::Serialize)]
struct OhosWindowRequest<'a> {
    action: &'a str,
    label: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    rect: Option<WindowRect>,
}

#[cfg(target_env = "ohos")]
#[derive(serde::Deserialize)]
struct OhosWindowResponse {
    ok: bool,
    #[serde(default)]
    result: Option<WindowRect>,
    #[serde(default)]
    handles: Option<Vec<String>>,
    #[serde(default)]
    error: Option<String>,
}

#[async_trait]
impl WebDriverWindowHost for DesktopWindowHost {
    fn window_handles(&self) -> Vec<String> {
        #[cfg(not(target_env = "ohos"))]
        {
            self.app.webview_windows().keys().cloned().collect()
        }
        #[cfg(target_env = "ohos")]
        {
            vec!["main".to_string()]
        }
    }

    fn capabilities(&self) -> WindowCapabilities {
        WindowCapabilities {
            set_window_rect: true,
        }
    }

    async fn get_rect(&self, label: &str) -> Result<WindowRect, String> {
        #[cfg(not(target_env = "ohos"))]
        {
            let window = self.window(label)?;
            let position = window
                .outer_position()
                .map_err(|error| format!("Failed to read window position: {error}"))?;
            let size = window
                .outer_size()
                .map_err(|error| format!("Failed to read window size: {error}"))?;
            Ok(WindowRect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            })
        }
        #[cfg(target_env = "ohos")]
        {
            self.call_ohos("getRect", label, None)
                .await?
                .result
                .ok_or_else(|| "HarmonyOS getRect response is missing result".to_string())
        }
    }

    async fn set_rect(&self, label: &str, rect: WindowRect) -> Result<WindowRect, String> {
        #[cfg(not(target_env = "ohos"))]
        {
            let window = self.window(label)?;
            if window.is_fullscreen().unwrap_or(false) {
                window
                    .set_fullscreen(false)
                    .map_err(|error| format!("Failed to leave fullscreen: {error}"))?;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            if window.is_maximized().unwrap_or(false) {
                window
                    .unmaximize()
                    .map_err(|error| format!("Failed to restore window: {error}"))?;
                tokio::time::sleep(Duration::from_millis(50)).await;
            }

            window
                .set_position(Position::Physical(PhysicalPosition::new(rect.x, rect.y)))
                .map_err(|error| format!("Failed to set window position: {error}"))?;

            let (chrome_width, chrome_height) =
                if let (Ok(outer), Ok(inner)) = (window.outer_size(), window.inner_size()) {
                    (
                        outer.width.saturating_sub(inner.width),
                        outer.height.saturating_sub(inner.height),
                    )
                } else {
                    (0, 0)
                };
            window
                .set_size(Size::Physical(PhysicalSize::new(
                    rect.width.saturating_sub(chrome_width),
                    rect.height.saturating_sub(chrome_height),
                )))
                .map_err(|error| format!("Failed to set window size: {error}"))?;
            self.get_rect(label).await
        }
        #[cfg(target_env = "ohos")]
        {
            self.call_ohos("setRect", label, Some(rect))
                .await?
                .result
                .ok_or_else(|| "HarmonyOS setRect response is missing result".to_string())
        }
    }

    async fn maximize(&self, label: &str) -> Result<WindowRect, String> {
        #[cfg(not(target_env = "ohos"))]
        {
            self.window(label)?
                .maximize()
                .map_err(|error| format!("Failed to maximize window: {error}"))?;
            tokio::time::sleep(Duration::from_millis(100)).await;
            self.get_rect(label).await
        }
        #[cfg(target_env = "ohos")]
        {
            self.call_ohos("maximize", label, None)
                .await?
                .result
                .ok_or_else(|| "HarmonyOS maximize response is missing result".to_string())
        }
    }

    async fn minimize(&self, label: &str) -> Result<(), String> {
        #[cfg(not(target_env = "ohos"))]
        {
            self.window(label)?
                .minimize()
                .map_err(|error| format!("Failed to minimize window: {error}"))
        }
        #[cfg(target_env = "ohos")]
        {
            self.call_ohos("minimize", label, None).await?;
            Ok(())
        }
    }

    async fn fullscreen(&self, label: &str) -> Result<WindowRect, String> {
        #[cfg(not(target_env = "ohos"))]
        {
            self.window(label)?
                .set_fullscreen(true)
                .map_err(|error| format!("Failed to fullscreen window: {error}"))?;
            tokio::time::sleep(Duration::from_millis(100)).await;
            self.get_rect(label).await
        }
        #[cfg(target_env = "ohos")]
        {
            self.call_ohos("fullscreen", label, None)
                .await?
                .result
                .ok_or_else(|| "HarmonyOS fullscreen response is missing result".to_string())
        }
    }

    async fn close(&self, label: &str) -> Result<Vec<String>, String> {
        #[cfg(not(target_env = "ohos"))]
        {
            self.window(label)?
                .destroy()
                .map_err(|error| format!("Failed to close window: {error}"))?;
            Ok(self
                .window_handles()
                .into_iter()
                .filter(|handle| handle != label)
                .collect())
        }
        #[cfg(target_env = "ohos")]
        {
            Ok(self
                .call_ohos("close", label, None)
                .await?
                .handles
                .unwrap_or_default())
        }
    }
}
