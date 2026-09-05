const TARGET_SAMPLE_RATE = 24_000;
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 96_000;
const TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const isRecord = (value) =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const sanitizeDiagnosticMessage = (message) =>
  message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(
      /(?:file:\/\/|\/(?:private|Users|var|data|tmp)\/)[^\s"'<>]+/gi,
      '[REDACTED_LOCAL_PATH]',
    );

const readString = (value, key) =>
  typeof value?.[key] === 'string' ? value[key] : null;

export const isValidLiveTraceId = (value) =>
  typeof value === 'string' && TRACE_ID_PATTERN.test(value);

export class LiveTranscriptionServerError extends Error {
  constructor({ cause, code, closeCode = 1011, message, stage }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'LiveTranscriptionServerError';
    this.code = code;
    this.closeCode = closeCode;
    this.stage = stage;
    this.diagnosticMessage = sanitizeDiagnosticMessage(
      cause instanceof Error ? cause.message : message,
    );
    this.diagnosticName = cause instanceof Error ? cause.name : this.name;
  }
}

export const parseLiveClientControlMessage = (rawMessage) => {
  let parsed;

  try {
    parsed = JSON.parse(rawMessage);
  } catch (error) {
    throw new LiveTranscriptionServerError({
      cause: error,
      closeCode: 1008,
      code: 'LIVE_INVALID_MESSAGE',
      message: 'The live transcription control message was invalid.',
      stage: 'client_message_validation',
    });
  }

  if (!isRecord(parsed) || typeof parsed.type !== 'string') {
    throw new LiveTranscriptionServerError({
      closeCode: 1008,
      code: 'LIVE_INVALID_MESSAGE',
      message: 'The live transcription control message was invalid.',
      stage: 'client_message_validation',
    });
  }

  if (parsed.type === 'complete') {
    return { type: 'complete' };
  }

  if (parsed.type !== 'start') {
    throw new LiveTranscriptionServerError({
      closeCode: 1008,
      code: 'LIVE_INVALID_MESSAGE',
      message: 'The live transcription control message type was rejected.',
      stage: 'client_message_validation',
    });
  }

  const traceId = readString(parsed, 'traceId');
  const requestedSampleRate = parsed.requestedSampleRate;
  const actualSampleRate = parsed.actualSampleRate;
  const channels = parsed.channels;
  const encoding = parsed.encoding;

  if (!isValidLiveTraceId(traceId)) {
    throw new LiveTranscriptionServerError({
      closeCode: 1008,
      code: 'LIVE_INVALID_TRACE_ID',
      message: 'The live transcription trace ID was rejected.',
      stage: 'client_message_validation',
    });
  }

  if (requestedSampleRate !== TARGET_SAMPLE_RATE) {
    throw new LiveTranscriptionServerError({
      closeCode: 1008,
      code: 'LIVE_INVALID_REQUESTED_SAMPLE_RATE',
      message: 'Live transcription must request 24 kHz PCM.',
      stage: 'client_message_validation',
    });
  }

  if (
    !Number.isInteger(actualSampleRate) ||
    actualSampleRate < MIN_SAMPLE_RATE ||
    actualSampleRate > MAX_SAMPLE_RATE
  ) {
    throw new LiveTranscriptionServerError({
      closeCode: 1008,
      code: 'LIVE_INVALID_ACTUAL_SAMPLE_RATE',
      message: 'The native PCM sample rate was not supported.',
      stage: 'client_message_validation',
    });
  }

  if (channels !== 1 || encoding !== 'int16') {
    throw new LiveTranscriptionServerError({
      closeCode: 1008,
      code: 'LIVE_INVALID_AUDIO_FORMAT',
      message: 'Live transcription requires mono int16 PCM.',
      stage: 'client_message_validation',
    });
  }

  return {
    actualSampleRate,
    channels,
    encoding,
    requestedSampleRate,
    traceId,
    type: 'start',
  };
};

export const createOpenAITranscriptionSessionUpdate = () => ({
  type: 'session.update',
  session: {
    type: 'transcription',
    audio: {
      input: {
        format: {
          type: 'audio/pcm',
          rate: TARGET_SAMPLE_RATE,
        },
        transcription: {
          model: 'gpt-live-transcribe',
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      },
    },
  },
});

export class Pcm16MonoResampler {
  #nextSourcePosition = 0;
  #previousSample = null;
  #totalInputSamples = 0;

  constructor(sourceSampleRate, targetSampleRate = TARGET_SAMPLE_RATE) {
    if (
      !Number.isInteger(sourceSampleRate) ||
      sourceSampleRate <= 0 ||
      !Number.isInteger(targetSampleRate) ||
      targetSampleRate <= 0
    ) {
      throw new TypeError('Sample rates must be positive integers.');
    }

    this.sourceSampleRate = sourceSampleRate;
    this.targetSampleRate = targetSampleRate;
    this.sourceStep = sourceSampleRate / targetSampleRate;
  }

  process(input) {
    const source = Buffer.isBuffer(input) ? input : Buffer.from(input);

    if (source.byteLength % 2 !== 0) {
      throw new LiveTranscriptionServerError({
        closeCode: 1008,
        code: 'LIVE_INVALID_PCM_BUFFER',
        message: 'A PCM buffer contained an incomplete int16 sample.',
        stage: 'audio_buffer_validation',
      });
    }

    if (source.byteLength === 0) {
      return Buffer.alloc(0);
    }

    if (this.sourceSampleRate === this.targetSampleRate) {
      this.#previousSample = source.readInt16LE(source.byteLength - 2);
      this.#totalInputSamples += source.byteLength / 2;
      this.#nextSourcePosition = this.#totalInputSamples;
      return source;
    }

    const sampleCount = source.byteLength / 2;
    const chunkStart = this.#totalInputSamples;
    const chunkLastIndex = chunkStart + sampleCount - 1;
    const outputSamples = [];
    const readSampleAt = (globalIndex) => {
      if (globalIndex === chunkStart - 1 && this.#previousSample !== null) {
        return this.#previousSample;
      }

      const localIndex = globalIndex - chunkStart;
      if (localIndex < 0 || localIndex >= sampleCount) {
        return null;
      }

      return source.readInt16LE(localIndex * 2);
    };

    while (this.#nextSourcePosition <= chunkLastIndex) {
      const lowerIndex = Math.floor(this.#nextSourcePosition);
      const upperIndex = Math.ceil(this.#nextSourcePosition);
      const lower = readSampleAt(lowerIndex);
      const upper = readSampleAt(upperIndex);

      if (lower === null || upper === null) {
        break;
      }

      const fraction = this.#nextSourcePosition - lowerIndex;
      const interpolated = Math.round(lower + (upper - lower) * fraction);
      outputSamples.push(Math.max(-32_768, Math.min(32_767, interpolated)));
      this.#nextSourcePosition += this.sourceStep;
    }

    this.#previousSample = source.readInt16LE(source.byteLength - 2);
    this.#totalInputSamples += sampleCount;
    const output = Buffer.allocUnsafe(outputSamples.length * 2);
    outputSamples.forEach((sample, index) => output.writeInt16LE(sample, index * 2));
    return output;
  }
}

export const mapOpenAIRealtimeEvent = (event, traceId) => {
  if (!isRecord(event) || typeof event.type !== 'string') {
    return null;
  }

  if (event.type === 'conversation.item.input_audio_transcription.delta') {
    const itemId = readString(event, 'item_id');
    const delta = readString(event, 'delta');
    return itemId && delta !== null
      ? { delta, itemId, traceId, type: 'partial' }
      : null;
  }

  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    const itemId = readString(event, 'item_id');
    const transcript = readString(event, 'transcript');
    return itemId && transcript !== null
      ? { itemId, traceId, transcript, type: 'final' }
      : null;
  }

  return null;
};

export const normalizeLiveTranscriptionError = (error) => {
  if (error instanceof LiveTranscriptionServerError) {
    return error;
  }

  const status = Number.isFinite(error?.statusCode)
    ? error.statusCode
    : Number.isFinite(error?.status)
      ? error.status
      : null;
  const message = error instanceof Error ? error.message : String(error);
  const upstreamCode =
    typeof error?.code === 'string' ? error.code.toLowerCase() : '';
  const upstreamType =
    typeof error?.type === 'string' ? error.type.toLowerCase() : '';

  if (
    status === 401 ||
    status === 403 ||
    /authentication|invalid_api_key|unauthorized/.test(
      `${upstreamCode} ${upstreamType}`,
    )
  ) {
    return new LiveTranscriptionServerError({
      cause: error,
      code: 'LIVE_OPENAI_AUTHENTICATION_FAILED',
      message: 'The upstream live transcription service rejected authentication.',
      stage: 'openai_connection',
    });
  }

  if (
    status === 429 ||
    /rate_limit|rate_limited/.test(`${upstreamCode} ${upstreamType}`)
  ) {
    return new LiveTranscriptionServerError({
      cause: error,
      code: 'LIVE_OPENAI_RATE_LIMITED',
      message: 'The upstream live transcription service is rate limited.',
      stage: 'openai_connection',
    });
  }

  if (/timed?\s*out|timeout/i.test(message)) {
    return new LiveTranscriptionServerError({
      cause: error,
      code: 'LIVE_TIMEOUT',
      message: 'The live transcription connection timed out.',
      stage: 'openai_connection',
    });
  }

  return new LiveTranscriptionServerError({
    cause: error,
    code: 'LIVE_OPENAI_UPSTREAM_FAILED',
    message: 'The upstream live transcription connection failed.',
    stage: 'openai_connection',
  });
};

const closeSocket = (socket, code, reason) => {
  if (!socket || (socket.readyState !== 0 && socket.readyState !== 1)) {
    return false;
  }

  socket.close(code, reason);
  return true;
};

export const cleanupLiveTranscriptionResources = ({
  clientSocket,
  closeClient = true,
  timers,
  upstreamSocket,
}) => {
  for (const timer of timers) {
    clearTimeout(timer);
    clearInterval(timer);
  }
  timers.clear();

  const upstreamClosed = closeSocket(
    upstreamSocket,
    1000,
    'atlas_live_session_closed',
  );
  const clientClosed = closeClient
    ? closeSocket(clientSocket, 1000, 'atlas_live_session_closed')
    : false;

  return { clientClosed, upstreamClosed };
};

export const LIVE_TRANSCRIPTION_TARGET_SAMPLE_RATE = TARGET_SAMPLE_RATE;
