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
