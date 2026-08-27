import { File } from 'expo-file-system';

import { appConfig } from '../../config/app.config';
import { ApiError, createApiClient } from '../../services/api';
import {
  getBackendHost,
  isSafeBackendErrorResponse,
  logTranscriptionEvent,
  TranscriptionError,
} from './recording-transcription.errors';
import type {
  SafeBackendErrorResponse,
  TranscriptionErrorCode,
  TranscriptionFileMetadata,
  TranscriptionResult,
  TranscriptionStage,
} from './recording-transcription.types';
import type { SavedRecording } from './recorder.types';

const MAX_TRANSCRIPTION_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const TRANSCRIPTION_REQUEST_TIMEOUT_MS = 130_000;
const M4A_EXTENSION = '.m4a';
const DEFAULT_M4A_MIME_TYPE = 'audio/mp4';

interface ErrorContext {
  backendHost: string | null;
  fileMetadata?: TranscriptionFileMetadata;
  requestDurationMs: number;
  traceId: string;
}

interface ReactNativeFormDataFile {
  name: string;
  type: typeof DEFAULT_M4A_MIME_TYPE;
  uri: string;
}

const elapsedSince = (startedAt: number): number => Date.now() - startedAt;

const createError = (
  code: TranscriptionErrorCode,
  stage: TranscriptionStage,
  developerMessage: string,
  context: ErrorContext,
  extras: {
    backendResponse?: SafeBackendErrorResponse;
    cause?: unknown;
    httpStatus?: number;
  } = {},
): TranscriptionError =>
  new TranscriptionError(
    { code, stage, traceId: context.traceId },
    {
      backendHost: context.backendHost,
      developerMessage,
      requestDurationMs: context.requestDurationMs,
      ...(context.fileMetadata
        ? { fileMetadata: context.fileMetadata }
        : {}),
      ...(extras.backendResponse
        ? { backendResponse: extras.backendResponse }
        : {}),
      ...(extras.cause === undefined ? {} : { cause: extras.cause }),
      ...(extras.httpStatus === undefined
        ? {}
        : { httpStatus: extras.httpStatus }),
    },
  );

const mapHttpStatusToCode = (status: number): TranscriptionErrorCode => {
  if (status === 413) {
    return 'FILE_TOO_LARGE';
  }

  if (status === 408 || status === 504) {
    return 'REQUEST_TIMEOUT';
  }

  if (status === 429) {
    return 'OPENAI_RATE_LIMITED';
  }

  if (status === 400 || status === 415 || status === 422) {
    return 'UPLOAD_REJECTED';
  }

  if (status >= 500) {
    return 'OPENAI_UPSTREAM_FAILED';
  }

  return 'INVALID_BACKEND_RESPONSE';
};

const mapApiError = (
  error: ApiError,
  context: ErrorContext,
): TranscriptionError => {
  const backendError = isSafeBackendErrorResponse(error.payload)
    ? error.payload
    : undefined;

  if (backendError && backendError.traceId !== context.traceId) {
    return createError(
      'INVALID_BACKEND_RESPONSE',
      'upload_started',
      'The backend returned a different transcription trace ID.',
      context,
      { cause: error, httpStatus: error.status },
    );
  }

  const code = backendError?.code ?? mapHttpStatusToCode(error.status);
  const stage = backendError?.stage ?? 'upload_started';
  return createError(
    code,
    stage,
    backendError?.message ?? error.message,
    context,
    {
      ...(backendError ? { backendResponse: backendError } : {}),
      cause: error,
      httpStatus: error.status,
    },
  );
};

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

const collectFileMetadata = (audioFile: File): TranscriptionFileMetadata => ({
  byteSize: audioFile.size,
  extension: audioFile.extension.toLowerCase(),
  mimeType: audioFile.type || DEFAULT_M4A_MIME_TYPE,
});

export const transcribeRecordingFile = async (
  recording: SavedRecording,
  traceId: string,
): Promise<TranscriptionResult> => {
  const startedAt = Date.now();
  const backendHost = getBackendHost(appConfig.apiUrl);
  let fileMetadata: TranscriptionFileMetadata | undefined;

  if (!appConfig.apiUrl) {
    throw createError(
      'API_URL_MISSING',
      'transcription_requested',
      'EXPO_PUBLIC_API_URL is not configured for transcription.',
      {
        backendHost,
        requestDurationMs: elapsedSince(startedAt),
        traceId,
      },
    );
  }

  let audioFile: File;

  try {
    audioFile = new File(recording.uri);
  } catch (error) {
    throw createError(
      'INVALID_AUDIO_FILE',
      'local_audio_file_located',
      'The saved recording URI could not be opened as a file.',
      {
        backendHost,
        requestDurationMs: elapsedSince(startedAt),
        traceId,
      },
      { cause: error },
    );
  }

  if (!audioFile.exists) {
    throw createError(
      'LOCAL_FILE_MISSING',
      'local_audio_file_located',
      'The saved recording audio file does not exist.',
      {
        backendHost,
        requestDurationMs: elapsedSince(startedAt),
        traceId,
      },
    );
  }

  logTranscriptionEvent('info', 'LOCAL_AUDIO_FILE_LOCATED', traceId, {
    backendHost,
    recordingId: recording.id,
  });

  fileMetadata = collectFileMetadata(audioFile);
  logTranscriptionEvent('info', 'FILE_METADATA_COLLECTED', traceId, {
    backendHost,
    fileMetadata,
    recordingId: recording.id,
  });

  const context = (): ErrorContext => ({
    backendHost,
    fileMetadata,
    requestDurationMs: elapsedSince(startedAt),
    traceId,
  });

  if (fileMetadata.extension !== M4A_EXTENSION || fileMetadata.byteSize <= 0) {
    throw createError(
      'INVALID_AUDIO_FILE',
      'file_metadata_collected',
      'The saved recording must be a non-empty M4A file.',
      context(),
    );
  }

  if (fileMetadata.byteSize > MAX_TRANSCRIPTION_FILE_SIZE_BYTES) {
    throw createError(
      'FILE_TOO_LARGE',
      'file_metadata_collected',
      `The recording exceeds the ${MAX_TRANSCRIPTION_FILE_SIZE_BYTES}-byte upload limit.`,
      context(),
    );
  }

  const formData = new FormData();
  const nativeAudioFile: ReactNativeFormDataFile = {
    name: recording.filename || 'recording.m4a',
    type: DEFAULT_M4A_MIME_TYPE,
    uri: recording.uri,
  };
  const appendNativeFile = formData.append.bind(formData) as unknown as (
    name: string,
    value: ReactNativeFormDataFile,
  ) => void;
  appendNativeFile('file', nativeAudioFile);

  const apiClient = createApiClient({ baseUrl: appConfig.apiUrl });
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    TRANSCRIPTION_REQUEST_TIMEOUT_MS,
  );

  logTranscriptionEvent('info', 'UPLOAD_STARTED', traceId, {
    backendHost,
    fileMetadata,
    recordingId: recording.id,
    timeoutMs: TRANSCRIPTION_REQUEST_TIMEOUT_MS,
  });

  let response: unknown;

  try {
    response = await apiClient.request<unknown, FormData>('/transcribe', {
      method: 'POST',
      headers: {
        Accept: 'text/plain',
        'X-Atlas-Trace-Id': traceId,
      },
      body: formData,
      bodyEncoding: 'form-data',
      signal: abortController.signal,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw mapApiError(error, context());
    }

    if (abortController.signal.aborted || isAbortError(error)) {
      throw createError(
        'REQUEST_TIMEOUT',
        'upload_started',
        `The transcription request exceeded ${TRANSCRIPTION_REQUEST_TIMEOUT_MS}ms.`,
        context(),
        { cause: error },
      );
    }

    if (error instanceof TypeError) {
      throw createError(
        'BACKEND_UNREACHABLE',
        'upload_started',
        error.message,
        context(),
        { cause: error },
      );
    }

    throw createError(
      'UNKNOWN_TRANSCRIPTION_FAILURE',
      'upload_started',
      error instanceof Error ? error.message : String(error),
      context(),
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }

  if (typeof response !== 'string') {
    throw createError(
      'INVALID_BACKEND_RESPONSE',
      'openai_response_received',
      'The transcription backend returned a non-text success response.',
      context(),
    );
  }

  const transcript = response.trim();

  if (!transcript) {
    throw createError(
      'EMPTY_TRANSCRIPT',
      'transcript_validated',
      'The transcription backend returned an empty transcript.',
      context(),
    );
  }

  logTranscriptionEvent('info', 'TRANSCRIPT_VALIDATED', traceId, {
    backendHost,
    characterCount: transcript.length,
    fileMetadata,
    recordingId: recording.id,
    requestDurationMs: elapsedSince(startedAt),
  });

  return { text: transcript, traceId };
};
