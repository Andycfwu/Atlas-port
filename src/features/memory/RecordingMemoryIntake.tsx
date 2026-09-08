import { SpeakerNames, initialSpeakerNames } from './SpeakerNames';
import { SpeakerPassages } from './SpeakerPassages';
import type { DiarizedTranscript } from '../recorder/diarization/diarization.types';
import { useState } from 'react';
import { Text } from 'react-native';
import type { SavedRecording } from '../recorder/recorder.types';
import { preferredTranscript } from '../recorder/recorder.transcripts';
import { intakeFromRecording, intakeFromDiarizedRecording, recordingDraft } from './memory.recording';
import type { MeetingIntake } from './memory.types';
import { Field, MemoryButton, Panel, s } from './memory.ui';

export function RecordingMemoryIntake({ recording, diarized, busy, onSave, onError }: {
  recording: SavedRecording; diarized?: DiarizedTranscript | undefined; busy: boolean; onSave: (input: MeetingIntake, process: boolean) => void; onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(() => recordingDraft(recording, diarized));
  const [speakerNames, setSpeakerNames] = useState(() => initialSpeakerNames(diarized?.speakers ?? []));
  const [showOriginal, setShowOriginal] = useState(false);
  const source = diarized ? { source: 'diarized_audio' as const, model: diarized.model, text: diarized.originalTranscript } : preferredTranscript(recording)!;
  const save = (process: boolean) => { try { onSave(diarized ? intakeFromDiarizedRecording(recording, diarized, draft, speakerNames) : intakeFromRecording(recording, draft), process); } catch (e) { onError((e as Error).message); } };
  return <>
    <Text style={s.title}>Review recorded meeting</Text>
    <Text style={s.subtitle}>Source: {source.source === 'diarized_audio' ? 'Diarized saved audio (new source version)' : source.source === 'live' ? 'Saved live transcript' : 'Post-recording transcription of saved audio'}</Text>
    <Text style={s.muted}>{source.model ?? 'Model not recorded'} · {source.text.length.toLocaleString()} characters. Original text is transferred unchanged. Audio stays on your phone.</Text>
    {source.source === 'live' && source.status !== 'completed' ? <Panel><Text style={s.body}>Live capture was {source.status}; this source may be incomplete. Review it before processing.</Text></Panel> : null}
    <Field label="Meeting title" value={draft.title} onChangeText={title => setDraft(d => ({ ...d, title }))} />
    <Field label="Meeting date (YYYY-MM-DD)" value={draft.date} onChangeText={date => setDraft(d => ({ ...d, date }))} />
    <Field label="Participants (comma separated, optional)" value={draft.participantsText} onChangeText={participantsText => setDraft(d => ({ ...d, participantsText }))} />
    <Text style={s.muted}>Participants describe attendance, not who spoke. No speaker names or timestamps are inferred.</Text>
    {diarized ? <SpeakerNames speakers={diarized.speakers} value={speakerNames} onChange={setSpeakerNames} disabled={busy} /> : null}
    <MemoryButton secondary onPress={() => setShowOriginal(v => !v)}>{showOriginal ? 'Hide original transcript' : 'Review original transcript'}</MemoryButton>
    {showOriginal ? <Panel>{diarized ? <SpeakerPassages original={source.text} speakers={diarized.speakers} segments={diarized.segments} /> : <Text selectable style={s.body}>{source.text}</Text>}</Panel> : null}
    <Text style={s.muted}>Saving sends this source text and meeting details to your Mac backend. Processing sends them to OpenAI for derived notes and indexing. Other transcript versions stay separate on your phone.</Text>
    <MemoryButton disabled={busy} onPress={() => save(true)}>{busy ? 'Saving…' : 'Save & process meeting'}</MemoryButton>
    <MemoryButton secondary disabled={busy} onPress={() => save(false)}>Save without processing</MemoryButton>
  </>;
}
