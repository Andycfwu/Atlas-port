import { File } from 'expo-file-system';
import { useState } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { decodeTranscript, intakeFromDraft, MAX_IMPORT_BYTES, MAX_TRANSCRIPT_CHARS } from './memory.intake';
import type { IntakeDraft } from './memory.types';
import { Field, MemoryButton, Panel, s } from './memory.ui';

export function MeetingIntakeScreen({ draft, setDraft, busy, onSave, onError, onStepChange }: {
  draft: IntakeDraft; setDraft: (next: IntakeDraft) => void; busy: boolean;
  onSave: (process: boolean) => void; onError: (message: string) => void; onStepChange: () => void;
}) {
  const [review, setReview] = useState(false);
  const [importing, setImporting] = useState(false);
  async function importText() {
    setImporting(true);
    try {
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({ type: ['text/plain', 'application/octet-stream'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error('No transcript file was selected.');
      const file = new File(asset.uri);
      if ((asset.size ?? file.size) > MAX_IMPORT_BYTES) throw new Error('This file is too large. Choose a UTF-8 .txt transcript of at most 60,000 characters.');
      const originalTranscript = decodeTranscript(await file.bytes(), asset.name);
      setDraft({ ...draft, originalTranscript, title: draft.title || asset.name.replace(/\.txt$/i, '') });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The transcript could not be imported. Try pasting the text instead.';
      onError(/native module|ExpoDocumentPicker/i.test(message) ? 'This app build does not include file import yet. Paste your transcript or install an updated development build.' : message);
    }
    finally { setImporting(false); }
  }
  const update = (key: keyof IntakeDraft, value: string) => setDraft({ ...draft, [key]: value });
  const changeStep = (next: boolean) => { Keyboard.dismiss(); setReview(next); onStepChange(); };
  return <>
    <Text style={s.eyebrow}>{review ? '02 / REVIEW' : '01 / TRANSCRIPT'}</Text>
    <Text accessibilityRole="header" style={s.title}>{review ? 'Give this meeting context.' : 'Start with the conversation.'}</Text>
    <Text style={s.subtitle}>Paste or import a completed transcript. The original text, speaker labels, and timestamps stay unchanged.</Text>
    {!review ? <>
      <MemoryButton secondary disabled={busy || importing} onPress={() => void importText()}>{importing ? 'Opening file…' : 'Import UTF-8 .txt'}</MemoryButton>
      <Field label="Original transcript" placeholder="Paste your transcript here…" value={draft.originalTranscript} onChangeText={value => {
        if (value.length > MAX_TRANSCRIPT_CHARS) onError('The pasted transcript exceeds 60,000 characters. It has not replaced your draft. Use a shorter transcript.');
        else update('originalTranscript', value);
      }} multiline style={{ height: 260 }} editable={!busy && !importing} autoCorrect={false} />
      <Text style={s.muted}>{draft.originalTranscript.length.toLocaleString()} / 60,000 characters · Intake draft saved on this device.</Text>
      <MemoryButton disabled={!draft.originalTranscript.trim() || busy || importing} onPress={() => changeStep(true)}>Review meeting details</MemoryButton>
    </> : <>
      <Field label="Meeting title" placeholder="Cedar Lane project review" value={draft.title} maxLength={160} onChangeText={value => update('title', value)} editable={!busy} />
      <Field label="Meeting date (YYYY-MM-DD)" placeholder="2026-09-08" value={draft.date} maxLength={10} onChangeText={value => update('date', value)} autoCapitalize="none" editable={!busy} />
      <Field label="Participants (optional, comma-separated)" placeholder="Mike, Jordan" value={draft.participantsText} onChangeText={value => update('participantsText', value)} editable={!busy} />
      <Text style={s.muted}>Participants are meeting metadata. Atlas will not assign unlabeled speech to these names.</Text>
      <Panel><Text style={s.label}>Original transcript preview</Text><Text style={s.body} numberOfLines={7}>{draft.originalTranscript}</Text><Text style={s.muted}>{draft.originalTranscript.length.toLocaleString()} characters</Text><MemoryButton secondary disabled={busy} onPress={() => changeStep(false)}>Review or edit original</MemoryButton></Panel>
      <View style={s.error}><Text style={s.errorText}>Single-user development feature. Saving stores this transcript on your Mac. Processing sends the transcript and meeting details to OpenAI to organize and index them.</Text></View>
      <MemoryButton disabled={busy} onPress={() => { try { intakeFromDraft(draft); onSave(true); } catch (e) { onError((e as Error).message); } }}>{busy ? 'Saving meeting…' : 'Save & process meeting'}</MemoryButton>
      <MemoryButton secondary disabled={busy} onPress={() => { try { intakeFromDraft(draft); onSave(false); } catch (e) { onError((e as Error).message); } }}>Save without processing</MemoryButton>
    </>}
  </>;
}
