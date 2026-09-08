import { digest, MemoryError } from '../memory/transcript.mjs';

function applyNames(speakers, supplied = []) {
  if (!Array.isArray(supplied) || supplied.length > speakers.length) throw new MemoryError('Invalid meeting speaker names.');
  const changes = new Map();
  for (const entry of supplied) {
    if (!entry || !speakers.some(s => s.id === entry.speakerId) || changes.has(entry.speakerId)
      || (entry.name !== null && (typeof entry.name !== 'string' || entry.name.length > 100))) throw new MemoryError('Use a name of at most 100 characters for a speaker in this meeting.');
    changes.set(entry.speakerId, entry.name?.trim() || null);
  }
  const next = speakers.map(s => {
    if (!changes.has(s.id)) return s;
    const name = changes.get(s.id);
    return { ...s, nameConfirmation: name ? (s.nameConfirmation?.name === name ? s.nameConfirmation : { name, confirmedAt: new Date().toISOString() }) : null };
  });
  const names = next.filter(s => s.nameConfirmation).map(s => s.nameConfirmation.name.toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new MemoryError('Two voices have the same confirmed name. Use distinct names or leave an uncertain voice anonymous.');
  for (const s of next) if (s.nameConfirmation && next.some(other => other.id !== s.id && other.label.toLocaleLowerCase() === s.nameConfirmation.name.toLocaleLowerCase())) throw new MemoryError('A confirmed name cannot be another anonymous speaker label.');
  return next;
}
function source(id, recordingId, providerRequestId, model, speakers) {
  const namesKey = digest(JSON.stringify(speakers.map(s => [s.id, s.nameConfirmation?.name ?? null])));
  return { kind: 'diarized_audio', recordingId, traceId: providerRequestId, model, status: 'completed', diarizationId: id, namesKey };
}
export function createDiarizedMeeting(store, diarization, input) {
  const job = diarization.get(input.diarizationId);
  if (job.status !== 'ready' || !job.result) throw new MemoryError('Wait for speaker identification to finish before using its transcript.');
  const r = job.result, speakers = applyNames(r.speakers, input.speakerNames);
  const transcriptSource = source(r.id, r.recordingId, r.providerRequestId, r.model, speakers);
  const created = store.create({ title: input.title, date: input.date, participants: input.participants,
    originalTranscript: r.originalTranscript, speakers, segments: r.segments, transcriptSource,
    sourceKey: `diarized:${r.id}:${transcriptSource.namesKey}` });
  store.selectDiarized(created.meeting); return created;
}
export function reviseMeetingSpeakers(store, meetingId, supplied) {
  const original = store.get(meetingId);
  if (original.transcriptSource?.kind !== 'diarized_audio') throw new MemoryError('Name correction requires a separately diarized audio source. Live text cannot receive guessed speaker labels.');
  const speakers = applyNames(original.speakers, supplied);
  const previous = original.transcriptSource;
  const transcriptSource = source(previous.diarizationId, previous.recordingId, previous.traceId, previous.model, speakers);
  const created = store.create({ title: original.title, date: original.date, participants: original.participants,
    originalTranscript: original.originalTranscript, segments: original.segments, speakers, transcriptSource,
    sourceKey: `diarized:${previous.diarizationId}:${transcriptSource.namesKey}` });
  store.selectDiarized(created.meeting); return created;
}
