//! BitFun Matrix adapter: OpenHarmony Matrix market protocol translation and
//! skill ZIP install.
//!
//! This crate owns the Matrix skill-market HTTP endpoints
//! (`tags`, `skills`, `categories`, `organizations`, `install`, `checksum`),
//! DTO mapping, SHA-256 integrity verification, and atomic unzip-to-disk
//! install. It is intentionally self-contained: it does not depend on
//! `bitfun-core`, Tauri, or any app crate. See `AGENTS.md` in this crate's
//! root for scope and boundary rules.
//!
//! Public API surface:
//! - [`MatrixHttpClient`] — HTTP transport with safe defaults.
//! - [`list_tags`], [`list_skills`], [`list_categories`],
//!   [`list_organizations`], [`check_checksum`], [`install_skill`] —
//!   endpoint-specific operations.
//! - [`resolve_matrix_skills_root`] — cross-platform `~/.bitfun/skills/matrix/`
//!   resolution (used by `install_skill`).
//! - [`MatrixApiError`] / [`MatrixApiErrorKind`] — typed, serializable errors.
//! - Re-exports of all model DTOs from [`models`].

mod categories;
mod checksum;
mod client;
mod error;
mod install;
mod orgs;
pub mod models;
mod skills;
mod tags;

pub use categories::list_categories;
pub use checksum::check_checksum;
pub use client::MatrixHttpClient;
pub use error::{MatrixApiError, MatrixApiErrorKind};
pub use install::{install_skill, install_skill_to_root, resolve_matrix_skills_root};
pub use models::*;
pub use orgs::list_organizations;
pub use skills::list_skills;
pub use tags::list_tags;
