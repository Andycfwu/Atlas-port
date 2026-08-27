import type { TranscriptionFailureDetails } from './recording-transcription.types';

export type TranscriptionStatus =
  | 'none'
  | 'transcribing'
  | 'complete'
  | 'failed';

export interface SavedRecording {
  id: string;
  filename: string;
  uri: string;
  title: string;
  createdAt: string;
  durationMillis: number;
  transcript: string | null;
  transcriptionStatus: TranscriptionStatus;
  transcriptionTraceId: string | null;
  latestTranscriptionFailure: TranscriptionFailureDetails | null;
}

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';

export type MicrophonePermissionState =
  | 'undetermined'
  | 'granted'
  | 'denied'
  | 'blocked';
