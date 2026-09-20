import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/services/accountDeviceSelection.ts', import.meta.url),
  'utf8',
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { isDeviceControllable, selectAccountDevice } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

const device = (id, extra = {}) => ({ device_id: id, device_name: id, online: true, ...extra });

test('only a confirmed incompatible flag is uncontrollable; a missing flag stays usable', () => {
  // Older Relays and older payloads omit the flag entirely.
  assert.equal(isDeviceControllable({}), true);
  assert.equal(isDeviceControllable({ compatible: undefined }), true);
  assert.equal(isDeviceControllable({ compatible: true }), true);
  assert.equal(isDeviceControllable({ compatible: false }), false);
});

test('an incompatible device stays listed but is never auto-selected', () => {
  const devices = [
    device('controller'),
    device('incompatible', { compatible: false, client_version: '0.9.0' }),
  ];
  // The device row remains available to the page for rendering.
  assert.equal(devices.some(item => item.device_id === 'incompatible'), true);
  assert.equal(
    selectAccountDevice(devices, 'controller'),
    null,
    'a confirmed-incompatible device is not a fallback target',
  );
});

test('automatic selection skips an incompatible peer and picks the next usable one', () => {
  const devices = [
    device('controller'),
    device('incompatible', { compatible: false }),
    device('usable'),
  ];
  assert.equal(selectAccountDevice(devices, 'controller')?.device_id, 'usable');
});

test('a preferred incompatible device never overrides the compatibility gate', () => {
  const devices = [device('controller'), device('incompatible', { compatible: false })];
  assert.equal(selectAccountDevice(devices, 'controller', 'incompatible'), null);
});

test('a preferred usable device is still honoured', () => {
  const devices = [device('controller'), device('first'), device('preferred')];
  assert.equal(selectAccountDevice(devices, 'controller', 'preferred')?.device_id, 'preferred');
});

// --- Device-page relay failure copy -----------------------------------------
//
// The devices page and the compact session list must never print a raw transport
// error. They reduce a relay/account failure through the shared classifier and
// render the matching mobile sentence. These cases assert the *user-visible*
// wording each family resolves to, so a regression that leaks "HTTP 410" or an
// exception string fails here.

const dataModule = (text) => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;

/** Transpile a source module and rewrite its imports to data: URLs. */
async function loadSource(relativePath, imports = {}) {
  const text = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  const code = transpiled.replace(
    /from\s+(['"])([^'"]+)\1/g,
    (_match, _quote, specifier) => `from ${JSON.stringify(imports[specifier] ?? import.meta.resolve(specifier))}`,
  );
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

// The copy module is plain TypeScript with a single shared import, so the test
// loads the real classifier and the real sentence mapping instead of a copy.
const relayFailureUrl = await loadSource('../../shared/relay-transport/RelayFailure.ts');
const copyUrl = await loadSource('../src/services/deviceFailureCopy.ts', {
  '../../../shared/relay-transport/RelayFailure': relayFailureUrl,
});
const { deviceFailurePresentation } = await import(copyUrl);

const contractUrl = await loadSource('../src/i18n/generatedLocaleContract.ts');
const localeRegistryUrl = await loadSource('../src/i18n/localeRegistry.ts', {
  './generatedLocaleContract': contractUrl,
});
const messagesUrl = await loadSource('../src/i18n/messages.ts', {
  './localeRegistry': localeRegistryUrl,
});
const { messages } = await import(messagesUrl);

const translate = (locale) => (key) => key
  .split('.')
  .reduce((node, part) => (node == null ? node : node[part]), messages[locale]);
const en = translate('en-US');

const AUTH_KEY = 'devices.authorizationExpired';
const LOAD_FAILED_KEY = 'devices.loadFailed';
const present = (failure) => deviceFailurePresentation(failure, LOAD_FAILED_KEY, AUTH_KEY);

test('a retired relay version (410) reads as retired wording and drops raw detail', () => {
  const { key, action } = present(new Error('List devices failed: HTTP 410'));
  const text = en(key);
  assert.equal(action, 'check-updates', 'a retired relay only offers an update path');
  assert.match(text, /retired/i);
  assert.match(text, /BitFun/, 'the sentence tells the user to update BitFun');
  assert.doesNotMatch(text, /HTTP|410|List devices failed/i, 'no raw transport detail reaches the banner');
});

test('a temporarily unavailable relay (502) reads as unavailable wording', () => {
  const { key, action } = present(new Error('List devices failed: HTTP 502'));
  const text = en(key);
  assert.equal(action, 'retry');
  assert.match(text, /temporarily unavailable/i);
  assert.doesNotMatch(text, /HTTP|502/i);
});

test('a rejected fetch reads as network wording', () => {
  const { key, action } = present(new TypeError('Failed to fetch'));
  const text = en(key);
  assert.equal(action, 'retry');
  assert.match(text, /network/i);
  assert.doesNotMatch(text, /HTTP|fetch|TypeError/i);
});

test('an outdated client refusal reads as an update instruction', () => {
  const { key, action } = present(new Error('remote control requires matching client versions'));
  const text = en(key);
  assert.equal(action, 'check-updates');
  assert.match(text, /too old|update BitFun/i);
  assert.doesNotMatch(text, /HTTP|client versions/i);
});

test('an expired account session keeps the existing sign-in sentence', () => {
  const { key, action } = present(new Error('List devices failed: HTTP 401'));
  assert.equal(action, 'sign-in');
  assert.equal(key, AUTH_KEY);
  assert.equal(en(key), en('devices.authorizationExpired'));
});

test('an unrecognised failure keeps the caller fallback sentence', () => {
  const { key } = present(new Error('List devices failed: HTTP 404'));
  assert.equal(key, LOAD_FAILED_KEY);
  assert.match(en(key), /could not load devices/i);
});

test('every classified device-failure sentence is copy in every locale, never raw detail', () => {
  const failures = [
    new Error('List devices failed: HTTP 410'),
    new Error('List devices failed: HTTP 502'),
    new TypeError('Failed to fetch'),
    new Error('remote control requires matching client versions'),
    new Error('List devices failed: HTTP 401'),
    new Error('List devices failed: HTTP 404'),
  ];
  for (const locale of Object.keys(messages)) {
    const t = translate(locale);
    for (const failure of failures) {
      const { key } = present(failure);
      const text = t(key);
      assert.ok(typeof text === 'string' && text.length > 0, `${locale} ${key} is missing`);
      assert.doesNotMatch(text, /HTTP \d|failed to fetch|List devices failed/i, `${locale} ${key} leaked raw detail`);
    }
  }
});
