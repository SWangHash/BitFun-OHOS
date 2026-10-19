import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { stageWebResources, verifyWebResourcesHap } from './ohos-remote-web-resources.mjs';

const DESKTOP_WEB_RESOURCE_PATH = 'entry/src/main/resources/resfile/dist';
const REMOTE_WEB_RESOURCE_PATH = 'entry/src/main/resources/resfile/mobile-web/dist';

function write(root, name, content) {
  const file = path.join(root, name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

test('replaces legacy browser-only staging with both frontend builds and removes stale assets', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bitfun-remote-web-'));
  try {
    const repoRoot = path.join(root, 'repo');
    const desktopSource = path.join(repoRoot, 'dist');
    const remoteSource = path.join(repoRoot, 'src/mobile-web/dist');
    const project = path.join(root, 'ohos');
    const desktopDestination = path.join(project, DESKTOP_WEB_RESOURCE_PATH);
    const remoteDestination = path.join(project, REMOTE_WEB_RESOURCE_PATH);
    write(desktopSource, 'index.html', '<title>Desktop</title><script src="./assets/desktop.js"></script>');
    write(desktopSource, 'assets/desktop.js', 'desktop frontend');
    write(remoteSource, 'index.html', '<title>BitFun Remote</title><script src="./assets/current.js"></script>');
    write(remoteSource, 'assets/current.js', 'remote controller');
    write(remoteSource, 'brand/icon.png', Buffer.from([0, 1, 2, 255]));
    mkdirSync(path.dirname(desktopDestination), { recursive: true });
    cpSync(remoteSource, desktopDestination, { recursive: true });
    write(desktopDestination, 'assets/stale.js', 'old desktop asset');
    write(remoteDestination, 'assets/stale.js', 'old remote asset');

    const result = stageWebResources(repoRoot, project);
    assert.equal(result.desktop.files, 2);
    assert.equal(result.remote.files, 3);
    assert.equal(result.desktop.directory, desktopDestination);
    assert.equal(result.remote.directory, remoteDestination);
    assert.match(readFileSync(path.join(desktopDestination, 'index.html'), 'utf8'), /Desktop/);
    assert.equal(readFileSync(path.join(desktopDestination, 'assets/desktop.js'), 'utf8'), 'desktop frontend');
    assert.equal(existsSync(path.join(desktopDestination, 'assets/current.js')), false);
    assert.equal(existsSync(path.join(desktopDestination, 'brand/icon.png')), false);
    assert.match(readFileSync(path.join(remoteDestination, 'index.html'), 'utf8'), /BitFun Remote/);
    assert.equal(readFileSync(path.join(remoteDestination, 'assets/current.js'), 'utf8'), 'remote controller');
    assert.deepEqual(readFileSync(path.join(remoteDestination, 'brand/icon.png')), Buffer.from([0, 1, 2, 255]));
    assert.equal(existsSync(path.join(desktopDestination, 'assets/stale.js')), false);
    assert.equal(existsSync(path.join(remoteDestination, 'assets/stale.js')), false);

    rmSync(path.join(desktopSource, 'index.html'));
    assert.throws(() => stageWebResources(repoRoot, project), /missing index.html or assets/);
    write(desktopSource, 'index.html', '<title>Desktop</title>');
    rmSync(remoteSource, { recursive: true });
    assert.throws(() => stageWebResources(repoRoot, project), /missing|ENOENT/);
    assert.match(readFileSync(path.join(desktopDestination, 'index.html'), 'utf8'), /Desktop/);
    assert.match(readFileSync(path.join(remoteDestination, 'index.html'), 'utf8'), /BitFun Remote/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('HAP verification requires both complete frontends and rejects mixed, stale, or damaged resources', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'bitfun-remote-web-hap-'));
  try {
    const project = path.join(root, 'ohos');
    const desktopFiles = { 'index.html': '<title>Desktop</title>', 'assets/app.js': 'desktop frontend' };
    const remoteFiles = { 'index.html': '<title>BitFun Remote</title>', 'assets/app.js': 'remote controller' };
    const desktopPrefix = 'resources/resfile/dist/';
    const remotePrefix = 'resources/resfile/mobile-web/dist/';
    for (const [name, content] of Object.entries(desktopFiles)) write(project, `${DESKTOP_WEB_RESOURCE_PATH}/${name}`, content);
    for (const [name, content] of Object.entries(remoteFiles)) write(project, `${REMOTE_WEB_RESOURCE_PATH}/${name}`, content);
    const zip = new JSZip();
    const hap = path.join(root, 'fixture.hap');
    const save = async () => writeFileSync(hap, await zip.generateAsync({ type: 'nodebuffer' }));
    const populate = (prefix, files) => {
      for (const [name, content] of Object.entries(files)) zip.file(`${prefix}${name}`, content);
    };
    populate(desktopPrefix, remoteFiles);
    await save();
    await assert.rejects(verifyWebResourcesHap(hap, project), /missing or differ/);

    populate(desktopPrefix, desktopFiles);
    populate(remotePrefix, remoteFiles);
    await save();
    const complete = await verifyWebResourcesHap(hap, project);
    assert.equal(complete.desktop.files, 2);
    assert.equal(complete.remote.files, 2);

    populate(desktopPrefix, remoteFiles);
    populate(remotePrefix, desktopFiles);
    await save();
    await assert.rejects(verifyWebResourcesHap(hap, project), /missing or differ/);
    populate(desktopPrefix, desktopFiles);
    populate(remotePrefix, remoteFiles);
    for (const [prefix, files] of [[desktopPrefix, desktopFiles], [remotePrefix, remoteFiles]]) {
      zip.remove(`${prefix}assets/app.js`);
      await save();
      await assert.rejects(verifyWebResourcesHap(hap, project), /missing or differ/);
      populate(prefix, files);

      zip.file(`${prefix}assets/stale.js`, 'stale asset');
      await save();
      await assert.rejects(verifyWebResourcesHap(hap, project), /missing or differ/);
      zip.remove(`${prefix}assets/stale.js`);

      zip.file(`${prefix}assets/app.js`, Buffer.from([0, 255, 0]));
      await save();
      await assert.rejects(verifyWebResourcesHap(hap, project), /missing or differ/);
      populate(prefix, files);
    }
    await save();
    const restored = await verifyWebResourcesHap(hap, project);
    assert.equal(restored.desktop.files, 2);
    assert.equal(restored.remote.files, 2);
    writeFileSync(hap, 'invalid HAP archive');
    await assert.rejects(verifyWebResourcesHap(hap, project));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
