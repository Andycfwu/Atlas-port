import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { createMeetingMemoryService } from './memory.service';
import type { Meeting, MeetingIntake, TranscriptRevisionSummary } from './memory.types';
import { MemoryButton, Panel, s } from './memory.ui';
const api = createMeetingMemoryService();
export function TranscriptVersions({ meeting, onChanged, onConsult }: { meeting: Meeting; onChanged: (meeting: Meeting) => void; onConsult: (revisionId: string) => void }) {
  const [versions, setVersions] = useState<TranscriptRevisionSummary[]>([]);
  const [comparison, setComparison] = useState<(MeetingIntake & { id: string }) | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { let active = true; void api.revisions(meeting.id).then(v => { if (active) setVersions(v); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [meeting.id, meeting.desiredRevisionId, meeting.publishedGenerationId]);
  async function choose(id: string) {
    setBusy(true); setError('');
    try { await api.selectRevision(meeting.id, id); onChanged(await api.process(meeting.id)); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <Panel><Text style={s.heading}>Transcript versions</Text>
    <Text style={s.muted}>One meeting, separate sources. The primary published revision is used by default. Changing it explicitly processes that source with OpenAI; the old publication and its citations survive failures.</Text>
    {versions.map(v => <Panel key={v.id}><Text style={s.body}>{v.transcriptSource?.kind ?? 'Imported text'} · {v.transcriptSource?.model ?? 'Model not supplied'} · {v.characters} characters</Text><Text style={s.muted}>{v.id.slice(0,12)} · {v.id === meeting.revisionId ? 'Primary published source' : v.id === meeting.desiredRevisionId ? 'Selected for processing' : 'Alternative source'}</Text>
      <MemoryButton secondary disabled={busy} onPress={() => { setBusy(true); void api.revision(meeting.id, v.id).then(setComparison).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>Compare original wording</MemoryButton>
      {v.id !== meeting.revisionId ? <MemoryButton disabled={busy || meeting.status === 'processing'} onPress={() => void choose(v.id)}>Make primary & process</MemoryButton> : null}
      {v.generationId ? <MemoryButton secondary disabled={busy} onPress={() => onConsult(v.id)}>Ask using only this version</MemoryButton> : null}
    </Panel>)}
    {comparison ? <Panel><Text style={s.heading}>{comparison.originalTranscript === meeting.originalTranscript ? 'Wording is identical; provenance may differ.' : 'Wording differs. Neither transcript is assumed correct; review the audio.'}</Text><Text style={s.label}>Primary original</Text><Text selectable style={s.body}>{meeting.originalTranscript}</Text><Text style={s.label}>Compared original · {comparison.id.slice(0, 12)}</Text><Text selectable style={s.body}>{comparison.originalTranscript}</Text><MemoryButton secondary onPress={() => setComparison(null)}>Close comparison</MemoryButton></Panel> : null}
    {error ? <Text accessibilityRole="alert" style={s.errorText}>{error}</Text> : null}
  </Panel>;
}
