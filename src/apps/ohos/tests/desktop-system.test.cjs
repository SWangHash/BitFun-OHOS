const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../entry/src/main/ets/services/DesktopSystemService.ets'), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
function host(version, supported = true, denied = false) {
  const calls = [];
  let listener;
  const exports = {};
  const lock = { hold: () => calls.push('hold'), unhold: () => calls.push('unhold') };
  const kits = {
    '@kit.AbilityKit': { autoStartupManager: { getAutoStartupStatusForSelf: async () => true } },
    '@kit.PerformanceAnalysisKit': { hilog: { error() {} } },
    '@kit.BasicServicesKit': {
      deviceInfo: { sdkApiVersion: version },
      runningLock: {
        get RunningLockType() { assert.ok(version >= 23, 'Old systems must not access the new enum'); return { BACKGROUND_USER_IDLE: 129 }; },
        isSupported: () => supported,
        create: async () => { calls.push('create'); if (denied) throw new Error('permission denied'); return lock; },
      },
      commonEventManager: {
        Support: { COMMON_EVENT_ENTER_FORCE_SLEEP: 'enter', COMMON_EVENT_EXIT_FORCE_SLEEP: 'exit' },
        createSubscriber: async () => ({}),
        subscribe: (_, callback) => { listener = callback; },
        unsubscribe: () => calls.push('unsubscribe'),
      },
    },
  };
  new Function('require', 'exports', outputText)(name => kits[name], exports);
  return { service: new exports.DesktopSystemService(), calls, event: name => listener(null, { event: name }) };
}
test('old systems reject enabling before touching API 23; disabling remains available', async () => {
  const h = host(21);
  await assert.rejects(h.service.setPreventSleep(true), /OHOS_SLEEP_API_23_REQUIRED/);
  await h.service.setPreventSleep(false);
  assert.deepEqual(h.calls, []);
});
test('unsupported devices and denied permission do not acquire an inhibitor', async () => {
  const unavailable = host(23, false);
  await assert.rejects(unavailable.service.setPreventSleep(true), /OHOS_SLEEP_UNSUPPORTED/);
  assert.deepEqual(unavailable.calls, []);
  const denied = host(23, true, true);
  await assert.rejects(denied.service.setPreventSleep(true), /permission denied/);
  assert.deepEqual(denied.calls, ['create', 'unsubscribe']);
});
test('enabled inhibitor survives duplicate sync, releases for forced sleep and resumes', async () => {
  const h = host(23);
  await h.service.setPreventSleep(true);
  await h.service.setPreventSleep(true);
  h.event('enter'); h.event('exit');
  await h.service.setPreventSleep(false);
  assert.deepEqual(h.calls, ['create', 'hold', 'unhold', 'hold', 'unhold', 'unsubscribe']);
});
test('startup reads system state', async () => {
  assert.equal(await host(21).service.getLaunchAtLogin(), true);
});
