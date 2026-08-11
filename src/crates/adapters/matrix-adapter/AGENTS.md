# Matrix Adapter Instructions

- This crate owns OpenHarmony Matrix market (`https://matrix.openharmony.cn/`)
  protocol translation and Matrix skill ZIP install for BitFun. It exposes
  `MatrixHttpClient`, the four Matrix skill-market HTTP endpoints
  (tags / skills / install / checksum), DTO mapping, SHA-256 integrity
  verification, and atomic unzip-to-disk install.
- Boundary rule: must not depend on `bitfun-core`, `bitfun-*` app crates,
  Tauri, or any host entrypoint. Keep this crate self-contained so it can be
  embedded by any BitFun surface that wants Matrix market access.
- This crate intentionally also owns concrete HTTP transport (a service-layer
  concern) instead of splitting into a separate `services-integrations/matrix`
  crate. The deviation is justified by the user requirement "代码尽量独立"
  (code should be as independent as possible): co-locating adapter + transport
  avoids cross-crate coupling while keeping the public API surface small.
  See `src/crates/adapters/AGENTS.md` and `spec/matrix-skill-market/plan.md`
  `Complexity Tracking` for the documented trade-off.
- HTTP safety invariants (mirrors BitFun `ReviewHttpClient`): 25 s timeout,
  same-origin redirect with at most 5 hops, bounded response body (16 MiB JSON,
  8 KiB error), `use_native_tls()`. Base URL is overridable via the
  `MATRIX_API_URL` environment variable (default
  `https://matrix.openharmony.cn/`).
- ZIP install safety: every entry is checked for path traversal (reject
  `/`-prefix, `..` segments, and resolution outside the staging directory) and
  symlink entries are rejected. Install uses staging directory + atomic rename
  (mirrors BitFun `builtin.rs` pattern); staging is cleaned up on every error
  path so half-completed installs never pollute the SkillRegistry scan.
- Returned errors are typed (`MatrixApiError` with a `MatrixApiErrorKind`
  variant) and implement `serde::Serialize` so Tauri commands can return them
  directly to the frontend.
- SkillRegistry integration is owned by `bitfun-agent-runtime`'s
  `USER_HOME_SKILL_ROOTS` (a new `SkillRootSpec` entry with `source_id =
  "matrix"`, `slot = "bitfun"`); this crate only writes the install files.
  Matrix skills are installable but not deletable via the existing
  `delete_skill` Tauri command in this iteration (see `spec.md` Open
  Questions).
- See `src/crates/adapters/AGENTS.md` for layer-wide placement and dependency
  boundary rules.
