import { describe, expect, it } from 'vitest';
import { genUICatalog } from './genUIContract';
import { genUIProduct } from './genUIProduct';
import { getGenUILibraryAdapter, listGenUILibraryAdapters, resolveGenUILibraryForApp } from './genUILibraryRegistry';

describe('GenUI library registry', () => {
  it('registers the OpenUI and BitFun adapters', () => {
    const adapters = listGenUILibraryAdapters(genUICatalog).filter(adapter => !adapter.readonly);
    expect(adapters.map(adapter => adapter.adapterKind).sort()).toEqual(['bitfun', 'openui']);
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
  });

  it('keeps renderer provenance inside each adapter contract', () => {
    expect(genUIProduct.libraries['openui.v1'].nativeLibrary).toBeDefined();
    expect(genUIProduct.libraries['openui.v1'].components).toEqual({});
    expect(genUIProduct.libraries['bitfun.composable.v1'].rendererSources.Button).toMatchObject({ kind: 'bitfun-host', source: '@bitfun/ui component adapter' });
  });

});
