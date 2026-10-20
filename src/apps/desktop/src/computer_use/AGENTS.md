# Computer Use (desktop host)

## Scope

Platform-specific automation for the unified `computer_use` tool lives under
`src/apps/desktop/src/computer_use/`. Shared contracts and tool orchestration
are in `src/crates/assembly/core` and `src/crates/execution/tool-contracts`.

## Platform maturity

| Platform | Tier | Capabilities |
|---|---|---|
| **macOS** | AX-first | Accessibility tree, directed background input, persistent ScreenCaptureKit window capture, menu shortcuts, interactive/visual views |
| **Windows** | AX-first | UI Automation patterns/tree, persistent WGC window capture, MSAA observation for legacy VCL, targeted message input |
| **Linux** | Portal + AT-SPI | Consented PipeWire capture, foreground portal input, background semantic activation and EditableText, AT-SPI application trees |

### Ubuntu / Linux control

Wayland capture and seat input use one xdg-desktop-portal session. Never use an
XWayland `DISPLAY` as evidence that X11 desktop input is supported. Portal denial,
revocation, missing plugins, and stream geometry changes fail explicitly; they
must not trigger X11 input or whole-desktop capture fallback. GStreamer consumes
the portal's authorized PipeWire FD, not a default unrestricted connection.

AT-SPI provides `list_apps`, `get_app_state`, `app_click` with a cached `NodeIdx`,
and `app_type_text` with an explicit EditableText node. These semantic operations
do not change compositor focus. Arbitrary background coordinates, app-scoped key
chords, interactive/visual cached views, and menu shortcuts are unavailable.
Portal-selected pixels are not automatically attached to a PID-selected tree.

Run the real native portal fixture in the desktop user's Ubuntu session (requires
`python3-gi`, GTK 3, GStreamer PipeWire/base/good plugins and portal services):

```bash
cargo check --locked -p bitfun-desktop --tests
node scripts/test-linux-computer-use-native.mjs -- --test-threads=1
bash scripts/test-linux-computer-use-atspi.sh
bash scripts/test-linux-computer-use-portal.sh
```

Select only the dedicated **BitFun Portal Fixture** window. The fixture checks
real PipeWire frames, observation-only input rejection and stop revocation. It
does not prove foreground input delivery or remote behavior.
For headless AT-SPI verification, use
`dbus-run-session -- xvfb-run -a bash -lc 'export NO_AT_BRIDGE=0; bash scripts/test-linux-computer-use-atspi.sh'`.
The AT-SPI fixture checks one GTK button activation and UTF-8 EditableText insertion
while preserving existing text;
it does not establish compatibility with every application. Run the SPEC's
remaining native acceptance scenarios separately.

## Module map

- `desktop_host/` — `ComputerUseHost` trait impl; entry for all actions
- `control_session/admission.rs` — pure mode/owner/lease/start/stop state machine
- `control_session/sharing.rs`, `desktop_host/sharing.rs` — user-selected window, observe-first sharing and revocable input grant
- `permissions.rs`, `process_identity.rs`, `grants.rs`, `share_grants.rs` — explicit OS requests and executable-bound remembered preferences
- `desktop_host/shared_preview.rs` — scoped manual preview input through the same native host/lease as the Agent
- `desktop_host/background_guard.rs` — before/after desktop witnesses; no focus restoration or replay
- `desktop_host/observation.rs`, `observation_cache.rs` — observation identity and bounded screenshot geometry; never input authority
- `desktop_host/state.rs` — derived host feedback and view caches
- `macos_*` / `windows_*` — platform AX, capture, list-apps, shortcuts
- `windows_capture.rs` — WGC frame conversion and authoritative window bounds
- `windows_wgc_capture.rs` — Windows.Graphics.Capture (Direct3D11)
- `linux_ax_ui.rs` — AT-SPI locate
- `linux_control.rs` — portal lifetime, PipeWire frame consumption, foreground seat input
- `linux_control_ax.rs` — AT-SPI background semantic operations
- `linux_control_policy.rs` — pure session classification and keysym encoding
- `screen_ocr.rs`, `ui_locate_common.rs` — shared OCR/locate helpers

## Native capture boundaries

The implementation contract is [Computer Use control-session SPEC](../../../../../docs/architecture/computer-use-control.md).
macOS and Windows retain a real native single-window capture session. Never fall
back to desktop pixels when window capture fails or the target is obscured.
Background input must not activate a window or use the global input seat.

## Target-local macOS focus acceptance

The directed-input route can change a target application's internal
focus without changing the human foreground application. Its window-addressed
focus pair at local `(-8,-8)` must remain outside content; the requested gesture
must reach content exactly once with unchanged modifiers. Do not validate it
using a fixture that overrides `acceptsFirstMouse`. Record observer active/key,
frontmost PID, stacking order, real text destination and content event counts.
Do not use missing AX key-state attributes as a substitute for native focus
validation: fixtures inspect their own `NSWindow.keyWindow`. Preparation caches
must include generation, PID, window ID, human foreground identity and activation
epoch, and must not add app-name rules or content-coordinate guesses. An off-frame routing
position is distinct from the actual user-requested content target.
No after-action raise/restore is allowed. Stop may deactivate a target only when
it is not the user's actual foreground application. Prototype success is not
production acceptance; the complete native Tool pipeline must pass separately.
Mouse events use CombinedSessionState and explicit requested flags; keyboard
events retain a private source. Preserve field 58 as window-routing metadata,
not a click-group counter. Cleanup validates process-serial identity before
target deactivation; it does not require the original window to remain open.

## Verification

For observation payloads, OCR projection, AX filtering/digests, and browser
snapshot context, use the isolated compiler harness first. It compiles the
production Rust files by path, with the actual DTO source and no replacement
algorithms or native-host mocks. Cargo dependencies must already be cached
(`cargo fetch --locked` on a fresh machine).

```bash
node scripts/test-computer-use-context.mjs
cargo test -p bitfun-desktop --lib context_integrity_tests
```

Native black-box fixtures use only a dedicated test window / rendered image:

```bash
# Node 22/24 and installed workspace dependencies; installed Chrome required.
# CHROME_PATH can select another Chromium executable.
node scripts/test-browser-snapshot.mjs --native-ocr
# macOS + Accessibility permission; creates and closes its own AppKit window.
node scripts/test-native-ax-context.mjs
# macOS + Screen Recording permission; captures only its own obscured test window.
node scripts/test-macos-control-capture.mjs
# Locked-host rejection only; never wakes or unlocks the desktop.
node scripts/test-macos-control-capture.mjs --locked
# macOS passive cursor lifecycle; no capture or accessibility permission required.
node scripts/test-macos-control-pointer.mjs
# macOS + Accessibility and Screen Recording permissions; clicks only its dedicated fixture process.
node scripts/test-macos-directed-input.mjs
# Covered standard controls: exact native AX hit + semantic action + fresh capture.
node scripts/test-macos-input-controls.mjs --semantic
# Full Tool image-coordinate button activation/text focus and wrong-field guard.
# Target/observer have distinct app bundles; AppKit initializes before the
# foreground baseline. Activation history catches transient focus changes.
node scripts/test-macos-input-controls.mjs --orchestration
# Identical five-input sequence: five tool calls vs one batch, with default
# images and AX-only observations. Fresh isolated app/host per case.
node scripts/test-macos-input-controls.mjs --latency
# Diagnostic raw-pointer contract, including ordinary non-AX first click and
# unchanged modifiers/z-order. Both this raw runner and the full Tool five-action
# fixture passed; do not substitute a permissive first-click implementation.
node scripts/test-macos-input-controls.mjs
# Full Tool -> provider -> native loop on a dedicated window, with main-thread runloop.
node scripts/test-macos-control-roundtrip.mjs
```

The browser fixture runs production snapshot/resolver JavaScript in Chromium,
then passes the actual DOM payload to compiled Rust presentation tests. The
optional OCR step compiles the Desktop test target and invokes macOS Vision on
the rendered JPEG. The AX fixture compiles the Desktop test target and checks
native AX nodes, text, states, parent indices, cache entries, filtering, and DTO
round trips. These are local macOS checks, not Windows/Linux or remote evidence.

The latency fixture reports actual returned observations/images, AX node counts
and native tool wall time including one separately timed fixture JSON check.
It checks exact Unicode text, immediate shortcut delivery,
fresh AX-only node identities, recovery of default screenshot observations,
and the same foreground/cursor invariants as the orchestration fixture. It does
not invoke a model. Startup and cleanup are outside the reported measurement;
timings are diagnostic evidence, not machine-dependent pass/fail thresholds.
The native fixture requires an unlocked desktop; its read-only startup gate
reports a locked screen as inconclusive without waking or unlocking it.

Observation invariants:

- Rectangle containment does not prove two controls have the same action.
- Projection uses content padding and authoritative global bounds; invalid
  geometry and OCR matches outside the content are not actionable coordinates.
- AX snapshot digests cover state and geometry as well as labels. A state-only
  change must not be mistaken for a failed action and trigger duplicate input.
- Stale interactive/visual indices must be returned to the caller for a fresh
  choice, never silently reused after rebuilding a different view.
- Element-budget omissions are reported in `omitted_element_count`, including
  when text rendering is disabled; focused controls survive budget selection.

```bash
cargo test -p bitfun-desktop --lib computer_use
cargo build -p bitfun-desktop
```

Windows-only paths (`windows_wgc_capture`, UIA) compile on CI (`windows-latest`).
The isolated native-module harness compiles the production control owner, UIA,
MSAA, WGC and pointer modules. Its portable error-envelope adapter replaces no
native APIs or algorithms. Cross-compilation is type-checking, not Windows
execution; full Desktop compilation and native fixtures still belong on Windows.

```bash
# Native Windows: unit tests; native delivery fixtures remain opt-in/ignored.
node scripts/test-windows-computer-use-native.mjs
# Other hosts with the target installed: compile production native modules only.
node scripts/test-windows-computer-use-native.mjs --check --target x86_64-pc-windows-msvc
```

Observation IDs and target revisions are additive wire fields. Keep accepting
legacy payloads, advertise `observation-id-v1`, and reject explicit stale IDs
before input. New observations invalidate prior AX/view indices even when the
content digest is unchanged. Do not replace namespace identity with a digest.

Agent native fixtures must discover and address their target through production
tools without manual share selection or a separate input grant. Cover explicit
`start_control` and implicit first-action startup. Optional manual-share fixtures
exercise target inventory, observe-first capture and grants separately; they must
not hide an Agent regression by performing those UI steps in fixture setup.
Permission probes never prompt. Desktop-state witnesses record concurrent human
activity without revoking Agent control or replaying input.

The Web preview's deterministic cursor is verified against Rust-generated
`computer-use-rust` samples retained in the repository. The reference source is
not required to build or run tests. After preview, sharing or permission UI edits:

```bash
pnpm --dir src/web-ui run test:run src/app/components/ComputerUseControlCard.test.tsx src/app/components/computer-use src/infrastructure/api/adapters/peer-device-adapter.test.ts
```

These UI tests cover permission requests, stale device/grant responses, geometry,
gesture cancellation and cursor math. They do not establish native delivery or
remote end-to-end behavior. The strict macOS fixture also exercises native shared
preview capture/input and stale preview rejection after revocation.
