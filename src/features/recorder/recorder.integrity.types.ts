export type RecorderIntegrityEvent =
  | 'SESSION_CREATED'
  | 'AUDIO_MODE_RECORDING_REQUESTED'
  | 'AUDIO_MODE_RECORDING_READY'
  | 'PREPARE_STARTED'
  | 'PREPARE_FINISHED'
  | 'RECORD_CALLED'
  | 'NATIVE_RECORDING_CONFIRMED'
  | 'APP_BACKGROUND'
  | 'APP_FOREGROUND'
  | 'STOP_REQUESTED'
  | 'STATUS_BEFORE_STOP'
  | 'STOP_FINISHED'
  | 'STATUS_AFTER_STOP'
  | 'FILE_SIZE_POLL'
  | 'FILE_STABLE'
  | 'FILE_LOADED_FOR_VALIDATION'
  | 'DURATION_VALIDATED'
  | 'FILE_MOVED'
  | 'FILE_COPIED'
  | 'DESTINATION_VALIDATED'
  | 'METADATA_SAVED'
  | 'SESSION_FAILED';

export interface RecordingFileObservation {
  exists: boolean;
  modificationTime: number | null;
  pollNumber: number;
  size: number;
  uri: string;
}

export interface RecordingFileValidation {
  checks: RecorderIntegrityCheck[];
  durationDifferenceMillis: number | null;
  durationToleranceMillis: number;
  error: string | null;
  failedChecks: RecorderIntegrityCheck[];
  fileSize: number | null;
  isPlayable: boolean;
  modificationTime: number | null;
  nativeDurationMillis: number;
  passed: boolean;
  playerDurationMillis: number | null;
  uri: string;
}

export type RecorderIntegrityTestKind = 'normal' | 'production' | 'raw';

export interface RecorderIntegrityCheck {
  actual: string;
  expected: string;
  id:
    | 'destination_duration_matches'
    | 'destination_size_matches'
    | 'expected_duration_matches'
    | 'file_is_stable'
    | 'file_meets_minimum_size'
    | 'metadata_saved'
    | 'native_duration_is_positive'
    | 'native_matches_playable_duration'
    | 'operation_completed'
    | 'player_loaded'
    | 'player_duration_is_positive';
  label: string;
  passed: boolean;
}

export interface RecorderIntegrityResult {
  checks: RecorderIntegrityCheck[];
  destinationUri: string | null;
  error: string | null;
  expectedDurationMillis: number | null;
  failedChecks: RecorderIntegrityCheck[];
  fileSize: number | null;
  isPlayable: boolean;
  libraryRecordingId: string | null;
  nativeDurationAfterStopMillis: number | null;
  nativeDurationBeforeStopMillis: number | null;
  passed: boolean;
  playerDurationMillis: number | null;
  recorderId: string;
  sessionId: string;
  sourceUri: string | null;
  sourceValidation: RecordingFileValidation | null;
  testKind: RecorderIntegrityTestKind;
}
