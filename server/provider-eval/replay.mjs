import WebSocket from 'ws';
import { Buffer } from 'node:buffer';
import { LIMITS, connectionConfig, PROVIDERS } from './config.mjs';
import { EventJournal } from './events.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function replay({ provider, key, pcm, createSocket = (url, options) => new WebSocket(url, options), limits = LIMITS }) {
  if (!Buffer.isBuffer(pcm) || !pcm.length || pcm.length % limits.frameBytes || pcm.length / 48 > limits.audioMs) throw new Error('INVALID_BOUNDED_PCM');
  const config = connectionConfig(provider, key), began = Date.now();
  const journal = new EventJournal(provider, pcm.length / 48);
  let readyResolve, doneResolve, ready = false, ended = false, failure = null, frames = 0, bytes = 0, eventBytes = 0;
  let completionMetadata = false, finishTimer, stopSent = false, audioStartedAtMs = null;
  const readyPromise = new Promise(resolve => { readyResolve = resolve; }), done = new Promise(resolve => { doneResolve = resolve; });
  const socket = createSocket(config.url, { headers: config.headers, maxPayload: limits.messageBytes, handshakeTimeout: limits.readyMs });
  const finish = error => {
    if (ended) return; failure ??= error; ended = true; readyResolve(); doneResolve();
  };
  const timeout = setTimeout(() => finish('SESSION_DEADLINE'), limits.sessionMs);
  const readyTimer = setTimeout(() => { if (!ready) finish('READY_DEADLINE'); }, limits.readyMs);
  socket.on('error', () => finish('SOCKET_ERROR'));
  socket.on('unexpected-response', (_req, response) => { response.destroy(); finish(`HTTP_${response.statusCode}`); });
  socket.on('close', code => {
    if (!ended) finish(provider === 'deepgram' && stopSent && completionMetadata && code === 1000 ? null : `EARLY_CLOSE_${code}`);
  });
  socket.on('open', () => {
    if (ended) return;
    if (config.start) { try { socket.send(JSON.stringify(config.start)); } catch { finish('CONTROL_SEND_ERROR'); return; } }
    if (provider === 'deepgram') { ready = true; readyResolve(); }
  });
  socket.on('message', (data, binary) => {
    if (ended) return;
    eventBytes += data.length;
    if (binary || data.length > limits.messageBytes || eventBytes > limits.eventBytes || journal.rawEvents.length >= limits.events) { finish('EVENT_BOUND'); return; }
    try {
      // Avoid echoing a credential if a provider includes it in an error. All
      // synthetic transcript content otherwise remains in the private artifact.
      const event = JSON.parse(data.toString().split(key).join('[REDACTED_CREDENTIAL]'));
      const decoded = journal.accept(event, Date.now() - began);
      if (decoded.error) { finish(decoded.error); return; }
      if (decoded.ready) { ready = true; readyResolve(); }
      if (decoded.completionMetadata) completionMetadata = true;
      if (decoded.complete) finish(stopSent ? null : 'PREMATURE_COMPLETION');
    } catch (error) { finish(/^[A-Z_]+$/.test(error.message) ? error.message : 'EVENT_PARSE_ERROR'); }
  });
  try {
    await readyPromise;
    const audioBegan = Date.now();
    for (let offset = 0; offset < pcm.length && !ended; offset += limits.frameBytes) {
      const scheduled = audioBegan + offset / 48;
      await delay(Math.max(0, scheduled - Date.now()));
      if (ended) break;
      if (Date.now() - scheduled > 500) { finish('REPLAY_PACING_LAG'); break; }
      if (socket.bufferedAmount > limits.socketBytes) { finish('SOCKET_BACKPRESSURE'); break; }
      const part = pcm.subarray(offset, offset + limits.frameBytes);
      if (audioStartedAtMs === null) audioStartedAtMs = Date.now() - began;
      try { socket.send(part, { binary: true }, error => { if (error) finish('AUDIO_SEND_ERROR'); }); }
      catch { finish('AUDIO_SEND_ERROR'); break; }
      frames++; bytes += part.length;
    }
    if (!ended) {
      await delay(Math.max(0, audioBegan + pcm.length / 48 - Date.now()));
      if (!ended) {
        journal.markStop(Date.now() - began); stopSent = true;
        try { socket.send(JSON.stringify(config.finish(frames))); }
        catch { finish('CONTROL_SEND_ERROR'); }
        if (!ended) finishTimer = setTimeout(() => finish('FINALIZATION_DEADLINE'), limits.finishMs);
      }
    }
    await done;
    const wallMs = Date.now() - began, result = journal.snapshot();
    const reportedSeconds = provider === 'assemblyai' ? result.usage?.session_duration_seconds : null;
    const pricedSeconds = typeof reportedSeconds === 'number' && Number.isFinite(reportedSeconds) && reportedSeconds >= 0 ? reportedSeconds : Math.max(wallMs / 1000, pcm.length / 48000);
    return { ...result, status: failure ? 'failed' : 'completed', failure, requested: { url: config.url, start: config.start },
      audioBytesSent: bytes, frameCount: frames, wallMs, expectedAudioMs: pcm.length / 48,
      audioStartedAtMs,
      provisionalLabeledAfterFirstAudioMs: result.firstProvisionalLabeledMs === null || audioStartedAtMs === null ? null : result.firstProvisionalLabeledMs - audioStartedAtMs,
      finalLabeledAfterFirstAudioMs: result.firstFinalLabeledMs === null || audioStartedAtMs === null ? null : result.firstFinalLabeledMs - audioStartedAtMs,
      estimatedUsd: pricedSeconds / 60 * PROVIDERS[provider].pricePerMinute,
      invoiceCostUsd: null, costBasis: reportedSeconds == null ? 'Published rate × larger of audio/wall time; invoice unverified' : 'Published rate × provider-reported session seconds; invoice unverified' };
  } finally {
    clearTimeout(timeout); clearTimeout(readyTimer); clearTimeout(finishTimer);
    // Attempt explicit termination on handled errors as well; no reconnect.
    if (!stopSent && socket.readyState === WebSocket.OPEN) { try { socket.send(JSON.stringify(config.finish(frames))); } catch { /* transport already closed */ } }
    socket.terminate();
  }
}
