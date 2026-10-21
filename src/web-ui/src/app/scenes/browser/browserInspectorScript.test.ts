// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANCEL_INSPECTOR_SCRIPT, createInspectorScript } from './browserInspectorScript';

const invoke = vi.fn(async () => undefined);

function inspectorOverlay(): HTMLDivElement {
  const inspectorLayers = Array.from(document.documentElement.children).filter(
    (element): element is HTMLDivElement => element.tagName === 'DIV',
  );
  const overlay = inspectorLayers.at(-2);
  if (!overlay) throw new Error('Inspector overlay was not created');
  return overlay;
}

function setRect(element: HTMLElement, read: () => DOMRect): void {
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(read);
}

describe('browser inspector script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(window, '__bitfun_inspector_active');
    Reflect.deleteProperty(window, '__bitfun_inspector_cancel');
    Reflect.deleteProperty(window, '__bitfun_inspector_label');
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: { invoke },
    });
  });

  afterEach(() => {
    window.eval(CANCEL_INSPECTOR_SCRIPT);
    document.body.replaceChildren();
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.restoreAllMocks();
  });

  it('preserves the original visual treatment while enabling live geometry updates', () => {
    const script = createInspectorScript('visual-contract');

    expect(script).toContain("'transition:top 0.05s,left 0.05s,width 0.05s,height 0.05s'");
    expect(script).toContain("'background:' + THEME.activeBackground");
    expect(script).toContain('overlay.style.borderColor = THEME.selectedBorder');
    expect(script).toContain('overlay.style.background = THEME.selectedBackground');
    expect(script).toContain('document.addEventListener(\'mousemove\', onMouseMove, true)');
    expect(script).toContain('window.addEventListener(\'scroll\', onViewportChange, true)');
    expect(script).toContain('window.addEventListener(\'resize\', onViewportChange)');
  });

  it('tracks mouse, scroll and resize, then selects the actual click target', async () => {
    const hovered = document.createElement('div');
    hovered.className = 'hovered';
    hovered.textContent = 'Hovered';
    const clicked = document.createElement('button');
    clicked.className = 'clicked';
    clicked.textContent = 'Clicked';
    document.body.append(hovered, clicked);

    let hoveredRect = new DOMRect(10, 20, 100, 40);
    const clickedRect = new DOMRect(240, 160, 80, 32);
    setRect(hovered, () => hoveredRect);
    setRect(clicked, () => clickedRect);

    window.eval(createInspectorScript('live-target'));
    const overlay = inspectorOverlay();

    hovered.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(overlay.style.left).toBe('10px');
    expect(overlay.style.top).toBe('20px');

    hoveredRect = new DOMRect(35, 55, 120, 45);
    hovered.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(overlay.style.left).toBe('35px');
    expect(overlay.style.width).toBe('120px');

    hoveredRect = new DOMRect(35, 85, 120, 45);
    window.dispatchEvent(new Event('scroll'));
    expect(overlay.style.top).toBe('85px');

    hoveredRect = new DOMRect(50, 95, 140, 50);
    window.dispatchEvent(new Event('resize'));
    expect(overlay.style.left).toBe('50px');
    expect(overlay.style.height).toBe('50px');

    clicked.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(overlay.style.left).toBe('240px');
    expect(overlay.style.top).toBe('160px');
    expect(invoke).toHaveBeenCalledWith('plugin:event|emit', {
      event: 'browser-inspector-element-selected-live-target',
      payload: expect.objectContaining({
        tagName: 'button',
        path: expect.stringContaining('button.clicked'),
        textContent: 'Clicked',
      }),
    });
  });
});
