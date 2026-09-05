export type LiveTranscriptionStatus =
  | 'idle'
  | 'connecting'
  | 'streaming'
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
}

export interface LiveTranscriptionStreamMetadata {
  actualSampleRate: number;
  channels: 1;
  encoding: 'int16';
  requestedSampleRate: 24_000;
  traceId: string;
}

export type LiveTranscriptionServerMessage =
  | {
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
