import { File } from 'expo-file-system';

import { appConfig } from '../../config/app.config';
import { createApiClient } from '../../services/api';
import type { SavedRecording } from './recorder.types';

interface TranscriptionResponse {
  text: string;
}

export class TranscriptionConfigurationError extends Error {
  constructor() {
    super('EXPO_PUBLIC_API_URL is not configured for transcription.');
    this.name = 'TranscriptionConfigurationError';
  }
}

const isTranscriptionResponse = (
  value: unknown,
): value is TranscriptionResponse =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as Partial<TranscriptionResponse>).text === 'string',
  );

export const transcribeRecordingFile = async (
  recording: SavedRecording,
): Promise<string> => {
  if (!appConfig.apiUrl) {
    throw new TranscriptionConfigurationError();
  }

  const audioFile = new File(recording.uri);

  if (!audioFile.exists) {
    throw new Error('The recording audio file is missing.');
  }

  const formData = new FormData();
  const audioBlob = audioFile.slice(0, audioFile.size, 'audio/mp4');
  const appendFile = formData.append.bind(formData) as (
    name: string,
    value: Blob,
    filename: string,
  ) => void;
  appendFile('file', audioBlob, recording.filename || 'recording.m4a');

  const apiClient = createApiClient({ baseUrl: appConfig.apiUrl });
  const response = await apiClient.request<unknown, FormData>('/transcribe', {
    method: 'POST',
    body: formData,
    bodyEncoding: 'form-data',
  });

  if (!isTranscriptionResponse(response)) {
    throw new Error('The transcription backend returned an invalid response.');
  }

  const transcript = response.text.trim();

  if (!transcript) {
    throw new Error('The transcription backend returned an empty transcript.');
  }

  return transcript;
};
