import type { SavedLiveTranscript, SavedPostTranscript, SavedRecording } from './recorder.types';
import type { LiveTranscriptionState } from './live/live-transcription.types';

export function savedLiveSource(snapshot: LiveTranscriptionState, recorderSessionId: string): SavedLiveTranscript | null {
  if (!snapshot.traceId && !snapshot.draft) return null;
  return { source: 'live', text: snapshot.draft, segments: snapshot.segments ?? [],
    status: ['completed', 'paused', 'failed'].includes(snapshot.status) ? snapshot.status as 'completed' | 'paused' | 'failed' : 'finishing',
    traceId: snapshot.traceId, recorderSessionId, model: 'gpt-live-transcribe', savedAt: new Date().toISOString(), errorMessage: snapshot.errorMessage };
}
export function postSources(recording: SavedRecording): SavedPostTranscript[] {
  if (recording.postTranscripts?.length) return recording.postTranscripts;
  return recording.transcript?.trim() ? [{ source: 'saved_audio', text: recording.transcript, traceId: recording.transcriptionTraceId, model: null, savedAt: null }] : [];
}
export function preferredTranscript(recording: SavedRecording) {
  if (recording.liveTranscript?.text.trim()) return { ...recording.liveTranscript, source: 'live' as const };
  const post = postSources(recording).at(-1);
  return post?.text.trim() ? post : null;
}
