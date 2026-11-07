import { describe, expect, it } from 'vitest';
import { genUICatalog } from './genUIContract';
import { genUIProduct } from './genUIProduct';
import { getGenUILibraryAdapter, listGenUILibraryAdapters, resolveGenUILibraryForApp } from './genUILibraryRegistry';

describe('GenUI library registry', () => {
  it('registers the OpenUI, BitFun and Harmony phone adapters', () => {
    const adapters = listGenUILibraryAdapters(genUICatalog).filter(adapter => !adapter.readonly);
    expect([...new Set(adapters.map(adapter => adapter.adapterKind))].sort()).toEqual(['bitfun', 'harmony-genui', 'openui']);
    expect(adapters.map(adapter => adapter.id)).toEqual(expect.arrayContaining(['bitfun.composable.v1', 'bitfun.harmony.v1', 'openui.v1']));
    expect(adapters.find(adapter => adapter.id === 'bitfun.harmony.v1')).toMatchObject({
      adapterKind: 'harmony-genui',
      designSpecIds: ['harmony.phone.v1'],
    });
    expect(adapters.every(adapter => adapter.revision >= 1 && adapter.designSpecIds.length > 0 && adapter.styleResources.length > 0)).toBe(true);
  });

  it('resolves only the application pinned identity and revision', () => {
    const app = { libraryId: 'bitfun.composable.v1', libraryRevision: 2 } as const;
    expect(resolveGenUILibraryForApp(app, genUICatalog)?.adapterKind).toBe('bitfun');
    expect(getGenUILibraryAdapter(app.libraryId, 3, genUICatalog)).toBeUndefined();
  });

  it('resolves a legacy library identity to the canonical adapter', () => {
    const app = { libraryId: 'openbitfun.composable.v1', libraryRevision: 2 } as const;
    expect(resolveGenUILibraryForApp(app, genUICatalog)?.id).toBe('bitfun.composable.v1');
    expect(getGenUILibraryAdapter('openbitfun.composable.v1', 2, genUICatalog)?.adapterKind).toBe('bitfun');
    expect(getGenUILibraryAdapter('openbitfun.harmony.v1', 3, genUICatalog)?.id).toBe('bitfun.harmony.v1');
  });

  it('keeps renderer provenance inside each adapter contract', () => {
    expect(genUIProduct.libraries['openui.v1'].nativeLibrary).toBeDefined();
    expect(genUIProduct.libraries['openui.v1'].components).toEqual({});
    expect(genUIProduct.libraries['bitfun.composable.v1'].rendererSources.Button).toMatchObject({ kind: 'bitfun-host', source: '@bitfun/ui component adapter' });
  });

  it('mounts the Harmony renderers and their provenance for the Harmony profile', () => {
    const harmony = genUIProduct.libraries['bitfun.harmony.v1'];
    expect(harmony.rendererSources.Icon3D).toMatchObject({ kind: 'harmony-adapter', source: 'harmonyComponents.tsx' });
    expect(harmony.rendererSources.Button).toMatchObject({ kind: 'openui-react' });
    for (const name of ['Icon3D', 'Plot', 'Metric', 'Steps'] as const) {
      expect(typeof harmony.components[name]?.render).toBe('function');
    }
  });

});
