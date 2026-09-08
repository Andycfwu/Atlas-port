import { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import { MemoryButton, Panel, s } from '../../memory/memory.ui';
import { SpeakerPassages } from '../../memory/SpeakerPassages';
import type { SavedRecording } from '../recorder.types';
import { getDiarization, identifyRecording } from './diarization.service';
import type { DiarizationJob, DiarizedTranscript } from './diarization.types';

export function DiarizationPanel({ recording, onPersist, onUse }: {
  recording: SavedRecording; onPersist: (id: string, job: DiarizationJob) => Promise<void>; onUse: (version: DiarizedTranscript) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const job = recording.diarization;
  useEffect(() => {
    if (!job?.id || job.status !== 'processing') return;
    let cancelled = false, polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try { const next = await getDiarization(job.id!); if (!cancelled) { await onPersist(recording.id, next); setError(null); } }
      catch (e) { if (!cancelled) setError((e as Error).message); }
      finally { polling = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [job?.id, job?.status, onPersist, recording.id]);
  async function identify() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(null);
    try {
      await onPersist(recording.id, { id: null, recordingId: recording.id, status: 'uploading', error: null });
      await onPersist(recording.id, await identifyRecording(recording));
    } catch (e) {
      const message = (e as Error).message; setError(message);
      try { await onPersist(recording.id, { id: null, recordingId: recording.id, status: 'failed', error: message }); } catch { /* Error stays visible; existing result is untouched. */ }
    } finally { submitting.current = false; setBusy(false); }
  }
  return <Panel>
    <Text style={s.heading}>Identify speakers</Text>
    <Text style={s.muted}>Analyze the saved audio with OpenAI. Up to 25 MB / 20 minutes. Original audio and existing text stay intact. Voice labels may be wrong, especially during overlap.</Text>
    {job?.status === 'processing' || busy || job?.status === 'uploading' ? <Text accessibilityLiveRegion="polite" style={s.body}>{job?.status === 'processing' ? 'Identifying speakers on the Mac… You can leave this screen.' : 'Uploading saved audio…'}</Text> : null}
    {error || job?.error ? <Text accessibilityRole="alert" style={s.errorText}>{error ?? job?.error}</Text> : null}
    {job?.status !== 'ready' && job?.status !== 'processing' ? <MemoryButton disabled={busy || job?.status === 'uploading'} onPress={() => void identify()}>{job?.status === 'failed' ? 'Retry Identify speakers' : 'Identify speakers'}</MemoryButton> : null}
    {job?.status === 'processing' && error ? <MemoryButton secondary onPress={() => { if (job.id) void getDiarization(job.id).then(next => onPersist(recording.id, next)).then(() => setError(null)).catch(e => setError(e.message)); }}>Refresh identification</MemoryButton> : null}
    {recording.diarizedTranscripts?.map(version => <Panel key={version.id}>
      <Text style={s.eyebrow}>DIARIZED AUDIO · {version.model}</Text>
      <Text style={s.muted}>Anonymous labels apply only to this recording. Assign optional names when you use this version in Meeting Memory.</Text>
      <SpeakerPassages original={version.originalTranscript} segments={version.segments} speakers={version.speakers} />
      <MemoryButton onPress={() => onUse(version)}>Use diarized version in Meeting Memory</MemoryButton>
    </Panel>)}
  </Panel>;
}
