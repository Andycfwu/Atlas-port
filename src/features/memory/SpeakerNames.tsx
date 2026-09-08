import { Text } from 'react-native';
import type { SpeakerNameInput, TranscriptSpeaker } from './memory.types';
import { Field, s } from './memory.ui';
export const initialSpeakerNames = (speakers: TranscriptSpeaker[]): SpeakerNameInput[] => speakers.map(s => ({ speakerId: s.id, name: s.nameConfirmation?.name ?? null }));
export function SpeakerNames({ speakers, value, onChange, disabled }: { speakers: TranscriptSpeaker[]; value: SpeakerNameInput[]; onChange: (value: SpeakerNameInput[]) => void; disabled?: boolean }) {
  return <>
    <Text style={s.heading}>Names for this meeting (optional)</Text>
    <Text style={s.muted}>Confirm a name only after checking the audio. Leave uncertain voices anonymous. Clear a name to correct it back to an anonymous label. This does not recognize people across meetings.</Text>
    {speakers.map(speaker => <Field key={speaker.id} editable={!disabled} maxLength={100} label={`${speaker.label}${speaker.providerLabel ? ` · provider label ${speaker.providerLabel}` : ''}${speaker.nameConfirmation ? ' · user confirmed' : ' · anonymous'}`} placeholder="Optional confirmed name" value={value.find(v => v.speakerId === speaker.id)?.name ?? ''} onChangeText={name => onChange(value.map(v => v.speakerId === speaker.id ? { ...v, name: name || null } : v))} />)}
  </>;
}
