import { describe, expect, it } from 'vitest';

import { dropShellOwnedPromptRegion } from './replayPromptTrim';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const START = `${ESC}]633;A${BEL}`;
const END = `${ESC}]633;B${BEL}`;
const PROMPT = 'localhost ~/.bitfun/personal_assistant/workspace % ';

describe('dropShellOwnedPromptRegion', () => {
  it('drops the prompt the shell owns and keeps the preceding output', () => {
    const data = [`${ESC}[?2004h${START}${PROMPT}${END}`];
    expect(dropShellOwnedPromptRegion(data)).toEqual([`${ESC}[?2004h`]);
  });

  it('keeps everything before the prompt region, including earlier prompts', () => {
    const earlier = `one\r\n${START}${PROMPT}${END}two\r\n`;
    const data = [earlier, `${START}${PROMPT}${END}`];
    expect(dropShellOwnedPromptRegion(data)).toEqual([earlier, '']);
  });

  it('keeps bytes that follow the prompt region', () => {
    const data = [`${START}${PROMPT}${END}${ESC}]633;P;Cwd=/repo${BEL}`];
    expect(dropShellOwnedPromptRegion(data)).toEqual(data);
  });

  it('leaves a prompt that crosses a chunk boundary alone', () => {
    const data = [`${START}${PROMPT}`, END];
    expect(dropShellOwnedPromptRegion(data)).toEqual(data);
  });

  it('leaves shells without integration untouched', () => {
    const data = [`${ESC}[?2004h${PROMPT}`];
    expect(dropShellOwnedPromptRegion(data)).toEqual(data);
  });

  it('drops the last prompt region when a session holds several', () => {
    const data = [
      `${START}first % ${END}out\r\n`,
      `${START}second % ${END}more\r\n`,
      `${START}${PROMPT}${END}`,
    ];
    const result = dropShellOwnedPromptRegion(data);
    expect(result[2]).toBe('');
    expect(result[0]).toContain('first % ');
    expect(result[1]).toContain('second % ');
  });

  it('accepts a string-terminator end mark', () => {
    const data = [`${START}${PROMPT}${ESC}]633;B${ESC}\\`];
    expect(dropShellOwnedPromptRegion(data)).toEqual(['']);
  });
});
