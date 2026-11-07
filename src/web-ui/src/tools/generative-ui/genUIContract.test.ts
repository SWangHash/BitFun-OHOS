import { describe, expect, it } from 'vitest';
import fixtures from '../../../../shared/generative-ui/contract-fixtures.json';
import examples from '../../../../shared/generative-ui/examples.json';
import source from '../../../../shared/generative-ui/library.json';
// @ts-expect-error product build module is shared with the Node contract generator
import { compileCatalog, extendLibrary } from '../../../../shared/generative-ui/library.mjs';
import { designSpecForApp, libraryFor, preflightGenUIApp, genUICatalog } from './genUIContract';
import { genUIProduct } from './genUIProduct';
import { validateGenUIState } from './genUIState';
import type { GenUIAppDefinition } from './genUITypes';
describe('product library generation contract', () => {
  it.each(fixtures)('$name matches Rust validation', fixture => expect(preflightGenUIApp(fixture.app as GenUIAppDefinition).accepted).toBe(fixture.valid));
  it('derives prompt, schema and runtime contracts from the same library declarations', () => {
    expect(compileCatalog(source)).toEqual(genUICatalog);
    expect(genUICatalog.openuiLangReference).toContain('root = Component(...)');
    expect(genUICatalog.genuiSystemPrompts?.openui).toContain('You are an AI assistant that responds using openui-lang');
    expect(genUICatalog.genuiSystemPrompts?.openui).toContain('root = Card([title, stepper, list, copy])');
    expect(genUICatalog.genuiSystemPrompts?.openui).not.toContain('Life plan');
    expect(genUICatalog.genuiSystemPrompts?.bitfun).not.toContain('Icon3D');
    expect(genUICatalog.libraries['bitfun.composable.v1'].components.Icon3D).toBeUndefined();
    expect(genUICatalog.genuiSystemPrompts?.openui).toContain('## Important Rules');
    expect(genUICatalog.profiles?.openui?.templates).toEqual(['openui.app']);
    expect(genUICatalog.profiles?.bitfun?.templates).toEqual(['bitfun.app']);
    const library = genUICatalog.libraries['bitfun.composable.v1'];
    const runtime = genUIProduct.libraries[library.id];
    expect(runtime.contract).toEqual(library);
    expect(Object.keys(runtime.components).sort()).toEqual(Object.keys(library.components).sort());
    expect(Object.keys(runtime.functions).sort()).toEqual(Object.keys(library.functions).sort());
    expect('actions' in library).toBe(false);
    expect('actions' in runtime).toBe(false);
  });
  it('extends the library immutably and rewrites parent composition rules', () => {
    const original = JSON.stringify(source.base);
    const component = { description: 'Product badge', props: { type: 'object', properties: {}, required: [], additionalProperties: false }, slots: {} };
    const next = extendLibrary(source.base, { removeComponents: ['Button'], replaceComponents: { Text: { ...source.base.components.Text, description: 'Product text' } }, addComponents: { ProductBadge: { component, slots: ['Col.children'] } } }, 'product.test');
    expect(next.components.Col.slots.children).toContain('ProductBadge');
    expect(next.components.Col.slots.children).not.toContain('Button');
    expect(next.components.Text.description).toBe('Product text');
    expect(JSON.stringify(source.base)).toBe(original);
    expect(() => extendLibrary(source.base, { addComponents: { ProductBadge: { component, slots: ['Missing.body'] } } }, 'bad')).toThrow('placement');
  });
  it('retains future state fields and diagnoses old descriptions without rewriting them', () => {
    const app = examples.calculator as GenUIAppDefinition;
    const state = { hours: 0, enabled: false, future: { metadata: 1 } };
    expect(validateGenUIState(app, state)).toEqual([]);
    expect(preflightGenUIApp({ ...app, futureRuntime: { revision: 2 } }).accepted).toBe(true);
    expect(preflightGenUIApp({ ...app, source: { kind: 'html-document', html: '<p>future</p>' }, htmlRuntime: { runtimeRevision: 9, sanitizerRevision: 1, inspectorRevision: 1, bridgeRevision: 1 } }).accepted).toBe(false);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(validateGenUIState(app, { hours: 'bad' })).not.toHaveLength(0);
    const old = fixtures.at(-1)!.app;
    const before = JSON.stringify(old);
    expect(preflightGenUIApp(old as GenUIAppDefinition).accepted).toBe(false);
    expect(JSON.stringify(old)).toBe(before);
  });
  it('accepts the historical openui template paired with the old BitFun library', () => {
    const legacy = {
      schemaVersion: 2,
      id: 'legacy-openui',
      title: 'Legacy OpenUI app',
      template: 'openui.app',
      libraryId: 'openbitfun.composable.v1',
      libraryRevision: 2,
      designSpec: { id: 'openbitfun.desktop.v1', revision: 1 },
      source: { kind: 'openui-lang', content: 'root = Col([])' },
      state: {},
    } as GenUIAppDefinition;
    expect(preflightGenUIApp(legacy).accepted).toBe(true);
  });
  it('accepts legacy template, library, profile and design-spec identities', () => {
    const legacy = {
      schemaVersion: 2,
      id: 'legacy-bitfun',
      title: 'Legacy BitFun app',
      template: 'openbitfun.app',
      libraryId: 'openbitfun.composable.v1',
      libraryRevision: 2,
      designSpec: { id: 'openbitfun.desktop.v1', revision: 1 },
      source: { kind: 'openui-lang', content: 'root = Col([])' },
      state: {},
    } as GenUIAppDefinition;
    expect(preflightGenUIApp(legacy).accepted).toBe(true);
    expect(legacy.libraryId).toBe('openbitfun.composable.v1');
  });
  it('binds the Harmony phone delivery surface through legacy identities', () => {
    const app = {
      schemaVersion: 2,
      id: 'harmony-phone',
      title: 'Harmony phone app',
      template: 'openbitfun.harmony.app',
      libraryId: 'openbitfun.harmony.v1',
      libraryRevision: 3,
      designSpec: { id: 'harmony.phone.v1', revision: 1 },
      source: { kind: 'openui-lang', content: 'root = Col([])' },
      state: {},
    } as GenUIAppDefinition;
    expect(preflightGenUIApp(app).accepted).toBe(true);
    expect(genUICatalog.profiles?.harmony).toEqual({
      label: 'Harmony phone',
      templates: ['bitfun.harmony.app'],
      designSpec: 'harmony.phone.v1',
    });
    expect(libraryFor(app)).toMatchObject({
      id: 'bitfun.harmony.v1',
      metadata: { revision: 3, adapterKind: 'harmony-genui', designSpecIds: ['harmony.phone.v1'] },
    });
    expect(designSpecForApp(app)).toMatchObject({
      revision: 1,
      viewport: { mode: 'fixed', width: 360, height: 764, unit: 'css-px' },
      shell: {
        kind: 'phone',
        statusBarHeight: 36,
        contentInsets: { top: 16, right: 16, bottom: 16, left: 16 },
      },
    });
    // The profile is only real when every identity it names resolves: the
    // template, both library revisions, the adapter kind and the read-only
    // counterpart. Keep this guard so a half-added Harmony surface fails here
    // instead of at render time on a phone target.
    for (const [template, libraryId] of [
      ['bitfun.harmony.app', 'bitfun.harmony.v1'],
      ['bitfun.harmony.reference', 'bitfun.harmony.readonly.v1'],
    ]) {
      expect(genUICatalog.templates?.[template]?.library).toBe(libraryId);
      expect(genUICatalog.libraryAdapters?.[libraryId]).toMatchObject({
        adapterKind: 'harmony-genui',
        designSpecIds: ['harmony.phone.v1'],
      });
      expect(genUICatalog.designSpecs?.['harmony.phone.v1'].componentLibraries).toContain(libraryId);
    }
    expect(preflightGenUIApp({
      ...app,
      template: 'openbitfun.harmony.reference',
      libraryId: 'openbitfun.harmony.readonly.v1',
    }).accepted).toBe(true);
  });
  it('rejects undeclared schema semantics and invalid template roots at product build time', () => {
    const invalid = structuredClone(source) as any;
    invalid.base.components.Text.props.properties.text.minimum = 1;
    expect(() => compileCatalog(invalid)).toThrow('Unsupported schema keyword');
    const wrongRoot = structuredClone(source);
    wrongRoot.templates['bitfun.app'].roots = ['Missing'];
    expect(() => compileCatalog(wrongRoot)).toThrow('root components');
  });
});
