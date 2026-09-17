# Native terminal renderer

This trusted bundled xterm renderer is shared by Android, iOS, and HarmonyOS. It contains no account credentials, network client, runtime, or ANSI parser. Native adapters own the selected runtime and its PTY lifecycle.

Run `node scripts/build-mobile-terminal.mjs` after changing this source or xterm dependencies. Android assets and the iOS folder resource use `generated/`; add `--harmony` to copy the same output to Harmony rawfile resources. Keep generated assets in sync so native offline builds do not need a JavaScript package install.

Native sends `BitFunTerminal.accept({epoch, revision, reset, data, theme?})`. Epoch identifies the PTY, revision orders local presentation frames, and reset carries the bounded replay tail after attachment or a dropped presentation frame. The renderer serializes xterm writes before applying the next reset. Older revisions are ignored; a gap requests resynchronization.

The bridge emits JSON `ready`, `resync`, `input {data}`, and `resize {cols, rows}` events. Android/Harmony expose `BitFunTerminalHost.postMessage`; iOS uses `webkit.messageHandlers.bitfunTerminal.postMessage`. `connect()` repeats the ready handshake after native navigation completion. Input execution, batching, resize coalescing, failure state, and disposal belong to the native runtime store.

Verify the actual bundled assets and keyboard/ANSI behavior with `pnpm --dir src/mobile-web run test:terminal-browser`. Native compilation is additional adapter evidence, not a replacement for a device communicating with a runtime through Relay.
