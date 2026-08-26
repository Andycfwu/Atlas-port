import type { SavedRecording } from './recorder.types';

const padTime = (value: number): string => value.toString().padStart(2, '0');

export const formatDuration = (durationMillis: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${padTime(hours)}:${padTime(minutes)}:${padTime(seconds)}`;
};

export const createRecordingId = (createdAt: Date): string => {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${createdAt.getTime().toString(36)}-${randomSuffix}`;
};

export const createRecordingTitle = (createdAt: Date): string =>
  `Recording — ${createdAt.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })}`;

export const formatRecordingDate = (createdAt: string): string =>
  new Date(createdAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const sortRecordingsNewestFirst = (
  recordings: readonly SavedRecording[],
): SavedRecording[] =>
  [...recordings].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
