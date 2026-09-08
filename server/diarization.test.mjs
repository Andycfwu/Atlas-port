import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { contextualChunks } from './memory/transcript.mjs';
import { retrieve, validateAnswer, validateFilters } from './memory/retrieval.mjs';
import { DiarizationService, openAIDiarizationProvider } from './diarization/service.mjs';
import { createDiarizedMeeting, reviseMeetingSpeakers } from './diarization/meeting.mjs';
import { resultId, validateAudioInput, validateDiarizedResult } from './diarization/result.mjs';

// Synthetic response mechanics only. These are NOT real speaker-recognition results.
const raw = () => ({ task: 'transcribe', duration: 10, text: 'Provider combined text retained independently.', segments: [
  { id: 'a', type: 'transcript.text.segment', speaker: 'A', start: 0, end: 4, text: '  I will inspect the property. ' },
  { id: 'b', type: 'transcript.text.segment', speaker: 'B', start: 3, end: 6, text: 'Maybe fifty thousand, not confirmed.\n' },
  { id: 'c', type: 'transcript.text.segment', speaker: null, start: 6, end: 7, text: 'Unclear who said this.' },
  { id: 'd', type: 'transcript.text.segment', speaker: 'overlap', overlap: true, start: 7, end: 8, text: 'Both at once.' },
  { id: 'e', type: 'transcript.text.segment', speaker: 'A', start: 8, end: 9.9, text: 'I mentioned Mike; that does not make me Mike.' },
] });
const metadata = { recordingId: 'recording-a', durationMillis: 10000, byteSize: 7, audioSha256: 'a'.repeat(64) };
const version = (recordingId = metadata.recordingId) => validateDiarizedResult(raw(), { ...metadata, recordingId, id: resultId(recordingId, metadata.audioSha256) });
const filters = validateFilters({});
const details = { title: 'SYNTHETIC room test', date: '2026-09-08', participants: ['Mike', 'Andy'] };

test('diarization keeps verbatim segments, provider text, unknown/overlap, timing and meeting-scoped anonymous IDs', () => {
  const one = version(), two = version('recording-b');
  assert.equal(one.providerText, raw().text);
  assert.equal(one.originalTranscript, raw().segments.map(s => s.text).join('\n'));
  assert.deepEqual(one.speakers.map(s => s.label), ['Speaker 1', 'Speaker 2']);
  assert.equal(one.speakers[0].nameConfirmation, null);
  assert.notEqual(one.speakers[0].id, two.speakers[0].id);
  assert.notEqual(one.segments[0].id, two.segments[0].id);
  assert.equal(one.segments[2].speakerId, null);
  assert.equal(one.segments[3].attributionStatus, 'overlap');
  assert.equal(one.segments[3].providerOverlap, true);
  assert.equal(one.segments[0].audio.endMs, 4000);
  assert.equal(one.segments[1].audio.startMs, 3000, 'overlapping times are preserved');
  for (const s of one.segments) { assert.equal(one.originalTranscript.slice(s.start, s.end), s.text); assert.equal('confidence' in s, false); }
});

test('invalid segment structures, durations, IDs, times and unsupported audio limits fail visibly', () => {
  for (const change of [
    r => { r.duration = 2; }, r => { r.segments[0].start = -1; }, r => { r.segments[0].end = 11; },
    r => { r.segments[1].id = 'a'; }, r => { r.segments[0].text = ''; }, r => { r.segments[0].speaker = ['A','B']; },
    r => { r.segments[0].end = NaN; }, r => { r.segments[1].start = -0.5; }, r => { r.segments[0].end = 0; },
    r => { r.segments[3].overlap = 'probably'; }, r => { r.segments[0].start = 2; r.segments[1].start = 1; },
  ]) { const r = raw(); change(r); assert.throws(() => validateDiarizedResult(r, { ...metadata, id: 'test' }), /invalid speaker segments/); }
  assert.throws(() => validateAudioInput({ ...metadata, byteSize: 25_000_001 }), /25 MB/);
  assert.throws(() => validateAudioInput({ ...metadata, durationMillis: 1_200_001 }), /20 minutes/);
  validateAudioInput({ ...metadata, byteSize: 25_000_000, durationMillis: 1_200_000 });
});

test('job retries reuse one audio version, preserve byte identity, and survive database restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-diarization-test-')), filename = join(directory, 'test.sqlite');
  let store = new MeetingStore(filename), calls = 0;
  const upload = index => { const path = join(directory, `${index}.m4a`); writeFileSync(path, 'audio12'); return { path, originalname: 'synthetic.m4a', size: 7 }; };
  const provider = async file => { calls++; assert.equal((await readFile(file.path)).toString(), 'audio12'); return { data: raw(), requestId: 'provider-request' }; };
  try {
    let service = new DiarizationService(store.db, provider);
    const file = upload(1), start = await service.start(file, metadata);
    await service.jobs.get(start.id);
    assert.equal(existsSync(file.path), false, 'only temporary upload is removed');
    const duplicate = await service.start(upload(2), metadata);
    assert.equal(calls, 1); assert.equal(duplicate.id, start.id); assert.equal(duplicate.status, 'ready');
    store.close(); store = new MeetingStore(filename); service = new DiarizationService(store.db, provider);
    assert.equal(service.get(start.id).result.providerRequestId, 'provider-request');
    assert.equal((await service.start(upload(3), metadata)).id, start.id);
    assert.equal(calls, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('failed and interrupted identification can retry; repeated in-flight requests share one job', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-diarization-retry-')), store = new MeetingStore(':memory:');
  let release, calls = 0;
  const service = new DiarizationService(store.db, async () => { calls++; if (calls === 1) throw new Error('Synthetic provider failure'); await new Promise(resolve => { release = resolve; }); return { data: raw() }; });
  const upload = i => { const path = join(directory, `${i}.m4a`); writeFileSync(path, 'audio12'); return { path, size: 7 }; };
  try {
    const first = await service.start(upload(1), metadata); await service.jobs.get(first.id);
    assert.equal(service.get(first.id).status, 'failed');
    const second = await service.start(upload(2), metadata), duplicate = await service.start(upload(3), metadata);
    assert.equal(second.id, first.id); assert.equal(duplicate.id, first.id); assert.equal(calls, 2);
    release(); await service.jobs.get(second.id);
    assert.equal(service.get(first.id).status, 'ready');
    service.put({ ...service.get(first.id), status: 'processing' });
    const restarted = new DiarizationService(store.db, async () => ({ data: raw() }));
    assert.equal(restarted.get(first.id).status, 'failed');
    assert.match(restarted.get(first.id).error, /restart/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('provider request uses whole audio, diarized_json and provider-managed chunking without known identities', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-diarization-provider-')), path = join(directory, 'synthetic.m4a');
  writeFileSync(path, 'audio12');
  const create = (input, options) => {
    assert.equal(input.model, 'gpt-4o-transcribe-diarize'); assert.equal(input.response_format, 'diarized_json');
    assert.equal(input.chunking_strategy, 'auto'); assert.equal(input.file.size, 7);
    assert.equal(input.known_speaker_names, undefined); assert.equal(input.prompt, undefined);
    assert.equal(options.maxRetries, 0);
    return { withResponse: async () => ({ data: raw(), request_id: 'synthetic-id' }) };
  };
  try { assert.equal((await openAIDiarizationProvider({ audio: { transcriptions: { create } } })({ path, originalname: 'synthetic.m4a' }, new AbortController().signal)).requestId, 'synthetic-id'); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

test('meeting names persist, corrections create idempotent source versions and preserve old citations/index', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-diarization-names-')), filename = join(directory, 'test.sqlite');
  let store = new MeetingStore(filename);
  try {
    const v = version(), diarization = { get: () => ({ status: 'ready', result: v }) };
    const input = { ...details, diarizationId: v.id, originalTranscript: 'Do not use this pasted text' };
    const anonymous = createDiarizedMeeting(store, diarization, input).meeting;
    assert.equal(anonymous.originalTranscript, v.originalTranscript);
    assert.equal(anonymous.speakers[0].nameConfirmation, null, 'participant names cannot assign voices');
    const oldChunks = contextualChunks(anonymous).map(c => ({ ...c, embedding: [1,0] }));
    store.complete(anonymous.id, { topics: [], cleanedPassages: [] }, oldChunks, { embedding: 'synthetic' });
    const oldSources = retrieve([store.get(anonymous.id)], id => store.chunks(id), 'property', [1,0], filters).sources;
    store.saveAnswer({ id: 'old-answer', statements: [], sources: oldSources });
    const names = [{ speakerId: v.speakers[0].id, name: 'Mike' }];
    const named = reviseMeetingSpeakers(store, anonymous.id, names).meeting;
    assert.notEqual(named.id, anonymous.id);
    assert.equal(reviseMeetingSpeakers(store, anonymous.id, names).meeting.id, named.id);
    assert.equal(store.get(anonymous.id).speakers[0].nameConfirmation, null);
    assert.deepEqual(store.chunks(anonymous.id), oldChunks);
    assert.equal(store.questionMeetings(filters).some(m => m.id === anonymous.id), false);
    const corrected = reviseMeetingSpeakers(store, named.id, [{ speakerId: v.speakers[0].id, name: 'Andy' }]).meeting;
    assert.equal(corrected.originalTranscript, anonymous.originalTranscript);
    assert.deepEqual(corrected.segments, anonymous.segments);
    store.close(); store = new MeetingStore(filename);
    assert.equal(store.get(corrected.id).speakers[0].nameConfirmation.name, 'Andy');
    assert.equal(store.answers()[0].sources[0].speakers[0].nameConfirmation, null);
    assert.equal(store.questionMeetings(filters).filter(m => m.transcriptSource?.kind === 'diarized_audio').length, 1);
    const cleared = reviseMeetingSpeakers(store, corrected.id, [{ speakerId: v.speakers[0].id, name: null }]).meeting;
    assert.equal(cleared.id, anonymous.id);
    assert.equal(store.questionMeetings(filters)[0].id, anonymous.id, 'clearing names explicitly selects the anonymous source again');
    assert.throws(() => reviseMeetingSpeakers(store, named.id, [{ speakerId: version('other').speakers[0].id, name: 'Wrong meeting' }]), /speaker in this meeting/);
    assert.throws(() => reviseMeetingSpeakers(store, named.id, [{ speakerId: v.speakers[0].id, name: 'Sam' }, { speakerId: v.speakers[1].id, name: 'Sam' }]), /same confirmed name/);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('speaker-specific citations require the selected segment, anonymous or user-confirmed, never a mentioned name', () => {
  const store = new MeetingStore(':memory:');
  try {
    const v = version();
    const meeting = createDiarizedMeeting(store, { get: () => ({ status: 'ready', result: v }) }, { ...details, diarizationId: v.id }).meeting;
    const sources = retrieve([{ ...meeting, status: 'ready' }], () => contextualChunks(meeting).map(c => ({ ...c, embedding: [1,0] })), 'property', [1,0], filters).sources;
    const citation = { meetingId: meeting.id, passageId: sources[0].passageId, quote: v.segments[0].text, speaker: 'Speaker 1', segmentId: v.segments[0].id };
    const answer = c => ({ status: 'answered', scope: 'speaker', requestedSpeaker: c.speaker, statements: [{ text: 'They will inspect the property.', kind: 'discussion', citations: [c] }] });
    assert.equal(validateAnswer(answer(citation), sources, 'What did Speaker 1 say?').status, 'answered');
    assert.throws(() => validateAnswer(answer({ ...citation, speaker: 'Mike' }), sources, 'What did Mike say?'), /verified/);
    assert.throws(() => validateAnswer(answer({ ...citation, segmentId: v.segments[1].id }), sources), /verified/);
    assert.throws(() => validateAnswer(answer({ ...citation, quote: v.segments[2].text }), sources), /verified/);
    const named = reviseMeetingSpeakers(store, meeting.id, [{ speakerId: v.speakers[0].id, name: 'Mike' }]).meeting;
    const namedSources = retrieve([{ ...named, status: 'ready' }], () => contextualChunks(named).map(c => ({ ...c, embedding: [1,0] })), 'property', [1,0], filters).sources;
    const confirmed = { ...citation, meetingId: named.id, speaker: 'Mike' };
    assert.equal(validateAnswer(answer(confirmed), namedSources, 'What did Mike say?').status, 'answered');
  } finally { store.close(); }
});

test('anonymous speaker question spanning separate recordings asks which meeting without a model call', async () => {
  const store = new MeetingStore(':memory:');
  try {
    for (const recordingId of ['one','two']) {
      const v = version(recordingId);
      const m = createDiarizedMeeting(store, { get: () => ({ status: 'ready', result: v }) }, { ...details, diarizationId: v.id }).meeting;
      store.update(m.id, { status: 'ready' });
    }
    const service = new MeetingMemoryService(store, { models: {}, embed() { assert.fail('Ambiguous identity should be clarified first'); } });
    const answer = await service.ask({ question: 'What did Speaker 1 say?', filters });
    assert.equal(answer.status, 'clarification'); assert.match(answer.clarification, /Which meeting/);
  } finally { store.close(); }
});

test('HTTP multipart → job → explicit diarized intake → name correction preserves the source', async () => {
  const { default: express } = await import('express');
  const { createDiarizationRouter } = await import('./diarization/router.mjs');
  const { createMemoryRouter } = await import('./memory/router.mjs');
  const store = new MeetingStore(':memory:');
  let calls = 0;
  const service = new DiarizationService(store.db, async file => { calls++; assert.equal((await readFile(file.path)).toString(), 'audio12'); return { data: raw() }; });
  const app = express(); app.use('/v1/diarizations', createDiarizationRouter(service));
  app.use('/v1/memory', createMemoryRouter(new MeetingMemoryService(store, {}), service));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const form = () => { const f = new FormData(); f.append('file', new Blob(['audio12'], { type: 'audio/mp4' }), 'synthetic.m4a'); f.append('recordingId', metadata.recordingId); f.append('durationMillis', '10000'); return f; };
  const post = async (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const invalid = await fetch(base + '/v1/diarizations', { method: 'POST', headers: { 'X-Atlas-Audio-Bytes': '100' }, body: form() });
    assert.equal(invalid.status, 400); assert.equal(calls, 0);
    const created = await fetch(base + '/v1/diarizations', { method: 'POST', headers: { 'X-Atlas-Audio-Bytes': '7' }, body: form() });
    assert.equal(created.status, 202); const job = await created.json(); await service.jobs.get(job.id);
    const ready = await (await fetch(base + '/v1/diarizations/' + job.id)).json();
    assert.equal(ready.status, 'ready');
    const imported = await (await post('/v1/memory/meetings', { ...details, diarizationId: ready.id, originalTranscript: 'Mike: fake plain-text alignment', speakerNames: [{ speakerId: ready.result.speakers[0].id, name: 'Mike' }] })).json();
    assert.equal(imported.meeting.originalTranscript, ready.result.originalTranscript);
    assert.equal(imported.meeting.speakers[0].nameConfirmation.name, 'Mike');
    const fixed = await (await post(`/v1/memory/meetings/${imported.meeting.id}/speakers`, { speakerNames: [{ speakerId: ready.result.speakers[0].id, name: 'Andy' }] })).json();
    assert.notEqual(fixed.meeting.id, imported.meeting.id);
    assert.equal(store.get(imported.meeting.id).speakers[0].nameConfirmation.name, 'Mike');
    assert.equal(fixed.meeting.speakers[0].nameConfirmation.name, 'Andy');
    const spoofed = await post('/v1/memory/meetings', { ...details, originalTranscript: 'Speaker 1: fake', transcriptSource: imported.meeting.transcriptSource });
    assert.equal(spoofed.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
