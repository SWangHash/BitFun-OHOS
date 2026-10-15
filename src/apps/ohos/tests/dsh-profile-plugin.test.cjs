const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, '../hvigor/dsh-profile-plugin.cjs'), 'utf8');

for (const staged of [false, true]) {
  test(`prepares before resources and verifies before signing (${staged ? 'staged' : 'direct'})`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'bitfun-dsh-hvigor-'));
    try {
      const repo = path.join(root, 'source');
      const project = staged ? path.join(root, 'stage') : path.join(repo, 'src/apps/ohos');
      const moduleDir = path.join(project, 'entry');
      const output = path.join(moduleDir, 'build/default/outputs/default');
      mkdirSync(output, { recursive: true });
      if (staged) writeFileSync(path.join(project, '.bitfun-build-context.json'), JSON.stringify({ repo }));
      const hap = path.join(output, 'entry-default-unsigned.hap');
      writeFileSync(hap, 'fixture');
      const calls = [];
      let failure;
      const module = { exports: {} };
      vm.runInNewContext(source, {
        module, process,
        require: name => name === 'node:child_process'
          ? { execFileSync: (...args) => { calls.push(args); if (failure) throw failure; } }
          : require(name),
      });
      let evaluated;
      const tasks = new Map();
      module.exports.dshProfilePlugin({ nodesEvaluated: callback => { evaluated = callback; } }, 'hap').apply({
        getNodePath: () => moduleDir,
        getContext: id => {
          assert.equal(id, 'hap');
          return { targets: callback => callback({ getTargetName: () => 'default' }) };
        },
        registerTask: task => tasks.set(task.name, task),
      });
      evaluated();
      const prepare = tasks.get('prepareDshProfile');
      const verify = tasks.get('default@VerifyDshProfile');
      assert.deepEqual(Array.from(prepare.postDependencies), ['default@PreBuild']);
      assert.deepEqual(Array.from(verify.dependencies), ['default@PackageHap']);
      assert.deepEqual(Array.from(verify.postDependencies), ['default@SignHap', 'assembleHap']);
      prepare.run();
      verify.run();
      const script = path.join(repo, 'scripts/ohos-dsh-resources.mjs');
      assert.deepEqual(Array.from(calls[0][1]), [script, '--project', project]);
      assert.deepEqual(Array.from(calls[1][1]), [script, '--project', project, '--verify-hap', hap]);
      assert.equal(calls[0][2].cwd, repo);
      failure = new Error('profile integrity mismatch');
      assert.throws(() => prepare.run(), /integrity mismatch/);
      assert.throws(() => verify.run(), /integrity mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
