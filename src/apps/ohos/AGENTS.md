# HarmonyOS host

This directory owns the ArkTS host and platform bridges. Follow the root
`AGENTS.md` for shared product behavior and Windows/WSL build boundaries.

## Remote Connect web resources

The desktop frontend lives in `resources/resfile/dist`; the browser remote
controller lives separately in `resources/resfile/mobile-web/dist`. The
`remote-web` Hvigor plugin stages and verifies both existing frontend outputs for
pipeline and staged local HAP assembly. Before PreBuild it replaces both resource
directories from the repository's `dist` and `src/mobile-web/dist`, so packaging
does not depend on an external script's resource-copy layout. Never serve the
desktop frontend as the LAN pairing page or replace it with the controller bundle.

Run `pnpm run prepare:mobile-web` before native HarmonyOS compilation: Tauri
validates that resource directory before Hvigor runs. The packaging pipeline
also builds it before compiling Rust. Build the desktop frontend before HAP
assembly as well. The Hvigor plugin only stages these outputs; it does not build
either frontend or require changes to the external packaging script.

Run `node --test scripts/ohos-remote-web-resources.test.mjs` for resource isolation,
stale asset replacement, and final HAP integrity. Use a HarmonyOS build to verify
the Hvigor task integration and the native resource lookup.

## Voice input transcript

`VoiceInputService` forwards the system `speechRecognizer` stream to the web-ui,
and `SpeechTranscript.ets` owns the platform-independent part of it. Engine
results are clause-scoped snapshots: every non-final result is another take of
the clause being recognized — it may insert, drop, or replace characters
anywhere inside it — and `isFinal` commits that clause. A take therefore
replaces the clause; only a final result is appended to the committed
transcript. Concatenating takes repeats them (the engine revises mid-clause), and
so does any prefix-overlap heuristic.

The host is the only place that assembles clauses. The composer renders
`draft + latestTranscript` and re-normalizes the text on purpose, but it must
not append `${current} ${delta}` or relate snapshots to each other.

Keep the ArkTS rules in step with
`src/web-ui/src/flow_chat/components/voice/voiceTranscript.ts`.

Run `node --test src/apps/ohos/tests/speech-transcript.test.cjs` for the
transcript rules. It covers text assembly only, not the speech engine, ArkTS
compilation, or device behavior.

## Scrollbars

ArkWeb draws overlay scrollbars by default: the thumb floats above page
content and a mouse cannot drag it, so only the wheel, trackpad, or touch
scrolls. `DefaultWebview.ets` sets `forceDisplayScrollBar(true)`, which keeps
the scrollbar inside the content area, reserves its column, and makes it
draggable. Do not remove it to match a mobile look, and do not try to fix
overlap or drag in web-side CSS: the webkit scrollbar paint rules only apply
once the engine stops using an overlay scrollbar. Web-side CSS still owns
width, color, and idle hiding.

Run `node --test src/apps/ohos/tests/browser-webview.test.cjs` for the source
contract.

## Embedded browser bridge

`BrowserWebviewService.ets` opts embedded browser views into DOM Storage before
their first navigation so web apps can use `localStorage` and `sessionStorage`.
`DefaultWebview.ets` applies that setting; other callers retain the ArkWeb default.

This bridge is OHOS product code that upstream does not carry. Keep
`BrowserWebviewService.ets`, `DefaultWebview.ets`, and the `browser_webview_*`
ArkTS registrations across upstream merges; the Rust side is
`src/apps/desktop/src/api/ohos/browser.rs`.

Run `node --test src/apps/ohos/tests/browser-webview.test.cjs` for browser
creation, initial storage configuration, evaluation failures, bounds updates,
and drag handling.
These tests mock ArkUI and do not verify webpage rendering on a device.

## MiniApp independent windows

The Desktop "open in an independent window" MiniApp presentation uses a real
HarmonyOS `WindowStage` sub-window instead of the desktop sidecar executable,
which a packaged HarmonyOS app cannot spawn.

- `MiniAppWindowService.ets` creates one sub-window per MiniApp instance and
  loads `pages/MiniAppWindow`, which hosts
  `resources/rawfile/miniapp-window/shell.html` in an ArkWeb `Web`.
- The shell page speaks the same JSON-RPC protocol as a tab and as the desktop
  shell (`bootstrap` / `ready` / `poll` / `rpc` / `local`), but reaches the host
  through the injected `window.ohosMiniAppHost` proxy
  (`javaScriptProxy` + `asyncMethodList: ['call']`) instead of
  `miniapp_shell_call` over local IPC.
- `miniapp_window_call` (`src/apps/desktop/src/api/ohos/miniapp_window.rs`) is
  the `#[napi]` return path. The ArkTS bridge binds `instanceId` / `viewId` /
  `nonce` from the window it belongs to; MiniApp content never supplies
  identity. Keep that binding out of the shell page.
- Rust still owns the instance registry, shell lease, Worker/Agent execution
  and events: `open_ohos_window` prepares the instance and inserts the lease
  before asking ArkTS to create the window. The `bootstrap` operation reuses the
  desktop `open` reply payload.
- Closing the OS window retires the instance; when the host releases an instance
  first, `poll` reports `released` and the shell closes its own window.
- Degraded on purpose in this first version: the floating chat composer
  (`chat.*`) is refused, the window does not render MiniApp custom chrome, and
  it does not advertise the Agent window bridge. Those stay tab/desktop-window
  capabilities until a HarmonyOS implementation exists.

Run `node --test src/apps/ohos/tests/miniapp-window.test.cjs` for the source
contract. It does not prove ArkTS compilation or device behavior.

## Secure credential bridge

`SecureCredentialStore.ets` returns Base64 secret bytes to Rust. The legacy
market alias `bitfun.market.credentials.v1` can still contain UTF-8 JSON from
`MarketCredentialStore`. Keep reading both formats without rewriting an asset
during load. Let the Rust market store validate the credential payload; do not
apply the legacy conversion to subscription chunks or other aliases.

The 2.0.0 Rust account store (`account_identity/credentials.rs`) reads the
current alias `openbitfun.market.credentials.v1` first and falls back to the
1.0.x alias above, so an in-place upgrade keeps the market sign-in. Sign-out
deletes both aliases. Keep the two aliases in step with the bridge constant
`LEGACY_MARKET_ASSET_ALIAS` when either side is renamed.

Run the focused bridge regression tests from the repository root in WSL after
installing the root JavaScript dependencies:

```bash
node --test src/apps/ohos/tests/secure-credential-store.test.cjs
```

The tests transpile the production bridge and mock AssetStoreKit and ArkTS
utilities. They cover stored-format compatibility and bridge behavior, not
HarmonyOS permissions, ArkTS compilation, or device execution. Use the
`bitfun-ohos-build` preflight/build workflow when a HAP is required.

For device-local automatic-startup queries and API-gated idle sleep prevention, run
`node --test src/apps/ohos/tests/desktop-system.test.cjs`. These mocked host tests
cover version gating and lock lifecycle, not OS permission grants or device behavior.
