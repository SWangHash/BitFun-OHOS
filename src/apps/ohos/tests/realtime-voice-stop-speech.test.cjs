const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// The web-ui cancels the assistant response whenever a new user utterance
// starts. On HarmonyOS that request used to reset the recognition state and arm
// the post-playback cooldown, which chopped the transcript and cancelled the
// pending commit. This exercises the real service with stubbed kits: it does not
// emulate the speech engine, ArkTS compilation, or device behavior.
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
const assembler = load('VoiceTranscriptAssembler.ets', { './SpeechTranscript': speechTranscript });
const echoGuard = load('VoiceEchoGuard.ets', {});

function createService({ speaking = false } = {}) {
  const events = [];
  const rustModule = {
    default: {
      emitRealtimeVoiceEvent(_sessionId, payload) {
        events.push(JSON.parse(payload));
      },
    },
  };
  const hilog = { info() {}, warn() {}, error() {} };
  const serviceModule = load('RealtimeVoiceService.ets', {
    '@kit.AudioKit': {},
    '@kit.CoreSpeechKit': {},
    '@kit.PerformanceAnalysisKit': { hilog },
    'libbitfun_desktop_lib.so': rustModule,
    './SpeechTranscript': speechTranscript,
    './VoiceTranscriptAssembler': assembler,
    './VoiceEchoGuard': echoGuard,
    './VoiceInputService': { ensureMicrophonePermission: async () => undefined },
  });
  const service = new serviceModule.RealtimeVoiceService();
  service.sessionId = 'realtime-test-1';
  service.listening = true;
  service.ttsSpeaking = speaking;
  service.ttsCurrentText = speaking ? '我先看一下这个项目' : '';
  return { service, events };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function result(text, isFinal) {
  return { sessionId: 'realtime-test-1', isFinal, isLast: false, result: text };
}

test('stopping playback from the controller keeps the spoken sentence', async () => {
  const { service } = createService();
  service.handleResult(result('帮我看看这个项目', false));

  await service.stopSpeechNow('');
  service.clearSentenceTimer();

  assert.equal(service.transcript.display(), '帮我看看这个项目');
  assert.equal(service.utteranceActive, true);
  assert.equal(service.speechCooldownUntil, 0);
});

test('recognized speech still commits after the controller cancels playback', async () => {
  const { service, events } = createService();
  service.handleResult(result('帮我看看这个项目', false));
  await service.stopSpeechNow('');
  service.handleResult(result('帮我看看这个项目的报错', true));

  const deltas = events.filter((event) => event.kind === 'user_transcript_delta');
  assert.equal(deltas[deltas.length - 1].text, '帮我看看这个项目的报错');
  assert.equal(events.filter((event) => event.kind === 'user_transcript_completed').length, 0);

  await sleep(1300);

  const completed = events.filter((event) => event.kind === 'user_transcript_completed');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].text, '帮我看看这个项目的报错');
});

test('stopping playback silences the answer and clears its echo reference', async () => {
  const { service } = createService({ speaking: true });

  await service.stopSpeechNow('');

  assert.equal(service.ttsSpeaking, false);
  assert.equal(service.ttsCurrentText, '');
  assert.equal(service.ttsRequestId, '');
  assert.equal(service.speechCooldownUntil, 0);
});

test('a second sentence does not repeat the first one', async () => {
  const { service, events } = createService();
  service.handleResult(result('帮我看看这个项目', true));
  service.commitUtterance();
  service.handleResult(result('帮我看看这个项目再写个测试', true));
  service.commitUtterance();

  const completed = events
    .filter((event) => event.kind === 'user_transcript_completed')
    .map((event) => event.text);
  assert.deepEqual(completed, ['帮我看看这个项目', '再写个测试']);
});

test('the post-playback window only drops text that resembles the answer', async () => {
  const { service, events } = createService({ speaking: true });
  service.handleResult(result('这个项目', true));
  service.finishSpeaking(service.ttsRequestId);

  // The answer's tail is still a match for what was spoken.
  service.handleResult(result('我先看一下这个项目', false));
  // A new request is not.
  service.handleResult(result('现在换个话题', false));

  const deltas = events.filter((event) => event.kind === 'user_transcript_delta');
  assert.equal(deltas[deltas.length - 1].text, '现在换个话题');
  assert.equal(service.speechCooldownUntil, 0);
});
