import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import type { SavedRecording } from './recorder.types';

interface SharingType {
  mimeType: string;
  UTI?: string;
}

const SHARING_TYPES: Record<string, SharingType> = {
  '.3gp': { mimeType: 'audio/3gpp', UTI: 'public.3gpp' },
  '.aac': { mimeType: 'audio/aac', UTI: 'public.aac-audio' },
  '.caf': { mimeType: 'audio/x-caf', UTI: 'com.apple.coreaudio-format' },
  '.m4a': { mimeType: 'audio/mp4', UTI: 'public.mpeg-4-audio' },
  '.mp3': { mimeType: 'audio/mpeg', UTI: 'public.mp3' },
  '.wav': { mimeType: 'audio/wav', UTI: 'com.microsoft.waveform-audio' },
  '.webm': { mimeType: 'audio/webm', UTI: 'org.webmproject.webm' },
};

export class RecordingSharingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingSharingUnavailableError';
  }
}

export const shareRecording = async (
  recording: SavedRecording,
): Promise<void> => {
  const file = new File(recording.uri);

  if (!file.exists) {
    throw new Error('The selected recording file is missing.');
  }

  if (!(await Sharing.isAvailableAsync())) {
    throw new RecordingSharingUnavailableError(
      'Sharing is not available on this device.',
    );
  }

  const sharingType = SHARING_TYPES[file.extension.toLowerCase()] ?? {
    mimeType: 'audio/*',
  };

  await Sharing.shareAsync(file.uri, {
    dialogTitle: `Share ${recording.title}`,
    mimeType: sharingType.mimeType,
    ...(sharingType.UTI ? { UTI: sharingType.UTI } : {}),
  });
};
