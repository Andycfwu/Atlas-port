export const TRANSCRIPTION_ERROR_CODES = [
  'API_URL_MISSING',
  'LOCAL_FILE_MISSING',
  'INVALID_AUDIO_FILE',
  'FILE_TOO_LARGE',
  'BACKEND_UNREACHABLE',
  'REQUEST_TIMEOUT',
  'UPLOAD_REJECTED',
  'OPENAI_AUTHENTICATION_FAILED',
  'OPENAI_RATE_LIMITED',
  'OPENAI_UPSTREAM_FAILED',
  'EMPTY_TRANSCRIPT',
  'INVALID_BACKEND_RESPONSE',
  'LOCAL_PERSISTENCE_FAILED',
  'TRANSCRIPTION_INTERRUPTED',
  'UNKNOWN_TRANSCRIPTION_FAILURE',
] as const;

export type TranscriptionErrorCode =
  (typeof TRANSCRIPTION_ERROR_CODES)[number];

export const TRANSCRIPTION_STAGES = [
  'transcription_requested',
  'local_audio_file_located',
  'file_metadata_collected',
  'upload_started',
  'backend_request_received',
  'upload_accepted',
  'upload_rejected',
  'openai_request_started',
  'openai_response_received',
  'transcript_validated',
  'recording_metadata_persisted',
  'request_completed',
  'request_failed',
] as const;

export type TranscriptionStage = (typeof TRANSCRIPTION_STAGES)[number];

export interface TranscriptionFailureDetails {
  code: TranscriptionErrorCode;
  userMessage: string;
  traceId: string;
  stage: TranscriptionStage;
  occurredAt: string;
  httpStatus?: number;
}

export interface TranscriptionFileMetadata {
  byteSize: number;
  extension: string;
  mimeType: string;
}

export interface SafeBackendErrorResponse {
  code: TranscriptionErrorCode;
  message: string;
  stage: TranscriptionStage;
  traceId: string;
}

export interface TranscriptionResult {
  text: string;
  traceId: string;
}
