import { describe, expect, it } from 'vitest';
import {
  isLikelySpokenEcho,
  normalizeVoiceTokens,
  voiceTextKey,
  voiceTokenCount,
} from './realtimeVoiceEcho';

const SPOKEN = '正在创建新的 BitFun 会话。';

describe('normalizeVoiceTokens', () => {
  it('splits CJK characters and Latin words, dropping punctuation', () => {
    expect(normalizeVoiceTokens('正在创建新的 BitFun 会话。')).toEqual([
      '正', '在', '创', '建', '新', '的', 'bitfun', '会', '话',
    ]);
    expect(normalizeVoiceTokens('Hello, world!')).toEqual(['hello', 'world']);
    expect(normalizeVoiceTokens('，。！')).toEqual([]);
  });

  it('gives the same key to text that differs only in punctuation', () => {
    expect(voiceTextKey('帮我看看这个报错。')).toBe(voiceTextKey('帮我 看看 这个报错'));
  });

  it('counts tokens so a one-word snapshot can be excluded', () => {
    expect(voiceTokenCount('停')).toBe(1);
    expect(voiceTokenCount('继续')).toBe(2);
    expect(voiceTokenCount('  。')).toBe(0);
  });
});

describe('isLikelySpokenEcho', () => {
  it('detects the status line being played back', () => {
    expect(isLikelySpokenEcho('正在创建新的 BitFun 会话', SPOKEN)).toBe(true);
    expect(isLikelySpokenEcho('创建新的会话', SPOKEN)).toBe(true);
  });

  it('accepts a real request that reuses a word or two', () => {
    expect(isLikelySpokenEcho('不要创建会话，先解释一下', SPOKEN)).toBe(false);
    expect(isLikelySpokenEcho('打开设置页面', SPOKEN)).toBe(false);
  });

  it('lets a one-token interruption through when it is not spoken text', () => {
    expect(isLikelySpokenEcho('停', SPOKEN)).toBe(false);
    expect(isLikelySpokenEcho('新', SPOKEN)).toBe(true);
  });

  it('never suppresses anything when nothing was spoken', () => {
    expect(isLikelySpokenEcho('帮我看看这个报错', '')).toBe(false);
  });
});
