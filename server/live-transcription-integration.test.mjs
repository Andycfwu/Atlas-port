import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import WebSocket from 'ws';
import { attachLiveTranscriptionWebSocketServer, OPENAI_REALTIME_URL } from './live-transcription-server.mjs';

const until = async (predicate) => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for test event');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const setup = async (t, { handshakeError = null } = {}) => {
  const httpServer = createServer();
  const messages = [];
  const logs = [];
  let upstream;
  class Upstream extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    sent = [];
    itemCount = 0;
    send(raw) {
      const event = JSON.parse(raw);
      this.sent.push(event);
      if (event.type === 'session.update') queueMicrotask(() => this.event({ type: 'session.updated', session: event.session }));
      if (event.type === 'input_audio_buffer.commit') {
        this.itemCount += 1;
        this.event({ type: 'input_audio_buffer.committed', item_id: `item-${this.itemCount}`, previous_item_id: this.itemCount === 1 ? null : `item-${this.itemCount - 1}` });
      }
    }
    event(event) { this.emit('message', Buffer.from(JSON.stringify(event)), false); }
    close() { this.readyState = 3; this.emit('close', 1000); }
  }
  const wss = attachLiveTranscriptionWebSocketServer({ apiKey: 'test-only-key', httpServer,
    logEvent: (...args) => logs.push(args),
    createUpstreamSocket: (url) => {
      assert.equal(url, 'wss://api.openai.com/v1/realtime?intent=transcription');
      upstream = new Upstream();
      queueMicrotask(() => {
        if (!handshakeError) upstream.emit('open');
        else {
          const response = Readable.from([JSON.stringify({ error: handshakeError })]);
          response.statusCode = 403;
          response.headers = { 'x-request-id': 'req-test' };
          upstream.emit('unexpected-response', {}, response);
        }
      });
      return upstream;
    },
  });
  httpServer.listen(0, '127.0.0.1');
  await once(httpServer, 'listening');
  const client = new WebSocket(`ws://127.0.0.1:${httpServer.address().port}/live-transcribe`);
  client.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
  client.on('error', () => {});
  t.after(async () => {
    client.terminate();
    for (const socket of wss.clients) socket.terminate();
    await new Promise((resolve) => wss.close(resolve));
    await new Promise((resolve) => httpServer.close(resolve));
  });
  await once(client, 'open');
  client.send(JSON.stringify({ type: 'start', actualSampleRate: 24000, requestedSampleRate: 24000, channels: 1, encoding: 'int16', traceId: 'atlas-tx-test-12345678' }));
  await until(() => messages.length);
  return { client, messages, logs, upstream };
};

test('dedicated transcription endpoint drains all audio and all committed turns before completion', async (t) => {
  assert.match(OPENAI_REALTIME_URL, /intent=transcription$/);
  const { client, messages, upstream, logs } = await setup(t);
  client.send(Buffer.alloc(240000)); // 5 seconds, first bounded commit
  client.send(Buffer.alloc(48000)); // trailing second
  client.send(JSON.stringify({ type: 'complete' }));
  await until(() => upstream.itemCount === 2);
  assert.equal(messages.some((m) => m.type === 'completed'), false);
  assert.equal(upstream.sent.filter((m) => m.type === 'input_audio_buffer.append').reduce((sum, m) => sum + Buffer.from(m.audio, 'base64').length, 0), 288000);
  upstream.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-2', transcript: 'private words two' });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(messages.some((m) => m.type === 'completed'), false);
  upstream.event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'item-1', transcript: 'private words one' });
  await until(() => messages.some((m) => m.type === 'completed'));
  assert.equal(messages.at(-1).type, 'completed');
  assert.equal(upstream.readyState, 3);
  assert.doesNotMatch(JSON.stringify(logs), /private words|test-only-key|"audio":/);
});

test('upstream failure after Stop never becomes completed', async (t) => {
  const { client, messages, upstream, logs } = await setup(t);
  client.send(Buffer.alloc(4800));
  client.send(JSON.stringify({ type: 'complete' }));
  await until(() => upstream.itemCount === 1);
  upstream.event({ type: 'conversation.item.input_audio_transcription.failed', event_id: 'event-test', error: { code: 'transcription_failed', type: 'server_error', message: 'Transcription processing failed' } });
  await until(() => messages.some((m) => m.type === 'error'));
  assert.equal(messages.some((m) => m.type === 'completed'), false);
  const details = logs.find((log) => log[1] === 'LIVE_STREAM_FAILURE')[3];
  assert.equal(details.upstreamCode, 'transcription_failed');
  assert.equal(details.handshakeStatus, 101);
  assert.equal(details.upstreamEventId, 'event-test');
});

test('ready followed by Stop without a single audio buffer reports the reproduced capture stall', async (t) => {
  const { client, messages, logs } = await setup(t);
  assert.equal(messages[0].type, 'ready');
  client.send(JSON.stringify({ type: 'complete' }));
  await until(() => messages.some((m) => m.type === 'error'));
  assert.equal(messages.at(-1).code, 'LIVE_NO_AUDIO_RECEIVED');
  assert.equal(messages.at(-1).stage, 'audio_streaming');
  assert.equal(messages.some((m) => m.type === 'completed'), false);
  assert.equal(logs.some((entry) => entry[1] === 'LIVE_STREAM_COMPLETED'), false);
});

test('failed upgrade preserves status, code, request ID and sanitized message', async (t) => {
  const { messages, logs } = await setup(t, { handshakeError: { code: 'permission_denied', type: 'invalid_request_error', message: 'Rejected test-only-key Bearer sk-secretvalue123456 audio=PRIVATE_AUDIO_CONTENT' } });
  assert.equal(messages[0].type, 'error');
  const failure = logs.find((log) => log[1] === 'LIVE_STREAM_FAILURE');
  assert.equal(failure[2], 'atlas-tx-test-12345678');
  assert.equal(failure[3].handshakeStatus, 403);
  assert.equal(failure[3].upstreamStatus, 403);
  assert.equal(failure[3].upstreamCode, 'permission_denied');
  assert.equal(failure[3].upstreamRequestId, 'req-test');
  assert.doesNotMatch(JSON.stringify(logs), /test-only-key|sk-secretvalue|PRIVATE_AUDIO_CONTENT/);
});

test('upstream close while finishing is an error, and short tails are committed safely', async (t) => {
  const { client, messages, upstream } = await setup(t);
  client.send(Buffer.alloc(480));
  client.send(JSON.stringify({ type: 'complete' }));
  await until(() => upstream.itemCount === 1);
  const audio = upstream.sent.filter((m) => m.type === 'input_audio_buffer.append');
  assert.equal(audio.reduce((sum, m) => sum + Buffer.from(m.audio, 'base64').length, 0), 4800);
  upstream.emit('close', 1011);
  await until(() => messages.some((m) => m.type === 'error'));
  assert.equal(messages.some((m) => m.type === 'completed'), false);
});
