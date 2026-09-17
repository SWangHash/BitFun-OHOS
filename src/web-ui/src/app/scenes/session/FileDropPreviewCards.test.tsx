/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/infrastructure/i18n', () => ({ useI18n: () => ({
  t: (_key: string, options?: { fileCount: string }) => `${options?.fileCount ?? ''} files`,
  formatNumber: String,
}) }));
import { FileDropPreviewCards } from './FileDropPreviewCards';
import { getFileDropPreviewKind } from './fileDropPreviewKind';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement('div');
document.body.appendChild(container);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; });

describe('file drag previews', () => {
  it('shows only the first thumbnail with stacked cards and the full selection count', () => {
    root = createRoot(container);
    act(() => root!.render(<FileDropPreviewCards preview={{ count: 12, files: Array.from({ length: 4 }, (_, i) => ({
      name: `photo-${i}.png`, thumbnail: `data:image/png;base64,${i}`,
    })) }} />));
    expect(container.querySelectorAll('img')).toHaveLength(1);
    expect(container.querySelector('img')?.alt).toBe('photo-0.png');
    expect(container.querySelector('.bitfun-chat-pane__file-preview')?.getAttribute('data-stack-depth')).toBe('3');
    expect(container.querySelector('.bitfun-chat-pane__file-count')?.textContent).toBe('12');
  });
  it('uses format-specific icons for documents and damaged image thumbnails', () => {
    root = createRoot(container);
    for (const [name, kind] of [['report.PDF', 'pdf'], ['budget.xlsx', 'spreadsheet'], ['source.rs', 'code']]) {
      act(() => root!.render(<FileDropPreviewCards preview={{ count: 2, files: [{ name }, { name: 'other.png' }] }} />));
      expect(container.querySelector(`[data-kind="${kind}"] svg`)).not.toBeNull();
      expect(container.querySelectorAll('.bitfun-chat-pane__file-tile')).toHaveLength(1);
    }
    act(() => root!.render(<FileDropPreviewCards preview={{ count: 1, files: [
      { name: 'photo.jpg', thumbnail: 'data:image/png;base64,broken' },
    ] }} />));
    expect(container.querySelector('.bitfun-chat-pane__file-count')).toBeNull();
    expect(container.querySelector('.bitfun-chat-pane__file-preview')?.getAttribute('data-multiple')).toBe('false');
    act(() => container.querySelector('img')!.dispatchEvent(new Event('error')));
    expect(container.querySelector('[data-kind="image"] svg')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
  it('handles unknown formats, extensionless files, and case-insensitive suffixes', () => {
    expect(getFileDropPreviewKind('README').kind).toBe('file');
    expect(getFileDropPreviewKind('data.unfamiliar').kind).toBe('file');
    expect(getFileDropPreviewKind('backup.TAR.GZ').kind).toBe('archive');
    expect(getFileDropPreviewKind('slide.PPTX').kind).toBe('presentation');
    expect(getFileDropPreviewKind('movie.MP4').kind).toBe('video');
  });
});
