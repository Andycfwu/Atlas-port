import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import WebSocket from 'ws';
import { attachLiveTranscriptionWebSocketServer } from './live-transcription-server.mjs';
import { DEEPGRAM_CONFIG, deepgramAvailability, deepgramUrl, normalizeResult } from './deepgram/protocol.mjs';
import { DEEPGRAM_LIMITS } from './deepgram/session.mjs';
const bounded = { timeout: 8000 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { const deadline = Date.now() + 1800; while (!check()) { if (Date.now() > deadline) throw new Error('Test deadline'); await delay(5); } }
const word = (word, start, end, speaker) => ({ word, start, end, ...(speaker === undefined ? {} : { speaker }) });
const result = (overrides = {}) => ({ type: 'Results', start: 0, duration: 0.1, channel_index: [0,1], is_final: true, speech_final: true,
  channel: { alternatives: [{ transcript: 'synthetic', words: [word('synthetic', 0, 0.1, 0)] }] }, ...overrides });
async function setup(t, { enabled = true, key = 'SYNTHETIC-KEY', provider = 'deepgram', autoOpen = true, limits = {} } = {}) {
  const httpServer = createServer(); let upstream; const calls = { openai: 0, deepgram: 0 }; const messages = [];
  class Fake extends EventEmitter {
    readyState = 0; bufferedAmount = 0; sent = []; options; url;
    constructor(url, options) { super(); this.url = url; this.options = options; if (autoOpen) setTimeout(() => this.open(), 0); }
    open() { this.readyState = 1; this.emit('open'); }
    send(data, options) { this.sent.push(options?.binary ? data : JSON.parse(data)); }
    event(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
    terminate() { this.readyState = 3; this.emit('close', 1006); }
    close() { this.readyState = 3; this.emit('close', 1000); }
  }
  const ws = attachLiveTranscriptionWebSocketServer({ apiKey: 'SYNTHETIC-OPENAI', httpServer, logEvent() {},
    createUpstreamSocket: (...args) => { calls.openai++; return upstream = new Fake(...args); },
    deepgram: { apiKey: key, enabled, limits: { ...DEEPGRAM_LIMITS, ...limits }, createUpstreamSocket: (...args) => { calls.deepgram++; return upstream = new Fake(...args); } } });
  httpServer.listen(0, '127.0.0.1'); await once(httpServer, 'listening');
  const client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}/live-transcribe${provider ? `?provider=${provider}` : ''}`);
  client.on('message', data => messages.push(JSON.parse(data.toString())));
  await once(client, 'open');
  t.after(async () => { client.terminate(); for (const socket of ws.clients) socket.terminate();
    await new Promise(resolve => ws.close(resolve)); await new Promise(resolve => httpServer.close(resolve)); });
  client.send(JSON.stringify({ type: 'start', traceId: 'atlas-live-synthetic-123', requestedSampleRate: 24000, actualSampleRate: 24000, channels: 1, encoding: 'int16' }));
  await until(() => upstream || messages.some(m => m.type === 'error'));
  return { client, messages, calls, upstream, async audio(ms = 200) {
    await until(() => messages.some(m => m.type === 'ready')); client.send(Buffer.alloc(48 * ms));
    await until(() => upstream.sent.some(Buffer.isBuffer));
  } };
}
test('configuration is explicit, selects streaming v1, and missing credentials never imply availability', bounded, () => {
  const url = new URL(deepgramUrl(48000));
  assert.equal(url.protocol, 'wss:'); assert.equal(url.searchParams.get('model'), 'nova-3');
  assert.equal(url.searchParams.get('diarize_model'), 'v1'); assert.equal(url.searchParams.get('sample_rate'), '48000');
  assert.equal(url.searchParams.has('diarize'), false); assert.equal(DEEPGRAM_CONFIG.smart_format, false);
  assert.equal(deepgramAvailability().available, false); assert.equal(deepgramAvailability({ enabled: true }).available, false);
});
test('word-derived passages retain timing, alternating and absent speakers, original text and no invented confidence', bounded, () => {
  const event = result({ duration: 1, channel: { alternatives: [{ transcript: '  yes no maybe\n', words: [word('yes',0,.2,0),word('no',.15,.4,1),word('maybe',.5,.8)] }] } });
  const value = normalizeResult(event, 'dg-a', 1000);
  assert.equal(value.text, '  yes no maybe\n'); assert.deepEqual(value.passages.map(p => p.speakerId), ['dg-a:speaker0','dg-a:speaker1',null]);
  assert.equal(value.passages[1].startMs, 150); assert.equal(JSON.stringify(value).includes('confidence'), false);
  assert.notEqual(value.passages[0].speakerId, normalizeResult(event, 'dg-b', 1000).passages[0].speakerId);
  for (const broken of [result({ start: -1 }), result({ duration: 900 }), result({ is_final: 'true' }), result({ channel_index: [1,2] }), result({ channel: { alternatives: [{ transcript: 'x', words: [word('x',0,.1,-1)] }] } })]) assert.throws(() => normalizeResult(broken, 'dg-a', 1000));
});
test('only selected provider runs; disabled/missing-key Deepgram creates zero provider calls', bounded, async t => {
  for (const options of [{ enabled: false }, { key: '' }]) {
    const h = await setup(t, options); await until(() => h.messages.some(m => m.type === 'error'));
    assert.deepEqual(h.calls, { openai: 0, deepgram: 0 }); assert.equal(h.messages.at(-1).code, 'DEEPGRAM_UNAVAILABLE');
  }
  const original = await setup(t, { provider: null });
  assert.deepEqual(original.calls, { openai: 1, deepgram: 0 });
});
test('Stop drains PCM then CloseStream; late finals and summary precede completion, duplicate finals do not duplicate text', bounded, async t => {
  const h = await setup(t); await h.audio();
  assert.deepEqual(h.calls, { openai: 0, deepgram: 1 });
  h.upstream.event(result({ is_final: false }));
  h.client.send(JSON.stringify({ type: 'complete' }));
  await until(() => h.upstream.sent.some(m => m.type === 'CloseStream'));
  assert.equal(h.messages.some(m => m.type === 'completed'), false);
  h.upstream.event(result()); h.upstream.event(result());
  h.upstream.event({ type: 'Metadata', request_id: 'synthetic-request' }); h.upstream.close();
  await until(() => h.messages.some(m => m.type === 'completed'));
  assert.equal(h.messages.filter(m => m.type === 'speaker_result' && m.result.isFinal).length, 1);
  assert.equal(h.messages.at(-1).type, 'completed');
  assert.equal(h.messages.some(m => m.type === 'speaker_metadata' && m.metadata.requestId === 'synthetic-request'), true);
  assert.equal(JSON.stringify(h.messages).includes('SYNTHETIC-KEY'), false);
});
test('finish timeout, provider failure, malformed events and backpressure are finite failures, never false completion', bounded, async t => {
  const timeout = await setup(t, { limits: { finishMs: 40 } }); await timeout.audio(10);
  timeout.client.send(JSON.stringify({ type: 'complete' }));
  await until(() => timeout.messages.some(m => m.code === 'DEEPGRAM_FINALIZATION_TIMEOUT'));
  assert.equal(timeout.messages.some(m => m.type === 'completed'), false);
  for (const event of [{ type: 'Error', description: 'PRIVATE provider message' }, { type: 'SomethingUnexpected' }, result({ duration: 9999 })]) {
    const h = await setup(t); await h.audio(10); h.upstream.event(event);
    await until(() => h.messages.some(m => m.type === 'error'));
    assert.equal(JSON.stringify(h.messages).includes('PRIVATE'), false);
  }
  const blocked = await setup(t, { limits: { queueBytes: 64 } });
  await until(() => blocked.messages.some(m => m.type === 'ready'));
  blocked.client.send(Buffer.alloc(128));
  await until(() => blocked.messages.some(m => m.code === 'DEEPGRAM_BACKPRESSURE'));
});
test('disconnect preserves received finals and a reconnect creates a fresh speaker namespace without replay', bounded, async t => {
  const first = await setup(t); await first.audio(); first.upstream.event(result());
  await until(() => first.messages.some(m => m.type === 'speaker_result'));
  first.upstream.terminate(); await until(() => first.messages.some(m => m.type === 'error'));
  assert.equal(first.calls.deepgram, 1, 'no automatic reconnect or audio replay');
  const second = await setup(t); await second.audio(); second.upstream.event(result());
  await until(() => second.messages.some(m => m.type === 'speaker_result'));
  assert.notEqual(first.messages.find(m => m.type === 'speaker_result').result.passages[0].speakerId,
    second.messages.find(m => m.type === 'speaker_result').result.passages[0].speakerId);
});

test('PCM includes quiet samples and silence unchanged; counters cover all forwarded bytes without logging speech', bounded, async t => {
  const h = await setup(t); await until(() => h.messages.some(m => m.type === 'ready'));
  const pcm = Buffer.alloc(4800); [0, 1, -1, 17, -21, 32000, -32768].forEach((value, index) => pcm.writeInt16LE(value, index * 2));
  h.client.send(pcm); h.client.send(JSON.stringify({ type: 'complete' }));
  await until(() => h.upstream.sent.some(m => m.type === 'CloseStream'));
  assert.deepEqual(Buffer.concat(h.upstream.sent.filter(Buffer.isBuffer)), pcm);
  h.upstream.event({ type: 'Metadata' }); h.upstream.close();
  await until(() => h.messages.some(m => m.type === 'completed'));
  const counts = h.messages.filter(m => m.type === 'speaker_diagnostics').at(-1).metrics;
  assert.equal(counts.receivedSamples, 2400); assert.equal(counts.sentSamples, 2400); assert.equal(counts.clippedSamples, 1); assert.ok(counts.rms > 0);
});
test('overlapping interim that extends beyond a final prefix is forwarded for honest partial recovery', bounded, async t => {
  const h = await setup(t); await h.audio(500);
  h.upstream.event(result());
  h.upstream.event(result({ duration: .4, is_final: false, channel: { alternatives: [{ transcript: 'synthetic quiet tail', words: [] }] } }));
  await until(() => h.messages.filter(m => m.type === 'speaker_result').length === 2);
  assert.equal(h.messages.filter(m => m.type === 'speaker_result').at(-1).result.text, 'synthetic quiet tail');
});

test('real synthetic malformed interim timing retains text and raw evidence without terminating later speech', bounded, async t => {
  const { normalizeStreamingResult } = await import('./deepgram/protocol.mjs');
  const { readFileSync } = await import('node:fs');
  const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/deepgram-interim-timing.json', import.meta.url)));
  assert.throws(() => normalizeResult(fixture.event, 'dg-test', fixture.audioDurationMs));
  const repaired = normalizeStreamingResult(fixture.event, 'dg-test', fixture.audioDurationMs);
  assert.equal(repaired.text, fixture.event.channel.alternatives[0].transcript);
  assert.equal(repaired.timingWarning, true); assert.equal(repaired.passages[0].speakerId, null);
  assert.equal(repaired.unvalidatedWords.at(-1).endMs, 10420);
  assert.throws(() => normalizeStreamingResult({ ...fixture.event, is_final: true }, 'dg-test', fixture.audioDurationMs));
  const h = await setup(t); await h.audio(500);
  h.upstream.event(result({ is_final:false, channel:{ alternatives:[{ transcript:'Quiet roof estimate',words:[word('Quiet',0,.1,2),word('roof',.1,2,2)] }] } }));
  h.upstream.event(result());
  await until(() => h.messages.filter(m=>m.type==='speaker_result').length===2);
  assert.equal(h.messages.some(m=>m.type==='error'),false);
});
