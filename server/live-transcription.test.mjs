import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cleanupLiveTranscriptionResources,
  createOpenAITranscriptionSessionUpdate,
  isValidLiveTraceId,
  LiveTranscriptionServerError,
  mapOpenAIRealtimeEvent,
  normalizeLiveTranscriptionError,
  parseLiveClientControlMessage,
  Pcm16MonoResampler,
} from './live-transcription-protocol.mjs';

const validStart = {
  actualSampleRate: 48_000,
  channels: 1,
  encoding: 'int16',
  requestedSampleRate: 24_000,
  traceId: 'atlas-tx-mobile-live-12345678',
  type: 'start',
};

const createRampBuffer = (sampleCount) => {
  const buffer = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE((index % 20_000) - 10_000, index * 2);
  }
  return buffer;
};

test('validates the live client start message and preserves actual sample rate', () => {
  const message = parseLiveClientControlMessage(JSON.stringify(validStart));
  assert.deepEqual(message, validStart);
  assert.equal(isValidLiveTraceId(validStart.traceId), true);
  assert.equal(isValidLiveTraceId('short'), false);
});

test('rejects unsupported live audio formats and sample rates', () => {
  assert.throws(
    () =>
      parseLiveClientControlMessage(
        JSON.stringify({ ...validStart, channels: 2 }),
      ),
    (error) =>
      error instanceof LiveTranscriptionServerError &&
      error.code === 'LIVE_INVALID_AUDIO_FORMAT',
  );
  assert.throws(
    () =>
      parseLiveClientControlMessage(
        JSON.stringify({ ...validStart, actualSampleRate: 192_000 }),
      ),
    (error) =>
      error instanceof LiveTranscriptionServerError &&
      error.code === 'LIVE_INVALID_ACTUAL_SAMPLE_RATE',
  );
});

test('creates the current OpenAI 24 kHz transcription session update', () => {
  const update = createOpenAITranscriptionSessionUpdate();
  assert.equal(update.type, 'session.update');
  assert.equal(update.session.type, 'transcription');
  assert.equal(update.session.audio.input.format.type, 'audio/pcm');
  assert.equal(update.session.audio.input.format.rate, 24_000);
  assert.equal(
    update.session.audio.input.transcription.model,
    'gpt-live-transcribe',
  );
  assert.equal(update.session.audio.input.turn_detection.type, 'server_vad');
});

test('resamples 48 kHz mono PCM16 to 24 kHz consistently across chunks', () => {
  const source = createRampBuffer(480);
  const oneShot = new Pcm16MonoResampler(48_000).process(source);
  const chunkedResampler = new Pcm16MonoResampler(48_000);
  const chunked = Buffer.concat([
    chunkedResampler.process(source.subarray(0, 202)),
    chunkedResampler.process(source.subarray(202)),
  ]);

  assert.equal(oneShot.byteLength, 240 * 2);
  assert.deepEqual(chunked, oneShot);
});

test('maps OpenAI transcript delta and completion events without mutation', () => {
  const traceId = validStart.traceId;
  assert.deepEqual(
    mapOpenAIRealtimeEvent(
      {
        type: 'conversation.item.input_audio_transcription.delta',
        item_id: 'item_1',
        delta: 'Hello',
      },
      traceId,
    ),
    {
      delta: 'Hello',
      itemId: 'item_1',
      traceId,
      type: 'partial',
    },
  );
  assert.deepEqual(
    mapOpenAIRealtimeEvent(
      {
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'item_1',
        transcript: 'Hello world',
      },
      traceId,
    ),
    {
      itemId: 'item_1',
      traceId,
      transcript: 'Hello world',
      type: 'final',
    },
  );
});

test('maps live upstream authentication, rate limit, and timeout failures', () => {
  assert.equal(
    normalizeLiveTranscriptionError({ statusCode: 401 }).code,
    'LIVE_OPENAI_AUTHENTICATION_FAILED',
  );
  assert.equal(
    normalizeLiveTranscriptionError({ statusCode: 429 }).code,
    'LIVE_OPENAI_RATE_LIMITED',
  );
  assert.equal(
    normalizeLiveTranscriptionError({
      code: 'invalid_api_key',
      type: 'authentication_error',
    }).code,
    'LIVE_OPENAI_AUTHENTICATION_FAILED',
  );
  assert.equal(
    normalizeLiveTranscriptionError({
      code: 'rate_limit_exceeded',
      type: 'rate_limit_error',
    }).code,
    'LIVE_OPENAI_RATE_LIMITED',
  );
  assert.equal(
    normalizeLiveTranscriptionError(new Error('Connection timed out')).code,
    'LIVE_TIMEOUT',
  );
});

test('redacts secrets and local file paths from upstream diagnostics', () => {
  const error = normalizeLiveTranscriptionError(
    new Error(
      'Bearer sk-secretvalue123456 at file:///Users/example/recording.m4a',
    ),
  );

  assert.doesNotMatch(error.diagnosticMessage, /sk-secretvalue|Users\/example/);
  assert.match(error.diagnosticMessage, /REDACTED/);
});

test('cleanup closes both sockets, clears timers, and is memory-bounded', async () => {
  let timerFired = false;
  const timer = setTimeout(() => {
    timerFired = true;
  }, 15);
  const timers = new Set([timer]);
  const closed = [];
  const createSocket = (name) => ({
    readyState: 1,
    close: (code, reason) => closed.push({ code, name, reason }),
  });

  const result = cleanupLiveTranscriptionResources({
    clientSocket: createSocket('client'),
    timers,
    upstreamSocket: createSocket('upstream'),
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(timerFired, false);
  assert.equal(timers.size, 0);
  assert.deepEqual(result, { clientClosed: true, upstreamClosed: true });
  assert.deepEqual(
    closed.map((entry) => entry.name).sort(),
    ['client', 'upstream'],
  );
});
