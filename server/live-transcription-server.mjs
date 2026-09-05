import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

import WebSocket, { WebSocketServer } from 'ws';

import {
  cleanupLiveTranscriptionResources,
  createOpenAITranscriptionSessionUpdate,
  isValidLiveTraceId,
  LIVE_TRANSCRIPTION_TARGET_SAMPLE_RATE,
  LiveTranscriptionServerError,
  mapOpenAIRealtimeEvent,
  normalizeLiveTranscriptionError,
  parseLiveClientControlMessage,
  Pcm16MonoResampler,
  sanitizeDiagnosticMessage,
} from './live-transcription-protocol.mjs';
import { logBackendTranscriptionEvent } from './transcription-observability.mjs';
import { getLiveRuntimeStatus } from './live-transcription-runtime.mjs';

const LIVE_PATH = '/live-transcribe';
export const OPENAI_REALTIME_URL =
  'wss://api.openai.com/v1/realtime?intent=transcription';
const MAX_CONNECTIONS = 4;
const MAX_CLIENT_MESSAGE_BYTES = 256 * 1024;
const MAX_QUEUED_AUDIO_BYTES = 512 * 1024;
const MAX_UPSTREAM_BUFFERED_BYTES = 512 * 1024;
const CLIENT_START_TIMEOUT_MS = 5_000;
const OPENAI_READY_TIMEOUT_MS = 10_000;
const CLIENT_IDLE_TIMEOUT_MS = 20_000;
const MAX_SESSION_DURATION_MS = 15 * 60_000;
const QUEUE_RETRY_MS = 20;

const safeErrorDetails = (error) => ({
  code: error.code,
  errorMessage: error.diagnosticMessage ?? error.message,
  errorName: error.diagnosticName ?? error.name,
  stage: error.stage,
  upstreamCode: error.upstreamCode,
  upstreamType: error.upstreamType,
  upstreamParam: error.upstreamParam,
  upstreamRequestId: error.upstreamRequestId,
  upstreamEventId: error.upstreamEventId,
  upstreamStatus: error.upstreamStatus,
});

const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const writeUpgradeError = (socket, statusCode, statusText) => {
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  socket.destroy();
};

export const attachLiveTranscriptionWebSocketServer = ({
  apiKey,
  httpServer,
  createUpstreamSocket = (url, options) => new WebSocket(url, options),
  logEvent = logBackendTranscriptionEvent,
}) => {
  const webSocketServer = new WebSocketServer({
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
    noServer: true,
    perMessageDeflate: false,
  });

  httpServer.on('upgrade', (request, socket, head) => {
    let pathname = null;

    try {
      pathname = new URL(request.url ?? '/', 'http://atlas.local').pathname;
    } catch {
      writeUpgradeError(socket, 400, 'Bad Request');
      return;
    }

    if (pathname !== LIVE_PATH) {
      writeUpgradeError(socket, 404, 'Not Found');
      return;
    }

    if (webSocketServer.clients.size >= MAX_CONNECTIONS) {
      writeUpgradeError(socket, 503, 'Service Unavailable');
      return;
    }

    webSocketServer.handleUpgrade(request, socket, head, (clientSocket) => {
      webSocketServer.emit('connection', clientSocket, request);
    });
  });

  webSocketServer.on('connection', (clientSocket) => {
    const startedAt = Date.now();
    const timers = new Set();
    const audioQueue = [];
    let audioQueueBytes = 0;
    let audioBytesForwarded = 0;
    let cleanedUp = false;
    let completeRequested = false;
    let firstAudioBufferLogged = false;
    let firstTranscriptLogged = false;
    let flushTimer = null;
    let idleTimer = null;
    let openAIReady = false;
    let resampler = null;
    let sessionMetadata = null;
    let traceId = `atlas-live-server-${randomUUID()}`;
    let upstreamSocket = null;
    let handshakeStatus = null;
    let upstreamRequestId = null;
    let uncommittedBytes = 0;
    let commitsAwaitingAcknowledgement = 0;
    const pendingItems = new Set();
    let finishDrained = false;

    const addTimeout = (callback, delay) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, delay);
      timers.add(timer);
      return timer;
    };

    const clearTrackedTimer = (timer) => {
      if (!timer) {
        return;
      }
      clearTimeout(timer);
      timers.delete(timer);
    };

    const sendClient = (message) => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.send(JSON.stringify(message));
      }
    };

    const log = (level, event, details = {}) => {
      if (!traceId) {
        return;
      }
      const safeDetails = Object.fromEntries(Object.entries(details).map(([key, value]) => [
        key,
        typeof value === 'string'
          ? sanitizeDiagnosticMessage(apiKey ? value.split(apiKey).join('[REDACTED_API_KEY]') : value)
          : value,
      ]));
      logEvent(level, event, traceId, { ...safeDetails, pipeline: 'live' });
    };

    const cleanup = ({ closeClient = true, reason }) => {
      if (cleanedUp) {
        return;
      }

      cleanedUp = true;
      audioQueue.length = 0;
      audioQueueBytes = 0;
      cleanupLiveTranscriptionResources({
        clientSocket,
        closeClient,
        timers,
        upstreamSocket,
      });
      log('info', 'LIVE_CLIENT_DISCONNECTED', {
        audioBytesForwarded,
        reason,
        requestDurationMs: Date.now() - startedAt,
      });
    };

    const fail = (sourceError) => {
      if (cleanedUp) {
        return;
      }

      const error = normalizeLiveTranscriptionError(sourceError);
      log('error', 'LIVE_STREAM_FAILURE', {
        ...safeErrorDetails(error),
        handshakeStatus,
        upstreamRequestId: error.upstreamRequestId ?? upstreamRequestId,
        actualSampleRate: sessionMetadata?.actualSampleRate ?? null,
        audioBytesForwarded,
        queuedAudioBytes: audioQueueBytes,
        requestDurationMs: Date.now() - startedAt,
      });
      sendClient({
        code: error.code,
        message: 'Live transcript unavailable.',
        stage: error.stage,
        traceId,
        type: 'error',
      });
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close(error.closeCode, error.code.slice(0, 100));
      }
      cleanup({ closeClient: false, reason: error.code });
    };

    const resetIdleTimeout = () => {
      clearTrackedTimer(idleTimer);
      idleTimer = addTimeout(() => {
        fail(
          new LiveTranscriptionServerError({
            code: 'LIVE_CLIENT_IDLE_TIMEOUT',
            message: 'The live transcription client stopped sending audio.',
            stage: 'audio_streaming',
          }),
        );
      }, CLIENT_IDLE_TIMEOUT_MS);
    };

    const finishStream = () => {
      if (cleanedUp || !finishDrained || commitsAwaitingAcknowledgement || pendingItems.size) {
        return;
      }

      sendClient({ traceId, type: 'completed' });
      log('info', 'LIVE_STREAM_COMPLETED', {
        audioBytesForwarded,
        draftPersisted: false,
        requestDurationMs: Date.now() - startedAt,
      });
      cleanup({ reason: 'stream_completed' });
    };

    const commitTurn = () => {
      if (!uncommittedBytes) return;
      // Realtime requires at least 100 ms per commit. Pad only a short network
      // tail; the authoritative local M4A is never altered.
      const minimumBytes = LIVE_TRANSCRIPTION_TARGET_SAMPLE_RATE * 2 / 10;
      if (uncommittedBytes < minimumBytes) {
        upstreamSocket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.alloc(minimumBytes - uncommittedBytes).toString('base64') }));
      }
      commitsAwaitingAcknowledgement += 1;
      upstreamSocket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      uncommittedBytes = 0;
    };

    const scheduleFlush = (delay = 0) => {
      if (flushTimer || cleanedUp || !openAIReady) {
        return;
      }

      flushTimer = addTimeout(() => {
        flushTimer = null;
        flushAudioQueue();
      }, delay);
    };

    function flushAudioQueue() {
      if (
        cleanedUp ||
        !openAIReady ||
        !upstreamSocket ||
        upstreamSocket.readyState !== WebSocket.OPEN
      ) {
        return;
      }

      if (upstreamSocket.bufferedAmount > MAX_UPSTREAM_BUFFERED_BYTES) {
        scheduleFlush(QUEUE_RETRY_MS);
        return;
      }

      const sourceBuffer = audioQueue.shift();

      if (!sourceBuffer) {
        if (completeRequested) {
          if (audioBytesForwarded === 0) {
            fail(new LiveTranscriptionServerError({
              code: 'LIVE_NO_AUDIO_RECEIVED',
              message: 'No microphone audio reached live transcription. Use Transcribe after saving.',
              stage: 'audio_streaming',
            }));
            return;
          }
          commitTurn();
          finishDrained = true;
          finishStream();
        }
        return;
      }

      audioQueueBytes -= sourceBuffer.byteLength;

      let output;
      try {
        output = resampler.process(sourceBuffer);
      } catch (error) {
        fail(error);
        return;
      }

      if (output.byteLength > 0) {
        upstreamSocket.send(
          JSON.stringify({
            audio: output.toString('base64'),
            type: 'input_audio_buffer.append',
          }),
        );
        audioBytesForwarded += output.byteLength;
        uncommittedBytes += output.byteLength;
        if (uncommittedBytes >= LIVE_TRANSCRIPTION_TARGET_SAMPLE_RATE * 2 * 5) commitTurn();

        if (audioBytesForwarded === output.byteLength) {
          log('info', 'LIVE_AUDIO_STREAMING_STARTED', {
            actualSampleRate: sessionMetadata.actualSampleRate,
            channels: sessionMetadata.channels,
            encoding: sessionMetadata.encoding,
            resampling:
              sessionMetadata.actualSampleRate !==
              LIVE_TRANSCRIPTION_TARGET_SAMPLE_RATE,
            targetSampleRate: LIVE_TRANSCRIPTION_TARGET_SAMPLE_RATE,
          });
        }
      }

      if (audioQueue.length > 0 || completeRequested) {
        scheduleFlush(0);
      }
    }

    const enqueueAudio = (data) => {
      if (completeRequested) {
        return;
      }

      const sourceBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

      if (sourceBuffer.byteLength === 0 || sourceBuffer.byteLength % 2 !== 0) {
        throw new LiveTranscriptionServerError({
          closeCode: 1008,
          code: 'LIVE_INVALID_PCM_BUFFER',
          message: 'The PCM audio buffer was empty or incomplete.',
          stage: 'audio_buffer_validation',
        });
      }

      if (audioQueueBytes + sourceBuffer.byteLength > MAX_QUEUED_AUDIO_BYTES) {
        throw new LiveTranscriptionServerError({
          code: 'LIVE_BACKPRESSURE',
          message: 'The live transcription audio queue reached its limit.',
          stage: 'audio_streaming',
        });
      }

      audioQueue.push(sourceBuffer);
      audioQueueBytes += sourceBuffer.byteLength;
      resetIdleTimeout();

      if (!firstAudioBufferLogged) {
        firstAudioBufferLogged = true;
        log('info', 'LIVE_FIRST_AUDIO_BUFFER_RECEIVED', {
          bufferByteSize: sourceBuffer.byteLength,
          queuedAudioBytes: audioQueueBytes,
        });
      }

      if (openAIReady) {
        flushAudioQueue();
      }
    };

    const connectOpenAI = () => {
      const openAIReadyTimer = addTimeout(() => {
        fail(
          new LiveTranscriptionServerError({
            code: 'LIVE_OPENAI_READY_TIMEOUT',
            message: 'The upstream live transcription session was not ready in time.',
            stage: 'openai_connection',
          }),
        );
      }, OPENAI_READY_TIMEOUT_MS);

      upstreamSocket = createUpstreamSocket(OPENAI_REALTIME_URL, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        maxPayload: MAX_CLIENT_MESSAGE_BYTES,
        perMessageDeflate: false,
      });

      upstreamSocket.on('open', () => {
        if (cleanedUp) return;
        handshakeStatus = 101;
        log('info', 'LIVE_OPENAI_CONNECTED', {
          model: 'gpt-live-transcribe',
          intent: 'transcription',
          handshakeStatus,
        });
        upstreamSocket.send(
          JSON.stringify(createOpenAITranscriptionSessionUpdate()),
        );
      });

      upstreamSocket.on('unexpected-response', (_request, response) => {
        handshakeStatus = response.statusCode;
        upstreamRequestId = response.headers?.['x-request-id'] ?? null;
        let body = '';
        const rejected = () => {
          const error = parseJson(body)?.error;
          fail(Object.assign(new Error(typeof error?.message === 'string' ? error.message : 'OpenAI rejected the WebSocket upgrade.'), {
            code: error?.code, type: error?.type, param: error?.param,
            statusCode: response.statusCode, requestId: upstreamRequestId,
          }));
        };
        response.on('data', (chunk) => {
          if (body.length + chunk.length > 16_384) {
            rejected();
            response.destroy();
          } else body += chunk.toString();
        });
        response.on('end', rejected);
        response.on('error', rejected);
      });
      upstreamSocket.on('upgrade', (response) => {
        handshakeStatus = response.statusCode;
        upstreamRequestId = response.headers?.['x-request-id'] ?? null;
      });

      upstreamSocket.on('message', (data, isBinary) => {
        if (isBinary || cleanedUp) {
          return;
        }

        const event = parseJson(data.toString());

        if (!event || typeof event.type !== 'string') {
          fail(
            new LiveTranscriptionServerError({
              code: 'LIVE_INVALID_OPENAI_EVENT',
              message: 'The upstream live transcription event was invalid.',
              stage: 'openai_event_handling',
            }),
          );
          return;
        }

        if (
          event.type === 'session.updated' ||
          event.type === 'transcription_session.updated'
        ) {
          clearTrackedTimer(openAIReadyTimer);
          openAIReady = true;
          sendClient({
            backendRevision: getLiveRuntimeStatus().loadedRevision,
            resampling:
              sessionMetadata.actualSampleRate !==
              LIVE_TRANSCRIPTION_TARGET_SAMPLE_RATE,
            targetSampleRate: LIVE_TRANSCRIPTION_TARGET_SAMPLE_RATE,
            traceId,
            type: 'ready',
          });
          scheduleFlush(0);
          return;
        }

        if (event.type === 'error' || event.type === 'conversation.item.input_audio_transcription.failed') {
          const upstreamError = Object.assign(
            new Error(
              typeof event.error?.message === 'string'
                ? event.error.message
                : 'The upstream live transcription session failed.',
            ),
            {
              stage: openAIReady ? 'openai_event_handling' : 'openai_session_configuration',
              param: event.error?.param,
              eventId: event.error?.event_id ?? event.event_id,
              requestId: upstreamRequestId,
              code:
                typeof event.error?.code === 'string'
                  ? event.error.code
                  : undefined,
              status:
                typeof event.error?.status === 'number'
                  ? event.error.status
                  : undefined,
              type:
                typeof event.error?.type === 'string'
                  ? event.error.type
                  : undefined,
            },
          );
          fail(upstreamError);
          return;
        }

        if (event.type === 'input_audio_buffer.committed') {
          commitsAwaitingAcknowledgement = Math.max(0, commitsAwaitingAcknowledgement - 1);
          pendingItems.add(event.item_id);
          sendClient({ type: 'committed', itemId: event.item_id, previousItemId: event.previous_item_id ?? null, traceId });
          return;
        }

        const clientEvent = mapOpenAIRealtimeEvent(event, traceId);

        if (!clientEvent) {
          return;
        }

        if (!firstTranscriptLogged) {
          firstTranscriptLogged = true;
          log('info', 'LIVE_FIRST_TRANSCRIPT_EVENT_RECEIVED', {
            eventType: clientEvent.type,
            itemId: clientEvent.itemId,
            textCharacterCount:
              clientEvent.type === 'partial'
                ? clientEvent.delta.length
                : clientEvent.transcript.length,
          });
        }

        sendClient(clientEvent);

        if (clientEvent.type === 'final') {
          pendingItems.delete(clientEvent.itemId);
          finishStream();
        }
      });

      upstreamSocket.on('error', (error) => fail(error));
      upstreamSocket.on('close', (code) => {
        if (!cleanedUp) {
          fail(
            new LiveTranscriptionServerError({
              code: 'LIVE_OPENAI_CONNECTION_CLOSED',
              message: `The upstream live transcription connection closed (${code}).`,
              stage: 'openai_connection',
            }),
          );
        }
      });
    };

    const startTimeout = addTimeout(() => {
      fail(
        new LiveTranscriptionServerError({
          closeCode: 1008,
          code: 'LIVE_START_TIMEOUT',
          message: 'The live transcription start message was not received in time.',
          stage: 'client_message_validation',
        }),
      );
    }, CLIENT_START_TIMEOUT_MS);

    addTimeout(() => {
      fail(
        new LiveTranscriptionServerError({
          code: 'LIVE_SESSION_LIMIT_REACHED',
          message: 'The live transcription session reached its duration limit.',
          stage: 'audio_streaming',
        }),
      );
    }, MAX_SESSION_DURATION_MS);

    clientSocket.on('message', (data, isBinary) => {
      if (cleanedUp) {
        return;
      }

      try {
        if (isBinary) {
          if (!sessionMetadata) {
            throw new LiveTranscriptionServerError({
              closeCode: 1008,
              code: 'LIVE_START_REQUIRED',
              message: 'Audio was received before the live session start message.',
              stage: 'client_message_validation',
            });
          }

          enqueueAudio(data);
          return;
        }

        const rawControlMessage = data.toString();
        const unvalidatedControl = parseJson(rawControlMessage);

        if (
          !sessionMetadata &&
          isValidLiveTraceId(unvalidatedControl?.traceId)
        ) {
          traceId = unvalidatedControl.traceId;
        }

        const control = parseLiveClientControlMessage(rawControlMessage);

        if (control.type === 'start') {
          if (sessionMetadata) {
            throw new LiveTranscriptionServerError({
              closeCode: 1008,
              code: 'LIVE_DUPLICATE_START',
              message: 'The live transcription session was already started.',
              stage: 'client_message_validation',
            });
          }

          clearTrackedTimer(startTimeout);
          traceId = control.traceId;
          sessionMetadata = control;
          resampler = new Pcm16MonoResampler(control.actualSampleRate);
          log('info', 'LIVE_CLIENT_CONNECTED', {
            backendRevision: getLiveRuntimeStatus().loadedRevision,
            actualSampleRate: control.actualSampleRate,
            channels: control.channels,
            encoding: control.encoding,
            requestedSampleRate: control.requestedSampleRate,
          });
          resetIdleTimeout();
          connectOpenAI();
          return;
        }

        if (!sessionMetadata) {
          throw new LiveTranscriptionServerError({
            closeCode: 1008,
            code: 'LIVE_START_REQUIRED',
            message: 'The live session must start before it can complete.',
            stage: 'client_message_validation',
          });
        }

        if (completeRequested) return;
        completeRequested = true;
        clearTrackedTimer(idleTimer);
        addTimeout(() => fail(new LiveTranscriptionServerError({ code: 'LIVE_FINAL_TRANSCRIPT_TIMEOUT', message: 'The final live transcript did not arrive in time.', stage: 'openai_event_handling' })), 12_000);
        flushAudioQueue();
      } catch (error) {
        fail(error);
      }
    });

    clientSocket.on('error', (error) => fail(error));
    clientSocket.on('close', (code) => {
      if (!cleanedUp) {
        cleanup({ closeClient: false, reason: `client_close_${code}` });
      }
    });
  });

  return webSocketServer;
};
