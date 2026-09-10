const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./load-typescript.cjs');

const captureModule = load('src/features/recorder/recorder.capture.ts');

function setup(platform = 'ios') {
  const calls = [];
  // Native boundary double for installed expo-audio 57.0.4 AudioModule.swift:
  // nonempty mixWithOthers options set category/options only; empty playback
  // options explicitly set .default. This does not measure an iPhone route.
  const native = { category: 'ambient', mode: 'default', recording: false, fail: false };
  const service = load('src/services/audio/audio-session.service.ts', {
    'react-native': { Platform: { OS: platform } },
    'expo-audio': { setAudioModeAsync: async (mode) => {
      calls.push(mode);
      if (native.fail) throw new Error('Synthetic session failure');
      assert.equal(native.recording, false, 'must not reconfigure a running file recorder');
      native.category = mode.allowsRecording ? 'playAndRecord' : 'playback';
      if (!mode.allowsRecording && mode.interruptionMode === 'doNotMix') native.mode = 'default';
    } },
  });
  const { AudioSessionProvider } = load('src/services/audio/AudioSessionProvider.tsx', {
    './audio-session.service': service,
    react: {
      createContext: () => ({ Provider: 'provider' }),
      useCallback: (callback) => callback,
      useMemo: (factory) => factory(),
      useRef: (current) => ({ current }),
      useState: (value) => [value, () => {}],
    },
    'react/jsx-runtime': { jsx: (_type, props) => props },
  });
  const session = AudioSessionProvider({ children: null }).value;
  session.registerRecorderProbe(() => ({
    nativeIsRecording: native.recording, recorderId: 'synthetic-recorder', statusIsRecording: native.recording,
  }));
  return { session, service, calls, native };
}

test('live recording → Stop → playback resets measurement mode without changing capture order', { timeout: 2000 }, async () => {
  const { session, native, calls } = setup();
  let streamStops = 0;
  const stream = {
    isStreaming: false, sampleRate: 24000, channels: 1,
    async start() { native.category = 'record'; native.mode = 'measurement'; this.isStreaming = true; },
    stop() { assert.equal(native.recording, false); this.isStreaming = false; streamStops++; },
  };
  const capture = new captureModule.RecorderPcmCapture(stream, () => native.recording);
  // Two complete sessions exercise the existing reusable recorder ownership.
  for (let iteration = 0; iteration < 2; iteration++) {
    await captureModule.prepareRecordingCapture({
      platform: 'ios', liveEnabled: true, capture,
      prepareAudioSession: (prepareCapture) => session.prepareMicrophoneRecording({ reason: 'test', prepareCapture }),
      prepareFile: async () => { native.category = 'playAndRecord'; native.mode = 'default'; },
    });
    native.recording = true;
    assert.equal(native.mode, 'measurement', 'preserve the working live capture setup');
    const before = calls.length;
    assert.equal(await session.prepareRecordingPlayback(), false);
    assert.equal(calls.length, before);
    native.recording = false; // RecorderProvider awaits M4A Stop first.
    capture.release();
    assert.equal(await session.finishMicrophoneRecording(), true);
    assert.equal(native.category, 'playback');
    assert.equal(native.mode, 'default', 'regression: mix-only cleanup retained measurement');
    assert.deepEqual(calls.slice(-2).map(call => call.interruptionMode), ['doNotMix', 'mixWithOthers']);
    assert.ok(calls.slice(-2).every(call => !call.allowsRecording && !call.allowsBackgroundRecording));
    assert.equal(await session.prepareRecordingPlayback(), true);
  }
  assert.equal(streamStops, 2);
});

test('cold playback and replay both reapply native configuration instead of trusting a stale JS mode', { timeout: 2000 }, async () => {
  const { session, native, calls } = setup();
  assert.equal(await session.prepareRecordingPlayback(), true);
  assert.equal(native.mode, 'default');
  native.category = 'playAndRecord';
  native.mode = 'measurement'; // External session change while the JS ref says playback.
  assert.equal(await session.prepareRecordingPlayback(), true);
  assert.equal(calls.length, 4);
  assert.equal(native.category, 'playback');
  assert.equal(native.mode, 'default');
  assert.equal(calls.at(-1).interruptionMode, 'mixWithOthers');
  assert.equal(calls.at(-1).shouldRouteThroughEarpiece, false);
});

test('native or pending microphone ownership rejects playback and leaves the recorder intact', { timeout: 2000 }, async () => {
  const { session, native, calls } = setup();
  native.recording = true;
  assert.equal(await session.finishMicrophoneRecording(), false);
  assert.equal(await session.prepareRecordingPlayback(), false);
  assert.equal(await session.prepareAnimalSoundPlayback(), false);
  assert.equal(calls.length, 0);
  native.recording = false;
  await session.prepareMicrophoneRecording();
  const count = calls.length;
  assert.equal(await session.prepareRecordingPlayback(), false, 'also block between prepare and record');
  assert.equal(calls.length, count);
});

test('session reset errors propagate and a later Play can retry; no silent success', { timeout: 2000 }, async () => {
  const { session, native, calls } = setup();
  native.fail = true;
  await assert.rejects(session.prepareRecordingPlayback(), /Synthetic session failure/);
  assert.equal(calls.length, 1, 'do not restore mixing after a failed reset');
  native.fail = false;
  assert.equal(await session.prepareRecordingPlayback(), true);
  assert.equal(calls.length, 3);
});

test('queued playback superseded by a microphone request cannot change the capture session', { timeout: 2000 }, async () => {
  const { session, calls } = setup();
  const playback = session.prepareRecordingPlayback();
  const recording = session.prepareMicrophoneRecording();
  assert.equal(await playback, false);
  assert.equal(await recording, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].allowsRecording, true);
});

test('Android playback retains one configuration call and the existing mixing policy', { timeout: 2000 }, async () => {
  const { service, calls } = setup('android');
  await service.configurePlaybackAudioMode();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].interruptionMode, 'mixWithOthers');
  assert.equal(calls[0].shouldRouteThroughEarpiece, false);
});
