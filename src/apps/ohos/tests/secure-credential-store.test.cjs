const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the production ArkTS bridge with an in-memory AssetStoreKit.
// This does not emulate device permissions or replace ArkTS compilation.
const source = fs.readFileSync(
  path.join(__dirname, '../entry/src/main/ets/utils/SecureCredentialStore.ets'),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const marketAlias = 'bitfun.market.credentials.v1';
const subscriptionAlias = 'codex/v2/test-set/access_token/0';
const oldPayload = '{"accessToken":"test-access","accessExpiresAt":123,"refreshToken":"test-refresh","refreshExpiresAt":456}';

function createStore(initial = [], queryError) {
  const entries = new Map(initial.map(([alias, value]) => [alias, Buffer.from(value)]));
  const mutations = [];
  const logs = [];
  const aliasOf = (query) => Buffer.from(query.get('alias')).toString('utf8');
  const checkedSecret = (attributes) => {
    const bytes = Buffer.from(attributes.get('secret'));
    // AssetStoreKit rejects SECRET values outside its 1..1024 byte range.
    if (bytes.length < 1 || bytes.length > 1024) throw { code: 401 };
    return bytes;
  };
  const asset = {
    Tag: { ALIAS: 'alias', SECRET: 'secret', RETURN_TYPE: 'returnType' },
    ReturnType: { ALL: 'all' },
    Accessibility: { DEVICE_FIRST_UNLOCKED: 'unlocked' },
    AuthType: { NONE: 'none' },
    SyncType: { NEVER: 'never' },
    async query(query) {
      if (queryError) throw { code: queryError };
      const alias = aliasOf(query);
      return entries.has(alias) ? [new Map([['secret', entries.get(alias)]])] : [];
    },
    async update(query, update) {
      const alias = aliasOf(query);
      if (!entries.has(alias)) throw { code: 24000002 };
      const secret = checkedSecret(update);
      mutations.push(['update', alias]);
      entries.set(alias, secret);
    },
    async add(attributes) {
      const alias = aliasOf(attributes);
      const secret = checkedSecret(attributes);
      mutations.push(['add', alias]);
      entries.set(alias, secret);
    },
    async remove(query) {
      const alias = aliasOf(query);
      mutations.push(['remove', alias]);
      if (!entries.delete(alias)) throw { code: 24000002 };
    },
  };
  const kits = {
    '@kit.ArkTS': {
      util: {
        TextEncoder: class { encodeInto(value) { return Buffer.from(value, 'utf8'); } },
        TextDecoder: { create: () => ({ decodeToString: (value) => Buffer.from(value).toString('utf8') }) },
        Base64Helper: class { encodeToStringSync(value) { return Buffer.from(value).toString('base64'); } },
      },
    },
    '@kit.AssetStoreKit': { asset },
    '@kit.PerformanceAnalysisKit': { hilog: { error: (...args) => logs.push(args) } },
  };
  const exports = {};
  new Function('require', 'exports', outputText)((name) => {
    assert.ok(kits[name], `Unexpected platform import: ${name}`);
    return kits[name];
  }, exports);
  const store = new exports.SecureCredentialStore();
  return {
    entries, mutations, logs,
    call: async (action, alias = marketAlias, value) => JSON.parse(
      await store.handle(JSON.stringify({ action, alias, value })),
    ),
  };
}

// Node's Base64 decoder tolerates invalid input; assert canonical wire bytes
// before decoding so a raw JSON response fails just as Rust's decoder does.
function decodeResponse(response) {
  assert.equal(response.status, 'ok');
  assert.match(response.value, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
  return Buffer.from(response.value, 'base64');
}

test('loads legacy market JSON without rewriting or deleting the stored asset', async () => {
  const store = createStore([[marketAlias, oldPayload]]);
  const bytes = decodeResponse(await store.call('load'));
  assert.equal(bytes.toString('utf8'), oldPayload);
  assert.deepEqual(JSON.parse(bytes), JSON.parse(oldPayload));
  assert.equal(store.entries.get(marketAlias).toString('utf8'), oldPayload);
  assert.deepEqual(store.mutations, []);
  assert.deepEqual(store.logs, []);
});

test('preserves whitespace, Unicode, and additional fields in legacy market JSON', async () => {
  const payload = ` \n${oldPayload.slice(0, -1)},"futureField":"\\u4e2d文"}`;
  const store = createStore([[marketAlias, payload]]);
  assert.equal(decodeResponse(await store.call('load')).toString('utf8'), payload);
  assert.deepEqual(store.mutations, []);
});

test('loads current Base64 market credentials without double encoding', async () => {
  const value = Buffer.from(oldPayload).toString('base64');
  const store = createStore([[marketAlias, value]]);
  assert.deepEqual(await store.call('load'), { status: 'ok', value });
  assert.deepEqual(store.mutations, []);
});

test('round trips a legacy payload through a current save and a fresh bridge', async () => {
  const store = createStore([[marketAlias, oldPayload]]);
  const bytes = decodeResponse(await store.call('load'));
  assert.deepEqual(await store.call('store', marketAlias, bytes.toString('base64')), { status: 'ok' });
  const restarted = createStore([...store.entries]);
  assert.deepEqual(decodeResponse(await restarted.call('load')), bytes);
  assert.deepEqual(JSON.parse(bytes), JSON.parse(oldPayload));
});

test('round trips new market credentials', async () => {
  const store = createStore();
  const value = Buffer.from(oldPayload).toString('base64');
  assert.deepEqual(await store.call('store', marketAlias, value), { status: 'ok' });
  assert.deepEqual(await store.call('load'), { status: 'ok', value });
});

test('keeps binary subscription chunks unchanged', async () => {
  const bytes = Buffer.from([0, 123, 255, 254, 128, 10]);
  const store = createStore();
  assert.deepEqual(await store.call('store', subscriptionAlias, bytes.toString('base64')), { status: 'ok' });
  assert.deepEqual(decodeResponse(await store.call('load', subscriptionAlias)), bytes);
});

test('persists full-size Codex chunks beside legacy market credentials and reads them after restart', async () => {
  const store = createStore([[marketAlias, oldPayload]]);
  const tokens = {
    access: Buffer.from('synthetic-access.'.repeat(600)),
    refresh: Buffer.from('synthetic-refresh.'.repeat(150)),
  };
  for (const [field, bytes] of Object.entries(tokens)) {
    for (let offset = 0, index = 0; offset < bytes.length; offset += 768, index++) {
      const chunk = bytes.subarray(offset, offset + 768);
      const alias = `codex/v2/test-set/${field}/${index}`;
      const value = chunk.toString('base64');
      if (chunk.length === 768) assert.equal(Buffer.byteLength(value), 1024);
      assert.deepEqual(await store.call('store', alias, value), { status: 'ok' });
    }
  }
  const restarted = createStore([...store.entries]);
  for (const [field, bytes] of Object.entries(tokens)) {
    const chunks = [];
    for (let index = 0; index < Math.ceil(bytes.length / 768); index++) {
      chunks.push(decodeResponse(await restarted.call('load', `codex/v2/test-set/${field}/${index}`)));
    }
    assert.deepEqual(Buffer.concat(chunks), bytes);
  }
  assert.equal(decodeResponse(await restarted.call('load')).toString('utf8'), oldPayload);
  assert.equal(store.entries.get(marketAlias).toString('utf8'), oldPayload);
});

test('propagates oversized subscription writes without replacing the previous chunk', async () => {
  const original = Buffer.from('previous-chunk').toString('base64');
  const store = createStore([[subscriptionAlias, original]]);
  const oversized = Buffer.alloc(769, 120).toString('base64');
  assert.deepEqual(await store.call('store', subscriptionAlias, oversized), { status: 'error', code: '401' });
  assert.equal(store.entries.get(subscriptionAlias).toString('utf8'), original);
  assert.deepEqual(store.mutations, []);
});

test('does not reinterpret JSON-looking data under another alias', async () => {
  for (const alias of [subscriptionAlias, `${marketAlias}.other`, 'bitfun.feedback.credentials.v1']) {
    const store = createStore([[alias, oldPayload]]);
    assert.deepEqual(await store.call('load', alias), { status: 'ok', value: oldPayload });
    assert.deepEqual(store.mutations, []);
  }
});

test('leaves malformed legacy JSON for the market parser and preserves the asset', async () => {
  const payload = '{"accessToken":';
  const store = createStore([[marketAlias, payload]]);
  const bytes = decodeResponse(await store.call('load'));
  assert.equal(bytes.toString('utf8'), payload);
  assert.throws(() => JSON.parse(bytes));
  assert.deepEqual(store.mutations, []);
});

test('keeps absent entries distinct from vault failures', async () => {
  assert.deepEqual(await createStore().call('load'), { status: 'not_found' });
  assert.deepEqual(await createStore([], 24000002).call('load'), { status: 'not_found' });
  const unavailable = createStore([[marketAlias, oldPayload]], 24000001);
  assert.deepEqual(await unavailable.call('load'), { status: 'error', code: '24000001' });
  assert.deepEqual(unavailable.mutations, []);
  assert.ok(!JSON.stringify(unavailable.logs).includes('test-access'));
});

test('explicit deletion remains idempotent for both stored formats', async () => {
  for (const payload of [oldPayload, Buffer.from(oldPayload).toString('base64')]) {
    const store = createStore([[marketAlias, payload]]);
    assert.deepEqual(await store.call('delete'), { status: 'ok' });
    assert.deepEqual(await store.call('load'), { status: 'not_found' });
    assert.deepEqual(await store.call('delete'), { status: 'not_found' });
  }
});
