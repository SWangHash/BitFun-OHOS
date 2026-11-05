# Browser control observation context

Keep browser transport and action orchestration in the existing owners.
`snapshot.js`, `resolve_element.js`, and `snapshot_context.rs` are local
observation/targeting helpers, used by both built-in and external browser clients.

## Contracts

- Snapshot collection, stale-ref cleanup, and target lookup must traverse the
  same open shadow roots and same-origin iframe hierarchy.
- Frame-relative geometry carries its coordinate-space label. Hidden/offscreen
  parent frames must not expose their descendants as visible controls.
- An empty accessible-name attribute must not suppress later label fallbacks.
  Keep form state separate from the name; never include password values.
- Preserve structured elements verbatim in `refs`. Invalid/missing JSON or
  duplicate refs are errors, not successful empty snapshots.
- Bounded text/value projections declare truncation. Inaccessible frames and
  offscreen elements are reported so absence is not mistaken for nonexistence.
- Host-created ArkWeb pages must be adopted by their exact native WebView label;
  creating or navigating a second page loses the automation state.
- ArkWeb `connect` reuses a registered visible/exact target. Missing requested
  ids or filters must fail rather than create replacement pages. A newly created
  blank page must be adopted without navigation. Tool readiness requires the
  exact host-created CDP target, independently of presentation, so background
  work never requires changing the selected chat session.
- Fill success requires reading the requested value back from the same field.
  Date/time controls use native value setters and events; input-command success
  alone is not completion evidence. Keep password values out of results.
- Explicit tab/resource close retires the native page and both session/target
  registries; project switching only hides the page. Settings Disconnect must
  detach ArkWeb's logical port zero independently of external CDP port 9222,
  and prevent recovery until an explicit Settings Connect.

## Focused verification

```bash
node scripts/test-computer-use-context.mjs
# Real Chromium collection and ref activation, followed by compiled Rust
# parsing/presentation of the actual browser payload (Node 22/24 + Chrome):
node scripts/test-browser-snapshot.mjs
node scripts/test-browser-fill.mjs
cargo test -p bitfun-core --no-default-features --features agent-runtime,tools-browser-web,tools-computer-use,git --lib browser_control::actions::
cargo test -p bitfun-core --no-default-features --features agent-runtime,tools-browser-web,tools-computer-use,git --lib computer_use_tool::tests::
```

The Core test target currently needs `git` for its worktree tool module and
`tools-browser-web` for the shared ControlHub error contract. Computer Use schema
checks additionally select `tools-computer-use`; none requires `product-full`.

The Chromium fixture verifies local external-browser behavior. It is not
evidence of built-in WebKit, remote workspace, mobile/IM remote control, Peer
Device Mode, or Detached Dispatch execution.
