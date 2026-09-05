import type { AudioStreamBuffer } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { appConfig } from '../../../config/app.config';
import { createTranscriptionTraceId, getBackendHost, logTranscriptionEvent } from '../recording-transcription.errors';
import { deriveLiveTranscriptionWebSocketUrl, LiveTranscriptionConnection } from './live-transcription.service';
import type { LiveTranscriptionStartOptions, LiveTranscriptionState } from './live-transcription.types';

const INITIAL_STATE: LiveTranscriptionState = {
  actualSampleRate: null, draft: '', errorMessage: null, status: 'idle', traceId: null,
};
const UNAVAILABLE = 'Live transcript unavailable. After saving, use the recording’s Transcribe action.';
const CLIENT_REVISION = 'live-pcm-after-prepare-3';
const emptyDelivery = () => ({ nativeBuffers: 0, nativeBytes: 0, firstBufferAt: 0, lastBufferAt: 0, draftPublished: false });

// A network-only consumer. It has no native stream or audio-session controls.
export const useLiveTranscription = () => {
  const [state, setState] = useState(INITIAL_STATE);
  const stateRef = useRef(state);
  const connectionRef = useRef<LiveTranscriptionConnection | null>(null);
  const generation = useRef(0);
  const draftRef = useRef('');
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delivery = useRef(emptyDelivery());

  const publish = useCallback((patch: Partial<LiveTranscriptionState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    setState(stateRef.current);
  }, []);
  const clearTimers = useCallback(() => {
    if (batchTimer.current) clearTimeout(batchTimer.current);
    if (failureTimer.current) clearTimeout(failureTimer.current);
    batchTimer.current = failureTimer.current = null;
  }, []);
  const stopLiveTranscription = useCallback((reason: string, nextStatus: 'completed' | 'failed' | 'paused' = 'completed') => {
    const current = stateRef.current;
    // Stop, backgrounding and stale cleanup must not erase a failure or fake success.
    if (['idle', 'failed', 'paused', 'completed'].includes(current.status)) return;
    if (current.traceId && current.status !== 'finishing') {
      const { nativeBuffers, nativeBytes, firstBufferAt, lastBufferAt } = delivery.current;
      logTranscriptionEvent('info', 'LIVE_AUDIO_DELIVERY_SUMMARY', current.traceId, {
        reason, nativeBuffers, nativeBytes, deliverySpanMs: lastBufferAt - firstBufferAt,
      });
    }
    clearTimers();
    if (nextStatus === 'completed' && connectionRef.current) {
      publish({ draft: draftRef.current, status: 'finishing' });
      connectionRef.current.complete();
      return;
    }
    generation.current += 1;
    connectionRef.current?.close(reason);
    connectionRef.current = null;
    publish({ draft: draftRef.current, status: nextStatus, errorMessage: nextStatus === 'failed' ? UNAVAILABLE : null });
    if (current.traceId) {
      logTranscriptionEvent(nextStatus === 'failed' ? 'warn' : 'info',
        nextStatus === 'failed' ? 'LIVE_STREAM_FAILED' : 'LIVE_STREAM_PAUSED', current.traceId,
        { reason, draftCharacterCount: draftRef.current.length });
    }
  }, [clearTimers, publish]);

  const resetLiveTranscription = useCallback(() => {
    generation.current += 1;
    clearTimers();
    connectionRef.current?.close('new_recording');
    connectionRef.current = null;
    draftRef.current = '';
    delivery.current = emptyDelivery();
    publish(INITIAL_STATE);
  }, [clearTimers, publish]);

  const startLiveTranscription = useCallback(async ({ recorderSessionId, actualSampleRate, captureError, forceFailure }: LiveTranscriptionStartOptions) => {
    resetLiveTranscription();
    const id = generation.current;
    const traceId = createTranscriptionTraceId();
    const backendHost = getBackendHost(appConfig.apiUrl);
    publish({ actualSampleRate, status: 'connecting', traceId });
    logTranscriptionEvent('info', 'LIVE_TRANSCRIPTION_REQUESTED', traceId, {
      backendHost, recorderSessionId, actualSampleRate, requestedSampleRate: 24_000,
      channels: 1, encoding: 'int16', liveMode: forceFailure ? 'force-failure' : 'on', clientRevision: CLIENT_REVISION,
    });
    const fail = (code: string, message: string) => {
      if (id !== generation.current) return;
      logTranscriptionEvent('warn', 'LIVE_STREAM_FAILED', traceId, { backendHost, recorderSessionId, code, errorMessage: message });
      stopLiveTranscription(code, 'failed');
    };
    const url = deriveLiveTranscriptionWebSocketUrl(appConfig.apiUrl);
    if (!url || captureError || actualSampleRate === null) {
      fail(captureError ? 'LIVE_CAPTURE_UNAVAILABLE' : 'LIVE_API_URL_MISSING', captureError ?? 'Live backend URL unavailable.');
      return false;
    }
    try {
      const connection = new LiveTranscriptionConnection(url, {
        actualSampleRate, channels: 1, encoding: 'int16', requestedSampleRate: 24_000, traceId,
      }, {
        onReady: (backendRevision) => {
          if (id !== generation.current) return;
          if (stateRef.current.status !== 'finishing') publish({ status: 'streaming' });
          logTranscriptionEvent('info', 'LIVE_CONNECTION_READY', traceId, { backendHost, recorderSessionId, actualSampleRate, backendRevision });
        },
        onDraft: (draft) => {
          if (id !== generation.current) return;
          draftRef.current = draft;
          if (!batchTimer.current) batchTimer.current = setTimeout(() => {
            batchTimer.current = null;
            if (id !== generation.current) return;
            publish({ draft: draftRef.current });
            if (draftRef.current && !delivery.current.draftPublished) {
              delivery.current.draftPublished = true;
              logTranscriptionEvent('info', 'LIVE_FIRST_DRAFT_PUBLISHED', traceId, { recorderSessionId, draftCharacterCount: draftRef.current.length });
            }
          }, 250);
        },
        onCompleted: () => {
          if (id !== generation.current) return;
          clearTimers();
          publish({ draft: draftRef.current, status: 'completed' });
          logTranscriptionEvent('info', 'LIVE_STREAM_COMPLETED', traceId, { recorderSessionId, draftCharacterCount: draftRef.current.length });
          connectionRef.current = null;
        },
        onFailure: (error) => fail(error.code, error.message),
      });
      connectionRef.current = connection;
      connection.connect();
      if (forceFailure) failureTimer.current = setTimeout(() => fail('LIVE_FORCED_FAILURE', 'Development live connection failure.'), 1_300);
      return true;
    } catch (error) {
      fail('LIVE_CONNECTION_FAILED', error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [clearTimers, publish, resetLiveTranscription, stopLiveTranscription]);

  const sendLiveAudio = useCallback((buffer: AudioStreamBuffer) => {
    const connection = connectionRef.current;
    if (!connection || stateRef.current.status === 'finishing') return;
    const metrics = delivery.current;
    metrics.nativeBuffers += 1;
    metrics.nativeBytes += buffer.data.byteLength;
    metrics.lastBufferAt = Date.now();
    if (metrics.nativeBuffers === 1) {
      metrics.firstBufferAt = metrics.lastBufferAt;
      if (stateRef.current.traceId) logTranscriptionEvent('info', 'LIVE_FIRST_NATIVE_BUFFER', stateRef.current.traceId, {
        actualSampleRate: buffer.sampleRate, channels: buffer.channels, byteSize: buffer.data.byteLength, encoding: 'int16',
      });
    }
    connection.sendAudio(buffer);
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') stopLiveTranscription('app_backgrounded', 'paused');
    });
    return () => subscription.remove();
  }, [stopLiveTranscription]);
  useEffect(() => () => {
    generation.current += 1;
    clearTimers();
    connectionRef.current?.close('provider_unmounted');
    connectionRef.current = null;
  }, [clearTimers]);
  return { resetLiveTranscription, sendLiveAudio, startLiveTranscription, state, stopLiveTranscription };
};
