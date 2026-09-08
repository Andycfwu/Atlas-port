import { File } from 'expo-file-system';
import { appConfig } from '../../../config/app.config';
import { ApiError, createApiClient } from '../../../services/api';
import type { SavedRecording } from '../recorder.types';
import type { DiarizationJob } from './diarization.types';
export const DIARIZATION_LIMITS = { bytes: 25_000_000, durationMillis: 20 * 60_000 };
export function identificationLimit(recording: Pick<SavedRecording, 'durationMillis'>, byteSize: number): string | null {
  if (!Number.isFinite(recording.durationMillis) || recording.durationMillis <= 0) return 'The saved recording has no valid measured duration.';
  if (recording.durationMillis > DIARIZATION_LIMITS.durationMillis) return 'Identify speakers supports up to 20 minutes in this milestone. Your audio is preserved; Atlas will not split and guess matching voices across files.';
  if (byteSize <= 0 || byteSize > DIARIZATION_LIMITS.bytes) return 'Identify speakers requires a saved M4A file of up to 25 MB. The original remains unchanged.';
  return null;
}
async function request(path: string, form?: FormData, size?: number): Promise<DiarizationJob> {
  if (!appConfig.apiUrl) throw new Error('Set EXPO_PUBLIC_API_URL to the Mac backend’s Wi-Fi address.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), form ? 60_000 : 15_000);
  try {
    const result = await createApiClient({ baseUrl: appConfig.apiUrl }).request<DiarizationJob, FormData>(`/v1/diarizations${path}`, {
      method: form ? 'POST' : 'GET', signal: controller.signal,
      ...(form ? { body: form, bodyEncoding: 'form-data' as const, headers: { 'X-Atlas-Audio-Bytes': String(size) } } : {}),
    });
    if (!result?.id || !['processing', 'ready', 'failed'].includes(result.status) || typeof result.recordingId !== 'string'
      || (result.status === 'ready' && (!result.result || !Array.isArray(result.result.segments)))) throw new Error('The backend returned an invalid identification result. Update the backend and retry.');
    return result;
  } catch (error) {
    if (error instanceof ApiError) {
      const payload = error.payload as { error?: { message?: string } } | null;
      throw new Error(payload?.error?.message ?? 'Speaker identification is unavailable. Restart the updated Mac backend.');
    }
    if (error instanceof TypeError || controller.signal.aborted) throw new Error('Cannot reach speaker identification. Check the Mac backend and Wi-Fi, then refresh or retry. Existing transcripts are preserved.');
    throw error;
  } finally { clearTimeout(timer); }
}
export async function identifyRecording(recording: SavedRecording) {
  const file = new File(recording.uri);
  if (!file.exists || file.extension.toLowerCase() !== '.m4a') throw new Error('The original saved M4A audio is unavailable.');
  const error = identificationLimit(recording, file.size);
  if (error) throw new Error(error);
  const form = new FormData(); form.append('file', file); form.append('recordingId', recording.id); form.append('durationMillis', String(recording.durationMillis));
  return request('', form, file.size);
}
export const getDiarization = (id: string) => request(`/${encodeURIComponent(id)}`);
