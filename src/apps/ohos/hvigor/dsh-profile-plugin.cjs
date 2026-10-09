const { execFileSync } = require('node:child_process');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');

function dshProfilePlugin(hvigor, hapPluginId) {
  return {
    pluginId: 'bitfun-dsh-profile',
    apply(node) {
      const moduleDir = node.getNodePath();
      const projectDir = path.dirname(moduleDir);
      const contextPath = path.join(projectDir, '.bitfun-build-context.json');
      const repo = existsSync(contextPath)
        ? JSON.parse(readFileSync(contextPath, 'utf8')).repo
        : path.resolve(projectDir, '../../..');
      const script = path.join(repo, 'scripts/ohos-dsh-resources.mjs');
      const run = (args) => execFileSync(process.execPath, [script, '--project', projectDir, ...args], {
        cwd: repo, stdio: 'inherit', windowsHide: true,
      });
      hvigor.nodesEvaluated(() => {
        const context = node.getContext(hapPluginId);
        const targets = [];
        context.targets(target => targets.push(target.getTargetName()));
        if (!targets.length) throw new Error('No HAP target is available for DSH resource preparation');
        node.registerTask({
          name: 'prepareDshProfile', run: () => run([]),
          postDependencies: targets.map(target => `${target}@PreBuild`),
        });
        for (const target of targets) {
          node.registerTask({
            name: `${target}@VerifyDshProfile`,
            dependencies: [`${target}@PackageHap`],
            postDependencies: [`${target}@SignHap`, 'assembleHap'],
            run() {
              const output = path.join(moduleDir, 'build', target, 'outputs', target);
              const haps = readdirSync(output).filter(name => name.endsWith('-unsigned.hap'));
              if (haps.length !== 1) throw new Error(`Expected one unsigned HAP in ${output}`);
              run(['--verify-hap', path.join(output, haps[0])]);
            },
          });
        }
      });
    },
  };
}
module.exports = { dshProfilePlugin };
