# HarmonyOS host

This directory owns the ArkTS host and platform bridges. Follow the root
`AGENTS.md` for shared product behavior and Windows/WSL build boundaries.

## Secure credential bridge

`SecureCredentialStore.ets` returns Base64 secret bytes to Rust. The legacy
market alias `bitfun.market.credentials.v1` can still contain UTF-8 JSON from
`MarketCredentialStore`. Keep reading both formats without rewriting an asset
during load. Let the Rust market store validate the credential payload; do not
apply the legacy conversion to subscription chunks or other aliases.

Run the focused bridge regression tests from the repository root in WSL after
installing the root JavaScript dependencies:

```bash
node --test src/apps/ohos/tests/secure-credential-store.test.cjs
```

The tests transpile the production bridge and mock AssetStoreKit and ArkTS
utilities. They cover stored-format compatibility and bridge behavior, not
HarmonyOS permissions, ArkTS compilation, or device execution. Use the
`bitfun-ohos-build` preflight/build workflow when a HAP is required.
