import { appConfig } from '../../config/app.config';
import { ApiError, createApiClient } from '../../services/api';
import type { ApiClient } from '../../services/api';
import type { Meeting, MeetingFilters, MeetingIntake, MeetingSummary, MemoryAnswer, SpeakerNameInput } from './memory.types';

export function createMeetingMemoryService(client?: ApiClient) {
  async function request<T, B = never>(path: string, body?: B): Promise<T> {
    if (!client && !appConfig.apiUrl) throw new Error('Set EXPO_PUBLIC_API_URL to the Mac backend’s current Wi-Fi address and reload Expo.');
    const api = client ?? createApiClient({ baseUrl: appConfig.apiUrl! });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), path === '/questions' ? 130_000 : 20_000);
    try {
      return await api.request<T, B>(`/v1/memory${path}`, { method: body === undefined ? 'GET' : 'POST', ...(body !== undefined ? { body } : {}), signal: controller.signal });
    } catch (error) {
      if (error instanceof ApiError) {
        const payload = error.payload as { error?: { message?: unknown } } | null;
        if (typeof payload?.error?.message === 'string') throw new Error(payload.error.message);
        if (error.status === 404) throw new Error('Meeting Memory is unavailable on this backend. Restart the updated backend on your Mac.');
      }
      if (controller.signal.aborted) throw new Error('The request timed out. The backend may still be processing; refresh the meeting before retrying.');
      throw new Error('Cannot reach Meeting Memory. Check the backend, the Mac’s Wi-Fi address, and your phone’s Local Network access. Your intake draft is kept on this device.');
    } finally { clearTimeout(timer); }
  }
  return {
    list: () => request<{ mode: string; meetings: MeetingSummary[] }>('/meetings'),
    get: (id: string) => request<Meeting>(`/meetings/${encodeURIComponent(id)}`),
    create: (input: MeetingIntake) => request<{ meeting: Meeting; existing: boolean }, MeetingIntake>('/meetings', input),
    revisions: (id: string) => request<import('./memory.types').TranscriptRevisionSummary[]>(`/meetings/${encodeURIComponent(id)}/revisions`),
    revision: (id: string, revision: string) => request<MeetingIntake & { id: string }>(`/meetings/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revision)}`),
    selectRevision: (id: string, revision: string) => request<Meeting, object>(`/meetings/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revision)}/select`, {}),
    reviseSpeakers: (id: string, speakerNames: SpeakerNameInput[]) => request<{ meeting: Meeting; existing: boolean }, { speakerNames: SpeakerNameInput[] }>(`/meetings/${encodeURIComponent(id)}/speakers`, { speakerNames }),
    process: (id: string, reprocess = false) => request<Meeting, { reprocess: boolean }>(`/meetings/${encodeURIComponent(id)}/process`, { reprocess }),
    ask: (question: string, filters: MeetingFilters) => request<MemoryAnswer, { question: string; filters: MeetingFilters }>('/questions', { question, filters }),
    answers: () => request<MemoryAnswer[]>('/answers'),
  };
}
