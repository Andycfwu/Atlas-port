// Streams only the purpose-made counting fixture using the actual mobile transport.
// No API key needed here; the running Atlas backend owns credentials.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { load } from '../tests/load-typescript.cjs';
import { sanitizeDiagnosticMessage } from './live-transcription-protocol.mjs';

const wav = readFileSync(new URL('../.expo/live-counting.wav', import.meta.url));
if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected generated WAV fixture');
let pcm;
for (let offset = 12; offset + 8 <= wav.length;) {
  const size = wav.readUInt32LE(offset + 4);
  const tag = wav.toString('ascii', offset, offset + 4);
  if (tag === 'fmt ') {
    if (wav.readUInt16LE(offset + 8) !== 1 || wav.readUInt16LE(offset + 10) !== 1 || wav.readUInt32LE(offset + 12) !== 24000 || wav.readUInt16LE(offset + 22) !== 16) throw new Error('Expected mono PCM16 at 24 kHz');
  }
  if (tag === 'data') pcm = wav.subarray(offset + 8, offset + 8 + size);
  offset += 8 + size + (size % 2);
}
if (!pcm?.length) throw new Error('Fixture has no audio');

const { LiveTranscriptionConnection } = load('src/features/recorder/live/live-transcription.service.ts', {}, { WebSocket });
const socketUrl = process.argv[2] ?? 'ws://127.0.0.1:8787/live-transcribe';
const healthUrl = new URL(socketUrl);
healthUrl.protocol = healthUrl.protocol === 'wss:' ? 'https:' : 'http:';
healthUrl.pathname = healthUrl.pathname.replace(/\/live-transcribe$/, '/health');
const health = await (await fetch(healthUrl, { signal: AbortSignal.timeout(5000) })).json();
if (!health.live?.loadedRevision || health.live.restartRequired) throw new Error('Restart the Atlas backend: its live code is stale or has no runtime revision.');
const traceId = `atlas-live-smoke-${randomUUID()}`;
const startedAt = Date.now();
const result = { traceId, fixture: fileURLToPath(new URL('../.expo/live-counting.wav', import.meta.url)), sampleRate: 24000, channels: 1, encoding: 'int16', fixtureDurationMs: pcm.length / 48, bytesSent: 0, draftEvents: 0, firstDraftMs: null, draftBeforeStop: false, completed: false };
let stopRequested = false;
let failed = null;
let readyResolve;
let finishResolve;
let latestDraft = '';
const ready = new Promise((resolve) => { readyResolve = resolve; });
const finished = new Promise((resolve) => { finishResolve = resolve; });
const connection = new LiveTranscriptionConnection(socketUrl, {
  actualSampleRate: 24000, channels: 1, encoding: 'int16', requestedSampleRate: 24000, traceId,
}, {
  onReady: (backendRevision) => { result.backendRevision = backendRevision; readyResolve(); },
  onDraft: (draft) => {
    latestDraft = draft;
    if (!draft.trim()) return;
    result.draftEvents += 1;
    result.firstDraftMs ??= Date.now() - startedAt;
    result.draftBeforeStop ||= !stopRequested;
  },
  onCompleted: () => { result.completed = true; finishResolve(); },
  onFailure: (error) => { failed = { code: error.code, message: sanitizeDiagnosticMessage(error.message) }; readyResolve(); finishResolve(); },
});
try {
  connection.connect();
  await ready;
  for (let offset = 0; !failed && offset < pcm.length; offset += 4800) {
    const chunk = pcm.subarray(offset, offset + 4800);
    connection.sendAudio({ data: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.length), sampleRate: 24000, channels: 1, timestamp: offset / 48000 });
    result.bytesSent += chunk.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!failed) {
    stopRequested = true;
    connection.complete();
    await finished;
  }
  // Report only counts and fixture match, never transcript content.
  result.characterCount = latestDraft.length;
  result.fixtureRecognized = /(?:twenty|20)/i.test(latestDraft);
  result.failure = failed;
  console.log(JSON.stringify(result));
  if (failed || !result.completed || !result.draftBeforeStop || !result.fixtureRecognized) process.exitCode = 1;
} finally {
  connection.close('smoke_test_finished');
}
