import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { Meeting, SourceReference } from './memory.types';
import { MemoryButton, Panel, s } from './memory.ui';

export const statusLabel = (meeting: Pick<Meeting, 'status' | 'stage'>) => meeting.status === 'processing'
  ? meeting.stage === 'embedding' ? 'Indexing passages…' : 'Organizing discussion…'
  : { draft: 'Saved · not processed', ready: 'Ready', failed: 'Processing failed' }[meeting.status];
export function MeetingDetail({ meeting, busy, onProcess, onAsk, onSource }: {
  meeting: Meeting; busy: boolean; onProcess: (reprocess: boolean) => void; onAsk: () => void; onSource: (source: SourceReference) => void;
}) {
  const [tab, setTab] = useState<'topics' | 'original' | 'cleaned'>('topics');
  const [expanded, setExpanded] = useState<string | null>(null);
  function refs(ids: string[]) {
    return <View style={s.row}>{ids.map(id => {
      const p = meeting.passages.find(p => p.id === id);
      if (!p) return null;
      const segments = meeting.segments?.filter(s => s.start < p.end && s.end > p.start) ?? [];
      const speakers = meeting.speakers?.filter(s => segments.some(segment => segment.speakerId === s.id)) ?? [];
      return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Open original source ${id}`} style={s.chip} onPress={() => onSource({ meetingId: meeting.id, meetingTitle: meeting.title, date: meeting.date, participants: meeting.participants, passageId: p.id, start: p.start, end: p.end, text: p.text, segments, speakers, transcriptSource: meeting.transcriptSource })}><Text style={s.chipText}>{id} ↗</Text></Pressable>;
    })}</View>;
  }
  return <>
    <Text style={s.eyebrow}>{statusLabel(meeting)}</Text>
    {meeting.transcriptSource ? <Text style={s.muted}>Original source: {meeting.transcriptSource.kind === 'live' ? 'saved live transcript' : 'saved-audio transcription'} · {meeting.transcriptSource.status} · {meeting.transcriptSource.model ?? 'Model not recorded'}. Recording: {meeting.transcriptSource.recordingId}</Text> : null}
    <Text accessibilityRole="header" style={s.title}>{meeting.title}</Text>
    <Text style={s.subtitle}>{meeting.date}{meeting.participants.length ? ` · Participants: ${meeting.participants.join(', ')}` : ' · Participants not supplied'}</Text>
    <Text style={s.muted}>{meeting.speakers?.length ? `Supplied speaker identities: ${meeting.speakers.map(p => p.nameConfirmation ? `${p.label} → ${p.nameConfirmation.name} (user confirmed)` : p.label).join(', ')}` : 'No separate speaker mappings supplied. Any labels in the original remain intact; participant names do not identify unlabeled voices.'}</Text>
    {meeting.status === 'processing' ? <Panel><View style={s.row}><ActivityIndicator /><Text accessibilityLiveRegion="polite" style={s.body}>{statusLabel(meeting)}</Text></View><Text style={s.muted}>You can leave this screen. Processing continues on the Mac backend; keep it running.</Text></Panel> : null}
    {meeting.error ? <View style={s.error}><Text accessibilityRole="alert" style={s.errorText}>{meeting.error}</Text></View> : null}
    {meeting.status === 'draft' || meeting.status === 'failed' ? <MemoryButton disabled={busy} onPress={() => onProcess(false)}>{meeting.status === 'failed' ? 'Retry processing' : 'Process meeting with OpenAI'}</MemoryButton> : null}
    {meeting.status === 'ready' ? <MemoryButton onPress={onAsk}>Ask about this meeting</MemoryButton> : null}
    <View style={s.row}>{(['topics', 'original', 'cleaned'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: tab === value }} style={[s.chip, tab === value && s.chipActive]} onPress={() => setTab(value)}><Text style={s.chipText}>{value === 'topics' ? 'Topics' : value === 'original' ? 'Original' : 'Cleaned version'}</Text></Pressable>)}</View>
    {tab === 'topics' ? <>
      <Text style={s.muted}>AI-organized notes. Tap source references to check the original wording. Proposals and decisions are labeled separately.</Text>
      {!meeting.topics.length ? <Panel><Text style={s.body}>{meeting.status === 'ready' ? 'No substantive topics were extracted. The original transcript is still available.' : 'Topics will appear after processing.'}</Text></Panel> : null}
      {meeting.topics.map(topic => <Panel key={topic.id}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: expanded === topic.id }} onPress={() => setExpanded(expanded === topic.id ? null : topic.id)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={s.heading}>{topic.title} {expanded === topic.id ? '−' : '+'}</Text></Pressable>
        <Text style={s.body}>{topic.summary.text}</Text>{refs(topic.summary.sourceIds)}
        {expanded === topic.id ? topic.items.map((item, index) => <View key={index} style={{ gap: 8 }}><View style={s.divider} /><Text style={s.eyebrow}>{item.kind.replace('_', ' ').toUpperCase()}</Text><Text style={s.body}>{item.text}</Text>{item.kind === 'action' ? <Text style={s.muted}>Owner: {item.owner ?? 'Not stated'} · Deadline: {item.deadline ?? 'Not stated'}</Text> : null}{refs(item.sourceIds)}</View>) : null}
      </Panel>)}
    </> : tab === 'original' ? <>
      <Text style={s.muted}>Unchanged original, divided into stable passages. Supplied labels and timestamps are retained; no speaker identities have been added.</Text>
      {meeting.passages.map(p => <Panel key={p.id}>{refs([p.id])}<Text selectable style={s.body}>{p.text}</Text></Panel>)}
    </> : <>
      <Text style={s.muted}>AI-cleaned wording, separate from the original. Check sources for precise wording and speaker uncertainty.</Text>
      {!meeting.cleanedPassages.length ? <Text style={s.body}>The cleaned version will appear after processing.</Text> : null}
      {meeting.cleanedPassages.map(p => <Panel key={p.passageId}>{refs([p.passageId])}{p.smallTalk ? <Text style={s.muted}>Small talk</Text> : null}<Text selectable style={s.body}>{p.text}</Text></Panel>)}
    </>}
    {meeting.status === 'ready' ? <MemoryButton secondary disabled={busy} onPress={() => onProcess(true)}>Reprocess meeting</MemoryButton> : null}
  </>;
}
