import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/services/RuntimeFileDownload.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { downloadRuntimeFile } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('download waits for disk backpressure and commits only after all chunks', async () => {
  const events = [];
  let release;
  const disk = new Promise(resolve => { release = resolve; });
  const writer = { async write(bytes) { events.push(bytes[0]); await disk; }, async close() { events.push('close'); }, async abort() { events.push('abort'); } };
  const run = downloadRuntimeFile({ async streamFile(path, sink) {
    await sink(new Uint8Array([1]));
    events.push('next-read');
    await sink(new Uint8Array([2]));
    return { name: 'file', mimeType: 'application/octet-stream' };
  } }, '/runtime/file', { isCurrent: () => true }, { async showSaveFilePicker() { return { async createWritable() { return writer; } }; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [1]);
  release();
  await run;
  assert.deepEqual(events, [1, 'next-read', 2, 'close']);
});

test('target switch while picker is open cannot read the newly selected runtime', async () => {
  let current = true;
  await assert.rejects(downloadRuntimeFile({ async streamFile() { assert.fail('must not read'); } }, '/old/file', { isCurrent: () => current }, {
    async showSaveFilePicker() { current = false; return { async createWritable() { assert.fail('must not open sink'); } }; },
  }), /target changed/);
});

test('changed source aborts partial destination rather than closing it successfully', async () => {
  const events = [];
  await assert.rejects(downloadRuntimeFile({ async streamFile(path, sink) { await sink(new Uint8Array([1])); throw Error('File changed'); } }, '/runtime/file', { isCurrent: () => true }, {
    async showSaveFilePicker() { return { async createWritable() { return {
      async write() { events.push('write'); }, async close() { events.push('close'); }, async abort() { events.push('abort'); },
    }; } }; },
  }), /File changed/);
  assert.deepEqual(events, ['write', 'abort']);
});

test('closing the system picker is a normal cancellation without remote reads', async () => {
  await downloadRuntimeFile({ async streamFile() { assert.fail('must not read'); } }, '/runtime/file', { isCurrent: () => true }, {
    async showSaveFilePicker() { throw new DOMException('User cancelled', 'AbortError'); },
  });
});
