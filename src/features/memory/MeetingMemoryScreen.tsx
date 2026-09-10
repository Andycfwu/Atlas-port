import { TranscriptVersions } from './TranscriptVersions';
import type { DiarizedTranscript } from '../recorder/diarization/diarization.types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AtlasMark } from '../chat/AtlasMark';
import { RecordingMemoryIntake } from './RecordingMemoryIntake';
import type { SavedRecording } from '../recorder/recorder.types';
import { MeetingDetail, statusLabel } from './MeetingDetail';
import { MeetingIntakeScreen } from './MeetingIntakeScreen';
import { MeetingQuestions } from './MeetingQuestions';
import { createIntakeDraftRepository } from './memory.draft';
import { emptyDraft, intakeFromDraft } from './memory.intake';
import { createMeetingMemoryService } from './memory.service';
import type { IntakeDraft, MeetingIntake, Meeting, MeetingSummary, MemoryAnswer, SourceReference } from './memory.types';
import { Field, MemoryButton, MemoryFieldFocus, Panel, s } from './memory.ui';

const api = createMeetingMemoryService();
export function MeetingMemoryScreen({ active, onExit, recordingImport, diarizedImport, onImportHandled }: { active: boolean; onExit: () => void; recordingImport: SavedRecording | null; diarizedImport?: DiarizedTranscript | undefined; onImportHandled: () => void }) {
  const [questionRevisionId, setQuestionRevisionId] = useState<string | undefined>();
  const [storedScreen, setScreen] = useState<'list' | 'intake' | 'detail' | 'ask' | 'recording-intake'>('list');
  const screen = recordingImport ? 'recording-intake' : storedScreen;
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [answers, setAnswers] = useState<MemoryAnswer[]>([]);
  const [questionMeetingId, setQuestionMeetingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<IntakeDraft>(emptyDraft);
  const [draftReady, setDraftReady] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [source, setSource] = useState<{ passage: SourceReference; quote?: string } | null>(null);
  const [repository] = useState(createIntakeDraftRepository);
  const meetingId = meeting?.id;
  const processing = meeting?.status === 'processing';
  const loaded = useRef(false);
  const scroller = useRef<ScrollView>(null);
  const focusedField = useRef<number | null>(null);
  const revealField = useCallback((target: number | null) => {
    focusedField.current = target;
    const scroll = scroller.current;
    if (target !== null && scroll) scroll.getNativeScrollRef()?.measureInWindow((_x, top) => {
      // RN's responder assumes a full-screen scroll view; include our shell header
      // and safe-area offset, plus room for the next action below the field.
      if (focusedField.current === target) scroll.getScrollResponder()?.scrollResponderScrollNativeHandleToKeyboard(target, top + 120, true);
    });
  }, []);
  useEffect(() => {
    if (!active) return;
    const keyboard = Keyboard.addListener('keyboardDidShow', () => revealField(focusedField.current));
    return () => keyboard.remove();
  }, [active, revealField]);
  const reload = useCallback(async () => {
    try {
      const [list, savedAnswers] = await Promise.all([api.list(), api.answers()]);
      setMeetings(list.meetings); setAnswers(savedAnswers); setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  const loadDraft = useCallback(() => {
    try { setDraft(repository.load()); setDraftReady(true); setDraftError(null); }
    catch (e) { setDraftError((e as Error).message); }
  }, [repository]);
  useEffect(() => {
    let cancelled = false;
    // Hydrate native storage after activation; cancel if navigation changes first.
    void Promise.resolve().then(() => {
      if (!active || cancelled) return;
      if (!loaded.current) { loaded.current = true; loadDraft(); }
      void reload();
    });
    return () => { cancelled = true; };
  }, [active, loadDraft, reload]);
  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }); }, [screen, meeting?.id]);
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (source) { setSource(null); return true; }
      if (recordingImport) { onImportHandled(); setScreen('list'); return true; }
      if (screen !== 'list') { setScreen(screen === 'ask' && questionMeetingId ? 'detail' : 'list'); return true; }
      onExit(); return true;
    });
    return () => subscription.remove();
  }, [active, screen, source, questionMeetingId, onExit, recordingImport, onImportHandled]);
  useEffect(() => {
    if (!active || !meetingId || !processing) return;
    let cancelled = false, inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await api.get(meetingId);
        if (!cancelled) {
          setMeeting(next);
          if (next.status !== 'processing') void reload();
        }
      } catch (e) { if (!cancelled) setError((e as Error).message); }
      finally { inFlight = false; }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [active, meetingId, processing, reload]);
  // A selected meeting can finish while navigation is away; refresh its status on return.
  useEffect(() => {
    if (!active || !meeting?.id) return;
    let cancelled = false;
    void api.get(meeting.id).then(next => { if (!cancelled) setMeeting(next); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [active, meeting?.id]);

  function updateDraft(next: IntakeDraft) {
    setDraft(next);
    try { repository.save(next); setDraftError(null); }
    catch { setDraftError('The intake draft could not be saved on this device. Keep the original text before closing the app.'); }
  }
  async function save(process: boolean) {
    if (busy) return;
    setBusy(true); setError(null); Keyboard.dismiss();
    try {
      const result = await api.create(intakeFromDraft(draft));
      setMeeting(result.meeting); setScreen('detail'); updateDraft(emptyDraft());
      if (process) setMeeting(await api.process(result.meeting.id));
      await reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function saveRecording(input: MeetingIntake, process: boolean) {
    if (busy) return;
    setBusy(true); setError(null); Keyboard.dismiss();
    try {
      const result = await api.create(input);
      onImportHandled();
      setMeeting(result.meeting); setScreen('detail');
      if (process && (result.meeting.status !== 'ready' || result.meeting.desiredRevisionId !== result.meeting.revisionId)) setMeeting(await api.process(result.meeting.id));
      await reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function processMeeting(reprocess: boolean) {
    if (!meeting || busy) return;
    setBusy(true); setError(null);
    try { setMeeting(await api.process(meeting.id, reprocess)); await reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function openMeeting(id: string) {
    setBusy(true); setError(null);
    try { setMeeting(await api.get(id)); setScreen('detail'); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  function openSource(passage: SourceReference, quote?: string) { Keyboard.dismiss(); setSource({ passage, ...(quote ? { quote } : {}) }); }
  const quoteIndex = source?.quote ? source.passage.text.indexOf(source.quote) : -1;
  if (!active) return null;
  return <MemoryFieldFocus.Provider value={revealField}><SafeAreaView edges={['bottom']} style={s.page}>
    <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={s.content}>
      {draftError ? <View style={s.error}><Text accessibilityRole="alert" style={s.errorText}>{draftError}</Text>{!draftReady ? <MemoryButton secondary onPress={loadDraft}>Retry loading intake draft</MemoryButton> : null}</View> : null}
      {screen !== 'list' ? <MemoryButton secondary disabled={busy} onPress={() => { Keyboard.dismiss(); if (recordingImport) onImportHandled(); setScreen(screen === 'ask' && questionMeetingId ? 'detail' : 'list'); setError(null); }}>{`← ${screen === 'ask' && questionMeetingId ? 'Back to meeting' : 'All meetings'}`}</MemoryButton> : null}
      {error ? <View style={s.error}><Text accessibilityRole="alert" style={s.errorText}>{error}</Text><MemoryButton secondary onPress={() => { if (!draftReady) loadDraft(); void reload(); if (meeting && screen === 'detail') void openMeeting(meeting.id); }}>Refresh / retry connection</MemoryButton></View> : null}
      {screen === 'list' ? <>
        <AtlasMark small /><Text style={s.eyebrow}>MEETING MEMORY</Text><Text accessibilityRole="header" style={s.title}>Keep the thread.</Text><Text style={s.subtitle}>Turn a finished conversation into topics, decisions, and answers you can trace back to the source.</Text>
        <Text style={s.muted}>Single-user development · Shared by anyone using this Mac backend · Completed results are stored on the Mac.</Text>
        <MemoryButton disabled={!draftReady} onPress={() => { setError(null); setScreen('intake'); }}>{draft.originalTranscript ? 'Continue transcript intake' : 'Add a transcript'}</MemoryButton>
        <MemoryButton secondary onPress={() => { setQuestionRevisionId(undefined); setQuestionMeetingId(null); setScreen('ask'); }}>Ask across meetings</MemoryButton>
        <Field label="Find a meeting" placeholder="Title, participant, or date" value={search} onChangeText={setSearch} />
        <View style={s.row}><Text style={[s.heading, s.grow]}>Your meetings</Text><MemoryButton secondary disabled={loading} onPress={() => { setLoading(true); void reload(); }}>Refresh</MemoryButton></View>
        {loading ? <ActivityIndicator accessibilityLabel="Loading meetings" /> : null}
        {!meetings.length && !loading ? <Panel><Text style={s.body}>Your meeting library starts here.</Text><Text style={s.muted}>Add a transcript, review its details, then process it when you’re ready.</Text></Panel> : null}
        {meetings.filter(m => `${m.title} ${m.participants.join(' ')} ${m.date}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map(m => <Pressable key={m.id} accessibilityRole="button" disabled={busy} style={s.card} onPress={() => void openMeeting(m.id)}><Text style={s.eyebrow}>{statusLabel(m)}</Text><Text style={s.heading}>{m.title}</Text><Text style={s.muted}>{m.date} · {m.participants.join(', ') || 'Participants not supplied'}</Text><Text style={s.muted}>{m.transcriptSource?.kind === 'diarized_audio' ? 'Diarized source version · ' : ''}{m.topicCount ?? 0} topics · Open meeting →</Text></Pressable>)}
      </> : screen === 'intake' ? <MeetingIntakeScreen draft={draft} setDraft={updateDraft} busy={busy} onSave={p => void save(p)} onError={setError} onStepChange={() => scroller.current?.scrollTo({ y: 0, animated: false })} />
        : screen === 'recording-intake' && recordingImport ? <RecordingMemoryIntake key={`${diarizedImport?.id ?? recordingImport.id}-${recordingImport.liveTranscript?.traceId ?? recordingImport.transcriptionTraceId}`} diarized={diarizedImport} recording={recordingImport} busy={busy} onSave={(input, process) => void saveRecording(input, process)} onError={setError} />
        : screen === 'detail' && meeting ? <><TranscriptVersions key={meeting.id} meeting={meeting} onChanged={setMeeting} onConsult={id => { setQuestionRevisionId(id); setQuestionMeetingId(meeting.id); setScreen('ask'); }} /><MeetingDetail key={`${meeting.id}:${meeting.revisionId}`} meeting={meeting} busy={busy} onProcess={r => void processMeeting(r)} onRenameSpeakers={async names => {
            if (busy) return;
            setBusy(true); setError(null);
            try { const result = await api.reviseSpeakers(meeting.id, names); setMeeting(result.meeting); if (result.meeting.status !== 'ready' || result.meeting.desiredRevisionId !== result.meeting.revisionId) setMeeting(await api.process(result.meeting.id)); await reload(); }
            catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }} onAsk={() => { setQuestionRevisionId(undefined); setQuestionMeetingId(meeting.id); setScreen('ask'); }} onSource={openSource} /></>
          : screen === 'ask' ? <MeetingQuestions initialRevisionId={questionRevisionId} key={`${questionMeetingId ?? 'all'}:${questionRevisionId ?? 'current'}`} initialMeetingId={questionMeetingId} meetings={meetings} history={answers} onAsk={async (question, filters) => { const answer = await api.ask(question, filters); setAnswers(old => [answer, ...old]); return answer; }} onSource={openSource} /> : null}
    </ScrollView>
    <Modal visible={Boolean(source)} animationType="slide" onRequestClose={() => setSource(null)} presentationStyle="pageSheet">
      <SafeAreaView style={s.page}><ScrollView contentContainerStyle={s.content}>
        <MemoryButton secondary onPress={() => setSource(null)}>Close source</MemoryButton><Text style={s.eyebrow}>ORIGINAL SOURCE · {source?.passage.passageId}</Text><Text style={s.title}>{source?.passage.meetingTitle}</Text>{source?.passage.revisionId ? <Text style={s.muted}>Immutable source revision {source.passage.revisionId.slice(0, 12)} · original offsets {source.passage.start}–{source.passage.end}</Text> : null}<Text style={s.muted}>{source?.passage.date} · Speaker labels are exactly as supplied.</Text>
        {source?.passage.transcriptSource ? <Text style={s.muted}>Source: {source.passage.transcriptSource.kind === 'diarized_audio' ? 'diarized audio version' : source.passage.transcriptSource.kind === 'live_speakers' ? 'Deepgram live speaker transcript' : source.passage.transcriptSource.kind === 'live' ? 'saved live transcript' : 'saved-audio transcription'} · {source.passage.transcriptSource.status}</Text> : null}
        <Panel><Text selectable style={s.body}>{source && quoteIndex >= 0 ? <>{source.passage.text.slice(0, quoteIndex)}<Text style={s.quote}>{source.quote}</Text>{source.passage.text.slice(quoteIndex + source.quote!.length)}</> : source?.passage.text}</Text></Panel>
        {source?.passage.segments?.map(segment => {
          const speaker = source.passage.speakers?.find(speaker => speaker.id === segment.speakerId);
          return <Panel key={segment.id}><Text style={s.label}>Supplied segment evidence · {segment.id}</Text>
            <Text style={s.body}>{speaker ? `${speaker.label}${speaker.nameConfirmation ? ` → ${speaker.nameConfirmation.name} (user confirmed)` : ''}` : 'Speaker unidentified'}</Text>
            {speaker?.nameConfirmation ? <Text style={s.muted}>Name confirmed: {speaker.nameConfirmation.confirmedAt}</Text> : null}
            {segment.attribution ? <Text style={s.muted}>Attribution source: {segment.attribution.replaceAll('_', ' ')}</Text> : null}
            {segment.audio ? <Text selectable style={s.muted}>Audio reference: {segment.audio.recordingId} · {segment.audio.startMs}–{segment.audio.endMs} ms · {segment.audio.timingSource.replaceAll('_', ' ')}. Audio seeking is not connected yet.</Text> : <Text style={s.muted}>{segment.providerStream ? `Provider stream ${segment.providerStream.startMs}–${segment.providerStream.endMs} ms. No verified saved-file alignment.` : 'No audio timing supplied.'}</Text>}
          </Panel>;
        })}
      </ScrollView></SafeAreaView>
    </Modal>
  </SafeAreaView></MemoryFieldFocus.Provider>;
}
