const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { build } = require('./document.cjs');

test('isolated native wrapper accepts only its frame and approved local capabilities', () => {
  const html = build('<html><head></head><body></body></html>', 'zh-CN');
  assert.match(html, /sandbox="allow-scripts"/);
  assert.match(html, /connect-src 'none'/);
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const requests = [];
  const replies = [];
  const timers = new Map();
  const listeners = {};
  let loaded;
  const frame = { dataset: {}, contentWindow: { postMessage: (value) => replies.push(value) }, addEventListener(name, callback) { loaded = callback; } };
  const window = { addEventListener: (name, handler) => { listeners[name] = handler; } };
  vm.runInNewContext(script, {
    window, document: { querySelector: () => frame },
    miniappNative: { request: (value) => requests.push(JSON.parse(value)) },
    URL: { createObjectURL: () => 'blob:local' }, Blob: class {},
    setTimeout: (callback) => { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  loaded();
  assert.equal(frame.dataset.loaded, 'true');
  assert.equal(replies.at(-1).event, 'activate');
  const send = (method, source = frame.contentWindow) => listeners.message({ source, data: { id: method, method, params: { key: 'stats' } } });
  send('storage.get', {});
  assert.equal(requests.length, 0);
  send('shell.exec');
  assert.equal(requests.length, 0);
  assert.ok(replies.at(-1).error);
  send('storage.get');
  assert.equal(requests[0].method, 'storage.get');
  window.__miniappReply({ id: 'storage.get', result: { wins: 2 } });
  assert.equal(replies.at(-1).result.wins, 2);
  send('storage.set');
  [...timers.values()][0]();
  assert.ok(replies.at(-1).error.message);
});
