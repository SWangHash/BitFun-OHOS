/**
 * @vitest-environment jsdom
 *
 * Regression guard for the target-tab separator character.
 *
 * A prior merge-conflict resolution (see 2.0.0bugfix history) corrupted the
 * U+00B7 middle dot `·` into `?` in ChatInput.tsx, and the same commit also
 * corrupted the `.join(' — ')` separator into `.join(' ??')`. Neither was
 * caught by existing tests because no assertion verified the rendered
 * separator character. This test pins both the JSX separator and the join
 * separator against future regressions.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CHAT_INPUT_SOURCE = readFileSync(
  path.join(__dirname, 'ChatInput.tsx'),
  'utf8',
);

describe('ChatInput target-tab separator', () => {
  it('uses U+00B7 middle dot `·` for the target-tab separator, not `?`', () => {
    // Two occurrences: one for the main tab, one for the btw tab.
    const matches = CHAT_INPUT_SOURCE.match(
      /bitfun-chat-input__target-tab-separator" aria-hidden="true">(.?)<\/span>/g,
    );
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
    for (const match of matches!) {
      expect(match).toContain('>\u00B7<');
      expect(match).not.toContain('>?<');
    }
  });

  it('uses ` — ` (em dash) for the slash-command skill label join, not ` ??`', () => {
    expect(CHAT_INPUT_SOURCE).toContain(".join(' \u2014 ')");
    expect(CHAT_INPUT_SOURCE).not.toContain(".join(' ??')");
  });
});
