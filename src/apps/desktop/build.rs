fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/computer_use/macos_capture.m");
        cc::Build::new()
            .file("src/computer_use/macos_capture.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("computer_use_capture");
        // Older macOS installs must reach the runtime unsupported-version guard.
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
        for framework in ["CoreMedia", "CoreVideo", "CoreImage", "AppKit"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
        println!("cargo:rerun-if-env-changed=BITFUN_RELEASE_CHANNEL");
    println!("cargo:rerun-if-env-changed=BITFUN_DESKTOP_BINARY_NAME");
    println!("cargo:rerun-if-env-changed=BITFUN_DATA_MIGRATOR_BINARY_NAME");
    println!("cargo:rerun-if-env-changed=BITFUN_UPDATER_PRIMARY_ENDPOINT");
    println!("cargo:rerun-if-env-changed=BITFUN_UPDATER_FALLBACK_ENDPOINT");
    // The Windows primary thread keeps the Tauri event loop and native window
    // creation stack. Reserve the same headroom as the Tokio workers so a
    // large debug invoke dispatcher cannot exhaust the default 1 MiB stack.
    // Build scripts run on the host, so `cfg!(target_os = "windows")` is true
    // even when Windows is cross-compiling the app for OpenHarmony. Use the
    // Cargo target metadata to keep this MSVC linker flag off non-Windows
    // targets.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        println!("cargo:rustc-link-arg-bins=/STACK:8388608");
    }
    // The layered drag receiver requires the compatibility declaration in
    // windows-app.manifest; tauri-build applies Windows attributes only for
    // Windows targets, so this is inert while cross-compiling for OpenHarmony.
    println!("cargo:rerun-if-changed=windows-app.manifest");
    let windows =
        tauri_build::WindowsAttributes::new().app_manifest(include_str!("windows-app.manifest"));
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to build desktop platform resources");
}
