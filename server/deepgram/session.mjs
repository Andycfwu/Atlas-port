import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { parseLiveClientControlMessage, isValidLiveTraceId } from '../live-transcription-protocol.mjs';
import { DEEPGRAM_CONFIG, deepgramAvailability, deepgramUrl, normalizeStreamingResult, providerMetadata } from './protocol.mjs';

export const DEEPGRAM_LIMITS = Object.freeze({ queueBytes: 512 * 1024, socketBytes: 512 * 1024, messageBytes: 256 * 1024,
  startMs: 5000, readyMs: 8000, idleMs: 20_000, finishMs: 10_000, sessionMs: 15 * 60_000, keepAliveMs: 3000 });
const messages = {
  DEEPGRAM_UNAVAILABLE: 'Live speaker labels are unavailable. Configure DEEPGRAM_API_KEY and ATLAS_DEEPGRAM_LIVE_ENABLED=1 on the backend.',
  DEEPGRAM_CONNECTION: 'Deepgram could not connect. Check the server key, provider access, and network. Original audio continues recording locally.',
  DEEPGRAM_DISCONNECTED: 'Live speaker labels disconnected. Received text is preserved; save the audio, then start a new recording to reconnect. Speaker numbers do not carry across connections.',
  DEEPGRAM_BACKPRESSURE: 'Live speaker labels could not keep up. Received text is preserved; local audio continues recording.',
  DEEPGRAM_FINALIZATION_TIMEOUT: 'Deepgram did not finish before the Stop deadline. Received final and provisional text are saved separately; the transcript may be incomplete.',
  DEEPGRAM_INVALID_RESULT: 'Deepgram returned an unsupported result. Received text is preserved; local audio continues recording.',
  DEEPGRAM_INVALID_AUDIO: 'The live audio stream was invalid or exceeded the 15-minute prototype limit. Save the local recording.',
  DEEPGRAM_IDLE: 'No live audio reached the backend for 20 seconds. Save the local recording and retry.',
};
// Uses the existing admitted client socket and native PCM stream. Never owns a microphone or saved file.
export function attachDeepgramSession(client, { apiKey, enabled = false, createUpstreamSocket = (url, options) => new WebSocket(url, options), limits = DEEPGRAM_LIMITS } = {}) {
  const connectionId = `dg-${randomUUID()}`;
  const timers = new Set(), queue = [], finals = new Map();
  const metrics = { receivedSamples: 0, sentSamples: 0, receivedBuffers: 0, peak: 0, squared: 0, clippedSamples: 0, queuePeakBytes: 0, providerFinalEvents: 0, providerInterimEvents: 0, forwardedResults: 0, duplicateFinals: 0, coveredInterims: 0, repairedInterims: 0 };
  let lastDiagnosticsAt = 0;
  function diagnostics(force = false) {
    if (!force && Date.now() - lastDiagnosticsAt < 5000) return;
    lastDiagnosticsAt = Date.now();
    const { squared, ...counts } = metrics;
    send({ type: 'speaker_diagnostics', metrics: { ...counts, rms: Math.sqrt(squared / Math.max(1, counts.receivedSamples)) } });
  }
  let traceId = `atlas-dg-${randomUUID()}`, upstream, metadata, queueBytes = 0, sentBytes = 0;
  let closed = false, ready = false, stopping = false, closeSent = false, summaryReceived = false, lastFinalEnd = 0;
  let readyTimer, idleTimer, pumpTimer, finishTimer;
  const later = (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; };
  const cancel = timer => { clearTimeout(timer); timers.delete(timer); };
  function cleanup() {
    if (closed) return;
    closed = true; for (const timer of timers) clearTimeout(timer); timers.clear(); queue.length = 0; queueBytes = 0;
    if (upstream && upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
    if (client.readyState === WebSocket.OPEN) client.close(1000, 'live_speaker_stream_ended');
  }
  function fail(code) {
    if (closed) return;
    if (client.readyState === WebSocket.OPEN && client.bufferedAmount <= limits.socketBytes) {
      const { squared, ...counts } = metrics;
      client.send(JSON.stringify({ type: 'speaker_diagnostics', traceId, metrics: { ...counts, rms: Math.sqrt(squared / Math.max(1, counts.receivedSamples)) } }));
      client.send(JSON.stringify({ type: 'error', traceId, code, stage: 'deepgram_stream', message: messages[code] ?? messages.DEEPGRAM_CONNECTION }));
    }
    cleanup();
  }
  function send(message) {
    if (closed || client.readyState !== WebSocket.OPEN) return false;
    if (client.bufferedAmount > limits.socketBytes) { fail('DEEPGRAM_BACKPRESSURE'); return false; }
    client.send(JSON.stringify({ ...message, traceId })); return true;
  }
  function idle() { cancel(idleTimer); idleTimer = later(() => fail('DEEPGRAM_IDLE'), limits.idleMs); }
  function schedulePump(delay = 0) {
    if (pumpTimer || !ready || closed) return;
    pumpTimer = later(() => { pumpTimer = null; try { pump(); } catch { fail('DEEPGRAM_CONNECTION'); } }, delay);
  }
  function pump() {
    if (closed || !ready || upstream.readyState !== WebSocket.OPEN) return;
    if (upstream.bufferedAmount > limits.socketBytes) { schedulePump(20); return; }
    const data = queue.shift();
    if (data) {
      queueBytes -= data.length; sentBytes += data.length;
      upstream.send(data, { binary: true });
      metrics.sentSamples += data.length / 2; diagnostics();
      // Limit catch-up to 1.25x real time; never replay saved private audio.
      schedulePump(Math.max(1, Math.ceil(data.length / (metadata.actualSampleRate * 2) * 1000 / 1.25)));
    } else if (stopping && !closeSent) {
      if (!sentBytes) { fail('DEEPGRAM_INVALID_AUDIO'); return; }
      closeSent = true;
      // Documented CloseStream flushes pending audio, emits final Results,
      // emits summary Metadata, then closes. from_finalize is not guaranteed.
      upstream.send(JSON.stringify({ type: 'CloseStream' }));
    }
  }
  function keepAlive() {
    if (closed || closeSent) return;
    try {
      if (ready && upstream.readyState === WebSocket.OPEN && upstream.bufferedAmount <= limits.socketBytes) upstream.send(JSON.stringify({ type: 'KeepAlive' }));
    } catch { fail('DEEPGRAM_CONNECTION'); return; }
    later(keepAlive, limits.keepAliveMs);
  }
  function connect() {
    if (!deepgramAvailability({ enabled, apiKey }).available) { fail('DEEPGRAM_UNAVAILABLE'); return; }
    readyTimer = later(() => fail('DEEPGRAM_CONNECTION'), limits.readyMs);
    upstream = createUpstreamSocket(deepgramUrl(metadata.actualSampleRate), {
      headers: { Authorization: `Token ${apiKey.trim()}` }, maxPayload: limits.messageBytes, perMessageDeflate: false,
    });
    upstream.on('open', () => {
      if (closed) return;
      cancel(readyTimer); ready = true;
      send({ type: 'ready', backendRevision: DEEPGRAM_CONFIG.configurationVersion, resampling: false, targetSampleRate: metadata.actualSampleRate,
        speakerSession: { connectionId, provider: 'deepgram', configuration: DEEPGRAM_CONFIG,
          sampleRate: metadata.actualSampleRate, timebase: 'provider-stream', audioOffsetMs: null } });
      schedulePump(); keepAlive();
    });
    upstream.on('unexpected-response', (_request, response) => { response.destroy(); fail('DEEPGRAM_CONNECTION'); });
    upstream.on('error', () => fail('DEEPGRAM_CONNECTION'));
    upstream.on('message', (data, binary) => {
      if (closed) return;
      try {
        if (binary || data.length > limits.messageBytes) throw new Error('invalid');
        const event = JSON.parse(data.toString());
        if (!event || typeof event.type !== 'string') throw new Error('invalid');
        if (event.type === 'Error') { fail('DEEPGRAM_CONNECTION'); return; }
        if (event.type === 'Metadata') {
          send({ type: 'speaker_metadata', connectionId, metadata: providerMetadata(event) });
          if (closeSent) summaryReceived = true;
          return;
        }
        if (['SpeechStarted', 'UtteranceEnd'].includes(event.type)) return;
        if (event.type !== 'Results') throw new Error('invalid');
        const result = normalizeStreamingResult(event, connectionId, sentBytes / (metadata.actualSampleRate * 2) * 1000);
        if (result.timingWarning) metrics.repairedInterims++;
        metrics[result.isFinal ? 'providerFinalEvents' : 'providerInterimEvents']++;
        if (result.isFinal) {
          const old = finals.get(result.id);
          // Repeated equivalent final events are idempotent. Conflicting finals
          // must not silently replace already saved evidence.
          const fingerprint = JSON.stringify({ text: result.text, words: result.words, start: result.startMs, end: result.endMs });
          if (old === fingerprint) { metrics.duplicateFinals++; return; }
          if (old || result.startMs < lastFinalEnd - 5 || finals.size >= 5000) throw new Error('invalid');
          finals.set(result.id, fingerprint); lastFinalEnd = Math.max(lastFinalEnd, result.endMs);
        } else if (result.endMs <= lastFinalEnd + 5) { metrics.coveredInterims++; return; }
        if (send({ type: 'speaker_result', result })) metrics.forwardedResults++; diagnostics();
      } catch { fail('DEEPGRAM_INVALID_RESULT'); }
    });
    upstream.on('close', code => {
      if (closed) return;
      if (closeSent && summaryReceived && code === 1000) {
        cancel(finishTimer); diagnostics(true); send({ type: 'completed' }); cleanup();
      } else fail('DEEPGRAM_DISCONNECTED');
    });
  }
  const startTimer = later(() => fail('DEEPGRAM_CONNECTION'), limits.startMs);
  later(() => fail('DEEPGRAM_INVALID_AUDIO'), limits.sessionMs);
  client.on('message', (data, binary) => {
    if (closed) return;
    try {
      if (binary) {
        if (!metadata || stopping || data.length === 0 || data.length % 2 || sentBytes + queueBytes + data.length > metadata.actualSampleRate * 2 * limits.sessionMs / 1000) throw new Error('audio');
        if (queueBytes + data.length > limits.queueBytes) { fail('DEEPGRAM_BACKPRESSURE'); return; }
        metrics.receivedBuffers++;
        for (let i = 0; i < data.length; i += 2) { const raw = data.readInt16LE(i), value = raw / 32768; metrics.receivedSamples++; metrics.squared += value * value; metrics.peak = Math.max(metrics.peak, Math.abs(value)); if (raw === -32768 || raw === 32767) metrics.clippedSamples++; }
        metrics.queuePeakBytes = Math.max(metrics.queuePeakBytes, queueBytes + data.length);
        queue.push(Buffer.from(data)); queueBytes += data.length; idle(); schedulePump(); return;
      }
      const raw = JSON.parse(data.toString());
      if (!metadata && isValidLiveTraceId(raw?.traceId)) traceId = raw.traceId;
      const control = parseLiveClientControlMessage(data.toString());
      if (control.type === 'start') {
        if (metadata) throw new Error('duplicate');
        metadata = control; traceId = control.traceId; cancel(startTimer); idle(); connect();
      } else {
        if (!metadata) throw new Error('start required');
        if (stopping) return;
        stopping = true; cancel(idleTimer);
        finishTimer = later(() => fail('DEEPGRAM_FINALIZATION_TIMEOUT'), limits.finishMs);
        schedulePump();
      }
    } catch { fail('DEEPGRAM_INVALID_AUDIO'); }
  });
  client.on('close', cleanup); client.on('error', cleanup);
  return { connectionId, close: cleanup };
}
