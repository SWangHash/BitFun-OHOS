import { describe, expect, it } from 'vitest';
import {
  joinDraftAndSpeech,
  normalizeSpeechText,
  takeTranscriptSnapshot,
} from './voiceTranscript';

describe('normalizeSpeechText', () => {
  it('removes the spaces HarmonyOS puts between Chinese tokens', () => {
    expect(normalizeSpeechText('因 都 在想 法 实现这 公 员。'))
      .toBe('因都在想法实现这公员。');
    expect(normalizeSpeechText('我觉得 无 个 期完 这 星 后 的 测试终 于稳 到达'))
      .toBe('我觉得无个期完这星后的测试终于稳到达');
  });

  it('removes a space before Chinese punctuation', () => {
    expect(normalizeSpeechText('就 两 。或 或 我 投 资 差 多了')).toBe('就两。或或我投资差多了');
  });

  it('keeps spaces that separate Latin words', () => {
    expect(normalizeSpeechText('run  the   tests')).toBe('run the tests');
    expect(normalizeSpeechText('把 测试 跑 起来 then  commit')).toBe('把测试跑起来 then commit');
  });

  it('normalizes non-breaking and ideographic spaces', () => {
    expect(normalizeSpeechText('a\u3000b')).toBe('a b');
    expect(normalizeSpeechText('\u200b你好\u00a0世界')).toBe('你好世界');
  });

  it('collapses leading and trailing whitespace', () => {
    expect(normalizeSpeechText('  hello  ')).toBe('hello');
    expect(normalizeSpeechText('   ')).toBe('');
  });
});

describe('joinDraftAndSpeech', () => {
  it('never separates Chinese from Chinese', () => {
    expect(joinDraftAndSpeech('帮我写一个函数', '实现排序')).toBe('帮我写一个函数实现排序');
    expect(joinDraftAndSpeech('', '实现排序')).toBe('实现排序');
  });

  it('separates Latin word boundaries with one space', () => {
    expect(joinDraftAndSpeech('please add a', 'sorting function'))
      .toBe('please add a sorting function');
    expect(joinDraftAndSpeech('please add a ', 'sorting function'))
      .toBe('please add a sorting function');
  });

  it('keeps a Chinese draft attached to a following Latin word', () => {
    expect(joinDraftAndSpeech('帮我写', 'hello world')).toBe('帮我写hello world');
  });
});

describe('takeTranscriptSnapshot', () => {
  it('renders the latest host transcript as-is', () => {
    expect(takeTranscriptSnapshot('', '今天给大家介绍')).toBe('今天给大家介绍');
    expect(takeTranscriptSnapshot('今天给大家介绍', '今天给大家介绍个音频'))
      .toBe('今天给大家介绍个音频');
  });

  it('normalizes Chinese token spacing before rendering', () => {
    expect(takeTranscriptSnapshot('', '今 天 给 大 家 介 绍')).toBe('今天给大家介绍');
  });

  it('accepts a shorter snapshot, because a revised clause can drop characters', () => {
    expect(takeTranscriptSnapshot('增强的有', '增强的')).toBe('增强的');
  });

  it('keeps the rendered text when a snapshot is empty', () => {
    expect(takeTranscriptSnapshot('你好世界', '   ')).toBe('你好世界');
  });

  it('never repeats a clause whose middle the engine revised', () => {
    let transcript = '';
    for (const snapshot of [
      '增强',
      '增强的',
      '增强的有',
      '增强的有增强的',
      '增强的有增强的有增强的。',
    ]) {
      transcript = takeTranscriptSnapshot(transcript, snapshot);
    }
    expect(transcript).toBe('增强的有增强的有增强的。');
  });
});
