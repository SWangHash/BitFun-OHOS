//! OpenHarmony adapter modules.
//!
//! This directory is maintained on the OHOS product branches and is absent from
//! the upstream repository. Do not delete or replace it while resolving an
//! `upstream/main` merge; `origin/release/2.0.x` is the reference implementation.

pub mod app_market;
pub mod browser;
#[cfg(target_env = "ohos")]
pub mod miniapp_window;
#[cfg(target_env = "ohos")]
pub mod feedback_credentials;
pub mod ohos_file_system;
#[cfg(target_env = "ohos")]
pub mod pet_window;
#[cfg(target_env = "ohos")]
pub mod screen_capture;
#[cfg(target_env = "ohos")]
pub mod secure_credentials;
#[cfg(target_env = "ohos")]
pub mod telemetry_authorizer;
pub mod update;
pub mod window;
