// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveMarkdownLinkCandidates } from './markdownLinks';

describe('resolveMarkdownLinkCandidates', () => {
  it('resolves links relative to the current file directory only (issue #460)', () => {
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', 'src/x.md', '/ws')).toEqual(['/ws/docs/src/x.md']);
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', '../src/x.md', '/ws')).toEqual(['/ws/src/x.md']);
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', './x.md', '/ws')).toEqual(['/ws/docs/x.md']);
  });

  it('anchors a workspace-relative filePath on the workspace root (issue #460)', () => {
    expect(resolveMarkdownLinkCandidates('docs/guide.md', 'src/x.md', '/ws')).toEqual(['/ws/docs/src/x.md']);
    expect(resolveMarkdownLinkCandidates('docs/guide.md', 'src/x.md')).toEqual([]);
  });

  it('keeps absolute hrefs as-is', () => {
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', '/abs/x.md', '/ws')).toEqual(['/abs/x.md']);
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', 'C:/data/x.md', '/ws')).toEqual(['C:/data/x.md']);
  });

  it('strips fragments and rejects pure in-page anchors', () => {
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', './x.md#intro', '/ws')).toEqual(['/ws/docs/x.md']);
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', '#intro', '/ws')).toEqual([]);
  });
});
