const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'entry/src/main/ets/entryability/EntryAbility.ets'), 'utf8');
const parser = source.slice(source.indexOf('interface ThemeModeRequest'), source.indexOf('export default class EntryAbility'));
const start = source.indexOf("RustModule.registerArktsFunction('set_theme_mode'");
const callback = source.slice(start, source.indexOf('    this.voiceInputService.setContext', start));
function bridge(fail = false) {
  const calls = [];
  let handle;
  const { outputText } = ts.transpileModule(`${parser}\n${callback}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const host = {
    context: { getApplicationContext: () => ({ setColorMode: mode => calls.push(['mode', mode]) }) },
    notifySystemColorMode() {},
    readSystemColorMode: () => 'light',
  };
  new Function('RustModule', 'ConfigurationConstant', 'ColorMetrics', 'window', 'hilog', 'DOMAIN', outputText).call(
    host,
    { registerArktsFunction: (_, fn) => { handle = fn; } },
    { ColorMode: { COLOR_MODE_LIGHT: 'light', COLOR_MODE_DARK: 'dark', COLOR_MODE_NOT_SET: 'system' } },
    { resourceColor: value => ({ value }) },
    { async setStartWindowBackgroundColor(...args) { if (fail) throw new Error('unsupported'); calls.push(['background', ...args]); } },
    { warn() {} }, 0,
  );
  return { calls, handle };
}

test('legacy mode queries retain their return contract without rewriting launch colors', async () => {
  const { calls, handle } = bridge();
  assert.equal(await handle(null, 'dark'), '');
  assert.equal(await handle(null, 'light'), '');
  assert.equal(await handle(null, 'system'), 'light');
  assert.deepEqual(calls, [['mode', 'dark'], ['mode', 'light'], ['mode', 'system']]);
});

test('fixed and system selections synchronize the actual committed background', async () => {
  for (const mode of ['dark', 'light', 'system']) {
    const { calls, handle } = bridge();
    await handle(null, JSON.stringify({ mode, backgroundColor: '#123456' }));
    assert.deepEqual(calls[1], ['background', 'entry', 'EntryAbility', { value: '#123456' }]);
  }
});

test('platform failures and malformed modes are not reported as successful synchronization', async () => {
  await assert.rejects(bridge(true).handle(null, JSON.stringify({ mode: 'dark', backgroundColor: '#123456' })), /unsupported/);
  await assert.rejects(bridge().handle(null, JSON.stringify({ mode: 'unknown' })), /Invalid native theme mode/);
});

test('launch icon keeps the dedicated splash asset', () => {
  assert.match(fs.readFileSync(path.join(root, 'entry/src/main/module.json5'), 'utf8'), /"startWindowIcon": "\$media:bitfun_icon_light"/);
  assert.ok(fs.existsSync(path.join(root, 'entry/src/main/resources/base/media/bitfun_icon_light.png')));
});
