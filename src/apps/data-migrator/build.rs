fn main() {
    for name in [
        "BITFUN_RELEASE_CHANNEL",
        "BITFUN_PRODUCT_ID",
        "BITFUN_DESKTOP_BINARY_NAME",
        "BITFUN_DATA_MIGRATOR_BINARY_NAME",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    tauri_build::build();
}
