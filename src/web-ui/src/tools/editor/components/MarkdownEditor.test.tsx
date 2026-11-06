// @vitest-environment jsdom
import React, { act, forwardRef, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarkdownEditor from './MarkdownEditor';
import { confirmDialog } from '@/infrastructure/confirm-dialog';
import type { DocumentSnapshot } from '../services/EditorDocument';

const documentMock = vi.hoisted(() => ({
  enabled: false,
  session: {
    id: 'markdown-load-test',
    snapshot: undefined as DocumentSnapshot | undefined,
    files: { readFileContent: vi.fn(), getFileMetadata: vi.fn() },
    isCurrent: vi.fn(() => true),
    capture: vi.fn(),
  },
}));
vi.mock('../services/EditorDocument', () => ({
  useEditorDocument: () => documentMock.enabled ? documentMock.session : null,
}));

vi.mock('../meditor', () => ({
  MEditor: forwardRef((props: {
    value?: string;
    mode?: string;
    emptyDocumentPlaceholder?: string;
    onDirtyChange?: (isDirty: boolean) => void;
  }, ref) => {
    useImperativeHandle(ref, () => ({
      destroy: vi.fn(),
      focus: vi.fn(),
      // Mirror the real editor: saving anchors report a clean state through
      // onDirtyChange, which the owner re-derives from its session baseline.
      markSaved: () => { props.onDirtyChange?.(false); },
      setInitialContent: (_content: string) => { props.onDirtyChange?.(false); },
    }));
    return <div data-testid="markdown-body" data-mode={props.mode} data-empty-placeholder={props.emptyDocumentPlaceholder} />;
  }),
}));

vi.mock('./CodeEditor', () => ({
  default: () => <div data-testid="code-editor" />,
}));

vi.mock('../meditor/utils/tiptapMarkdown', () => ({
  analyzeMarkdownEditability: (raw: string) => ({
    canonicalMarkdown: raw,
    containsRawHtmlInlines: false,
    containsRenderOnlyBlocks: false,
    mode: 'safe',
  }),
}));

const messages: Record<string, string> = {
  'editor.markdownEditor.copiedMarkdown': 'Copied Markdown',
  'editor.markdownEditor.copyMarkdown': 'Copy Markdown',
  'editor.markdownEditor.notice.sourcePreviewFallback': 'IR fallback warning',
};

vi.mock('@/infrastructure/i18n', () => ({
  useI18n: () => ({
    t: (key: string, options?: { defaultValue?: string }) => messages[key] ?? options?.defaultValue ?? key,
  }),
}));

vi.mock('@/infrastructure/appearance', () => ({
  useAppearance: () => ({ current: { mode: 'dark' } }),
}));

vi.mock('@/shared/utils/logger', () => ({
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('@/shared/utils/debugProbe', () => ({
  sendDebugProbe: vi.fn(),
}));

vi.mock('@/infrastructure/event-bus', () => ({
  globalEventBus: {
    emit: vi.fn(),
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@/infrastructure/confirm-dialog', () => ({
  confirmDialog: vi.fn(),
}));

describe('MarkdownEditor', () => {
  it('forwards task-specific empty-document guidance to the shared editor', () => {
    const html = renderToStaticMarkup(<MarkdownEditor emptyDocumentPlaceholder="Write the system prompt" />);
    expect(html).toContain('data-empty-placeholder="Write the system prompt"');
  });

  it('renders a compact copy action in the toolbar', () => {
    const html = renderToStaticMarkup(
      <MarkdownEditor initialContent="# Deep Review\n\nReady." />,
    );

    expect(html).toContain('aria-label="Copy Markdown"');
    expect(html).toContain('data-bitfun-component="toolbar"');
    expect(html).toContain('data-bitfun-component="icon-button"');
  });

  it('does not show the IR fallback warning in the preview/source file UI', () => {
    const html = renderToStaticMarkup(
      <MarkdownEditor initialContent="# Ordinary Markdown" />,
    );

    expect(html).not.toContain('IR fallback warning');
  });
});

describe('MarkdownEditor file load recovery', () => {
  let root: Root;
  let container: HTMLDivElement;
  const filePath = '/external/home/123.md';
  const read = documentMock.session.files.readFileContent;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    documentMock.enabled = true;
    documentMock.session.snapshot = undefined;
    documentMock.session.isCurrent.mockReturnValue(true);
    // Unexpected reads stay pending so a regression fails instead of hanging.
    read.mockReset().mockImplementation(() => new Promise<string>(() => {}));
    documentMock.session.files.getFileMetadata.mockReset().mockRejectedValue(new Error('File does not exist'));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    documentMock.enabled = false;
    vi.useRealTimers();
  });

  it('keeps a missing file error stable through rerenders and disk polling', async () => {
    read.mockRejectedValueOnce(new Error('File does not exist'));
    const reportMissing = vi.fn();
    await act(async () => root.render(<MarkdownEditor filePath={filePath} onFileMissingFromDiskChange={reportMissing} />));
    expect(read).toHaveBeenCalledTimes(1);
    expect(reportMissing).toHaveBeenCalledWith(true);
    expect(container.textContent).toContain('editor.common.fileNotFound');
    expect(container.textContent).not.toContain('editor.markdownEditor.loadingFile');

    await act(async () => root.render(<MarkdownEditor filePath={filePath} onFileMissingFromDiskChange={vi.fn()} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('editor.common.retry');
  });

  it('retries once on tab reactivation and keeps subsequent failures stable', async () => {
    read.mockRejectedValueOnce(new Error('offline'));
    await act(async () => root.render(<MarkdownEditor filePath={filePath} />));
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<MarkdownEditor filePath={filePath} isActiveTab={false} />));
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRejectedValueOnce(new Error('offline'));
    await act(async () => root.render(<MarkdownEditor filePath={filePath} isActiveTab />));
    expect(read).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('editor.common.loadFailed');
  });

  it('allows manual retry to recover when the file becomes readable', async () => {
    read.mockRejectedValueOnce(new Error('File does not exist'));
    const reportMissing = vi.fn();
    await act(async () => root.render(<MarkdownEditor filePath={filePath} onFileMissingFromDiskChange={reportMissing} />));
    read.mockResolvedValueOnce('# Recovered');
    documentMock.session.files.getFileMetadata.mockResolvedValue({ isFile: true });
    await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(read).toHaveBeenCalledTimes(2);
    expect(reportMissing).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('[data-testid="markdown-body"]')).not.toBeNull();
    expect(container.textContent).not.toContain('editor.common.retry');
  });

  it('does not retry on an inactive device', async () => {
    read.mockRejectedValueOnce(new Error('offline'));
    await act(async () => root.render(<MarkdownEditor filePath={filePath} />));
    await act(async () => root.render(<MarkdownEditor filePath={filePath} isActiveTab={false} />));
    documentMock.session.isCurrent.mockReturnValue(false);
    await act(async () => root.render(<MarkdownEditor filePath={filePath} isActiveTab />));
    expect(read).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('editor.common.loadFailed');
  });
});

describe('MarkdownEditor external reload adoption', () => {
  let root: Root;
  let container: HTMLDivElement;
  const filePath = '/external/home/open.md';
  const read = documentMock.session.files.readFileContent;
  const metadata = documentMock.session.files.getFileMetadata;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    documentMock.enabled = true;
    documentMock.session.snapshot = undefined;
    documentMock.session.isCurrent.mockReturnValue(true);
    read.mockReset().mockImplementation(() => new Promise<string>(() => {}));
    metadata.mockReset().mockRejectedValue(new Error('File does not exist'));
    // Mirror EditorDocument.capture so the session guard in the component
    // observes real snapshot semantics during the test.
    documentMock.session.capture.mockReset().mockImplementation(
      (content: string, isDirty: boolean, savedContent?: string) => {
        documentMock.session.snapshot = {
          content,
          isDirty,
          savedContent: savedContent ?? (isDirty ? documentMock.session.snapshot?.savedContent ?? content : content),
        };
      },
    );
    vi.mocked(confirmDialog).mockReset().mockResolvedValue(false);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    documentMock.enabled = false;
    vi.useRealTimers();
  });

  it('stays clean through two session rewrites of the open file', async () => {
    const disk = { content: '# v1 content', modified: 1 };
    read.mockImplementation(() => Promise.resolve(disk.content));
    metadata.mockImplementation(() =>
      Promise.resolve({ isFile: true, modified: disk.modified, size: disk.content.length }),
    );
    const onContentChange = vi.fn();
    await act(async () => root.render(
      <MarkdownEditor filePath={filePath} isActiveTab onContentChange={onContentChange} />,
    ));
    expect(container.querySelector('[data-testid="markdown-body"]')).not.toBeNull();
    expect(documentMock.session.snapshot?.savedContent).toBe('# v1 content');

    // Session rewrite #1: the disk version moves while the buffer stays clean.
    await act(async () => {
      disk.content = '# v2 content';
      disk.modified = 2;
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Session rewrite #2: the dirty guard must not misreport this as a conflict.
    await act(async () => {
      disk.content = '# v3 content';
      disk.modified = 3;
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(confirmDialog).not.toHaveBeenCalled();
    const dirtyReports = onContentChange.mock.calls.filter(([, isDirty]) => isDirty === true);
    expect(dirtyReports).toEqual([]);
    expect(documentMock.session.snapshot?.savedContent).toBe('# v3 content');
    expect(documentMock.session.capture).toHaveBeenCalledWith('# v2 content', false, '# v2 content');
    expect(documentMock.session.capture).toHaveBeenCalledWith('# v3 content', false, '# v3 content');
  });
});
