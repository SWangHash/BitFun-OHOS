const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(
  path.join(__dirname, '../entry/src/main/ets/services/LocalModelKeepAliveService.ets'),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});

function host({ failConnect = false, failFirstConnects = 0 } = {}) {
  const events = [];
  const timers = [];
  let options;
  let connectionSeq = 0;
  const activeConnections = new Set();
  const context = {
    connectServiceExtensionAbility: (want, connectOptions) => {
      options = connectOptions;
      const id = ++connectionSeq;
      if (failConnect || connectionSeq <= failFirstConnects) {
        options.onFailed(want.abilityName);
        throw new Error('connect rejected');
      }
      activeConnections.add(id);
      options.onConnect(want.abilityName, { interfaceToken: 'remote' });
      events.push(`connect:${id}`);
      return id;
    },
    disconnectServiceExtensionAbility: (id) => {
      activeConnections.delete(id);
      events.push(`disconnect:${id}`);
    },
  };
  const kits = {
    '@kit.AbilityKit': { common: { ConnectOptions: undefined } },
    '@kit.IPCKit': { rpc: { IRemoteObject: undefined } },
    '@kit.PerformanceAnalysisKit': {
      hilog: { info() {}, warn() {}, error() {} },
    },
  };
  const globals = {
    setTimeout: (callback) => { timers.push(callback); return timers.length; },
    clearTimeout: (handle) => { timers[handle - 1] = null; },
  };
  const exports = {};
  new Function('require', 'exports', ...Object.keys(globals), outputText)(
    name => kits[name], exports, ...Object.values(globals),
  );
  return {
    context,
    service: new exports.LocalModelKeepAliveService(),
    events,
    timers,
    options: () => options,
    connections: activeConnections,
    dropConnection: () => { options.onDisconnect('EntryAbility'); },
  };
}

test('startup connects to the model foundation service and holds the connection', () => {
  const h = host();
  h.service.start(h.context);
  assert.deepEqual(h.events, ['connect:1']);
  assert.equal(h.connections.size, 1);
  h.service.dispose();
  assert.deepEqual(h.events, ['connect:1', 'disconnect:1']);
  assert.equal(h.connections.size, 0);
});

test('a dropped connection schedules exactly one reconnect', () => {
  const h = host();
  h.service.start(h.context);
  h.dropConnection();
  h.dropConnection();
  assert.equal(h.timers.filter(Boolean).length, 1);
  h.timers.filter(Boolean).forEach(callback => callback());
  assert.deepEqual(h.events, ['connect:1', 'connect:2']);
});

test('dispose cancels pending reconnects', () => {
  const h = host();
  h.service.start(h.context);
  h.dropConnection();
  h.service.dispose();
  h.timers.filter(Boolean).forEach(callback => callback());
  assert.deepEqual(h.events, ['connect:1']);
});

test('connection failures retry after a delay', () => {
  const h = host({ failFirstConnects: 1 });
  h.service.start(h.context);
  assert.deepEqual(h.events, []);
  h.timers.filter(Boolean).forEach(callback => callback());
  assert.deepEqual(h.events, ['connect:2']);
});
