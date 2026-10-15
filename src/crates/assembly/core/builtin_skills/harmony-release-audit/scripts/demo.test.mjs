import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDemo } from '../evals/create-demo.mjs';
import { scan } from './scan.mjs';

test('demo preserves source during inspection and selective release repair leaves other risks', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'bitfun-release-demo-'));
  try {
    const root = await createDemo(path.join(temp, 'app with spaces'));
    const page = path.join(root, 'entry/src/main/ets/pages/Index.ets');
    const baseline = await readFile(page, 'utf8');
    const before = await scan(root, { theme: 'all' });
    assert.deepEqual(new Set(before.findings.map(f => f.ruleId)), new Set(['color-contrast', 'release-readiness', 'privacy-consent']));
    assert.equal(await readFile(page, 'utf8'), baseline);
    await assert.rejects(createDemo(root), { code: 'EEXIST' });
    assert.equal(await readFile(page, 'utf8'), baseline);
    // This fixture mutation models a selected patch; it does not simulate user consent or a live Agent.
    for (const locale of ['base', 'en_US']) {
      const file = path.join(root, 'AppScope/resources', locale, 'element/string.json');
      await writeFile(file, (await readFile(file, 'utf8')).replace(' Beta', ''));
    }
    const after = await scan(root, { theme: 'all' });
    assert.deepEqual(new Set(after.findings.map(f => f.ruleId)), new Set(['color-contrast', 'privacy-consent']));
    assert.equal(await readFile(page, 'utf8'), baseline);
    assert.equal(after.rulesetVersion, before.rulesetVersion);
    assert.equal(after.schemaVersion, before.schemaVersion);
    assert.deepEqual(after.moduleScope, before.moduleScope);
    assert.deepEqual(after.coverage, before.coverage);
    assert.deepEqual(after.diagnostics, before.diagnostics);
  } finally {
    const actual = await realpath(temp);
    assert.equal(path.dirname(actual), await realpath(os.tmpdir()));
    assert.ok(path.basename(actual).startsWith('bitfun-release-demo-'));
    await rm(actual, { recursive: true });
  }
});
