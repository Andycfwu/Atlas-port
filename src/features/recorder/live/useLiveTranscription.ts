import { type AudioStreamBuffer, useAudioStream } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { appConfig } from '../../../config/app.config';
import {
  createTranscriptionTraceId,
  getBackendHost,
  logTranscriptionEvent,
} from '../recording-transcription.errors';
import {
  deriveLiveTranscriptionWebSocketUrl,
  LiveTranscriptionConnection,
  LiveTranscriptionConnectionError,
} from './live-transcription.service';
import type {
  LiveTranscriptionStartOptions,
  LiveTranscriptionState,
  LiveTranscriptionStatus,
} from './live-transcription.types';

const REQUESTED_SAMPLE_RATE = 24_000 as const;
const LIVE_TRANSCRIPT_UNAVAILABLE = 'Live transcript unavailable';
const UI_BATCH_INTERVAL_MS = 250;

const INITIAL_STATE: LiveTranscriptionState = {
  actualSampleRate: null,
  draft: '',
  errorMessage: null,
  status: 'idle',
  traceId: null,
};

interface UseLiveTranscriptionResult {
  startLiveTranscription: (
    options: LiveTranscriptionStartOptions,
  ) => Promise<boolean>;
  state: LiveTranscriptionState;
  stopLiveTranscription: (
    reason: string,
    nextStatus?: Extract<LiveTranscriptionStatus, 'completed' | 'failed' | 'paused'>,
  ) => void;
}

export const useLiveTranscription = (): UseLiveTranscriptionResult => {
  const [state, setState] = useState<LiveTranscriptionState>(INITIAL_STATE);
  const connectionRef = useRef<LiveTranscriptionConnection | null>(null);
  const lifecycleIdRef = useRef(0);
  const latestDraftRef = useRef('');
  const stateRef = useRef(state);
  const uiBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const stopNativeStreamRef = useRef<(() => void) | null>(null);

  const handleBuffer = useCallback((buffer: AudioStreamBuffer) => {
    connectionRef.current?.sendAudio(buffer);
  }, []);

  const { stream } = useAudioStream({
    channels: 1,
    encoding: 'int16',
    onBuffer: handleBuffer,
    sampleRate: REQUESTED_SAMPLE_RATE,
  });

  useEffect(() => {
    stopNativeStreamRef.current = () => {
      if (stream.isStreaming) {
        stream.stop();
      }
    };
  }, [stream]);

  const flushDraft = useCallback((lifecycleId: number) => {
    uiBatchTimerRef.current = null;

    if (lifecycleId !== lifecycleIdRef.current) {
      return;
    }

    setState((current) => ({ ...current, draft: latestDraftRef.current }));
  }, []);

  const scheduleDraftUpdate = useCallback(
    (draft: string, lifecycleId: number) => {
      latestDraftRef.current = draft;

      if (!uiBatchTimerRef.current) {
        uiBatchTimerRef.current = setTimeout(
          () => flushDraft(lifecycleId),
          UI_BATCH_INTERVAL_MS,
        );
      }
    },
    [flushDraft],
  );

  const stopLiveTranscription = useCallback(
    (
      reason: string,
      nextStatus: Extract<
        LiveTranscriptionStatus,
        'completed' | 'failed' | 'paused'
      > = 'completed',
    ) => {
      lifecycleIdRef.current += 1;
      stopNativeStreamRef.current?.();

      const connection = connectionRef.current;
      connectionRef.current = null;

      if (nextStatus === 'completed') {
        connection?.complete();
      } else {
        connection?.close(reason);
      }

      if (uiBatchTimerRef.current) {
        clearTimeout(uiBatchTimerRef.current);
        uiBatchTimerRef.current = null;
      }

      setState((current) => ({
        ...current,
        draft: latestDraftRef.current,
        errorMessage:
          nextStatus === 'failed' ? LIVE_TRANSCRIPT_UNAVAILABLE : null,
        status: nextStatus,
      }));

      const traceId = stateRef.current.traceId;
      if (traceId) {
        logTranscriptionEvent(
          nextStatus === 'failed' ? 'warn' : 'info',
          nextStatus === 'paused'
            ? 'LIVE_STREAM_PAUSED'
            : nextStatus === 'failed'
              ? 'LIVE_STREAM_FAILED'
              : 'LIVE_STREAM_COMPLETED',
          traceId,
          {
            draftCharacterCount: latestDraftRef.current.length,
            reason,
          },
        );
      }
    },
    [],
  );

  const startLiveTranscription = useCallback(
    async ({ recorderSessionId }: LiveTranscriptionStartOptions) => {
      stopLiveTranscription('new_live_session', 'completed');
      const lifecycleId = lifecycleIdRef.current + 1;
      lifecycleIdRef.current = lifecycleId;
      const traceId = createTranscriptionTraceId();
      const backendHost = getBackendHost(appConfig.apiUrl);
      const webSocketUrl = deriveLiveTranscriptionWebSocketUrl(appConfig.apiUrl);
      latestDraftRef.current = '';
      setState({
        actualSampleRate: null,
        draft: '',
        errorMessage: null,
        status: 'connecting',
        traceId,
      });
      logTranscriptionEvent('info', 'LIVE_TRANSCRIPTION_REQUESTED', traceId, {
        backendHost,
        recorderSessionId,
        requestedSampleRate: REQUESTED_SAMPLE_RATE,
      });

      if (!webSocketUrl) {
        if (lifecycleId === lifecycleIdRef.current) {
          setState((current) => ({
            ...current,
            errorMessage: LIVE_TRANSCRIPT_UNAVAILABLE,
            status: 'failed',
          }));
        }
        logTranscriptionEvent('warn', 'LIVE_STREAM_FAILED', traceId, {
          code: 'LIVE_API_URL_MISSING',
          recorderSessionId,
        });
        return false;
      }

      try {
        await stream.start();

        if (lifecycleId !== lifecycleIdRef.current) {
          stream.stop();
          return false;
        }

        const actualSampleRate = stream.sampleRate;
        const channels = stream.channels;

        if (
          !Number.isFinite(actualSampleRate) ||
          actualSampleRate <= 0 ||
          channels !== 1
        ) {
          throw new LiveTranscriptionConnectionError(
            'LIVE_STREAM_FORMAT_CHANGED',
            `Unsupported native PCM stream: ${actualSampleRate} Hz, ${channels} channels.`,
          );
        }

        setState((current) => ({ ...current, actualSampleRate }));
        const connection = new LiveTranscriptionConnection(
          webSocketUrl,
          {
            actualSampleRate,
            channels: 1,
            encoding: 'int16',
            requestedSampleRate: REQUESTED_SAMPLE_RATE,
            traceId,
          },
          {
            onCompleted: () => {
              if (lifecycleId === lifecycleIdRef.current) {
                setState((current) => ({ ...current, status: 'completed' }));
              }
            },
            onDraft: (draft) => scheduleDraftUpdate(draft, lifecycleId),
            onFailure: (error) => {
              if (lifecycleId !== lifecycleIdRef.current) {
                return;
              }

              logTranscriptionEvent('warn', 'LIVE_STREAM_FAILED', traceId, {
                backendHost,
                code: error.code,
                errorMessage: error.message,
                recorderSessionId,
              });
              stopLiveTranscription(error.code, 'failed');
            },
            onReady: () => {
              if (lifecycleId !== lifecycleIdRef.current) {
                return;
              }

              setState((current) => ({
                ...current,
                errorMessage: null,
                status: 'streaming',
              }));
              logTranscriptionEvent('info', 'LIVE_AUDIO_STREAMING_STARTED', traceId, {
                actualSampleRate,
                backendHost,
                channels,
                encoding: 'int16',
                recorderSessionId,
                requestedSampleRate: REQUESTED_SAMPLE_RATE,
              });
            },
          },
        );
        connectionRef.current = connection;
        connection.connect();
        return true;
      } catch (error) {
        if (stream.isStreaming) {
          stream.stop();
        }

        if (lifecycleId !== lifecycleIdRef.current) {
          return false;
        }

        const code =
          error instanceof LiveTranscriptionConnectionError
            ? error.code
            : 'LIVE_CONNECTION_FAILED';
        logTranscriptionEvent('warn', 'LIVE_STREAM_FAILED', traceId, {
          backendHost,
          code,
          errorMessage: error instanceof Error ? error.message : String(error),
          recorderSessionId,
        });
        setState((current) => ({
          ...current,
          errorMessage: LIVE_TRANSCRIPT_UNAVAILABLE,
          status: 'failed',
        }));
        return false;
      }
    },
    [scheduleDraftUpdate, stopLiveTranscription, stream],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const currentStatus = stateRef.current.status;

      if (
        nextState !== 'active' &&
        (currentStatus === 'connecting' || currentStatus === 'streaming')
      ) {
        stopLiveTranscription('app_backgrounded', 'paused');
      }
    });

    return () => subscription.remove();
  }, [stopLiveTranscription]);

  useEffect(
    () => () => {
      stopNativeStreamRef.current?.();
      connectionRef.current?.close('provider_unmounted');
      connectionRef.current = null;

      if (uiBatchTimerRef.current) {
        clearTimeout(uiBatchTimerRef.current);
      }
    },
    [],
  );

  return { startLiveTranscription, state, stopLiveTranscription };
};
