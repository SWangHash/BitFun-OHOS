import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { browserTabTitleFromUrl } from './browserTabTitle';

describe('browserTabTitleFromUrl', () => {
  it('uses the URL host instead of the command label', () => {
    expect(browserTabTitleFromUrl('https://example.com/docs')).toBe('example.com');
    expect(browserTabTitleFromUrl('http://localhost:4173/')).toBe('localhost:4173');
  });

  it('falls back for an invalid or empty URL', () => {
    expect(browserTabTitleFromUrl('')).toBe('Browser');
    expect(browserTabTitleFromUrl('://invalid')).toBe('Browser');
  });

  it('owns the title for both markdown renderers', () => {
    const rendererSources = [
      '../../infrastructure/markdown/MarkdownRenderer.tsx',
      '../../component-library/components/Markdown/Markdown.tsx',
    ].map(path => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

    for (const source of rendererSources) {
      expect(source).toContain('title: browserTabTitleFromUrl(url)');
      expect(source).not.toContain("title: translateMarkdownLabel('markdown.openInBuiltInBrowser')");
    }
  });
});
