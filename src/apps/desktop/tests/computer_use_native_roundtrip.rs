// An actual main-thread run loop is required by the production host dispatcher.
// libtest runs tests on worker threads and cannot provide this contract.
#[cfg(target_os = "macos")]
fn main() {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};
    if std::env::var_os("BITFUN_ROUNDTRIP_FIXTURE_PID").is_none()
        && std::env::var_os("BITFUN_INPUT_FIXTURE_PID").is_none()
    {
        eprintln!(
            "Run node scripts/test-macos-control-roundtrip.mjs to launch the isolated fixture"
        );
        std::process::exit(2);
    }
    unsafe extern "C" {
        static kCFRunLoopDefaultMode: *const std::ffi::c_void;
        fn CFRunLoopRunInMode(
            mode: *const std::ffi::c_void,
            seconds: f64,
            return_after_source: bool,
        ) -> i32;
    }
    let (sender, receiver) = mpsc::channel();
    let app: *mut objc2::runtime::AnyObject =
        unsafe { objc2::msg_send![objc2::class!(NSApplication), sharedApplication] };
    let _: bool = unsafe { objc2::msg_send![app, setActivationPolicy: 2isize] };
    if let Some(path) = std::env::var_os("BITFUN_INPUT_HOST_READY") {
        std::fs::write(path, b"ready").unwrap();
    }
    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .unwrap()
                .block_on(bitfun_desktop_lib::run_native_computer_use_roundtrip_fixture());
        });
        let _ = sender.send(result.is_ok());
    });
    let deadline = Instant::now() + Duration::from_secs(45);
    loop {
        match receiver.try_recv() {
            Ok(true) => return,
            Ok(false) | Err(mpsc::TryRecvError::Disconnected) => std::process::exit(1),
            Err(mpsc::TryRecvError::Empty) => {}
        }
        if Instant::now() >= deadline {
            eprintln!("FAIL native tool roundtrip exceeded 45 seconds while the real main run loop was active");
            std::process::exit(1);
        }
        unsafe {
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.01, true);
        }
        std::thread::sleep(Duration::from_millis(1));
    }
}
#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("Native Computer Use roundtrip requires macOS");
    std::process::exit(2);
}
