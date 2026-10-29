import { describe, expect, it } from 'vitest';
import {
  systemClipboardHasExternalCopy,
} from './fileTreeClipboard';

describe('fileTreeClipboard external copy detection', () => {
  it('treats any non-empty pasteboard as external when no snapshot exists', () => {
    expect(systemClipboardHasExternalCopy(['/tmp/a.txt'], null)).toBe(true);
  });

  it('ignores an empty pasteboard', () => {
    expect(systemClipboardHasExternalCopy([], null)).toBe(false);
    expect(systemClipboardHasExternalCopy([], ['/tmp/a.txt'])).toBe(false);
  });

  it('keeps the internal clipboard when the pasteboard matches the snapshot', () => {
    expect(systemClipboardHasExternalCopy(['/tmp/a.txt'], ['/tmp/a.txt'])).toBe(false);
  });

  it('ignores ordering and duplicates when comparing with the snapshot', () => {
    expect(
      systemClipboardHasExternalCopy(['/tmp/b.txt', '/tmp/a.txt'], ['/tmp/a.txt', '/tmp/b.txt']),
    ).toBe(false);
  });

  it('detects a pasteboard changed after the snapshot', () => {
    expect(systemClipboardHasExternalCopy(['/tmp/b.txt'], ['/tmp/a.txt'])).toBe(true);
    expect(
      systemClipboardHasExternalCopy(
        ['/tmp/a.txt', '/tmp/c.txt'],
        ['/tmp/a.txt', '/tmp/b.txt'],
      ),
    ).toBe(true);
    expect(systemClipboardHasExternalCopy(['/tmp/a.txt', '/tmp/b.txt'], ['/tmp/a.txt'])).toBe(true);
  });
});
