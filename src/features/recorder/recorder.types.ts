import type { DiarizationJob, DiarizedTranscript } from './diarization/diarization.types';
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
  /** Historical recordings have no saved live source. Never infer it from post text. */
  liveTranscript?: SavedLiveTranscript | null;
  postTranscripts?: SavedPostTranscript[];
  diarization?: Omit<DiarizationJob, 'result'>;
  diarizedTranscripts?: DiarizedTranscript[];
}

export interface LiveTranscriptSegment { itemId: string; deltaText: string; finalText: string | null }
export interface SavedLiveTranscript {
  source: 'live'; text: string; segments: LiveTranscriptSegment[];
  status: 'completed' | 'paused' | 'failed' | 'finishing';
  traceId: string | null; recorderSessionId: string;
  model: 'gpt-live-transcribe'; savedAt: string; errorMessage: string | null;
}
export interface SavedPostTranscript {
  source: 'saved_audio'; text: string; traceId: string | null;
  model: string | null; savedAt: string | null;
}

export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'stopping' | 'error';

export type MicrophonePermissionState =
  | 'undetermined'
  | 'granted'
  | 'denied'
  | 'blocked';
