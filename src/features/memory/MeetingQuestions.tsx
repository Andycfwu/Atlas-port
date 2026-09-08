import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { MeetingFilters, MeetingSummary, MemoryAnswer, SourceReference } from './memory.types';
import { Field, MemoryButton, Panel, s } from './memory.ui';

export function MeetingQuestions({ meetings, initialMeetingId, history, onAsk, onSource }: {
  meetings: MeetingSummary[]; initialMeetingId: string | null; history: MemoryAnswer[];
  onAsk: (question: string, filters: MeetingFilters) => Promise<MemoryAnswer>;
  onSource: (source: SourceReference, quote?: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [filters, setFilters] = useState<MeetingFilters>({ meetingIds: initialMeetingId ? [initialMeetingId] : [], participant: '', dateFrom: '', dateTo: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [answer, setAnswer] = useState<MemoryAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    if (!question.trim() || busy) return;
    setBusy(true); setError(null); setAnswer(null);
    try { setAnswer(await onAsk(question, filters)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const scope = filters.meetingIds.length ? meetings.filter(m => filters.meetingIds.includes(m.id)).map(m => m.title).join(', ') : 'All ready meetings';
  return <>
    <Text style={s.eyebrow}>ASK MEETING MEMORY</Text><Text accessibilityRole="header" style={s.title}>What do you want to recall?</Text>
    <Text style={s.subtitle}>Ask what a meeting covered even if its voices are unlabeled. Asking what a specific person said requires speaker evidence; the participant list only records attendance.</Text>
    <Panel><Text style={s.label}>Search scope</Text><Text style={s.body}>{scope}</Text>
      <MemoryButton secondary disabled={busy} onPress={() => setShowFilters(!showFilters)}>{showFilters ? 'Hide filters' : 'Meeting, participant & date filters'}</MemoryButton>
      {showFilters ? <>
        <View style={s.row}><Pressable accessibilityRole="button" accessibilityState={{ selected: !filters.meetingIds.length }} disabled={busy} style={[s.chip, !filters.meetingIds.length && s.chipActive]} onPress={() => setFilters({ ...filters, meetingIds: [] })}><Text style={s.chipText}>All meetings</Text></Pressable>
          {meetings.filter(m => m.publishedGenerationId || m.status === 'ready').map(m => <Pressable key={m.id} accessibilityRole="button" accessibilityState={{ selected: filters.meetingIds.includes(m.id) }} disabled={busy} style={[s.chip, filters.meetingIds.includes(m.id) && s.chipActive]} onPress={() => setFilters({ ...filters, meetingIds: filters.meetingIds.includes(m.id) ? filters.meetingIds.filter(id => id !== m.id) : [...filters.meetingIds, m.id] })}><Text style={s.chipText}>{m.title} · {m.date}</Text></Pressable>)}</View>
        <Field label="Meeting participant (attendance, optional)" placeholder="Mike" value={filters.participant} onChangeText={participant => setFilters({ ...filters, participant })} editable={!busy} />
        <Field label="From date (YYYY-MM-DD, optional)" placeholder="2026-01-01" value={filters.dateFrom} onChangeText={dateFrom => setFilters({ ...filters, dateFrom })} editable={!busy} maxLength={10} />
        <Field label="To date (YYYY-MM-DD, optional)" placeholder="2026-12-31" value={filters.dateTo} onChangeText={dateTo => setFilters({ ...filters, dateTo })} editable={!busy} maxLength={10} />
      </> : null}
    </Panel>
    <Field label="Your question" placeholder="What did we discuss about 42 Cedar Lane?" value={question} onChangeText={setQuestion} multiline style={{ minHeight: 100 }} editable={!busy} maxLength={1200} />
    <MemoryButton disabled={busy || !question.trim()} onPress={() => void send()}>{busy ? 'Finding evidence…' : 'Ask Atlas'}</MemoryButton>
    {busy ? <View style={s.row}><ActivityIndicator /><Text accessibilityLiveRegion="polite" style={s.muted}>Searching original passages and checking sources…</Text></View> : null}
    {error ? <View style={s.error}><Text accessibilityRole="alert" style={s.errorText}>{error}</Text><MemoryButton secondary onPress={() => void send()}>Retry question</MemoryButton></View> : null}
    {answer ? <Panel>
      <Text style={s.eyebrow}>{answer.status === 'answered' ? 'ANSWER WITH SOURCES' : answer.status === 'clarification' ? 'CLARIFICATION NEEDED' : 'INSUFFICIENT EVIDENCE'}</Text>
      <Text style={s.heading}>{answer.question}</Text>
      <Text style={s.muted}>Scope at time of answer: {answer.filters.meetingIds.length ? answer.filters.meetingIds.map(id => meetings.find(m => m.id === id)?.title ?? 'Saved meeting').join(', ') : 'All ready meetings'}{answer.filters.participant ? ` · Participant: ${answer.filters.participant}` : ''}{answer.filters.dateFrom || answer.filters.dateTo ? ` · ${answer.filters.dateFrom || 'Any date'} to ${answer.filters.dateTo || 'Any date'}` : ''}</Text>
      {answer.limitation ? <Text style={s.body}>{answer.limitation}</Text> : null}
      {answer.status !== 'answered' && (answer.clarification || !answer.limitation) ? <Text style={s.body}>{answer.clarification ?? (answer.readyMeetingCount ? 'The retrieved passages do not provide enough evidence to answer this question. Try a more specific topic or adjust the filters.' : 'No processed meetings match these filters. Process a meeting or adjust the filters first.')}</Text> : null}
      {answer.statements.map((statement, index) => <View key={index} style={{ gap: 10 }}>
        <View style={s.divider} /><Text style={s.eyebrow}>{statement.kind.toUpperCase()}</Text><Text selectable style={s.body}>{statement.text}</Text>
        {statement.citations.map((citation, ci) => {
          const source = answer.sources.find(p => p.meetingId === citation.meetingId && p.passageId === citation.passageId);
          if (!source) return null;
          return <Pressable accessibilityRole="button" accessibilityLabel={`Open source ${source.passageId} in ${source.meetingTitle}`} key={ci} style={s.chip} onPress={() => onSource(source, citation.quote)}><Text style={s.chipText}>{source.meetingTitle} · {source.passageId} ↗</Text><Text numberOfLines={3} style={s.muted}>“{citation.quote}”</Text></Pressable>;
        })}
      </View>)}
      {answer.retrievalTruncated ? <Text style={s.muted}>The source limit was reached. Narrow the meeting or date filters for more complete coverage.</Text> : null}
      {answer.model ? <Text style={s.muted}>AI answer grounded in retrieved text. Check the original passages for context.</Text> : null}
    </Panel> : null}
    {history.length ? <><Text style={s.heading}>Saved questions</Text>{history.slice(0, 12).map(item => <Pressable accessibilityRole="button" key={item.id} disabled={busy} style={s.card} onPress={() => { setAnswer(item); setQuestion(item.question); setError(null); }}><Text style={s.body}>{item.question}</Text><Text style={s.muted}>{new Date(item.createdAt).toLocaleDateString()} · {item.status.replace('_', ' ')}</Text></Pressable>)}</> : null}
  </>;
}
