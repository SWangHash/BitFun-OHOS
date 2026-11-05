import React from 'react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { GetFileDiffDisplay } from './GetFileDiffDisplay';
import type { FlowToolItem, ToolCardConfig } from '../types/flow-chat';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-i18next', async () => {
  const { createTestI18nT } = await import('@/test/i18nTestUtils');
  return {
    useTranslation: () => ({
      t: createTestI18nT('flow-chat'),
    }),
  };
});

vi.mock('@/infrastructure/i18n', () => ({
  i18nService: {
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat('en-US', options).format(value),
  },
}));

vi.mock('@/infrastructure/appearance', () => ({
  useAppearance: () => ({ current: { mode: 'dark' } }),
}));

const config: ToolCardConfig = {
  toolName: 'GetFileDiff',
  displayName: 'File Diff',
  icon: 'DIFF',
  requiresConfirmation: false,
  resultDisplayType: 'detailed',
  description: 'Get file diffs',
  displayMode: 'compact',
};

describe('GetFileDiffDisplay', () => {
  let dom: JSDOM;
  let container: HTMLDivElement;
  let root: Root;

  function renderDiff(result: Record<string, unknown>) {
    const toolItem = {
      id: 'tool-diff-preview',
      type: 'tool',
      toolName: 'GetFileDiff',
      status: 'completed',
      timestamp: Date.now(),
      toolCall: { id: 'call-diff-preview', input: { file_path: 'src/app.tsx' } },
      toolResult: { success: true, result: { file_path: 'src/app.tsx', diff_type: 'git', ...result } },
    } as FlowToolItem;

    act(() => {
      root.render(<GetFileDiffDisplay toolItem={toolItem} config={config} />);
    });
  }

  function expandDiff() {
    const surface = container.querySelector('[data-bitfun-part="surface"]');
    expect(surface).not.toBeNull();
    act(() => {
      surface!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  }

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      pretendToBeVisual: true,
    });
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('shows only the file name and file-edit change summary in the completed header', () => {
    const toolItem = {
      id: 'tool-diff-1',
      type: 'tool',
      toolName: 'GetFileDiff',
      status: 'completed',
      timestamp: Date.now(),
      toolCall: {
        id: 'call-diff-1',
        input: {
          file_path: 'src/app.tsx',
        },
      },
      toolResult: {
        success: true,
        result: {
          file_path: 'src/app.tsx',
          diff_type: 'git',
          diff_content: '- old\n+ new',
          stats: {
            additions: 12,
            deletions: 0,
          },
        },
      },
    } as FlowToolItem;

    act(() => {
      root.render(<GetFileDiffDisplay toolItem={toolItem} config={config} />);
    });

    expect(container.querySelector('[data-bitfun-part="action"]')?.textContent).toBe('Diff:');
    expect(container.querySelector('[data-bitfun-part="path"]')?.textContent).toBe('app.tsx');
    expect(container.querySelector('[data-bitfun-part="path"]')?.getAttribute('data-path')).toBe('src/app.tsx');
    expect(container.querySelector('[data-bitfun-part="path"]')?.getAttribute('data-overflow-text')).toBe('src/app.tsx');
    expect(container.querySelector('[data-bitfun-part="changeSummary"]')?.textContent).toBe('+12-0');
    expect(container.querySelector('[data-bitfun-part="changeSummary"]')?.getAttribute('aria-label')).toBe(
      '12 additions and 0 deletions',
    );
    expect(container.querySelector('[data-bitfun-tool-card="file-diff"]')?.getAttribute('data-diff-type')).toBe('git');
    expect(container.textContent).not.toContain('Git HEAD');
  });

  it('shows a prepared Review diff without an empty inline preview', () => {
    const diff = '@@ -0,0 +1,2 @@\n+first\n+second';
    const message = 'Diff from prepared Review workspace target';
    renderDiff({
      original_content: '',
      modified_content: '',
      diff_content: diff,
      message,
      stats: { additions: 2, deletions: 0 },
    });
    expandDiff();

    expect(container.querySelector('pre')?.textContent).toBe(diff);
    expect(container.textContent).toContain(message);
    expect(container.querySelector('[data-bitfun-part="changeSummary"]')?.textContent).toBe('+2-0');
    expect(container.querySelector('[data-bitfun-component="inline-diff-preview"]')).toBeNull();
    expect(container.textContent).not.toContain('No content');
  });

  it.each([
    { name: 'modified', original: 'before\n', modified: 'after\n', diff: '-before\n+after' },
    { name: 'added', original: '', modified: 'after\n', diff: '+after' },
    { name: 'deleted', original: 'before\n', modified: '', diff: '-before' },
    { name: 'unchanged', original: 'same\n', modified: 'same\n', diff: '' },
  ])('keeps the inline and text previews for $name files', ({ original, modified, diff }) => {
    renderDiff({ original_content: original, modified_content: modified, diff_content: diff });
    expandDiff();

    expect(container.querySelector('[data-bitfun-component="inline-diff-preview"]')).not.toBeNull();
    expect(container.textContent).not.toContain('No content');
    expect(container.querySelector('pre')?.textContent ?? '').toBe(diff);
  });

  it('keeps the empty state when an expanded result has no file content or diff', () => {
    renderDiff({ original_content: 'before\n', modified_content: 'after\n', diff_content: '-before\n+after' });
    expandDiff();

    renderDiff({ original_content: '', modified_content: '', diff_content: '' });

    expect(container.querySelector('[data-bitfun-component="inline-diff-preview"][data-bitfun-state="empty"]')).not.toBeNull();
    expect(container.textContent).toContain('No content');
    expect(container.querySelector('pre')).toBeNull();
  });
});
