//! System tray integration for BitFun Desktop.
//!
//! Creates a system tray icon with a context menu. On Windows and Linux the tray
//! icon is always visible while the process is running; on macOS the icon appears
//! in the macOS menu bar.
//!
//! Left-click  – shows and focuses the main window on macOS; toggles it elsewhere.
//! Right-click – opens a context menu with:
//!   • toggle desktop Agent companion pet (persisted via `app.ai_experience`)
//!   • "Show BitFun"
//!   • "Quit BitFun"
//!
//! The context menu is rebuilt every time the user left-clicks (for freshness),
//! periodically, and after locale changes.

use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use bitfun_core::service::config::app_language::get_app_language;
use bitfun_core::service::config::types::AIExperienceConfig;
use bitfun_core::service::i18n::LocaleId;

use crate::api::app_state::AppState;
use crate::startup_trace::DesktopStartupTrace;

static TRAY_ICON: OnceLock<tauri::tray::TrayIcon> = OnceLock::new();
static TRAY_UNREAD_COUNT: Mutex<u32> = Mutex::new(0);
static TRAY_SETUP_LOCK: Mutex<()> = Mutex::new(());
const TRAY_TRACE_CATEGORY: &str = "native_background";

struct TrayStrings {
    show_app: &'static str,
    quit_app: &'static str,
    desktop_pet: &'static str,
}

const STRINGS_ZH_CN: TrayStrings = TrayStrings {
    show_app: "显示 BitFun",
    quit_app: "退出 BitFun",
    desktop_pet: "显示桌面宠物",
};

const STRINGS_ZH_TW: TrayStrings = TrayStrings {
    show_app: "顯示 BitFun",
    quit_app: "退出 BitFun",
    desktop_pet: "顯示桌面寵物",
};

const STRINGS_EN_US: TrayStrings = TrayStrings {
    show_app: "Show BitFun",
    quit_app: "Quit BitFun",
    desktop_pet: "Show desktop pet",
};

fn tray_strings(locale: &LocaleId) -> &'static TrayStrings {
    match locale {
        LocaleId::ZhCN => &STRINGS_ZH_CN,
        LocaleId::ZhTW => &STRINGS_ZH_TW,
        LocaleId::EnUS => &STRINGS_EN_US,
    }
}

fn desktop_pet_should_show(exp: &AIExperienceConfig) -> bool {
    exp.enable_agent_companion
}

async fn load_ai_experience(app: &AppHandle) -> Option<AIExperienceConfig> {
    let app_state = app.try_state::<AppState>()?;
    app_state
        .config_service
        .get_config(Some("app.ai_experience"))
        .await
        .ok()
}

pub async fn rebuild_tray_menu_public(app: &AppHandle) {
    rebuild_tray_menu(app).await;
}

async fn rebuild_tray_menu(app: &AppHandle) {
    let locale = get_app_language().await;
    let s = tray_strings(&locale);

    let tray = match TRAY_ICON.get() {
        Some(t) => t,
        None => return,
    };

    let pet_checked = load_ai_experience(app)
        .await
        .as_ref()
        .map(desktop_pet_should_show)
        .unwrap_or(false);

    let pet_item = match CheckMenuItemBuilder::with_id("toggle_desktop_pet", s.desktop_pet)
        .checked(pet_checked)
        .build(app)
    {
        Ok(i) => i,
        Err(_) => return,
    };

    let show_item = match MenuItemBuilder::with_id("show_window", s.show_app).build(app) {
        Ok(i) => i,
        Err(_) => return,
    };
    let quit_item = match MenuItemBuilder::with_id("quit", s.quit_app).build(app) {
        Ok(i) => i,
        Err(_) => return,
    };

    let menu = match MenuBuilder::new(app)
        .item(&pet_item)
        .separator()
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()
    {
        Ok(m) => m,
        Err(e) => {
            log::warn!("Failed to build tray menu: {}", e);
            return;
        }
    };

    if let Err(e) = tray.set_menu(Some(menu)) {
        log::warn!("Failed to update tray menu: {}", e);
    }
}

async fn tray_toggle_desktop_pet(app: &AppHandle) -> Result<(), String> {
    let app_state = app
        .try_state::<AppState>()
        .ok_or_else(|| "AppState not available".to_string())?;
    let config_service = &app_state.config_service;

    let show = config_service
        .update_config("app.ai_experience", |exp: &mut AIExperienceConfig| {
            if desktop_pet_should_show(exp) {
                exp.enable_agent_companion = false;
            } else {
                exp.enable_agent_companion = true;
            }
            Ok(desktop_pet_should_show(exp))
        })
        .await
        .map_err(|e| e.to_string())?;

    if show {
        crate::appearance::show_agent_companion_desktop_pet(app.clone()).await?;
    } else {
        crate::appearance::hide_agent_companion_desktop_pet(app.clone()).await?;
    }

    Ok(())
}

/// Build and attach the system tray icon to the Tauri application.
pub fn setup_tray(
    app: &tauri::AppHandle,
    startup_trace: &DesktopStartupTrace,
) -> Result<(), Box<dyn std::error::Error>> {
    if TRAY_ICON.get().is_some() {
        return Ok(());
    }

    let _guard = TRAY_SETUP_LOCK
        .lock()
        .map_err(|_| "Tray setup lock poisoned")?;
    if TRAY_ICON.get().is_some() {
        return Ok(());
    }

    let step_started = Instant::now();
    let pet_item = CheckMenuItemBuilder::with_id("toggle_desktop_pet", STRINGS_EN_US.desktop_pet)
        .checked(false)
        .build(app)?;
    let show_item = MenuItemBuilder::with_id("show_window", STRINGS_EN_US.show_app).build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", STRINGS_EN_US.quit_app).build(app)?;
    startup_trace.record_elapsed_step(TRAY_TRACE_CATEGORY, "setup_tray.menu_items", step_started);

    let step_started = Instant::now();
    let initial_menu = MenuBuilder::new(app)
        .item(&pet_item)
        .separator()
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;
    startup_trace.record_elapsed_step(TRAY_TRACE_CATEGORY, "setup_tray.menu", step_started);

    let step_started = Instant::now();
    #[cfg(target_os = "macos")]
    let icon = macos_tray_icon(false)?;
    #[cfg(not(target_os = "macos"))]
    let icon = app
        .default_window_icon()
        .ok_or("No default window icon")?
        .clone();
    startup_trace.record_elapsed_step(TRAY_TRACE_CATEGORY, "setup_tray.icon", step_started);

    let step_started = Instant::now();
    let tray = TrayIconBuilder::new()
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .menu(&initial_menu)
        .show_menu_on_left_click(false)
        .tooltip("BitFun")
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();
            if id == "show_window" {
                show_main_window(app);
            } else if id == "quit" {
                log::info!("Quit requested from tray menu");
                crate::request_desktop_exit(app, 0, "tray_quit");
            } else if id == "toggle_desktop_pet" {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = tray_toggle_desktop_pet(&app_handle).await {
                        log::warn!("Tray desktop pet toggle failed: {}", e);
                    }
                    rebuild_tray_menu(&app_handle).await;
                });
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle().clone();
                #[cfg(target_os = "macos")]
                show_main_window(&app);
                #[cfg(not(target_os = "macos"))]
                toggle_main_window(&app);
                tauri::async_runtime::spawn(async move {
                    rebuild_tray_menu(&app).await;
                });
            }
        })
        .build(app)?;
    startup_trace.record_elapsed_step(TRAY_TRACE_CATEGORY, "setup_tray.build", step_started);

    let step_started = Instant::now();
    let _ = TRAY_ICON.set(tray);
    let count = TRAY_UNREAD_COUNT
        .lock()
        .map_err(|_| "Tray unread count lock poisoned")?;
    apply_unread_count(*count)?;
    startup_trace.record_elapsed_step(TRAY_TRACE_CATEGORY, "setup_tray.store", step_started);

    let step_started = Instant::now();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        rebuild_tray_menu(&app_handle).await;

        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            rebuild_tray_menu(&app_handle).await;
        }
    });
    startup_trace.record_elapsed_step(
        TRAY_TRACE_CATEGORY,
        "setup_tray.spawn_refresh",
        step_started,
    );

    Ok(())
}

/// Presentation state from the controller's session projection, never a peer mutation.
pub fn set_unread_count(count: u32) -> Result<(), String> {
    let mut current = TRAY_UNREAD_COUNT
        .lock()
        .map_err(|_| "Tray unread count lock poisoned")?;
    *current = count;
    apply_unread_count(count).map_err(|error| error.to_string())
}

/// Reserve space in the image layout instead of inserting whitespace into the title.
/// tray-icon displays macOS images at 18 pt high; four extra points of trailing
/// space bring the native image/title gap to approximately six points.
#[cfg(target_os = "macos")]
fn macos_tray_icon(has_unread: bool) -> Result<tauri::image::Image<'static>, image::ImageError> {
    let mark = image::load_from_memory(include_bytes!(
        "../../../../assets/brand/source/bitfun-app-mark.png"
    ))?
    .into_rgba8();
    // The solid source has a 51 px transparent border on its 512 px canvas.
    // Remove that border symmetrically so the ring retains its proportions and
    // fills the same 18 pt menu bar height as the previous mark. AppKit's
    // template rendering uses alpha, so the source's gray shading stays out.
    let mut mark = image::imageops::crop_imm(&mark, 51, 51, 410, 410).to_image();
    // Add an inset copy to shrink the hole by about 10% without expanding the
    // outer silhouette. This adds roughly 0.7 pt to the thin side walls at the
    // native 18 pt display size, where the unmodified app mark looks too light.
    let inset = image::imageops::resize(&mark, 370, 370, image::imageops::FilterType::Lanczos3);
    image::imageops::overlay(&mut mark, &inset, 20, 20);
    let mark = image::imageops::resize(&mark, 64, 64, image::imageops::FilterType::Lanczos3);
    let (width, height) = mark.dimensions();
    let image = if has_unread {
        let trailing_space = (height * 4 + 9) / 18;
        let mut canvas = image::RgbaImage::new(width + trailing_space, height);
        image::imageops::replace(&mut canvas, &mark, 0, 0);
        canvas
    } else {
        mark
    };
    let (width, height) = image.dimensions();
    Ok(tauri::image::Image::new_owned(
        image.into_raw(),
        width,
        height,
    ))
}

fn apply_unread_count(count: u32) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    if let Some(tray) = TRAY_ICON.get() {
        let title = if count == 0 {
            String::new()
        } else {
            count.to_string()
        };
        let icon =
            macos_tray_icon(count > 0).map_err(|error| tauri::Error::Anyhow(error.into()))?;
        // Replacing an image with set_icon resets its template flag on macOS.
        // Apply both together so startup and count updates retain system tinting.
        tray.set_icon_with_as_template(Some(icon), true)?;
        tray.set_title(Some(title))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = count;
    Ok(())
}

pub fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Restore before showing: Win+D can leave a visible window minimized.
        if let Err(error) = window.unminimize() {
            log::warn!("Failed to unminimize main window via tray: {}", error);
            return;
        }
        if let Err(error) = crate::window_state_support::repair_for_activation(&window) {
            log::warn!("Failed to repair main window geometry via tray: {}", error);
        }
        if let Err(error) = window.show() {
            log::warn!("Failed to show main window via tray: {}", error);
            return;
        }
        if let Err(error) = window.set_focus() {
            log::warn!("Failed to focus main window via tray: {}", error);
        }
        log::info!("Main window shown via tray");
    } else {
        log::warn!("Tray: show_main_window called but main window not found");
    }
}

#[cfg(not(target_os = "macos"))]
fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Minimized windows may still be visible according to the OS. Never
        // hide them here: restore them while their normal placement is intact.
        match window.is_minimized() {
            Ok(true) => {
                show_main_window(app);
                return;
            }
            Ok(false) => {}
            Err(error) => {
                log::warn!(
                    "Failed to query main window minimized state via tray: {}",
                    error
                );
                return;
            }
        }
        let visible = match window.is_visible() {
            Ok(visible) => visible,
            Err(error) => {
                log::warn!("Failed to query main window visibility via tray: {}", error);
                return;
            }
        };
        if visible {
            if let Err(error) = window.hide() {
                log::warn!("Failed to hide main window via tray toggle: {}", error);
                return;
            }
            log::info!("Main window hidden via tray toggle");
        } else {
            show_main_window(app);
        }
    } else {
        log::warn!("Tray toggle requested but main window not found");
    }
}
