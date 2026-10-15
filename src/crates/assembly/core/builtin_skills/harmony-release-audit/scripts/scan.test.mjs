import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scan, contrast, renderMarkdown } from './scan.mjs';
import { contrastDetails } from './colors.mjs';

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'harmony-release-audit-tests-'));
let count = 0;
after(async () => {
  const actual = await realpath(tempRoot);
  assert.equal(path.dirname(actual), await realpath(os.tmpdir()));
  assert.ok(path.basename(actual).startsWith('harmony-release-audit-tests-'));
  await rm(actual, { recursive: true, force: true });
});
async function put(root, file, value) {
  const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}
async function fixture(code, overrides = {}) {
  const root = path.join(tempRoot, String(++count));
  const files = {
    'build-profile.json5': { modules: [{ name: 'entry', srcPath: './entry' }] },
    'AppScope/app.json5': { app: { label: '$string:app_name', bundleName: 'com.example.shop' } },
    'AppScope/resources/base/element/string.json': { string: [{ name: 'app_name', value: 'Shop' }] },
    'entry/src/main/module.json5': { module: { type: 'entry', deviceTypes: ['phone'] } },
    'entry/src/main/resources/base/element/color.json': { color: [{ name: 'foreground', value: '#FFFFFF' }, { name: 'background', value: '#FFFFFF' }] },
    'entry/src/main/ets/Page.ets': code,
    ...overrides,
  };
  for (const [file, value] of Object.entries(files)) await put(root, file, value);
  return root;
}
const run = async (code, files = {}) => scan(await fixture(code, files), { theme: 'light' });
const rule = (r, id) => r.findings.filter(f => f.ruleId === id);

test('reports use semantic check identifiers and readable names across findings and review gaps', async () => {
  const r = await run(`@Component struct Page {
    @State accepted: boolean = true;
    build() {
      Column() {
        Text('Shop Beta').fontColor('#999999').backgroundColor(Color.White);
        Text('System foreground');
        Row() { Text('隐私政策'); Checkbox({name:'consent'}).select(this.accepted); }
      }.backgroundColor(Color.White);
    }
  }`);
  const expected = ['color-contrast', 'release-readiness', 'privacy-consent'];
  assert.equal(r.schemaVersion, '4');
  assert.equal(r.rulesetVersion, 'phone-source-mvp-0.4');
  assert.deepEqual(r.scope.rules, expected);
  assert.deepEqual(new Set(r.findings.map(f => f.ruleId)), new Set(expected));
  assert.ok(r.unresolved.some(x => x.ruleId === 'color-contrast'));
  assert.ok(r.reviewTargets.some(x => x.ruleId === 'privacy-consent'));
  for (const item of [...r.findings, ...r.unresolved, ...r.reviewTargets]) {
    assert.ok(expected.includes(item.ruleId));
  }
  const markdown = renderMarkdown(r);
  for (const name of ['色彩对比度', '发布完整性', '隐私主动同意']) assert.ok(markdown.includes(name));
  assert.doesNotMatch(JSON.stringify(r) + markdown, /\b[A-Z]{2}[a-z]{2}\d{3}\b/);
});

test('sRGB contrast, alpha, invalid colors and opaque backdrop requirement', () => {
  assert.equal(contrast('#000', '#fff'), 21);
  assert.equal(contrast('#FFFFFF', '#FFFFFF'), 1);
  assert.equal(contrast('#80000000', '#FFFFFF'), contrast('#7F7F7F', '#FFFFFF'));
  assert.equal(contrast('#000', '#80ffffff'), null);
  assert.equal(contrast('garbage', '#fff'), null);
});
test('separate sibling modifier chains even without semicolons or with whitespace', async () => {
  const r = await run(`Text('a').fontColor ( Color.White )\nButton('b').backgroundColor(Color.White)`);
  assert.equal(r.contrastChecks.length, 0);
  assert.equal(r.unresolved[0].reason, 'background-not-found-in-local-component-tree');
});
test('comments and code-looking string literals cannot manufacture UI nodes', async () => {
  const r = await run(`// Text('demo').fontColor(Color.White).backgroundColor(Color.White)\nconst code = "Text('demo').fontColor(Color.White).backgroundColor(Color.White)";\nText('normal').fontColor(Color.Black).backgroundColor(Color.White);`);
  assert.equal(r.coverage.textNodes, 1); assert.equal(r.findings.length, 0);
});
test('nearest structural parent background with nested braces and callbacks', async () => {
  const r = await run(`Column() { Row() { Text('body').fontColor(Color.White).margin({ top: 4, bottom: 2 }).onClick(() => { console.info('Text(fake)'); }); }.backgroundColor(Color.White); }.backgroundColor(Color.Black);`);
  assert.equal(r.contrastChecks[0].ratio, 1);
  assert.equal(r.contrastChecks[0].background[0].component, 'Row');
  assert.equal(r.coverage.inheritedBackgroundStates, 1);
});
test('nearest foreground and background modifiers use the last assignment', async () => {
  const r = await run(`Text('body').fontColor(Color.White).fontColor(Color.Black).backgroundColor(Color.White);`);
  assert.equal(r.contrastChecks[0].ratio, 21); assert.equal(r.findings.length, 0);
});
test('transparent container backgrounds are composed against their known ancestors', async () => {
  const r = await run(`Column() { Row() { Text('body').fontColor('#FFFFFF'); }.backgroundColor('#80000000'); }.backgroundColor('#FFFFFF');`);
  assert.equal(r.contrastChecks[0].ratio, contrast('#FFFFFF', '#7F7F7F'));
  assert.equal(r.contrastChecks[0].background.length, 2);
});
test('dynamic colors and missing system foreground remain located gaps', async () => {
  const r = await run(`Column(){Text('dynamic').fontColor(this.color);Text('system');}.backgroundColor(Color.White)`);
  assert.equal(r.contrastChecks.length, 0); assert.equal(r.unresolved.length, 2);
  assert.ok(r.unresolved.every(x => x.file.endsWith('Page.ets') && x.line > 0));
});
test('overlap, background images and opacity do not produce fabricated ratios', async () => {
  for (const code of [
    `Stack(){Text('body').fontColor(Color.White)}.backgroundColor(Color.White)`,
    `Column(){Text('body').fontColor(Color.White)}.backgroundColor(Color.White).backgroundImage('photo.png')`,
    `Column(){Text('body').fontColor(Color.White)}.backgroundColor(Color.White).opacity(.5)`,
  ]) { const r = await run(code); assert.equal(r.contrastChecks.length, 0); assert.equal(r.unresolved.length, 1); }
});
test('module resource scope is not contaminated by unrelated modules', async () => {
  const r = await run(`Text('body').fontColor($r('app.color.foreground')).backgroundColor($r('app.color.background'))`, {
    'build-profile.json5': { modules: [{ name: 'entry', srcPath: './entry' }, { name: 'other', srcPath: './other' }] },
    'other/src/main/module.json5': { module: { deviceTypes: ['phone'] } },
    'other/src/main/resources/base/element/color.json': { color: [{ name: 'background', value: '#000000' }] },
  });
  assert.equal(r.contrastChecks[0].ratio, 1);
});
test('local dependencies and resource aliases retain evidence paths', async () => {
  const r = await run(`Text('body').fontColor(Color.White).backgroundColor($r('app.color.brand'))`, {
    'build-profile.json5': { modules: [{ srcPath: './entry' }, { srcPath: './common' }] },
    'entry/oh-package.json5': { dependencies: { common: 'file:../common' } },
    'common/src/main/module.json5': { module: { deviceTypes: ['phone'], type: 'har' } },
    'common/src/main/resources/base/element/color.json': { color: [{ name: 'brand', value: '$color:shade' }, { name: 'shade', value: '#000000' }] },
  });
  assert.equal(r.contrastChecks[0].ratio, 21);
  assert.equal(r.contrastChecks[0].background[0].resources.length, 2);
});

test('phone entry includes direct and transitive HAR sources regardless of HAR deviceTypes', async () => {
  const r = await run(`Text('Home').fontColor(Color.White).backgroundColor($r('app.color.brand'))`, {
    'build-profile.json5': { modules: [{ srcPath: './entry' }, { srcPath: './catalog' }, { srcPath: './account' }] },
    'entry/oh-package.json5': { dependencies: { catalog: '../catalog' } },
    'catalog/src/main/module.json5': { module: { type: 'har', deviceTypes: ['default', 'tablet'] } },
    'catalog/oh-package.json5': { dependencies: { account: 'file:../account' } },
    'catalog/src/main/ets/Catalog.ets': `Text('Shop Beta')`,
    'account/src/main/module.json5': { module: { type: 'har', deviceTypes: ['tablet', '2in1'] } },
    'account/src/main/resources/base/element/color.json': { color: [{ name: 'brand', value: '#000000' }] },
    'account/src/main/ets/Account.ets': `Row(){Text('隐私政策');Checkbox({name:'consent'}).select(true)}`,
  });
  assert.equal(r.moduleScope.filter(m => m.included).length, 3);
  assert.deepEqual(r.moduleScope.find(m => m.path === 'account').includedVia, ['catalog']);
  assert.equal(r.scopeNotes.filter(n => n.reason === 'dependency-device-types-exclude-phone').length, 2);
  assert.equal(r.skippedNonPhoneModules, 0);
  assert.equal(r.contrastChecks.find(c => c.file.includes('entry/')).ratio, 21);
  assert.ok(rule(r, 'release-readiness').some(f => f.file.startsWith('catalog/')));
  assert.ok(rule(r, 'privacy-consent').some(f => f.file.startsWith('account/')));
});

test('unregistered reachable HAR is included while unrelated HAP, HAR and dev dependencies stay excluded', async () => {
  const r = await run(`Text('Home')`, {
    'build-profile.json5': { modules: [{ srcPath: './entry' }, { srcPath: './watch' }, { srcPath: './unused' }] },
    'entry/oh-package.json5': { dependencies: { shared: 'file:../shared' }, devDependencies: { unused: '../unused' } },
    'shared/src/main/module.json5': { module: { type: 'har', deviceTypes: ['tablet'] } },
    'shared/src/main/ets/Shared.ets': `Text('Beta')`,
    'watch/src/main/module.json5': { module: { type: 'entry', deviceTypes: ['wearable'] } },
    'watch/src/main/ets/Watch.ets': `Text('Demo')`,
    'unused/src/main/module.json5': { module: { type: 'har', deviceTypes: ['phone'] } },
    'unused/src/main/ets/Unused.ets': `Text('内测')`,
  });
  assert.deepEqual(rule(r, 'release-readiness').map(f => f.file), ['shared/src/main/ets/Shared.ets']);
  assert.equal(r.skippedNonPhoneModules, 1);
  assert.equal(r.excludedModules, 2);
  assert.equal(r.moduleScope.find(m => m.path === 'unused').reason, 'not-in-phone-dependency-graph');
});

test('local dependency cycles terminate and preserve resource lookup', async () => {
  const r = await run(`Text('Home').fontColor(Color.White).backgroundColor($r('app.color.brand'))`, {
    'entry/oh-package.json5': { dependencies: { common: '../common' } },
    'common/src/main/module.json5': { module: { type: 'har', deviceTypes: ['tablet'] } },
    'common/oh-package.json5': { dependencies: { entry: '../entry' } },
    'common/src/main/resources/base/element/color.json': { color: [{ name: 'brand', value: '#000000' }] },
  });
  assert.equal(r.contrastChecks[0].ratio, 21);
  assert.equal(r.moduleScope.filter(m => m.included).length, 2);
});

test('local dynamic dependencies are candidates with explicit scope provenance', async () => {
  const r = await run(`Text('Home')`, {
    'entry/oh-package.json5': { dynamicDependencies: { extra: '../extra' } },
    'extra/src/main/module.json5': { module: { type: 'shared', deviceTypes: ['phone'] } },
    'extra/src/main/ets/Extra.ets': `Text('Beta')`,
  });
  assert.equal(rule(r, 'release-readiness').length, 1);
  assert.equal(r.moduleScope.find(m => m.path === 'extra').reason, 'phone-dynamic-dependency');
});

test('unavailable local dependency sources remain visible coverage gaps', async () => {
  const r = await run(`Text('Home')`, {
    'entry/oh-package.json5': { dependencies: { missing: '../missing', archive: 'file:../libs/package.har' } },
  });
  assert.equal(r.scopeNotes.filter(n => n.reason === 'local-dependency-source-unavailable').length, 2);
  assert.equal(r.diagnostics.length, 0);
});

test('standalone HAR project reports missing phone HAP reachability', async () => {
  const r = await run(`Text('Beta')`, {
    'entry/src/main/module.json5': { module: { type: 'har', deviceTypes: ['phone'] } },
  });
  assert.equal(rule(r, 'release-readiness').length, 1);
  assert.ok(r.scopeNotes.some(n => n.reason === 'phone-hap-not-found'));
});

test('contrast evidence keeps its actual background and alpha composition', async () => {
  const r = await run(`Column(){Text('Action').fontColor('#66000000')}.backgroundColor('#FFFFFF')`);
  const evidence = r.contrastChecks[0];
  assert.deepEqual(evidence.resolvedBackground, { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(evidence.compositedForeground, { r: 153, g: 153, b: 153, a: 1 });
  assert.ok(Math.abs(evidence.ratio - 2.849027755287037) < 1e-12);
  const onWhite = contrastDetails('#99000000', '#FFFFFF');
  const onGray = contrastDetails('#99000000', '#F1F3F5');
  assert.equal(onWhite.foreground, '#99000000');
  assert.equal(onWhite.background, '#FFFFFF');
  assert.ok(Math.abs(onWhite.ratio - 5.74183648145415) < 1e-12);
  assert.ok(Math.abs(onGray.ratio - 5.56021111307456) < 1e-12);
  assert.equal(onWhite.bodyPass, true);
  assert.equal(contrastDetails('#000', '#80FFFFFF'), null);
});
test('dark resource override evaluated independently from base', async () => {
  const root = await fixture(`Text('body').fontColor(Color.White).backgroundColor($r('app.color.background'))`, {
    'entry/src/main/resources/dark/element/color.json': { color: [{ name: 'background', value: '#000000' }] },
  });
  const r = await scan(root);
  assert.equal(r.contrastChecks.find(x => x.theme === 'light').ratio, 1);
  assert.equal(r.contrastChecks.find(x => x.theme === 'dark').ratio, 21);
  assert.equal(rule(r, 'color-contrast').length, 1);
});
test('malformed resources produce diagnostics and unresolved references', async () => {
  const r = await run(`Text('body').fontColor(Color.White).backgroundColor($r('app.color.background'))`, { 'entry/src/main/resources/base/element/color.json': '{bad json' });
  assert.ok(r.diagnostics.some(x => x.reason === 'config-parse-error'));
  assert.equal(r.contrastChecks.length, 0); assert.ok(r.unresolved.length);
});
test('quoted deviceTypes, trailing comma and comments parse as JSON5', async () => {
  const r = await run(`Text('Demo').fontColor(Color.White).backgroundColor(Color.White)`, { 'entry/src/main/module.json5': `{ "module": { /* phone excluded */ "deviceTypes": ['wearable'], }, }` });
  assert.equal(r.skippedNonPhoneModules, 1); assert.equal(r.coverage.textNodes, 0); assert.equal(r.findings.length, 0);
});
test('malformed module config stays visible as diagnostic rather than silently excluded', async () => {
  const r = await run(`Text('Demo')`, { 'entry/src/main/module.json5': '{ broken' });
  assert.equal(r.coverage.textNodes, 1); assert.ok(r.diagnostics.length);
});
test('inline test markers found while logs and unreferenced resource markers are ignored', async () => {
  const r = await run(`console.info('demo'); Text('beta');`, { 'entry/src/main/resources/base/element/string.json': { string: [{ name: 'unused', value: '内测' }] } });
  assert.equal(rule(r, 'release-readiness').length, 1); assert.equal(rule(r, 'release-readiness')[0].evidence.value, 'beta');
});
test('app label resource is reported once and benign bundle substrings are ignored', async () => {
  const r = await run(`Text('Home')`, {
    'AppScope/app.json5': { app: { label: '$string:app_name', bundleName: 'com.latest.contest' } },
    'AppScope/resources/base/element/string.json': { string: [{ name: 'app_name', value: 'Shop beta' }] },
  });
  assert.equal(rule(r, 'release-readiness').length, 1);
});
test('test bundle and a used localized resource have traceable evidence', async () => {
  const r = await run(`Text($r('app.string.label'))`, {
    'AppScope/app.json5': { app: { bundleName: 'com.example.testapp' } },
    'entry/src/main/resources/base/element/string.json': { string: [{ name: 'label', value: 'Home' }] },
    'entry/src/main/resources/zh_CN/element/string.json': { string: [{ name: 'label', value: '内测' }] },
  });
  assert.equal(rule(r, 'release-readiness').length, 2); assert.ok(rule(r, 'release-readiness').some(x => x.evidence.resource?.qualifier === 'zh_CN'));
});
test('privacy association uses the control group, not arbitrary neighboring characters', async () => {
  const r = await run(`Column(){Row(){Text('隐私协议');Checkbox({name:'consent'}).select(false)}Row(){Checkbox({name:'cart'}).select(true)}}`);
  assert.equal(rule(r, 'privacy-consent').length, 0); assert.equal(r.coverage.privacyControls, 1);
});
test('literal preselection tied to privacy UI produces one candidate', async () => {
  const r = await run(`Row(){Text('隐私政策');Checkbox({name:'read'}).select(true)}`);
  assert.equal(rule(r, 'privacy-consent').length, 1); assert.equal(rule(r, 'privacy-consent')[0].evidence.initial, 'true');
});
test('generic state binding and semicolonless initialization are tracked', async () => {
  const r = await run(`@Component struct Login { @State checked: boolean = true\n build(){Row(){Text('隐私政策');Checkbox({name:'read'}).select(this.checked)}} }`);
  assert.equal(rule(r, 'privacy-consent').length, 1); assert.ok(rule(r, 'privacy-consent')[0].evidence.declaration);
});
test('identically named state in another component does not contaminate consent', async () => {
  const r = await run(`@Component struct Cart { @State agreed:boolean=true; build(){Checkbox({name:'cart'}).select(this.agreed)} }\n@Component struct Login { @State agreed:boolean=false; build(){Row(){Text('隐私');Checkbox({name:'consent'}).select(this.agreed)}} }`);
  assert.equal(rule(r, 'privacy-consent').length, 0);
});
test('user click consent assignment is not a default-consent violation', async () => {
  const r = await run(`@Component struct Login { @State agreed:boolean=false; build(){Row(){Text('隐私');Checkbox().select(this.agreed);Button('同意').onClick(()=>{this.agreed=true;})}} }`);
  assert.equal(rule(r, 'privacy-consent').length, 0);
});
test('lifecycle consent assignment needs flow review even when initial state is false', async () => {
  const r = await run(`@Component struct Login { @State agreed:boolean=false; aboutToAppear(){this.agreed=true;} build(){Row(){Text('隐私');Checkbox().select(this.agreed)}} }`);
  assert.ok(rule(r, 'privacy-consent').some(x => x.subrule === 'consent-assignment-needs-flow-review'));
});
test('Toggle isOn option is inspected', async () => {
  const r = await run(`Row(){Text('隐私');Toggle({ type: ToggleType.Checkbox, isOn: true })}`);
  assert.equal(rule(r, 'privacy-consent').length, 1);
});
test('persisted consent state is an unresolved path, not a confirmed failure', async () => {
  const r = await run(`@Component struct Login { @State agreed:boolean=prefs.get('accepted', false); build(){Row(){Text('隐私');Checkbox().select(this.agreed)}} }`);
  assert.equal(rule(r, 'privacy-consent').length, 0);
  assert.ok(r.unresolved.some(x => x.reason === 'dynamic-or-persisted-consent-initial-state'));
});
test('implicit consent policy applies to UI text, not log or explanatory source literals', async () => {
  const r = await run(`console.info('登录即代表同意'); Text('注册即视为同意隐私政策')`);
  assert.equal(rule(r, 'privacy-consent').length, 1);
});
test('privacy dialog becomes a refusal-path review target without fabricated verdict', async () => {
  const r = await run(`AlertDialog.show({message:'请阅读隐私政策', primaryButton:{value:'同意',action:()=>{}}})`);
  assert.equal(rule(r, 'privacy-consent').length, 0); assert.ok(r.reviewTargets.some(x => x.kind === 'privacy-dialog'));
});
test('broken source syntax is explicitly uncovered', async () => {
  const r = await run(`Column(){Text('body').fontColor(Color.White)`);
  assert.equal(r.contrastChecks.length, 0); assert.ok(r.unresolved.some(x => x.reason === 'unclosed-bracket'));
});
test('local custom styles on an ancestor require expansion before claiming contrast', async () => {
  const r = await run(`@Styles function danger(){.backgroundColor(Color.White)}\nColumn(){Text('body').fontColor(Color.White)}.backgroundColor(Color.Black).danger()`);
  assert.equal(r.contrastChecks.length, 0); assert.ok(r.unresolved.some(x => x.reason === 'custom-style-needs-expansion'));
});
test('static string concatenation in UI is decoded for implicit consent', async () => {
  const r = await run(`Text('登录即' + '代表同意隐私政策')`);
  assert.equal(rule(r, 'privacy-consent').length, 1);
});
test('zIndex and negative-margin siblings make the effective background unresolved', async () => {
  for (const code of [
    `Column(){Row(){Text('title').fontColor(Color.White)}.zIndex(2);Image('bg').margin({top:-100})}.backgroundColor(Color.White)`,
    `Column(){Text('title').fontColor(Color.White);Image('bg').margin({top:-100})}.backgroundColor(Color.White)`,
  ]) { const r = await run(code); assert.equal(r.contrastChecks.length, 0); assert.ok(r.unresolved.length); }
});
test('custom slot containers do not leak a guessed parent backdrop', async () => {
  const r = await run(`Column(){CustomContainer(){Text('body').fontColor(Color.White)}}.backgroundColor(Color.White)`);
  assert.equal(r.contrastChecks.length, 0); assert.ok(r.unresolved.some(x => x.reason === 'custom-component-background-boundary'));
});
test('privacy copy in a menu array supplies a trace target rather than a default-consent verdict', async () => {
  const r = await run(`@Component struct Setting { menus:string[]=['隐私声明']; build(){ForEach(this.menus,(item)=>{Text(item)})} }`);
  assert.equal(rule(r, 'privacy-consent').length, 0);
  assert.ok(r.reviewTargets.some(x => x.kind === 'unlinked-copy-with-dynamic-ui'));
});
test('regex literals cannot manufacture component or policy matches', async () => {
  const r = await run(`const pattern=/Text('demo').fontColor(Color.White).backgroundColor(Color.White)/; Text('Home').fontColor(Color.Black).backgroundColor(Color.White);`);
  assert.equal(r.coverage.textNodes, 1); assert.equal(r.findings.length, 0);
});
