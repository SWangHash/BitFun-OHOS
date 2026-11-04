// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useEditorFontFamily } from './useEditorFontFamily';
import { resolveEditorFontFamily } from '../config/defaults';
import { buildEditorOptions, buildDiffEditorOptions } from '../services/EditorOptionsBuilder';

const runtime = vi.hoisted(() => ({ revision: 0, listeners: new Set<() => void>() }));
vi.mock('@/infrastructure/appearance', () => ({ appearanceRuntime: {
  getSnapshot: () => runtime.revision,
  subscribe: (listener: () => void) => { runtime.listeners.add(listener); return () => { runtime.listeners.delete(listener); }; },
} }));
vi.mock('@/infrastructure/appearance/adapters/MonacoAppearanceAdapter', () => ({
  monacoAppearanceAdapter: { getCurrentThemeId: () => 'fixture-theme' },
}));

it('inherits the active code font, updates on appearance changes and preserves explicit editor choices', () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  const root = createRoot(host);
  const style = document.documentElement.style;
  const property = '--bitfun-font-family-mono';
  function Probe({ font }: { font: string }) { return <span>{useEditorFontFamily(font)}</span>; }
  style.setProperty(property, 'Fixture Global Mono, monospace');
  act(() => root.render(<Probe font="" />));
  expect(host.textContent).toBe('Fixture Global Mono, monospace');
  expect(buildEditorOptions({ config: { fontFamily: '' } }).fontFamily).toBe('Fixture Global Mono, monospace');
  expect(buildDiffEditorOptions({ config: { fontFamily: '' } }).fontFamily).toBe('Fixture Global Mono, monospace');
  style.setProperty(property, 'Updated Global Mono, monospace');
  act(() => { runtime.revision += 1; runtime.listeners.forEach(listener => listener()); });
  expect(host.textContent).toBe('Updated Global Mono, monospace');
  act(() => root.render(<Probe font="Explicit Editor Mono" />));
  expect(host.textContent).toBe('Explicit Editor Mono');
  expect(resolveEditorFontFamily('   ')).toBe('Updated Global Mono, monospace');
  act(() => root.unmount());
  expect(runtime.listeners.size).toBe(0);
  style.removeProperty(property);
});
