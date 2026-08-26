import { Directory, File, Paths } from 'expo-file-system';

import {
  createRecordingId,
  createRecordingTitle,
  sortRecordingsNewestFirst,
} from './recorder.service';
import {
  logRecorderIntegrity,
  validateFinalizedRecording,
  waitForStableRecordingFile,
} from './recorder.integrity';
import type { RecordingFileValidation } from './recorder.integrity.types';
import type {
  SavedRecording,
  TranscriptionStatus,
} from './recorder.types';

const RECORDINGS_DIRECTORY_NAME = 'recordings';
const METADATA_FILENAME = 'recordings.json';
const TRANSCRIPTION_STATUSES = new Set<TranscriptionStatus>([
  'none',
  'transcribing',
  'complete',
  'failed',
]);

const getRecordingsDirectory = (): Directory =>
  new Directory(Paths.document, RECORDINGS_DIRECTORY_NAME);

const ensureRecordingsDirectory = (): Directory => {
  const directory = getRecordingsDirectory();
  directory.create({ idempotent: true, intermediates: true });
  return directory;
};

export class RecordingDeletionError extends Error {
  constructor(
    message: string,
    readonly audioFileDeleted: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RecordingDeletionError';
  }
}

const isSavedRecording = (value: unknown): value is SavedRecording => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const recording = value as Partial<SavedRecording>;

  return (
    typeof recording.id === 'string' &&
    typeof recording.filename === 'string' &&
    recording.filename.trim().length > 0 &&
    !recording.filename.includes('/') &&
    !recording.filename.includes('\\') &&
    typeof recording.uri === 'string' &&
    typeof recording.title === 'string' &&
    recording.title.trim().length > 0 &&
    typeof recording.createdAt === 'string' &&
    Number.isFinite(Date.parse(recording.createdAt)) &&
    typeof recording.durationMillis === 'number' &&
    Number.isFinite(recording.durationMillis) &&
    recording.durationMillis >= 0 &&
    (recording.transcript === null || typeof recording.transcript === 'string') &&
    typeof recording.transcriptionStatus === 'string' &&
    TRANSCRIPTION_STATUSES.has(
      recording.transcriptionStatus as TranscriptionStatus,
    )
  );
};

interface ResolvedRecordingFile {
  exists: boolean;
  recording: SavedRecording;
  wasRebased: boolean;
}

const resolveRecordingFile = (
  recording: SavedRecording,
  directory: Directory,
): ResolvedRecordingFile => {
  try {
    if (new File(recording.uri).exists) {
      return { exists: true, recording, wasRebased: false };
    }
  } catch (error) {
    if (__DEV__) {
      console.warn('[RecorderStorage] Persisted recording URI is invalid.', {
        error,
        recordingId: recording.id,
        uri: recording.uri,
      });
    }
  }

  const currentContainerFile = new File(directory, recording.filename);

  if (currentContainerFile.exists) {
    return {
      exists: true,
      recording: { ...recording, uri: currentContainerFile.uri },
      wasRebased: currentContainerFile.uri !== recording.uri,
    };
  }

  return { exists: false, recording, wasRebased: false };
};

const readRecordingsForMutation = async (): Promise<SavedRecording[]> => {
  const directory = ensureRecordingsDirectory();
  const metadataFile = new File(directory, METADATA_FILENAME);

  if (!metadataFile.exists) {
    return [];
  }

  const parsed = JSON.parse(await metadataFile.text()) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Recording metadata is not an array.');
  }

  return sortRecordingsNewestFirst(
    parsed
      .filter(isSavedRecording)
      .map((recording) => resolveRecordingFile(recording, directory).recording),
  );
};

const writeRecordingMetadata = (
  recordings: readonly SavedRecording[],
): void => {
  const directory = ensureRecordingsDirectory();
  const metadataFile = new File(directory, METADATA_FILENAME);
  metadataFile.write(
    JSON.stringify(sortRecordingsNewestFirst(recordings), null, 2),
  );
};

export const loadRecordings = async (): Promise<SavedRecording[]> => {
  const directory = ensureRecordingsDirectory();
  const metadataFile = new File(directory, METADATA_FILENAME);

  if (!metadataFile.exists) {
    return [];
  }

  try {
    const parsed = JSON.parse(await metadataFile.text()) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error('Recording metadata is not an array.');
    }

    const validRecordings: SavedRecording[] = [];
    let shouldCleanMetadata = false;

    parsed.forEach((entry, index) => {
      if (!isSavedRecording(entry)) {
        shouldCleanMetadata = true;

        if (__DEV__) {
          console.warn('[RecorderStorage] Ignoring malformed metadata entry.', {
            index,
            entry,
          });
        }
        return;
      }

      const retryableEntry: SavedRecording =
        entry.transcriptionStatus === 'transcribing'
          ? { ...entry, transcriptionStatus: 'failed' }
          : entry;

      if (retryableEntry !== entry) {
        shouldCleanMetadata = true;

        if (__DEV__) {
          console.warn(
            '[RecorderStorage] Reset interrupted transcription to retryable.',
            { recordingId: entry.id },
          );
        }
      }

      const resolvedFile = resolveRecordingFile(retryableEntry, directory);

      if (!resolvedFile.exists) {
        shouldCleanMetadata = true;

        if (__DEV__) {
          console.warn('[RecorderStorage] Removing stale metadata for a missing file.', {
            recordingId: entry.id,
            uri: entry.uri,
          });
        }
        return;
      }

      if (resolvedFile.wasRebased) {
        shouldCleanMetadata = true;

        if (__DEV__) {
          console.info('[RecorderStorage] Rebased recording URI to the current app container.', {
            recordingId: entry.id,
            previousUri: entry.uri,
            resolvedUri: resolvedFile.recording.uri,
          });
        }
      }

      validRecordings.push(resolvedFile.recording);
    });

    const recordings = sortRecordingsNewestFirst(validRecordings);

    if (shouldCleanMetadata) {
      try {
        writeRecordingMetadata(recordings);
      } catch (error) {
        console.warn(
          '[RecorderStorage] Healthy recordings loaded, but stale metadata cleanup failed.',
          error instanceof Error ? error.message : 'Unknown error',
        );
      }
    }

    return recordings;
  } catch (error) {
    console.warn(
      '[RecorderStorage] Could not read recording metadata.',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return [];
  }
};

export interface PersistVerifiedRecordingResult {
  destinationValidation: RecordingFileValidation;
  recording: SavedRecording;
}

export interface PersistVerifiedRecordingOptions {
  allowPlayableDiagnostic?: boolean;
}

export const persistVerifiedRecordingFile = async (
  sessionId: string,
  sourceValidation: RecordingFileValidation,
  options: PersistVerifiedRecordingOptions = {},
): Promise<PersistVerifiedRecordingResult> => {
  const directory = ensureRecordingsDirectory();
  const sourceUri = sourceValidation.uri;
  const sourceFile = new File(sourceUri);

  if (!sourceFile.exists) {
    throw new Error('The verified native recording file could not be found.');
  }

  if (
    !sourceValidation.passed &&
    !(options.allowPlayableDiagnostic && sourceValidation.isPlayable)
  ) {
    throw new Error('An unverified recording cannot be moved into the library.');
  }

  if (sourceValidation.playerDurationMillis === null) {
    throw new Error('A recording without a playable duration cannot be persisted.');
  }

  const sourceSize = sourceFile.info().size ?? 0;
  const createdAt = new Date();
  const id = createRecordingId(createdAt);
  const extension = sourceFile.extension || '.m4a';
  const safeTimestamp = createdAt.toISOString().replace(/[:.]/g, '-');
  const destination = new File(directory, `recording-${safeTimestamp}${extension}`);

  try {
    await sourceFile.move(destination);
    logRecorderIntegrity(sessionId, 'FILE_MOVED', {
      destinationUri: destination.uri,
      sourceSize,
      sourceUri,
    });
  } catch (error) {
    throw new Error('The verified recording could not be moved to the recording library.', {
      cause: error,
    });
  }

  try {
    const stableDestination = await waitForStableRecordingFile(
      sessionId,
      destination.uri,
    );

    if (!destination.exists || stableDestination.size !== sourceSize) {
      throw new Error(
        `The moved recording size changed from ${sourceSize} to ${stableDestination.size} bytes.`,
      );
    }

    const destinationValidationBase = await validateFinalizedRecording(
      sessionId,
      destination.uri,
      sourceValidation.nativeDurationMillis,
    );
    const destinationDurationMillis =
      destinationValidationBase.playerDurationMillis;

    if (destinationDurationMillis === null) {
      throw new Error('The moved recording could not be loaded for duration validation.');
    }

    const durationDifferenceMillis = Math.abs(
      destinationDurationMillis - sourceValidation.playerDurationMillis,
    );
    const durationToleranceMillis = Math.max(
      500,
      Math.round(sourceValidation.playerDurationMillis * 0.05),
    );
    const destinationChecks = [
      ...destinationValidationBase.checks,
      {
        actual: `${stableDestination.size} bytes`,
        expected: `${sourceSize} bytes`,
        id: 'destination_size_matches' as const,
        label: 'Destination size matches verified source',
        passed: stableDestination.size === sourceSize,
      },
      {
        actual: `${durationDifferenceMillis} ms difference`,
        expected: `Difference no greater than ${durationToleranceMillis} ms`,
        id: 'destination_duration_matches' as const,
        label: 'Destination duration matches source',
        passed: durationDifferenceMillis <= durationToleranceMillis,
      },
    ];
    const destinationStoragePassed =
      destinationValidationBase.isPlayable &&
      stableDestination.size === sourceSize &&
      durationDifferenceMillis <= durationToleranceMillis;
    const destinationValidation: RecordingFileValidation = {
      ...destinationValidationBase,
      checks: destinationChecks,
      durationDifferenceMillis,
      durationToleranceMillis,
      failedChecks: destinationChecks.filter((check) => !check.passed),
      fileSize: stableDestination.size,
      modificationTime: stableDestination.modificationTime,
      passed:
        destinationValidationBase.passed && destinationStoragePassed,
      playerDurationMillis: destinationDurationMillis,
      uri: destination.uri,
    };

    logRecorderIntegrity(sessionId, 'DESTINATION_VALIDATED', {
      ...destinationValidation,
    });

    if (!destinationStoragePassed) {
      throw new Error('The moved recording duration did not match the verified source.');
    }

    return {
      destinationValidation,
      recording: {
        id,
        filename: destination.name,
        uri: destination.uri,
        title: createRecordingTitle(createdAt),
        createdAt: createdAt.toISOString(),
        durationMillis: destinationDurationMillis,
        transcript: null,
        transcriptionStatus: 'none',
      },
    };
  } catch (error) {
    try {
      const originalLocation = new File(sourceUri);

      if (destination.exists && !originalLocation.exists) {
        await destination.move(originalLocation);
      }
    } catch (rollbackError) {
      console.error('[RecorderStorage] Failed to restore the verified source after move validation failed.', {
        destinationUri: destination.uri,
        rollbackError,
        sessionId,
        sourceUri,
      });
    }

    throw error;
  }
};

export const saveRecordingMetadata = async (
  recording: SavedRecording,
): Promise<void> => {
  const existingRecordings = await readRecordingsForMutation();
  const recordings = sortRecordingsNewestFirst([
    recording,
    ...existingRecordings.filter((item) => item.id !== recording.id),
  ]);

  writeRecordingMetadata(recordings);
};

export const updateRecordingTranscription = async (
  recordingId: string,
  transcriptionStatus: TranscriptionStatus,
  transcript: string | null,
): Promise<SavedRecording> => {
  const recordings = await readRecordingsForMutation();
  const recording = recordings.find((item) => item.id === recordingId);

  if (!recording) {
    throw new Error('The recording metadata could not be found for transcription.');
  }

  const normalizedTranscript = transcript?.trim() || null;

  if (transcriptionStatus === 'complete' && !normalizedTranscript) {
    throw new Error('A completed transcription must contain transcript text.');
  }

  const updatedRecording: SavedRecording = {
    ...recording,
    transcript: normalizedTranscript,
    transcriptionStatus,
  };
  writeRecordingMetadata(
    recordings.map((item) =>
      item.id === recordingId ? updatedRecording : item,
    ),
  );
  return updatedRecording;
};

export const renameRecording = async (
  recordingId: string,
  title: string,
): Promise<SavedRecording> => {
  const trimmedTitle = title.trim();

  if (!trimmedTitle) {
    throw new Error('A recording title cannot be empty.');
  }

  const recordings = await readRecordingsForMutation();
  const recording = recordings.find((item) => item.id === recordingId);

  if (!recording) {
    throw new Error('The recording metadata could not be found.');
  }

  const renamedRecording = { ...recording, title: trimmedTitle };
  writeRecordingMetadata(
    recordings.map((item) =>
      item.id === recordingId ? renamedRecording : item,
    ),
  );
  return renamedRecording;
};

export const deleteRecording = async (
  recording: SavedRecording,
): Promise<void> => {
  const audioFile = new File(recording.uri);
  let audioFileDeleted = false;
  let recordings: SavedRecording[];

  try {
    recordings = await readRecordingsForMutation();
  } catch (error) {
    throw new RecordingDeletionError(
      'Recording metadata could not be read, so no files were deleted.',
      false,
      { cause: error },
    );
  }

  try {
    if (audioFile.exists) {
      audioFile.delete();
      audioFileDeleted = true;
    } else if (__DEV__) {
      console.warn('[RecorderStorage] Audio file was already missing during deletion.', {
        recordingId: recording.id,
        uri: recording.uri,
      });
    }
  } catch (error) {
    throw new RecordingDeletionError(
      'The recording audio file could not be deleted.',
      false,
      { cause: error },
    );
  }

  try {
    writeRecordingMetadata(
      recordings.filter((item) => item.id !== recording.id),
    );
  } catch (error) {
    throw new RecordingDeletionError(
      audioFileDeleted
        ? 'The audio file was deleted, but recording metadata could not be updated.'
        : 'The stale recording metadata could not be removed.',
      audioFileDeleted,
      { cause: error },
    );
  }
};
