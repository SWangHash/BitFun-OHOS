const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const channelSource = fs.readFileSync(
  path.join(__dirname, '../entry/src/main/ets/services/PetWindowChannel.ets'),
  'utf8',
);
const petPageSource = fs.readFileSync(
  path.join(__dirname, '../entry/src/main/ets/pages/PetWindow.ets'),
  'utf8',
);
const petWindowHostSource = fs.readFileSync(
  path.join(__dirname, '../../../web-ui/src/infrastructure/config/services/agentCompanionPetWindowHost.ts'),
  'utf8',
);
const { outputText } = ts.transpileModule(channelSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
});

/**
 * Load the production bridge with the HarmonyOS kits mocked.
 *
 * `publish` and `createSubscriber` are the two platform calls the bridge makes;
 * everything else in the module is pure string handling, which the tests below
 * exercise directly.
 */
function channelHost(overrides = {}) {
  const published = [];
  const warnings = [];
  const commonEventManager = {
    publish: async (event, options) => {
      if (overrides.publishFails) {
        throw { code: 1500001, message: 'publish rejected' };
      }
      published.push({ event, data: options.data });
    },
    createSubscriber: (info, callback) => {
      if (overrides.createFails) {
        callback({ code: 1500002, message: 'create failed' }, undefined);
        return;
      }
      callback(undefined, { id: info.events[0] });
    },
    subscribe: (subscriber, handler) => {
      overrides.onSubscribe === undefined ? undefined : overrides.onSubscribe(subscriber, handler);
    },
    unsubscribe: () => {},
  };
  const modules = {
    '@kit.BasicServicesKit': { commonEventManager },
    '@kit.PerformanceAnalysisKit': {
      hilog: {
        info() {},
        debug() {},
        warn: (...args) => warnings.push(args.join(' ')),
        error: (...args) => warnings.push(args.join(' ')),
      },
    },
  };
  const exports = {};
  new Function('require', 'exports', outputText)(name => modules[name], exports);
  return { exports, published, warnings };
}

test('pet commands keep their payload structured', () => {
  const { exports } = channelHost();

  assert.equal(
    exports.buildPetCommandEnvelope('agent-companion://pet-command', '{"type":"dismiss-task"}'),
    '{"event":"agent-companion://pet-command","payload":{"type":"dismiss-task"}}',
  );
  // An absent payload must still produce valid JSON, not `undefined`.
  assert.equal(
    exports.buildPetCommandEnvelope('agent-companion://ready', ''),
    '{"event":"agent-companion://ready","payload":null}',
  );
});

test('publish failures are logged instead of rejecting the caller', async () => {
  const { exports, warnings } = channelHost({ publishFails: true });

  await exports.publishPetEvent('bitfun.agentCompanion.deliver', '{"event":"x"}');

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /publish rejected/);
});

test('published events carry the payload as their data string', async () => {
  const { exports, published } = channelHost();

  await exports.publishPetEvent('bitfun.agentCompanion.deliver', '{"event":"a","payload":1}');

  assert.deepEqual(published, [
    { event: 'bitfun.agentCompanion.deliver', data: '{"event":"a","payload":1}' },
  ]);
});

test('subscribers receive event data and survive a failing creation', async () => {
  const { exports } = channelHost({
    onSubscribe: (_subscriber, handler) => {
      handler(undefined, { data: '{"event":"a"}' });
      // A delivery error must not reach the page handler.
      handler({ code: 1, message: 'delivery failed' }, { data: '{"event":"b"}' });
    },
  });
  const received = [];
  const subscriber = await exports.createPetSubscriber('bitfun.agentCompanion.deliver', data => {
    received.push(data);
  });
  assert.notEqual(subscriber, null);
  assert.deepEqual(received, ['{"event":"a"}']);

  const failing = channelHost({ createFails: true });
  assert.equal(
    await failing.exports.createPetSubscriber('bitfun.agentCompanion.deliver', () => {}),
    null,
  );
});

test('payload text is escaped before it is spliced into runJavaScript', () => {
  const { exports } = channelHost();
  const literal = exports.toJavaScriptStringLiteral('a"b\nc</script>');

  // The literal must round-trip through JavaScript parsing unchanged.
  assert.equal(new Function(`return ${literal}`)() , 'a"b\nc</script>');
  assert.ok(!literal.includes('\n'), 'newlines must not survive as raw characters');
});

test('the page proxy exposes exactly the methods the web-ui port calls', () => {
  const methodList = petPageSource.match(/methodList:\s*\[([^\]]*)\]/);
  assert.ok(methodList, 'PetWindow.ets must declare a javaScriptProxy methodList');
  const proxyMethods = [...methodList[1].matchAll(/'([^']+)'/g)].map(match => match[1]).sort();

  const interfaceBody = petWindowHostSource.match(
    /interface HarmonyOsPetHostProxy \{([\s\S]*?)\n\}/,
  );
  assert.ok(interfaceBody, 'the web-ui port must declare the HarmonyOS proxy shape');
  const portMethods = [...interfaceBody[1].matchAll(/^\s{2}(\w+)\(/gm)].map(match => match[1]).sort();

  assert.deepEqual(proxyMethods, portMethods);
});
