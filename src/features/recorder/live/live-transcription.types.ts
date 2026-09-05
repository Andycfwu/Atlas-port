export type LiveTranscriptionStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
  | 'finishing'
  | 'paused'
  | 'failed'
  | 'completed';

export interface LiveTranscriptionState {
  actualSampleRate: number | null;
  draft: string;
  errorMessage: string | null;
  status: LiveTranscriptionStatus;
  traceId: string | null;
}

export interface LiveTranscriptionStartOptions {
  recorderSessionId: string;
  actualSampleRate: number | null;
  captureError?: string | undefined;
  forceFailure?: boolean;
}

export interface LiveTranscriptionStreamMetadata {
  actualSampleRate: number;
  channels: 1;
  encoding: 'int16';
  requestedSampleRate: 24_000;
  traceId: string;
}

export type LiveTranscriptionServerMessage =
  | { type: 'committed'; itemId: string; previousItemId: string | null; traceId: string }
  | {
      backendRevision: string | null;
      resampling: boolean;
      targetSampleRate: number;
      traceId: string;
      type: 'ready';
    }
  | {
      delta: string;
      itemId: string;
      traceId: string;
      type: 'partial';
    }
  | {
      itemId: string;
      traceId: string;
      transcript: string;
      type: 'final';
    }
  | {
      traceId: string;
      type: 'completed';
    }
  | {
      code: string;
      message: string;
      stage: string;
      traceId: string;
      type: 'error';
    };
