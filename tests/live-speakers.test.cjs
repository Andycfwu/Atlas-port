const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load-typescript.cjs');
const model = load('src/features/recorder/live-speakers/live-speakers.model.ts');
const source = load('src/features/recorder/recorder.transcripts.ts');
const session = id => ({ connectionId: id, provider: 'deepgram', sampleRate: 24000, timebase: 'provider-stream', audioOffsetMs: null,
  configuration: { configurationVersion: 'atlas-deepgram-live-v1', model: 'nova-3', version: 'latest', diarize_model: 'v1', language: 'en-US' } });
const result = (id, text, isFinal) => ({ id: `${id}:r0`, connectionId: id, startMs: 0, endMs: 100, text, isFinal, speechFinal: isFinal, fromFinalize: false,
  words: [{ text, rawWord: text, startMs: 0, endMs: 100, providerSpeaker: 0 }], providerMetadata: {},
  passages: [{ id: `${id}:r0:p0`, text, startMs: 0, endMs: 100, providerSpeaker: 0, speakerId: `${id}:speaker0` }] });
test('provisional text is replaced by a final; duplicate/late interim cannot rewrite it; namespaces do not imply continuity', () => {
  const a = new model.LiveSpeakerAccumulator(); a.start(session('dg-a'));
  a.accept(result('dg-a', 'perhaps', false)); a.accept(result('dg-a', 'perhaps yes', false));
  assert.equal(a.snapshot().provisionalResults.length, 1); assert.equal(a.snapshot().text, '');
  a.accept(result('dg-a', 'Yes.', true)); a.accept(result('dg-a', 'Yes.', true)); a.accept(result('dg-a', 'stale', false));
  assert.equal(a.snapshot().text, 'Yes.'); assert.equal(a.snapshot().provisionalResults.length, 0);
  assert.throws(() => a.accept(result('dg-a', 'Conflicting', true)), /Conflicting/);
  a.start(session('dg-b')); a.accept(result('dg-b', 'No.', true));
  assert.notEqual(a.snapshot().finalResults[0].passages[0].speakerId, a.snapshot().finalResults[1].passages[0].speakerId);
});
test('saving partial and completed speaker versions preserves exact text and never substitutes for OpenAI live evidence', () => {
  const a = new model.LiveSpeakerAccumulator(); a.start(session('dg-a')); a.accept(result('dg-a','  Final.\n',true));
  a.start(session('dg-b')); a.accept(result('dg-b','unfinished',false));
  for (const status of ['failed','paused','completed']) {
    const snapshot = { provider: 'deepgram', traceId: 'trace', draft: '', status, errorMessage: status === 'failed' ? 'Disconnected' : null, speakerSnapshot: a.snapshot() };
    const saved = source.savedLiveSpeakerSource(snapshot, 'recording-session');
    assert.equal(saved.text, '  Final.\n'); assert.equal(saved.provisionalResults[0].text, 'unfinished');
    assert.equal(saved.status, status); assert.equal(source.savedLiveSource(snapshot, 'recording-session'), null);
    assert.deepEqual(JSON.parse(JSON.stringify(saved)), saved);
    assert.equal(source.preferredTranscript({ liveSpeakerTranscripts: [saved], transcript: 'Explicit post', transcriptionTraceId: 'post' }).source, 'saved_audio');
  }
  assert.equal(source.savedLiveSpeakerSource({ provider: 'openai' }, 'recording-session'), null);
});
test('protocol waits for final speaker events during Stop and publishes their snapshot before completed', { timeout: 2000 }, async () => {
  let socket;
  class Socket { static OPEN = 1; static CONNECTING = 0; readyState = 1; bufferedAmount = 0;
    constructor() { socket = this; } send() {} close() { this.readyState = 3; } }
  const live = load('src/features/recorder/live/live-transcription.service.ts', { '../live-speakers/live-speakers.model': model }, { WebSocket: Socket });
  const events = [];
  const connection = new live.LiveTranscriptionConnection('ws://synthetic/live-transcribe?provider=deepgram', { traceId: 'trace' }, {
    onReady() {}, onDraft() { throw new Error('Must not create OpenAI live text'); }, onFailure: e => events.push(e.code),
    onSpeakers: snapshot => events.push(snapshot), onCompleted: () => events.push('completed'),
  });
  const message = value => socket.onmessage({ data: JSON.stringify({ ...value, traceId: 'trace' }) });
  connection.connect(); socket.onopen();
  message({ type: 'ready', targetSampleRate: 24000, resampling: false, speakerSession: session('dg-a') });
  connection.complete(); await new Promise(resolve => setTimeout(resolve, 10));
  message({ type: 'speaker_result', result: result('dg-a', 'Final sentence at Stop.', true) });
  message({ type: 'completed' });
  assert.equal(events.at(-2).text, 'Final sentence at Stop.'); assert.equal(events.at(-1), 'completed');
});

test('a shorter final retains the quiet provisional tail through save/reopen; later final removes it', () => {
  const a = new model.LiveSpeakerAccumulator(); a.start(session('dg-a'));
  const pending = { ...result('dg-a', 'yes quiet', false), endMs: 300, words: [
    { text: 'yes', rawWord: 'yes', startMs: 0, endMs: 100, providerSpeaker: 0 },
    { text: 'quiet', rawWord: 'quiet', startMs: 200, endMs: 300, providerSpeaker: 2 },
  ], passages: [] };
  a.accept(pending); a.accept(result('dg-a', 'yes', true));
  assert.equal(a.snapshot().provisionalResults[0].text, 'yes quiet');
  assert.equal(model.displayedSpeakerPassages(pending, a.snapshot().finalResults).map(p => p.text).join(' '), 'quiet');
  const saved = source.savedLiveSpeakerSource({ provider: 'deepgram', status: 'failed', speakerSnapshot: a.snapshot() }, 'synthetic-session');
  assert.equal(JSON.parse(JSON.stringify(saved)).provisionalResults[0].text, 'yes quiet');
  a.accept(pending); // Same result-start as a finalized prefix must not hide later words.
  a.accept({ ...result('dg-a', 'quiet', true), id: 'dg-a:r200000', startMs: 200, endMs: 300, words: [pending.words[1]], passages: [] });
  assert.equal(a.snapshot().provisionalResults.length, 0);
  assert.equal(a.snapshot().text, 'yes\nquiet');
});
test('full provider text is shown without guessed speakers when word payload omits a phrase', () => {
  const r = result('dg-a', 'yes', true); r.text = 'yes quiet person agrees';
  const displayed = model.displayedSpeakerPassages(r, []);
  assert.equal(displayed[0].text, r.text); assert.equal(displayed[0].speakerId, null);
});
