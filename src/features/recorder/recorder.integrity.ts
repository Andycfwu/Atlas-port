import { createAudioPlayer } from 'expo-audio';
import { File } from 'expo-file-system';

import type {
  RecorderIntegrityCheck,
  RecorderIntegrityEvent,
  RecordingFileObservation,
  RecordingFileValidation,
} from './recorder.integrity.types';

const FILE_POLL_INTERVAL_MS = 200;
const FILE_STABILITY_TIMEOUT_MS = 6_000;
const PLAYER_LOAD_TIMEOUT_MS = 6_000;
const REQUIRED_STABLE_OBSERVATIONS = 3;
export const MIN_RECORDING_BYTES = 1_024;

const delay = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

class RecordingFileStabilityError extends Error {
  constructor(
    message: string,
    readonly observation: RecordingFileObservation,
  ) {
    super(message);
    this.name = 'RecordingFileStabilityError';
  }
}

export const createRecorderSessionId = (): string => {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `rec-${Date.now().toString(36)}-${suffix}`;
};

export const logRecorderIntegrity = (
  sessionId: string | null,
  event: RecorderIntegrityEvent,
  details: Record<string, unknown> = {},
): void => {
  if (__DEV__) {
    console.info('[RecorderIntegrity]', {
      event,
      sessionId,
      timestamp: new Date().toISOString(),
      ...details,
    });
  }
};

export const waitForStableRecordingFile = async (
  sessionId: string,
  uri: string,
): Promise<RecordingFileObservation> => {
  const file = new File(uri);
  const startedAt = Date.now();
  let previousSize: number | null = null;
  let previousModificationTime: number | null = null;
  let stableObservationCount = 0;
  let pollNumber = 0;
  let latestObservation: RecordingFileObservation = {
    exists: false,
    modificationTime: null,
    pollNumber: 0,
    size: 0,
    uri,
  };

  while (Date.now() - startedAt <= FILE_STABILITY_TIMEOUT_MS) {
    pollNumber += 1;
    const exists = file.exists;
    const info = exists ? file.info() : null;
    const size = info?.size ?? 0;
    const modificationTime = info?.modificationTime ?? null;

    latestObservation = {
      exists,
      modificationTime,
      pollNumber,
      size,
      uri,
    };

    logRecorderIntegrity(sessionId, 'FILE_SIZE_POLL', { ...latestObservation });

    if (
      exists &&
      size > 0 &&
      size === previousSize &&
      modificationTime === previousModificationTime
    ) {
      stableObservationCount += 1;
    } else {
      stableObservationCount = exists && size > 0 ? 1 : 0;
    }

    if (stableObservationCount >= REQUIRED_STABLE_OBSERVATIONS) {
      logRecorderIntegrity(sessionId, 'FILE_STABLE', {
        ...latestObservation,
        stableObservationCount,
      });
      return latestObservation;
    }

    previousSize = size;
    previousModificationTime = modificationTime;
    await delay(FILE_POLL_INTERVAL_MS);
  }

  throw new RecordingFileStabilityError(
    `Recording file did not stabilize within ${FILE_STABILITY_TIMEOUT_MS}ms: ${JSON.stringify(latestObservation)}`,
    latestObservation,
  );
};

export const loadRecordingDuration = async (
  sessionId: string,
  uri: string,
): Promise<number> => {
  const player = createAudioPlayer({ uri }, { updateInterval: 50 });
  const startedAt = Date.now();

  try {
    while (Date.now() - startedAt <= PLAYER_LOAD_TIMEOUT_MS) {
      const status = player.currentStatus;

      if (status.error) {
        throw new Error(status.error);
      }

      if (status.isLoaded) {
        const durationMillis = Number.isFinite(status.duration)
          ? Math.round(status.duration * 1_000)
          : 0;

        logRecorderIntegrity(sessionId, 'FILE_LOADED_FOR_VALIDATION', {
          durationMillis,
          playerId: player.id,
          status,
          uri,
        });

        if (durationMillis <= 0) {
          throw new Error('The finalized recording loaded with no playable duration.');
        }

        return durationMillis;
      }

      await delay(50);
    }

    throw new Error(`Recording player did not load within ${PLAYER_LOAD_TIMEOUT_MS}ms.`);
  } finally {
    player.release();
  }
};

export const validateFinalizedRecording = async (
  sessionId: string,
  uri: string,
  nativeDurationMillis: number,
): Promise<RecordingFileValidation> => {
  const durationToleranceMillis = Math.max(
    1_000,
    Math.round(nativeDurationMillis * 0.15),
  );
  let stableFile: RecordingFileObservation | null = null;
  let latestFile: RecordingFileObservation | null = null;
  let playerDurationMillis: number | null = null;
  let validationError: string | null = null;

  try {
    stableFile = await waitForStableRecordingFile(sessionId, uri);
    latestFile = stableFile;
  } catch (error) {
    if (error instanceof RecordingFileStabilityError) {
      latestFile = error.observation;
    }

    validationError = error instanceof Error ? error.message : String(error);
  }

  if (stableFile) {
    try {
      playerDurationMillis = await loadRecordingDuration(sessionId, uri);
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
    }
  }

  const durationDifferenceMillis =
    playerDurationMillis === null
      ? null
      : Math.abs(playerDurationMillis - nativeDurationMillis);
  const checks: RecorderIntegrityCheck[] = [
    {
      actual: stableFile
        ? `${stableFile.size} bytes; stable at poll ${stableFile.pollNumber}`
        : (validationError ?? 'No stable file observation'),
      expected: 'File exists and size/modification time remain unchanged for three polls',
      id: 'file_is_stable',
      label: 'Native file finalized and stabilized',
      passed: stableFile !== null,
    },
    {
      actual: latestFile ? `${latestFile.size} bytes` : 'Unavailable',
      expected: `At least ${MIN_RECORDING_BYTES} bytes`,
      id: 'file_meets_minimum_size',
      label: 'Native file has a plausible size',
      passed: (latestFile?.size ?? 0) >= MIN_RECORDING_BYTES,
    },
    {
      actual: `${nativeDurationMillis} ms`,
      expected: 'Greater than 0 ms',
      id: 'native_duration_is_positive',
      label: 'Native pre-Stop duration is positive',
      passed: nativeDurationMillis > 0,
    },
    {
      actual:
        playerDurationMillis === null
          ? (validationError ?? 'Player duration unavailable')
          : `${playerDurationMillis} ms`,
      expected: 'Expo Audio loads the exact native URI',
      id: 'player_loaded',
      label: 'Finalized file loads in Expo Audio',
      passed: playerDurationMillis !== null,
    },
    {
      actual:
        playerDurationMillis === null ? 'Unavailable' : `${playerDurationMillis} ms`,
      expected: 'Greater than 0 ms',
      id: 'player_duration_is_positive',
      label: 'Playable file duration is positive',
      passed: (playerDurationMillis ?? 0) > 0,
    },
    {
      actual:
        durationDifferenceMillis === null
          ? 'Unavailable'
          : `${durationDifferenceMillis} ms difference`,
      expected: `Difference no greater than ${durationToleranceMillis} ms`,
      id: 'native_matches_playable_duration',
      label: 'Native and playable durations agree',
      passed:
        durationDifferenceMillis !== null &&
        durationDifferenceMillis <= durationToleranceMillis,
    },
  ];
  const failedChecks = checks.filter((check) => !check.passed);
  const isPlayable =
    stableFile !== null &&
    stableFile.size >= MIN_RECORDING_BYTES &&
    (playerDurationMillis ?? 0) > 0;
  const passed = failedChecks.length === 0;

  const validation: RecordingFileValidation = {
    checks,
    durationDifferenceMillis,
    durationToleranceMillis,
    error: validationError,
    failedChecks,
    fileSize: latestFile?.size ?? null,
    isPlayable,
    modificationTime: latestFile?.modificationTime ?? null,
    nativeDurationMillis,
    passed,
    playerDurationMillis,
    uri,
  };

  logRecorderIntegrity(sessionId, 'DURATION_VALIDATED', { ...validation });
  return validation;
};

export const waitForIntegrityTarget = delay;
