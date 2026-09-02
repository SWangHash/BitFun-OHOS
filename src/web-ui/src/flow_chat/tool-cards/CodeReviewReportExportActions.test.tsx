/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeReviewReportExportActions } from './CodeReviewReportExportActions';
import type { ReviewTeamRunManifest } from '@/shared/services/reviewTeamService';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const EXPORTED_MARKDOWN = '# Review\n\n- complete finding\n- 完整内容';
const formatCodeReviewReportMarkdownMock = vi.hoisted(() => vi.fn());
const saveTextFileWithDialogMock = vi.hoisted(() => vi.fn());
const notificationServiceMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

function Icon({ name }: { name: string }) {
  return <svg data-icon={name} />;
}

vi.mock('lucide-react', () => ({
  Check: () => <Icon name="check" />,
  ClipboardCopy: () => <Icon name="clipboard-copy" />,
  Copy: () => <Icon name="copy" />,
  Download: () => <Icon name="download" />,
  FileDown: () => <Icon name="file-down" />,
  FilePenLine: () => <Icon name="file-pen-line" />,
  Loader2: () => <Icon name="loader" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        'toolCards.codeReview.export.copyMarkdown': 'Copy Markdown',
        'toolCards.codeReview.export.openMarkdown': 'Open as Markdown',
        'toolCards.codeReview.export.saveMarkdown': 'Save Markdown',
        'toolCards.codeReview.coverageSources.focusedCheck': '补充检查',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('@/component-library', () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  }) => <button type="button" onClick={onClick}>{children}</button>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/shared/notification-system', () => ({
  notificationService: notificationServiceMock,
}));

vi.mock('@/shared/utils/tabUtils', () => ({
  createMarkdownEditorTab: vi.fn(),
}));

vi.mock('@/infrastructure/services/infra/saveTextFileWithDialog', () => ({
  saveTextFileWithDialog: (...args: unknown[]) => saveTextFileWithDialogMock(...args),
}));

vi.mock('../utils/codeReviewReport', () => ({
  formatCodeReviewReportMarkdown: (...args: unknown[]) => formatCodeReviewReportMarkdownMock(...args),
}));

describe('CodeReviewReportExportActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formatCodeReviewReportMarkdownMock.mockReturnValue(EXPORTED_MARKDOWN);
    saveTextFileWithDialogMock.mockResolvedValue({
      status: 'saved',
      filePath: '/tmp/review.md',
    });
  });

  async function clickSave(): Promise<void> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(
          <CodeReviewReportExportActions
            reviewData={{ summary: { recommended_action: 'approve' } }}
          />,
        );
      });
      const button = container.querySelector<HTMLButtonElement>('[aria-label="Save Markdown"]');
      expect(button).not.toBeNull();
      await act(async () => {
        button?.click();
        await new Promise(resolve => window.setTimeout(resolve, 0));
      });
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  }

  it('uses the same copy icon as other copy buttons', () => {
    const html = renderToStaticMarkup(
      <CodeReviewReportExportActions reviewData={{ summary: { recommended_action: 'approve' } }} />,
    );

    expect(html).toContain('aria-label="Copy Markdown"');
    expect(html).toContain('data-icon="copy"');
    expect(html).not.toContain('data-icon="clipboard-copy"');
  });

  it('uses a download icon for saving Markdown', () => {
    const html = renderToStaticMarkup(
      <CodeReviewReportExportActions reviewData={{ summary: { recommended_action: 'approve' } }} />,
    );

    expect(html).toContain('aria-label="Save Markdown"');
    expect(html).toContain('data-icon="download"');
    expect(html).not.toContain('data-icon="file-down"');
  });

  it('can limit the visible export actions for compact surfaces', () => {
    const html = renderToStaticMarkup(
      <CodeReviewReportExportActions
        reviewData={{ summary: { recommended_action: 'approve' } }}
        actions={['copy', 'save']}
      />,
    );

    expect(html).toContain('aria-label="Copy Markdown"');
    expect(html).toContain('aria-label="Save Markdown"');
    expect(html).not.toContain('aria-label="Open as Markdown"');
  });

  it('passes the review run manifest into Markdown formatting', () => {
    const runManifest = {
      strategyLevel: 'quick',
      skippedReviewers: [],
    };

    renderToStaticMarkup(
      <CodeReviewReportExportActions
        reviewData={{
          review_mode: 'deep',
          summary: { recommended_action: 'approve' },
        }}
        runManifest={runManifest as unknown as ReviewTeamRunManifest}
      />,
    );

    expect(formatCodeReviewReportMarkdownMock).toHaveBeenCalledWith(
      {
        review_mode: 'deep',
        summary: { recommended_action: 'approve' },
      },
      expect.any(Object),
      { runManifest },
    );
  });

  it('does not project a Deep Review manifest into a standard Review export', () => {
    const runManifest = {
      strategyLevel: 'quick',
      skippedReviewers: [],
    };

    renderToStaticMarkup(
      <CodeReviewReportExportActions
        reviewData={{
          review_mode: 'standard',
          summary: { recommended_action: 'approve' },
        }}
        runManifest={runManifest as unknown as ReviewTeamRunManifest}
      />,
    );

    expect(formatCodeReviewReportMarkdownMock).toHaveBeenLastCalledWith(
      {
        review_mode: 'standard',
        summary: { recommended_action: 'approve' },
      },
      expect.any(Object),
      { runManifest: undefined },
    );
  });

  it('passes the localized additional-check label into Markdown formatting', () => {
    renderToStaticMarkup(
      <CodeReviewReportExportActions reviewData={{ summary: { recommended_action: 'approve' } }} />,
    );

    expect(formatCodeReviewReportMarkdownMock).toHaveBeenLastCalledWith(
      { summary: { recommended_action: 'approve' } },
      expect.objectContaining({
        coverageSourceLabels: expect.objectContaining({ focusedCheck: '补充检查' }),
      }),
      { runManifest: undefined },
    );
  });

  it('saves the complete Markdown payload and reports success', async () => {
    await clickSave();

    expect(saveTextFileWithDialogMock).toHaveBeenCalledWith(expect.objectContaining({
      defaultFileName: expect.stringMatching(/\.md$/),
      content: EXPORTED_MARKDOWN,
      mimeType: 'text/markdown;charset=utf-8',
      filter: { name: 'Markdown', extensions: ['md'] },
    }));
    expect(notificationServiceMock.success).toHaveBeenCalledWith(
      'toolCards.codeReview.export.saveSuccess',
    );
    expect(notificationServiceMock.error).not.toHaveBeenCalled();
  });

  it('keeps cancellation silent', async () => {
    saveTextFileWithDialogMock.mockResolvedValueOnce({ status: 'cancelled' });

    await clickSave();

    expect(notificationServiceMock.success).not.toHaveBeenCalled();
    expect(notificationServiceMock.error).not.toHaveBeenCalled();
  });

  it('reports a real save failure without claiming success', async () => {
    saveTextFileWithDialogMock.mockRejectedValueOnce(new Error('disk full'));

    await clickSave();

    expect(notificationServiceMock.error).toHaveBeenCalledWith(
      'toolCards.codeReview.export.saveFailed',
    );
    expect(notificationServiceMock.success).not.toHaveBeenCalled();
  });
});
