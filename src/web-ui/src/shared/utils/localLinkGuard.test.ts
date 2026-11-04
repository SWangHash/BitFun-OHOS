// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';

const openFileInBestTarget = vi.fn();
const getCurrentWorkspacePath = vi.fn();

vi.mock('@/shared/utils/tabUtils', () => ({
  openFileInBestTarget: (...args: unknown[]) => openFileInBestTarget(...args),
}));
vi.mock('@/infrastructure/api', () => ({
  globalAPI: { getCurrentWorkspacePath: () => getCurrentWorkspacePath() },
}));
vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() }),
}));

import { installLocalLinkGuard } from './localLinkGuard';

function anchorWithHref(href: string, parentClass?: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  anchor.textContent = 'link';
  if (parentClass) {
    const parent = document.createElement('div');
    parent.className = parentClass;
    parent.append(anchor);
    document.body.append(parent);
  } else {
    document.body.append(anchor);
  }
  return anchor;
}

function click(node: Element): void {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
}

describe('installLocalLinkGuard', () => {
  let uninstall: () => void;

  beforeEach(() => {
    openFileInBestTarget.mockClear();
    getCurrentWorkspacePath.mockReset().mockResolvedValue('/ws');
    document.body.innerHTML = '';
    uninstall = installLocalLinkGuard();
  });

  it('does not intercept anchors inside the rich markdown editor', () => {
    const anchor = anchorWithHref('./docs/plan.md', 'ProseMirror');
    click(anchor);
    expect(openFileInBestTarget).not.toHaveBeenCalled();
  });

  it('does not intercept anchors inside the tiptap editor container', () => {
    const container = document.createElement('div');
    container.setAttribute('data-bitfun-component', 'tiptap-editor');
    const anchor = document.createElement('a');
    anchor.setAttribute('href', './docs/plan.md');
    container.append(anchor);
    document.body.append(container);
    click(anchor);
    expect(openFileInBestTarget).not.toHaveBeenCalled();
  });

  it('still routes leaked local links through the workspace root', async () => {
    const anchor = anchorWithHref('README.md');
    click(anchor);
    await vi.waitFor(() => expect(openFileInBestTarget).toHaveBeenCalled());
    expect(openFileInBestTarget).toHaveBeenCalledWith({ filePath: '/ws/README.md' });
  });

  it('leaves web links to the browser default', () => {
    const anchor = anchorWithHref('https://example.com');
    click(anchor);
    expect(openFileInBestTarget).not.toHaveBeenCalled();
  });
});
