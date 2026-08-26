import { Asset } from 'expo-asset';
import {
  type AudioPlayer,
  type AudioSource,
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

import { useAudioSession } from '../../services/audio';
import { animalSoundActions, type AnimalSoundId } from './atlas.assets';

interface AnimalSoundContextValue {
  activeSoundId: AnimalSoundId | null;
  disableAndStopSounds: () => Promise<void>;
  enableSounds: () => void;
  errorMessage: string | null;
  isPlaybackEnabled: boolean;
  isSoundActive: boolean;
  playSound: (soundId: AnimalSoundId) => Promise<void>;
  stopSound: () => Promise<void>;
}

interface PlaybackRequest {
  id: number;
  rawAsset: number;
  resolvedSource: AudioSource;
  soundId: AnimalSoundId;
}

interface ActiveSoundPlayerProps {
  onFailure: (
    request: PlaybackRequest,
    operation: 'load' | 'seekTo' | 'play',
    error: unknown,
    status?: AudioStatus,
  ) => void;
  onFinished: (request: PlaybackRequest) => void;
  onPlayerChange: (request: PlaybackRequest, player: AudioPlayer | null) => void;
  request: PlaybackRequest;
}

const AnimalSoundContext = createContext<AnimalSoundContextValue | null>(null);
const SOUND_ERROR_MESSAGE = 'Atlas could not play that local sound.';
const LOAD_TIMEOUT_MS = 10_000;

const logDiagnostic = (message: string, details: Record<string, unknown>): void => {
  if (__DEV__) {
    console.info(`[AtlasAudio] ${message}`, details);
  }
};

const logFailure = (message: string, details: Record<string, unknown>): void => {
  if (__DEV__) {
    console.error(`[AtlasAudio] ${message}`, details);
  }
};

function ActiveSoundPlayer({
  onFailure,
  onFinished,
  onPlayerChange,
  request,
}: ActiveSoundPlayerProps) {
  const player = useAudioPlayer(request.resolvedSource, {
    // The application-level audio coordinator owns the shared iOS session.
    // Otherwise expo-audio schedules AVAudioSession deactivation after pause,
    // which can race a microphone recording started immediately afterward.
    keepAudioSessionActive: true,
    updateInterval: 100,
  });
  const status = useAudioPlayerStatus(player);
  const didStartRef = useRef(false);
  const didReportErrorRef = useRef(false);
  const lastDiagnosticRef = useRef<string | null>(null);

  useEffect(() => {
    onPlayerChange(request, player);

    return () => onPlayerChange(request, null);
  }, [onPlayerChange, player, request]);

  useEffect(() => {
    const diagnosticKey = JSON.stringify({
      error: status.error,
      isBuffering: status.isBuffering,
      isLoaded: status.isLoaded,
      playbackState: status.playbackState,
      playing: status.playing,
      reasonForWaitingToPlay: status.reasonForWaitingToPlay,
      timeControlStatus: status.timeControlStatus,
    });

    if (diagnosticKey !== lastDiagnosticRef.current) {
      lastDiagnosticRef.current = diagnosticKey;
      logDiagnostic('player status', {
        selectedSound: request.soundId,
        rawAsset: request.rawAsset,
        playerStatus: status,
        isLoaded: status.isLoaded,
        error: status.error,
        playbackState: status.playbackState,
        reasonForWaitingToPlay: status.reasonForWaitingToPlay,
      });
    }

    if (status.error && !didReportErrorRef.current) {
      didReportErrorRef.current = true;
      onFailure(request, 'load', new Error(status.error), status);
      return;
    }

    if (status.didJustFinish) {
      onFinished(request);
    }
  }, [onFailure, onFinished, request, status]);

  useEffect(() => {
    if (!status.isLoaded || status.error || didStartRef.current) {
      return;
    }

    didStartRef.current = true;
    let cancelled = false;

    const startFromBeginning = async () => {
      try {
        await player.seekTo(0);
      } catch (error) {
        if (!cancelled) {
          onFailure(request, 'seekTo', error, player.currentStatus);
        }
        return;
      }

      if (cancelled) {
        return;
      }

      try {
        player.play();
        logDiagnostic('play invoked after load', {
          selectedSound: request.soundId,
          rawAsset: request.rawAsset,
          playerStatus: player.currentStatus,
        });
      } catch (error) {
        onFailure(request, 'play', error, player.currentStatus);
      }
    };

    void startFromBeginning();

    return () => {
      cancelled = true;
    };
  }, [onFailure, player, request, status.error, status.isLoaded]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (!didStartRef.current) {
        onFailure(
          request,
          'load',
          new Error(`Audio did not become ready within ${LOAD_TIMEOUT_MS}ms.`),
          player.currentStatus,
        );
      }
    }, LOAD_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [onFailure, player, request]);

  return null;
}

export function AnimalSoundProvider({ children }: PropsWithChildren) {
  const {
    prepareAnimalSoundPlayback,
    registerAnimalSoundStopHandler,
  } = useAudioSession();
  const [playbackRequest, setPlaybackRequest] = useState<PlaybackRequest | null>(null);
  const [isPlaybackEnabled, setIsPlaybackEnabled] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const playbackEnabledRef = useRef(true);
  const activePlayerRef = useRef<AudioPlayer | null>(null);
  const latestRequestIdRef = useRef(0);
  const isSoundActive = playbackRequest !== null;
  const activeSoundId = playbackRequest?.soundId ?? null;

  const pauseActivePlayer = useCallback((reason: 'failure' | 'stop' | 'switch') => {
    const activePlayer = activePlayerRef.current;
    activePlayerRef.current = null;

    if (!activePlayer) {
      return;
    }

    try {
      // Unmounting cancels a pending/load-only request. Calling pause on an
      // idle AVPlayer needlessly touches the shared iOS audio session.
      if (activePlayer.currentStatus.playing) {
        activePlayer.pause();
      }
    } catch (error) {
      logFailure('pause failed', {
        reason,
        exception: error,
      });
    }
  }, []);

  const stopSound = useCallback(async () => {
    latestRequestIdRef.current += 1;
    pauseActivePlayer('stop');
    setPlaybackRequest(null);
  }, [pauseActivePlayer]);

  const disableAndStopSounds = useCallback(async () => {
    playbackEnabledRef.current = false;
    setIsPlaybackEnabled(false);
    await stopSound();
  }, [stopSound]);

  useEffect(
    () => registerAnimalSoundStopHandler(stopSound),
    [registerAnimalSoundStopHandler, stopSound],
  );

  const enableSounds = useCallback(() => {
    playbackEnabledRef.current = true;
    setIsPlaybackEnabled(true);
  }, []);

  const handleFailure = useCallback(
    (
      request: PlaybackRequest,
      operation: 'load' | 'seekTo' | 'play',
      error: unknown,
      status?: AudioStatus,
    ) => {
      if (request.id !== latestRequestIdRef.current) {
        return;
      }

      logFailure(`${operation} failed`, {
        selectedSound: request.soundId,
        rawAsset: request.rawAsset,
        resolvedSource: request.resolvedSource,
        playerStatus: status ?? null,
        isLoaded: status?.isLoaded ?? false,
        error: status?.error ?? error,
        playbackState: status?.playbackState ?? null,
        reasonForWaitingToPlay: status?.reasonForWaitingToPlay ?? null,
        exception: error,
      });
      pauseActivePlayer('failure');
      setPlaybackRequest(null);
      setPlaybackError(SOUND_ERROR_MESSAGE);
    },
    [pauseActivePlayer],
  );

  const handleFinished = useCallback((request: PlaybackRequest) => {
    if (request.id === latestRequestIdRef.current) {
      activePlayerRef.current = null;
      setPlaybackRequest(null);
    }
  }, []);

  const handlePlayerChange = useCallback(
    (request: PlaybackRequest, player: AudioPlayer | null) => {
      if (request.id === latestRequestIdRef.current) {
        activePlayerRef.current = player;
      }
    },
    [],
  );

  const playSound = useCallback(async (soundId: AnimalSoundId) => {
    if (!playbackEnabledRef.current) {
      return;
    }

    const sound = animalSoundActions.find((action) => action.id === soundId);

    if (!sound) {
      setPlaybackError(SOUND_ERROR_MESSAGE);
      return;
    }

    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    pauseActivePlayer('switch');
    setPlaybackRequest(null);
    setPlaybackError(null);
    logDiagnostic('sound selected', {
      requestId,
      selectedSound: soundId,
      rawAsset: sound.source,
    });

    let resolvedSource: AudioSource;

    try {
      const asset = Asset.fromModule(sound.source);
      const downloadedAsset = await asset.downloadAsync();
      const uri = downloadedAsset.localUri ?? downloadedAsset.uri;

      if (!uri) {
        throw new Error('The bundled sound asset did not resolve to a URI.');
      }

      resolvedSource = {
        uri,
        name: downloadedAsset.name,
      };
      logDiagnostic('bundled asset resolved', {
        requestId,
        selectedSound: soundId,
        rawAsset: sound.source,
        assetUri: downloadedAsset.uri,
        localUri: downloadedAsset.localUri,
        resolvedSource,
      });
    } catch (error) {
      if (requestId === latestRequestIdRef.current) {
        logFailure('asset resolution failed', {
          requestId,
          selectedSound: soundId,
          rawAsset: sound.source,
          exception: error,
        });
        setPlaybackError(SOUND_ERROR_MESSAGE);
      }
      return;
    }

    if (requestId !== latestRequestIdRef.current || !playbackEnabledRef.current) {
      logDiagnostic('stale sound request ignored before audio-session transition', {
        requestId,
        selectedSound: soundId,
        latestRequestId: latestRequestIdRef.current,
      });
      return;
    }

    try {
      const canPlay = await prepareAnimalSoundPlayback({
        reason: `animal_sound_${soundId}`,
      });

      if (!canPlay) {
        logDiagnostic('animal sound request denied by audio session', {
          requestId,
          selectedSound: soundId,
        });
        return;
      }
    } catch (error) {
      if (requestId === latestRequestIdRef.current) {
        logFailure('audio-session configuration failed', {
          requestId,
          selectedSound: soundId,
          rawAsset: sound.source,
          exception: error,
        });
        setPlaybackError(SOUND_ERROR_MESSAGE);
      }
      return;
    }

    if (requestId !== latestRequestIdRef.current || !playbackEnabledRef.current) {
      logDiagnostic('stale sound request ignored', {
        requestId,
        selectedSound: soundId,
        latestRequestId: latestRequestIdRef.current,
      });
      return;
    }

    setPlaybackRequest({
      id: requestId,
      rawAsset: sound.source,
      resolvedSource,
      soundId,
    });
  }, [pauseActivePlayer, prepareAnimalSoundPlayback]);

  const value = useMemo<AnimalSoundContextValue>(
    () => ({
      activeSoundId,
      disableAndStopSounds,
      enableSounds,
      errorMessage: playbackError,
      isPlaybackEnabled,
      isSoundActive,
      playSound,
      stopSound,
    }),
    [
      activeSoundId,
      disableAndStopSounds,
      enableSounds,
      isPlaybackEnabled,
      isSoundActive,
      playbackError,
      playSound,
      stopSound,
    ],
  );

  return (
    <AnimalSoundContext.Provider value={value}>
      {children}
      {playbackRequest ? (
        <ActiveSoundPlayer
          key={playbackRequest.id}
          onFailure={handleFailure}
          onFinished={handleFinished}
          onPlayerChange={handlePlayerChange}
          request={playbackRequest}
        />
      ) : null}
    </AnimalSoundContext.Provider>
  );
}

export function useAnimalSounds(): AnimalSoundContextValue {
  const context = useContext(AnimalSoundContext);

  if (!context) {
    throw new Error('useAnimalSounds must be used within an AnimalSoundProvider.');
  }

  return context;
}
