import { preferredTranscript } from '../recorder/recorder.transcripts';
import type { SavedRecording } from '../recorder/recorder.types';
import { intakeFromDraft } from './memory.intake';
import type { IntakeDraft, MeetingIntake } from './memory.types';

// Shared completed-transcript intake. No audio upload, cleanup or speaker inference.
export function recordingDraft(recording: SavedRecording): IntakeDraft {
  const source = preferredTranscript(recording);
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
