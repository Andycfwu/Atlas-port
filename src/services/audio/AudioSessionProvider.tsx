import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  configurePlaybackAudioMode,
  configureRecordingAudioMode,
} from './audio-session.service';

type StopHandler = () => Promise<void>;
type AudioModeKind = 'playback' | 'recording' | 'unknown';

export interface AudioSessionRequest {
  reason: string;
  sessionId?: string | null;
  prepareCapture?: () => Promise<void>;
}

export interface RecorderAudioSessionProbe {
  nativeIsRecording: boolean;
  recorderId: string | null;
  statusIsRecording: boolean;
}

interface AudioSessionContextValue {
  finishMicrophoneRecording: (request?: AudioSessionRequest) => Promise<boolean>;
  isMicrophoneActive: boolean;
  prepareAnimalSoundPlayback: (request?: AudioSessionRequest) => Promise<boolean>;
  prepareMicrophoneRecording: (request?: AudioSessionRequest) => Promise<boolean>;
  prepareRecordingPlayback: (request?: AudioSessionRequest) => Promise<boolean>;
  registerAnimalSoundStopHandler: (handler: StopHandler) => () => void;
  registerRecorderProbe: (
    probe: () => RecorderAudioSessionProbe,
  ) => () => void;
  registerRecordingPlaybackStopHandler: (handler: StopHandler) => () => void;
  stopSavedRecordingPlayback: () => Promise<void>;
}

const AudioSessionContext = createContext<AudioSessionContextValue | null>(null);
const EMPTY_RECORDER_PROBE: RecorderAudioSessionProbe = {
  nativeIsRecording: false,
  recorderId: null,
  statusIsRecording: false,
};

const logAudioSessionError = (operation: string, error: unknown): void => {
  if (__DEV__) {
    console.error(`[AudioSession] ${operation} failed.`, error);
  }
};

const defaultRequest = (reason: string): AudioSessionRequest => ({ reason });

export function AudioSessionProvider({ children }: PropsWithChildren) {
  const [isMicrophoneActive, setIsMicrophoneActive] = useState(false);
  const animalSoundStopHandlerRef = useRef<StopHandler | null>(null);
  const recordingPlaybackStopHandlerRef = useRef<StopHandler | null>(null);
  const recorderProbeRef = useRef<(() => RecorderAudioSessionProbe) | null>(null);
  const isMicrophoneActiveRef = useRef(false);
  const latestTransitionIdRef = useRef(0);
  const modeRef = useRef<AudioModeKind>('unknown');
  const transitionQueueRef = useRef<Promise<void>>(Promise.resolve());

  const readRecorderProbe = useCallback((): RecorderAudioSessionProbe => {
    try {
      return recorderProbeRef.current?.() ?? EMPTY_RECORDER_PROBE;
    } catch (error) {
      logAudioSessionError('Reading recorder probe', error);
      return EMPTY_RECORDER_PROBE;
    }
  }, []);

  const logTransition = useCallback(
    (
      transitionId: number,
      requestedMode: AudioModeKind,
      request: AudioSessionRequest,
      outcome: 'ready' | 'rejected' | 'requested' | 'stale',
    ) => {
      if (!__DEV__) {
        return;
      }

      console.info('[AudioSessionTransition]', {
        currentRecorder: readRecorderProbe(),
        microphoneActive: isMicrophoneActiveRef.current,
        outcome,
        previousMode: modeRef.current,
        reason: request.reason,
        requestedMode,
        sessionId: request.sessionId ?? null,
        transitionId,
      });
    },
    [readRecorderProbe],
  );

  const enqueueTransition = useCallback(
    async (transition: () => Promise<boolean>): Promise<boolean> => {
      let result = false;
      const queued = transitionQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          result = await transition();
        });

      transitionQueueRef.current = queued.catch(() => undefined);
      await queued;
      return result;
    },
    [],
  );

  const ensurePlaybackMode = useCallback(
    async (
      transitionId: number,
      request: AudioSessionRequest,
    ): Promise<boolean> => {
      const recorderProbe = readRecorderProbe();

      if (recorderProbe.nativeIsRecording) {
        logTransition(transitionId, 'playback', request, 'rejected');
        if (__DEV__) {
          console.error(
            '[AudioSession] Playback mode was rejected while the native recorder was active.',
            {
              recorderProbe,
              reason: request.reason,
              sessionId: request.sessionId ?? null,
              transitionId,
            },
          );
        }
        return false;
      }

      if (modeRef.current === 'playback') {
        return true;
      }

      logTransition(transitionId, 'playback', request, 'requested');
      await configurePlaybackAudioMode();
      modeRef.current = 'playback';
      logTransition(transitionId, 'playback', request, 'ready');
      return true;
    },
    [logTransition, readRecorderProbe],
  );

  const prepareAnimalSoundPlayback = useCallback(
    async (request = defaultRequest('animal_sound_playback')) => {
      const recorderProbe = readRecorderProbe();

      if (isMicrophoneActiveRef.current || recorderProbe.nativeIsRecording) {
        return false;
      }

      const transitionId = latestTransitionIdRef.current + 1;
      latestTransitionIdRef.current = transitionId;

      try {
        return await enqueueTransition(async () => {
          if (
            transitionId !== latestTransitionIdRef.current ||
            isMicrophoneActiveRef.current ||
            readRecorderProbe().nativeIsRecording
          ) {
            logTransition(transitionId, 'playback', request, 'stale');
            return false;
          }

          await recordingPlaybackStopHandlerRef.current?.();

          if (
            transitionId !== latestTransitionIdRef.current ||
            isMicrophoneActiveRef.current ||
            readRecorderProbe().nativeIsRecording
          ) {
            logTransition(transitionId, 'playback', request, 'stale');
            return false;
          }

          return ensurePlaybackMode(transitionId, request);
        });
      } catch (error) {
        logAudioSessionError('Preparing animal sound playback', error);
        throw error;
      }
    },
    [enqueueTransition, ensurePlaybackMode, logTransition, readRecorderProbe],
  );

  const prepareRecordingPlayback = useCallback(
    async (request = defaultRequest('saved_recording_playback')) => {
      const recorderProbe = readRecorderProbe();

      if (isMicrophoneActiveRef.current || recorderProbe.nativeIsRecording) {
        return false;
      }

      const transitionId = latestTransitionIdRef.current + 1;
      latestTransitionIdRef.current = transitionId;

      try {
        return await enqueueTransition(async () => {
          if (
            transitionId !== latestTransitionIdRef.current ||
            isMicrophoneActiveRef.current ||
            readRecorderProbe().nativeIsRecording
          ) {
            logTransition(transitionId, 'playback', request, 'stale');
            return false;
          }

          await animalSoundStopHandlerRef.current?.();

          if (
            transitionId !== latestTransitionIdRef.current ||
            isMicrophoneActiveRef.current ||
            readRecorderProbe().nativeIsRecording
          ) {
            logTransition(transitionId, 'playback', request, 'stale');
            return false;
          }

          return ensurePlaybackMode(transitionId, request);
        });
      } catch (error) {
        logAudioSessionError('Preparing recording playback', error);
        throw error;
      }
    },
    [enqueueTransition, ensurePlaybackMode, logTransition, readRecorderProbe],
  );

  const prepareMicrophoneRecording = useCallback(
    async (request = defaultRequest('microphone_recording_start')) => {
      const transitionId = latestTransitionIdRef.current + 1;
      latestTransitionIdRef.current = transitionId;
      isMicrophoneActiveRef.current = true;
      setIsMicrophoneActive(true);
      logTransition(transitionId, 'recording', request, 'requested');

      try {
        return await enqueueTransition(async () => {
          if (transitionId !== latestTransitionIdRef.current) {
            logTransition(transitionId, 'recording', request, 'stale');
            return false;
          }

          await animalSoundStopHandlerRef.current?.();
          await recordingPlaybackStopHandlerRef.current?.();

          if (transitionId !== latestTransitionIdRef.current) {
            logTransition(transitionId, 'recording', request, 'stale');
            return false;
          }

          // Lock the microphone and stop playback before PCM startup. Restore
          // recording mode afterward: SDK 57 AudioStream.start changes it.
          await request.prepareCapture?.();
          await configureRecordingAudioMode();
          modeRef.current = 'recording';
          logTransition(transitionId, 'recording', request, 'ready');
          return transitionId === latestTransitionIdRef.current;
        });
      } catch (error) {
        modeRef.current = 'unknown';
        logAudioSessionError('Preparing microphone recording', error);
        throw error;
      }
    },
    [enqueueTransition, logTransition],
  );

  const finishMicrophoneRecording = useCallback(
    async (request = defaultRequest('microphone_recording_finished')) => {
      const transitionId = latestTransitionIdRef.current + 1;
      latestTransitionIdRef.current = transitionId;

      try {
        const restored = await enqueueTransition(async () => {
          if (transitionId !== latestTransitionIdRef.current) {
            logTransition(transitionId, 'playback', request, 'stale');
            return false;
          }

          return ensurePlaybackMode(transitionId, request);
        });

        if (restored && transitionId === latestTransitionIdRef.current) {
          isMicrophoneActiveRef.current = false;
          setIsMicrophoneActive(false);
        }

        return restored;
      } catch (error) {
        modeRef.current = 'unknown';
        logAudioSessionError('Restoring playback mode', error);
        throw error;
      }
    },
    [enqueueTransition, ensurePlaybackMode, logTransition],
  );

  const registerAnimalSoundStopHandler = useCallback((handler: StopHandler) => {
    animalSoundStopHandlerRef.current = handler;

    return () => {
      if (animalSoundStopHandlerRef.current === handler) {
        animalSoundStopHandlerRef.current = null;
      }
    };
  }, []);

  const registerRecorderProbe = useCallback(
    (probe: () => RecorderAudioSessionProbe) => {
      recorderProbeRef.current = probe;

      return () => {
        if (recorderProbeRef.current === probe) {
          recorderProbeRef.current = null;
        }
      };
    },
    [],
  );

  const registerRecordingPlaybackStopHandler = useCallback((handler: StopHandler) => {
    recordingPlaybackStopHandlerRef.current = handler;

    return () => {
      if (recordingPlaybackStopHandlerRef.current === handler) {
        recordingPlaybackStopHandlerRef.current = null;
      }
    };
  }, []);

  const stopSavedRecordingPlayback = useCallback(async () => {
    await recordingPlaybackStopHandlerRef.current?.();
  }, []);

  const value = useMemo<AudioSessionContextValue>(
    () => ({
      finishMicrophoneRecording,
      isMicrophoneActive,
      prepareAnimalSoundPlayback,
      prepareMicrophoneRecording,
      prepareRecordingPlayback,
      registerAnimalSoundStopHandler,
      registerRecorderProbe,
      registerRecordingPlaybackStopHandler,
      stopSavedRecordingPlayback,
    }),
    [
      finishMicrophoneRecording,
      isMicrophoneActive,
      prepareAnimalSoundPlayback,
      prepareMicrophoneRecording,
      prepareRecordingPlayback,
      registerAnimalSoundStopHandler,
      registerRecorderProbe,
      registerRecordingPlaybackStopHandler,
      stopSavedRecordingPlayback,
    ],
  );

  return (
    <AudioSessionContext.Provider value={value}>
      {children}
    </AudioSessionContext.Provider>
  );
}

export function useAudioSession(): AudioSessionContextValue {
  const context = useContext(AudioSessionContext);

  if (!context) {
    throw new Error('useAudioSession must be used within an AudioSessionProvider.');
  }

  return context;
}
