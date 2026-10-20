//! Session-lived, non-activating Windows pointer feedback. Never moves the user's
//! cursor. Feedback is only drawn over the target's currently visible pixels;
//! occluded/background targets are represented in the controller preview.
#![cfg(target_os = "windows")]

use std::ffi::c_void;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

type Handle = *mut c_void;
#[repr(C)]
#[derive(Default)]
struct Rect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}
#[repr(C)]
struct Point {
    x: i32,
    y: i32,
}

#[link(name = "user32")]
unsafe extern "system" {
    fn CreateWindowExW(
        ex: u32,
        class: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        parent: Handle,
        menu: Handle,
        instance: Handle,
        param: Handle,
    ) -> Handle;
    fn DestroyWindow(window: Handle) -> i32;
    fn GetWindowRect(window: Handle, rect: *mut Rect) -> i32;
    fn IsWindow(window: Handle) -> i32;
    fn SetWindowPos(
        window: Handle,
        after: Handle,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        flags: u32,
    ) -> i32;
    fn ShowWindow(window: Handle, command: i32) -> i32;
    fn UpdateLayeredWindow(
        window: Handle,
        dst_dc: Handle,
        position: *const Point,
        size: *const Size,
        src_dc: Handle,
        origin: *const Point,
        key: u32,
        blend: *const Blend,
        flags: u32,
    ) -> i32;
    fn GetDC(window: Handle) -> Handle;
    fn ReleaseDC(window: Handle, dc: Handle) -> i32;
    fn GetForegroundWindow() -> Handle;
    fn WindowFromPoint(point: Point) -> Handle;
    fn GetAncestor(window: Handle, flags: u32) -> Handle;

}
#[repr(C)]
struct Size {
    width: i32,
    height: i32,
}
#[repr(C)]
struct Blend {
    operation: u8,
    flags: u8,
    alpha: u8,
    format: u8,
}
#[repr(C)]
struct BitmapHeader {
    size: u32,
    width: i32,
    height: i32,
    planes: u16,
    bit_count: u16,
    compression: u32,
    size_image: u32,
    x_pixels: i32,
    y_pixels: i32,
    colors_used: u32,
    colors_important: u32,
}
#[repr(C)]
struct BitmapInfo {
    header: BitmapHeader,
    colors: [u32; 1],
}
#[link(name = "gdi32")]
unsafe extern "system" {
    fn CreateCompatibleDC(dc: Handle) -> Handle;
    fn DeleteDC(dc: Handle) -> i32;
    fn CreateDIBSection(
        dc: Handle,
        info: *const BitmapInfo,
        usage: u32,
        bits: *mut *mut c_void,
        section: Handle,
        offset: u32,
    ) -> Handle;
    fn SelectObject(dc: Handle, object: Handle) -> Handle;
    fn DeleteObject(object: Handle) -> i32;
}

// Rasterize the shared 40x40 cubic contour at four samples per axis. Alpha is
// premultiplied for AC_SRC_ALPHA: black shadow pixels retain alpha, unlike a
// color-key surface. The blur is independent of the solid, unstroked arrow.
fn pointer_pixels(clicked: bool) -> Vec<u32> {
    type P = (f64, f64);
    fn cubic(points: &mut Vec<P>, a: P, b: P, c: P, d: P) {
        for step in 1..=16 {
            let t = f64::from(step) / 16.0;
            let u = 1.0 - t;
            points.push((
                u * u * u * a.0 + 3.0 * u * u * t * b.0 + 3.0 * u * t * t * c.0 + t * t * t * d.0,
                u * u * u * a.1 + 3.0 * u * u * t * b.1 + 3.0 * u * t * t * c.1 + t * t * t * d.1,
            ));
        }
    }
    let mut outline = vec![(8.0, 8.0)];
    cubic(
        &mut outline,
        (8.0, 8.0),
        (6.0, 10.0),
        (7.0, 12.0),
        (8.0, 15.0),
    );
    outline.push((14.0, 31.0));
    cubic(
        &mut outline,
        (14.0, 31.0),
        (15.5, 35.0),
        (19.0, 35.0),
        (20.5, 31.5),
    );
    outline.push((23.0, 26.0));
    cubic(
        &mut outline,
        (23.0, 26.0),
        (23.6, 24.5),
        (24.5, 23.6),
        (26.0, 23.0),
    );
    outline.push((31.5, 20.5));
    cubic(
        &mut outline,
        (31.5, 20.5),
        (35.0, 19.0),
        (35.0, 15.5),
        (31.0, 14.0),
    );
    outline.push((15.0, 8.0));
    cubic(
        &mut outline,
        (15.0, 8.0),
        (12.0, 7.0),
        (10.0, 6.0),
        (8.0, 8.0),
    );
    let mut mask = vec![0.0; 1600];
    for y in 0..40 {
        for x in 0..40 {
            let mut coverage = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    let px = x as f64 + (f64::from(sx) + 0.5) / 4.0;
                    let py = y as f64 + (f64::from(sy) + 0.5) / 4.0;
                    let mut inside = false;
                    for edge in outline.windows(2) {
                        let (a, b) = (edge[0], edge[1]);
                        if (a.1 > py) != (b.1 > py)
                            && px < (b.0 - a.0) * (py - a.1) / (b.1 - a.1) + a.0
                        {
                            inside = !inside;
                        }
                    }
                    if inside {
                        coverage += 1;
                    }
                }
            }
            mask[y * 40 + x] = f64::from(coverage) / 16.0;
        }
    }
    let weights: Vec<f64> = (-5..=5)
        .map(|n| (-(f64::from(n).powi(2)) / (2.0 * 1.5 * 1.5)).exp())
        .collect();
    let sum: f64 = weights.iter().sum();
    let mut pixels = vec![0u32; 1600];
    for y in 0..40i32 {
        for x in 0..40i32 {
            let mut shadow = 0.0;
            for dy in -5..=5 {
                for dx in -5..=5 {
                    let (mx, my) = (x - dx, y - 2 - dy);
                    if (0..40).contains(&mx) && (0..40).contains(&my) {
                        shadow += mask[(my * 40 + mx) as usize]
                            * weights[(dx + 5) as usize]
                            * weights[(dy + 5) as usize]
                            / (sum * sum);
                    }
                }
            }
            let fill = mask[(y * 40 + x) as usize];
            let radius =
                ((f64::from(x) + 0.5 - 8.0).powi(2) + (f64::from(y) + 0.5 - 8.0).powi(2)).sqrt();
            let ring = if clicked {
                (1.0 - (radius - 6.5).abs()).clamp(0.0, 1.0) * 0.4
            } else {
                0.0
            };
            let behind = ring + shadow * 0.45 * (1.0 - ring);
            let alpha = fill + behind * (1.0 - fill);
            let channel = (166.0 * fill + 166.0 * ring * (1.0 - fill)).round() as u32;
            pixels[(y * 40 + x) as usize] =
                ((alpha * 255.0).round() as u32) << 24 | channel << 16 | channel << 8 | channel;
        }
    }
    pixels
}

unsafe fn present_pointer(window: Handle, pixels: &[u32]) -> bool {
    // SAFETY: all GDI handles are checked and released; the top-down 32-bit DIB
    // owns exactly 40*40 pixels and remains selected until UpdateLayeredWindow copies it.
    unsafe {
        let screen = GetDC(std::ptr::null_mut());
        let dc = CreateCompatibleDC(screen);
        if dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen);
            return false;
        }
        let info = BitmapInfo {
            header: BitmapHeader {
                size: 40,
                width: 40,
                height: -40,
                planes: 1,
                bit_count: 32,
                compression: 0,
                size_image: 6400,
                x_pixels: 0,
                y_pixels: 0,
                colors_used: 0,
                colors_important: 0,
            },
            colors: [0],
        };
        let mut bits = std::ptr::null_mut();
        let bitmap = CreateDIBSection(dc, &info, 0, &mut bits, std::ptr::null_mut(), 0);
        if bitmap.is_null() || bits.is_null() {
            if !bitmap.is_null() {
                DeleteObject(bitmap);
            }
            DeleteDC(dc);
            ReleaseDC(std::ptr::null_mut(), screen);
            return false;
        }
        let old = SelectObject(dc, bitmap);
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits.cast::<u32>(), 1600);
        let result = UpdateLayeredWindow(
            window,
            screen,
            std::ptr::null(),
            &Size {
                width: 40,
                height: 40,
            },
            dc,
            &Point { x: 0, y: 0 },
            0,
            &Blend {
                operation: 0,
                flags: 0,
                alpha: 255,
                format: 1,
            },
            2,
        ) != 0;
        SelectObject(dc, old);
        DeleteObject(bitmap);
        DeleteDC(dc);
        ReleaseDC(std::ptr::null_mut(), screen);
        result
    }
}

static GENERATION: AtomicU64 = AtomicU64::new(0);
static POINTER_BITMAPS: OnceLock<(Vec<u32>, Vec<u32>)> = OnceLock::new();

pub(super) fn hide_pointer() {
    GENERATION.fetch_add(1, Ordering::AcqRel);
}

/// Screen coordinates are physical pixels under the desktop PMv2 manifest.
/// Native feedback uses the shared rounded grey arrow and per-pixel shadow.
pub(super) fn show_pointer(target: usize, x: i32, y: i32, clicked: bool) {
    let generation = GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
    std::thread::spawn(move || unsafe {
        let target = target as Handle;
        if target.is_null()
            || GetAncestor(GetForegroundWindow(), 2) != GetAncestor(target, 2)
            || GetAncestor(WindowFromPoint(Point { x, y }), 2) != GetAncestor(target, 2)
        {
            return;
        }
        let mut original_bounds = Rect::default();
        if GetWindowRect(target, &mut original_bounds) == 0 {
            return;
        }
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        // TOOLWINDOW | NOACTIVATE | TRANSPARENT | LAYERED. This window is not
        // topmost and is shown without activating or attaching input queues.
        let window = CreateWindowExW(
            0x00000080 | 0x08000000 | 0x20 | 0x80000,
            class.as_ptr(),
            std::ptr::null(),
            0x80000000,
            x - 8,
            y - 8,
            40,
            40,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );
        if window.is_null() {
            return;
        }
        let (normal_pixels, click_pixels) =
            POINTER_BITMAPS.get_or_init(|| (pointer_pixels(false), pointer_pixels(true)));
        let mut click_visible = clicked;
        let click_until = Instant::now() + Duration::from_millis(200);
        let mut drawn = false;
        let mut was_visible = false;
        while GENERATION.load(Ordering::Acquire) == generation {
            // Keep ownership checks alive while the model is thinking, rather
            // than leaving an old overlay above the user's newly focused app.
            let mut bounds = Rect::default();
            if IsWindow(target) == 0 || GetWindowRect(target, &mut bounds) == 0 {
                break;
            }
            let px = x + bounds.left - original_bounds.left;
            let py = y + bounds.top - original_bounds.top;
            SetWindowPos(
                window,
                std::ptr::null_mut(),
                px - 8,
                py - 8,
                40,
                40,
                0x4 | 0x10,
            ); // NOZORDER | NOACTIVATE
            let visible = GetAncestor(GetForegroundWindow(), 2) == GetAncestor(target, 2)
                && px - 8 >= bounds.left
                && py - 8 >= bounds.top
                && px + 32 <= bounds.right
                && py + 32 <= bounds.bottom;
            if visible != was_visible {
                ShowWindow(window, if visible { 4 } else { 0 });
                drawn = false;
                was_visible = visible;
            }
            let next_click = clicked && Instant::now() < click_until;
            if visible && (!drawn || next_click != click_visible) {
                click_visible = next_click;
                drawn = present_pointer(
                    window,
                    if click_visible {
                        &click_pixels
                    } else {
                        &normal_pixels
                    },
                );
            }
            std::thread::sleep(Duration::from_millis(if next_click { 32 } else { 100 }));
        }
        DestroyWindow(window);
    });
}

#[cfg(test)]
mod tests {
    use super::pointer_pixels;
    #[test]
    fn rounded_cursor_has_grey_fill_and_translucent_black_shadow() {
        let pixels = pointer_pixels(false);
        assert_eq!(pixels.len(), 1600);
        assert_eq!(pixels[16 * 40 + 16], 0xffa6a6a6);
        assert!(pixels
            .iter()
            .any(|p| p & 0xffffff == 0 && p >> 24 > 0 && p >> 24 < 115));
        assert!(pixels.iter().all(|p| p & 255 <= p >> 24));
        assert_eq!(pixels[0], 0);
        assert_ne!(pixels, pointer_pixels(true));
    }
}
