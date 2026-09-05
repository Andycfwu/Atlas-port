const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./load-typescript.cjs');
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

const setup = () => {
  let socket;
  class Socket {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    bufferedAmount = 0;
    sent = [];
    constructor() { socket = this; }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }); }
  }
  const { LiveTranscriptionConnection } = load('src/features/recorder/live/live-transcription.service.ts', {}, { WebSocket: Socket });
  const events = [];
  const revisions = [];
  const connection = new LiveTranscriptionConnection('ws://test', { actualSampleRate: 24000, channels: 1, encoding: 'int16', requestedSampleRate: 24000, traceId: 'trace-id' }, {
    onReady: (revision) => { revisions.push(revision); events.push('ready'); }, onDraft: (draft) => events.push(draft), onFailure: (error) => events.push(error.code), onCompleted: () => events.push('completed'),
  });
  connection.connect();
  socket.readyState = 1;
  socket.onopen();
  return { connection, socket, events, revisions, message: (value) => socket.onmessage({ data: JSON.stringify({ ...value, traceId: 'trace-id' }) }) };
};
const pcm = () => ({ data: new ArrayBuffer(4800), sampleRate: 24000, channels: 1 });

test('ready exposes the loaded backend revision and remains compatible with older ready messages', () => {
  for (const backendRevision of ['current-backend', undefined]) {
    const { connection, message, revisions } = setup();
    message({ type: 'ready', resampling: false, targetSampleRate: 24000, backendRevision });
    assert.deepEqual(revisions, [backendRevision ?? null]);
    connection.close('test_finished');
  }
});

test('Stop before ready drains queued PCM before complete and waits for final acknowledgement', async () => {
  const { connection, socket, message, events } = setup();
  connection.sendAudio(pcm());
  connection.sendAudio(pcm());
  connection.complete();
  message({ type: 'ready', resampling: false, targetSampleRate: 24000 });
  await tick();
  assert.equal(socket.sent.filter((value) => value instanceof ArrayBuffer).length, 2);
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), { type: 'complete' });
  assert.equal(socket.readyState, 1);
  message({ type: 'final', itemId: 'one', transcript: 'last spoken number' });
  message({ type: 'completed' });
  assert.deepEqual(events, ['ready', 'last spoken number', 'completed']);
  assert.equal(socket.readyState, 3);
});

test('completion honors backpressure and socket errors after Stop remain failures', async () => {
  const { connection, socket, message, events } = setup();
  socket.bufferedAmount = 600000;
  message({ type: 'ready', resampling: false, targetSampleRate: 24000 });
  connection.sendAudio(pcm());
  connection.complete();
  await tick();
  assert.equal(socket.sent.length, 1, 'only start is sent while backpressured');
  socket.bufferedAmount = 0;
  await tick();
  socket.onerror({ message: 'connection failed during drain' });
  assert.equal(events.at(-1), 'LIVE_CONNECTION_FAILED');
  assert.equal(socket.readyState, 3);
});

test('transcript items follow committed audio order even when finals arrive in reverse order', () => {
  const { connection, message, events } = setup();
  message({ type: 'committed', itemId: 'one', previousItemId: null });
  message({ type: 'committed', itemId: 'two', previousItemId: 'one' });
  message({ type: 'final', itemId: 'two', transcript: 'two' });
  message({ type: 'final', itemId: 'one', transcript: 'one' });
  assert.equal(events.at(-1), 'one two');
  connection.close('test_finished');
});

test('server completion before Stop is rejected and late events after close are ignored', () => {
  const { message, events } = setup();
  message({ type: 'completed' });
  message({ type: 'partial', itemId: 'late', delta: 'late draft' });
  assert.deepEqual(events, ['LIVE_INVALID_RESPONSE']);
});
