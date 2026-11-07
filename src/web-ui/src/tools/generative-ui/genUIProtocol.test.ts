import { describe, expect, it } from 'vitest';
import { describeGenUIApp, reduceGenUIMessages, type GenUIGeneration } from './genUIProtocol';
import { preflightGenUIApp } from './genUIContract';
import type { GenUIAppDefinition } from './genUITypes';

const sourceApp = (content = 'root = Col([Title("Hello")])'): GenUIAppDefinition => ({
  schemaVersion: 2,
  id: 'source-app',
  title: 'Source app',
  template: 'bitfun.app',
  libraryId: 'bitfun.composable.v1',
  libraryRevision: 2,
  designSpec: { id: 'bitfun.desktop.v1', revision: 1 },
  source: { kind: 'openui-lang', content },
  state: { name: { type: 'string', default: '' } },
});

describe('source generation protocol', () => {
  it('assembles a complete source and initial state', () => {
    const generation = describeGenUIApp(sourceApp(), { name: 'Ada' });
    const result = reduceGenUIMessages(generation);
    expect(result.app.source).toEqual(sourceApp().source);
    expect(result.app.nodes).toBeUndefined();
    expect(result.state).toEqual({ name: 'Ada' });
    expect(preflightGenUIApp(result.app).accepted).toBe(true);
  });

  it('rejects the removed graph operations before rendering', () => {
    const generation = { protocol: 'bitfun.genui.v1', messages: [
      { createSurface: { id: 'x', title: 'X', template: 'bitfun.app', libraryId: 'bitfun.composable.v1', libraryRevision: 2, designSpec: { id: 'bitfun.desktop.v1', revision: 1 }, source: sourceApp().source } },
      { updateComponents: { components: [] } },
    ] } as unknown as GenUIGeneration;
    expect(() => reduceGenUIMessages(generation)).toThrow('graph messages were removed');
  });

  it('requires source on new applications', () => {
    expect(() => describeGenUIApp({ ...sourceApp(), source: undefined })).toThrow('source is required');
  });

  it('accepts only updateDataModel after createSurface', () => {
    const generation = describeGenUIApp(sourceApp());
    generation.messages.push({ updateDataModel: { values: { name: 'Grace' } } });
    expect(reduceGenUIMessages(generation).state).toEqual({ name: 'Grace' });
    generation.messages.push({ updateLogic: {} });
    expect(() => reduceGenUIMessages(generation)).toThrow();
  });

  it('accepts the legacy protocol and identities while emitting canonical output', () => {
    const legacy = {
      protocol: 'openbitfun.genui.v1',
      messages: [{
        createSurface: {
          id: 'legacy', title: 'Legacy', template: 'openbitfun.app',
          libraryId: 'openbitfun.composable.v1', libraryRevision: 2,
          designSpec: { id: 'openbitfun.desktop.v1', revision: 1 },
          source: sourceApp().source,
        },
      }],
    } as unknown as GenUIGeneration;
    const result = reduceGenUIMessages(legacy);
    expect(result.app.template).toBe('bitfun.app');
    expect(result.app.libraryId).toBe('bitfun.composable.v1');
    expect(result.app.designSpec?.id).toBe('bitfun.desktop.v1');
    const described = describeGenUIApp({ ...sourceApp(), template: 'openbitfun.app', libraryId: 'openbitfun.composable.v1', designSpec: { id: 'openbitfun.desktop.v1', revision: 1 } });
    expect(described.messages[0].createSurface).toMatchObject({ template: 'bitfun.app', libraryId: 'bitfun.composable.v1', designSpec: { id: 'bitfun.desktop.v1' } });
  });

});
