import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../../shared/relay-transport/InvalidationSync.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { InvalidationSync } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));

test('notification bursts produce one current read and one successor without overlap', async () => {
  let reads = 0;
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const owner = new InvalidationSync(async () => { reads++; if (reads === 1) await blocked; });
  const done = owner.invalidate();
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 100; i++) owner.invalidate();
  assert.equal(reads, 1);
  release();
  await done;
  assert.equal(reads, 2);
});

test('disposing an owner suppresses queued successor and future invalidations', async () => {
  let release, reads = 0;
  const blocked = new Promise(resolve => { release = resolve; });
  const owner = new InvalidationSync(async () => { reads++; await blocked; });
  const done = owner.invalidate();
  await new Promise(resolve => setImmediate(resolve));
  owner.invalidate(); owner.stop(); release(); await done; await owner.invalidate();
  assert.equal(reads, 1);
});
