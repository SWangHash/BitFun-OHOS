fn main() {
    println!("cargo:rerun-if-env-changed=BITFUN_RELEASE_CHANNEL");
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
    tauri_build::build();
}
