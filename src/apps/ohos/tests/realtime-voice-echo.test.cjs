const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the production barge-in classifier. This covers the decision the
// host makes while the system voice speaks; it does not emulate the speech
// engine, ArkTS compilation, or a device's echo cancellation.
const source = fs.readFileSync(
  path.join(__dirname, '../entry/src/main/ets/services/VoiceEchoGuard.ets'),
  'utf8',
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const echoModule = {};
new Function('exports', outputText)(echoModule);
const { classifyVoiceSignal, normalizeForEcho } = echoModule;

const SPOKEN = '我先把排序函数写出来，然后补上对应的测试。';

test('collapses separators while keeping token boundaries', () => {
  assert.equal(normalizeForEcho('我 把 排序 函数。'), '我 把 排序 函数');
  assert.equal(normalizeForEcho('Write  a SORTING function!'), 'write a sorting function');
  assert.equal(normalizeForEcho('，。！？'), '');
});

test('recognizes a revised echo of the text being spoken', () => {
  assert.equal(classifyVoiceSignal('我先把排序', SPOKEN), 'echo');
  assert.equal(classifyVoiceSignal('排序函数写出来', SPOKEN), 'echo');
  // The engine restarts a clause and re-reports part of it.
  assert.equal(classifyVoiceSignal('先把排序函数', SPOKEN), 'echo');
});

test('treats a genuine interruption as speech', () => {
  assert.equal(classifyVoiceSignal('停一下', SPOKEN), 'speech');
  assert.equal(classifyVoiceSignal('换个话题', SPOKEN), 'speech');
});

test('lets a single-character interruption through', () => {
  // "停" is not part of the answer, so it must interrupt even at one token.
  assert.equal(classifyVoiceSignal('停', SPOKEN), 'speech');
  // A lone syllable the answer contains is the assistant hearing itself.
  assert.equal(classifyVoiceSignal('排', SPOKEN), 'echo');
});

test('allows an interruption that reuses a couple of spoken words', () => {
  assert.equal(classifyVoiceSignal('不要排序，先解释', SPOKEN), 'speech');
});

test('drops a partially matching snapshot instead of acting on it', () => {
  // 3 of 5 tokens come from the answer: neither a clear echo nor a clear request.
  assert.equal(classifyVoiceSignal('我先把天气', SPOKEN), 'ignore');
});

test('ignores snapshots with no comparable tokens', () => {
  assert.equal(classifyVoiceSignal('', SPOKEN), 'ignore');
  assert.equal(classifyVoiceSignal('  。', SPOKEN), 'ignore');
});

test('reports speech when nothing is playing', () => {
  assert.equal(classifyVoiceSignal('帮我看看这个报错', ''), 'speech');
});

test('compares Latin playback by word, not by letter', () => {
  const spoken = 'Let me run the test suite and report the failures.';
  assert.equal(classifyVoiceSignal('let me run the test suite', spoken), 'echo');
  // Shares letters ("e", "t", "s") but no words: this is the user, not an echo.
  assert.equal(classifyVoiceSignal('open the settings page', spoken), 'speech');
  assert.equal(classifyVoiceSignal('stop', spoken), 'speech');
});
