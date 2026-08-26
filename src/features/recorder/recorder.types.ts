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
}

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';

export type MicrophonePermissionState =
  | 'undetermined'
  | 'granted'
  | 'denied'
  | 'blocked';
