//! Persistent Windows.Graphics.Capture window streams, with OS capture border.
//! Native resources and COM apartment lifetime remain on one worker thread.
//! Requires Windows 10 1903+; unsupported/closed targets fail explicitly.

#![allow(dead_code)]

use bitfun_core::util::errors::{BitFunError, BitFunResult};
use std::time::{Duration, Instant};
use windows::core::Interface;
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Win32::Foundation::{HMODULE, HWND};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_WARP};
use windows::Win32::Graphics::Direct3D11::{
    D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D, D3D11_CPU_ACCESS_READ,
    D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
};
use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM;
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::WinRT::Direct3D11::CreateDirect3D11DeviceFromDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::IDirect3DDxgiInterfaceAccess;
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;

/// A live window-only capture. The owner must retain this object for the whole
/// control session and drop/stop it when control stops. The OS capture border
/// is deliberately left enabled; desktop pixels are never substituted.
pub(super) struct WgcCaptureSession {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    direct_device: IDirect3DDevice,
    item: GraphicsCaptureItem,
    pool: Direct3D11CaptureFramePool,
    session: windows::Graphics::Capture::GraphicsCaptureSession,
    size: windows::Graphics::SizeInt32,
    stopped: bool,
    closed: std::sync::Arc<std::sync::atomic::AtomicBool>,
    closed_token: i64,
}

impl WgcCaptureSession {
    pub(super) fn start(hwnd: HWND) -> BitFunResult<Self> {
        if hwnd.is_invalid() {
            return Err(BitFunError::service("WGC capture: invalid HWND"));
        }
        unsafe {
            let (device, context) = create_d3d11_device()?;
            let direct_device = create_winrt_d3d_device(&device)?;
            let interop =
                windows::core::factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()
                    .map_err(|e| BitFunError::service(format!("WGC factory: {e}")))?;
            let item: GraphicsCaptureItem = interop
                .CreateForWindow(hwnd)
                .map_err(|e| BitFunError::service(format!("WGC CreateForWindow: {e}")))?;
            let size = item
                .Size()
                .map_err(|e| BitFunError::service(format!("WGC size: {e}")))?;
            if size.Width <= 0 || size.Height <= 0 {
                return Err(BitFunError::service(
                    "WGC target has no rendered content",
                ));
            }
            let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
                &direct_device,
                DirectXPixelFormat::B8G8R8A8UIntNormalized,
                2,
                size,
            )
            .map_err(|e| BitFunError::service(format!("WGC frame pool: {e}")))?;
            let session = match pool.CreateCaptureSession(&item) {
                Ok(session) => session,
                Err(e) => {
                    let _ = pool.Close();
                    return Err(BitFunError::service(format!("WGC session: {e}")));
                }
            };
            // Cursor control arrived after WGC itself. On older systems this
            // optional setting may be unavailable; no borderless access is requested.
            let _ = session.SetIsCursorCaptureEnabled(false);
            if let Err(e) = session.StartCapture() {
                let _ = session.Close();
                let _ = pool.Close();
                return Err(BitFunError::service(format!("WGC start: {e}")));
            }
            let closed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let signal = closed.clone();
            let generation = crate::computer_use::control_session::capture_token()
                .map_err(BitFunError::service)?
                .generation();
            let mut pid = 0;
            windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let target = format!("pid:{pid}/window:{}", hwnd.0 as isize);
            let closed_token = item
                .Closed(&windows::Foundation::TypedEventHandler::new(move |_, _| {
                    signal.store(true, std::sync::atomic::Ordering::Release);
                    crate::computer_use::control_session::native_stopped_target(
                        generation,
                        &target,
                        "target_closed",
                    );
                    Ok(())
                }))
                .map_err(|e| {
                    let _ = session.Close();
                    let _ = pool.Close();
                    BitFunError::service(format!("WGC Closed handler: {e}"))
                })?;
            Ok(Self {
                device,
                context,
                direct_device,
                item,
                pool,
                session,
                size,
                stopped: false,
                closed,
                closed_token,
            })
        }
    }

    pub(super) fn stop(&mut self) {
        if !self.stopped {
            self.stopped = true;
            let _ = self.item.RemoveClosed(self.closed_token);
            let _ = self.session.Close();
            let _ = self.pool.Close();
        }
    }

    fn ensure_live(&self) -> BitFunResult<()> {
        if self.stopped || self.closed.load(std::sync::atomic::Ordering::Acquire) {
            return Err(BitFunError::service("WGC capture session stopped"));
        }
        let size = self
            .item
            .Size()
            .map_err(|e| BitFunError::service(format!("WGC target unavailable: {e}")))?;
        if size.Width <= 0 || size.Height <= 0 {
            return Err(BitFunError::service(
                "WGC target has no rendered content",
            ));
        }
        Ok(())
    }

    pub(super) fn capture(&mut self) -> BitFunResult<(Vec<u8>, u32, u32)> {
        if self.stopped || self.closed.load(std::sync::atomic::Ordering::Acquire) {
            return Err(BitFunError::service("WGC capture session stopped"));
        }
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Ok(mut frame) = self.pool.TryGetNextFrame() {
                // A long-lived pool may still contain observations queued
                // before the latest input. Consume all immediately available
                // frames and copy only the newest. Keep this frame when the
                // queue is empty: static windows need not emit another frame.
                // This improves recency, but is not proof of input processing.
                while let Ok(newer) = self.pool.TryGetNextFrame() {
                    let _ = frame.Close();
                    frame = newer;
                }
                let content = frame
                    .ContentSize()
                    .map_err(|e| BitFunError::service(format!("WGC content size: {e}")))?;
                if content.Width != self.size.Width || content.Height != self.size.Height {
                    let _ = frame.Close();
                    if content.Width <= 0 || content.Height <= 0 {
                        return Err(BitFunError::service(
                            "WGC target has no rendered content",
                        ));
                    }
                    self.pool
                        .Recreate(
                            &self.direct_device,
                            DirectXPixelFormat::B8G8R8A8UIntNormalized,
                            2,
                            content,
                        )
                        .map_err(|e| BitFunError::service(format!("WGC resize: {e}")))?;
                    self.size = content;
                    continue;
                }
                let result = unsafe { copy_frame_to_bgra(&frame, &self.device, &self.context) };
                let _ = frame.Close();
                return result;
            }
            if Instant::now() >= deadline {
                return Err(BitFunError::service(
                    "WGC frame unavailable: target may be closed, minimized or capture revoked",
                ));
            }
            std::thread::sleep(Duration::from_millis(16));
        }
    }
}

impl Drop for WgcCaptureSession {
    fn drop(&mut self) {
        self.stop();
    }
}

type CaptureResult = BitFunResult<(Vec<u8>, u32, u32)>;
enum CaptureCommand {
    Ensure(
        usize,
        crate::computer_use::control_session::ControlToken,
        std::sync::mpsc::SyncSender<BitFunResult<()>>,
    ),
    Capture(
        usize,
        crate::computer_use::control_session::ControlToken,
        std::sync::mpsc::SyncSender<CaptureResult>,
    ),
    Stop(std::sync::mpsc::SyncSender<()>),
}

// A generation change must not retain a prior owner's native capture session.
fn ensure_stream(
    active: &mut Option<(usize, u64, WgcCaptureSession)>,
    handle: usize,
    generation: u64,
) -> BitFunResult<&mut WgcCaptureSession> {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowThreadProcessId, IsIconic, IsWindow};
    crate::computer_use::control_session::capture_allowed().map_err(BitFunError::service)?;
    let hwnd = HWND(handle as *mut _);
    let mut pid = 0;
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() || IsIconic(hwnd).as_bool() {
            return Err(BitFunError::service(
                "capture_unavailable: target closed or minimized",
            ));
        }
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
    }
    crate::computer_use::control_session::target_allowed(&format!(
        "pid:{pid}/window:{}",
        handle as isize
    ))
    .map_err(BitFunError::service)?;
    if active.as_ref().map(|(id, owner, _)| (*id, *owner)) != Some((handle, generation)) {
        *active = None;
        *active = Some((handle, generation, WgcCaptureSession::start(hwnd)?));
    }
    let stream = &mut active.as_mut().expect("capture initialized").2;
    stream.ensure_live()?;
    Ok(stream)
}

// All COM initialization, interfaces and D3D immediate-context calls stay on
// this dedicated worker. The registry only contains a thread-safe sender.
fn capture_worker() -> &'static std::sync::mpsc::Sender<CaptureCommand> {
    static WORKER: std::sync::OnceLock<std::sync::mpsc::Sender<CaptureCommand>> =
        std::sync::OnceLock::new();
    WORKER.get_or_init(|| {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let initialized = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
            let mut active: Option<(usize, u64, WgcCaptureSession)> = None;
            while let Ok(command) = rx.recv() {
                match command {
                    CaptureCommand::Stop(reply) => {
                        active = None;
                        let _ = reply.send(());
                    }
                    CaptureCommand::Ensure(handle, token, reply) => {
                        let result =
                            crate::computer_use::control_session::with_token(token, || {
                                ensure_stream(&mut active, handle, token.generation()).map(|_| ())
                            });
                        if result.is_err() {
                            active = None;
                        }
                        let _ = reply.send(result);
                    }
                    CaptureCommand::Capture(handle, token, reply) => {
                        let result =
                            crate::computer_use::control_session::with_token(token, || {
                                ensure_stream(&mut active, handle, token.generation())?.capture()
                            });
                        if result.is_err() {
                            active = None;
                        }
                        let _ = reply.send(result);
                    }
                }
            }
            drop(active);
            if initialized {
                unsafe { windows::Win32::System::Com::CoUninitialize() };
            }
        });
        tx
    })
}

pub(super) fn stop_capture() {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    if capture_worker().send(CaptureCommand::Stop(tx)).is_ok() {
        let _ = rx.recv_timeout(Duration::from_secs(3));
    }
}

/// Establish/validate the authorized stream without consuming a frame, GPU
/// readback, or image encoding. Actual observation still validates frame delivery.
pub(super) fn ensure_window_capture(hwnd: HWND) -> BitFunResult<()> {
    let token =
        crate::computer_use::control_session::capture_token().map_err(BitFunError::service)?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    capture_worker()
        .send(CaptureCommand::Ensure(hwnd.0 as usize, token, tx))
        .map_err(|_| BitFunError::service("WGC worker unavailable"))?;
    rx.recv()
        .map_err(|_| BitFunError::service("WGC worker stopped"))?
}

/// Reuses the one window stream until the control owner stops or retargets it.
pub(super) fn capture_window_bgra(hwnd: HWND) -> CaptureResult {
    crate::computer_use::control_session::capture_allowed().map_err(BitFunError::service)?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    capture_worker()
        .send(CaptureCommand::Capture(
            hwnd.0 as usize,
            crate::computer_use::control_session::capture_token()
                .map_err(BitFunError::service)?,
            tx,
        ))
        .map_err(|_| BitFunError::service("WGC worker unavailable"))?;
    rx.recv()
        .map_err(|_| BitFunError::service("WGC worker stopped"))?
}

unsafe fn create_d3d11_device() -> BitFunResult<(ID3D11Device, ID3D11DeviceContext)> {
    let mut device: Option<ID3D11Device> = None;
    let mut context: Option<ID3D11DeviceContext> = None;
    let flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;

    // SAFETY: output pointers reference live `Option` slots, and all remaining
    // arguments are documented D3D11 constants or null/default handles.
    if unsafe {
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            flags,
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )
    }
    .is_err()
    {
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_WARP,
                HMODULE::default(),
                flags,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )
        }
        .map_err(|e| BitFunError::service(format!("D3D11CreateDevice (WARP): {e}")))?;
    }

    let device = device.ok_or_else(|| {
        BitFunError::service("D3D11CreateDevice returned null device".to_string())
    })?;
    let context = context.ok_or_else(|| {
        BitFunError::service("D3D11CreateDevice returned null context".to_string())
    })?;
    Ok((device, context))
}

unsafe fn create_winrt_d3d_device(d3d_device: &ID3D11Device) -> BitFunResult<IDirect3DDevice> {
    let dxgi_device: IDXGIDevice = d3d_device
        .cast()
        .map_err(|e| BitFunError::service(format!("IDXGIDevice cast: {e}")))?;
    // SAFETY: `dxgi_device` is a live COM interface obtained from the supplied
    // D3D11 device and remains alive through the conversion call.
    let inspectable =
        unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi_device) }.map_err(|e| {
            BitFunError::service(format!("CreateDirect3D11DeviceFromDXGIDevice: {e}"))
        })?;
    inspectable
        .cast()
        .map_err(|e| BitFunError::service(format!("IDirect3DDevice cast: {e}")))
}

unsafe fn copy_frame_to_bgra(
    frame: &windows::Graphics::Capture::Direct3D11CaptureFrame,
    d3d_device: &ID3D11Device,
    d3d_context: &ID3D11DeviceContext,
) -> BitFunResult<(Vec<u8>, u32, u32)> {
    let surface = frame
        .Surface()
        .map_err(|e| BitFunError::service(format!("WGC frame Surface: {e}")))?;
    let access: IDirect3DDxgiInterfaceAccess = surface
        .cast()
        .map_err(|e| BitFunError::service(format!("IDirect3DDxgiInterfaceAccess cast: {e}")))?;
    // SAFETY: `access` is the live DXGI interface for `surface`; the requested
    // interface type matches the WGC frame surface contract.
    let src_texture: ID3D11Texture2D = unsafe { access.GetInterface::<ID3D11Texture2D>() }
        .map_err(|e| BitFunError::service(format!("GetInterface ID3D11Texture2D: {e}")))?;

    let mut desc = D3D11_TEXTURE2D_DESC::default();
    unsafe { src_texture.GetDesc(&mut desc) };
    let content = frame
        .ContentSize()
        .map_err(|e| BitFunError::service(format!("WGC content size: {e}")))?;
    if content.Width <= 0
        || content.Height <= 0
        || content.Width as u32 > desc.Width
        || content.Height as u32 > desc.Height
    {
        return Err(BitFunError::service(
            "WGC frame geometry changed; retry observation",
        ));
    }
    let width = content.Width as u32;
    let height = content.Height as u32;
    if width == 0 || height == 0 {
        return Err(BitFunError::service(
            "WGC frame texture has zero dimensions".to_string(),
        ));
    }

    let staging_desc = D3D11_TEXTURE2D_DESC {
        Width: desc.Width,
        Height: desc.Height,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: desc.SampleDesc,
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
    };
    let mut staging: Option<ID3D11Texture2D> = None;
    // SAFETY: `staging_desc` is fully initialized and `staging` is a live
    // output slot for the newly created texture interface.
    unsafe { d3d_device.CreateTexture2D(&staging_desc, None, Some(&mut staging)) }
        .map_err(|e| BitFunError::service(format!("CreateTexture2D staging: {e}")))?;
    let staging = staging.ok_or_else(|| {
        BitFunError::service("CreateTexture2D returned null staging texture".to_string())
    })?;

    unsafe { d3d_context.CopyResource(&staging, &src_texture) };

    let mut mapped = windows::Win32::Graphics::Direct3D11::D3D11_MAPPED_SUBRESOURCE::default();
    unsafe { d3d_context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }
        .map_err(|e| BitFunError::service(format!("Map staging texture: {e}")))?;

    let row_pitch = mapped.RowPitch as usize;
    let width_bytes = (width as usize) * 4;
    if mapped.pData.is_null() || row_pitch < width_bytes {
        unsafe { d3d_context.Unmap(&staging, 0) };
        return Err(BitFunError::service("WGC invalid mapped surface"));
    }
    let mut pixels = vec![0u8; (width as usize) * (height as usize) * 4];
    let src = mapped.pData as *const u8;
    // SAFETY: a successful `Map` exposes `height` rows at `pData`, each with
    // at least `width * 4` readable bytes according to `RowPitch`. Destination
    // rows are disjoint slices of the fully allocated `pixels` buffer.
    for y in 0..height as usize {
        let src_row = unsafe { src.add(y * row_pitch) };
        let dst_row = unsafe { pixels.as_mut_ptr().add(y * width_bytes) };
        unsafe { std::ptr::copy_nonoverlapping(src_row, dst_row, width_bytes) };
    }

    unsafe { d3d_context.Unmap(&staging, 0) };

    Ok((pixels, width, height))
}

const D3D11_SDK_VERSION: u32 = 7;
