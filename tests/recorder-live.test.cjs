/* eslint-disable react-hooks/rules-of-hooks -- Execute the production hook inside a controlled hook harness. */
const assert = require('node:assert/strict');
const test = require('node:test');
const { load, hooks } = require('./load-typescript.cjs');

const { RecorderPcmCapture, prepareRecordingCapture } = load('src/features/recorder/recorder.capture.ts');
const liveErrors = load('src/features/recorder/live/live-transcription.errors.ts');
const setup = (globals = {}) => {
  const harness = hooks();
  const connections = [];
  const logs = [];
  let background;
  let nextTrace = 0;
  const { useLiveTranscription } = load('src/features/recorder/live/useLiveTranscription.ts', {
    react: harness.react,
    'react-native': { AppState: { addEventListener: (_event, callback) => { background = callback; return { remove() {} }; } } },
    '../../../config/app.config': { appConfig: { apiUrl: 'http://atlas.test' } },
    './live-transcription.errors': liveErrors,
    '../recording-transcription.errors': {
      createTranscriptionTraceId: () => `trace-${++nextTrace}`,
      getBackendHost: () => 'atlas.test',
      logTranscriptionEvent: (...args) => logs.push(args),
    },
    './live-transcription.service': {
      deriveLiveTranscriptionWebSocketUrl: () => 'ws://atlas.test/live-transcribe',
      LiveTranscriptionConnection: class {
        constructor(_url, metadata, callbacks) { this.metadata = metadata; this.callbacks = callbacks; this.closed = false; this.completed = false; this.buffers = []; connections.push(this); }
        connect() {}
        close() { this.closed = true; }
        complete() { this.completed = true; }
        sendAudio(buffer) { this.buffers.push(buffer); }
      },
    },
  }, globals);
  return { harness, live: useLiveTranscription(), connections, logs, background: (next) => background(next) };
};

for (const mode of ['off', 'success', 'failure']) {
  test(`recorder PCM ownership stays independent with live ${mode}`, async () => {
    const { harness, live, connections } = setup();
    let recording = false;
    let stops = 0;
    const stream = { isStreaming: false, sampleRate: 24_000, channels: 1,
      async start() { assert.equal(recording, false); this.isStreaming = true; },
      stop() { assert.equal(recording, false, 'SDK stop would deactivate the active recorder'); this.isStreaming = false; stops += 1; },
    };
    const capture = new RecorderPcmCapture(stream, () => recording);
    if (mode !== 'off') await capture.prepare();
    recording = true;
    if (mode !== 'off') {
      await live.startLiveTranscription({ recorderSessionId: 'rec-test', actualSampleRate: 24_000 });
      connections[0].callbacks.onReady();
      if (mode === 'failure') connections[0].callbacks.onFailure({ code: 'LIVE_CONNECTION_FAILED', message: 'Upstream failed' });
    }
    live.stopLiveTranscription('recording_stop_requested');
    assert.equal(stops, 0, 'network cleanup must never stop native capture');
    assert.equal(recording, true);
    if (mode === 'failure') {
      assert.equal(harness.state().status, 'failed');
      assert.ok(harness.state().errorMessage);
      assert.equal(connections[0].completed, false);
    }
    if (mode === 'success') {
      assert.equal(harness.state().status, 'finishing');
      connections[0].callbacks.onDraft('one two three');
      connections[0].callbacks.onCompleted();
      assert.equal(harness.state().draft, 'one two three');
      assert.equal(harness.state().status, 'completed');
    }
    recording = false; // Owner awaits native M4A stop before this point.
    capture.release();
    capture.release();
    assert.equal(stops, mode === 'off' ? 0 : 1);
    harness.unmount();
  });
}

test('background, failure and unmount cleanup close networking and never touch native APIs', async () => {
  const { live, connections, harness, background } = setup();
  await live.startLiveTranscription({ recorderSessionId: 'one', actualSampleRate: 24_000 });
  background('background');
  live.stopLiveTranscription('stop');
  assert.equal(harness.state().status, 'paused');
  assert.equal(connections[0].closed, true);
  await live.startLiveTranscription({ recorderSessionId: 'two', actualSampleRate: 24_000 });
  connections[0].callbacks.onDraft('stale words');
  connections[0].callbacks.onCompleted();
  connections[0].callbacks.onFailure({ code: 'stale' });
  assert.equal(harness.state().status, 'connecting');
  assert.equal(harness.state().draft, '');
  harness.unmount();
  assert.equal(connections[1].closed, true);
});

test('failure followed immediately by Stop and stale ready cannot become completed', async () => {
  const { live, connections, harness, logs } = setup();
  await live.startLiveTranscription({ recorderSessionId: 'one', actualSampleRate: 24_000 });
  connections[0].callbacks.onFailure({ code: 'failure', message: 'failed' });
  live.stopLiveTranscription('stop');
  connections[0].callbacks.onReady();
  connections[0].callbacks.onCompleted();
  assert.equal(harness.state().status, 'failed');
  assert.equal(logs.some((log) => log[1] === 'LIVE_STREAM_COMPLETED'), false);
  harness.unmount();
});

test('stale backend address timeout shows actionable guidance and stays failed after Stop', async () => {
  const { live, connections, harness } = setup();
  await live.startLiveTranscription({ recorderSessionId: 'stale-ip', actualSampleRate: 24000 });
  live.sendLiveAudio({ data: new ArrayBuffer(4800), sampleRate: 24000, channels: 1 });
  connections[0].callbacks.onFailure({ code: 'LIVE_CONNECTION_TIMEOUT', message: 'ready timeout' });
  const failure = harness.state().errorMessage;
  assert.match(failure, /timed out at atlas.test/);
  assert.match(failure, /Wi-Fi address is current/);
  assert.match(failure, /Metro connecting does not confirm/);
  live.stopLiveTranscription('stop');
  connections[0].callbacks.onReady();
  assert.equal(harness.state().status, 'failed');
  assert.equal(harness.state().errorMessage, failure);
  assert.equal(connections[0].completed, false);
  harness.unmount();
});

test('live error UI reveals only the endpoint host, never credentials, path, query, or raw server errors', () => {
  const message = liveErrors.getLiveTranscriptionUserMessage('LIVE_CONNECTION_TIMEOUT', 'http://user:secret@10.0.0.104:8787/private-path?token=secret#secret');
  assert.match(message, /10\.0\.0\.104:8787/);
  assert.doesNotMatch(message, /user|secret|private-path|token=/);
  assert.match(liveErrors.getLiveTranscriptionUserMessage('LIVE_API_URL_MISSING', null), /EXPO_PUBLIC_API_URL/);
  assert.match(liveErrors.getLiveTranscriptionUserMessage('LIVE_CAPTURE_UNAVAILABLE', 'http://atlas.test'), /microphone streaming/);
});

test('missing native stream metadata is diagnosed as capture failure, not missing backend configuration', async () => {
  const { live, connections, harness, logs } = setup();
  assert.equal(await live.startLiveTranscription({ recorderSessionId: 'missing-rate', actualSampleRate: null }), false);
  assert.equal(connections.length, 0);
  assert.match(harness.state().errorMessage, /microphone streaming/);
  assert.ok(logs.some((entry) => entry[3].code === 'LIVE_CAPTURE_UNAVAILABLE'));
  harness.unmount();
});

test('native PCM start/stop are prohibited during authoritative recording', async () => {
  const capture = new RecorderPcmCapture({ start() { assert.fail('native start reached'); }, stop() { assert.fail('native stop reached'); }, isStreaming: true }, () => true);
  await assert.rejects(capture.prepare(), /cannot start/);
  assert.throws(() => capture.release(), /cannot stop/);
});

test('iOS PCM survives file preparation that reconfigures the shared native session', async () => {
  let recording = false;
  let engineRunning = false;
  let filePrepared = false;
  const stream = { isStreaming: false, sampleRate: 24000, channels: 1,
    async start() { assert.equal(recording, false); engineRunning = this.isStreaming = true; },
    stop() { assert.equal(recording, false); engineRunning = this.isStreaming = false; },
  };
  const capture = new RecorderPcmCapture(stream, () => recording);
  const prepareFile = async () => { engineRunning = false; filePrepared = true; }; // Native configuration change stops AVAudioEngine.
  await capture.prepare();
  await prepareFile();
  assert.equal(engineRunning, false, 'reproduces the previous order losing PCM while isStreaming stays true');
  assert.equal(stream.isStreaming, true);
  capture.release();
  const result = await prepareRecordingCapture({ platform: 'ios', liveEnabled: true, capture,
    prepareAudioSession: async () => { engineRunning = false; return true; }, prepareFile,
  });
  recording = true;
  assert.equal(filePrepared, true);
  assert.equal(engineRunning, true, 'PCM remains active when M4A record begins');
  assert.equal(result.actualSampleRate, 24000);
  assert.equal(result.captureError, undefined);
  recording = false;
  capture.release();
});

test('iOS live startup failure restores recording session and leaves file recording available', async () => {
  let sessionActive = false;
  let prepared = false;
  const stream = { isStreaming: false, sampleRate: 24000, channels: 1,
    async start() { sessionActive = false; throw new Error('PCM unavailable'); }, stop() { sessionActive = false; },
  };
  const result = await prepareRecordingCapture({ platform: 'ios', liveEnabled: true, capture: new RecorderPcmCapture(stream, () => false),
    prepareAudioSession: async () => { sessionActive = true; return true; },
    prepareFile: async () => { prepared = true; },
  });
  assert.equal(sessionActive && prepared, true);
  assert.equal(result.captureError, 'PCM unavailable');
  assert.equal(result.actualSampleRate, null);
});

test('Android preserves PCM acquisition before audio mode and file preparation; live off never starts PCM', async () => {
  for (const liveEnabled of [true, false]) {
    const calls = [];
    const stream = { isStreaming: false, sampleRate: 24000, channels: 1, async start() { calls.push('pcm'); this.isStreaming = true; }, stop() {} };
    await prepareRecordingCapture({ platform: 'android', liveEnabled, capture: new RecorderPcmCapture(stream, () => false),
      prepareAudioSession: async (beforeMode) => { await beforeMode?.(); calls.push('audio-mode'); return true; },
      prepareFile: async () => { calls.push('file-prepare'); },
    });
    assert.deepEqual(calls, [...(liveEnabled ? ['pcm'] : []), 'audio-mode', 'file-prepare']);
  }
});

test('development forced failure fires after startup and remains failed on Stop', async () => {
  let forceFailure;
  const { live, harness, connections, logs } = setup({
    setTimeout: (callback, delay) => { assert.equal(delay, 1300); forceFailure = callback; return 1; },
    clearTimeout() {},
  });
  await live.startLiveTranscription({ recorderSessionId: 'forced-test', actualSampleRate: 24000, forceFailure: true });
  connections[0].callbacks.onReady();
  forceFailure();
  live.stopLiveTranscription('stop');
  assert.equal(harness.state().status, 'failed');
  assert.ok(logs.some((entry) => entry[3].code === 'LIVE_FORCED_FAILURE'));
  assert.equal(connections[0].closed, true);
  harness.unmount();
});

test('failed native capture preparation releases before local recording may begin', async () => {
  let stopped = false;
  const stream = { isStreaming: true, sampleRate: 24_000, channels: 2, start: async () => {}, stop: () => { stopped = true; } };
  await assert.rejects(new RecorderPcmCapture(stream, () => false).prepare(), /unsupported/);
  assert.equal(stopped, true);
});

test('live diagnostics distinguish ready, native delivery and draft publication without logging content', async () => {
  let publishDraft;
  const { live, harness, connections, logs } = setup({
    setTimeout: (callback, delay) => { assert.equal(delay, 250); publishDraft = callback; return 1; },
    clearTimeout() {},
  });
  await live.startLiveTranscription({ recorderSessionId: 'diagnostics-test', actualSampleRate: 24000 });
  connections[0].callbacks.onReady('current-backend');
  assert.equal(logs.find((entry) => entry[1] === 'LIVE_TRANSCRIPTION_REQUESTED')[3].liveMode, 'on');
  assert.equal(logs.find((entry) => entry[1] === 'LIVE_CONNECTION_READY')[3].backendRevision, 'current-backend');
  assert.equal(logs.some((entry) => entry[1] === 'LIVE_FIRST_NATIVE_BUFFER'), false, 'ready is not evidence of native delivery');
  for (let i = 0; i < 3; i += 1) live.sendLiveAudio({ data: new ArrayBuffer(4800), sampleRate: 24000, channels: 1 });
  connections[0].callbacks.onDraft('private test transcript');
  publishDraft();
  assert.equal(harness.state().draft, 'private test transcript');
  assert.equal(logs.filter((entry) => entry[1] === 'LIVE_FIRST_NATIVE_BUFFER').length, 1);
  assert.equal(logs.filter((entry) => entry[1] === 'LIVE_FIRST_DRAFT_PUBLISHED').length, 1);
  live.stopLiveTranscription('stop');
  const summary = logs.find((entry) => entry[1] === 'LIVE_AUDIO_DELIVERY_SUMMARY')[3];
  assert.equal(summary.nativeBuffers, 3);
  assert.equal(summary.nativeBytes, 14400);
  assert.equal(JSON.stringify(logs).includes('private test transcript'), false);
  assert.equal(JSON.stringify(logs).includes('"data"'), false);
  harness.unmount();
});

test('upstream rejection before native delivery remains a failure with a zero-buffer summary', async () => {
  const { live, harness, connections, logs } = setup();
  await live.startLiveTranscription({ recorderSessionId: 'upstream-test', actualSampleRate: 24000 });
  connections[0].callbacks.onFailure({ code: 'LIVE_CONNECTION_FAILED', message: 'LIVE_OPENAI_UPSTREAM_FAILED (openai_connection): Live transcript unavailable.' });
  live.sendLiveAudio({ data: new ArrayBuffer(4800), sampleRate: 24000, channels: 1 });
  live.stopLiveTranscription('stop');
  assert.equal(harness.state().status, 'failed');
  assert.equal(logs.find((entry) => entry[1] === 'LIVE_AUDIO_DELIVERY_SUMMARY')[3].nativeBuffers, 0);
  assert.equal(connections[0].buffers.length, 0);
  assert.equal(connections[0].completed, false);
  harness.unmount();
});

for (const [nativeDuration, playableDuration, size] of [[5905, 1461, 68834], [6718, 1252, 64301], [15000, 14980, 240000]]) {
  test(`integrity validates actual playable duration ${nativeDuration}/${playableDuration}`, async () => {
    const { validateFinalizedRecording } = load('src/features/recorder/recorder.integrity.ts', {
      'expo-audio': { createAudioPlayer: () => ({ currentStatus: { isLoaded: true, duration: playableDuration / 1000 }, release() {} }) },
      'expo-file-system': { File: class { exists = true; info() { return { size, modificationTime: 10 }; } } },
    }, { setTimeout: (callback) => { callback(); return 1; } });
    const result = await validateFinalizedRecording('rec-test', 'file:///source.m4a', nativeDuration);
    assert.equal(result.passed, nativeDuration === 15000);
    if (!result.passed) assert.ok(result.failedChecks.some((check) => check.id === 'native_matches_playable_duration'));
  });
}

test('save barrier includes final events during Stop before the UI batch publishes and survives reset', async () => {
  const { live, connections, harness } = setup();
  const { savedLiveSource } = load('src/features/recorder/recorder.transcripts.ts');
  await live.startLiveTranscription({ recorderSessionId: 'multi-person', actualSampleRate: 24000 });
  const callbacks = connections[0].callbacks;
  callbacks.onReady();
  callbacks.onDraft('First voice.', [{ itemId: 'a', deltaText: 'First voi', finalText: 'First voice.' }]);
  let saved = false;
  const finalization = live.finishLiveTranscription().then(snapshot => { saved = true; return savedLiveSource(snapshot, 'multi-person'); });
  await Promise.resolve();
  assert.equal(saved, false, 'saving must wait for live completion');
  const segments = [{ itemId: 'a', deltaText: 'First voi', finalText: 'First voice.' }, { itemId: 'b', deltaText: ' quiet', finalText: ' quieter second voice.\n' }];
  callbacks.onDraft('First voice.  quieter second voice.\n', segments);
  assert.equal(harness.state().draft, 'First voice.', 'last event has not reached the batched UI');
  callbacks.onCompleted();
  const source = await finalization;
  assert.equal(source.text, 'First voice.  quieter second voice.\n');
  assert.equal(source.status, 'completed');
  assert.equal(source.recorderSessionId, 'multi-person');
  assert.equal(source.segments[1].finalText, ' quieter second voice.\n');
  segments[1].finalText = 'external mutation';
  live.resetLiveTranscription();
  callbacks.onDraft('late stale event');
  assert.equal(source.segments[1].finalText, ' quieter second voice.\n');
  assert.equal(live.getLiveSnapshot().draft, '');
  harness.unmount();
});

test('Stop timeout retains accumulated text as failed instead of hanging or reporting completed', async () => {
  const timers = new Map();
  const { live, connections, harness } = setup({ setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; }, clearTimeout: ms => timers.delete(ms) });
  await live.startLiveTranscription({ recorderSessionId: 'timeout', actualSampleRate: 24000 });
  connections[0].callbacks.onDraft('Words already received.');
  const finalization = live.finishLiveTranscription();
  timers.get(16000)();
  const result = await finalization;
  assert.equal(result.status, 'failed');
  assert.equal(result.draft, 'Words already received.');
  assert.match(result.errorMessage, /timed out/);
  assert.equal(connections[0].closed, true);
  harness.unmount();
});

test('background during Stop releases save barrier with a partial source, not a completed transcript', async () => {
  const { live, connections, background, harness } = setup();
  await live.startLiveTranscription({ recorderSessionId: 'background', actualSampleRate: 24000 });
  connections[0].callbacks.onDraft('Before background.');
  const finalization = live.finishLiveTranscription();
  background('background');
  assert.equal((await finalization).status, 'paused');
  assert.equal((await finalization).draft, 'Before background.');
  harness.unmount();
});

test('experimental speaker Stop saves final refs before UI batching; failure never touches the local capture', async () => {
  const { live, connections, harness } = setup();
  const { savedLiveSource, savedLiveSpeakerSource } = load('src/features/recorder/recorder.transcripts.ts');
  await live.startLiveTranscription({ recorderSessionId: 'speaker-stop', actualSampleRate: 24000, provider: 'deepgram' });
  let nativeRecording = true, nativeStops = 0;
  const capture = new RecorderPcmCapture({ stop() { nativeStops++; } }, () => nativeRecording);
  connections[0].callbacks.onReady();
  const before = { sessions: [], finalResults: [], provisionalResults: [], text: '' };
  connections[0].callbacks.onSpeakers(before);
  const finalization = live.finishLiveTranscription();
  const final = { ...before, text: 'Last quiet speaker.', finalResults: [{ id: 'dg-test:r0', text: 'Last quiet speaker.', isFinal: true }] };
  connections[0].callbacks.onSpeakers(final);
  connections[0].callbacks.onCompleted();
  const snapshot = await finalization;
  const saved = savedLiveSpeakerSource(snapshot, 'speaker-stop');
  assert.equal(saved.text, 'Last quiet speaker.'); assert.equal(savedLiveSource(snapshot, 'speaker-stop'), null);
  assert.equal(nativeStops, 0); assert.equal(nativeRecording, true);
  final.text = 'external mutation'; live.resetLiveTranscription();
  assert.equal(saved.text, 'Last quiet speaker.'); assert.equal(live.getLiveSnapshot().speakerSnapshot, undefined);
  assert.equal(harness.state().speakerSnapshot, undefined, 'the previous recording must disappear from the next live display');
  nativeRecording = false; capture.release(); harness.unmount();
});
test('a clean provider close cannot label leftover provisional speech as fully completed', async () => {
  const { live, connections, harness } = setup();
  await live.startLiveTranscription({ recorderSessionId: 'unfinished-close', actualSampleRate: 24000, provider: 'deepgram' });
  connections[0].callbacks.onSpeakers({ sessions: [], finalResults: [], provisionalResults: [{ text: 'unfinished speech' }], text: '' });
  const finishing = live.finishLiveTranscription(); connections[0].callbacks.onCompleted();
  assert.equal((await finishing).status, 'failed'); assert.match((await finishing).errorMessage, /unfinalized/);
  harness.unmount();
});
test('experimental provider failure/Stop timeout preserves partial speaker snapshot and actionable status', async () => {
  const timers = new Map();
  const { live, connections, harness } = setup({ setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; }, clearTimeout: ms => timers.delete(ms) });
  await live.startLiveTranscription({ recorderSessionId: 'speaker-timeout', actualSampleRate: 24000, provider: 'deepgram' });
  connections[0].callbacks.onSpeakers({ sessions: [], finalResults: [], provisionalResults: [{ text: 'Not final yet' }], text: '' });
  const finalization = live.finishLiveTranscription(); timers.get(16000)();
  const value = await finalization;
  assert.equal(value.status, 'failed'); assert.equal(value.speakerSnapshot.provisionalResults[0].text, 'Not final yet');
  assert.equal(value.draft, ''); assert.equal(connections[0].closed, true);
  harness.unmount();
});
