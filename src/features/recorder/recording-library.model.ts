import { formatRecordingDate, sortRecordingsNewestFirst } from './recorder.service';
import { postSources } from './recorder.transcripts';
import type { SavedRecording } from './recorder.types';

export type RecordingFilter = 'all' | 'transcript' | 'attention';
export interface RecorderViewState {
  tab: 'record' | 'library';
  query: string;
  filter: RecordingFilter;
}

export function hasRecordingTranscript(recording: SavedRecording): boolean {
  return Boolean(recording.liveTranscript?.text.trim()
    || recording.liveSpeakerTranscripts?.some(source => source.text.trim() || source.provisionalResults.some(result => result.text.trim()))
    || postSources(recording).some(source => source.text.trim())
    || recording.diarizedTranscripts?.some(source => source.providerText.trim()));
}

export function recordingNeedsAttention(recording: SavedRecording): boolean {
  return recording.transcriptionStatus === 'failed' || recording.diarization?.status === 'failed' || recording.liveSpeakerTranscripts?.some(source => source.status !== 'completed') === true;
}

export function recordingTranscriptLabel(recording: SavedRecording): string {
  if (recording.transcriptionStatus === 'transcribing') return 'Transcribing';
  if (recording.transcriptionStatus === 'failed') return 'Transcription failed';
  if (recording.diarization?.status === 'failed') return 'Speaker identification failed';
  if (postSources(recording).some(source => source.text.trim())) return 'Transcript ready';
  if (recording.diarizedTranscripts?.some(source => source.providerText.trim())) return 'Speakers identified';
  if (recording.liveTranscript?.text.trim()) return 'Live draft saved';
  if (recording.liveSpeakerTranscripts?.length) return recording.liveSpeakerTranscripts.at(-1)?.status === 'completed' ? 'Experimental labels saved' : 'Partial speaker text saved';
  return 'Audio saved';
}

/** Search every saved source without altering transcript preference or recording metadata. */
export function filterRecordings(recordings: readonly SavedRecording[], query: string, filter: RecordingFilter): SavedRecording[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sortRecordingsNewestFirst(recordings).filter(recording => {
    if (filter === 'transcript' && !hasRecordingTranscript(recording)) return false;
    if (filter === 'attention' && !recordingNeedsAttention(recording)) return false;
    const searchable = [recording.title, recording.createdAt, formatRecordingDate(recording.createdAt),
      recording.liveTranscript?.text, ...postSources(recording).map(source => source.text),
      ...(recording.liveSpeakerTranscripts ?? []).flatMap(source => [source.text, ...source.provisionalResults.map(result => result.text)]),
      ...(recording.diarizedTranscripts ?? []).map(source => source.providerText)]
      .join(' ').toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}
