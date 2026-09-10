import express from 'express';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { toFile } from 'openai';
import { createAudioUpload, cleanupAudioUpload, AudioUploadError } from './audio-upload.mjs';
import { uploadSizeMatches, originalTranscriptionText } from './transcription-integrity.mjs';
import {
  logBackendTranscriptionEvent, normalizeOpenAIError, normalizeUploadError,
  resolveAtlasTraceId, serverErrorLogDetails, toSafeErrorResponse, TranscriptionServerError,
} from './transcription-observability.mjs';
const OPENAI_REQUEST_TIMEOUT_MS = 120_000;

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

export function createTranscriptionRouter(openai, { uploadOptions = {} } = {}) {
  const router = express.Router();
  router.use((request, response, next) => {
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

  router.post('/', createAudioUpload('transcription', uploadOptions), async (request, response) => {
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

      uploadedFile.uploadSignal?.throwIfAborted();
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
      await cleanupAudioUpload(uploadedFile);
    }
  });

  router.use(async (error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const trace = getTraceContext(request);
    const normalizedError = error instanceof AudioUploadError
      ? new TranscriptionServerError({ code: error.code, httpStatus: error.status, message: error.message, stage: 'upload_rejected' })
      : normalizeUploadError(error);

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
    await cleanupAudioUpload(request.file);
    response
      .status(normalizedError.httpStatus)
      .json(toSafeErrorResponse(normalizedError, trace.traceId));
  });

  return router;
}
