// Two explicit paid calls, only the checked-in SYNTHETIC PCM fixture. Never
// opens SQLite, app recordings, the running backend, or a configurable audio path.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import WebSocket, { WebSocketServer } from 'ws';
import { attachDeepgramSession } from './deepgram/session.mjs';
const require = createRequire(import.meta.url), { load } = require('../tests/load-typescript.cjs');
const model = load('src/features/recorder/live-speakers/live-speakers.model.ts');
const evidence = load('src/features/recorder/live-speakers/speaker-evidence.ts', { './live-speakers.model': model });
const source = load('src/features/recorder/recorder.transcripts.ts');
const { LiveTranscriptionConnection } = load('src/features/recorder/live/live-transcription.service.ts', { '../live-speakers/live-speakers.model': model }, { WebSocket });
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/deepgram-quiet/reference.json', import.meta.url)));
const pcm = readFileSync(new URL('../tests/fixtures/deepgram-quiet/conversation.pcm', import.meta.url));
if (process.argv[2] !== '--synthetic-only' || !process.env.DEEPGRAM_API_KEY?.trim()) throw new Error('Use --synthetic-only with backend Deepgram configuration.');
if (fixture.synthetic !== true || fixture.sampleRate !== 24000 || pcm.length > 1_440_000 || pcm.length % 2 || fixture.durationMs > 30000) throw new Error('Synthetic fixture bound failed.');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = [];
for (const diarizer of ['v1', 'latest']) {
  const http = createServer(), wss = new WebSocketServer({ server: http });
  const rawEvents = []; let calls = 0, bytes = 0, failure = null, actualConfiguration;
  wss.on('connection', socket => attachDeepgramSession(socket, { enabled: true, apiKey: process.env.DEEPGRAM_API_KEY,
    createUpstreamSocket: (url, options) => {
      if (++calls > 1) throw new Error('Provider call bound exceeded');
      const actual = new URL(url); actual.searchParams.set('diarize_model', diarizer);
      actualConfiguration = Object.fromEntries(actual.searchParams);
      const upstream = new WebSocket(actual, options);
      upstream.on('message', data => {
        bytes += data.length;
        if (rawEvents.length >= 256 || bytes > 4 * 1024 * 1024) { failure = 'EVENT_BOUND'; upstream.terminate(); return; }
        try { rawEvents.push(JSON.parse(data.toString())); } catch { failure = 'INVALID_JSON'; }
      });
      return upstream;
    } }));
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  let snapshot, onReady, onDone, firstTextMs = null;
  const ready = new Promise(resolve => { onReady = resolve; }), done = new Promise(resolve => { onDone = resolve; });
  const began = Date.now();
  const connection = new LiveTranscriptionConnection(`ws://127.0.0.1:${http.address().port}`, {
    actualSampleRate: 24000, requestedSampleRate: 24000, channels: 1, encoding: 'int16', traceId: `atlas-id-evaluation-${diarizer}`,
  }, { onReady, onDraft() {}, onSpeakers(value) { snapshot = value; if (firstTextMs === null && [...value.finalResults, ...value.provisionalResults].some(r => r.text)) firstTextMs = Date.now() - began; },
    onFailure(error) { failure ??= error.code; onReady(); onDone(); }, onCompleted: onDone });
  const deadline = setTimeout(() => { failure = 'EVALUATION_DEADLINE'; connection.close('deadline'); onReady(); onDone(); }, 45000);
  try {
    connection.connect(); await ready;
    const started = Date.now();
    for (let offset = 0; offset < pcm.length && !failure; offset += 4800) {
      const part = pcm.subarray(offset, Math.min(offset + 4800, pcm.length));
      connection.sendAudio({ data: part.buffer.slice(part.byteOffset, part.byteOffset + part.length), sampleRate: 24000, channels: 1, timestamp: offset / 48000 });
      await delay(Math.max(0, started + (offset + part.length) / 48 - Date.now()));
    }
    if (!failure) connection.complete(); await done;
    const saved = source.savedLiveSpeakerSource({ provider: 'deepgram', status: failure ? 'failed' : 'completed', speakerSnapshot: snapshot, errorMessage: null }, 'synthetic-id-check');
    const reopened = JSON.parse(JSON.stringify(saved));
    const finalEvents = rawEvents.filter(e => e.type === 'Results' && e.is_final);
    const checks = reopened.finalResults.map(result => {
      const raw = finalEvents.find(e => result.id === `${result.connectionId}:r${Math.round(e.start * 1_000_000)}`);
      assert.ok(raw, 'A saved result must have an exact provider event');
      const rawIds = raw.channel.alternatives[0].words.map(w => w.speaker ?? null);
      assert.deepEqual(result.words.map(w => w.providerSpeaker), rawIds, 'Provider per-word IDs must survive transport/save/reopen');
      const stages = evidence.speakerEvidence(result, reopened.finalResults);
      if (!stages.labelsWithheld) assert.deepEqual(stages.displayedIds, stages.providerIds, 'Distinct provider IDs must remain distinct on display');
      return { startMs: result.startMs, endMs: result.endMs, words: rawIds.length, ...stages };
    });
    const rawWords = finalEvents.flatMap(e => e.channel.alternatives[0].words);
    // Ground truth here is the generator's known isolated-voice time schedule,
    // never names/wording inferred from a meeting. Overlap excluded from mapping.
    const knownVoiceWindows = fixture.reference.filter(r => !r.overlap).map(r => ({ voice: r.voice, startMs: r.startMs, endMs: r.endMs,
      providerIds: [...new Set(rawWords.filter(w => (w.start + w.end) * 500 >= r.startMs && (w.start + w.end) * 500 <= r.endMs).map(w => w.speaker ?? null))] }));
    const row = { diarizer, actualConfiguration, calls, failure, firstTextMs, sampleCount: pcm.length / 2,
      providerFinalEvents: finalEvents.length, savedFinalResults: reopened.finalResults.length, checks, knownVoiceWindows,
      providerMetadata: reopened.sessions.map(s => s.providerMetadata), rawEvents, saved: reopened };
    rows.push(row);
    console.log(JSON.stringify({ ...row, rawEvents: undefined, saved: undefined }));
  } finally {
    clearTimeout(deadline); connection.close('evaluation_finished');
    for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => http.close(resolve));
  }
  // No blind retries after a failed stream or credential rejection.
  if (failure) break;
}
writeFileSync(new URL('../tests/fixtures/deepgram-quiet/speaker-id-evaluation.json', import.meta.url), JSON.stringify({ synthetic: true, performedAt: new Date().toISOString(), referenceStatus: fixture.referenceStatus, rows }, null, 2) + '\n');
