# DevEco Code Adapter

This sibling adapter owns the ordinary DevEco Code CLI V1 configuration syntax,
source ordering, bounded command/subagent/MCP discovery, configured local Skill
roots and user Instructions. Account APIs live separately in `auth`.

- Keep ecosystem identity `deveco-code` independent of every other adapter.
- Read-only source discovery never starts DevEco Code, executes plugins, tools or
  hooks, connects MCP servers, or reads account tokens.
- Preserve source diagnostics, suppression, approval and revision fencing through
  the existing typed external-source contracts. Never grant execution in discovery.
- Do not depend on sibling ecosystem adapters. Reuse neutral filesystem, JSONC and
  Markdown helpers; concrete syntax translation remains owned here.
- High textual overlap with `opencode-adapter` (bounded reads, glob expansion,
  config-directory plumbing, fixture setup) is the expected cost of the
  one-crate-per-ecosystem rule, not a defect to deduplicate. Keep that
  boilerplate duplicated here; share only the already-neutral layers
  (`bitfun-static-hook-support`, `bitfun-services-core::bounded_fs`,
  `bitfun-services-core::local_instructions`) instead of introducing a new
  common adapter crate or a sibling dependency.
- V2 config, Studio storage, executable plugins/tools/hooks and Skill URLs are
  outside the current static compatibility claim. Unsupported declarations must
  remain diagnostics, never silently become native runtime policy.

Focused verification uses the persistent HarmonyOS toolchain and
`aarch64-unknown-linux-ohos` target in this repository. These commands compile the
fixtures only; `--no-run` is not evidence that tests executed on a device. Do not
replace them with a host build. A HAP build covers the shipped target/feature
closure and does not require a duplicate Cargo check.

```bash
cargo test -p bitfun-deveco-code-adapter --target aarch64-unknown-linux-ohos --no-run --test deveco_code_source_contracts
cargo test -p bitfun-deveco-code-adapter --target aarch64-unknown-linux-ohos --features auth --no-run --lib auth::tests
cargo test -p bitfun-deveco-code-adapter --target aarch64-unknown-linux-ohos --features auth --no-run --lib auth::browser::tests
```
