import {
  TRANSCRIPTION_ERROR_CODES,
  TRANSCRIPTION_STAGES,
  type SafeBackendErrorResponse,
  type TranscriptionErrorCode,
  type TranscriptionFailureDetails,
  type TranscriptionFileMetadata,
  type TranscriptionStage,
} from './recording-transcription.types';

interface TranscriptionErrorOptions {
  backendHost?: string | null;
  backendResponse?: SafeBackendErrorResponse;
  cause?: unknown;
  developerMessage: string;
  fileMetadata?: TranscriptionFileMetadata;
  httpStatus?: number;
  requestDurationMs?: number;
}

interface TranscriptionErrorIdentity {
  code: TranscriptionErrorCode;
  stage: TranscriptionStage;
  traceId: string;
}

let traceSequence = 0;

const USER_MESSAGES: Record<TranscriptionErrorCode, string> = {
  API_URL_MISSING: 'Transcription is not configured yet.',
  LOCAL_FILE_MISSING: 'The saved recording could not be found.',
  INVALID_AUDIO_FILE: 'This recording is not a valid transcription file.',
  FILE_TOO_LARGE: 'This recording is too large to transcribe.',
  BACKEND_UNREACHABLE: 'Atlas could not reach the transcription service.',
  REQUEST_TIMEOUT: 'Transcription took too long. Please try again.',
  UPLOAD_REJECTED: 'The transcription service rejected this recording.',
  OPENAI_AUTHENTICATION_FAILED:
    'The transcription service is not configured correctly.',
  OPENAI_RATE_LIMITED:
    'The transcription service is busy. Please try again shortly.',
  OPENAI_UPSTREAM_FAILED:
    'The transcription service could not finish this recording.',
  EMPTY_TRANSCRIPT: 'No transcript was returned for this recording.',
  INVALID_BACKEND_RESPONSE:
    'Atlas received an invalid response from the transcription service.',
  LOCAL_PERSISTENCE_FAILED:
    'The transcript could not be saved on this device.',
  TRANSCRIPTION_INTERRUPTED:
    'Transcription was interrupted. Please try again.',
  UNKNOWN_TRANSCRIPTION_FAILURE:
    'Atlas could not finish the transcript. The audio is safe.',
};

const sanitizeDiagnosticMessage = (message: string): string =>
  message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(
      /(?:file:\/\/|\/(?:private|Users|var|data)\/)[^\s"'<>]+/gi,
      '[REDACTED_LOCAL_PATH]',
    );

export class TranscriptionError extends Error {
  readonly backendHost: string | null | undefined;
  readonly backendResponse: SafeBackendErrorResponse | undefined;
  readonly code: TranscriptionErrorCode;
  readonly fileMetadata: TranscriptionFileMetadata | undefined;
  readonly httpStatus: number | undefined;
  readonly requestDurationMs: number | undefined;
  readonly stage: TranscriptionStage;
  readonly traceId: string;
  readonly userMessage: string;

  constructor(
    identity: TranscriptionErrorIdentity,
    options: TranscriptionErrorOptions,
  ) {
    super(options.developerMessage, { cause: options.cause });
    this.name = 'TranscriptionError';
    this.code = identity.code;
    this.stage = identity.stage;
    this.traceId = identity.traceId;
    this.userMessage = USER_MESSAGES[identity.code];
    this.backendHost = options.backendHost;
    this.backendResponse = options.backendResponse;
    this.fileMetadata = options.fileMetadata;
    this.httpStatus = options.httpStatus;
    this.requestDurationMs = options.requestDurationMs;
  }
}

export const createTranscriptionTraceId = (): string => {
  traceSequence = (traceSequence + 1) % 1_679_616;
  const timestamp = Date.now().toString(36);
  const sequence = traceSequence.toString(36).padStart(4, '0');
  const random = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  return `atlas-tx-${timestamp}-${sequence}-${random}`;
};

export const getTranscriptionUserMessage = (
  code: TranscriptionErrorCode,
): string => USER_MESSAGES[code];

export const isTranscriptionErrorCode = (
  value: unknown,
): value is TranscriptionErrorCode =>
  typeof value === 'string' &&
  TRANSCRIPTION_ERROR_CODES.includes(value as TranscriptionErrorCode);

export const isTranscriptionStage = (
  value: unknown,
): value is TranscriptionStage =>
  typeof value === 'string' &&
  TRANSCRIPTION_STAGES.includes(value as TranscriptionStage);

export const isSafeBackendErrorResponse = (
  value: unknown,
): value is SafeBackendErrorResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const response = value as Partial<SafeBackendErrorResponse>;
  return (
    isTranscriptionErrorCode(response.code) &&
    typeof response.message === 'string' &&
    response.message.length > 0 &&
    isTranscriptionStage(response.stage) &&
    typeof response.traceId === 'string' &&
    response.traceId.length > 0
  );
};

export const getBackendHost = (apiUrl: string | null): string | null => {
  if (!apiUrl) {
    return null;
  }

  try {
    return new URL(apiUrl).host || null;
  } catch {
    return null;
  }
};

export const toTranscriptionFailureDetails = (
  error: TranscriptionError,
): TranscriptionFailureDetails => ({
  code: error.code,
  userMessage: error.userMessage,
  traceId: error.traceId,
  stage: error.stage,
  occurredAt: new Date().toISOString(),
  ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }),
});

export const logTranscriptionEvent = (
  level: 'error' | 'info' | 'warn',
  event: string,
  traceId: string,
  details: Record<string, unknown> = {},
): void => {
  if (!__DEV__) {
    return;
  }

  const payload = JSON.stringify({
    ...details,
    scope: 'atlas_transcription_mobile',
    event,
    traceId,
    timestamp: new Date().toISOString(),
  });

  console[level](`[AtlasTranscription] ${payload}`);
};

export const transcriptionErrorLogDetails = (
  error: TranscriptionError,
): Record<string, unknown> => ({
  backendHost: error.backendHost ?? null,
  backendResponse: error.backendResponse ?? null,
  code: error.code,
  errorMessage: sanitizeDiagnosticMessage(error.message),
  errorName: error.name,
  fileMetadata: error.fileMetadata ?? null,
  httpStatus: error.httpStatus ?? null,
  requestDurationMs: error.requestDurationMs ?? null,
  stage: error.stage,
});

export const normalizeTranscriptionError = (
  error: unknown,
  identity: Omit<TranscriptionErrorIdentity, 'code'> & {
    fallbackCode?: TranscriptionErrorCode;
  },
  options: Omit<TranscriptionErrorOptions, 'cause' | 'developerMessage'> = {},
): TranscriptionError => {
  if (error instanceof TranscriptionError) {
    return error;
  }

  const developerMessage =
    error instanceof Error ? error.message : String(error);
  return new TranscriptionError(
    {
      code: identity.fallbackCode ?? 'UNKNOWN_TRANSCRIPTION_FAILURE',
      stage: identity.stage,
      traceId: identity.traceId,
    },
    {
      ...options,
      cause: error,
      developerMessage,
    },
  );
};
