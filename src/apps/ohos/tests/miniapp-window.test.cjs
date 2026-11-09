const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const repo = path.join(root, '..', '..', '..');

function read(...parts) {
  return fs.readFileSync(path.join(...parts), 'utf8');
}

const entryAbility = read(root, 'entry/src/main/ets/entryability/EntryAbility.ets');
const service = read(root, 'entry/src/main/ets/services/MiniAppWindowService.ets');
const page = read(root, 'entry/src/main/ets/pages/MiniAppWindow.ets');
const shell = read(root, 'entry/src/main/resources/rawfile/miniapp-window/shell.html');
const pages = JSON.parse(read(root, 'entry/src/main/resources/base/profile/main_pages.json'));
const typings = read(root, 'entry/src/main/cpp/types/libbitfun_desktop_lib/Index.d.ts');
const adapter = read(repo, 'src/apps/desktop/src/api/ohos/miniapp_window.rs');
const host = read(repo, 'src/apps/desktop/src/miniapp_desktop/mod.rs');

test('the Rust adapter asks ArkTS to create the window', () => {
  assert.match(adapter, /"miniapp_window_open"/);
  assert.match(service, /createSubWindow\(/);
  assert.match(entryAbility, /registerArktsFunction\('miniapp_window_open'/);
  assert.match(entryAbility, /MiniAppWindowService\.getInstance\(\)/);
});

test('the window page is registered and serves the shell document', () => {
  assert.ok(pages.src.includes('pages/MiniAppWindow'));
  assert.match(page, /@Entry/);
  assert.match(page, /MiniAppWindowService/);
  assert.match(page, /\$rawfile\('miniapp-window\/shell\.html'\)/);
  assert.match(page, /javaScriptProxy\(/);
  assert.match(page, /methodList: \['call', 'result', 'closeSelf'\]/);
  assert.match(service, /const PAGE: string = 'pages\/MiniAppWindow'/);
});

test('the shell relays identity only through the ArkTS bridge', () => {
  // The shell page never sends instance/view/nonce itself.
  assert.match(shell, /host\.call\(JSON\.stringify\(\{ operation, params: params \|\| \{\} \}\)\)/);
  assert.match(shell, /host\.result\(submitted\.requestId\)/);
  assert.doesNotMatch(shell, /instanceId|viewId|nonce/);
  // ArkTS binds them from the window it belongs to.
  assert.match(service, /operation: parsed\.operation/);
  assert.match(service, /instanceId: identity\.instanceId/);
  assert.match(service, /viewId: identity\.viewId/);
  assert.match(service, /nonce: identity\.nonce/);
});

test('the shell implements the tab runtime protocol', () => {
  assert.match(shell, /bitfun\/request-locale/);
  assert.match(shell, /bitfun\/request-appearance/);
  assert.match(shell, /hostCall\('bootstrap', \{\}\)/);
  assert.match(shell, /hostCall\('ready', \{\}\)/);
  assert.match(shell, /hostCall\('poll', \{ after: cursor, waitMs: 0 \}\)/);
  assert.match(shell, /hostCall\('rpc', \{ method, params \}\)/);
  assert.match(shell, /sandbox/);
});

test('the host entry points exist on both sides of the bridge', () => {
  assert.match(typings, /miniappWindowCall\(request: string\): string/);
  assert.match(typings, /miniappWindowResult\(requestId: string\): string/);
  assert.match(adapter, /#\[napi\][\s\S]*pub fn miniapp_window_call/);
  assert.match(adapter, /#\[napi\][\s\S]*pub fn miniapp_window_result/);
  assert.match(host, /#\[cfg\(target_env = "ohos"\)\][\s\S]*async fn open_ohos_window/);
  assert.match(host, /open_ohos_window\(app, record\)\.await/);
  assert.match(host, /if method == "bootstrap"/);
  assert.match(host, /ShellLease \{/);
});

test('the sidecar spawn path stays off the HarmonyOS branch', () => {
  const openWindow = host.match(
    /async fn open_window\([\s\S]*?\n\}\n/,
  );
  assert.ok(openWindow);
  assert.match(openWindow[0], /#\[cfg\(target_env = "ohos"\)\]/);
  assert.match(openWindow[0], /open_ohos_window\(app, record\)\.await/);
  assert.doesNotMatch(openWindow[0], /create_command/);
  // The desktop spawn implementation moved behind the non-OHOS gate.
  assert.match(host, /#\[cfg\(not\(target_env = "ohos"\)\)\]\nasync fn open_desktop_window/);
});
