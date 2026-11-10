# Browser scene

Native child-view visibility combines the controller window state, active panel,
toolbar transitions, and floating-surface occlusion. Keep native window event
subscriptions in the infrastructure adapter and share them across cached panels.
Do not use window focus alone as visibility: an unfocused window can remain visible.
On OHOS, use ArkWeb document visibility for the host lifecycle. Tauri's window
metadata exists there, but its window plugin rejects visibility/minimized queries
on mobile targets; treating that metadata as desktop API support hides every page.

## HarmonyOS page ownership

ArkUI pages created by `BrowserWebviewService` are absent from Tauri's desktop
WebView inventory. Use command-based handles and `browser_webview_*` probes for
creation, recovery, visibility and explicit close. Do not reintroduce
`Webview.getByLabel()` or require `plugin:webview` inventory on manual/help-page
paths; Agent-created pages and help-menu pages must use the same host adapter.

Adopt the exact native `webviewLabel` rather than substituting an automation
target ID or creating a replacement page. Unmount/session/project changes hide
the page; explicit resource close retires it. Reopening a closed tab must discard
dead native IDs before creating a new page. Keep device-scope checks so a peer
label cannot be used on the controller or another host.

Forward main-document navigation/TLS failures through page-load events. A later
`onPageEnd` must not convert a failed load into success, and invalid certificates
remain rejected. A visible URL or successful creation command does not prove
web content rendered. Native storage, bounds, navigation interception and
scrollbar adaptations belong to the
[OHOS host](../../../../../apps/ohos/AGENTS.md).

For preview scheduling and native visibility changes, run:

```bash
pnpm --dir src/web-ui run test:run src/app/scenes/browser src/infrastructure/runtime/windowVisibility.test.ts
```

These tests cover event races, scheduling and DOM ownership. They do not establish
native rendering behavior. For minimize/restore changes, also use a real desktop
WebView: verify native minimized state, capture counts, child document visibility
and animation progress while minimized and after restoration. Check that inactive
or occluded panels remain hidden after restoring the window. Report the tested OS
and build profile; local fixtures do not establish remote-scenario behavior.
