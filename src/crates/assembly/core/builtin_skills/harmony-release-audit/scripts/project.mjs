import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import JSON5 from './vendor/json5.mjs';
import { lex, literal } from './syntax.mjs';
import { rgba } from './colors.mjs';

const skip = new Set(['.git', '.deveco', '.codex', '.hvigor', '.idea', 'build', 'node_modules', 'oh_modules', 'ohosTest', 'test', 'tests', 'review-mvp', '.review-report']);
export const relative = (root, file) => path.relative(root, file).split(path.sep).join('/');
export const lineAt = (source, offset) => 1 + source.slice(0, Math.max(0, offset)).split('\n').length - 1;
const within = (file, dir) => file === dir || file.startsWith(dir + path.sep);

async function walk(dir, files = []) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (item.isSymbolicLink()) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory() && !skip.has(item.name)) await walk(full, files);
    else if (item.isFile()) files.push(full);
  }
  return files;
}

export async function loadProject(rootInput) {
  const root = path.resolve(rootInput), files = (await walk(root)).sort(), contents = new Map(), diagnostics = [];
  const read = async file => { if (!contents.has(file)) contents.set(file, await readFile(file, 'utf8')); return contents.get(file); };
  const parse = async file => {
    try { return JSON5.parse(await read(file)); }
    catch (e) { diagnostics.push({ file: relative(root, file), line: e.lineNumber ?? 1, reason: 'config-parse-error', detail: '配置无法解析；该范围不得判定通过。' }); return null; }
  };
  if (!files.includes(path.join(root, 'build-profile.json5'))) throw new Error('工程根目录缺少 build-profile.json5');
  const build = await parse(path.join(root, 'build-profile.json5'));
  if (!build) throw new Error('根目录 build-profile.json5 无法解析');
  const registered = Array.isArray(build.modules) && build.modules.length ? build.modules.map(x => path.resolve(root, x.srcPath ?? '')) : null;
  const modules = [], scopeNotes = [];
  for (const file of files.filter(f => /[\\/]src[\\/]main[\\/]module\.json5$/.test(f))) {
    const dir = path.dirname(path.dirname(path.dirname(file))), config = await parse(file);
    modules.push({ root: dir, file, config, excluded: true, deps: [], includedVia: [] });
  }
  // Minimal test projects may omit module descriptors; still inspect src/main and
  // explicitly report missing module metadata instead of dropping all their code.
  for (const file of files.filter(f => /[\\/]src[\\/]main[\\/].+\.(ets|ts)$/.test(f))) {
    const dir = file.slice(0, file.indexOf(`${path.sep}src${path.sep}main${path.sep}`));
    if (!modules.some(m => m.root === dir)) {
      modules.push({ root: dir, file: null, config: null, excluded: true, deps: [], includedVia: [] });
      diagnostics.push({ file: relative(root, dir), line: 1, reason: 'module-metadata-missing', detail: '模块未提供可读取的 deviceTypes，暂按源码候选范围检查。' });
    }
  }
  for (const dir of registered ?? []) {
    if (!modules.some(m => m.root === dir)) {
      diagnostics.push({ file: relative(root, dir), line: 1, reason: 'registered-module-not-discovered', detail: '已注册模块未发现可读取的模块描述或源码；该模块属于覆盖缺口。' });
    }
  }
  const isRegistered = m => !registered || registered.includes(m.root);
  const moduleType = m => m.config?.module?.type;
  const deviceTypes = m => m.config?.module?.deviceTypes;
  const knownTypes = m => Array.isArray(deviceTypes(m)) && deviceTypes(m).length > 0;
  const excludesPhone = m => knownTypes(m) && !deviceTypes(m).includes('phone');
  const hap = m => ['entry', 'feature'].includes(moduleType(m));
  const queue = [];
  const include = (module, reason, parent = null) => {
    if (parent && !module.includedVia.includes(parent.root)) module.includedVia.push(parent.root);
    if (!module.excluded) return;
    module.excluded = false;
    module.scopeReason = reason;
    queue.push(module);
  };
  for (const module of modules.filter(isRegistered)) {
    if (hap(module) && !excludesPhone(module)) {
      include(module, knownTypes(module) ? 'phone-hap' : 'hap-device-types-unknown');
    } else if (!['entry', 'feature', 'har', 'shared'].includes(moduleType(module)) && !excludesPhone(module)) {
      include(module, 'module-type-unknown');
    }
  }
  // A standalone library project has no HAP from which to prove reachability.
  // Keep its phone-compatible sources inspectable, but expose the missing root.
  if (!queue.length && !modules.some(m => isRegistered(m) && hap(m))) {
    for (const module of modules.filter(m => isRegistered(m) && !excludesPhone(m))) include(module, 'standalone-library-fallback');
    scopeNotes.push({ file: 'build-profile.json5', line: 1, reason: 'phone-hap-not-found', detail: '未找到手机 HAP 入口；当前仅为保守源码候选范围，不能证明发布可达性。' });
  }
  if (!registered) scopeNotes.push({ file: 'build-profile.json5', line: 1, reason: 'module-registration-unknown', detail: '未提供有效模块注册列表，使用发现的模块进行保守检查。' });

  // Traverse before filtering resources or sources. A reached HAR contributes
  // code to the consumer even when its own deviceTypes does not list phone.
  for (let i = 0; i < queue.length; i++) {
    const module = queue[i];
    const file = path.join(module.root, 'oh-package.json5');
    if (!files.includes(file)) continue;
    const pkg = await parse(file);
    for (const field of ['dependencies', 'dynamicDependencies']) {
      for (const [name, spec] of Object.entries(pkg?.[field] ?? {})) {
        if (typeof spec !== 'string') continue;
        const local = spec.replace(/^file:/, '');
        if (!spec.startsWith('file:') && !local.startsWith('.') && !path.isAbsolute(local)) continue;
        const target = path.resolve(module.root, local);
        const dependency = modules.find(m => m.root === target);
        if (!dependency) {
          scopeNotes.push({ file: relative(root, file), line: lineAt(contents.get(file), contents.get(file).indexOf(name)), reason: 'local-dependency-source-unavailable', dependency: name, target: relative(root, target), detail: '本地依赖未发现源码模块（可能是归档、工程外依赖或缺失路径）；未扫描其内部代码。' });
          continue;
        }
        if (!module.deps.includes(target)) module.deps.push(target);
        include(dependency, field === 'dynamicDependencies' ? 'phone-dynamic-dependency' : 'phone-local-dependency', module);
      }
    }
  }
  for (const module of modules) {
    if (module.excluded) {
      module.scopeReason = !isRegistered(module) ? 'unregistered-and-unreferenced' : hap(module) && excludesPhone(module) ? 'non-phone-hap' : 'not-in-phone-dependency-graph';
    } else {
      if (!knownTypes(module) || !moduleType(module)) scopeNotes.push({ file: relative(root, module.file ?? module.root), line: 1, reason: 'module-scope-metadata-incomplete', detail: '模块类型或设备声明不完整，保守纳入检查；需核实构建入口。' });
      if (module.includedVia.length && excludesPhone(module)) scopeNotes.push({ file: relative(root, module.file ?? module.root), line: 1, reason: 'dependency-device-types-exclude-phone', detail: '设备声明未含 phone，但已被手机候选入口的本地依赖链引用，仍纳入源码检查；构建适用性需复核。' });
    }
  }
  const moduleScope = modules.map(m => ({ path: relative(root, m.root), type: moduleType(m) ?? null, deviceTypes: deviceTypes(m) ?? null, included: !m.excluded, reason: m.scopeReason, includedVia: m.includedVia.map(dir => relative(root, dir)).sort() }));
  const owner = file => modules.filter(m => within(file, m.root)).sort((a, b) => b.root.length - a.root.length)[0];
  const sourceFiles = files.filter(f => /[\\/]src[\\/]main[\\/].+\.(ets|ts)$/.test(f) && owner(f)?.excluded === false);
  const resourceFiles = files.filter(f => /[\\/]resources[\\/].+[\\/]element[\\/](color|string)\.json$/.test(f) &&
    (within(f, path.join(root, 'AppScope')) || (/[\\/]src[\\/]main[\\/]resources[\\/]/.test(f) && owner(f)?.excluded === false)));
  const resources = [];
  for (const file of resourceFiles) {
    const data = await parse(file); if (!data) continue;
    const source = contents.get(file), t = lex(source).tokens;
    const kind = path.basename(file).split('.')[0];
    for (const item of data[kind] ?? []) {
      if (typeof item.name !== 'string' || typeof item.value !== 'string') continue;
      const nameIndex = t.findIndex((x, i) => x.value === item.name && t[i - 1]?.text === ':' && (t[i - 2]?.value ?? t[i - 2]?.text) === 'name');
      const valueIndex = t.findIndex((x, i) => i > nameIndex && (x.value ?? x.text) === 'value' && t[i + 1]?.text === ':');
      const offset = valueIndex < 0 ? t[nameIndex]?.start ?? 0 : t[valueIndex + 2].start;
      const qualifier = path.basename(path.dirname(path.dirname(file)));
      resources.push({ ...item, kind, file, qualifier, owner: owner(file)?.root ?? path.join(root, 'AppScope'), offset, line: lineAt(source, offset) });
    }
  }
  for (const file of sourceFiles) await read(file);
  const appFile = path.join(root, 'AppScope', 'app.json5');
  const app = files.includes(appFile) ? await parse(appFile) : null;

  function lookup(kind, name, from) {
    const own = owner(from)?.root ?? path.join(root, 'AppScope');
    const levels = [[own]], seen = new Set([own]);
    let frontier = [own];
    while (frontier.length) {
      const next = frontier.flatMap(r => modules.find(m => m.root === r)?.deps ?? []).filter(r => !seen.has(r));
      next.forEach(r => seen.add(r)); if (next.length) levels.push([...new Set(next)]); frontier = [...new Set(next)];
    }
    if (own !== path.join(root, 'AppScope')) levels.push([path.join(root, 'AppScope')]);
    for (const level of levels) {
      const matches = resources.filter(r => r.kind === kind && r.name === name && level.includes(r.owner));
      if (matches.length) return matches;
    }
    return [];
  }
  function resolveColor(expression, from, theme, seen = new Set()) {
    const direct = rgba(expression);
    if (direct) return { color: direct, expression, evidence: [] };
    const match = expression?.trim().match(/^\$r\s*\(\s*['"]app\.color\.([\w]+)['"]\s*\)$/);
    if (!match) return { reason: 'dynamic-or-unsupported-color' };
    const name = match[1];
    if (seen.has(name)) return { reason: 'cyclic-color-resource' };
    const all = lookup('color', name, from);
    if (!all.length) return { reason: 'color-resource-not-found-in-module-dependencies' };
    if (new Set(all.map(r => r.owner)).size > 1) return { reason: 'ambiguous-dependency-resource' };
    if (all.some(r => !['base', 'dark'].includes(r.qualifier))) return { reason: 'qualified-color-resource-requires-device-context' };
    const selected = theme === 'dark' && all.some(r => r.qualifier === 'dark') ? all.filter(r => r.qualifier === 'dark') : all.filter(r => r.qualifier === 'base');
    if (selected.length !== 1) return { reason: 'missing-or-duplicate-color-resource' };
    const item = selected[0], nextSeen = new Set(seen); nextSeen.add(name);
    const alias = item.value.match(/^\$color:([\w]+)$/);
    const resolved = alias ? resolveColor(`$r('app.color.${alias[1]}')`, item.file, theme, nextSeen) : { color: rgba(item.value) };
    if (!resolved.color) return { reason: resolved.reason ?? 'unsupported-color-resource-value' };
    return { color: resolved.color, expression: item.value, evidence: [{ file: relative(root, item.file), line: item.line, name, value: item.value, qualifier: item.qualifier }, ...(resolved.evidence ?? [])] };
  }
  function resolveText(expression, from) {
    const value = literal(expression);
    if (value !== null) return [{ value, file: from, offset: null }];
    const match = expression.trim().match(/^\$r\s*\(\s*['"]app\.string\.([\w]+)['"]/);
    return match ? lookup('string', match[1], from) : [];
  }
  return { root, contents, diagnostics, scopeNotes, moduleScope, modules, sourceFiles, resourceFiles, resources, owner, lookup, resolveColor, resolveText, app, appFile };
}
