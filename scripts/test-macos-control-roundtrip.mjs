import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
assert.equal(process.platform, 'darwin', 'ComputerUse tool roundtrip fixture requires macOS');
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'bitfun-control-roundtrip-'));
const run = (command, args, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, env });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
});
let fixture;
try {
  const binary = join(directory, 'input-fixture');
  const result = join(directory, 'counts.json');
  await run('xcrun', ['clang', '-fobjc-arc', '-Wall', '-Werror', 'scripts/fixtures/computer-use-roundtrip.m', '-framework', 'AppKit', '-o', binary]);
  fixture = spawn(binary, [result], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  const [pid, x, y] = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Input fixture failed to become ready')), 10_000);
    let output = '';
    fixture.once('error', error => { clearTimeout(timer); reject(error); });
    fixture.once('exit', code => { clearTimeout(timer); reject(new Error(`Input fixture exited ${code}`)); });
    fixture.stdout.on('data', chunk => {
      output += String(chunk);
      const ready = output.match(/READY (\d+) ([\d.-]+) ([\d.-]+)/);
      if (ready) { clearTimeout(timer); resolve(ready.slice(1)); }
    });
  });
  const command = process.env.BITFUN_TEST_BINARY || 'cargo';
  const args = process.env.BITFUN_TEST_BINARY ? [] : ['test', '-p', 'bitfun-desktop', '--features', 'devtools', '--test', 'computer_use_native_roundtrip'];
  await run(command, args, {
    ...process.env, BITFUN_ROUNDTRIP_FIXTURE_PID: pid, BITFUN_ROUNDTRIP_FIXTURE_X: x,
    BITFUN_ROUNDTRIP_FIXTURE_Y: y, BITFUN_ROUNDTRIP_FIXTURE_RESULT: result,
  });
  const received = JSON.parse(await readFile(result, 'utf8'));
  assert.equal(received.downs, 1);
  assert.equal(received.ups, 1);
  assert.equal(received.activations, 1);
  assert.equal(received.enters, 1);
  assert.equal(received.text, '背景输入 Test');
  console.log('PASS: tool observation/action/verification loop delivered exactly one click, semantic activation and Enter with exact Unicode text');
} finally {
  if (fixture && fixture.exitCode === null) await new Promise(resolve => { fixture.once('exit', resolve); fixture.kill('SIGTERM'); });
  await rm(directory, { recursive: true, force: true });
}
