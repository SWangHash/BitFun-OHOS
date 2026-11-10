const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Exercise the production realtime transcript assembler. Covers the two shapes
// testers reported: a transcript made of disconnected fragments, and text from
// an earlier sentence reappearing at the front of the next one.
const dir = path.join(__dirname, '../entry/src/main/ets/services');

function load(file, dependencies) {
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  const localRequire = (id) => (id in dependencies ? dependencies[id] : {});
  new Function('exports', 'require', outputText)(exports, localRequire);
  return exports;
}

const speechTranscript = load('SpeechTranscript.ets', {});
const { VoiceTranscriptAssembler } = load('VoiceTranscriptAssembler.ets', {
  './SpeechTranscript': speechTranscript,
});

function assembler() {
  return new VoiceTranscriptAssembler();
}

test('a revised clause take replaces the take shown before it', () => {
  const transcript = assembler();
  assert.equal(transcript.apply('帮我看看这个项', false), '帮我看看这个项');
  assert.equal(transcript.apply('帮我看看这个项目', false), '帮我看看这个项目');
  assert.equal(transcript.apply('帮我看看这个项目的报错', false), '帮我看看这个项目的报错');
});

test('a final clause is kept and the next clause is appended', () => {
  const transcript = assembler();
  transcript.apply('帮我看看这个项目', true);
  assert.equal(transcript.apply('报错在哪', false), '帮我看看这个项目报错在哪');
  assert.equal(transcript.apply('报错在', true), '帮我看看这个项目报错在');
  assert.equal(transcript.apply('我贴一段日志', false), '帮我看看这个项目报错在我贴一段日志');
});

test('a session-wide cumulative result does not duplicate the clause', () => {
  const transcript = assembler();
  transcript.apply('帮我看看这个项目', true);
  assert.equal(transcript.apply('帮我看看这个项目报错在哪', false), '帮我看看这个项目报错在哪');
  assert.equal(transcript.apply('帮我看看这个项目报错在哪', true), '帮我看看这个项目报错在哪');
});

test('text already submitted is removed from the next sentence', () => {
  const transcript = assembler();
  transcript.apply('帮我看看这个项目', false);
  assert.equal(transcript.takeSentence(), '帮我看看这个项目');

  // The engine keeps the earlier sentence in front of the new one.
  assert.equal(transcript.apply('帮我看看这个项目再写个测试', false), '再写个测试');
  assert.equal(transcript.apply('帮我看看这个项目再写个测试吧', true), '再写个测试吧');
  assert.equal(transcript.takeSentence(), '再写个测试吧');
});

test('a clause-scoped result is never mistaken for submitted text', () => {
  const transcript = assembler();
  transcript.apply('帮我看看这个项目', true);
  transcript.takeSentence();
  assert.equal(transcript.apply('报错在哪', false), '报错在哪');
  assert.equal(transcript.takeSentence(), '报错在哪');
});

test('repeating the same words after a submit is treated as a new sentence', () => {
  const transcript = assembler();
  transcript.apply('帮我看看这个项目', true);
  assert.equal(transcript.takeSentence(), '帮我看看这个项目');
  // Same text, not longer: the user really said it again.
  assert.equal(transcript.apply('帮我看看这个项目', true), '帮我看看这个项目');
});

test('an empty result never clears what was already heard', () => {
  const transcript = assembler();
  transcript.apply('帮我看看', false);
  assert.equal(transcript.apply('', false), '帮我看看');
  assert.equal(transcript.takeSentence(), '帮我看看');
});

test('a new sentence starts empty after resetUtterance', () => {
  const transcript = assembler();
  transcript.apply('帮我看看这个项目', true);
  transcript.resetUtterance();
  assert.equal(transcript.apply('换个话题', false), '换个话题');
});

test('separates Latin clauses with one space', () => {
  const transcript = assembler();
  transcript.apply('run the tests', true);
  assert.equal(transcript.apply('and report', false), 'run the tests and report');
});
