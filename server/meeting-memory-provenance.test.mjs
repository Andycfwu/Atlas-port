import { fixtureGrouping } from './memory/fixture-provider.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { validateIntake, validateOrganization, splitPassages, contextualChunks } from './memory/transcript.mjs';
import { supportsSpeaker, directSpeakerTarget, passageProvenance } from './memory/provenance.mjs';
import { retrieve, validateAnswer, validateFilters } from './memory/retrieval.mjs';

const details = { title: 'SYNTHETIC provenance test', date: '2026-09-08', participants: ['Mike', 'Jordan'] };
const answer = (source, speaker = null, quote = source.text) => ({ scope: speaker ? 'speaker' : 'meeting', requestedSpeaker: speaker, status: 'answered', clarification: null, limitation: null,
  statements: [{ kind: 'discussion', text: 'Deterministic contract assertion; not a model quality check.', citations: [{ meetingId: source.meetingId, passageId: source.passageId, quote, speaker, segmentId: null }] }] });
const provider = {
  group: fixtureGrouping, dimensions: 2,
  models: { organization: 'deterministic-double', embedding: 'test-vector', answer: 'deterministic-double' },
  organize: async m => ({ cleanedPassages: m.passages.map(p => ({ passageId: p.id, text: p.text, smallTalk: false })), topics: [{ title: 'Property allowance', summary: { text: 'Synthetic mechanical grouping only.', sourceIds: m.passages.map(p => p.id) }, items: [] }] }),
  embed: async texts => texts.map(() => [1, 0]),
};

for (const name of ['messy-unlabeled', 'messy-flat']) test(`${name}: original, missing identity/timing and recurrent retrieval survive metadata changes`, async () => {
  const text = readFileSync(new URL(`../tests/fixtures/meeting-memory-${name}.txt`, import.meta.url), 'utf8');
  const input = validateIntake({ ...details, originalTranscript: text });
  assert.deepEqual(input.speakers, []); assert.deepEqual(input.segments, []);
  const altered = validateIntake({ ...input, participants: ['Different attendee'] });
  assert.deepEqual(altered.speakers, input.speakers); assert.deepEqual(altered.segments, input.segments);
  const passages = splitPassages(text);
  assert.equal(passages.map(p => p.text).join(''), text); assert.ok(passages.length >= 2);
  const store = new MeetingStore(':memory:');
  try {
    const m = store.create(input).meeting, service = new MeetingMemoryService(store, provider);
    service.start(m.id); await service.jobs.get(m.id);
    const result = retrieve(store.list(), id => store.chunks(id), name === 'messy-flat' ? 'B-17 allowance correction' : 'CL-204 drainage correction', [1, 0], validateFilters({ participant: 'Mike' }));
    assert.ok(result.sources.some(s => s.start === 0));
    assert.ok(result.sources.some(s => /\$26,500|\$17,800/.test(s.text)));
    for (const s of result.sources) {
      assert.equal(text.slice(s.start, s.end), s.text); assert.deepEqual(s.speakers, []); assert.deepEqual(s.segments, []);
      assert.ok(!supportsSpeaker(s, s.text, 'Mike'));
    }
    for (const c of contextualChunks(store.get(m.id))) assert.match(c.text, /metadata, not speaker attribution/);
  } finally { store.close(); }
});

test('meeting questions do not require attribution; direct speaker questions reject attendance as evidence', () => {
  const source = { meetingId: 'm', passageId: 'P0001', start: 0, end: 67, participants: ['Mike'], text: 'Mike might know the inspector. I will request the quote by Friday.' };
  assert.equal(directSpeakerTarget('What did Mike and I discuss about drainage?'), null);
  assert.equal(directSpeakerTarget('What did Mike say about drainage?'), 'Mike');
  assert.equal(directSpeakerTarget("What was Mike's view on drainage?"), 'Mike');
  assert.doesNotThrow(() => validateAnswer(answer(source), [source], 'What did Mike and I discuss?'));
  assert.throws(() => validateAnswer(answer(source, 'Mike'), [source], 'What did Mike say?'), /verified/);
  // A model cannot bypass the direct-question guard by claiming this is meeting scope.
  assert.throws(() => validateAnswer(answer(source), [source], 'What did Mike say?'), /verified/);
  const refused = validateAnswer({ scope: 'speaker', requestedSpeaker: 'Mike', status: 'insufficient_evidence', statements: [], clarification: null }, [source], 'What did Mike say?');
  assert.match(refused.limitation, /Insufficient speaker attribution/);
  assert.match(refused.limitation, /attendance/);
});

test('literal speaker evidence is restricted to the labeled line, never an adjacent unlabeled turn', () => {
  const source = { meetingId: 'm', passageId: 'P0001', start: 0, text: '[00:05] Mike: No budget is approved.\nI will order the cabinets tomorrow.' };
  const quote = '[00:05] Mike: No budget is approved.';
  assert.doesNotThrow(() => validateAnswer(answer(source, 'Mike', quote), [source], 'What did Mike say?'));
  assert.equal(supportsSpeaker(source, source.text, 'Mike'), false);
  assert.equal(supportsSpeaker(source, 'I will order the cabinets tomorrow.', 'Mike'), false);
  assert.equal(supportsSpeaker({ ...source, text: 'The note mentions Mike: no order exists.' }, 'Mike: no order exists.', 'Mike'), false);
  assert.equal(supportsSpeaker({ ...source, start: 200 }, quote, 'Mike'), false); // chunk began mid-line
});

test('anonymous speakers remain unnamed until an explicit confirmation; identities stay meeting-local', () => {
  const text = 'I will request the quote. The finish is undecided.';
  const input = validateIntake({ ...details, originalTranscript: text,
    speakers: [{ id: 'voice-a', label: 'Speaker 1', nameConfirmation: null }],
    segments: [{ id: 'segment-a', start: 0, end: text.length, speakerId: 'voice-a', attribution: 'diarization', audio: { recordingId: 'synthetic-recording', startMs: 1000, endMs: 5400, timingSource: 'transcription' } }],
  });
  const source = { meetingId: 'm1', passageId: 'P0001', start: 0, end: text.length, text, ...passageProvenance(input, { start: 0, end: text.length }) };
  assert.equal(supportsSpeaker(source, text, 'Speaker 1', 'segment-a'), true);
  assert.equal(supportsSpeaker(source, text, 'Mike', 'segment-a'), false);
  const named = structuredClone(source); named.speakers[0].nameConfirmation = { name: 'Mike', confirmedAt: '2026-09-08T12:00:00Z' };
  const result = answer(named, 'Mike'); result.statements[0].citations[0].segmentId = 'segment-a';
  assert.doesNotThrow(() => validateAnswer(result, [named], 'What did Mike say?'));
  assert.equal(supportsSpeaker(source, text, 'Mike', 'segment-a'), false); // another meeting's name mapping does not leak
  assert.equal(source.speakers[0].nameConfirmation, null);
  assert.deepEqual(source.segments[0].audio, input.segments[0].audio);
});

test('provenance rejects invented structural associations, malformed times and mislabeled boundaries', () => {
  const input = { ...details, originalTranscript: 'Speaker A: wait.\nAn unlabeled sentence.', speakers: [{ id: 'a', label: 'Speaker A' }], segments: [{ id: 's1', start: 0, end: 16, speakerId: 'a', attribution: 'transcript_label' }] };
  assert.doesNotThrow(() => validateIntake(input));
  for (const segment of [
    { ...input.segments[0], end: input.originalTranscript.length },
    { ...input.segments[0], speakerId: 'not-defined' },
    { ...input.segments[0], attribution: 'inferred-from-participants' },
    { ...input.segments[0], attribution: 'diarization' },
    { ...input.segments[0], audio: { recordingId: 'r', startMs: -1, endMs: 99, timingSource: 'transcription' } },
    { ...input.segments[0], audio: { recordingId: 'r', startMs: 5, endMs: 1, timingSource: 'estimated-from-text' } },
  ]) assert.throws(() => validateIntake({ ...input, segments: [segment] }), /provenance/);
  assert.throws(() => validateIntake({ ...input, speakers: [{ ...input.speakers[0], nameConfirmation: { name: 'Mike' } }] }), /provenance/);
});

test('speaker/audio evidence persists across restart, retries cannot replace it, legacy records stay readable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-provenance-test-')), file = join(dir, 'memory.sqlite');
  let store = new MeetingStore(file);
  const input = { ...details, originalTranscript: 'Speaker A: wait.', speakers: [{ id: 'a', label: 'Speaker A', nameConfirmation: { name: 'Mike', confirmedAt: '2026-09-08T12:00:00Z' } }], segments: [{ id: 's1', start: 0, end: 16, speakerId: 'a', attribution: 'transcript_label', audio: { recordingId: 'r', startMs: 800, endMs: 2300, timingSource: 'alignment' } }] };
  try {
    const m = store.create(input).meeting;
    store.close(); store = new MeetingStore(file);
    assert.equal(store.create(input).meeting.id, m.id);
    assert.deepEqual(store.get(m.id).segments, m.segments);
    assert.throws(() => store.create({ ...input, speakers: [], segments: [] }), /provenance was preserved/);
    assert.equal(store.list().length, 1);
    const legacyInput = { ...details, title: 'Legacy', originalTranscript: 'I cannot tell who said this.' };
    const legacy = store.create(legacyInput).meeting;
    delete legacy.speakers; delete legacy.segments;
    store.repo.putMeeting(legacy);
    assert.equal(store.create(legacyInput).meeting.id, legacy.id);
    assert.deepEqual(passageProvenance(store.get(legacy.id), legacy.passages[0]), { speakers: [], segments: [] });
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('service repairs an invented attribution once and stores an explicit insufficiency, not the invented answer', async () => {
  const store = new MeetingStore(':memory:');
  let calls = 0;
  const service = new MeetingMemoryService(store, { ...provider, answer: async (_q, sources, _s, repair) => {
    calls++;
    return repair ? { scope: 'speaker', requestedSpeaker: 'Mike', status: 'insufficient_evidence', clarification: null, statements: [] } : answer(sources[0], 'Mike');
  } });
  try {
    const m = store.create({ ...details, originalTranscript: 'The revised preliminary estimate is $26,500. No budget was approved.' }).meeting;
    service.start(m.id); await service.jobs.get(m.id);
    const result = await service.ask({ question: 'What did Mike say about the estimate?', filters: {} });
    assert.equal(calls, 2); assert.equal(result.status, 'insufficient_evidence'); assert.match(result.limitation, /attribution/);
    assert.equal(store.answers().length, 1); assert.equal(store.answers()[0].statements.length, 0);
  } finally { store.close(); }
});

test('supplied name confirmation and audio references reach organization, retrieval and persisted answer sources', async () => {
  const text = 'I will send the revised allowance sheet.';
  const store = new MeetingStore(':memory:');
  const input = { ...details, originalTranscript: text, participants: ['Different attendee'], speakers: [{ id: 'voice-a', label: 'Speaker A', nameConfirmation: { name: 'Mike', confirmedAt: '2026-09-08T12:00:00Z' } }],
    segments: [{ id: 's', start: 0, end: text.length, speakerId: 'voice-a', attribution: 'diarization', audio: { recordingId: 'synthetic-r', startMs: 340, endMs: 4300, timingSource: 'transcription' } }] };
  try {
    const m = store.create(input).meeting;
    const raw = await provider.organize(m);
    raw.topics[0].items = [{ kind: 'action', text: 'Send the allowance sheet.', sourceIds: ['P0001'], owner: 'Mike', deadline: null }];
    assert.doesNotThrow(() => validateOrganization(raw, m.passages, m));
    assert.throws(() => validateOrganization(raw, m.passages, { participants: ['Mike'] }));
    assert.match(contextualChunks(m)[0].text, /Supplied speaker evidence/);
    const service = new MeetingMemoryService(store, { ...provider, answer: async (_q, sources) => {
      const result = answer(sources[0], 'Mike'); result.statements[0].citations[0].segmentId = 's'; return result;
    } });
    service.start(m.id); await service.jobs.get(m.id);
    const result = await service.ask({ question: 'What did Mike say?', filters: { meetingIds: [m.id] } });
    assert.equal(result.status, 'answered');
    assert.deepEqual(result.sources[0].segments, m.segments); assert.deepEqual(result.sources[0].speakers, m.speakers);
    assert.deepEqual(store.answers()[0].sources, result.sources);
    assert.equal(result.sources[0].text, text); // confirmation never rewrites original
  } finally { store.close(); }
});
