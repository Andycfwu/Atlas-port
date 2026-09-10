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
  const { LiveTranscriptionConnection } = load('src/features/recorder/live/live-transcription.service.ts', { '../live-speakers/live-speakers.model': load('src/features/recorder/live-speakers/live-speakers.model.ts') }, { WebSocket: Socket });
  const events = [];
  const revisions = [];
  const snapshots = [];
  const connection = new LiveTranscriptionConnection('ws://test', { actualSampleRate: 24000, channels: 1, encoding: 'int16', requestedSampleRate: 24000, traceId: 'trace-id' }, {
    onReady: (revision) => { revisions.push(revision); events.push('ready'); }, onDraft: (draft, segments) => { events.push(draft); snapshots.push(segments); }, onFailure: (error) => events.push(error.code), onCompleted: () => events.push('completed'),
  });
  connection.connect();
  socket.readyState = 1;
  socket.onopen();
  return { connection, socket, events, revisions, snapshots, message: (value) => socket.onmessage({ data: JSON.stringify({ ...value, traceId: 'trace-id' }) }) };
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

test('Stop before ready drains queued PCM before complete and waits for final acknowledgement', { timeout: 2500 }, async () => {
  const { connection, socket, message, events } = setup();
  connection.sendAudio(pcm());
  connection.sendAudio(pcm());
  connection.complete();
  message({ type: 'ready', resampling: false, targetSampleRate: 24000 });
  const deadline = Date.now() + 1500;
  while (socket.sent.at(-1) !== JSON.stringify({ type: 'complete' }) && Date.now() < deadline) await tick();
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


test('live snapshots preserve raw delta and final strings for every item without speaker guesses', () => {
  const { connection, message, events, snapshots } = setup();
  message({ type: 'committed', itemId: 'a', previousItemId: null });
  message({ type: 'committed', itemId: 'b', previousItemId: 'a' });
  message({ type: 'partial', itemId: 'a', delta: '  perhaps' });
  message({ type: 'partial', itemId: 'a', delta: ' forty' });
  message({ type: 'final', itemId: 'b', transcript: 'No, fifty.\n' });
  message({ type: 'final', itemId: 'a', transcript: '  Perhaps forty. ' });
  assert.equal(events.at(-1), '  Perhaps forty.  No, fifty.\n');
  assert.deepEqual(snapshots.at(-1), [{ itemId: 'a', deltaText: '  perhaps forty', finalText: '  Perhaps forty. ' }, { itemId: 'b', deltaText: '', finalText: 'No, fifty.\n' }]);
  connection.close('test_finished');
});

test('queued PCM is owned by the connection and cannot change if the caller reuses its buffer', { timeout: 2000 }, async () => {
  const { connection, socket, message } = setup();
  const data = new Int16Array([1, -1, 0, 17, -21]).buffer;
  connection.sendAudio({ data, sampleRate: 24000, channels: 1 });
  new Int16Array(data).fill(32000);
  message({ type: 'ready', resampling: false, targetSampleRate: 24000 });
  const deadline=Date.now()+1000;
  while(!socket.sent.some(v=>v instanceof ArrayBuffer)&&Date.now()<deadline)await tick();
  assert.deepEqual([...new Int16Array(socket.sent.find(v=>v instanceof ArrayBuffer))],[1,-1,0,17,-21]);
  connection.close('synthetic_done');
});
