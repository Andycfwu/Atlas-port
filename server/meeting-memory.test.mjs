import { fixtureGrouping } from './memory/fixture-provider.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { createMemoryRouter } from './memory/router.mjs';
import { contextualChunks, splitPassages, validateOrganization } from './memory/transcript.mjs';
import { lexicalScore, matchesFilters, retrieve, validateAnswer, validateFilters } from './memory/retrieval.mjs';

const original = readFileSync(new URL('../tests/fixtures/meeting-memory-synthetic.txt', import.meta.url), 'utf8');
const input = { originalTranscript: original, title: 'SYNTHETIC · Cedar Lane', date: '2026-09-08', participants: ['Mike', 'Jordan'] };
// Deterministic doubles below exercise contracts and mechanics, NOT model quality.
function organization(meeting) {
  const ids = meeting.passages.filter(p => /Cedar Lane|CL-204|\$26,500/.test(p.text)).map(p => p.id);
  return { cleanedPassages: meeting.passages.map(p => ({ passageId: p.id, text: p.text, smallTalk: false })), topics: [{ title: '42 Cedar Lane drainage', summary: { text: 'Synthetic deterministic organization fixture.', sourceIds: ids }, items: [] }] };
}
const provider = {
  group: fixtureGrouping, dimensions: 2,
  models: { organization: 'test-double', embedding: 'test-vector', answer: 'test-double' },
  organize: async m => organization(m),
  embed: async texts => texts.map(() => [1, 0]),
  answer: async () => ({ status: 'insufficient_evidence', clarification: null, statements: [] }),
};

test('passages preserve every original character, supplied labels and stable offsets', () => {
  const text = '\ufeff[01:00] Mike: Café 🙂\r\nUnlabeled: maybe, not agreed.\n'.repeat(90);
  const passages = splitPassages(text);
  assert.equal(passages.map(p => p.text).join(''), text);
  for (const p of passages) assert.equal(text.slice(p.start, p.end), p.text);
  assert.deepEqual(passages, splitPassages(text));
  assert.ok(passages.length > 1);
});

test('organization validates coverage, numeric fidelity, owners and all source IDs; allows many topics per passage', () => {
  const passages = splitPassages(original), meeting = { passages };
  const raw = organization(meeting);
  const clean = validateOrganization(raw, passages);
  assert.ok(clean.topics[0].sourceIds.length > 1);
  assert.doesNotThrow(() => validateOrganization({ ...raw, topics: [...raw.topics, raw.topics[0]] }, passages));
  assert.throws(() => validateOrganization({ ...raw, cleanedPassages: raw.cleanedPassages.slice(1) }, passages), /incomplete/);
  const lostNumber = structuredClone(raw); lostNumber.cleanedPassages[0].text = 'A property discussion.';
  assert.throws(() => validateOrganization(lostNumber, passages), /number or timestamp/);
  assert.doesNotThrow(() => validateOrganization({ cleanedPassages: [{ passageId: 'P0001', text: 'Estimate: $26,500; preliminary.', smallTalk: false }], topics: [] }, [{ id: 'P0001', text: 'Estimate: $26,500. Preliminary.' }]));
  const badRef = structuredClone(raw); badRef.topics[0].summary.sourceIds = ['P9999'];
  assert.throws(() => validateOrganization(badRef, passages), /references/);
  const inventedOwner = structuredClone(raw); inventedOwner.topics[0].items = [{ text: 'Do it', kind: 'action', sourceIds: [passages[0].id], owner: 'Made-up owner', deadline: null }];
  assert.throws(() => validateOrganization(inventedOwner, passages), /unsupported/);
});

test('embedding input contains original surrounding context, not just isolated sentences or summaries', () => {
  const meeting = { ...input, passages: splitPassages(original) };
  const chunks = contextualChunks(meeting);
  assert.ok(chunks[1].contextSourceIds.length >= 3);
  for (const id of chunks[1].contextSourceIds) assert.ok(chunks[1].text.includes(meeting.passages.find(p => p.id === id).text));
  assert.ok(chunks[0].text.includes('metadata, not speaker attribution'));
});

test('hybrid retrieval expands recurrent property topics and preserves passage identity', async () => {
  const store = new MeetingStore(':memory:');
  try {
    const { meeting } = store.create(input);
    const service = new MeetingMemoryService(store, provider); service.start(meeting.id); await service.jobs.get(meeting.id);
    const ready = store.get(meeting.id);
    const result = retrieve([ready], id => store.chunks(id), 'What changed in the 42 Cedar Lane drainage estimate?', [1, 0], validateFilters({}));
    assert.ok(result.sources.some(s => /My rough estimate is \$18,000/.test(s.text)));
    assert.ok(result.sources.some(s => /correct my earlier number/.test(s.text)));
    for (const source of result.sources) assert.equal(original.slice(source.start, source.end), source.text);
    assert.ok(lexicalScore('CL-204 26,500', 'CL-204 costs $26,500') > lexicalScore('CL-204 26,500', 'unrelated generic drainage'));
  } finally { store.close(); }
});

test('filters enforce selected meetings, explicit participant metadata and valid date bounds', () => {
  const meeting = { ...input, id: 'm1' };
  assert.ok(matchesFilters(meeting, validateFilters({ participant: 'mike', dateFrom: '2026-09-01', dateTo: '2026-09-30', meetingIds: ['m1'] })));
  assert.equal(matchesFilters(meeting, validateFilters({ participant: 'Unlabeled speaker' })), false);
  assert.equal(matchesFilters(meeting, validateFilters({ meetingIds: ['m2'] })), false);
  assert.throws(() => validateFilters({ dateFrom: '2026-02-30' }));
  assert.throws(() => validateFilters({ dateFrom: '2026-09-10', dateTo: '2026-09-01' }));
});

test('answers require a correct source, exact original quote and citations on every statement', () => {
  const sources = [{ meetingId: 'm1', passageId: 'P0001', text: 'Mike: The $26,500 is still preliminary.' }];
  const valid = { status: 'answered', clarification: null, statements: [{ kind: 'proposal', text: 'The estimate remains preliminary.', citations: [{ meetingId: 'm1', passageId: 'P0001', quote: 'The $26,500 is still preliminary.' }] }] };
  assert.doesNotThrow(() => validateAnswer(valid, sources));
  for (const patch of [{ quote: 'Approved $26,500' }, { meetingId: 'another-meeting' }, { passageId: 'P9999' }]) {
    const bad = structuredClone(valid); Object.assign(bad.statements[0].citations[0], patch);
    assert.throws(() => validateAnswer(bad, sources), /verified/);
  }
  assert.throws(() => validateAnswer({ ...valid, statements: [{ ...valid.statements[0], citations: [] }] }, sources));
  assert.throws(() => validateAnswer({ ...valid, status: 'insufficient_evidence' }, sources));
});

test('create, retry, failed writes and restart keep one meeting and one published source-chunk index', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-memory-test-')), file = join(dir, 'memory.sqlite');
  let store = new MeetingStore(file);
  try {
    const { meeting } = store.create({ ...input, sourceKey: 'synthetic/test-1' });
    assert.equal(store.create({ ...input, sourceKey: 'synthetic/test-1' }).meeting.id, meeting.id);
    assert.throws(() => store.create({ ...input, title: 'Changed', sourceKey: 'synthetic/test-1' }), /different/);
    let failEmbedding = true;
    const service = new MeetingMemoryService(store, { ...provider, embed: async texts => { if (failEmbedding) throw new Error('SENSITIVE UPSTREAM PAYLOAD'); return provider.embed(texts); } });
    service.start(meeting.id); service.start(meeting.id); await service.jobs.get(meeting.id);
    assert.equal(store.get(meeting.id).status, 'failed');
    assert.ok(!store.get(meeting.id).error.includes('SENSITIVE'));
    assert.equal(store.chunks(meeting.id).length, 0);
    failEmbedding = false; service.start(meeting.id); await service.jobs.get(meeting.id);
    const ready = store.get(meeting.id), chunks = store.chunks(meeting.id);
    assert.equal(ready.attempts, 2); assert.deepEqual(new Set(chunks.flatMap(c => c.sourceIds)), new Set(ready.passages.map(p => p.id)));
    service.start(meeting.id); assert.equal(service.jobs.size, 0); // ready processing is idempotent
    assert.throws(() => store.complete(meeting.id, organization(ready), [chunks[0], chunks[0]], provider.models));
    assert.equal(store.chunks(meeting.id).length, chunks.length); // transaction rollback retained index
    assert.equal(store.get(meeting.id).originalTranscript, original);
    await service.ask({ question: 'Unsupported synthetic question', filters: { meetingIds: ['missing'] } });
    store.update(meeting.id, { status: 'processing' });
    store.close(); store = new MeetingStore(file);
    assert.equal(store.list().length, 1); assert.equal(store.answers().length, 1);
    assert.equal(store.get(meeting.id).status, 'failed'); assert.match(store.get(meeting.id).error, /restart/);
    assert.equal(store.get(meeting.id).originalTranscript, original);
    const restarted = new MeetingMemoryService(store, provider); restarted.start(meeting.id); await restarted.jobs.get(meeting.id);
    assert.equal(store.chunks(meeting.id).length, chunks.length);
    store.close(); store = new MeetingStore(file);
    assert.equal(store.get(meeting.id).status, 'ready');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP intake, process polling, questions and error contract use the real pipeline', async () => {
  const store = new MeetingStore(':memory:'), service = new MeetingMemoryService(store, provider);
  const app = express(); app.use('/v1/memory', createMemoryRouter(service));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v1/memory`;
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const created = await post('/meetings', input); assert.equal(created.status, 201);
    const { meeting } = await created.json();
    assert.equal((await post('/meetings', input)).status, 200);
    assert.equal((await post(`/meetings/${meeting.id}/process`, {})).status, 202);
    await service.jobs.get(meeting.id);
    const loaded = await (await fetch(`${base}/meetings/${meeting.id}`)).json(); assert.equal(loaded.status, 'ready');
    const answer = await (await post('/questions', { question: 'Unsupported?', filters: {} })).json();
    assert.equal(answer.status, 'insufficient_evidence'); assert.equal(answer.statements.length, 0);
    const invalid = await post('/questions', { question: '   ' }); assert.equal(invalid.status, 400);
    assert.ok((await invalid.json()).error.message);
    assert.equal((await (await fetch(`${base}/meetings`)).json()).mode, 'single-user-development');
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});

test('invalid model citations get one correction attempt, and never persist after repeated failure', async () => {
  const store = new MeetingStore(':memory:');
  try {
    const { meeting } = store.create(input);
    let calls = 0, alwaysFail = false;
    const service = new MeetingMemoryService(store, { ...provider, answer: async (_q, sources, _signal, repair) => {
      calls += 1;
      const source = sources[0];
      return { status: 'answered', clarification: null, statements: [{ kind: 'discussion', text: 'Deterministic contract fixture.', citations: [{ meetingId: source.meetingId, passageId: source.passageId, quote: alwaysFail || !repair ? 'THIS QUOTE DOES NOT EXIST' : source.text.slice(0, 60) }] }] };
    } });
    service.start(meeting.id); await service.jobs.get(meeting.id);
    const result = await service.ask({ question: 'Cedar Lane', filters: {} });
    assert.equal(result.status, 'answered'); assert.equal(calls, 2); assert.equal(store.answers().length, 1);
    alwaysFail = true; calls = 0;
    await assert.rejects(service.ask({ question: 'Cedar Lane', filters: {} }), /verified/);
    assert.equal(calls, 2); assert.equal(store.answers().length, 1);
  } finally { store.close(); }
});

test('cross-meeting retrieval preserves both meeting IDs and applies participant filters before ranking', async () => {
  const store = new MeetingStore(':memory:');
  try {
    const first = store.create(input).meeting;
    const second = store.create({ ...input, title: 'SYNTHETIC second date', date: '2026-09-09', participants: ['Sam'] }).meeting;
    const service = new MeetingMemoryService(store, provider);
    service.start(first.id); service.start(second.id); await Promise.all([...service.jobs.values()]);
    const all = retrieve(store.list(), id => store.chunks(id), 'Cedar Lane', [1, 0], validateFilters({}));
    assert.deepEqual(new Set(all.sources.map(s => s.meetingId)), new Set([first.id, second.id]));
    const filtered = retrieve(store.list(), id => store.chunks(id), 'Cedar Lane', [1, 0], validateFilters({ participant: 'Mike' }));
    assert.deepEqual(new Set(filtered.sources.map(s => s.meetingId)), new Set([first.id]));
  } finally { store.close(); }
});
