#!/usr/bin/env node
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frontends = [
  { name: 'desktop', source: 'dist', resource: 'entry/src/main/resources/resfile/dist', hapPrefix: 'resources/resfile/dist/' },
  { name: 'remote', source: 'src/mobile-web/dist', resource: 'entry/src/main/resources/resfile/mobile-web/dist', hapPrefix: 'resources/resfile/mobile-web/dist/' },
];

function webFiles(root) {
  const files = new Map();
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${name}/`);
      else files.set(name, readFileSync(path.join(dir, entry.name)));
    }
  };
  walk(root);
  if (!files.has('index.html') || ![...files.keys()].some(name => name.startsWith('assets/'))) {
    throw new Error(`Web output is missing index.html or assets: ${root}`);
  }
  return files;
}

function stageFrontend(source, destination, expected) {
  mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = mkdtempSync(path.join(path.dirname(destination), 'dist-'));
  try {
    cpSync(source, temporary, { recursive: true });
    const staged = webFiles(temporary);
    if (expected.size !== staged.size || [...expected].some(([name, bytes]) => !bytes.equals(staged.get(name) ?? Buffer.alloc(0)))) {
      throw new Error(`Staged web resources differ from the build output: ${destination}`);
    }
    rmSync(destination, { recursive: true, force: true });
    renameSync(temporary, destination);
    return { directory: destination, files: staged.size };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function stageWebResources(sourceRoot, project) {
  const inputs = frontends.map(frontend => {
    const source = path.join(sourceRoot, frontend.source);
    return { ...frontend, source, expected: webFiles(source) };
  });
  return Object.fromEntries(inputs.map(frontend => [
    frontend.name,
    stageFrontend(frontend.source, path.join(project, frontend.resource), frontend.expected),
  ]));
}

export async function verifyWebResourcesHap(hap, project) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(readFileSync(hap));
  const result = {};
  for (const frontend of frontends) {
    const expected = webFiles(path.join(project, frontend.resource));
    const files = new Map();
    for (const [name, entry] of Object.entries(zip.files)) {
      if (!entry.dir && name.startsWith(frontend.hapPrefix)) {
        files.set(name.slice(frontend.hapPrefix.length), await entry.async('nodebuffer'));
      }
    }
    if (expected.size !== files.size || [...expected].some(([name, bytes]) => !bytes.equals(files.get(name) ?? Buffer.alloc(0)))) {
      throw new Error(`HAP ${frontend.name} web resources are missing or differ from the staged output`);
    }
    result[frontend.name] = { files: files.size };
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    project: { type: 'string' }, 'verify-hap': { type: 'string' },
  } });
  if (!values.project) throw new Error('--project must name the actual OHOS assembly project');
  const project = path.resolve(values.project);
  if (values['verify-hap']) {
    const result = await verifyWebResourcesHap(path.resolve(values['verify-hap']), project);
    console.log(`[web-resources] verified ${result.desktop.files} desktop and ${result.remote.files} controller HAP resources`);
  } else {
    const result = stageWebResources(repoRoot, project);
    console.log(`[web-resources] staged ${result.desktop.files} desktop and ${result.remote.files} controller resources for ${project}`);
  }
}
