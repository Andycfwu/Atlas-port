import { useState } from 'react';
import { Text } from 'react-native';
import { SpeakerNames, initialSpeakerNames } from './SpeakerNames';
import type { DiarizedTranscript } from '../recorder/diarization/diarization.types';
import type { SavedRecording } from '../recorder/recorder.types';
import { postSources, preferredTranscript } from '../recorder/recorder.transcripts';
import { intakeFromRecording, intakeFromDiarizedRecording, intakeFromLiveSpeakers } from './memory.recording';
import type { MeetingIntake, IntakeDraft } from './memory.types';
import { Field, MemoryButton, Panel, s } from './memory.ui';

export function RecordingMemoryIntake({ recording, diarized, busy, onSave, onError }: {
  recording: SavedRecording; diarized?: DiarizedTranscript | undefined; busy: boolean; onSave: (input: MeetingIntake, process: boolean) => void; onError: (message: string) => void;
}) {
  const options = [
    ...(recording.liveTranscript?.text.trim() ? [{ id: 'live', label: 'OpenAI saved live transcript' }] : []),
    ...(recording.liveSpeakerTranscripts ?? []).filter(v => v.text.trim()).map(v => ({ id: v.id, label: `Deepgram live speakers · ${v.status}` })),
    ...postSources(recording).map((_, i) => ({ id: `post:${i}`, label: `Post-recording transcript ${i + 1}` })),
    ...(recording.diarizedTranscripts ?? []).map(v => ({ id: v.id, label: 'Saved-audio speaker identification' })),
  ];
  const [selected, setSelected] = useState(diarized?.id ?? options[0]?.id ?? '');
  const recordedDate = new Date(recording.createdAt);
  const localDate = `${recordedDate.getFullYear()}-${String(recordedDate.getMonth() + 1).padStart(2, '0')}-${String(recordedDate.getDate()).padStart(2, '0')}`;
  const [draft, setDraft] = useState<IntakeDraft>({ title: recording.title, date: localDate, participantsText: '', originalTranscript: '' });
  const identified = (recording.diarizedTranscripts ?? []).find(v => v.id === selected) ?? (diarized?.id === selected ? diarized : undefined);
  const [speakerNames, setSpeakerNames] = useState(() => initialSpeakerNames(identified?.speakers ?? []));
  const [showOriginal, setShowOriginal] = useState(false);
  const live = recording.liveSpeakerTranscripts?.find(v => v.id === selected);
  const post = selected.startsWith('post:') ? postSources(recording)[Number(selected.slice(5))] : undefined;
  const text = identified?.originalTranscript ?? live?.text ?? post?.text ?? preferredTranscript(recording)?.text ?? '';
  const save = (process: boolean) => {
    try {
      let input: MeetingIntake;
      if (identified) input = intakeFromDiarizedRecording(recording, identified, draft, speakerNames);
      else if (live) input = intakeFromLiveSpeakers(recording, live, draft);
      else { const sourceRecording = { ...recording }; if (post) { delete sourceRecording.liveTranscript; sourceRecording.postTranscripts = [post]; } input = intakeFromRecording(sourceRecording, draft); }
      onSave(input, process);
    } catch (e) { onError((e as Error).message); }
  };
  return <>
    <Text style={s.title}>Review recorded meeting</Text>
    <Text style={s.subtitle}>Choose the primary transcript version</Text>
    {options.map(option => <MemoryButton key={option.id} secondary disabled={busy} onPress={() => { setSelected(option.id); setSpeakerNames(initialSpeakerNames(recording.diarizedTranscripts?.find(v => v.id === option.id)?.speakers ?? [])); }}>{`${selected === option.id ? '● ' : '○ '}${option.label}`}</MemoryButton>)}
    <Text style={s.muted}>Alternative versions stay under one meeting for this recording. They may disagree. Processing publishes only your selected source; Atlas never merges them or transfers speaker names between providers.</Text>
    {live ? <Panel><Text style={s.body}>Only finalized original provider text is organized. Unfinished text remains in the recording. Live speaker labels are estimates; stream times are not verified saved-audio positions.</Text></Panel> : null}
    <Field label="Meeting title" value={draft.title} onChangeText={title => setDraft(d => ({ ...d, title }))} />
    <Field label="Meeting date (YYYY-MM-DD)" value={draft.date} onChangeText={date => setDraft(d => ({ ...d, date }))} />
    <Field label="Participants (comma separated, optional)" value={draft.participantsText} onChangeText={participantsText => setDraft(d => ({ ...d, participantsText }))} />
    <Text style={s.muted}>Participants describe attendance, never who spoke.</Text>
    {identified ? <SpeakerNames speakers={identified.speakers} value={speakerNames} onChange={setSpeakerNames} disabled={busy} /> : null}
    <MemoryButton secondary onPress={() => setShowOriginal(v => !v)}>{showOriginal ? 'Hide original transcript' : 'Review selected original transcript'}</MemoryButton>
    {showOriginal ? <Panel><Text selectable style={s.body}>{text}</Text></Panel> : null}
    <Text style={s.muted}>Saving sends source text and metadata to your Mac. Processing sends this version to OpenAI for notes and indexing. Audio stays on the phone. Previous published evidence remains usable until processing succeeds.</Text>
    <MemoryButton disabled={busy || !text.trim()} onPress={() => save(true)}>{busy ? 'Saving…' : 'Use selected source & process'}</MemoryButton>
    <MemoryButton secondary disabled={busy || !text.trim()} onPress={() => save(false)}>Save selected source without processing</MemoryButton>
  </>;
}
