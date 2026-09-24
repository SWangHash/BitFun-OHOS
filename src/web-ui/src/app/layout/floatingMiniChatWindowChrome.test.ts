import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');
}

describe('floating MiniApp chat window chrome', () => {
  it('drags the panel through the shared deferred chrome gesture', () => {
    const component = readSource('./FloatingMiniChat.tsx');

    expect(component).toContain(
      "import { useWindowChromeDrag } from '@/app/hooks/useWindowChromeDrag';",
    );
    expect(component).toContain('useWindowChromeDrag()');
    expect(component).toContain('onMouseDown={handlePanelHeaderMouseDown}');
    // Both of these restore a maximized window on a plain click: the direct
    // native call fires on mousedown, and Tauri's drag-region script fires on
    // any direct click on the element carrying the attribute.
    expect(component).not.toContain('startNativeWindowDragging');
    expect(component).not.toContain('data-tauri-drag-region');
  });

  it('keeps the bottom-anchored panel clear of the workbench chrome row', () => {
    const stylesheet = readSource('./FloatingMiniChat.scss');

    expect(stylesheet).toContain(
      'max-height: calc(100vh - var(--bitfun-layout-toolbar-md-height) - 32px);',
    );
  });
});
