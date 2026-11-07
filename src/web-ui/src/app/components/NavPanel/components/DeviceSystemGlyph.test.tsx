// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeviceSystemGlyph } from './DeviceSystemGlyph';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(node: React.ReactElement) {
  act(() => root.render(node));
  return container.querySelector('svg')!;
}

describe('DeviceSystemGlyph', () => {
  it('sizes the reported system mark with a declaration instead of the svg attributes', () => {
    const mark = render(<DeviceSystemGlyph device={{ kind: 'desktop', name: 'Workstation', os: 'Windows' }} size="sm" />);

    expect(mark.getAttribute('data-system')).toBe('windows');
    expect(mark.getAttribute('viewBox')).toBeTruthy();
    // A token in `width`/`height` is a `var()` reference, which the HarmonyOS
    // engine does not parse; the mark then kept only its view box and filled the
    // footer row. The size has to reach the mark as a declaration.
    expect(mark.hasAttribute('width')).toBe(false);
    expect(mark.hasAttribute('height')).toBe(false);
    expect(mark.getAttribute('style')).toContain('--bitfun-control-icon-size-sm');
  });

  it('bounds the neutral mark of a system this build cannot place', () => {
    const mark = render(<DeviceSystemGlyph device={{ kind: 'desktop', name: 'Workstation', os: null }} size="sm" />);

    expect(mark.hasAttribute('data-system')).toBe(false);
    expect(mark.getAttribute('style')).toContain('--bitfun-control-icon-size-sm');
    // The glyph keeps lucide's own fixed attributes as a bounded fallback; the
    // slot size arrives as the declaration, never as a `var()` attribute.
    expect(mark.getAttribute('width')).not.toContain('var(');
    expect(mark.getAttribute('height')).not.toContain('var(');
  });

  it('writes a caller pixel size out and keeps the mark optical correction', () => {
    const mark = render(<DeviceSystemGlyph device={{ kind: 'desktop', name: 'MacBook-Air.local', os: 'macOS' }} size={18} />);

    expect(mark.getAttribute('style')).toContain('width: 18px');
    expect(mark.getAttribute('style')).toContain('height: 18px');
    expect(mark.getAttribute('style')).toContain('translate: 0 -0.085em');
  });
});
