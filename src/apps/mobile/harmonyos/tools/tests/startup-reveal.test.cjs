const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../../entry/src/main/ets/services/StartupRevealPreference.ets'), 'utf8');
function load(values) {
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'exports', js)(name => name === '@kit.ArkData' ? {
    preferences: { getPreferencesSync: () => ({
      getSync: (key, fallback) => values.get(key) ?? fallback,
      putSync: (key, value) => values.set(key, value),
      flush: async () => {},
    }) },
  } : { RemoteLogger: { warn() {} } }, exports);
  return exports.StartupRevealPreference;
}
test('first appearance claims persistently before an interrupted animation, including a new process', () => {
  const disk = new Map();
  const firstProcess = load(disk);
  assert.equal(firstProcess.claim({}), true);
  assert.equal(firstProcess.claim({}), false);
  assert.equal(load(disk).claim({}), false);
  assert.equal(load(new Map()).claim({}), true);
});
