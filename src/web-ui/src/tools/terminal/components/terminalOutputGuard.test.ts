import { describe, expect, it } from 'vitest';

import {
  composeGuardedTerminalOutput,
  guardTerminalOutput,
  looksLikeBinaryOutput,
  TERMINAL_OUTPUT_MAX_CHARS,
} from './terminalOutputPresentation';

describe('looksLikeBinaryOutput', () => {
  it('accepts plain and ANSI-colored text output', () => {
    expect(looksLikeBinaryOutput('build failed: 3 errors\n')).toBe(false);
    expect(looksLikeBinaryOutput('\u001b[31merror\u001b[0m: missing header\n')).toBe(false);
    expect(looksLikeBinaryOutput('中文输出\t带制表符\r\n')).toBe(false);
  });

  it('flags NUL bytes as binary', () => {
    expect(looksLikeBinaryOutput('ELF\u0000\u0002\u0001header')).toBe(true);
  });

  it('flags a sample dominated by control bytes as binary', () => {
    const binary = Array.from({ length: 64 }, (_, i) => String.fromCharCode(i === 10 ? 10 : 1 + (i % 20))).join('');
    expect(looksLikeBinaryOutput(binary)).toBe(true);
  });

  it('samples only the head of the output', () => {
    const head = 'x'.repeat(8192) + '\u0000\u0000\u0000\u0000';
    expect(looksLikeBinaryOutput(head)).toBe(false);
    const binaryHead = '\u0000\u0000\u0000\u0000' + 'x'.repeat(8192);
    expect(looksLikeBinaryOutput(binaryHead)).toBe(true);
  });

  it('treats empty output as text', () => {
    expect(looksLikeBinaryOutput('')).toBe(false);
  });
});

describe('guardTerminalOutput', () => {
  it('passes through text output under the character cap', () => {
    const guard = guardTerminalOutput('hello\nworld');
    expect(guard).toEqual({
      content: 'hello\nworld',
      binary: false,
      truncated: false,
      totalChars: 11,
    });
  });

  it('suppresses binary output and reports the original size', () => {
    const guard = guardTerminalOutput('\u007fELF\u0002\u0001\u0001\u0000\u0000'.repeat(100));
    expect(guard.binary).toBe(true);
    expect(guard.content).toBe('');
    expect(guard.totalChars).toBe(900);
  });

  it('truncates oversized text output at the character cap', () => {
    const content = 'a'.repeat(TERMINAL_OUTPUT_MAX_CHARS + 5000);
    const guard = guardTerminalOutput(content);
    expect(guard.binary).toBe(false);
    expect(guard.truncated).toBe(true);
    expect(guard.totalChars).toBe(content.length);
    expect(guard.content.length).toBe(TERMINAL_OUTPUT_MAX_CHARS);
  });
});

describe('composeGuardedTerminalOutput', () => {
  it('replaces binary output with the caller placeholder on its own line', () => {
    const composed = composeGuardedTerminalOutput(
      { content: '', binary: true, truncated: false, totalChars: 7466925 },
      (count) => `二进制输出已拦截，未渲染（${count} 字符）。`,
    );
    expect(composed).toBe('\n二进制输出已拦截，未渲染（7466925 字符）。');
  });

  it('falls back to an ASCII placeholder when no text callback is given', () => {
    const composed = composeGuardedTerminalOutput(
      { content: '', binary: true, truncated: false, totalChars: 42 },
    );
    expect(composed).toBe('\n[binary output suppressed: 42 characters]');
  });

  it('appends a stable truncation marker after the truncated content', () => {
    const guard = {
      content: 'a'.repeat(TERMINAL_OUTPUT_MAX_CHARS),
      binary: false,
      truncated: true,
      totalChars: TERMINAL_OUTPUT_MAX_CHARS + 7466925,
    };
    const composed = composeGuardedTerminalOutput(guard, undefined, (count) => `… 输出已截断（前 ${count} 字符）`);
    expect(composed).toBe(`${'a'.repeat(TERMINAL_OUTPUT_MAX_CHARS)}\n… 输出已截断（前 ${TERMINAL_OUTPUT_MAX_CHARS} 字符）`);
    // Stable across growth: the marker only depends on the fixed shown count.
    const grown = composeGuardedTerminalOutput(
      { ...guard, totalChars: guard.totalChars + 1000 },
      undefined,
      (count) => `… 输出已截断（前 ${count} 字符）`,
    );
    expect(grown).toBe(composed);
  });

  it('returns guarded text untouched when within limits', () => {
    expect(composeGuardedTerminalOutput({ content: 'ok', binary: false, truncated: false, totalChars: 2 })).toBe('ok');
  });
});
