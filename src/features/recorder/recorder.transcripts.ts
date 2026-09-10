import type { SavedLiveTranscript, SavedPostTranscript, SavedRecording } from './recorder.types';
import type { LiveTranscriptionState } from './live/live-transcription.types';
import type { SavedLiveSpeakerTranscript } from './live-speakers/live-speakers.model';

export function savedLiveSource(snapshot: LiveTranscriptionState, recorderSessionId: string): SavedLiveTranscript | null {
  if (snapshot.provider === 'deepgram') return null;
  if (!snapshot.traceId && !snapshot.draft) return null;
  return { source: 'live', text: snapshot.draft, segments: snapshot.segments ?? [],
    status: ['completed', 'paused', 'failed'].includes(snapshot.status) ? snapshot.status as 'completed' | 'paused' | 'failed' : 'finishing',
    traceId: snapshot.traceId, recorderSessionId, model: 'gpt-live-transcribe', savedAt: new Date().toISOString(), errorMessage: snapshot.errorMessage };
}
export function savedLiveSpeakerSource(snapshot: LiveTranscriptionState, recorderSessionId: string): SavedLiveSpeakerTranscript | null {
  if (snapshot.provider !== 'deepgram') return null;
  return JSON.parse(JSON.stringify({ ...snapshot.speakerSnapshot,
    sessions: snapshot.speakerSnapshot?.sessions ?? [], finalResults: snapshot.speakerSnapshot?.finalResults ?? [],
    provisionalResults: snapshot.speakerSnapshot?.provisionalResults ?? [], text: snapshot.speakerSnapshot?.text ?? '',
    id: `${recorderSessionId}:deepgram-live`, schemaVersion: 1, source: 'live_speakers', provider: 'deepgram', recorderSessionId,
    status: ['completed', 'paused', 'failed'].includes(snapshot.status) ? snapshot.status : 'finishing',
    savedAt: new Date().toISOString(), errorMessage: snapshot.errorMessage,
  }));
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
