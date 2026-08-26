import {
  type AudioPlayer,
  type AudioStatus,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAudioSession } from '../../../services/audio';
import type { SavedRecording } from '../recorder.types';
import {
  clampSeekMillis,
  ensureRecordingFileExists,
  secondsToMillis,
} from './recording-player.service';
import type { RecordingPlaybackPhase } from './recording-player.types';

interface ActiveRecording {
  loadId: number;
  recording: SavedRecording;
}

interface PendingPlayback {
  actionId: number;
  recordingId: string;
}

interface RecordingPlayerContextValue {
  activeRecording: SavedRecording | null;
  activeRecordingId: string | null;
  clearPlaybackError: () => void;
  currentTimeMillis: number;
  durationMillis: number;
  errorMessage: string | null;
  isBuffering: boolean;
  isLoaded: boolean;
  isMicrophoneActive: boolean;
  isPlaying: boolean;
  pause: () => Promise<void>;
  phase: RecordingPlaybackPhase;
  playRecording: (recording: SavedRecording) => Promise<void>;
  resume: () => Promise<void>;
  seekTo: (positionMillis: number) => Promise<void>;
  stop: () => Promise<void>;
  stopIfActive: (recordingId: string) => Promise<void>;
}

const RecordingPlayerContext = createContext<RecordingPlayerContextValue | null>(null);
const LOAD_TIMEOUT_MS = 10_000;
const PLAYBACK_ERROR = 'Atlas could not play this recording.';
const MISSING_FILE_ERROR = 'This recording file is no longer available on this device.';
const RECORDING_ACTIVE_ERROR = 'Stop the active recording before playing a saved recording.';
const AUDIO_INTERRUPTED_ERROR = 'Another Atlas audio action interrupted playback.';

const logPlaybackFailure = (
  operation: string,
  error: unknown,
  recording?: SavedRecording | null,
  status?: AudioStatus,
): void => {
  if (__DEV__) {
    console.error(`[RecordingPlayer] ${operation} failed.`, {
      error,
      recordingId: recording?.id ?? null,
      recordingUri: recording?.uri ?? null,
      status: status ?? null,
    });
  }
};

const pausePlayer = (player: AudioPlayer): void => {
  try {
    // Clearing the source is sufficient for idle/loading/paused players.
    // Avoid asking expo-audio to pause an idle AVPlayer during microphone
    // startup, because pause participates in global iOS session teardown.
    if (player.currentStatus.playing) {
      player.pause();
    }
  } catch (error) {
    logPlaybackFailure('Pause', error, null, player.currentStatus);
  }
};

export function RecordingPlayerProvider({ children }: PropsWithChildren) {
  const {
    isMicrophoneActive,
    prepareRecordingPlayback,
    registerRecordingPlaybackStopHandler,
  } = useAudioSession();
  const [active, setActive] = useState<ActiveRecording | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const actionIdRef = useRef(0);
  const loadIdRef = useRef(0);
  const pendingPlaybackRef = useRef<PendingPlayback | null>(null);
  const activeRecordingRef = useRef<SavedRecording | null>(null);
  const source = active
    ? { uri: active.recording.uri, name: `${active.recording.filename}-${active.loadId}` }
    : null;
  const player = useAudioPlayer(source, {
    // AudioSessionProvider deliberately owns session transitions. Allowing a
    // paused player to deactivate AVAudioSession can truncate a newly started
    // microphone recording about 100 ms later on iOS.
    keepAudioSessionActive: true,
    updateInterval: 100,
  });
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    activeRecordingRef.current = active?.recording ?? null;
  }, [active]);

  const failPlayback = useCallback(
    (operation: string, error: unknown, message = PLAYBACK_ERROR) => {
      pendingPlaybackRef.current = null;
      pausePlayer(player);
      setPlaybackError(message);
      logPlaybackFailure(
        operation,
        error,
        activeRecordingRef.current,
        player.currentStatus,
      );
    },
    [player],
  );

  const stop = useCallback(async () => {
    actionIdRef.current += 1;
    pendingPlaybackRef.current = null;
    pausePlayer(player);
    activeRecordingRef.current = null;
    setActive(null);
    setPlaybackError(null);
  }, [player]);

  useEffect(
    () => registerRecordingPlaybackStopHandler(stop),
    [registerRecordingPlaybackStopHandler, stop],
  );

  useEffect(() => {
    if (!active) {
      return;
    }

    if (status.error) {
      pendingPlaybackRef.current = null;
      pausePlayer(player);
      logPlaybackFailure(
        'Native player status',
        new Error(status.error),
        active.recording,
        status,
      );
    } else if (status.didJustFinish) {
      pendingPlaybackRef.current = null;
    }
  }, [active, player, status]);

  useEffect(() => {
    if (!active || status.isLoaded || status.error) {
      return;
    }

    const timeout = setTimeout(() => {
      if (!player.currentStatus.isLoaded) {
        failPlayback(
          'Load timeout',
          new Error(`Recording did not load within ${LOAD_TIMEOUT_MS}ms.`),
        );
      }
    }, LOAD_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [active, failPlayback, player, status.error, status.isLoaded]);

  const startLoadedPlayer = useCallback(
    async (recording: SavedRecording, actionId: number) => {
      if (actionId !== actionIdRef.current || !player.currentStatus.isLoaded) {
        return;
      }

      const currentStatus = player.currentStatus;
      const durationMillis = secondsToMillis(currentStatus.duration);
      const currentTimeMillis = secondsToMillis(currentStatus.currentTime);
      const shouldRestart =
        durationMillis > 0 && currentTimeMillis >= durationMillis - 100;

      try {
        if (shouldRestart) {
          await player.seekTo(0);
        }

        if (actionId !== actionIdRef.current) {
          return;
        }

        player.play();
        setPlaybackError(null);
      } catch (error) {
        failPlayback('Play', error);
      }
    },
    [failPlayback, player],
  );

  useEffect(() => {
    const pending = pendingPlaybackRef.current;

    if (
      !active ||
      !pending ||
      pending.recordingId !== active.recording.id ||
      !status.isLoaded ||
      status.error
    ) {
      return;
    }

    pendingPlaybackRef.current = null;
    void startLoadedPlayer(active.recording, pending.actionId);
  }, [active, startLoadedPlayer, status.error, status.isLoaded]);

  const requestPlaybackPermission = useCallback(async (actionId: number) => {
    if (isMicrophoneActive) {
      if (actionId === actionIdRef.current) {
        setPlaybackError(RECORDING_ACTIVE_ERROR);
      }
      return false;
    }

    try {
      const granted = await prepareRecordingPlayback({
        reason: `saved_recording_${activeRecordingRef.current?.id ?? 'unknown'}_playback`,
      });

      if (!granted && actionId === actionIdRef.current) {
        setPlaybackError(
          isMicrophoneActive ? RECORDING_ACTIVE_ERROR : AUDIO_INTERRUPTED_ERROR,
        );
      }

      return granted;
    } catch (error) {
      logPlaybackFailure('Audio session', error, activeRecordingRef.current);
      if (actionId === actionIdRef.current) {
        setPlaybackError(PLAYBACK_ERROR);
      }
      return false;
    }
  }, [isMicrophoneActive, prepareRecordingPlayback]);

  const playRecording = useCallback(
    async (recording: SavedRecording) => {
      const actionId = actionIdRef.current + 1;
      actionIdRef.current = actionId;
      pendingPlaybackRef.current = null;
      setPlaybackError(null);

      try {
        ensureRecordingFileExists(recording);
      } catch (error) {
        logPlaybackFailure('File validation', error, recording);
        setPlaybackError(MISSING_FILE_ERROR);
        return;
      }

      if (!(await requestPlaybackPermission(actionId)) || actionId !== actionIdRef.current) {
        return;
      }

      if (active?.recording.id === recording.id && status.isLoaded) {
        await startLoadedPlayer(recording, actionId);
        return;
      }

      pausePlayer(player);
      loadIdRef.current += 1;
      pendingPlaybackRef.current = { actionId, recordingId: recording.id };
      activeRecordingRef.current = recording;
      setActive({ loadId: loadIdRef.current, recording });
    },
    [active, player, requestPlaybackPermission, startLoadedPlayer, status.isLoaded],
  );

  const resume = useCallback(async () => {
    const recording = activeRecordingRef.current;

    if (!recording) {
      return;
    }

    const actionId = actionIdRef.current + 1;
    actionIdRef.current = actionId;
    setPlaybackError(null);

    if (!(await requestPlaybackPermission(actionId)) || actionId !== actionIdRef.current) {
      return;
    }

    if (!player.currentStatus.isLoaded) {
      pendingPlaybackRef.current = { actionId, recordingId: recording.id };
      return;
    }

    await startLoadedPlayer(recording, actionId);
  }, [player, requestPlaybackPermission, startLoadedPlayer]);

  const pause = useCallback(async () => {
    actionIdRef.current += 1;
    pendingPlaybackRef.current = null;

    try {
      player.pause();
    } catch (error) {
      failPlayback('Pause', error);
    }
  }, [failPlayback, player]);

  const seekTo = useCallback(
    async (positionMillis: number) => {
      const recording = activeRecordingRef.current;
      const currentStatus = player.currentStatus;
      const nativeDurationMillis = secondsToMillis(currentStatus.duration);
      const durationMillis = nativeDurationMillis || recording?.durationMillis || 0;

      if (!recording || !currentStatus.isLoaded || durationMillis <= 0) {
        setPlaybackError('This recording is not ready to seek yet.');
        return;
      }

      const targetMillis = clampSeekMillis(positionMillis, durationMillis);
      const seekingToEnd = targetMillis >= durationMillis - 50;

      try {
        if (seekingToEnd && currentStatus.playing) {
          player.pause();
        }

        await player.seekTo(targetMillis / 1000, 0, 0);
        setPlaybackError(null);
      } catch (error) {
        failPlayback('Seek', error, 'Atlas could not seek within this recording.');
      }
    },
    [failPlayback, player],
  );

  const stopIfActive = useCallback(
    async (recordingId: string) => {
      if (activeRecordingRef.current?.id === recordingId) {
        await stop();
      }
    },
    [stop],
  );

  const nativeDurationMillis = secondsToMillis(status.duration);
  const durationMillis = nativeDurationMillis || active?.recording.durationMillis || 0;
  const currentTimeMillis = Math.min(
    secondsToMillis(status.currentTime),
    Math.max(0, durationMillis),
  );
  const isAtEnd =
    durationMillis > 0 &&
    currentTimeMillis >= durationMillis - 100 &&
    !status.playing;
  const phase: RecordingPlaybackPhase = !active
    ? 'idle'
    : playbackError || status.error
      ? 'error'
      : !status.isLoaded
        ? 'loading'
        : status.playing
          ? 'playing'
          : status.didJustFinish || isAtEnd
            ? 'completed'
            : 'paused';
  const value = useMemo<RecordingPlayerContextValue>(
    () => ({
      activeRecording: active?.recording ?? null,
      activeRecordingId: active?.recording.id ?? null,
      clearPlaybackError: () => setPlaybackError(null),
      currentTimeMillis,
      durationMillis,
      errorMessage: playbackError ?? (status.error ? PLAYBACK_ERROR : null),
      isBuffering: status.isBuffering,
      isLoaded: status.isLoaded,
      isMicrophoneActive,
      isPlaying: phase === 'playing',
      pause,
      phase,
      playRecording,
      resume,
      seekTo,
      stop,
      stopIfActive,
    }),
    [
      active,
      currentTimeMillis,
      durationMillis,
      isMicrophoneActive,
      pause,
      phase,
      playbackError,
      playRecording,
      resume,
      seekTo,
      status.isBuffering,
      status.error,
      status.isLoaded,
      stop,
      stopIfActive,
    ],
  );

  return (
    <RecordingPlayerContext.Provider value={value}>
      {children}
    </RecordingPlayerContext.Provider>
  );
}

export function useRecordingPlayer(): RecordingPlayerContextValue {
  const context = useContext(RecordingPlayerContext);

  if (!context) {
    throw new Error('useRecordingPlayer must be used within a RecordingPlayerProvider.');
  }

  return context;
}
