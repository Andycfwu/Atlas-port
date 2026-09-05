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
import {
  getRecordingPermissionsAsync,
  PermissionStatus,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  type AudioRecorder,
  type PermissionResponse,
  type RecorderState,
  type RecordingOptions,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { AppState, Linking } from 'react-native';

import { appConfig } from '../../config/app.config';
import { useAudioSession } from '../../services/audio';
import { useAnimalSounds } from '../atlas/AnimalSoundProvider';
import {
  createRecorderSessionId,
  logRecorderIntegrity,
  validateFinalizedRecording,
  waitForIntegrityTarget,
} from './recorder.integrity';
import type {
  RecorderIntegrityCheck,
  RecorderIntegrityResult,
  RecorderIntegrityTestKind,
  RecordingFileValidation,
} from './recorder.integrity.types';
import { useLiveTranscription } from './live';
import type { LiveTranscriptionState } from './live';
import {
  createTranscriptionTraceId,
  getBackendHost,
  logTranscriptionEvent,
  normalizeTranscriptionError,
  toTranscriptionFailureDetails,
  transcriptionErrorLogDetails,
  TranscriptionError,
} from './recording-transcription.errors';
import {
  deleteRecording as deleteStoredRecording,
  loadRecordings,
  persistVerifiedRecordingFile,
  renameRecording as renameStoredRecording,
  saveRecordingMetadata,
  updateRecordingTranscription,
} from './recorder.storage';
import { transcribeRecordingFile } from './recording-transcription.service';
import type {
  MicrophonePermissionState,
  RecorderPhase,
  SavedRecording,
} from './recorder.types';

interface RecorderContextValue {
  clearError: () => void;
  deleteRecording: (recordingId: string) => Promise<void>;
  durationMillis: number;
  errorMessage: string | null;
  integrityModeEnabled: boolean;
  integrityResults: RecorderIntegrityResult[];
  integrityTestRunning: Exclude<RecorderIntegrityTestKind, 'normal'> | null;
  isLoadingRecordings: boolean;
  isRecording: boolean;
  liveTranscription: LiveTranscriptionState;
  metering: number | null;
  openSettings: () => Promise<void>;
  permissionState: MicrophonePermissionState;
  phase: RecorderPhase;
  recordings: SavedRecording[];
  renameRecording: (recordingId: string, title: string) => Promise<void>;
  requestPermission: () => Promise<boolean>;
  runProductionIntegrityTest: () => Promise<void>;
  runRawIntegrityTest: () => Promise<void>;
  saveIntegrityResultToLibrary: (sessionId: string) => Promise<void>;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  transcribeRecording: (recordingId: string) => Promise<boolean>;
}

type OperationPhase = Exclude<RecorderPhase, 'recording'>;

interface ActiveRecordingSession {
  expectedDurationMillis: number | null;
  failed: boolean;
  nativeRecordingConfirmedAt: number | null;
  persistToLibrary: boolean;
  recorderId: string;
  sessionId: string;
  sourceUri: string | null;
  testKind: RecorderIntegrityTestKind;
}

const RecorderContext = createContext<RecorderContextValue | null>(null);

const RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document',
  isMeteringEnabled: true,
};

const INTEGRITY_MODE_ENABLED =
  __DEV__ && process.env.EXPO_PUBLIC_RECORDER_INTEGRITY_MODE === '1';
const INTEGRITY_TEST_DURATION_MS = 10_000;
const NATIVE_START_TIMEOUT_MS = 2_000;
const NATIVE_START_POLL_MS = 50;
// Expo Audio reports -120 dB before AVAudioRecorder has received an input frame.
// isRecording alone can still be true in that stalled native state on iOS.
const NATIVE_METERING_SENTINEL_DB = -120;
const START_ERROR = 'Atlas could not start recording. Please try again.';
const INTEGRITY_ERROR =
  'The recording file did not pass integrity validation. The diagnostic file was preserved.';
const INTERRUPTION_ERROR = 'The microphone session was interrupted. Start a new recording.';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

class RecordingLibraryPersistenceError extends Error {
  constructor(
    message: string,
    readonly destinationUri: string | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RecordingLibraryPersistenceError';
  }
}

const createExpectedDurationCheck = (
  expectedDurationMillis: number,
  playerDurationMillis: number | null,
): RecorderIntegrityCheck => {
  const toleranceMillis = Math.max(
    1_500,
    Math.round(expectedDurationMillis * 0.2),
  );
  const differenceMillis =
    playerDurationMillis === null
      ? null
      : Math.abs(playerDurationMillis - expectedDurationMillis);

  return {
    actual:
      differenceMillis === null
        ? 'Playable duration unavailable'
        : `${playerDurationMillis} ms (${differenceMillis} ms difference)`,
    expected: `${expectedDurationMillis} ms ± ${toleranceMillis} ms`,
    id: 'expected_duration_matches',
    label: 'Playable duration matches requested test duration',
    passed: differenceMillis !== null && differenceMillis <= toleranceMillis,
  };
};

const createOperationFailureCheck = (error: unknown): RecorderIntegrityCheck => ({
  actual: describeError(error),
  expected: 'Recording finalization completes without an exception',
  id: 'operation_completed',
  label: 'Recorder finalization operation completed',
  passed: false,
});

const toPermissionState = (
  permission: PermissionResponse,
): MicrophonePermissionState => {
  if (permission.granted) {
    return 'granted';
  }

  if (permission.status === PermissionStatus.UNDETERMINED) {
    return 'undetermined';
  }

  return permission.canAskAgain ? 'denied' : 'blocked';
};

const waitForNativeRecordingConfirmation = async (
  recorder: AudioRecorder,
  sessionId: string,
): Promise<{ sourceUri: string; status: RecorderState }> => {
  const startedAt = Date.now();
  let lastStatus = recorder.getStatus();

  while (Date.now() - startedAt <= NATIVE_START_TIMEOUT_MS) {
    const status = recorder.getStatus();
    const sourceUri = recorder.uri ?? status.url;
    lastStatus = status;

    if (
      recorder.isRecording &&
      status.isRecording &&
      status.canRecord &&
      sourceUri &&
      typeof status.metering === 'number' &&
      status.metering > NATIVE_METERING_SENTINEL_DB
    ) {
      return { sourceUri, status };
    }

    await waitForIntegrityTarget(NATIVE_START_POLL_MS);
  }

  throw new Error(
    `Native recording was not confirmed within ${NATIVE_START_TIMEOUT_MS}ms: ${JSON.stringify({
      nativeIsRecording: recorder.isRecording,
      recorderId: recorder.id,
      recorderUri: recorder.uri,
      status: lastStatus,
    })}`,
  );
};

export function RecorderProvider({ children }: PropsWithChildren) {
  const {
    finishMicrophoneRecording,
    prepareMicrophoneRecording,
    registerRecorderProbe,
    stopSavedRecordingPlayback,
  } = useAudioSession();
  const { disableAndStopSounds, enableSounds } = useAnimalSounds();
  const [operationPhase, setOperationPhase] = useState<OperationPhase>('idle');
  const [permissionState, setPermissionState] =
    useState<MicrophonePermissionState>('undetermined');
  const [recordings, setRecordings] = useState<SavedRecording[]>([]);
  const [isLoadingRecordings, setIsLoadingRecordings] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [nativeRecordingConfirmed, setNativeRecordingConfirmed] = useState(false);
  const [integrityResults, setIntegrityResults] = useState<RecorderIntegrityResult[]>([]);
  const [integrityTestRunning, setIntegrityTestRunning] = useState<
    Exclude<RecorderIntegrityTestKind, 'normal'> | null
  >(null);
  const operationInProgressRef = useRef(false);
  const nativeRecordingConfirmedRef = useRef(false);
  const activeSessionRef = useRef<ActiveRecordingSession | null>(null);
  const recorderStateRef = useRef<RecorderState | null>(null);
  const stoppedSessionIdsRef = useRef(new Set<string>());
  const transcriptionInFlightRef = useRef(new Set<string>());
  const integrityTestRunningRef = useRef<
    Exclude<RecorderIntegrityTestKind, 'normal'> | null
  >(null);

  const recorder = useAudioRecorder(RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 200);
  const {
    startLiveTranscription,
    state: liveTranscription,
    stopLiveTranscription,
  } = useLiveTranscription();

  useEffect(() => {
    recorderStateRef.current = recorderState;
  }, [recorderState]);

  useEffect(
    () =>
      registerRecorderProbe(() => ({
        nativeIsRecording: recorder.isRecording,
        recorderId: recorder.id,
        statusIsRecording: recorderStateRef.current?.isRecording ?? false,
      })),
    [recorder, registerRecorderProbe],
  );

  const restoreSoundPlayback = useCallback(
    async (sessionId: string | null, reason: string) => {
      try {
        const restored = await finishMicrophoneRecording({ reason, sessionId });

        if (restored) {
          enableSounds();
        }
      } catch (error) {
        console.warn('[Recorder] Could not restore playback audio mode.', {
          error: describeError(error),
          sessionId,
        });
      }
    },
    [enableSounds, finishMicrophoneRecording],
  );

  const stopNativeRecorderOnce = useCallback(
    async (session: ActiveRecordingSession): Promise<void> => {
      if (stoppedSessionIdsRef.current.has(session.sessionId)) {
        throw new Error(`Duplicate native Stop was rejected for ${session.sessionId}.`);
      }

      stoppedSessionIdsRef.current.add(session.sessionId);
      await recorder.stop();
    },
    [recorder],
  );

  const markSessionFailed = useCallback(
    (
      session: ActiveRecordingSession | null,
      error: unknown,
      userMessage: string,
      details: Record<string, unknown> = {},
    ) => {
      if (session) {
        session.failed = true;
      }

      logRecorderIntegrity(session?.sessionId ?? null, 'SESSION_FAILED', {
        ...details,
        error: describeError(error),
        nativeIsRecording: recorder.isRecording,
        recorderId: recorder.id,
        recorderStatus: recorder.getStatus(),
        recorderUri: recorder.uri,
      });
      setNativeRecordingConfirmed(false);
      nativeRecordingConfirmedRef.current = false;
      setErrorMessage(userMessage);
      setOperationPhase('error');
    },
    [recorder],
  );

  useEffect(() => {
    const session = activeSessionRef.current;

    if (
      session?.nativeRecordingConfirmedAt &&
      session.recorderId !== recorder.id &&
      !session.failed
    ) {
      markSessionFailed(
        session,
        new Error(
          `Recorder identity changed from ${session.recorderId} to ${recorder.id} while active.`,
        ),
        INTERRUPTION_ERROR,
        { previousRecorderId: session.recorderId },
      );
    }
  }, [markSessionFailed, recorder.id]);

  useEffect(() => {
    const session = activeSessionRef.current;

    if (
      session?.nativeRecordingConfirmedAt &&
      !session.failed &&
      !operationInProgressRef.current &&
      (!recorder.isRecording || !recorderState.isRecording)
    ) {
      stopLiveTranscription('authoritative_recorder_stopped', 'failed');
      markSessionFailed(
        session,
        new Error('The native recorder stopped before the explicit Stop operation.'),
        INTERRUPTION_ERROR,
        {
          nativeIsRecording: recorder.isRecording,
          observedStatus: recorderState,
        },
      );
      void restoreSoundPlayback(session.sessionId, 'unexpected_native_recorder_stop');
    }

    if (recorderState.mediaServicesDidReset && session && !session.failed) {
      stopLiveTranscription('media_services_reset', 'failed');
      markSessionFailed(
        session,
        new Error('iOS media services reset during recording.'),
        INTERRUPTION_ERROR,
        { observedStatus: recorderState },
      );
    }
  }, [
    markSessionFailed,
    recorder,
    recorderState,
    restoreSoundPlayback,
    stopLiveTranscription,
  ]);

  const refreshPermission = useCallback(async () => {
    try {
      const permission = await getRecordingPermissionsAsync();
      setPermissionState(toPermissionState(permission));
      return permission;
    } catch (error) {
      console.warn('[Recorder] Could not read microphone permission.', describeError(error));
      return null;
    }
  }, []);

  const requestPermission = useCallback(async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      setPermissionState(toPermissionState(permission));
      return permission.granted;
    } catch (error) {
      console.warn('[Recorder] Microphone permission request failed.', describeError(error));
      setErrorMessage('Microphone permission could not be requested.');
      return false;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    loadRecordings()
      .then((savedRecordings) => {
        if (isMounted) {
          setRecordings(savedRecordings);
        }
      })
      .catch((error: unknown) => {
        console.warn('[Recorder] Could not load saved recordings.', describeError(error));
        if (isMounted) {
          setErrorMessage('Saved recordings could not be loaded.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoadingRecordings(false);
        }
      });

    const permissionRefreshTimeout = setTimeout(() => {
      void refreshPermission();
    }, 0);

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const session = activeSessionRef.current;

      if (session?.nativeRecordingConfirmedAt) {
        logRecorderIntegrity(
          session.sessionId,
          nextState === 'active' ? 'APP_FOREGROUND' : 'APP_BACKGROUND',
          {
            nativeIsRecording: recorder.isRecording,
            recorderId: recorder.id,
            recorderStatus: recorder.getStatus(),
          },
        );
      }

      if (nextState === 'active') {
        void refreshPermission();
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(permissionRefreshTimeout);
      appStateSubscription.remove();
    };
  }, [recorder, refreshPermission]);

  const ensurePermission = useCallback(async (): Promise<boolean> => {
    let permission = await refreshPermission();

    if (
      permission &&
      !permission.granted &&
      permission.status === PermissionStatus.UNDETERMINED &&
      permission.canAskAgain
    ) {
      await requestPermission();
      permission = await refreshPermission();
    }

    if (permission?.granted) {
      return true;
    }

    const currentPermissionState = permission
      ? toPermissionState(permission)
      : permissionState;
    setPermissionState(currentPermissionState);
    setErrorMessage(
      currentPermissionState === 'blocked'
        ? 'Microphone access is blocked. Enable it in device settings.'
        : 'Microphone access is required before Atlas can record.',
    );
    setOperationPhase('error');
    return false;
  }, [permissionState, refreshPermission, requestPermission]);

  const performStartRecording = useCallback(
    async ({
      expectedDurationMillis,
      persistToLibrary,
      testKind,
    }: {
      expectedDurationMillis: number | null;
      persistToLibrary: boolean;
      testKind: RecorderIntegrityTestKind;
    }): Promise<ActiveRecordingSession | null> => {
      if (
        nativeRecordingConfirmedRef.current ||
        recorder.isRecording ||
        operationInProgressRef.current
      ) {
        return null;
      }

      operationInProgressRef.current = true;
      setOperationPhase('starting');
      setErrorMessage(null);
      const session: ActiveRecordingSession = {
        expectedDurationMillis,
        failed: false,
        nativeRecordingConfirmedAt: null,
        persistToLibrary,
        recorderId: recorder.id,
        sessionId: createRecorderSessionId(),
        sourceUri: null,
        testKind,
      };
      activeSessionRef.current = session;
      logRecorderIntegrity(session.sessionId, 'SESSION_CREATED', {
        expectedDurationMillis,
        persistToLibrary,
        recorderId: recorder.id,
        recorderOptions: RECORDING_OPTIONS,
        testKind,
      });

      try {
        if (!(await ensurePermission())) {
          activeSessionRef.current = null;
          return null;
        }

        await disableAndStopSounds();
        logRecorderIntegrity(session.sessionId, 'AUDIO_MODE_RECORDING_REQUESTED', {
          recorderId: recorder.id,
        });
        const audioSessionReady = await prepareMicrophoneRecording({
          reason: 'recorder_start',
          sessionId: session.sessionId,
        });

        if (!audioSessionReady) {
          throw new Error('The microphone audio session request became stale.');
        }

        logRecorderIntegrity(session.sessionId, 'AUDIO_MODE_RECORDING_READY', {
          nativeIsRecording: recorder.isRecording,
          recorderId: recorder.id,
          recorderStatus: recorder.getStatus(),
        });
        logRecorderIntegrity(session.sessionId, 'PREPARE_STARTED', {
          recorderId: recorder.id,
          recorderStatus: recorder.getStatus(),
          recorderUri: recorder.uri,
        });
        await recorder.prepareToRecordAsync(RECORDING_OPTIONS);
        const preparedStatus = recorder.getStatus();
        logRecorderIntegrity(session.sessionId, 'PREPARE_FINISHED', {
          nativeIsRecording: recorder.isRecording,
          recorderId: recorder.id,
          recorderStatus: preparedStatus,
          recorderUri: recorder.uri,
        });

        if (recorder.id !== session.recorderId) {
          throw new Error(
            `Recorder identity changed during prepare: ${session.recorderId} -> ${recorder.id}.`,
          );
        }

        recorder.record();
        logRecorderIntegrity(session.sessionId, 'RECORD_CALLED', {
          nativeIsRecording: recorder.isRecording,
          recorderId: recorder.id,
          recorderStatus: recorder.getStatus(),
          recorderUri: recorder.uri,
        });
        const confirmation = await waitForNativeRecordingConfirmation(
          recorder,
          session.sessionId,
        );
        session.nativeRecordingConfirmedAt = Date.now();
        session.sourceUri = confirmation.sourceUri;
        nativeRecordingConfirmedRef.current = true;
        setNativeRecordingConfirmed(true);
        setOperationPhase('idle');
        logRecorderIntegrity(session.sessionId, 'NATIVE_RECORDING_CONFIRMED', {
          nativeIsRecording: recorder.isRecording,
          nativeRecordingConfirmedAt: session.nativeRecordingConfirmedAt,
          recorderId: recorder.id,
          recorderStatus: confirmation.status,
          sourceUri: confirmation.sourceUri,
        });

        if (testKind === 'normal') {
          void startLiveTranscription({ recorderSessionId: session.sessionId });
        }

        return session;
      } catch (error) {
        markSessionFailed(session, error, START_ERROR);

        if (recorder.isRecording) {
          try {
            await stopNativeRecorderOnce(session);
          } catch (stopError) {
            logRecorderIntegrity(session.sessionId, 'SESSION_FAILED', {
              cleanupStopError: describeError(stopError),
              error: describeError(error),
            });
          }
        }

        if (!recorder.isRecording) {
          await restoreSoundPlayback(session.sessionId, 'recorder_start_failed');
        }

        return null;
      } finally {
        operationInProgressRef.current = false;
      }
    },
    [
      disableAndStopSounds,
      ensurePermission,
      markSessionFailed,
      prepareMicrophoneRecording,
      recorder,
      restoreSoundPlayback,
      startLiveTranscription,
      stopNativeRecorderOnce,
    ],
  );

  const replaceRecording = useCallback((updatedRecording: SavedRecording) => {
    setRecordings((current) =>
      current.map((recording) =>
        recording.id === updatedRecording.id ? updatedRecording : recording,
      ),
    );
  }, []);

  const transcribeSavedRecording = useCallback(
    async (recording: SavedRecording): Promise<boolean> => {
      if (
        transcriptionInFlightRef.current.has(recording.id) ||
        recording.transcriptionStatus === 'transcribing'
      ) {
        return false;
      }

      if (recording.transcriptionStatus === 'complete') {
        return true;
      }

      const traceId = createTranscriptionTraceId();
      const startedAt = Date.now();
      const backendHost = getBackendHost(appConfig.apiUrl);
      transcriptionInFlightRef.current.add(recording.id);
      let transcribingStatusPersisted = false;
      logTranscriptionEvent('info', 'TRANSCRIPTION_REQUESTED', traceId, {
        backendHost,
        previousTraceId: recording.transcriptionTraceId,
        recordingId: recording.id,
      });

      try {
        let transcribingRecording: SavedRecording;

        try {
          transcribingRecording = await updateRecordingTranscription(
            recording.id,
            'transcribing',
            null,
            traceId,
          );
        } catch (error) {
          throw new TranscriptionError(
            {
              code: 'LOCAL_PERSISTENCE_FAILED',
              stage: 'recording_metadata_persisted',
              traceId,
            },
            {
              backendHost,
              cause: error,
              developerMessage:
                error instanceof Error ? error.message : String(error),
              requestDurationMs: Date.now() - startedAt,
            },
          );
        }

        transcribingStatusPersisted = true;
        replaceRecording(transcribingRecording);
        logTranscriptionEvent('info', 'TRANSCRIPTION_STATE_PERSISTED', traceId, {
          recordingId: recording.id,
          status: 'transcribing',
        });

        const result = await transcribeRecordingFile(
          transcribingRecording,
          traceId,
        );
        let completedRecording: SavedRecording;

        try {
          completedRecording = await updateRecordingTranscription(
            recording.id,
            'complete',
            result.text,
            traceId,
          );
        } catch (error) {
          throw new TranscriptionError(
            {
              code: 'LOCAL_PERSISTENCE_FAILED',
              stage: 'recording_metadata_persisted',
              traceId,
            },
            {
              backendHost,
              cause: error,
              developerMessage:
                error instanceof Error ? error.message : String(error),
              requestDurationMs: Date.now() - startedAt,
            },
          );
        }

        replaceRecording(completedRecording);
        logTranscriptionEvent('info', 'RECORDING_METADATA_PERSISTED', traceId, {
          recordingId: recording.id,
          status: 'complete',
        });
        logTranscriptionEvent('info', 'REQUEST_COMPLETED', traceId, {
          backendHost,
          recordingId: recording.id,
          requestDurationMs: Date.now() - startedAt,
        });
        return true;
      } catch (error) {
        const transcriptionError = normalizeTranscriptionError(
          error,
          { stage: 'request_failed', traceId },
          { backendHost, requestDurationMs: Date.now() - startedAt },
        );
        let terminalError = transcriptionError;

        if (transcribingStatusPersisted) {
          try {
            const failedRecording = await updateRecordingTranscription(
              recording.id,
              'failed',
              null,
              traceId,
              toTranscriptionFailureDetails(transcriptionError),
            );
            replaceRecording(failedRecording);
            logTranscriptionEvent(
              'warn',
              'RECORDING_METADATA_PERSISTED',
              traceId,
              {
                code: transcriptionError.code,
                recordingId: recording.id,
                status: 'failed',
              },
            );
          } catch (metadataError) {
            terminalError = new TranscriptionError(
              {
                code: 'LOCAL_PERSISTENCE_FAILED',
                stage: 'recording_metadata_persisted',
                traceId,
              },
              {
                backendHost,
                cause: metadataError,
                developerMessage:
                  metadataError instanceof Error
                    ? metadataError.message
                    : String(metadataError),
                requestDurationMs: Date.now() - startedAt,
              },
            );
          }
        }

        if (!transcribingStatusPersisted || terminalError !== transcriptionError) {
          replaceRecording({
            ...recording,
            latestTranscriptionFailure:
              toTranscriptionFailureDetails(terminalError),
            transcript: null,
            transcriptionStatus: 'failed',
            transcriptionTraceId: traceId,
          });
        }

        logTranscriptionEvent('error', 'REQUEST_FAILED', traceId, {
          ...transcriptionErrorLogDetails(terminalError),
          causeCode:
            terminalError === transcriptionError
              ? null
              : transcriptionError.code,
          recordingId: recording.id,
        });

        return false;
      } finally {
        transcriptionInFlightRef.current.delete(recording.id);
      }
    },
    [replaceRecording],
  );

  const appendIntegrityResult = useCallback((result: RecorderIntegrityResult) => {
    setIntegrityResults((current) => [
      result,
      ...current.filter((item) => item.sessionId !== result.sessionId),
    ]);
  }, []);

  const persistRecordingToLibrary = useCallback(
    async (
      sessionId: string,
      sourceValidation: RecordingFileValidation,
      allowPlayableDiagnostic = false,
    ) => {
      const persisted = await persistVerifiedRecordingFile(
        sessionId,
        sourceValidation,
        { allowPlayableDiagnostic },
      );

      try {
        await saveRecordingMetadata(persisted.recording);
      } catch (error) {
        throw new RecordingLibraryPersistenceError(
          'The audio reached the recording library, but recordings.json could not be updated.',
          persisted.destinationValidation.uri,
          { cause: error },
        );
      }

      logRecorderIntegrity(sessionId, 'METADATA_SAVED', {
        durationMillis: persisted.recording.durationMillis,
        recordingId: persisted.recording.id,
        uri: persisted.recording.uri,
      });
      setRecordings((current) => [
        persisted.recording,
        ...current.filter((item) => item.id !== persisted.recording.id),
      ]);
      return persisted;
    },
    [],
  );

  const performStopRecording = useCallback(async (): Promise<RecorderIntegrityResult | null> => {
    const session = activeSessionRef.current;

    if (
      !session ||
      !session.nativeRecordingConfirmedAt ||
      operationInProgressRef.current
    ) {
      return null;
    }

    operationInProgressRef.current = true;
    setOperationPhase('stopping');
    setErrorMessage(null);
    stopLiveTranscription('recording_stop_requested');
    logRecorderIntegrity(session.sessionId, 'STOP_REQUESTED', {
      nativeIsRecording: recorder.isRecording,
      recorderId: recorder.id,
    });

    const statusBeforeStop = recorder.getStatus();
    const recorderUriBeforeStop = recorder.uri;
    const statusUrlBeforeStop = statusBeforeStop.url;
    logRecorderIntegrity(session.sessionId, 'STATUS_BEFORE_STOP', {
      nativeIsRecording: recorder.isRecording,
      recorderId: recorder.id,
      recorderUri: recorderUriBeforeStop,
      status: statusBeforeStop,
      statusUrl: statusUrlBeforeStop,
    });

    let result: RecorderIntegrityResult = {
      checks: [],
      destinationUri: null,
      error: null,
      expectedDurationMillis: session.expectedDurationMillis,
      failedChecks: [],
      fileSize: null,
      isPlayable: false,
      libraryRecordingId: null,
      nativeDurationAfterStopMillis: null,
      nativeDurationBeforeStopMillis: statusBeforeStop.durationMillis,
      passed: false,
      playerDurationMillis: null,
      recorderId: session.recorderId,
      sessionId: session.sessionId,
      sourceUri: recorderUriBeforeStop ?? statusUrlBeforeStop,
      sourceValidation: null,
      testKind: session.testKind,
    };
    let savedRecordingForTranscription: SavedRecording | null = null;

    try {
      await stopNativeRecorderOnce(session);
      logRecorderIntegrity(session.sessionId, 'STOP_FINISHED', {
        nativeIsRecording: recorder.isRecording,
        recorderId: recorder.id,
      });
      const statusAfterStop = recorder.getStatus();
      const recorderUriAfterStop = recorder.uri;
      const statusUrlAfterStop = statusAfterStop.url;
      result = {
        ...result,
        nativeDurationAfterStopMillis: statusAfterStop.durationMillis,
      };
      logRecorderIntegrity(session.sessionId, 'STATUS_AFTER_STOP', {
        nativeIsRecording: recorder.isRecording,
        recorderId: recorder.id,
        recorderUri: recorderUriAfterStop,
        recorderUriChanged: recorderUriAfterStop !== recorderUriBeforeStop,
        status: statusAfterStop,
        statusUrl: statusUrlAfterStop,
        statusUrlChanged: statusUrlAfterStop !== statusUrlBeforeStop,
      });

      const candidateUris = Array.from(
        new Set(
          [
            recorderUriBeforeStop,
            statusUrlBeforeStop,
            recorderUriAfterStop,
            statusUrlAfterStop,
          ].filter((uri): uri is string => Boolean(uri)),
        ),
      );

      if (candidateUris.length === 0) {
        throw new Error('The recorder returned no source URI before or after Stop.');
      }

      const validations: RecordingFileValidation[] = [];

      for (const uri of candidateUris) {
        validations.push(
          await validateFinalizedRecording(
            session.sessionId,
            uri,
            statusBeforeStop.durationMillis,
          ),
        );
      }

      if (candidateUris.length > 1) {
        throw new Error(
          `The native recording URI changed during Stop. All candidates were preserved: ${JSON.stringify({
            candidateUris,
            validations,
          })}`,
        );
      }

      const sourceValidation = validations[0];

      if (!sourceValidation) {
        throw new Error('The native recording file could not be validated.');
      }

      const expectedDurationCheck =
        session.expectedDurationMillis === null
          ? null
          : createExpectedDurationCheck(
              session.expectedDurationMillis,
              sourceValidation.playerDurationMillis,
            );
      const sourceChecks = expectedDurationCheck
        ? [...sourceValidation.checks, expectedDurationCheck]
        : sourceValidation.checks;
      const sourceFailedChecks = sourceChecks.filter((check) => !check.passed);

      result = {
        ...result,
        checks: sourceChecks,
        error:
          sourceFailedChecks.length > 0
            ? sourceFailedChecks.map((check) => check.label).join('; ')
            : null,
        failedChecks: sourceFailedChecks,
        fileSize: sourceValidation.fileSize,
        isPlayable: sourceValidation.isPlayable,
        passed: sourceFailedChecks.length === 0,
        playerDurationMillis: sourceValidation.playerDurationMillis,
        sourceUri: sourceValidation.uri,
        sourceValidation,
      };

      if (!sourceValidation.passed) {
        appendIntegrityResult(result);
        console.warn('[RecorderIntegrity] Source validation failed.', result);
        setNativeRecordingConfirmed(false);
        nativeRecordingConfirmedRef.current = false;
        activeSessionRef.current = null;
        await restoreSoundPlayback(session.sessionId, 'recording_validation_failed');

        if (session.testKind === 'normal') {
          setErrorMessage(INTEGRITY_ERROR);
          setOperationPhase('error');
        } else {
          setOperationPhase('idle');
        }

        return result;
      }

      if (session.persistToLibrary) {
        const persisted = await persistRecordingToLibrary(
          session.sessionId,
          sourceValidation,
        );
        const persistenceChecks: RecorderIntegrityCheck[] = [
          ...persisted.destinationValidation.checks.filter(
            (check) =>
              check.id === 'destination_size_matches' ||
              check.id === 'destination_duration_matches',
          ),
          {
            actual: persisted.recording.uri,
            expected: 'Recording is present in recordings.json',
            id: 'metadata_saved',
            label: 'Recording metadata was saved',
            passed: true,
          },
        ];
        const checks = [...result.checks, ...persistenceChecks];
        result = {
          ...result,
          checks,
          destinationUri: persisted.recording.uri,
          failedChecks: checks.filter((check) => !check.passed),
          libraryRecordingId: persisted.recording.id,
          passed: checks.every((check) => check.passed),
        };
        savedRecordingForTranscription = persisted.recording;
      }

      if (!result.passed) {
        result = {
          ...result,
          error: result.failedChecks.map((check) => check.label).join('; '),
        };
        console.warn('[RecorderIntegrity] Test completed with failed checks.', result);
      }

      appendIntegrityResult(result);
      setNativeRecordingConfirmed(false);
      nativeRecordingConfirmedRef.current = false;
      activeSessionRef.current = null;
      await restoreSoundPlayback(session.sessionId, 'recording_validated');
      setOperationPhase('idle');

      if (
        session.testKind === 'normal' &&
        savedRecordingForTranscription
      ) {
        void transcribeSavedRecording(savedRecordingForTranscription);
      }

      return result;
    } catch (error) {
      const operationCheck = createOperationFailureCheck(error);
      const checks = [...result.checks, operationCheck];
      result = {
        ...result,
        checks,
        destinationUri:
          error instanceof RecordingLibraryPersistenceError
            ? error.destinationUri
            : result.destinationUri,
        error: describeError(error),
        failedChecks: checks.filter((check) => !check.passed),
        passed: false,
      };
      appendIntegrityResult(result);
      console.warn('[RecorderIntegrity] Recording finalization failed.', result);

      if (!recorder.isRecording) {
        setNativeRecordingConfirmed(false);
        nativeRecordingConfirmedRef.current = false;
        activeSessionRef.current = null;
        await restoreSoundPlayback(session.sessionId, 'recording_integrity_failed');
      }

      if (session.testKind === 'normal' || recorder.isRecording) {
        markSessionFailed(session, error, INTEGRITY_ERROR, { result });
      } else {
        setOperationPhase('idle');
      }

      return result;
    } finally {
      operationInProgressRef.current = false;
    }
  }, [
    appendIntegrityResult,
    markSessionFailed,
    persistRecordingToLibrary,
    recorder,
    restoreSoundPlayback,
    stopNativeRecorderOnce,
    stopLiveTranscription,
    transcribeSavedRecording,
  ]);

  const startRecording = useCallback(async () => {
    if (integrityTestRunningRef.current) {
      return;
    }

    await performStartRecording({
      expectedDurationMillis: null,
      persistToLibrary: true,
      testKind: 'normal',
    });
  }, [performStartRecording]);

  const stopRecording = useCallback(async () => {
    if (integrityTestRunningRef.current) {
      return;
    }

    await performStopRecording();
  }, [performStopRecording]);

  const runIntegrityTest = useCallback(async (
    testKind: Exclude<RecorderIntegrityTestKind, 'normal'>,
  ) => {
    if (!INTEGRITY_MODE_ENABLED || integrityTestRunningRef.current) {
      return;
    }

    integrityTestRunningRef.current = testKind;
    setIntegrityTestRunning(testKind);
    setErrorMessage(null);

    try {
      const session = await performStartRecording({
        expectedDurationMillis: INTEGRITY_TEST_DURATION_MS,
        persistToLibrary: testKind === 'production',
        testKind,
      });

      if (!session) {
        console.warn(`[RecorderIntegrity] Could not start the ${testKind} test.`);
        return;
      }

      await waitForIntegrityTarget(INTEGRITY_TEST_DURATION_MS);
      await performStopRecording();
    } catch (error) {
      console.warn('[RecorderIntegrity] Development test stopped.', {
        error: describeError(error),
        testKind,
      });
    } finally {
      integrityTestRunningRef.current = null;
      setIntegrityTestRunning(null);
    }
  }, [performStartRecording, performStopRecording]);

  const runRawIntegrityTest = useCallback(
    async () => runIntegrityTest('raw'),
    [runIntegrityTest],
  );

  const runProductionIntegrityTest = useCallback(
    async () => runIntegrityTest('production'),
    [runIntegrityTest],
  );

  const saveIntegrityResultToLibrary = useCallback(
    async (sessionId: string) => {
      if (
        !INTEGRITY_MODE_ENABLED ||
        integrityTestRunningRef.current ||
        operationInProgressRef.current
      ) {
        return;
      }

      const result = integrityResults.find((item) => item.sessionId === sessionId);

      if (
        !result?.sourceValidation?.isPlayable ||
        result.libraryRecordingId
      ) {
        return;
      }

      operationInProgressRef.current = true;

      try {
        const persisted = await persistRecordingToLibrary(
          result.sessionId,
          result.sourceValidation,
          true,
        );
        const persistenceChecks: RecorderIntegrityCheck[] = [
          ...persisted.destinationValidation.checks.filter(
            (check) =>
              check.id === 'destination_size_matches' ||
              check.id === 'destination_duration_matches',
          ),
          {
            actual: persisted.recording.uri,
            expected: 'Recording is present in recordings.json',
            id: 'metadata_saved',
            label: 'Recording metadata was saved',
            passed: true,
          },
        ];
        const sourceChecks = result.checks.filter(
          (check) =>
            check.id !== 'destination_size_matches' &&
            check.id !== 'destination_duration_matches' &&
            check.id !== 'metadata_saved' &&
            check.id !== 'operation_completed',
        );
        const checks = [...sourceChecks, ...persistenceChecks];
        const failedChecks = checks.filter((check) => !check.passed);
        appendIntegrityResult({
          ...result,
          checks,
          destinationUri: persisted.recording.uri,
          error:
            failedChecks.length > 0
              ? failedChecks.map((check) => check.label).join('; ')
              : null,
          failedChecks,
          libraryRecordingId: persisted.recording.id,
          passed: failedChecks.length === 0,
        });
      } catch (error) {
        const operationCheck = createOperationFailureCheck(error);
        appendIntegrityResult({
          ...result,
          checks: [...result.checks, operationCheck],
          destinationUri:
            error instanceof RecordingLibraryPersistenceError
              ? error.destinationUri
              : result.destinationUri,
          error: describeError(error),
          failedChecks: [...result.failedChecks, operationCheck],
          passed: false,
        });
        console.warn('[RecorderIntegrity] Could not save diagnostic recording.', {
          error: describeError(error),
          sessionId,
        });
      } finally {
        operationInProgressRef.current = false;
      }
    },
    [appendIntegrityResult, integrityResults, persistRecordingToLibrary],
  );

  const transcribeRecording = useCallback(
    async (recordingId: string): Promise<boolean> => {
      const recording = recordings.find((item) => item.id === recordingId);

      if (!recording) {
        throw new Error('The recording could not be found for transcription.');
      }

      return transcribeSavedRecording(recording);
    },
    [recordings, transcribeSavedRecording],
  );

  const renameRecording = useCallback(
    async (recordingId: string, title: string) => {
      try {
        const renamedRecording = await renameStoredRecording(recordingId, title);
        setRecordings((current) =>
          current.map((recording) =>
            recording.id === recordingId ? renamedRecording : recording,
          ),
        );
      } catch (error) {
        console.warn('[Recorder] Recording rename failed.', describeError(error));
        throw error;
      }
    },
    [],
  );

  const deleteRecording = useCallback(
    async (recordingId: string) => {
      const recording = recordings.find((item) => item.id === recordingId);

      if (!recording) {
        throw new Error('The recording could not be found in the local library.');
      }

      await stopSavedRecordingPlayback();

      try {
        await deleteStoredRecording(recording);
        setRecordings((current) =>
          current.filter((item) => item.id !== recordingId),
        );
      } catch (error) {
        console.warn('[Recorder] Recording deletion failed.', describeError(error));
        throw error;
      }
    },
    [recordings, stopSavedRecordingPlayback],
  );

  const phase: RecorderPhase = operationPhase === 'error'
    ? 'error'
    : operationPhase === 'starting' || operationPhase === 'stopping'
      ? operationPhase
      : nativeRecordingConfirmed
        ? 'recording'
        : recorderState.mediaServicesDidReset
          ? 'error'
          : 'idle';

  const value = useMemo<RecorderContextValue>(
    () => ({
      clearError: () => {
        setErrorMessage(null);
        setOperationPhase('idle');
      },
      deleteRecording,
      durationMillis: nativeRecordingConfirmed ? recorderState.durationMillis : 0,
      errorMessage:
        recorderState.mediaServicesDidReset ? INTERRUPTION_ERROR : errorMessage,
      integrityModeEnabled: INTEGRITY_MODE_ENABLED,
      integrityResults,
      integrityTestRunning,
      isLoadingRecordings,
      isRecording: nativeRecordingConfirmed,
      liveTranscription,
      metering: nativeRecordingConfirmed ? (recorderState.metering ?? null) : null,
      openSettings: Linking.openSettings,
      permissionState,
      phase,
      recordings,
      renameRecording,
      requestPermission,
      runProductionIntegrityTest,
      runRawIntegrityTest,
      saveIntegrityResultToLibrary,
      startRecording,
      stopRecording,
      transcribeRecording,
    }),
    [
      deleteRecording,
      errorMessage,
      integrityResults,
      integrityTestRunning,
      isLoadingRecordings,
      liveTranscription,
      nativeRecordingConfirmed,
      permissionState,
      phase,
      recorderState.durationMillis,
      recorderState.mediaServicesDidReset,
      recorderState.metering,
      recordings,
      renameRecording,
      requestPermission,
      runProductionIntegrityTest,
      runRawIntegrityTest,
      saveIntegrityResultToLibrary,
      startRecording,
      stopRecording,
      transcribeRecording,
    ],
  );

  return <RecorderContext.Provider value={value}>{children}</RecorderContext.Provider>;
}

export function useRecorder(): RecorderContextValue {
  const context = useContext(RecorderContext);

  if (!context) {
    throw new Error('useRecorder must be used within a RecorderProvider.');
  }

  return context;
}
