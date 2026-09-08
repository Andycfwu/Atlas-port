import { DiarizationService, openAIDiarizationProvider } from './diarization/service.mjs';
import { createDiarizationRouter } from './diarization/router.mjs';
import { uploadSizeMatches, originalTranscriptionText } from './transcription-integrity.mjs';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import express from 'express';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';

import { attachLiveTranscriptionWebSocketServer } from './live-transcription-server.mjs';
import { getLiveRuntimeStatus } from './live-transcription-runtime.mjs';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { createMemoryProvider } from './memory/provider.mjs';
import { createMemoryRouter } from './memory/router.mjs';
import { fileURLToPath } from 'node:url';

import {
  logBackendTranscriptionEvent,
  normalizeOpenAIError,
  normalizeUploadError,
  resolveAtlasTraceId,
  serverErrorLogDetails,
  toSafeErrorResponse,
  TranscriptionServerError,
} from './transcription-observability.mjs';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const apiKey = process.env.OPENAI_API_KEY?.trim();
const MAX_TRANSCRIPTION_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const OPENAI_REQUEST_TIMEOUT_MS = 120_000;
const ACCEPTED_MIME_TYPES = new Set([
  'application/octet-stream',
  'audio/m4a',
  'audio/mp4',
  'audio/x-m4a',
]);

if (!apiKey) {
  throw new Error('OPENAI_API_KEY must be set in server/.env.');
}

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('PORT must be a positive integer.');
}

const openai = new OpenAI({
  apiKey,
  maxRetries: 0,
  timeout: OPENAI_REQUEST_TIMEOUT_MS,
});
const app = express();
const httpServer = createServer(app);
attachLiveTranscriptionWebSocketServer({ apiKey, httpServer });

const getTraceContext = (request) => {
  if (!request.atlasTranscriptionTrace) {
    const traceId = resolveAtlasTraceId(
      request.get?.('X-Atlas-Trace-Id'),
    );
    request.atlasTranscriptionTrace = {
      fileMetadata: null,
      startedAt: Date.now(),
      traceId,
    };
  }

  return request.atlasTranscriptionTrace;
};

const safeContentLength = (request) => {
  const value = Number.parseInt(request.get('content-length') ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const safeContentType = (request) => {
  const contentType = request.get('content-type');
  return typeof contentType === 'string'
    ? (contentType.split(';')[0]?.trim() ?? null)
    : null;
};

const cleanupUpload = async (uploadedFile, traceId) => {
  if (!uploadedFile?.path) {
    return;
  }

  await unlink(uploadedFile.path).catch((error) => {
    logBackendTranscriptionEvent('warn', 'TEMPORARY_UPLOAD_CLEANUP_FAILED', traceId, {
      errorCode:
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : null,
      errorMessage: 'The temporary upload could not be removed.',
      errorName: error instanceof Error ? error.name : null,
    });
  });
};

app.get('/health', (_request, response) => {
  response.json({ ok: true, live: getLiveRuntimeStatus() });
});

const meetingStore = new MeetingStore(process.env.MEMORY_DB_PATH || fileURLToPath(new URL('./data/meeting-memory.sqlite', import.meta.url)));
const meetingMemory = new MeetingMemoryService(meetingStore, createMemoryProvider(openai));
const diarization = new DiarizationService(meetingStore.db, openAIDiarizationProvider(openai));
app.use('/v1/diarizations', createDiarizationRouter(diarization));
app.use('/v1/memory', createMemoryRouter(meetingMemory, diarization));

app.use('/transcribe', (request, response, next) => {
  const trace = getTraceContext(request);
  response.set('X-Atlas-Trace-Id', trace.traceId);
  logBackendTranscriptionEvent(
    'info',
    'BACKEND_REQUEST_RECEIVED',
    trace.traceId,
    {
      contentLengthBytes: safeContentLength(request),
      contentType: safeContentType(request),
      stage: 'backend_request_received',
    },
  );
  next();
});

const upload = multer({
  dest: tmpdir(),
  limits: {
    fileSize: MAX_TRANSCRIPTION_FILE_SIZE_BYTES,
    files: 1,
  },
  fileFilter: (request, file, callback) => {
    const trace = getTraceContext(request);
    const extension = path.extname(file.originalname).toLowerCase();
    const mimeType = file.mimetype?.toLowerCase() || 'application/octet-stream';
    trace.fileMetadata = { byteSize: null, extension, mimeType };

    if (extension !== '.m4a' || !ACCEPTED_MIME_TYPES.has(mimeType)) {
      callback(
        new TranscriptionServerError({
          code: 'INVALID_AUDIO_FILE',
          httpStatus: 415,
          message: 'Only M4A audio recordings are accepted.',
          stage: 'upload_rejected',
        }),
      );
      return;
    }

    callback(null, true);
  },
});

app.post('/transcribe', upload.single('file'), async (request, response) => {
  const trace = getTraceContext(request);
  const uploadedFile = request.file;

  if (!uploadedFile) {
    throw new TranscriptionServerError({
      code: 'UPLOAD_REJECTED',
      httpStatus: 400,
      message: 'An M4A recording is required.',
      stage: 'upload_rejected',
    });
  }

  trace.fileMetadata = {
    byteSize: uploadedFile.size,
    extension: path.extname(uploadedFile.originalname).toLowerCase(),
    mimeType: uploadedFile.mimetype?.toLowerCase() || 'application/octet-stream',
  };

  if (!uploadSizeMatches(request.headers['x-atlas-audio-bytes'], uploadedFile.size)) {
    throw new TranscriptionServerError({ code: 'UPLOAD_REJECTED', httpStatus: 400,
      message: 'The uploaded byte count does not match the saved audio. Retry transcription; the original audio remains on your phone.', stage: 'upload_rejected' });
  }
  if (uploadedFile.size <= 0) {
    throw new TranscriptionServerError({
      code: 'INVALID_AUDIO_FILE',
      httpStatus: 400,
      message: 'The uploaded recording is empty.',
      stage: 'upload_rejected',
    });
  }

  logBackendTranscriptionEvent('info', 'UPLOAD_ACCEPTED', trace.traceId, {
    fileMetadata: trace.fileMetadata,
    expectedByteSize: request.headers['x-atlas-audio-bytes'] ?? null,
    stage: 'upload_accepted',
  });

  try {
    const file = await toFile(
      createReadStream(uploadedFile.path),
      uploadedFile.originalname,
      { type: trace.fileMetadata.mimeType },
    );
    logBackendTranscriptionEvent(
      'info',
      'OPENAI_REQUEST_STARTED',
      trace.traceId,
      {
        fileMetadata: trace.fileMetadata,
        model: 'gpt-transcribe',
        stage: 'openai_request_started',
        timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
      },
    );

    const {
      data: transcription,
      request_id: openAIRequestId,
      response: openAIResponse,
    } = await openai.audio.transcriptions
      .create({ file, model: 'gpt-transcribe' })
      .withResponse();
    logBackendTranscriptionEvent(
      'info',
      'OPENAI_RESPONSE_RECEIVED',
      trace.traceId,
      {
        openAIRequestId,
        openAIStatus: openAIResponse.status,
        requestDurationMs: Date.now() - trace.startedAt,
        stage: 'openai_response_received',
      },
    );

    const text = originalTranscriptionText(transcription);

    if (!text.trim()) {
      throw new TranscriptionServerError({
        code: 'EMPTY_TRANSCRIPT',
        httpStatus: 502,
        message: 'The upstream service returned an empty transcript.',
        openAIRequestId,
        openAIStatus: openAIResponse.status,
        stage: 'transcript_validated',
      });
    }

    logBackendTranscriptionEvent('info', 'TRANSCRIPT_VALIDATED', trace.traceId, {
      characterCount: text.length,
      responseSegmentCount: Array.isArray(transcription?.segments) ? transcription.segments.length : null,
      openAIRequestId,
      stage: 'transcript_validated',
    });
    response.type('text/plain').send(text);
    logBackendTranscriptionEvent('info', 'REQUEST_COMPLETED', trace.traceId, {
      httpStatus: 200,
      requestDurationMs: Date.now() - trace.startedAt,
      stage: 'request_completed',
    });
  } catch (error) {
    throw normalizeOpenAIError(error);
  } finally {
    await cleanupUpload(uploadedFile, trace.traceId);
  }
});

app.use(async (error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  const trace = getTraceContext(request);
  const normalizedError = normalizeUploadError(error);

  if (normalizedError.stage === 'upload_rejected') {
    logBackendTranscriptionEvent('warn', 'UPLOAD_REJECTED', trace.traceId, {
      ...serverErrorLogDetails(normalizedError),
      fileMetadata: trace.fileMetadata,
      requestDurationMs: Date.now() - trace.startedAt,
    });
  }

  logBackendTranscriptionEvent('error', 'REQUEST_FAILED', trace.traceId, {
    ...serverErrorLogDetails(normalizedError),
    fileMetadata: trace.fileMetadata,
    requestDurationMs: Date.now() - trace.startedAt,
  });
  await cleanupUpload(request.file, trace.traceId);
  response
    .status(normalizedError.httpStatus)
    .json(toSafeErrorResponse(normalizedError, trace.traceId));
});

httpServer.listen(port, '0.0.0.0', (error) => {
  if (error) {
    console.error('[TranscriptionServer] Could not start.', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
    return;
  }

  console.info(`Atlas transcription server listening on http://0.0.0.0:${port}`);
});
