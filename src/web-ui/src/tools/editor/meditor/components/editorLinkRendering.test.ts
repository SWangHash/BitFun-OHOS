// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { toExplicitRelativeHref } from '../utils/tiptapMarkdown';

// Mirrors the Link.extend configuration in TiptapEditor: the href attribute
// renders the explicit relative form while keeping the authored value in the
// document model.
function buildEditorLinkExtension() {
  return Link.extend({
    addAttributes() {
      const parent = (this.parent?.() ?? {}) as Record<string, unknown>;
      return {
        ...parent,
        title: { default: null },
        href: {
          ...((parent.href ?? {}) as Record<string, unknown>),
          renderHTML: (attributes: Record<string, unknown>) => {
            const value = attributes.href;
            if (typeof value !== 'string' || value === '') {
              return {};
            }
            return { href: toExplicitRelativeHref(value) };
          },
        },
      };
    },
  }).configure({ openOnClick: false });
}

describe('markdown editor link rendering', () => {
  it('renders a usable href for every link kind', () => {
    const editor = new Editor({
      extensions: [StarterKit.configure({ link: false }), buildEditorLinkExtension()],
      content: '<p>'
        + '<a href="https://example.com/a.md">web</a> '
        + '<a href="22/22.md">bare</a> '
        + '<a href="./x.md">explicit</a> '
        + '<a href="../y.md">parent</a> '
        + '<a href="mailto:a@b.c">mail</a> '
        + '</p>',
    });
    const html = editor.getHTML();
    expect(html).toContain('href="https://example.com/a.md"');
    expect(html).toContain('href="./22/22.md"');
    expect(html).toContain('href="./x.md"');
    expect(html).toContain('href="../y.md"');
    expect(html).toContain('href="mailto:a@b.c"');
  });
});
