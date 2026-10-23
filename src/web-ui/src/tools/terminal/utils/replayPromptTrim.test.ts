import { describe, expect, it } from 'vitest';

import { dropShellOwnedPromptRegion } from './replayPromptTrim';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const START = `${ESC}]633;A${BEL}`;
const END = `${ESC}]633;B${BEL}`;
const OUTPUT_START = `${ESC}]633;C${BEL}`;
const FINISHED = `${ESC}]633;D${BEL}`;
const PROMPT = 'localhost ~/.bitfun/personal_assistant/workspace % ';

function joined(data: string[]): string {
  return data.join('');
}

describe('dropShellOwnedPromptRegion', () => {
  describe('prompt region after a finished command', () => {
    it('drops every prompt copy the shell redraw over earlier resizes left in the transcript', () => {
      // The reported screen: a stray marker plus several copies of the prompt, all
      // recorded as separate redraws after the last command finished.
      const data = [
        `one\r\n${FINISHED}`,
        `${START}${PROMPT}${END}\r`,
        `${START}${PROMPT}${END}\r`,
        `% \r${START}${PROMPT}${END}`,
      ];

      const result = joined(dropShellOwnedPromptRegion(data));

      expect(result).toBe(`one\r\n${FINISHED}`);
      expect(result).not.toContain(PROMPT);
      expect(result).not.toContain('%');
    });

    it('keeps the prompt and output of earlier commands', () => {
      const earlier = `${START}first % ${END}one\r\n${START}second % ${END}two\r\n`;
      const data = [earlier, `${FINISHED}${START}${PROMPT}${END}`];

      const result = joined(dropShellOwnedPromptRegion(data));

      expect(result).toContain('first % ');
      expect(result).toContain('second % ');
      expect(result).toContain('two\r\n');
      expect(result).not.toContain(PROMPT);
    });

    it('accepts a command-finished mark that carries an exit status', () => {
      const data = [`one\r\n${ESC}]633;D;1${BEL}${START}${PROMPT}${END}`];

      expect(joined(dropShellOwnedPromptRegion(data))).toBe(`one\r\n${ESC}]633;D;1${BEL}`);
    });

    it('leaves a recording alone while a command is still producing output', () => {
      const data = [`${FINISHED}${START}${PROMPT}${END}running\r\n${OUTPUT_START}...still going`];

      expect(dropShellOwnedPromptRegion(data)).toEqual(data);
    });

    it('leaves a recording alone when nothing follows the finished command', () => {
      const data = [`one\r\n${FINISHED}`];

      expect(dropShellOwnedPromptRegion(data)).toEqual(data);
    });
  });

  describe('shells without command marks', () => {
    it('drops the trailing prompt span', () => {
      const data = [`${ESC}[?2004h${START}${PROMPT}${END}`];

      expect(dropShellOwnedPromptRegion(data)).toEqual([`${ESC}[?2004h`]);
    });

    it('keeps everything before that span, including earlier prompts', () => {
      const earlier = `one\r\n${START}${PROMPT}${END}two\r\n`;
      const data = [earlier, `${START}${PROMPT}${END}`];

      expect(dropShellOwnedPromptRegion(data)).toEqual([earlier, '']);
    });

    it('keeps bytes that follow the prompt span', () => {
      const data = [`${START}${PROMPT}${END}${ESC}]633;P;Cwd=/repo${BEL}`];

      expect(dropShellOwnedPromptRegion(data)).toEqual(data);
    });

    it('leaves shells without integration untouched', () => {
      const data = [`${ESC}[?2004h${PROMPT}`];

      expect(dropShellOwnedPromptRegion(data)).toEqual(data);
    });

    it('accepts a string-terminator end mark', () => {
      const data = [`${START}${PROMPT}${ESC}]633;B${ESC}\\`];

      expect(joined(dropShellOwnedPromptRegion(data))).toBe('');
    });
  });

  it('reads a mark that straddles a chunk boundary as one mark', () => {
    const data = [`${FINISHED}${START}${PROMPT}`, END];

    expect(joined(dropShellOwnedPromptRegion(data))).toBe(FINISHED);
  });

  it('handles the empty payload', () => {
    expect(dropShellOwnedPromptRegion([])).toEqual([]);
  });
});
