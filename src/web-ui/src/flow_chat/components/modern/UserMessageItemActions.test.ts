import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function extractBlock(source: string, selector: string): string {
  const selectorStart = source.indexOf(selector);
  expect(selectorStart, `Missing selector: ${selector}`).toBeGreaterThanOrEqual(0);

  const blockStart = source.indexOf('{', selectorStart);
  expect(blockStart, `Missing block for selector: ${selector}`).toBeGreaterThanOrEqual(0);

  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(blockStart + 1, index);
    }
  }

  throw new Error(`Unclosed block for selector: ${selector}`);
}

describe('UserMessageItem metadata visibility', () => {
  it('shows the copy, edit, and rollback actions as one always-available cluster', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./UserMessageItem.scss', import.meta.url)),
      'utf8',
    ).replace(/\r\n?/g, '\n');
    const actions = extractBlock(stylesheet, '\n.user-message-item__actions {');
    const shell = extractBlock(stylesheet, '.user-message-item-shell {');

    expect(actions).toContain('opacity: 1;');
    expect(actions).toContain('pointer-events: auto;');
    expect(shell).not.toContain('.user-message-item__actions');

    expect(stylesheet).toContain([
      '.user-message-item__copy-btn,',
      '.user-message-item__edit-btn,',
      '.user-message-item__rollback-btn {',
    ].join('\n'));
    expect(stylesheet).not.toContain('.user-message-item__edit-btn {\n  opacity: 1;');
  });

  it('shows the out-of-bubble timestamp without changing row geometry', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./UserMessageItem.scss', import.meta.url)),
      'utf8',
    ).replace(/\r\n?/g, '\n');
    const shell = extractBlock(stylesheet, '.user-message-item-shell {');
    const timestamp = extractBlock(stylesheet, '\n.user-message-item__timestamp {');

    expect(timestamp).toContain('opacity: 1;');
    expect(timestamp).toContain('pointer-events: none;');
    expect(timestamp).toContain('margin-right: auto;');
    const meta = extractBlock(stylesheet, '\n.user-message-item__meta {');
    expect(metaLayout).toContain('display: flex;');
    expect(meta + metaLayout).not.toMatch(/position:\s*(absolute|fixed);/);
    expect(meta + metaLayout).not.toMatch(/(?:^|\n)\s*(?:max-)?height:/);
    expect(metaLayout).toContain('justify-content: flex-end;');
    const bubble = extractBlock(stylesheet, '\n.user-message-item {');
    expect(bubble).toContain('padding: 0.46rem var(--_user-message-padding-inline);');
    expect(shell).toContain('--_user-message-padding-inline: var(--_user-message-radius);');
    // The bubble's surface ends on the reading column's content edge instead of
    // one radius past it, so a sent message lines up with the tool cards and the
    // composer card that share that edge.
    expect(bubble).toContain('margin-inline: auto 0;');
    expect(meta).toContain('padding-inline: 0;');
    expect(meta).toContain('padding-block: calc(var(--bitfun-space-1) / 2) 0;');
    expect(meta).toContain('pointer-events: auto;');
    expect(stylesheet).toContain('margin: 0;');
    expect(shell).not.toContain('.user-message-item__timestamp');
    expect(shell).not.toContain('&--with-timestamp');
  });
});
