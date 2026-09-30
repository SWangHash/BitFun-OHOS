//! Directed macOS input. Private event sources keep modifier state separate
//! from the human keyboard. Delivery acceptance depends on the target app;
//! posting an event is not proof that the intended action took effect.
//! Background dispatch uses target-local AppKit focus, never WindowServer
//! foreground activation or the system cursor.

#![allow(dead_code)]

use core_graphics::event::{CGEvent, CGEventFlags, CGEventType, CGMouseButton, ScrollEventUnit};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;
use foreign_types::ForeignType;
use log::{debug, info, warn};
use bitfun_core::util::errors::{BitFunError, BitFunResult};
use std::ffi::c_void;
use std::thread;
use std::time::{Duration, Instant};

/// Logical mouse button for `bg_click`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BgMouseButton {
    Left,
    Right,
    Middle,
}

impl BgMouseButton {
    fn cg(self) -> CGMouseButton {
        match self {
            Self::Left => CGMouseButton::Left,
            Self::Right => CGMouseButton::Right,
            Self::Middle => CGMouseButton::Center,
        }
    }
    fn down(self) -> CGEventType {
        match self {
            Self::Left => CGEventType::LeftMouseDown,
            Self::Right => CGEventType::RightMouseDown,
            Self::Middle => CGEventType::OtherMouseDown,
        }
    }
    fn up(self) -> CGEventType {
        match self {
            Self::Left => CGEventType::LeftMouseUp,
            Self::Right => CGEventType::RightMouseUp,
            Self::Middle => CGEventType::OtherMouseUp,
        }
    }
}

/// Modifier keys understood by `bg_key_chord` / mouse modifiers.
///
/// Maps to the standard macOS modifier flag bits. We deliberately do not
/// touch `CapsLock` here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BgModifier {
    Command,
    Shift,
    Option, // alias: alt
    Control,
    Fn,
}

impl BgModifier {
    pub(super) fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "cmd" | "command" | "meta" | "super" => Some(Self::Command),
            "shift" => Some(Self::Shift),
            "alt" | "option" | "opt" => Some(Self::Option),
            "ctrl" | "control" => Some(Self::Control),
            "fn" => Some(Self::Fn),
            _ => None,
        }
    }
    fn flag(self) -> CGEventFlags {
        match self {
            Self::Command => CGEventFlags::CGEventFlagCommand,
            Self::Shift => CGEventFlags::CGEventFlagShift,
            Self::Option => CGEventFlags::CGEventFlagAlternate,
            Self::Control => CGEventFlags::CGEventFlagControl,
            Self::Fn => CGEventFlags::CGEventFlagSecondaryFn,
        }
    }
    fn keycode(self) -> u16 {
        match self {
            Self::Command => 55,
            Self::Shift => 56,
            Self::Option => 58,
            Self::Control => 59,
            Self::Fn => 63,
        }
    }
}

/// Whether directed input can be attempted. This checks current permission
/// and event-source availability, never claims target delivery or caches TCC.
pub(super) fn supports_background_input() -> bool {
    accessibility_is_trusted() && CGEventSource::new(CGEventSourceStateID::Private).is_ok()
}

/// Whether the optional SkyLight keyboard backend is available.
/// Availability does not prove delivery to any particular target.
pub(super) fn supports_skylight_post() -> bool {
    super::macos_skylight::is_available()
}

/// Whether the focus-without-raise SPI is available.
/// This private API can change focus and is never used in background mode.
pub(super) fn supports_focus_without_raise() -> bool {
    super::macos_skylight::is_focus_without_raise_available()
}

/// Best-effort check for "host has been granted Accessibility access".
/// We re-implement it locally rather than depending on the
/// `permissions::accessibility` module so this file stays unit-testable
/// outside the broader desktop app.
fn accessibility_is_trusted() -> bool {
    // Re-declared with the same loosely-typed signature used elsewhere in
    // this crate (`desktop_host.rs`) to avoid a clashing-extern warning.
    unsafe extern "C" {
        fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
    }
    // We pass NULL options so we never auto-prompt the user — explicit
    // permission-prompting lives in the existing `permissions` module.
    unsafe { AXIsProcessTrustedWithOptions(std::ptr::null()) }
}

fn private_source(label: &str) -> BitFunResult<CGEventSource> {
    CGEventSource::new(CGEventSourceStateID::Private)
        .map_err(|_| BitFunError::tool(format!("CGEventSource::Private failed ({})", label)))
}

// AppKit's window ordering depends on the event source state. A private mouse
// source raises ordinary windows even with window-addressed routing. Session
// mouse events remain PID-scoped; always set explicit flags to avoid inheriting
// the user's held modifiers. Keyboard events retain their private source.
pub(super) fn mouse_source(label: &str) -> BitFunResult<CGEventSource> {
    CGEventSource::new(CGEventSourceStateID::CombinedSessionState).map_err(|_| {
        BitFunError::tool(format!(
            "CGEventSource::CombinedSessionState failed ({label})"
        ))
    })
}

/// Compose modifier flags for a chord.
fn flags_from(mods: &[BgModifier]) -> CGEventFlags {
    mods.iter()
        .fold(CGEventFlags::CGEventFlagNull, |acc, m| acc | m.flag())
}

#[derive(Clone, Copy, PartialEq)]
enum HeldInput {
    Key(u16, bool),
    Mouse(u8, f64, f64, u32, f64, f64),
}
static HELD_INPUTS: std::sync::Mutex<Vec<(i32, HeldInput)>> = std::sync::Mutex::new(Vec::new());

/// Every gesture releases its own unfinished presses on error or cancellation.
/// Actions hold an exclusive control lease, so no other action can own entries.
struct InputReleaseGuard;
impl Drop for InputReleaseGuard {
    fn drop(&mut self) {
        release_held_inputs();
    }
}

/// Cleanup is allowed after revocation: it only releases events actually posted
/// by this host, using the same directed delivery backend.
pub(super) fn release_held_inputs() {
    let Ok(mut held) = HELD_INPUTS.lock() else {
        return;
    };
    if held.is_empty() {
        return;
    }
    let Ok(source) = private_source("cancel_release") else {
        return;
    };
    for (pid, input) in held.drain(..) {
        let event = match input {
            HeldInput::Key(code, _) => CGEvent::new_keyboard_event(source.clone(), code, false),
            HeldInput::Mouse(button, x, y, _, _, _) => {
                let (kind, button) = match button {
                    0 => (CGEventType::LeftMouseUp, CGMouseButton::Left),
                    1 => (CGEventType::RightMouseUp, CGMouseButton::Right),
                    _ => (CGEventType::OtherMouseUp, CGMouseButton::Center),
                };
                mouse_source("cancel_mouse_release")
                    .map_err(|_| ())
                    .and_then(|source| {
                        CGEvent::new_mouse_event(source, kind, CGPoint::new(x, y), button)
                    })
            }
        };
        if let Ok(event) = event {
            if let HeldInput::Mouse(_, _, _, window, wx, wy) = input {
                let _ = route_mouse_to_window(&event, window, wx, wy);
            }
            event.set_flags(CGEventFlags::CGEventFlagNull);
            let auth = matches!(input, HeldInput::Key(_, true));
            if !auth || !super::macos_skylight::post_to_pid(pid, event.as_ptr().cast(), true) {
                event.post_to_pid(pid);
            }
        }
    }
}

fn route_mouse_to_window(event: &CGEvent, window: u32, wx: f64, wy: f64) -> BitFunResult<()> {
    // CGEventPostToPid selects a process, not a window. AppKit drops mouse
    // events without a window number/local point when the app is inactive.
    for field in [51, 91, 92] {
        event.set_integer_value_field(field, window as i64);
    }
    // Window-addressed delivery must suppress AppKit's normal click ordering.
    // PID + window ID alone delivers the click but still raises its window.
    // This routing flag is not a keyboard modifier; preserve the caller's flags.
    event.set_integer_value_field(58, 1);
    let point = event.location();
    if !super::macos_skylight::set_window_location(
        event.as_ptr().cast(),
        point.x - wx,
        point.y - wy,
    ) {
        return Err(BitFunError::tool("[BACKGROUND_INPUT_UNAVAILABLE] Window-local event routing is unavailable on this macOS host"));
    }
    Ok(())
}

fn post_directed(pid: i32, event: &CGEvent, authenticated: bool) -> BitFunResult<()> {
    let mut held = HELD_INPUTS
        .lock()
        .map_err(|_| BitFunError::tool("Input state lock poisoned"))?;
    super::control_session::input_allowed().map_err(BitFunError::tool)?;
    let window_id = super::macos_capture::bound_window_id(pid).map_err(|_| {
        BitFunError::tool(
            "[CONTROL_TARGET_CHANGED] The captured application window is unavailable",
        )
    })?;
    super::control_session::target_allowed(&format!("pid:{pid}/window:{window_id}"))
        .map_err(BitFunError::tool)?;
    let [wx, wy, width, height] =
        super::macos_capture::window_bounds(pid, window_id).map_err(BitFunError::tool)?;
    if matches!(event.get_type(), CGEventType::ScrollWheel) {
        let point = super::control_session::snapshot()
            .pointer
            .filter(|p| p.x >= wx && p.x < wx + width && p.y >= wy && p.y < wy + height)
            .map(|p| CGPoint::new(p.x, p.y))
            .unwrap_or_else(|| CGPoint::new(wx + width / 2.0, wy + height / 2.0));
        unsafe extern "C" {
            fn CGEventSetLocation(event: *mut c_void, point: CGPoint);
        }
        unsafe {
            CGEventSetLocation(event.as_ptr().cast(), point);
        }
    }
    if !matches!(
        event.get_type(),
        CGEventType::KeyDown | CGEventType::KeyUp | CGEventType::FlagsChanged
    ) {
        route_mouse_to_window(event, window_id, wx, wy)?;
    }
    if !authenticated || !super::macos_skylight::post_to_pid(pid, event.as_ptr().cast(), true) {
        event.post_to_pid(pid);
    }
    super::macos_capture::note_input(pid);
    let point = event.location();
    match event.get_type() {
        CGEventType::KeyDown => {
            let code = event
                .get_integer_value_field(core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE)
                as u16;
            if !held
                .iter()
                .any(|(p, i)| *p == pid && matches!(i, HeldInput::Key(c, _) if *c == code))
            {
                held.push((pid, HeldInput::Key(code, authenticated)));
            }
        }
        CGEventType::KeyUp => {
            let code = event
                .get_integer_value_field(core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE)
                as u16;
            held.retain(|(p, i)| !(*p == pid && matches!(i, HeldInput::Key(c, _) if *c == code)));
        }
        CGEventType::LeftMouseDown | CGEventType::RightMouseDown | CGEventType::OtherMouseDown => {
            let button = match event.get_type() {
                CGEventType::LeftMouseDown => 0,
                CGEventType::RightMouseDown => 1,
                _ => 2,
            };
            held.push((
                pid,
                HeldInput::Mouse(button, point.x, point.y, window_id, wx, wy),
            ));
        }
        CGEventType::LeftMouseDragged
        | CGEventType::RightMouseDragged
        | CGEventType::OtherMouseDragged => {
            let button = match event.get_type() {
                CGEventType::LeftMouseDragged => 0,
                CGEventType::RightMouseDragged => 1,
                _ => 2,
            };
            for (owner, input) in held.iter_mut() {
                if *owner == pid {
                    if let HeldInput::Mouse(held_button, x, y, _, _, _) = input {
                        if *held_button == button {
                            *x = point.x;
                            *y = point.y;
                        }
                    }
                }
            }
        }
        CGEventType::LeftMouseUp | CGEventType::RightMouseUp | CGEventType::OtherMouseUp => {
            let button = match event.get_type() {
                CGEventType::LeftMouseUp => 0,
                CGEventType::RightMouseUp => 1,
                _ => 2,
            };
            held.retain(|(p, i)| {
                !(*p == pid && matches!(i, HeldInput::Mouse(b, _, _, _, _, _) if *b == button))
            });
        }
        _ => {}
    }
    Ok(())
}

// One selected delivery path per event. Never post mouse events twice.
fn post_mouse(pid: i32, event: &CGEvent) -> BitFunResult<()> {
    post_directed(pid, event, false)?;
    let point = event.location();
    let click = matches!(
        event.get_type(),
        CGEventType::LeftMouseDown | CGEventType::RightMouseDown | CGEventType::OtherMouseDown
    );
    if !matches!(event.get_type(), CGEventType::ScrollWheel) {
        super::control_session::record_pointer(point.x, point.y, click);
    }
    Ok(())
}
fn post_keyboard(pid: i32, event: &CGEvent) -> BitFunResult<()> {
    post_directed(pid, event, true)
}
fn post_keyboard_no_auth(pid: i32, event: &CGEvent) -> BitFunResult<()> {
    post_directed(pid, event, false)
}

/// Stamp Chromium routing fields onto a mouse event for better backgrounded-
/// target delivery. Called when a `window_id` is known.
fn stamp_chromium_fields(
    event: &CGEvent,
    pid: i32,
    window_id: Option<u32>,
    click_state: i64,
    window_local: Option<(f64, f64)>,
) {
    let event_ptr = event.as_ptr() as *mut c_void;
    let set = |f: u32, v: i64| {
        super::macos_skylight::set_integer_field(event_ptr, f, v);
    };

    // f40 = target pid (Chromium synthetic-event filter) — always stamped.
    set(40, pid as i64);

    if let Some(wid) = window_id {
        let wid_i = wid as i64;
        set(1, click_state); // kCGMouseEventClickState
        set(51, wid_i); // windowNumber
        set(58, 1); // window-addressed routing; not a click-group ID
        set(91, wid_i); // kCGMouseEventWindowUnderMousePointer
        set(92, wid_i); // kCGMouseEventWindowUnderMousePointerThatCanHandleThisEvent
    }

    if let Some((wx, wy)) = window_local {
        super::macos_skylight::set_window_location(event_ptr, wx, wy);
    }
}

/// Establish a private input context inside the bound application. Foreground
/// ownership and the physical pointer remain with the human's application.
fn require_pointer_down_mode(pid: i32) -> BitFunResult<()> {
    super::macos_input_focus::prepare(pid)
}

/// Send a click (down + up, possibly multi-click) at the given **global**
/// pointer position to the target pid. The user's real cursor is NOT moved
/// because we never call `CGWarpMouseCursorPosition` and the synthesized
/// event's `MouseMoved` predecessor is also pid-scoped.
///
/// `point` is in Quartz global pointer coordinates (origin top-left of main
/// display, same space as the existing screenshot pipeline).
pub(super) fn bg_click(
    pid: i32,
    point: (f64, f64),
    button: BgMouseButton,
    click_count: u32,
    modifiers: &[BgModifier],
) -> BitFunResult<()> {
    let _release = InputReleaseGuard;
    if click_count == 0 {
        return Ok(());
    }
    require_pointer_down_mode(pid)?;
    let pt = CGPoint {
        x: point.0,
        y: point.1,
    };
    let flags = flags_from(modifiers);
    let self_pid = std::process::id() as i32;
    let frontmost = frontmost_pid_macos();
    let started = Instant::now();
    info!(
        target: "computer_use::bg_input",
        "bg_click.enter pid={} self_pid={} same_process={} frontmost_pid={:?} is_frontmost={} x={:.2} y={:.2} button={:?} click_count={} modifiers={:?}",
        pid,
        self_pid,
        pid == self_pid,
        frontmost,
        Some(pid) == frontmost,
        point.0,
        point.1,
        button,
        click_count,
        modifiers
    );
    // One session-state source per gesture; routing remains process/window local.
    let src = match mouse_source("click") {
        Ok(s) => s,
        Err(e) => {
            warn!(target: "computer_use::bg_input", "bg_click.mouse_source_failed pid={} error={}", pid, e);
            return Err(e);
        }
    };

    // Pre-position the synthetic pointer inside the app's event queue so AX
    // hit-testing in the target app sees the right coordinates. Does NOT
    // move the user's real cursor because we post pid-scoped, not global.
    let mv = CGEvent::new_mouse_event(src.clone(), CGEventType::MouseMoved, pt, button.cg())
        .map_err(|_| BitFunError::tool("CGEvent MouseMoved failed".to_string()))?;
    mv.set_flags(flags);
    post_mouse(pid, &mv)?;

    for i in 1..=click_count {
        let down = CGEvent::new_mouse_event(src.clone(), button.down(), pt, button.cg())
            .map_err(|_| BitFunError::tool("CGEvent MouseDown failed".to_string()))?;
        // Click count field lets the target app recognise double / triple
        // clicks within its own quench-time window.
        down.set_integer_value_field(
            core_graphics::event::EventField::MOUSE_EVENT_CLICK_STATE,
            i as i64,
        );
        down.set_flags(flags);
        post_mouse(pid, &down)?;

        let up = CGEvent::new_mouse_event(src.clone(), button.up(), pt, button.cg())
            .map_err(|_| BitFunError::tool("CGEvent MouseUp failed".to_string()))?;
        up.set_integer_value_field(
            core_graphics::event::EventField::MOUSE_EVENT_CLICK_STATE,
            i as i64,
        );
        up.set_flags(flags);
        post_mouse(pid, &up)?;
    }
    info!(
        target: "computer_use::bg_input",
        "bg_click.posted pid={} elapsed_ms={}",
        pid,
        started.elapsed().as_millis() as u64
    );
    Ok(())
}

/// Best-effort lookup of the macOS frontmost-application pid via NSWorkspace.
/// Returns `None` when the AppKit lookup is not available (e.g. headless tests
/// or non-main-thread contexts where we don't want to assert).
pub(super) fn frontmost_pid_macos() -> Option<i32> {
    frontmost_app_identity_macos().map(|id| id.pid)
}

/// Identity of the macOS frontmost application, read straight from
/// `NSWorkspace.frontmostApplication`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MacFrontmostApp {
    pub pid: i32,
    /// `NSRunningApplication.localizedName` — what the user sees in the menu
    /// bar (e.g. "飞书"), which is **not** always the executable or bundle
    /// name (`Feishu` / `Lark.app`).
    pub name: Option<String>,
    pub bundle_id: Option<String>,
}

/// Best-effort identity (pid + localized name + bundle id) of the frontmost
/// application.
///
/// This deliberately avoids `osascript`: the previous AppleScript spelling
/// (`tell application "System Events" to … first process whose frontmost is
/// true`) cost a process spawn on every single tool result, could block on an
/// AppleEvent timeout when System Events was busy, and — because it embedded a
/// `try … end try` block in expression position — never actually compiled, so
/// the caller silently saw `None` forever. `NSWorkspace` answers in-process in
/// microseconds and needs no Automation permission.
pub(super) fn frontmost_app_identity_macos() -> Option<MacFrontmostApp> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    // SAFETY: every selector is sent to a class/instance that was just checked
    // non-null. `sharedWorkspace`, `frontmostApplication`, `localizedName` and
    // `bundleIdentifier` are all +0 (autoreleased/borrowed) returns, so nothing
    // here owns a retain to balance. `NSWorkspace.frontmostApplication` is
    // documented as safe to read from any thread.
    unsafe {
        let cls = objc2::runtime::AnyClass::get(c"NSWorkspace")?;
        let ws: *mut AnyObject = msg_send![cls, sharedWorkspace];
        if ws.is_null() {
            return None;
        }
        let app: *mut AnyObject = msg_send![ws, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let pid: i32 = msg_send![app, processIdentifier];
        if pid <= 0 {
            return None;
        }
        let name: *mut AnyObject = msg_send![app, localizedName];
        let bundle: *mut AnyObject = msg_send![app, bundleIdentifier];
        Some(MacFrontmostApp {
            pid,
            name: ns_string_to_rust(name),
            bundle_id: ns_string_to_rust(bundle),
        })
    }
}

/// Pid of a running application with the given bundle identifier, preferring
/// the most recently activated instance. `None` when nothing with that bundle
/// id is running.
pub(super) fn pid_for_bundle_id_macos(bundle_id: &str) -> Option<i32> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use objc2_foundation::NSString;
    // SAFETY: `runningApplicationsWithBundleIdentifier:` returns a +0 NSArray;
    // indices stay in `0..count` and every element is null-checked before use.
    unsafe {
        let cls = objc2::runtime::AnyClass::get(c"NSRunningApplication")?;
        let ns_bundle = NSString::from_str(bundle_id);
        let arr: *mut AnyObject =
            msg_send![cls, runningApplicationsWithBundleIdentifier: &*ns_bundle];
        if arr.is_null() {
            return None;
        }
        let count: usize = msg_send![arr, count];
        // Prefer an instance that already owns windows; fall back to the first.
        let mut fallback: Option<i32> = None;
        for i in 0..count {
            let app: *mut AnyObject = msg_send![arr, objectAtIndex: i];
            if app.is_null() {
                continue;
            }
            let pid: i32 = msg_send![app, processIdentifier];
            if pid <= 0 {
                continue;
            }
            if fallback.is_none() {
                fallback = Some(pid);
            }
            if crate::computer_use::macos_ax_ui::window_count_for_pid(pid).unwrap_or(0) > 0 {
                return Some(pid);
            }
        }
        fallback
    }
}

/// Localized name and bundle id of a running application, by pid.
pub(super) fn running_app_identity_macos(pid: i32) -> Option<(Option<String>, Option<String>)> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    // SAFETY: `runningApplicationWithProcessIdentifier:` returns nil for an
    // unknown pid, which is checked; the two property reads are +0 returns.
    unsafe {
        let cls = objc2::runtime::AnyClass::get(c"NSRunningApplication")?;
        let app: *mut AnyObject = msg_send![cls, runningApplicationWithProcessIdentifier: pid];
        if app.is_null() {
            return None;
        }
        let name: *mut AnyObject = msg_send![app, localizedName];
        let bundle: *mut AnyObject = msg_send![app, bundleIdentifier];
        Some((ns_string_to_rust(name), ns_string_to_rust(bundle)))
    }
}

/// Copy an `NSString *` into an owned Rust `String`. Returns `None` for a null
/// pointer or a string whose UTF-8 buffer is unavailable.
///
/// # Safety
/// `s` must be null or a valid `NSString` pointer.
pub(super) unsafe fn ns_string_to_rust(s: *mut objc2::runtime::AnyObject) -> Option<String> {
    use objc2::msg_send;
    if s.is_null() {
        return None;
    }
    // SAFETY: `s` is a valid NSString per this function's contract, checked
    // non-null above. `UTF8String` hands back a NUL-terminated buffer owned by
    // the autorelease pool; `CStr::to_string_lossy().into_owned()` copies out of
    // it before returning, so nothing borrows the pool past this block.
    unsafe {
        let utf8: *const std::os::raw::c_char = msg_send![s, UTF8String];
        if utf8.is_null() {
            return None;
        }
        let out = std::ffi::CStr::from_ptr(utf8)
            .to_string_lossy()
            .into_owned();
        if out.is_empty() {
            None
        } else {
            Some(out)
        }
    }
}

/// Best-effort: bring `pid`'s app to the foreground so that GUI hit-testing
/// (especially WKWebView event delivery) reliably routes synthetic clicks
/// to the right window.
///
/// When the SkyLight focus-without-raise SPI is available, uses
/// `SLPSPostEventRecordTo` to change WindowServer focus state **without
/// raising any windows or triggering Space-follow** (ported from yabai).
/// This is the preferred path for background automation because it doesn't
/// disrupt the user's visible window layout.
///
/// Falls back to the public `NSRunningApplication.activateWithOptions` API
/// which **does** raise the window and steal focus — used when the SkyLight
/// SPI is unavailable or when a window_id is not known.
///
/// Returns `Ok(true)` when activation succeeded, `Ok(false)` when the app
/// could not be found, and `Err(_)` on AppKit FFI failures.
pub(super) fn activate_pid_macos(pid: i32) -> BitFunResult<bool> {
    // Without a window_id we can't use the focus-without-raise SPI.
    // Fall through to the public API.
    activate_pid_macos_with_window(pid, None)
}

/// Explicit foreground-only activation. Uses the focus-without-raise SPI when a
/// `window_id` is provided and the SkyLight SPI is available.
pub(super) fn activate_pid_macos_with_window(
    pid: i32,
    window_id: Option<u32>,
) -> BitFunResult<bool> {
    super::control_session::foreground_allowed().map_err(BitFunError::tool)?;
    // Try focus-without-raise first when we have a window id.
    if let Some(wid) = window_id {
        if super::macos_skylight::is_focus_without_raise_available() {
            let ok = super::macos_skylight::activate_without_raise(pid, wid);
            if ok {
                info!(
                    target: "computer_use::bg_input",
                    "activate_without_raise.done pid={} wid={}",
                    pid, wid
                );
                return Ok(true);
            }
            // SPI call failed — fall through to public API.
            warn!(
                target: "computer_use::bg_input",
                "activate_without_raise.failed pid={} wid={} — falling back to NSRunningApplication",
                pid, wid
            );
        }
    }

    // Public API fallback (raises window, steals focus).
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let started = Instant::now();
    let result: bool = unsafe {
        let cls = match objc2::runtime::AnyClass::get(c"NSRunningApplication") {
            Some(c) => c,
            None => {
                debug!(target: "computer_use::bg_input", "activate.class_missing pid={}", pid);
                return Ok(false);
            }
        };
        let app: *mut AnyObject = msg_send![cls, runningApplicationWithProcessIdentifier: pid];
        if app.is_null() {
            debug!(target: "computer_use::bg_input", "activate.app_not_found pid={}", pid);
            return Ok(false);
        }
        // 1<<1 == NSApplicationActivateIgnoringOtherApps
        let ok: bool = msg_send![app, activateWithOptions: 1u64 << 1];
        ok
    };
    info!(
        target: "computer_use::bg_input",
        "activate.done pid={} ok={} elapsed_ms={}",
        pid,
        result,
        started.elapsed().as_millis() as u64
    );
    Ok(result)
}

/// Pixel-delta scroll inside the focused scroll container of the target
/// pid's frontmost window. Positive `dy` scrolls content down (matches
/// trackpad / `wheel1>0` direction).
pub(super) fn bg_scroll(pid: i32, dx: i32, dy: i32) -> BitFunResult<()> {
    info!(
        target: "computer_use::bg_input",
        "bg_scroll.enter pid={} dx={} dy={}",
        pid, dx, dy
    );
    let src = mouse_source("scroll")?;
    // Two-axis pixel scroll (`wheelCount = 2`): wheel1 = dy, wheel2 = dx.
    // Sign convention matches the system trackpad (positive dy = content
    // moves down on screen, i.e. user is looking further into the document).
    let ev = CGEvent::new_scroll_event(src, ScrollEventUnit::PIXEL, 2, dy, dx, 0)
        .map_err(|_| BitFunError::tool("CGEventCreateScrollWheelEvent2 failed".to_string()))?;
    ev.set_flags(CGEventFlags::CGEventFlagNull);
    post_mouse(pid, &ev)?;
    Ok(())
}

/// Type a UTF-8 string into the focused control of the target pid using the
/// `kCGEventKeyboardEventUnicodeString` field. This bypasses keymap
/// translation entirely, so it correctly handles emoji, CJK and other
/// non-Latin input without touching the system IME.
pub(super) fn bg_type_text(pid: i32, text: &str) -> BitFunResult<()> {
    let _release = InputReleaseGuard;
    super::macos_input_focus::prepare(pid)?;
    if text.is_empty() {
        return Ok(());
    }
    info!(
        target: "computer_use::bg_input",
        "bg_type_text.enter pid={} char_count={} byte_count={}",
        pid,
        text.chars().count(),
        text.len()
    );
    // Single source for the whole string (Codex parity): keeps the kernel
    // keyboard state coherent and avoids the per-char allocation cost.
    let src = private_source("type_text")?;
    // We send one event per Unicode scalar to keep individual events small
    // and let the target app receive a sane stream of `keyDown` callbacks.
    // (`set_string` itself will accept a longer buffer, but some Cocoa text
    // controls truncate at ~20 UTF-16 units per event.)
    for ch in text.chars() {
        // Keycode 0 is irrelevant when the unicode string field is set.
        let ev = CGEvent::new_keyboard_event(src.clone(), 0, true)
            .map_err(|_| BitFunError::tool("CGEventCreateKeyboardEvent failed".to_string()))?;
        let buf: Vec<u16> = ch.encode_utf16(&mut [0u16; 2]).to_vec();
        ev.set_string_from_utf16_unchecked(&buf);
        post_keyboard(pid, &ev)?;
        // Match keyup so the target app sees a complete keystroke.
        let ev2 = CGEvent::new_keyboard_event(src.clone(), 0, false).map_err(|_| {
            BitFunError::tool("CGEventCreateKeyboardEvent (up) failed".to_string())
        })?;
        ev2.set_string_from_utf16_unchecked(&buf);
        post_keyboard(pid, &ev2)?;
        // 8ms inter-key gap matches Codex / native typing rates and avoids
        // dropped chars in Chromium webviews and SwiftUI multi-line fields
        // that throttle their keystroke handler. 1ms (the previous value)
        // was reliably losing ~5–10% of CJK glyphs in informal smoke tests.
        thread::sleep(Duration::from_millis(8));
    }
    Ok(())
}

/// Send a key chord (modifier+key combo) to the target pid using the
/// private event source. `key` is the AX / Carbon virtual keycode; callers
/// can use `keycode_for_char` for ASCII letters or pass a literal keycode.
pub(super) fn bg_key_chord(pid: i32, modifiers: &[BgModifier], key: u16) -> BitFunResult<()> {
    let _release = InputReleaseGuard;
    super::macos_input_focus::prepare(pid)?;
    info!(
        target: "computer_use::bg_input",
        "bg_key_chord.enter pid={} keycode={} modifiers={:?}",
        pid, key, modifiers
    );
    let flags = flags_from(modifiers);
    // Single source across the whole chord — required for the modifier
    // latch state to survive between mod_down → key_down → key_up → mod_up.
    let src = private_source("key_chord")?;

    // Press modifiers.
    for m in modifiers {
        let ev = CGEvent::new_keyboard_event(src.clone(), m.keycode(), true)
            .map_err(|_| BitFunError::tool("CGEvent ModDown failed".to_string()))?;
        ev.set_flags(flags);
        post_keyboard(pid, &ev)?;
    }
    // Press main key.
    {
        let ev = CGEvent::new_keyboard_event(src.clone(), key, true)
            .map_err(|_| BitFunError::tool("CGEvent KeyDown failed".to_string()))?;
        ev.set_flags(flags);
        post_keyboard(pid, &ev)?;
    }
    {
        let ev = CGEvent::new_keyboard_event(src.clone(), key, false)
            .map_err(|_| BitFunError::tool("CGEvent KeyUp failed".to_string()))?;
        ev.set_flags(flags);
        post_keyboard(pid, &ev)?;
    }
    // Release modifiers in reverse press order.
    for m in modifiers.iter().rev() {
        let ev = CGEvent::new_keyboard_event(src.clone(), m.keycode(), false)
            .map_err(|_| BitFunError::tool("CGEvent ModUp failed".to_string()))?;
        // Drop this modifier from the flag set as we release it.
        let remaining = modifiers
            .iter()
            .copied()
            .filter(|x| x != m)
            .collect::<Vec<_>>();
        ev.set_flags(flags_from(&remaining));
        post_keyboard(pid, &ev)?;
    }
    Ok(())
}

/// Directed Chromium routing for explicitly authorized foreground control.
/// Target acceptance is application-dependent; callers re-observe the result.
pub(super) fn bg_click_chromium(
    pid: i32,
    screen_x: f64,
    screen_y: f64,
    win_local_x: f64,
    win_local_y: f64,
    wid: u32,
    click_count: u32,
    modifiers: &[BgModifier],
) -> BitFunResult<()> {
    let _release = InputReleaseGuard;
    if click_count == 0 {
        return Ok(());
    }
    require_pointer_down_mode(pid)?;
    let src = mouse_source("click_chromium")?;
    let target = CGPoint {
        x: screen_x,
        y: screen_y,
    };
    let win_local = (win_local_x, win_local_y);
    let flags = flags_from(modifiers);
    let click_pairs = click_count as usize;
    let window_id = wid as i64;

    let stamp = |event: &CGEvent, local: (f64, f64), click_state: i64, phase: i64| {
        let ptr = event.as_ptr() as *mut c_void;
        let set = |f: u32, v: i64| {
            super::macos_skylight::set_integer_field(ptr, f, v);
        };
        set(0, phase); // gesture phase
        set(1, click_state); // kCGMouseEventClickState
        set(3, 0); // button (left)
        set(40, pid as i64); // Chromium synthetic-event filter
        if window_id != 0 {
            set(51, window_id); // windowNumber
            set(91, window_id); // WindowUnderMousePointer
            set(92, window_id); // WindowUnderMousePointerThatCanHandleThisEvent
        }
        set(58, 1); // window-addressed routing
        super::macos_skylight::set_window_location(ptr, local.0, local.1);
        event.set_flags(flags);
    };

    let post = |event: &CGEvent| post_mouse(pid, event);

    // Step 1: mouseMoved at target (phase=2, clickState=0).
    let move_ev = CGEvent::new_mouse_event(
        src.clone(),
        CGEventType::MouseMoved,
        target,
        CGMouseButton::Left,
    )
    .map_err(|_| BitFunError::tool("Chromium click: mouseMoved creation failed".to_string()))?;
    stamp(&move_ev, win_local, 0, 2);
    post(&move_ev)?;
    thread::sleep(Duration::from_millis(15));

    // Step 3: target click pair(s) with clickState stepped 1→N.
    for pair_index in 1..=click_pairs {
        let click_state = pair_index as i64;
        let down = CGEvent::new_mouse_event(
            src.clone(),
            CGEventType::LeftMouseDown,
            target,
            CGMouseButton::Left,
        )
        .map_err(|_| BitFunError::tool("Chromium click: target down failed".to_string()))?;
        stamp(&down, win_local, click_state, 3);
        post(&down)?;
        thread::sleep(Duration::from_millis(1));

        let up = CGEvent::new_mouse_event(
            src.clone(),
            CGEventType::LeftMouseUp,
            target,
            CGMouseButton::Left,
        )
        .map_err(|_| BitFunError::tool("Chromium click: target up failed".to_string()))?;
        stamp(&up, win_local, click_state, 3);
        post(&up)?;

        if pair_index < click_pairs {
            thread::sleep(Duration::from_millis(80));
        }
    }

    info!(
        target: "computer_use::bg_input",
        "bg_click_chromium.posted pid={} wid={} x={:.2} y={:.2} pairs={}",
        pid, wid, screen_x, screen_y, click_pairs
    );
    Ok(())
}

/// Mouse button for drag gestures.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum BgDragButton {
    Left,
    Right,
    Middle,
}

impl BgDragButton {
    fn cg(self) -> CGMouseButton {
        match self {
            Self::Left => CGMouseButton::Left,
            Self::Right => CGMouseButton::Right,
            Self::Middle => CGMouseButton::Center,
        }
    }
    fn down(self) -> CGEventType {
        match self {
            Self::Left => CGEventType::LeftMouseDown,
            Self::Right => CGEventType::RightMouseDown,
            Self::Middle => CGEventType::OtherMouseDown,
        }
    }
    fn dragged(self) -> CGEventType {
        match self {
            Self::Left => CGEventType::LeftMouseDragged,
            Self::Right => CGEventType::RightMouseDragged,
            Self::Middle => CGEventType::OtherMouseDragged,
        }
    }
    fn up(self) -> CGEventType {
        match self {
            Self::Left => CGEventType::LeftMouseUp,
            Self::Right => CGEventType::RightMouseUp,
            Self::Middle => CGEventType::OtherMouseUp,
        }
    }
}

/// Press-drag-release gesture from `(from_x, from_y)` to `(to_x, to_y)` in
/// screen coordinates, posted to `pid`.
///
/// `duration_ms` is the wall-clock budget; `steps` is the number of
/// intermediate `leftMouseDragged` events linearly interpolated along the
/// path. Modifiers are held across the entire gesture.
pub(super) fn bg_drag(
    pid: i32,
    from_x: f64,
    from_y: f64,
    to_x: f64,
    to_y: f64,
    from_local: Option<(f64, f64)>,
    to_local: Option<(f64, f64)>,
    wid: Option<u32>,
    duration_ms: u64,
    steps: usize,
    modifiers: &[BgModifier],
    button: BgDragButton,
) -> BitFunResult<()> {
    let _release = InputReleaseGuard;
    require_pointer_down_mode(pid)?;
    let src = mouse_source("drag")?;
    let flags = flags_from(modifiers);
    let cg_button = button.cg();

    let steps = steps.max(1);
    let step_delay_ms = if steps > 1 {
        duration_ms / steps as u64
    } else {
        duration_ms
    };

    // MouseDown at start.
    let from_pt = CGPoint {
        x: from_x,
        y: from_y,
    };
    let down = CGEvent::new_mouse_event(src.clone(), button.down(), from_pt, cg_button)
        .map_err(|_| BitFunError::tool("drag: mouseDown failed".to_string()))?;
    down.set_flags(flags);
    stamp_chromium_fields(&down, pid, wid, 1, from_local);
    post_mouse(pid, &down)?;
    thread::sleep(Duration::from_millis(16));

    // Interpolated drag steps.
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let ix = from_x + (to_x - from_x) * t;
        let iy = from_y + (to_y - from_y) * t;
        let il = from_local
            .zip(to_local)
            .map(|((fx, fy), (tx, ty))| (fx + (tx - fx) * t, fy + (ty - fy) * t));
        let drag_pt = CGPoint { x: ix, y: iy };
        let drag = CGEvent::new_mouse_event(src.clone(), button.dragged(), drag_pt, cg_button)
            .map_err(|_| BitFunError::tool("drag: mouseDragged failed".to_string()))?;
        drag.set_flags(flags);
        stamp_chromium_fields(&drag, pid, wid, 1, il);
        post_mouse(pid, &drag)?;
        if step_delay_ms > 0 {
            thread::sleep(Duration::from_millis(step_delay_ms));
        }
    }

    // MouseUp at end.
    let to_pt = CGPoint { x: to_x, y: to_y };
    let up = CGEvent::new_mouse_event(src.clone(), button.up(), to_pt, cg_button)
        .map_err(|_| BitFunError::tool("drag: mouseUp failed".to_string()))?;
    up.set_flags(flags);
    stamp_chromium_fields(&up, pid, wid, 1, to_local);
    post_mouse(pid, &up)?;

    info!(
        target: "computer_use::bg_input",
        "bg_drag.posted pid={} from=({:.0},{:.0}) to=({:.0},{:.0}) steps={} button={:?}",
        pid, from_x, from_y, to_x, to_y, steps, button
    );
    Ok(())
}

/// Send a key chord to `pid` WITHOUT the auth-message envelope.
///
/// Required for NSMenu key equivalents: with the envelope, SLEventPostToPid
/// forks onto a direct-Mach path that bypasses IOHIDPostEvent — NSMenu never
/// sees those events. Without the envelope the path goes through
/// IOHIDPostEvent so `NSApplication.sendEvent:` dispatches NSMenu key
/// equivalents.
pub(super) fn bg_key_chord_no_auth(
    pid: i32,
    modifiers: &[BgModifier],
    key: u16,
) -> BitFunResult<()> {
    let _release = InputReleaseGuard;
    super::macos_input_focus::prepare(pid)?;
    info!(
        target: "computer_use::bg_input",
        "bg_key_chord_no_auth.enter pid={} keycode={} modifiers={:?}",
        pid, key, modifiers
    );
    let flags = flags_from(modifiers);
    let src = private_source("key_chord_no_auth")?;

    for m in modifiers {
        let ev = CGEvent::new_keyboard_event(src.clone(), m.keycode(), true)
            .map_err(|_| BitFunError::tool("CGEvent ModDown (no_auth) failed".to_string()))?;
        ev.set_flags(flags);
        post_keyboard_no_auth(pid, &ev)?;
    }
    {
        let ev = CGEvent::new_keyboard_event(src.clone(), key, true)
            .map_err(|_| BitFunError::tool("CGEvent KeyDown (no_auth) failed".to_string()))?;
        ev.set_flags(flags);
        post_keyboard_no_auth(pid, &ev)?;
    }
    {
        let ev = CGEvent::new_keyboard_event(src.clone(), key, false)
            .map_err(|_| BitFunError::tool("CGEvent KeyUp (no_auth) failed".to_string()))?;
        ev.set_flags(flags);
        post_keyboard_no_auth(pid, &ev)?;
    }
    for m in modifiers.iter().rev() {
        let ev = CGEvent::new_keyboard_event(src.clone(), m.keycode(), false)
            .map_err(|_| BitFunError::tool("CGEvent ModUp (no_auth) failed".to_string()))?;
        let remaining = modifiers
            .iter()
            .copied()
            .filter(|x| x != m)
            .collect::<Vec<_>>();
        ev.set_flags(flags_from(&remaining));
        post_keyboard_no_auth(pid, &ev)?;
    }
    Ok(())
}

/// Right-click at `(x, y)` screen coordinates, posted to `pid` via directed input.
pub(super) fn bg_right_click(
    pid: i32,
    point: (f64, f64),
    modifiers: &[BgModifier],
) -> BitFunResult<()> {
    let _release = InputReleaseGuard;
    super::macos_input_focus::prepare(pid)?;
    let src = mouse_source("right_click")?;
    let pt = CGPoint {
        x: point.0,
        y: point.1,
    };
    let flags = flags_from(modifiers);

    let down = CGEvent::new_mouse_event(
        src.clone(),
        CGEventType::RightMouseDown,
        pt,
        CGMouseButton::Right,
    )
    .map_err(|_| BitFunError::tool("CGEvent RightMouseDown failed".to_string()))?;
    down.set_flags(flags);
    stamp_chromium_fields(&down, pid, None, 1, None);
    post_mouse(pid, &down)?;
    thread::sleep(Duration::from_millis(16));

    let up = CGEvent::new_mouse_event(
        src.clone(),
        CGEventType::RightMouseUp,
        pt,
        CGMouseButton::Right,
    )
    .map_err(|_| BitFunError::tool("CGEvent RightMouseUp failed".to_string()))?;
    up.set_flags(flags);
    stamp_chromium_fields(&up, pid, None, 1, None);
    post_mouse(pid, &up)?;
    Ok(())
}

/// Middle-click at `(x, y)` screen coordinates, posted to `pid` via directed input.
pub(super) fn bg_middle_click(
    pid: i32,
    point: (f64, f64),
    modifiers: &[BgModifier],
) -> BitFunResult<()> {
    let _release = InputReleaseGuard;
    super::macos_input_focus::prepare(pid)?;
    let src = mouse_source("middle_click")?;
    let pt = CGPoint {
        x: point.0,
        y: point.1,
    };
    let flags = flags_from(modifiers);

    let down = CGEvent::new_mouse_event(
        src.clone(),
        CGEventType::OtherMouseDown,
        pt,
        CGMouseButton::Center,
    )
    .map_err(|_| BitFunError::tool("CGEvent OtherMouseDown failed".to_string()))?;
    down.set_flags(flags);
    stamp_chromium_fields(&down, pid, None, 1, None);
    post_mouse(pid, &down)?;
    thread::sleep(Duration::from_millis(16));

    let up = CGEvent::new_mouse_event(
        src.clone(),
        CGEventType::OtherMouseUp,
        pt,
        CGMouseButton::Center,
    )
    .map_err(|_| BitFunError::tool("CGEvent OtherMouseUp failed".to_string()))?;
    up.set_flags(flags);
    stamp_chromium_fields(&up, pid, None, 1, None);
    post_mouse(pid, &up)?;
    Ok(())
}

/// Parse a key spec the dispatch layer might pass us, of the form
/// `"command+shift+p"` / `"return"` / `"escape"` / `"a"`. Returns the
/// modifier list and the resolved keycode.
pub(super) fn parse_key_spec(spec: &str) -> BitFunResult<(Vec<BgModifier>, u16)> {
    let mut mods = Vec::new();
    let parts: Vec<&str> = spec.split('+').map(str::trim).collect();
    if parts.is_empty() {
        return Err(BitFunError::tool("empty key spec".to_string()));
    }
    let (last, head) = parts.split_last().unwrap();
    for p in head {
        let m = BgModifier::from_str(p)
            .ok_or_else(|| BitFunError::tool(format!("unknown modifier in key spec: {}", p)))?;
        mods.push(m);
    }
    let kc = keycode_for_named(last)
        .or_else(|| {
            // Single-char ASCII fallback.
            let mut chars = last.chars();
            let c = chars.next()?;
            if chars.next().is_some() {
                return None;
            }
            keycode_for_char(c)
        })
        .ok_or_else(|| BitFunError::tool(format!("unknown key in key spec: {}", last)))?;
    Ok((mods, kc))
}

/// Parse the ControlHub/Codex chord shape: `["command", "shift", "p"]`,
/// `["command+shift+p"]`, or `["return"]`.
pub(super) fn parse_key_sequence(keys: &[String]) -> BitFunResult<(Vec<BgModifier>, u16)> {
    if keys.is_empty() {
        return Err(BitFunError::tool("empty key sequence".to_string()));
    }
    if keys.len() == 1 {
        return parse_key_spec(&keys[0]);
    }

    let (last, head) = keys.split_last().unwrap();
    let mut mods = Vec::with_capacity(head.len());
    for p in head {
        let m = BgModifier::from_str(p).ok_or_else(|| {
            BitFunError::tool(format!("unknown modifier in key sequence: {}", p))
        })?;
        mods.push(m);
    }
    let kc = keycode_for_named(last)
        .or_else(|| {
            let mut chars = last.chars();
            let c = chars.next()?;
            if chars.next().is_some() {
                return None;
            }
            keycode_for_char(c)
        })
        .ok_or_else(|| BitFunError::tool(format!("unknown key in key sequence: {}", last)))?;
    Ok((mods, kc))
}

/// Map common named keys (Codex parity) to AX / Carbon keycodes.
pub(super) fn keycode_for_named(name: &str) -> Option<u16> {
    Some(match name.to_ascii_lowercase().as_str() {
        "return" | "enter" => 36,
        "tab" => 48,
        "space" => 49,
        "delete" | "backspace" => 51,
        "escape" | "esc" => 53,
        "left" => 123,
        "right" => 124,
        "down" => 125,
        "up" => 126,
        "home" => 115,
        "end" => 119,
        "pageup" | "page_up" => 116,
        "pagedown" | "page_down" => 121,
        "f1" => 122,
        "f2" => 120,
        "f3" => 99,
        "f4" => 118,
        "f5" => 96,
        "f6" => 97,
        "f7" => 98,
        "f8" => 100,
        "f9" => 101,
        "f10" => 109,
        "f11" => 103,
        "f12" => 111,
        _ => return None,
    })
}

/// Map a single ASCII character to the **US-keyboard** keycode. This is the
/// same table Codex / enigo use; the user's actual keymap is irrelevant for
/// our chord injection because we set explicit modifier flags ourselves.
pub(super) fn keycode_for_char(c: char) -> Option<u16> {
    let upper = c.to_ascii_uppercase();
    Some(match upper {
        'A' => 0,
        'S' => 1,
        'D' => 2,
        'F' => 3,
        'H' => 4,
        'G' => 5,
        'Z' => 6,
        'X' => 7,
        'C' => 8,
        'V' => 9,
        'B' => 11,
        'Q' => 12,
        'W' => 13,
        'E' => 14,
        'R' => 15,
        'Y' => 16,
        'T' => 17,
        '1' => 18,
        '2' => 19,
        '3' => 20,
        '4' => 21,
        '6' => 22,
        '5' => 23,
        '=' => 24,
        '9' => 25,
        '7' => 26,
        '-' => 27,
        '8' => 28,
        '0' => 29,
        ']' => 30,
        'O' => 31,
        'U' => 32,
        '[' => 33,
        'I' => 34,
        'P' => 35,
        'L' => 37,
        'J' => 38,
        '\'' => 39,
        'K' => 40,
        ';' => 41,
        '\\' => 42,
        ',' => 43,
        '/' => 44,
        'N' => 45,
        'M' => 46,
        '.' => 47,
        '`' => 50,
        _ => return None,
    })
}

// ── Terminal-safe typing detection ─────────────────────────────────────────
//
// Terminal emulators (Ghostty, iTerm2, Terminal.app, etc.) often silently
// drop Unicode string keyboard events (`kCGEventKeyboardEventUnicodeString`).
// When the target is a terminal, the dispatch layer should route `type_text`
// through individual key events instead of the Unicode string field.
// Ported from cua-driver-rs terminal detection (per-platform).

/// Known macOS terminal emulator bundle identifiers.
const TERMINAL_BUNDLE_IDS: &[&str] = &[
    "com.mitchellh.ghostty",
    "com.googlecode.iterm2",
    "com.apple.Terminal",
    "com.todesktop.230313mzl4w4u92", // Warp
    "com.neovide.neovide",
    "org.alacritty",
    "io.wez.wezterm",
    "com.kitty",
    "com.github.wez.wezterm",
];

/// Known macOS terminal app names (lowercase, for substring matching).
const TERMINAL_NAME_HINTS: &[&str] = &[
    "ghostty",
    "iterm",
    "terminal",
    "warp",
    "neovide",
    "alacritty",
    "wezterm",
    "kitty",
    "hyper",
    "tabby",
];

/// Check if the target pid is a terminal emulator by looking up its
/// bundle id via `NSRunningApplication`. Returns `true` when the app is
/// a known terminal emulator that may silently drop Unicode string events.
pub(super) fn is_terminal_emulator(pid: i32) -> bool {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    let bundle_id = unsafe {
        let cls = match objc2::runtime::AnyClass::get(c"NSRunningApplication") {
            Some(c) => c,
            None => return false,
        };
        let app: *mut AnyObject = msg_send![cls, runningApplicationWithProcessIdentifier: pid];
        if app.is_null() {
            return false;
        }
        let bundle: *mut AnyObject = msg_send![app, bundleIdentifier];
        if bundle.is_null() {
            // Fallback: check localized name.
            let name: *mut AnyObject = msg_send![app, localizedName];
            if name.is_null() {
                return false;
            }
            let utf8: *const std::os::raw::c_char = msg_send![name, UTF8String];
            if utf8.is_null() {
                return false;
            }
            let name_str = std::ffi::CStr::from_ptr(utf8)
                .to_string_lossy()
                .to_ascii_lowercase();
            return TERMINAL_NAME_HINTS.iter().any(|&h| name_str.contains(h));
        }
        let utf8: *const std::os::raw::c_char = msg_send![bundle, UTF8String];
        if utf8.is_null() {
            return false;
        }
        std::ffi::CStr::from_ptr(utf8)
            .to_string_lossy()
            .to_ascii_lowercase()
    };
    if TERMINAL_BUNDLE_IDS.iter().any(|&b| bundle_id == b) {
        return true;
    }
    if TERMINAL_NAME_HINTS.iter().any(|&h| bundle_id.contains(h)) {
        return true;
    }
    false
}

/// Type text into a terminal emulator using individual key events instead of
/// Unicode string injection. This bypasses the silent-drop problem in
/// Ghostty/iTerm2/Terminal.app by sending actual key-down/up pairs.
///
/// Only works for ASCII characters that have direct keycodes. Non-ASCII text
/// (CJK, emoji) should use `bg_type_text` (Unicode string) or `paste` instead.
pub(super) fn bg_type_text_terminal_safe(pid: i32, text: &str) -> BitFunResult<()> {
    let _release = InputReleaseGuard;
    super::macos_input_focus::prepare(pid)?;
    if text.is_empty() {
        return Ok(());
    }
    info!(
        target: "computer_use::bg_input",
        "bg_type_text_terminal_safe.enter pid={} char_count={}",
        pid,
        text.chars().count()
    );
    let src = private_source("type_text_terminal")?;
    for ch in text.chars() {
        let kc = keycode_for_char(ch);
        let needs_shift = ch.is_ascii_uppercase();
        let flags = if needs_shift {
            flags_from(&[BgModifier::Shift])
        } else {
            CGEventFlags::CGEventFlagNull
        };

        if let Some(kc) = kc {
            // Use key events for mappable ASCII characters.
            let down = CGEvent::new_keyboard_event(src.clone(), kc, true)
                .map_err(|_| BitFunError::tool("terminal type: keydown failed".to_string()))?;
            down.set_flags(flags);
            post_keyboard(pid, &down)?;
            thread::sleep(Duration::from_millis(8));

            let up = CGEvent::new_keyboard_event(src.clone(), kc, false)
                .map_err(|_| BitFunError::tool("terminal type: keyup failed".to_string()))?;
            up.set_flags(flags);
            post_keyboard(pid, &up)?;
            thread::sleep(Duration::from_millis(8));
        } else {
            // Fallback to Unicode string for non-ASCII characters.
            let buf: Vec<u16> = ch.encode_utf16(&mut [0u16; 2]).to_vec();
            let down = CGEvent::new_keyboard_event(src.clone(), 0, true).map_err(|_| {
                BitFunError::tool("terminal type: unicode down failed".to_string())
            })?;
            down.set_string_from_utf16_unchecked(&buf);
            post_keyboard(pid, &down)?;
            thread::sleep(Duration::from_millis(8));

            let up = CGEvent::new_keyboard_event(src.clone(), 0, false).map_err(|_| {
                BitFunError::tool("terminal type: unicode up failed".to_string())
            })?;
            up.set_string_from_utf16_unchecked(&buf);
            post_keyboard(pid, &up)?;
            thread::sleep(Duration::from_millis(8));
        }
    }
    Ok(())
}

/// Type text with automatic terminal detection: routes to
/// `bg_type_text_terminal_safe` when the target is a terminal emulator,
/// otherwise uses the standard `bg_type_text` (Unicode string injection).
pub(super) fn bg_type_text_auto(pid: i32, text: &str) -> BitFunResult<()> {
    if is_terminal_emulator(pid) {
        debug!(
            target: "computer_use::bg_input",
            "bg_type_text_auto: pid={} detected as terminal, using key-event typing",
            pid
        );
        bg_type_text_terminal_safe(pid, text)
    } else {
        bg_type_text(pid, text)
    }
}

// ── Window-id resolution + Chromium/Electron detection ───────────────────────

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(
        option: u32,
        relative_to_window: u32,
    ) -> core_foundation::array::CFArrayRef;
}

#[allow(non_upper_case_globals)]
const kCGWindowListOptionOnScreenOnly: u32 = 1;
#[allow(non_upper_case_globals)]
const kCGWindowListExcludeDesktopElements: u32 = 16;
#[allow(non_upper_case_globals)]
const kCGNullWindowID: u32 = 0;

/// Returns the CGWindowID (window number) of the first on-screen, layer-0
/// window owned by `pid`. Uses `CGWindowListCopyWindowInfo` — the same API
/// `screencapture -l <wid>` consumes. Returns `None` when no matching
/// window is found.
pub(super) fn frontmost_window_id_for_pid(pid: i32) -> Option<u32> {
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFGetTypeID, CFTypeRef, TCFType};
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use std::os::raw::c_void;

    let raw_ref = unsafe {
        CGWindowListCopyWindowInfo(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        )
    };
    if raw_ref.is_null() {
        return None;
    }
    let array: CFArray<CFTypeRef> = unsafe { CFArray::wrap_under_create_rule(raw_ref as _) };
    let dict_type_id = CFDictionary::<*const c_void, *const c_void>::type_id();

    for item in array.iter() {
        let item = *item;
        if unsafe { CFGetTypeID(item) } != dict_type_id {
            continue;
        }
        let dict: CFDictionary<*const c_void, *const c_void> =
            unsafe { CFDictionary::wrap_under_get_rule(item as _) };

        let get_num = |key: &str| -> i64 {
            let k = CFString::new(key);
            dict.find(k.as_concrete_TypeRef() as *const c_void)
                .and_then(|v| unsafe {
                    let v = *v;
                    if CFGetTypeID(v) == CFNumber::type_id() {
                        CFNumber::wrap_under_get_rule(v as _).to_i64()
                    } else {
                        None
                    }
                })
                .unwrap_or(0)
        };

        let owner_pid = get_num("kCGWindowOwnerPID") as i32;
        if owner_pid != pid {
            continue;
        }
        let layer = get_num("kCGWindowLayer") as i32;
        if layer != 0 {
            continue;
        }
        let wid = get_num("kCGWindowNumber") as u32;
        if wid != 0 {
            return Some(wid);
        }
    }
    None
}

/// Bundle-id keywords for Chromium-based / Electron-based applications.
/// Matched via `contains` against the lowercased bundle id.
const CHROMIUM_BUNDLE_KEYWORDS: &[&str] = &[
    "chrome",
    "chromium",
    "electron",
    "brave",
    "microsoft-edge",
    "arc.", // Arc browser
    "vivaldi",
    "operamini", // Opera
    "com.operasoftware.operaprofiles",
];

/// Returns `true` when the bundle_id indicates a Chromium-based or
/// Electron-based application. These apps need the `bg_click_chromium`
/// 5-event recipe for reliable background clicks.
pub(super) fn is_chromium_electron(bundle_id: Option<&str>) -> bool {
    if let Some(bid) = bundle_id {
        let lc = bid.to_ascii_lowercase();
        CHROMIUM_BUNDLE_KEYWORDS.iter().any(|&kw| lc.contains(kw))
    } else {
        false
    }
}

/// Convenience: look up the bundle_id for a pid via NSRunningApplication.
pub(super) fn bundle_id_for_pid(pid: i32) -> Option<String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    unsafe {
        let cls = objc2::runtime::AnyClass::get(c"NSRunningApplication")?;
        let app: *mut AnyObject = msg_send![cls, runningApplicationWithProcessIdentifier: pid];
        if app.is_null() {
            return None;
        }
        let bundle: *mut AnyObject = msg_send![app, bundleIdentifier];
        if bundle.is_null() {
            return None;
        }
        let utf8: *const std::os::raw::c_char = msg_send![bundle, UTF8String];
        if utf8.is_null() {
            return None;
        }
        std::ffi::CStr::from_ptr(utf8)
            .to_str()
            .ok()
            .map(|s| s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs against scripts/fixtures/computer-use-directed-input.m only.
    #[test]
    fn addressed_mouse_source_preserves_button_and_requested_modifiers() {
        use core_graphics::event::EventField;
        let event = CGEvent::new_mouse_event(
            mouse_source("routing_test").unwrap(),
            CGEventType::RightMouseDown,
            CGPoint::new(120.0, 140.0),
            CGMouseButton::Right,
        )
        .unwrap();
        let flags = flags_from(&[BgModifier::Shift, BgModifier::Option]);
        event.set_flags(flags);
        stamp_chromium_fields(&event, 42, Some(17), 1, Some((20.0, 40.0)));
        route_mouse_to_window(&event, 17, 100.0, 100.0).unwrap();
        assert_eq!(
            event.get_integer_value_field(EventField::EVENT_SOURCE_STATE_ID),
            0
        );
        assert_eq!(event.get_integer_value_field(58), 1);
        assert_eq!(
            event.get_integer_value_field(EventField::MOUSE_EVENT_BUTTON_NUMBER),
            1
        );
        assert_eq!(event.get_flags(), flags);
        for field in [51, 91, 92] {
            assert_eq!(event.get_integer_value_field(field), 17);
        }
        // No event is posted: this protects the observed native transport recipe.
    }

    #[test]
    #[ignore = "requires a dedicated native fixture and Accessibility permission"]
    fn native_directed_input_fixture_counts_and_stop_release() {
        let pid: i32 = std::env::var("BITFUN_INPUT_FIXTURE_PID")
            .expect("fixture PID")
            .parse()
            .unwrap();
        let x: f64 = std::env::var("BITFUN_INPUT_FIXTURE_X")
            .unwrap()
            .parse()
            .unwrap();
        let y: f64 = std::env::var("BITFUN_INPUT_FIXTURE_Y")
            .unwrap()
            .parse()
            .unwrap();
        let path = std::env::var("BITFUN_INPUT_FIXTURE_RESULT").unwrap();
        assert!(
            supports_background_input(),
            "Accessibility permission required"
        );
        unsafe extern "C" {
            fn CGEventSourceCounterForEventType(state: i32, event_type: u32) -> u32;
        }
        let human_moves = unsafe { CGEventSourceCounterForEventType(1, 5) };
        let pointer = CGEvent::new(private_source("fixture").unwrap())
            .unwrap()
            .location();
        let frontmost = frontmost_pid_macos();
        use bitfun_agent_tools::computer_use_control::ControlMode;
        crate::computer_use::control_session::start(
            "native-input-fixture",
            ControlMode::Background,
        )
        .unwrap();
        let lease =
            crate::computer_use::control_session::acquire("native-input-fixture", "app_click")
                .unwrap();
        crate::computer_use::macos_capture::capture_frame(pid, frontmost_window_id_for_pid(pid))
            .unwrap();
        bg_click(pid, (x, y), BgMouseButton::Left, 1, &[]).unwrap();
        thread::sleep(Duration::from_millis(150));
        let down = CGEvent::new_mouse_event(
            private_source("fixture-held").unwrap(),
            CGEventType::LeftMouseDown,
            CGPoint::new(x, y),
            CGMouseButton::Left,
        )
        .unwrap();
        post_mouse(pid, &down).unwrap();
        crate::computer_use::control_session::stop(Some("native-input-fixture"), "fixture stop")
            .unwrap();
        assert!(bg_click(pid, (x, y), BgMouseButton::Left, 1, &[]).is_err());
        drop(lease);
        thread::sleep(Duration::from_millis(200));
        let counts: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(
            counts["downs"], 2,
            "one click and one held press must reach the fixture exactly once"
        );
        assert_eq!(
            counts["ups"], 2,
            "normal release and cancellation release must both arrive"
        );
        assert_eq!(
            frontmost_pid_macos(),
            frontmost,
            "background input stole foreground focus"
        );
        let after = CGEvent::new(private_source("fixture-after").unwrap())
            .unwrap()
            .location();
        if unsafe { CGEventSourceCounterForEventType(1, 5) } == human_moves {
            assert_eq!(
                (after.x, after.y),
                (pointer.x, pointer.y),
                "background input moved the real cursor"
            );
        } else {
            eprintln!(
                "Concurrent human pointer movement; cursor immobility assertion not evaluated"
            );
        }
    }

    #[test]
    #[ignore = "requires the dedicated standard AppKit controls fixture"]
    fn native_inactive_controls_fixture() {
        run_inactive_controls_fixture(false);
    }

    #[test]
    #[ignore = "requires the dedicated occluded standard AppKit controls fixture"]
    fn native_semantic_controls_fixture() {
        run_inactive_controls_fixture(true);
    }

    fn run_inactive_controls_fixture(semantic: bool) {
        let pid: i32 = std::env::var("BITFUN_INPUT_FIXTURE_PID")
            .unwrap()
            .parse()
            .unwrap();
        let path = std::env::var("BITFUN_INPUT_FIXTURE_RESULT").unwrap();
        let read = || -> serde_json::Value {
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
        };
        let initial = read();
        assert_eq!(initial["active"], false, "fixture must begin inactive");
        let foreground = frontmost_pid_macos();
        let observer_pid: i32 = std::env::var("BITFUN_INPUT_OBSERVER_PID")
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(
            foreground,
            Some(observer_pid),
            "test observer must be the actual foreground app"
        );
        let observer_path = std::env::var("BITFUN_INPUT_OBSERVER_RESULT").unwrap();
        let observer = || -> serde_json::Value {
            serde_json::from_str(&std::fs::read_to_string(&observer_path).unwrap()).unwrap()
        };
        let initial_observer = observer();
        eprintln!("before capture observer: {initial_observer}");
        assert_eq!(
            initial_observer["target_ahead"], false,
            "fixture must start behind observer"
        );
        let mut raised = false;
        use bitfun_agent_tools::computer_use_control::ControlMode;
        super::super::control_session::start("native-controls-fixture", ControlMode::Background)
            .unwrap();
        let lease =
            super::super::control_session::acquire("native-controls-fixture", "app_click").unwrap();
        super::super::macos_capture::capture_frame(pid, None).unwrap();
        thread::sleep(Duration::from_millis(50));
        let after_capture = observer();
        eprintln!("after capture observer: {after_capture}");
        raised |= after_capture["target_ahead"] == true;
        if semantic {
            let whole_app =
                super::super::macos_ax_dump::dump_app_ax(pid, Default::default()).unwrap();
            let foreign = whole_app
                .nodes
                .iter()
                .find(|node| node.title.as_deref() == Some("Unbound semantic action"))
                .expect("second-window button missing");
            let foreign_ref =
                super::super::macos_ax_dump::cached_ref_loose(pid, foreign.idx).unwrap();
            assert!(
                matches!(
                    super::super::macos_ax_write::try_ax_press(foreign_ref),
                    super::super::macos_ax_write::AxWriteOutcome::Unavailable(_)
                ),
                "same-pid foreign-window write must be rejected"
            );
            let retained_foreign =
                super::super::macos_ax_dump::retained_cached_target(pid, foreign.idx).unwrap();
            assert!(
                super::super::macos_ax_dump::validate_bound_target(
                    pid,
                    retained_foreign.reference()
                )
                .is_err(),
                "foreign coordinates cannot become a pointer fallback"
            );
            assert_eq!(read()["foreign_actions"], 0);
            let snapshot = super::super::macos_ax_dump::dump_app_ax(
                pid,
                super::super::macos_ax_dump::DumpOpts {
                    focus_window_only: true,
                    ..Default::default()
                },
            )
            .unwrap();
            assert_eq!(
                snapshot.window_title.as_deref(),
                Some("BitFun Inactive Controls Fixture")
            );
            for name in ["button", "field"] {
                let p = &initial["targets"][name];
                let hit = super::super::macos_ax_dump::retained_target_at_point(
                    pid,
                    p[0].as_f64().unwrap(),
                    p[1].as_f64().unwrap(),
                )
                .unwrap()
                .expect("application-scoped hit must resolve the exact occluded control");
                let result = if name == "field" {
                    assert!(hit.is_text_input());
                    super::super::macos_ax_write::try_ax_focus(hit.reference())
                } else {
                    assert_eq!(hit.role().as_deref(), Some("AXButton"));
                    super::super::macos_ax_write::try_ax_press(hit.reference())
                };
                assert!(matches!(
                    result,
                    super::super::macos_ax_write::AxWriteOutcome::Ok
                ));
                if name == "field" {
                    bg_type_text(pid, "native-control").unwrap();
                }
                super::super::macos_capture::capture_frame(pid, None).unwrap();
                thread::sleep(Duration::from_millis(60));
                let state = observer();
                eprintln!("semantic {name} target={} observer={state}", read());
                assert_eq!(state["active"], true);
                assert_eq!(state["key_window"], true);
                assert_eq!(state["target_ahead"], false);
                assert_eq!(frontmost_pid_macos(), foreground);
            }
            let observed = read();
            assert_eq!(observed["button_actions"], 1);
            assert_eq!(observed["field_text"], "native-control");
            assert!(observed["events"]
                .as_array()
                .unwrap()
                .iter()
                .all(|e| e["outside_frame"] == true && e["hit"] == "none"));
            // Ordinary canvas now receives its first requested click. It must
            // not leave the previous text field as the effective input target.
            let canvas = &initial["targets"]["canvas"];
            let (cx, cy) = (canvas[0].as_f64().unwrap(), canvas[1].as_f64().unwrap());
            bg_click(pid, (cx, cy), BgMouseButton::Left, 1, &[]).unwrap();
            thread::sleep(Duration::from_millis(120));
            assert_eq!(
                read()["canvas_downs"],
                1,
                "the first canvas click must be delivered exactly once"
            );
            assert!(
                !super::super::macos_ax_dump::focused_text_target_mismatch(pid, cx, cy).unwrap(),
                "the canvas click must not retain the previous text field focus"
            );
            assert_eq!(read()["field_text"], "native-control");
            super::super::control_session::stop(
                Some("native-controls-fixture"),
                "fixture complete",
            )
            .unwrap();
            drop(lease);
            return;
        }
        for (name, text) in [
            ("canvas", "canvas"),
            ("button", ""),
            ("field", "native-control"),
            ("table", ""),
        ] {
            let p = &initial["targets"][name];
            bg_click(
                pid,
                (p[0].as_f64().unwrap(), p[1].as_f64().unwrap()),
                BgMouseButton::Left,
                1,
                &[],
            )
            .unwrap();
            thread::sleep(Duration::from_millis(150));
            if !text.is_empty() {
                bg_type_text(pid, text).unwrap();
            }
            thread::sleep(Duration::from_millis(150));
            eprintln!("controls stage {name}: {}", read());
            assert_eq!(
                frontmost_pid_macos(),
                foreground,
                "{name} stole foreground focus"
            );
            if let Ok(path) = std::env::var("BITFUN_INPUT_OBSERVER_RESULT") {
                let state: serde_json::Value =
                    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
                assert_eq!(
                    state["active"], true,
                    "{name} deactivated the foreground application"
                );
                assert_eq!(
                    state["key_window"], true,
                    "{name} removed the foreground key window"
                );
                eprintln!("after {name} observer: {state}");
                raised |= state["target_ahead"] == true;
            }
        }
        bg_key_chord(pid, &[BgModifier::Command, BgModifier::Shift], 40).unwrap();
        thread::sleep(Duration::from_millis(100));
        let observed = read();
        assert_eq!(
            observed["shortcut_actions"], 1,
            "background menu shortcut must execute exactly once: {observed}"
        );
        super::super::control_session::stop(Some("native-controls-fixture"), "fixture complete")
            .unwrap();
        drop(lease);
        assert_eq!(
            observed["canvas_command_downs"], 0,
            "ordinary canvas click must preserve its modifier flags"
        );
        assert_eq!(
            observed["selected_count"], 1,
            "ordinary click must not become Command multi-select: {observed}"
        );
        assert_eq!(
            observed["selected_row"], 1,
            "ordinary click must select the requested row: {observed}"
        );
        assert_eq!(
            observed["button_actions"], 1,
            "standard button must activate exactly once: {observed}"
        );
        assert_eq!(
            observed["field_text"], "native-control",
            "standard text field focus and typing: {observed}"
        );
        assert_eq!(
            observed["canvas_downs"], 1,
            "plain canvas must receive one click: {observed}"
        );
        assert_eq!(
            observed["canvas_text"], "canvas",
            "plain canvas must receive its own input: {observed}"
        );
        assert!(
            !raised,
            "capture/input raised the target above the foreground observer"
        );
    }

    #[test]
    fn parse_key_spec_command_shift_p() {
        let (mods, key) = parse_key_spec("command+shift+p").unwrap();
        assert_eq!(mods, vec![BgModifier::Command, BgModifier::Shift]);
        assert_eq!(key, 35);
    }

    #[test]
    fn parse_key_spec_named_return() {
        let (mods, key) = parse_key_spec("return").unwrap();
        assert!(mods.is_empty());
        assert_eq!(key, 36);
    }

    #[test]
    fn parse_key_spec_aliases() {
        let (mods, _) = parse_key_spec("cmd+opt+a").unwrap();
        assert_eq!(mods, vec![BgModifier::Command, BgModifier::Option]);
    }

    #[test]
    fn parse_key_sequence_array_chord() {
        let keys = vec!["command".to_string(), "shift".to_string(), "p".to_string()];
        let (mods, key) = parse_key_sequence(&keys).unwrap();
        assert_eq!(mods, vec![BgModifier::Command, BgModifier::Shift]);
        assert_eq!(key, 35);
    }

    #[test]
    fn parse_key_sequence_single_plus_spec() {
        let keys = vec!["command+f".to_string()];
        let (mods, key) = parse_key_sequence(&keys).unwrap();
        assert_eq!(mods, vec![BgModifier::Command]);
        assert_eq!(key, 3);
    }

    #[test]
    fn modifier_from_str_aliases() {
        assert_eq!(BgModifier::from_str("CMD"), Some(BgModifier::Command));
        assert_eq!(BgModifier::from_str("control"), Some(BgModifier::Control));
        assert_eq!(BgModifier::from_str("alt"), Some(BgModifier::Option));
        assert_eq!(BgModifier::from_str("fn"), Some(BgModifier::Fn));
        assert_eq!(BgModifier::from_str("zzz"), None);
    }

    #[test]
    fn flags_from_combines() {
        let f = flags_from(&[BgModifier::Command, BgModifier::Shift]);
        assert!(f.contains(CGEventFlags::CGEventFlagCommand));
        assert!(f.contains(CGEventFlags::CGEventFlagShift));
        assert!(!f.contains(CGEventFlags::CGEventFlagControl));
    }

    #[test]
    fn fn_modifier_flag_and_keycode() {
        assert_eq!(BgModifier::Fn.flag(), CGEventFlags::CGEventFlagSecondaryFn);
        assert_eq!(BgModifier::Fn.keycode(), 63);
    }
}
