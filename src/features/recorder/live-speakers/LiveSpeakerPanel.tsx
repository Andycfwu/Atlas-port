import { displayedSpeakerPassages } from './live-speakers.model';
import { formatSpeakerIds, hasSpeakerTimingOverlap, speakerEvidence, speakerLabel } from './speaker-evidence';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Panel, s } from '../../memory/memory.ui';
import { audioTime } from '../../memory/SpeakerPassages';
import type { LiveSpeakerSnapshot, SavedLiveSpeakerTranscript } from './live-speakers.model';
const palette = ['#A44318', '#245DA2', '#297452', '#824B92', '#846321', '#8D4058'];
export function LiveSpeakerPanel({ snapshot, status, error, saved = false }: {
  snapshot?: LiveSpeakerSnapshot | undefined; status: string; error?: string | null; saved?: boolean;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [showSpeakerIds, setShowSpeakerIds] = useState(false);
  const results = [...(snapshot?.finalResults ?? []), ...(snapshot?.provisionalResults ?? [])];
  const connectionIds = snapshot?.sessions.map(session => session.connectionId) ?? [];
  return <Panel>
    <Text style={s.heading}>{saved ? 'Saved live speaker labels' : 'Live speaker labels — experimental'}</Text>
    <Text accessibilityLiveRegion="polite" style={s.label}>{status === 'finishing' ? 'Finalizing speech…' : status.toUpperCase()}</Text>
    <Text style={s.muted}>Deepgram · Nova-3 · Labels are anonymous estimates, including on finalized text. Names have not been verified.</Text>
    {error ? <Text accessibilityRole="alert" style={s.errorText}>{error}</Text> : null}
    {!results.some(r => r.text) ? <Text style={s.body}>{status === 'idle' ? 'Labeled text will appear after you start recording.' : status === 'completed' ? 'No text was returned. The saved audio can be transcribed separately.' : 'No speaker text received yet. Local audio is independent of this connection.'}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: showSpeakerIds }} onPress={() => setShowSpeakerIds(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={s.label}>{showSpeakerIds ? 'Hide' : 'Show'} speaker ID diagnostics</Text></Pressable>
    {showSpeakerIds ? <Text style={s.muted}>Provider IDs come from Deepgram word results: ID 0 is Speaker 1, ID 1 is Speaker 2. The same ID can incorrectly cover different voices. IDs below are scoped to each connection; no identities are inferred.</Text> : null}
    <ScrollView nestedScrollEnabled style={{ maxHeight: saved ? 440 : 300 }}>
      {results.map(result => {
        const displayed = displayedSpeakerPassages(result, snapshot?.finalResults ?? []);
        const ids = showSpeakerIds ? speakerEvidence(result, snapshot?.finalResults ?? []) : null;
        return <View key={`${result.id}:${result.isFinal}`} style={{ gap: 12, marginTop: 14 }}>
        <Text style={s.muted}>{result.isFinal ? 'Finalized speech · speaker estimate' : 'PROVISIONAL · text and labels may change'}</Text>
        {result.timingWarning ? <Text style={s.muted}>Provider interim word timing was inconsistent. Original provisional text is retained; speaker labels are withheld until a valid result arrives.</Text> : null}
        {ids ? <Text selectable style={s.muted}>Provider word IDs: {formatSpeakerIds(ids.providerIds)} · Atlas groups: {formatSpeakerIds(ids.groupedIds)} · Display: {formatSpeakerIds(ids.displayedIds, true)}{ids.labelsWithheld ? ' · Labels withheld to preserve original wording or unvalidated timing.' : ''}</Text> : null}
        {displayed.map(passage => {
          const color = passage.providerSpeaker === null ? '#59616D' : palette[passage.providerSpeaker % palette.length];
          const overlap = hasSpeakerTimingOverlap(passage, displayed);
          return <View key={passage.id} style={{ borderLeftWidth: 3, borderLeftColor: color, paddingLeft: 10, gap: 4 }}>
            <Text style={[s.label, { color }]}>{speakerLabel(passage.providerSpeaker)}{connectionIds.length > 1 ? ` · Connection ${connectionIds.indexOf(result.connectionId) + 1}` : ''}</Text>
            <Text style={s.muted}>Stream {audioTime(passage.startMs)}–{audioTime(passage.endMs)}{overlap ? ' · Timing overlap' : ''}</Text>
            <Text selectable style={s.body}>{passage.text}</Text>
          </View>;
        })}
      </View>; })}
    </ScrollView>
    <Text style={s.muted}>Times use the provider audio stream, not a verified position in the saved file. Speaker numbers are scoped to this recording and connection.</Text>
    {snapshot?.diagnostics ? <Text selectable style={s.muted}>Audio diagnostics · received {snapshot.diagnostics.client.receivedSamples ?? 0} samples · sent {snapshot.diagnostics.client.sentSamples ?? 0} · backend forwarded {snapshot.diagnostics.server.sentSamples ?? 0} · peak {snapshot.diagnostics.client.peak ?? 0} · RMS {snapshot.diagnostics.client.rms ?? 0}. Counts describe the live stream, not proof of saved-file equality.</Text> : null}
    {saved ? <>
      <Pressable accessibilityRole="button" onPress={() => setShowOriginal(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={s.label}>{showOriginal ? 'Hide' : 'View'} original provider text</Text></Pressable>
      {showOriginal ? <ScrollView nestedScrollEnabled style={{ maxHeight: 300 }}>{results.map(result => <View key={`${result.id}:${result.isFinal}`}><Text style={s.muted}>{result.isFinal ? 'Finalized text' : 'Unfinalized text'}</Text><Text selectable style={s.body}>{result.text}</Text></View>)}</ScrollView> : null}
    </> : null}
    {saved ? <Text style={s.muted}>Kept separately from OpenAI live and saved-audio versions. Choose a source with Add to Meeting Memory. If this live version misses speech, use Transcribe Recording or Identify speakers below; these explicit actions may incur provider charges and preserve the live version.</Text> : null}
  </Panel>;
}
export function SavedLiveSpeakerPanels({ versions }: { versions: SavedLiveSpeakerTranscript[] | undefined }) {
  return <>{versions?.map(version => <LiveSpeakerPanel key={version.id} snapshot={version} status={version.status} error={version.errorMessage} saved />)}</>;
}
