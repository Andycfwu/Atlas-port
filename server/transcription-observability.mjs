import { randomUUID } from 'node:crypto';

const TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const sanitizeDiagnosticMessage = (message) =>
  message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(
      /(?:file:\/\/|\/(?:private|Users|var|data|tmp)\/)[^\s"'<>]+/gi,
      '[REDACTED_LOCAL_PATH]',
    );

export class TranscriptionServerError extends Error {
  constructor({
    cause,
    code,
    httpStatus,
    message,
    openAIErrorCode = null,
    openAIErrorType = null,
    openAIRequestId = null,
    openAIStatus = null,
    stage,
  }) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'TranscriptionServerError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.stage = stage;
    this.openAIErrorCode = openAIErrorCode;
    this.openAIErrorType = openAIErrorType;
    this.openAIRequestId = openAIRequestId;
    this.openAIStatus = openAIStatus;
    this.sourceErrorMessage =
      cause instanceof Error
        ? sanitizeDiagnosticMessage(cause.message)
        : cause == null
          ? null
          : sanitizeDiagnosticMessage(String(cause));
    this.sourceErrorName = cause instanceof Error ? cause.name : null;
  }
}

export const createAtlasTraceId = () => `atlas-tx-server-${randomUUID()}`;

export const resolveAtlasTraceId = (candidate) =>
  typeof candidate === 'string' && TRACE_ID_PATTERN.test(candidate)
    ? candidate
    : createAtlasTraceId();

export const logBackendTranscriptionEvent = (
  level,
  event,
  traceId,
  details = {},
) => {
  const payload = JSON.stringify({
    ...details,
    scope: 'atlas_transcription_backend',
    event,
    traceId,
    timestamp: new Date().toISOString(),
  });
  console[level](`[AtlasTranscription] ${payload}`);
};

const readNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readString = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;

export const normalizeOpenAIError = (error) => {
  if (error instanceof TranscriptionServerError) {
    return error;
  }

  const status = readNumber(error?.status);
  const errorName = readString(error?.name);
  const isTimeout = errorName === 'APIConnectionTimeoutError';
  const diagnostics = {
    cause: error,
    openAIErrorCode: readString(error?.code),
    openAIErrorType: readString(error?.type),
    openAIRequestId:
      readString(error?.requestID) ?? readString(error?.request_id),
    openAIStatus: status,
  };

  if (isTimeout) {
    return new TranscriptionServerError({
      ...diagnostics,
      code: 'REQUEST_TIMEOUT',
      httpStatus: 504,
      message: 'The upstream transcription request timed out.',
      stage: 'openai_request_started',
    });
  }

  if (status === 401 || status === 403) {
    return new TranscriptionServerError({
      ...diagnostics,
      code: 'OPENAI_AUTHENTICATION_FAILED',
      httpStatus: 502,
      message: 'The upstream transcription service rejected authentication.',
      stage: 'openai_request_started',
    });
  }

  if (status === 429) {
    return new TranscriptionServerError({
      ...diagnostics,
      code: 'OPENAI_RATE_LIMITED',
      httpStatus: 503,
      message: 'The upstream transcription service is rate limited.',
      stage: 'openai_request_started',
    });
  }

  return new TranscriptionServerError({
    ...diagnostics,
    code: 'OPENAI_UPSTREAM_FAILED',
    httpStatus: 502,
    message: 'The upstream transcription request failed.',
    stage: 'openai_request_started',
  });
};

export const normalizeUploadError = (error) => {
  if (error instanceof TranscriptionServerError) {
    return error;
  }

  if (error?.code === 'LIMIT_FILE_SIZE') {
    return new TranscriptionServerError({
      cause: error,
      code: 'FILE_TOO_LARGE',
      httpStatus: 413,
      message: 'The uploaded recording exceeds the 25 MB limit.',
      stage: 'upload_rejected',
    });
  }

  return new TranscriptionServerError({
    cause: error,
    code: 'UPLOAD_REJECTED',
    httpStatus: 400,
    message: 'The uploaded recording was rejected.',
    stage: 'upload_rejected',
  });
};

export const toSafeErrorResponse = (error, traceId) => ({
  code: error.code,
  message: error.message,
  stage: error.stage,
  traceId,
});

export const serverErrorLogDetails = (error) => ({
  code: error.code,
  errorMessage: error.sourceErrorMessage ?? error.message,
  errorName: error.sourceErrorName ?? error.name,
  httpStatus: error.httpStatus,
  openAIErrorCode: error.openAIErrorCode,
  openAIErrorType: error.openAIErrorType,
  openAIRequestId: error.openAIRequestId,
  openAIStatus: error.openAIStatus,
  stage: error.stage,
});
