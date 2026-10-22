import { describe, expect, it } from 'vitest';

import { resolveUnmappedKeydownSequence } from './unmappedKeyFallback';

const NORMAL = { applicationCursorKeys: false };
const APPLICATION = { applicationCursorKeys: true };

function keydown(overrides: Partial<Record<string, unknown>> & { key: string; keyCode: number }) {
  return {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...overrides,
  } as Parameters<typeof resolveUnmappedKeydownSequence>[0];
}

describe('resolveUnmappedKeydownSequence', () => {
  it('rebuilds arrow history keys that arrive with an IME key code', () => {
    // The reported bug: an arrow keydown carrying keyCode 229 never reached the shell,
    // so history navigation needed an extra press.
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowUp', keyCode: 229 }), NORMAL)).toBe('\x1b[A');
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowDown', keyCode: 229 }), NORMAL)).toBe('\x1b[B');
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowLeft', keyCode: 229 }), NORMAL)).toBe('\x1b[D');
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowRight', keyCode: 229 }), NORMAL)).toBe('\x1b[C');
  });

  it('rebuilds arrow keys reported with an unmapped key code', () => {
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowUp', keyCode: 0 }), NORMAL)).toBe('\x1b[A');
  });

  it('honours DECCKM for cursor keys', () => {
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowUp', keyCode: 229 }), APPLICATION)).toBe('\x1bOA');
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'Home', keyCode: 229 }), APPLICATION)).toBe('\x1bOH');
  });

  it('rebuilds the remaining editing keys', () => {
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'Home', keyCode: 229 }), NORMAL)).toBe('\x1b[H');
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'End', keyCode: 229 }), NORMAL)).toBe('\x1b[F');
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'PageUp', keyCode: 229 }), NORMAL)).toBe('\x1b[5~');
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'PageDown', keyCode: 229 }), NORMAL)).toBe('\x1b[6~');
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'Insert', keyCode: 229 }), NORMAL)).toBe('\x1b[2~');
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'Delete', keyCode: 229 }), NORMAL)).toBe('\x1b[3~');
  });

  it('leaves normally mapped key codes to xterm', () => {
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowUp', keyCode: 38 }), NORMAL)).toBeNull();
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowDown', keyCode: 40 }), NORMAL)).toBeNull();
  });

  it('leaves text and composition keys to the IME path', () => {
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'a', keyCode: 229 }), NORMAL)).toBeNull();
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'Process', keyCode: 229 }), NORMAL)).toBeNull();
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'Unidentified', keyCode: 229 }), NORMAL)).toBeNull();
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'Dead', keyCode: 229 }), NORMAL)).toBeNull();
  });

  it('does not invent a sequence for modified presses', () => {
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowUp', keyCode: 229, shiftKey: true }), NORMAL)).toBeNull();
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowUp', keyCode: 229, ctrlKey: true }), NORMAL)).toBeNull();
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'ArrowUp', keyCode: 229, altKey: true }), NORMAL)).toBeNull();
    expect(resolveUnmappedKeydownSequence(keydown({ key: 'Home', keyCode: 229, metaKey: true }), NORMAL)).toBeNull();
  });
});
