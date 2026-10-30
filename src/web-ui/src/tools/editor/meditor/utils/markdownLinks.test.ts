// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveMarkdownLinkCandidates } from './markdownLinks';

describe('resolveMarkdownLinkCandidates', () => {
  it('leads with the document-relative resolution and adds the workspace root', () => {
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', 'src/x.md', '/ws')).toEqual([
      '/ws/docs/src/x.md',
      '/ws/src/x.md',
    ]);
  });

  it('collapses duplicates when the document sits at the workspace root', () => {
    expect(resolveMarkdownLinkCandidates('/ws/guide.md', 'src/x.md', '/ws')).toEqual(['/ws/src/x.md']);
  });

  it('resolves same-directory links through the document directory', () => {
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', './x.md', '/ws')).toEqual([
      '/ws/docs/x.md',
      '/ws/x.md',
    ]);
  });

  it('keeps absolute hrefs as-is without a root fallback', () => {
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', '/abs/x.md', '/ws')).toEqual(['/abs/x.md']);
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', 'C:/data/x.md', '/ws')).toEqual(['C:/data/x.md']);
  });

  it('returns a single candidate when no workspace root is known', () => {
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', 'src/x.md')).toEqual(['/ws/docs/src/x.md']);
  });

  it('strips fragments and rejects pure in-page anchors', () => {
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', './x.md#intro', '/ws')).toEqual([
      '/ws/docs/x.md',
      '/ws/x.md',
    ]);
    expect(resolveMarkdownLinkCandidates('/ws/docs/guide.md', '#intro', '/ws')).toEqual([]);
  });
});
