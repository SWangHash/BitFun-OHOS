#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadProject, relative, lineAt } from './project.mjs';
import { parseUI, firstArgument, objectProperty, initializer } from './syntax.mjs';
import { composite, ratio, contrastDetails } from './colors.mjs';
export { contrast } from './colors.mjs';

const marker = /(?:\b(?:test|demo|beta|vconsole)\b|内测|测试)/i;
const privacy = /隐私|个人信息|privacy|consent|privacyAgreement/i;
const consentName = /agree|consent|privacy|policy|protocol/i;
const implicit = /(?:登录|注册|继续|使用)(?:即|就)(?:代表|视为|表示|意味着)?(?:您|你)?(?:已)?(?:阅读并)?同意/;
const interfering = new Set(['backgroundImage', 'background', 'linearGradient', 'radialGradient', 'sweepGradient', 'blendMode', 'colorBlend', 'foregroundColor', 'opacity', 'filter', 'invert', 'brightness', 'contrast', 'grayscale', 'sepia', 'hueRotate', 'saturate', 'zIndex', 'position', 'offset', 'translate', 'transform', 'overlay']);
const ruleNames = new Map([
  ['color-contrast', '色彩对比度'],
  ['release-readiness', '发布完整性'],
  ['privacy-consent', '隐私主动同意'],
]);

function backdrop(node, project, file, theme, ui) {
  const ancestry = []; for (let p = node; p; p = p.parent) ancestry.push(p);
  for (const p of ancestry) {
    if (!p.known) return { reason: 'custom-component-background-boundary' };
    if (p.customStyle) return { reason: 'custom-style-needs-expansion' };
    if (['Stack', 'RelativeContainer'].includes(p.name)) return { reason: 'overlapping-container-needs-visual-or-structural-review' };
    for (const [method, prop] of p.props) if (interfering.has(method) && !(method === 'opacity' && prop.expression === '1')) return { reason: `render-effect-${method}`, at: prop.start };
    if ([...p.props.keys()].some(name => !name.match(/^[a-z]/))) return { reason: 'custom-style-may-override-colors' };
  }
  const layers = [], evidence = [];
  for (const p of ancestry) {
    if (p.bodyStart !== null && ui.nodes.some(sibling => sibling !== node && p.bodyStart <= sibling.start && sibling.end <= p.bodyEnd &&
      [...sibling.props].some(([key, prop]) => ['position', 'offset', 'translate', 'transform', 'overlay'].includes(key) || (key === 'margin' && /(?:^|[(:,\s])-\s*\d/.test(prop.expression))))) return { reason: 'positioned-or-negative-margin-content-may-overlap' };
    const fill = p.props.get('backgroundColor'); if (!fill) continue;
    const resolved = project.resolveColor(fill.expression, file, theme);
    if (!resolved.color) return resolved;
    layers.push(resolved.color);
    evidence.push({ file: relative(project.root, file), line: lineAt(project.contents.get(file), fill.start), expression: fill.expression, component: p.name, source: p === node ? 'self' : 'ancestor', resources: resolved.evidence });
    if (resolved.color.a === 1) {
      let color = layers.at(-1);
      for (let i = layers.length - 2; i >= 0; i--) color = composite(layers[i], color);
      return { color, evidence, inherited: !node.props.has('backgroundColor') };
    }
  }
  return { reason: layers.length ? 'transparent-background-without-known-backdrop' : 'background-not-found-in-local-component-tree' };
}

export async function scan(rootInput, options = {}) {
  const themeOption = options.theme ?? 'all';
  if (!['all', 'light', 'dark'].includes(themeOption)) throw new Error('theme 必须为 light、dark 或 all');
  const themes = themeOption === 'all' ? ['light', 'dark'] : [themeOption];
  const p = await loadProject(rootInput), findings = [], unresolved = [], contrastChecks = [], reviewTargets = [], usedStringResources = new Set();
  const scope = { device: 'phone', themes, releaseReachability: 'not-proven', rules: ['color-contrast', 'release-readiness', 'privacy-consent'] };
  const coverage = { textNodes: 0, contrastStates: 0, evaluatedContrastStates: 0, inheritedBackgroundStates: 0, unresolvedContrastStates: 0, privacyControls: 0, privacyStatesResolved: 0, uiTextSinks: 0, dynamicTextSinks: 0, imageAndSymbolNodes: 0 };
  const location = (file, offset) => ({ file: relative(p.root, file), line: lineAt(p.contents.get(file) ?? '', offset) });
  const add = (ruleId, subrule, file, offset, fields) => findings.push({ ruleId, subrule, status: '疑似风险', ...location(file, offset), ...fields });
  const gap = (ruleId, file, offset, reason, extra = {}) => unresolved.push({ ruleId, ...location(file, offset), reason, ...extra });
  const strings = (expr, file) => {
    const values = p.resolveText(expr, file);
    values.filter(v => v.offset !== null).forEach(v => usedStringResources.add(`${v.file}:${v.name}`));
    return values;
  };

  function checkText(value, file, offset, evidence) {
    if (marker.test(value)) add('release-readiness', 'visible-test-marker', file, offset, { evidence: { value, ...evidence }, reason: '界面文案含测试标识；需确认发布入口可达性及业务语义。', suggestion: '核对正式界面的文案和该入口是否随发布版本开放。' });
    if (implicit.test(value)) add('privacy-consent', 'implicit-consent-copy', file, offset, { evidence: { value, ...evidence }, reason: '界面含可能代替主动同意的表述；需同时核对交互前置条件。', suggestion: '检查是否提供未预选的主动同意操作，以及拒绝后的行为。' });
  }
  function label(value, file, offset) {
    if (typeof value !== 'string') return;
    if (value.startsWith('$string:')) {
      for (const res of p.lookup('string', value.slice(8), file)) {
        usedStringResources.add(`${res.file}:${res.name}`);
        checkText(res.value, file, offset, { context: 'application-label', resource: { ...location(res.file, res.offset), qualifier: res.qualifier, name: res.name } });
      }
    } else checkText(value, file, offset, { context: 'application-label' });
  }
  if (p.app?.app) {
    const appSource = p.contents.get(p.appFile);
    label(p.app.app.label, p.appFile, appSource.indexOf('label'));
    const bundle = p.app.app.bundleName;
    if (typeof bundle === 'string' && bundle.split(/[._-]|(?=[A-Z])/).some(s => /^(?:test(?:app)?|demo|beta|vconsole)$/i.test(s))) add('release-readiness', 'bundle-test-marker', p.appFile, appSource.indexOf('bundleName'), { evidence: { value: bundle }, reason: '应用包名包含独立测试标识，需核对发布配置。', suggestion: '确认这是正式包名；正常英文单词中的相同字母不构成此项证据。' });
  }
  for (const module of p.modules.filter(m => !m.excluded && m.config)) {
    const m = module.config.module;
    for (const ability of m?.abilities ?? []) label(ability.label, module.file, p.contents.get(module.file).indexOf('label'));
  }

  for (const file of p.sourceFiles) {
    const source = p.contents.get(file), ui = parseUI(source);
    if (ui.errors.length) {
      for (const error of ui.errors) gap('all', file, error.start, error.reason);
      continue;
    }
    const texts = new Map();
    let hasDynamicText = false;
    for (const node of ui.nodes) {
      if (['Image', 'SymbolGlyph'].includes(node.name)) coverage.imageAndSymbolNodes++;
      const expressions = [];
      if (['Text', 'Span', 'Button'].includes(node.name)) expressions.push(firstArgument(node.arg));
      for (const key of ['title', 'subtitle']) if (node.props.has(key)) expressions.push(node.props.get(key).expression);
      const resolved = expressions.flatMap(expr => strings(expr, file)); texts.set(node, resolved);
      for (const expr of expressions) coverage.uiTextSinks++;
      if (expressions.length && !resolved.length) { hasDynamicText = true; coverage.dynamicTextSinks += expressions.length; }
      for (const text of resolved) checkText(text.value, file, node.start, { component: node.name, resource: text.offset === null ? null : { ...location(text.file, text.offset), name: text.name, qualifier: text.qualifier } });
    }
    if (hasDynamicText) {
      const linkedValues = new Set([...texts.values()].flat().map(x => x.value));
      for (const token of ui.tokens.filter(t => t.kind === 'string' && typeof t.value === 'string' && !linkedValues.has(t.value))) {
        if (privacy.test(token.value) || implicit.test(token.value) || marker.test(token.value)) reviewTargets.push({ ruleId: privacy.test(token.value) || implicit.test(token.value) ? 'privacy-consent' : 'release-readiness', ...location(file, token.start), kind: 'unlinked-copy-with-dynamic-ui', value: token.value, reason: '同文件含动态 UI 文案；请追踪该文字是否来自数组/状态并实际显示，日志和未引用定义不能当作违规。' });
      }
    }

    for (const node of ui.nodes.filter(n => n.name === 'Text')) {
      coverage.textNodes++;
      for (const theme of themes) {
        coverage.contrastStates++;
        const foreground = node.props.get('fontColor');
        let fg = foreground ? p.resolveColor(foreground.expression, file, theme) : { reason: 'foreground-not-explicit-system-or-inherited-style' };
        if (node.customStyle) fg = { reason: 'custom-style-needs-expansion' };
        const bg = backdrop(node, p, file, theme, ui);
        if (!fg.color || !bg.color) {
          coverage.unresolvedContrastStates++;
          gap('color-contrast', file, node.start, fg.reason ?? bg.reason, { theme, component: 'Text', foreground: foreground?.expression ?? null });
          continue;
        }
        const value = ratio(fg.color, bg.color);
        coverage.evaluatedContrastStates++;
        if (bg.inherited) coverage.inheritedBackgroundStates++;
        const check = { ...location(file, node.start), theme, ratio: value, text: texts.get(node).map(t => t.value), foreground: { expression: foreground.expression, ...location(file, foreground.start), resources: fg.evidence }, background: bg.evidence, resolvedForeground: fg.color, resolvedBackground: bg.color, compositedForeground: composite(fg.color, bg.color), outcome: value > 4.5 ? 'above-both-thresholds' : value > 3 ? 'body-role-needs-review' : 'below-both-thresholds' };
        contrastChecks.push(check);
        if (value <= 4.5) add('color-contrast', 'contrast', file, node.start, { theme, sourceVerdict: check.outcome, evidence: check, reason: value <= 3 ? '该源码颜色组合未超过 3:1；需确认渲染路径和可见性。' : '该组合未超过正文 4.5:1；需根据页面用途确认文字角色，不能仅凭字号判定。', suggestion: '确认背景和文字角色后调整配色；用 --contrast 重新计算，勿用四舍五入后的比值判定。' });
      }
    }

    const controls = ui.nodes.filter(n => ['Checkbox', 'Toggle'].includes(n.name));
    const relevantPrivacyNodes = ui.nodes.filter(n => texts.get(n)?.some(t => privacy.test(t.value)));
    for (const node of relevantPrivacyNodes) reviewTargets.push({ ruleId: 'privacy-consent', ...location(file, node.start), kind: 'privacy-ui-context', reason: '核对这是隐私入口、同意界面还是普通说明；入口文字本身不证明征求同意。' });
    for (const node of controls) {
      const binding = node.props.get('select')?.expression ?? objectProperty(node.arg, 'isOn');
      const ownName = objectProperty(node.arg, 'name') ?? '';
      const siblings = controls.filter(n => n.parent === node.parent && n.owner === node.owner);
      const associatedLabel = relevantPrivacyNodes.some(n => n.parent === node.parent && n.owner === node.owner);
      const related = /privacy|consent|policy|protocol/i.test(ownName + ' ' + (binding ?? '')) || (siblings.length === 1 && associatedLabel);
      if (!related) {
        if (consentName.test(ownName + ' ' + (binding ?? ''))) reviewTargets.push({ ruleId: 'privacy-consent', ...location(file, node.start), kind: 'ambiguous-consent-association', reason: '变量名似乎与同意有关，但尚未关联隐私文案；不可仅凭名称认定违规。' });
        continue;
      }
      coverage.privacyControls++;
      if (!binding) { gap('privacy-consent', file, node.start, 'selection-binding-not-resolved'); continue; }
      const state = initializer(ui, node, binding);
      const initial = state?.value ?? binding;
      const evidence = { component: node.name, binding, initial: initial.slice(0, 240), declaration: state ? location(file, state.start) : null, privacyLabelInSameContainer: associatedLabel };
      if (initial === 'true' || initial === 'false') coverage.privacyStatesResolved++;
      if (initial === 'true') add('privacy-consent', 'default-selected', file, node.start, { evidence, reason: '与隐私关联的控件绑定 true 初始状态；需核对生命周期覆盖、已同意恢复状态和首次展示路径。', suggestion: '首次征求同意时从未选中开始；已保存的同意记录与首次默认值分开处理。' });
      else if (initial !== 'false') gap('privacy-consent', file, node.start, 'dynamic-or-persisted-consent-initial-state', { evidence });
      if (state) {
        const t = ui.tokens;
        for (let i = 0; i < t.length - 2; i++) {
          if (t[i].text !== state.name || t[i + 1].text !== '=' || t[i + 2].text !== 'true') continue;
          if (t[i].start === state.start) continue;
          if (node.owner && !(node.owner.open < i && i < node.owner.close)) continue;
          const drivenByUI = ui.nodes.some(n => [...n.props].some(([name, prop]) => ['onClick', 'onChange'].includes(name) && prop.start < t[i].start && t[i].end < prop.end));
          if (drivenByUI) continue;
          add('privacy-consent', 'consent-assignment-needs-flow-review', file, t[i].start, { evidence: { state: state.name, boundControl: location(file, node.start) }, reason: '同意状态在直接 UI 回调之外被赋为 true；需追踪调用者，不能把赋值直接认定为违规。', suggestion: '核对是否由用户主动操作触发，或在页面加载时自动执行。' });
        }
      }
    }
    for (let i = 0; i < ui.tokens.length; i++) {
      const t = ui.tokens;
      if (t[i].text !== 'AlertDialog' || t[i + 1]?.text !== '.' || t[i + 2]?.text !== 'show' || t[i + 3]?.text !== '(') continue;
      const close = ui.pairs.get(i + 3); if (close === undefined) continue;
      const expression = source.slice(t[i + 3].end, t[close].start);
      const message = objectProperty(expression, 'message');
      const values = message ? strings(message, file) : [];
      if (values.some(v => privacy.test(v.value))) reviewTargets.push({ ruleId: 'privacy-consent', ...location(file, t[i].start), kind: 'privacy-dialog', reason: '检查同意/拒绝按钮、取消路径及状态写入；不能因缺少某个按钮字段直接确认违规。' });
    }
  }
  const dedup = new Map();
  for (const f of findings) {
    const key = [f.ruleId, f.subrule, f.file, f.line, f.theme ?? '', f.evidence?.value ?? ''].join('|');
    if (!dedup.has(key)) dedup.set(key, { id: createHash('sha256').update(key).digest('hex').slice(0, 12), ...f });
  }
  const sort = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || (a.ruleId ?? '').localeCompare(b.ruleId ?? '') || (a.theme ?? '').localeCompare(b.theme ?? '');
  const result = [...dedup.values()].sort(sort);
  return { schemaVersion: '4', rulesetVersion: 'phone-source-mvp-0.4', generatedAt: new Date().toISOString(), project: p.root, scope, scannedFiles: p.sourceFiles.length + p.resourceFiles.length + (p.app ? 1 : 0), skippedNonPhoneModules: p.moduleScope.filter(m => !m.included && Array.isArray(m.deviceTypes) && m.deviceTypes.length && !m.deviceTypes.includes('phone')).length, excludedModules: p.modules.filter(m => m.excluded).length, moduleScope: p.moduleScope, scopeNotes: p.scopeNotes, coverage, findings: result, contrastChecks: contrastChecks.sort(sort), unresolved: unresolved.sort(sort), reviewTargets: reviewTargets.sort(sort), diagnostics: p.diagnostics, limitations: ['源码候选范围不等于已证明正式发布可达范围；手机 HAP 的本地直接和传递依赖均纳入，产品构建条件与动态依赖仍需复核。', '工程外依赖、归档 HAR/HSP 和未解析的导入方式不在自动源码覆盖范围，已识别的缺口见 scopeNotes。', '组件词法模型不是完整 ArkTS 编译器；跨组件背景、动态表达式、图片/图标、复杂重叠需复核。', '隐私无拒绝选项和非用户自愿同意需要按 reviewTargets 继续检查流程。', '未发现候选不等于商店审核通过。'] };
}

export function renderMarkdown(r) {
  const lines = ['# 鸿蒙手机上架源码预检', '', `规则版本：${r.rulesetVersion}；主题：${r.scope.themes.join('、')}；生成时间：${r.generatedAt}。`, '',
    `识别 ${r.coverage.textNodes} 个 Text；${r.coverage.evaluatedContrastStates}/${r.coverage.contrastStates} 个主题状态可计算，其中 ${r.coverage.inheritedBackgroundStates} 个沿父组件获取背景。`,
    `候选风险 ${r.findings.length} 条；配置诊断 ${r.diagnostics.length} 条；范围提示 ${r.scopeNotes.length} 条。候选尚待 Agent 核实可达性和业务含义。`, '', '## 模块覆盖', ''];
  for (const m of r.moduleScope) lines.push(`- ${m.included ? '纳入' : '排除'} ${m.path}（${m.type ?? '类型未知'}）：${m.reason}${m.includedVia.length ? '；依赖方：' + m.includedVia.join('、') : ''}`);
  for (const note of r.scopeNotes) lines.push(`- 范围提示 ${note.file}:${note.line} / ${note.reason}：${note.detail}`);
  lines.push('', '## 候选风险', '');
  for (const f of r.findings) {
    lines.push(`- **${ruleNames.get(f.ruleId) ?? '待复核检查项'} / ${f.subrule}** — ${f.file}:${f.line}${f.theme ? ' / ' + f.theme : ''}`);
    if (f.evidence?.ratio !== undefined) lines.push(`  对比度 ${f.evidence.ratio.toFixed(4)}:1；判定使用完整精度。`);
    if (f.evidence?.value) lines.push(`  文案：${JSON.stringify(f.evidence.value)}`);
    lines.push(`  ${f.reason}`);
  }
  if (!r.findings.length) lines.push('已覆盖的源码模式未发现候选；请继续核对未解析项。');
  lines.push('', '## 未解析项', '');
  const reasons = new Map(); for (const x of r.unresolved) reasons.set(x.reason, (reasons.get(x.reason) ?? 0) + 1);
  for (const [reason, count] of reasons) lines.push(`- ${reason}：${count}`);
  lines.push('', '完整位置、资源来源、可计算颜色对和流程复核目标见 report.json。', '', '## 范围限制', '', ...r.limitations.map(x => '- ' + x), '');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--contrast' && args.length === 3) {
      const value = contrastDetails(args[1], args[2]);
      if (value === null) throw new Error('颜色无效或背景不透明度不足；用法: --contrast <前景色> <不透明背景色>，半透明文字作为第一个参数；支持 #RGB/#RRGGBB/#AARRGGBB');
      console.log(JSON.stringify(value));
    } else {
      if (!args[0]) throw new Error('用法: node scan.mjs <工程根目录> [--theme light|dark|all] [--out 报告目录] 或 --contrast <前景> <背景>');
      const options = {};
      for (let i = 1; i < args.length; i += 2) {
        if (!['--theme', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('未知参数或参数缺少值');
        options[args[i].slice(2)] = args[i + 1];
      }
      const report = await scan(args[0], options);
      if (options.out) {
        const out = path.resolve(options.out); await mkdir(out, { recursive: true });
        await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
        await writeFile(path.join(out, 'report.md'), renderMarkdown(report), 'utf8');
        console.log(JSON.stringify({ reportDirectory: out, rulesetVersion: report.rulesetVersion, generatedAt: report.generatedAt, findings: report.findings.length, includedModules: report.moduleScope.filter(m => m.included).length, excludedModules: report.excludedModules, scopeNotes: report.scopeNotes.length, coverage: report.coverage, diagnostics: report.diagnostics.length }));
      } else console.log(JSON.stringify(report, null, 2));
    }
  } catch (e) { console.error(e.message); process.exitCode = 2; }
}
