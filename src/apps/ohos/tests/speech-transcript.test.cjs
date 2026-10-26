const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the production ArkTS transcript assembler. This covers the text the
// host emits to the web-ui and returns from `finish`; it does not emulate the
// system speech engine, ArkTS compilation, or device behaviour.
const source = fs.readFileSync(
  path.join(__dirname, '../entry/src/main/ets/services/SpeechTranscript.ets'),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const transcriptModule = {};
new Function('exports', outputText)(transcriptModule);
const { buildTranscript, normalizeRecognizedText } = transcriptModule;

test('removes the spaces the engine puts between Chinese tokens', () => {
  assert.equal(
    normalizeRecognizedText('因 都 在想 法 实现这 公 员。'),
    '因都在想法实现这公员。',
  );
  assert.equal(
    normalizeRecognizedText('我觉得 无 个 期完 这 星 后 的 测试终 于稳 到达'),
    '我觉得无个期完这星后的测试终于稳到达',
  );
  assert.equal(normalizeRecognizedText('就 两 。或 或 我 投 资 差 多了'), '就两。或或我投资差多了');
  assert.equal(normalizeRecognizedText('\u3000hello\u00a0world'), 'hello world');
});

test('joins committed clauses without a Chinese separator', () => {
  assert.equal(buildTranscript('', '今天给大家介绍'), '今天给大家介绍');
  assert.equal(buildTranscript('今天给大家介绍个音频', '讲文字的软件'), '今天给大家介绍个音频讲文字的软件');
});

test('separates committed Latin clauses with one space', () => {
  assert.equal(buildTranscript('hello world', 'next sentence'), 'hello world next sentence');
  assert.equal(buildTranscript('write a', 'sorting function'), 'write a sorting function');
});

test('recognizes an engine that re-sends the whole session', () => {
  assert.equal(buildTranscript('你好世界', '你好世界今天下雨'), '你好世界今天下雨');
  assert.equal(buildTranscript('hello', 'hello world'), 'hello world');
});

test('a revised middle of the clause never repeats an earlier take', () => {
  // Each entry is one take of the same clause; only the final one is committed.
  let committed = '';
  for (const take of ['增强', '增强的', '增强的有', '增强的有增强的']) {
    committed = buildTranscript(committed, take);
  }
  assert.equal(committed, '增强的有增强的');
});

test('commits clauses in order without duplicating the transcript', () => {
  // Mirrors the service: non-final takes replace the clause, `isFinal` commits it.
  let committed = '';
  const reported = [
    ['今', false], ['今天', false], ['今天给', false],
    ['今天给大家', true],
    ['介', false], ['介绍', false], ['介绍个音频', true],
  ];
  for (const [text, isFinal] of reported) {
    const transcript = buildTranscript(committed, text);
    if (isFinal) {
      committed = transcript;
    }
  }
  assert.equal(committed, '今天给大家介绍个音频');
});

test('ignores empty engine results', () => {
  assert.equal(buildTranscript('你好', '   '), '你好');
  assert.equal(normalizeRecognizedText(''), '');
});
