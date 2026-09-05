// No microphone/file audio is sent. Only whitelisted, sanitized diagnostics print.
import WebSocket from 'ws';
import { createOpenAITranscriptionSessionUpdate, normalizeLiveTranscriptionError } from './live-transcription-protocol.mjs';

const key = process.env.OPENAI_API_KEY?.trim();
if (!key) throw new Error('OPENAI_API_KEY must be configured in server/.env.');
for (const query of ['model=gpt-live-transcribe', 'intent=transcription']) {
  await new Promise((resolve) => {
    let done = false;
    let handshakeStatus = null;
    const socket = new WebSocket(`wss://api.openai.com/v1/realtime?${query}`, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: 10_000 });
    const finish = (error, sessionType) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const normalized = error ? normalizeLiveTranscriptionError(error) : null;
      console.log(JSON.stringify({ query, handshakeStatus, sessionType, code: normalized?.code, upstreamCode: normalized?.upstreamCode, message: normalized?.diagnosticMessage }));
      socket.close();
      resolve();
    };
    const timer = setTimeout(() => finish(new Error('Session ready timeout')), 12_000);
    socket.on('open', () => { handshakeStatus = 101; socket.send(JSON.stringify(createOpenAITranscriptionSessionUpdate())); });
    socket.on('unexpected-response', (_request, response) => {
      handshakeStatus = response.statusCode;
      let body = '';
      response.on('data', (chunk) => { if (body.length < 16_384) body += chunk.toString(); });
      response.on('end', () => {
        let detail;
        try { detail = JSON.parse(body)?.error; } catch { /* Never print raw responses. */ }
        finish(Object.assign(new Error(detail?.message ?? 'Upgrade rejected'), { statusCode: response.statusCode, code: detail?.code, type: detail?.type }));
      });
    });
    socket.on('message', (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === 'error') finish(Object.assign(new Error(event.error?.message ?? 'Upstream error'), { code: event.error?.code, type: event.error?.type }));
      if (event.type === 'session.updated') finish(null, event.session?.type);
    });
    socket.on('error', (error) => finish(error));
  });
}
