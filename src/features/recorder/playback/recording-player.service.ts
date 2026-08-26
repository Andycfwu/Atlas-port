import { File } from 'expo-file-system';

import type { SavedRecording } from '../recorder.types';

export const ensureRecordingFileExists = (recording: SavedRecording): void => {
  const file = new File(recording.uri);

  if (!file.exists) {
    throw new Error(`Recording file is missing: ${recording.uri}`);
  }
};

export const secondsToMillis = (seconds: number): number =>
  Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;

export const clampSeekMillis = (
  positionMillis: number,
  durationMillis: number,
): number => {
  if (!Number.isFinite(positionMillis) || !Number.isFinite(durationMillis)) {
    return 0;
  }

  return Math.min(Math.max(0, positionMillis), Math.max(0, durationMillis));
};
