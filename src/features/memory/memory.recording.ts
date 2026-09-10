import type { DiarizedTranscript } from '../recorder/diarization/diarization.types';
import { preferredTranscript } from '../recorder/recorder.transcripts';
import type { SavedRecording } from '../recorder/recorder.types';
import { intakeFromDraft } from './memory.intake';
import type { IntakeDraft, MeetingIntake } from './memory.types';

// Shared completed-transcript intake. No audio upload, cleanup or speaker inference.
export function recordingDraft(recording: SavedRecording, diarized?: DiarizedTranscript): IntakeDraft {
  const source = diarized ? { text: diarized.originalTranscript } : preferredTranscript(recording);
  if (!source) throw new Error('No saved transcript is available yet. Use Transcribe Recording, then try again.');
  const date = new Date(recording.createdAt);
  return { title: recording.title, date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, participantsText: '', originalTranscript: source.text };
}
export function intakeFromRecording(recording: SavedRecording, details: IntakeDraft): MeetingIntake {
  const source = preferredTranscript(recording);
  if (!source) throw new Error('No saved transcript is available. Transcribe the saved audio first.');
  const intake = intakeFromDraft({ ...details, originalTranscript: source.text });
  return { ...intake,
    sourceKey: `recording:${recording.id}:${source.source}:${source.traceId ?? 'legacy'}`,
    transcriptSource: { kind: source.source, recordingId: recording.id, traceId: source.traceId,
      model: source.model, status: source.source === 'live' ? source.status : 'completed' },
    speakers: [], segments: [],
  };
}

export function intakeFromDiarizedRecording(recording: SavedRecording, diarized: DiarizedTranscript, details: IntakeDraft, speakerNames: import('./memory.types').SpeakerNameInput[]): MeetingIntake {
  if (diarized.recordingId !== recording.id) throw new Error('This speaker version belongs to a different recording.');
  return { ...intakeFromDraft({ ...details, originalTranscript: diarized.originalTranscript }), diarizationId: diarized.id, speakerNames };
}

// Exact provider word order only. If the provider's word list and full text
// disagree, keep the whole source but leave attribution absent for that result.
export function intakeFromLiveSpeakers(recording: SavedRecording, version: import('../recorder/live-speakers/live-speakers.model').SavedLiveSpeakerTranscript, details: IntakeDraft): MeetingIntake {
  if (!recording.liveSpeakerTranscripts?.some(v => v.id === version.id && v.recorderSessionId === version.recorderSessionId)) throw new Error('This live version belongs to a different recording session.');
  const speakers: NonNullable<MeetingIntake['speakers']> = [], segments: NonNullable<MeetingIntake['segments']> = [];
  const results = version.finalResults.filter(r => r.text);
  const originalTranscript = results.map(r => r.text).join('\n');
  let offset = 0;
  for (const result of results) {
    if (result.words.map(w => w.text).join(' ') === result.text) {
      let wordOffset = offset;
      for (const [i, word] of result.words.entries()) {
        const speakerId = word.providerSpeaker === null ? null : result.connectionId + ':speaker' + word.providerSpeaker;
        if (speakerId && !speakers.some(s => s.id === speakerId)) speakers.push({ id: speakerId, label: 'Speaker ' + (word.providerSpeaker! + 1) + (version.sessions.length > 1 ? ' · Connection ' + (version.sessions.findIndex(s => s.connectionId === result.connectionId) + 1) : ''), nameConfirmation: null });
        const previous = segments.at(-1);
        if (previous && previous.speakerId === speakerId && previous.providerStream?.connectionId === result.connectionId && previous.end + 1 === wordOffset) { previous.end = wordOffset + word.text.length; previous.providerStream.endMs = Math.max(previous.providerStream.endMs, word.endMs); }
        else if (word.text.length) segments.push({ id: result.id + ':w' + i, start: wordOffset, end: wordOffset + word.text.length, speakerId, attribution: speakerId ? 'stream_diarization' : null, audio: null, providerStream: { connectionId: result.connectionId, startMs: word.startMs, endMs: word.endMs } });
        wordOffset += word.text.length + 1;
      }
    }
    offset += result.text.length + 1;
  }
  const session = version.sessions[0];
  return { ...intakeFromDraft({ ...details, originalTranscript }), sourceKey: 'live-speakers:' + version.id, speakers, segments,
    transcriptSource: { kind: 'live_speakers', recordingId: recording.id, traceId: session?.providerMetadata?.requestId ?? null, model: session?.configuration.model ?? 'nova-3', status: version.status, provider: 'deepgram', sourceVersionId: version.id, createdAt: version.savedAt, configurationVersion: session?.configuration.configurationVersion ?? 'atlas-deepgram-live-v1' } };
}
