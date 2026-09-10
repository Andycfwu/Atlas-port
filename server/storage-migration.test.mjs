import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { processingConfig } from './memory/pipeline.mjs';
import { validateDiarizedResult } from './diarization/result.mjs';
import { createDiarizedMeeting, reviseMeetingSpeakers } from './diarization/meeting.mjs';
import { RelationalMemory } from './storage/relational.mjs';
import { compareSnapshots, legacySnapshot, migrateRelational, schemaVersion, verifyIntegrity } from './storage/migration.mjs';

// Synthetic data and deterministic doubles verify storage mechanics, not model quality.
const provider = {
  dimensions: 2, models: { organization: 'storage-double', embedding: 'storage-vector-double', answer: 'storage-answer-double' },
  group: async ({ passages, priorTopics }) => ({ groups: [{ title: 'Property discussion', continuationOf: priorTopics[0]?.id ?? null, sourceIds: passages.filter(p => !p.text.includes('Weather is sunny')).map(p => p.id) }], omissions: passages.filter(p => p.text.includes('Weather is sunny')).map(p => ({ sourceId: p.id, reason: 'small_talk' })) }),
  organize: async m => ({ cleanedPassages: m.passages.map(p => ({ passageId: p.id, text: p.text, smallTalk: p.text.includes('Weather is sunny') })), topics: [] }),
  embed: async texts => texts.map(() => [0.6, 0.8]),
  answer: async (_question, sources) => ({ status: 'answered', scope: 'meeting', requestedSpeaker: null, statements: [{ text: 'SYNTHETIC storage verification.', kind: 'discussion', citations: [{ meetingId: sources[0].meetingId, passageId: sources[0].passageId, quote: sources[0].text, speaker: null, segmentId: null }] }] }),
};
const details = { title: 'SYNTHETIC migration meeting', date: '2026-09-10', participants: ['Mike', 'Andy'] };
async function run(service, id, force = false) { service.start(id, force); await service.jobs.get(id); return service.store.get(id); }
const legacyDDL = `
CREATE TABLE meetings(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,fingerprint TEXT,source_key TEXT,payload TEXT NOT NULL);
CREATE TABLE memory_revisions(id TEXT PRIMARY KEY,meeting_id TEXT,payload TEXT NOT NULL);
CREATE TABLE memory_generations(id TEXT PRIMARY KEY,meeting_id TEXT,revision_id TEXT,payload TEXT NOT NULL);
CREATE TABLE memory_source_chunks(id TEXT PRIMARY KEY,generation_id TEXT,payload TEXT NOT NULL);
CREATE TABLE memory_jobs(id TEXT PRIMARY KEY,meeting_id TEXT,payload TEXT NOT NULL);
CREATE TABLE chunks(meeting_id TEXT,passage_id TEXT,payload TEXT NOT NULL,PRIMARY KEY(meeting_id,passage_id));
CREATE TABLE diarizations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE diarized_selections(source_id TEXT PRIMARY KEY,meeting_id TEXT NOT NULL);
CREATE TABLE answers(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,payload TEXT NOT NULL);`;
function legacyDatabase(snapshot, filename = ':memory:') {
  const db = new DatabaseSync(filename); db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;'); db.exec(legacyDDL);
  for (const [table, rows] of Object.entries(snapshot)) for (const record of rows) {
    const { value, ...columns } = record, row = value === undefined ? columns : { ...columns, payload: JSON.stringify(value) };
    db.prepare(`INSERT INTO ${table}(${Object.keys(row)}) VALUES(${Object.keys(row).map(() => '?')})`).run(...Object.values(row));
  }
  return db;
}
async function fixture() {
  const store = new MeetingStore(':memory:');
  try {
    const service = new MeetingMemoryService(store, provider);
    const text = '\uFEFFproperty 🙂 maybe fifty no wait sixty thousand not approved\r\nWeather is sunny.\r\nI will inspect the property.';
    const live = store.create({ ...details, originalTranscript: text, transcriptSource: { kind: 'live', recordingId: 'synthetic-recording', status: 'completed', traceId: null, model: null } }).meeting;
    assert.equal((await run(service, live.id)).status, 'ready');
    const answer = await service.ask({ question: 'property estimate', filters: { meetingIds: [live.id] } });
    assert.equal(answer.status, 'answered');
    const historicalRevision = store.get(live.id).revisionId;
    store.versions.revise(live.id, { ...details, originalTranscript: text.replace('sixty', 'forty') });
    assert.equal((await run(service, live.id)).status, 'ready');
    const post = store.create({ ...details, originalTranscript: 'Property forty thousand, tentative.', transcriptSource: { kind: 'saved_audio', recordingId: 'synthetic-recording', status: 'completed', traceId: null, model: null } }).meeting;
    const raw = { task: 'transcribe', duration: 5, text: 'Separate raw provider text.', segments: [
      { id: 'a', type: 'transcript.text.segment', speaker: 'A', start: 0, end: 2, text: 'I will inspect the property.' },
      { id: 'b', type: 'transcript.text.segment', speaker: 'B', start: 1.5, end: 4, text: 'Maybe forty thousand, not approved.' },
      { id: 'c', type: 'transcript.text.segment', speaker: null, start: 4, end: 5, text: 'Unclear who said this.' },
    ] };
    const result = validateDiarizedResult(raw, { id: 'b'.repeat(64), recordingId: 'synthetic-recording', durationMillis: 5000, byteSize: 7, audioSha256: 'a'.repeat(64) });
    store.repo.putDiarization({ id: result.id, recordingId: result.recordingId, status: 'ready', attempts: 1, error: null, result });
    const anonymous = createDiarizedMeeting(store, { get: id => store.repo.diarization(id) }, { ...details, diarizationId: result.id }).meeting;
    const named = reviseMeetingSpeakers(store, anonymous.id, [{ speakerId: result.speakers[0].id, name: 'Mike' }]).meeting;
    assert.equal((await run(service, named.id)).status, 'ready');
    const namedAnswer = await service.ask({ question: 'property inspection', filters: { meetingIds: [named.id] } });
    const corrected = reviseMeetingSpeakers(store, named.id, [{ speakerId: result.speakers[0].id, name: 'Andy' }]).meeting;
    // A durable failed replacement retains its previous publication and checkpoint.
    const job = store.versions.begin(live.id, processingConfig(provider), true);
    store.versions.checkpoint(job, { ...job.checkpoint, syntheticCheckpoint: true }, 'grouping');
    store.versions.fail(job, new Error('Synthetic interrupted provider request'));
    const snapshot = store.repo.snapshot();
    // A genuinely older, unversioned record with absent optional historical fields.
    const legacy = { id: 'old-optional', title: 'SYNTHETIC older meeting', date: '2026-09-01', originalTranscript: 'No.', passages: [{ id: 'P0001', start: 0, end: 3, text: 'No.' }], status: 'draft', topics: [], cleanedPassages: [], createdAt: '2026-09-01', updatedAt: '2026-09-01' };
    snapshot.meetings.push({ id: legacy.id, user_id: 'single-user-development', fingerprint: 'old-fingerprint', source_key: null, value: legacy });
    snapshot.answers.push({ id: 'old-snapshot', user_id: 'single-user-development', value: { id: 'old-snapshot', statements: [], sources: [{ meetingId: legacy.id, passageId: 'P0001', start: 0, end: 3, text: 'No.' }] } });
    return { snapshot, live, post, anonymous, named, corrected, result, answer, namedAnswer, historicalRevision, job };
  } finally { store.close(); }
}
const f = await fixture();

test('v1 migration preserves every logical record, original UTF-16 span, omission, vector, name and publication; repeat is a no-op', () => {
  const db = legacyDatabase(f.snapshot);
  try {
    const before = legacySnapshot(db), report = migrateRelational(db), repo = new RelationalMemory(db);
    assert.equal(report.version, 2); compareSnapshots(before, repo.snapshot()); assert.deepEqual(verifyIntegrity(db), { foreignKeys: 'ok', integrity: 'ok' });
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'migration_old_%'").get().n, 0);
    assert.equal(db.prepare("SELECT type FROM sqlite_master WHERE name='chunks'").get().type, 'view');
    assert.equal(Object.hasOwn(repo.meeting('old-optional'), 'speakers'), false);
    assert.equal(repo.meeting(f.post.id).transcriptSource.kind, 'saved_audio');
    assert.equal(repo.revision(f.historicalRevision).transcriptSource.kind, 'live');
    assert.equal(repo.diarization(f.result.id).result.providerText, f.result.providerText);
    for (const r of db.prepare('SELECT u.*,r.original_text transcript FROM source_units u JOIN memory_revisions r ON r.id=u.revision_id').all()) assert.equal(r.original_text, r.transcript.slice(r.start_offset, r.end_offset));
    assert.ok(db.prepare('SELECT count(*) n FROM omissions').get().n > 0);
    for (const e of db.prepare('SELECT * FROM embeddings').all()) { assert.equal(e.dimensions, 2); assert.equal(e.model, provider.models.embedding); assert.equal(Buffer.from(e.vector).readDoubleLE(0), 0.6); assert.equal(e.vector.length, 16); }
    assert.equal(repo.job(f.job.id).checkpoint.syntheticCheckpoint, true);
    const first = repo.snapshot(); assert.equal(migrateRelational(db).alreadyApplied, true); compareSnapshots(first, repo.snapshot());
    for (const table of ['meetings', 'memory_revisions', 'memory_source_chunks', 'memory_jobs', 'answers', 'diarizations']) assert.equal(db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === 'payload'), false);
  } finally { db.close(); }
});

for (const stage of ['sources', 'answers', 'commit']) test(`interruption at ${stage} rolls back DDL and all data; the same migration can retry`, () => {
  const db = legacyDatabase(f.snapshot);
  try {
    const before = legacySnapshot(db);
    assert.throws(() => migrateRelational(db, { faultAfter: stage }), /Injected migration interruption/);
    assert.equal(schemaVersion(db), 0); compareSnapshots(before, legacySnapshot(db));
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'migration_old_%'").get().n, 0);
    assert.equal(migrateRelational(db).version, 2); compareSnapshots(before, new RelationalMemory(db).snapshot());
  } finally { db.close(); }
});

test('unsafe historical data is reported by ID, without dropping or printing transcript text', () => {
  for (const mode of ['json', 'offset', 'source', 'processing']) {
    const db = legacyDatabase(f.snapshot);
    try {
      const id = mode === 'offset' ? f.historicalRevision : f.live.id;
      if (mode === 'json') db.prepare('UPDATE meetings SET payload=? WHERE id=?').run('{PRIVATE TRANSCRIPT', id);
      if (mode === 'offset') { const v = JSON.parse(db.prepare('SELECT payload FROM memory_revisions WHERE id=?').get(id).payload); v.units[0].end++; db.prepare('UPDATE memory_revisions SET payload=? WHERE id=?').run(JSON.stringify(v), id); }
      if (mode === 'source') { const v = JSON.parse(db.prepare('SELECT payload FROM meetings WHERE id=?').get(id).payload); v.sourceTopics[0].sourceIds = ['does-not-exist']; db.prepare('UPDATE meetings SET payload=? WHERE id=?').run(JSON.stringify(v), id); }
      if (mode === 'processing') { const v = JSON.parse(db.prepare('SELECT payload FROM meetings WHERE id=?').get(id).payload); v.status = 'processing'; db.prepare('UPDATE meetings SET payload=? WHERE id=?').run(JSON.stringify(v), id); }
      const allBefore = db.prepare('SELECT * FROM meetings ORDER BY id').all();
      assert.throws(() => migrateRelational(db), error => { assert.ok(error.message.includes('record')); assert.ok(!error.message.includes('PRIVATE TRANSCRIPT')); return true; });
      assert.deepEqual(db.prepare('SELECT * FROM meetings ORDER BY id').all(), allBefore); assert.equal(schemaVersion(db), 0);
    } finally { db.close(); }
  }
});

test('SQLite-aware WAL backup includes committed WAL content and leaves the original writable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-wal-migration-')), filename = join(dir, 'old.sqlite'), copy = join(dir, 'backup.sqlite');
  const db = legacyDatabase(f.snapshot, filename);
  try {
    db.exec('PRAGMA wal_autocheckpoint=0');
    const answer = { id: 'wal-answer', statements: [], sources: [] };
    db.prepare('INSERT INTO answers VALUES(?,?,?)').run(answer.id, 'single-user-development', JSON.stringify(answer));
    const expected = legacySnapshot(db); db.prepare('VACUUM INTO ?').run(copy);
    const trial = new DatabaseSync(copy);
    try { compareSnapshots(expected, legacySnapshot(trial)); migrateRelational(trial); compareSnapshots(expected, new RelationalMemory(trial).snapshot()); }
    finally { trial.close(); }
    assert.equal(schemaVersion(db), 0); db.exec('BEGIN IMMEDIATE; ROLLBACK');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('reopened migrated store keeps historical names/citations, resumes failed jobs, publishes atomically and deletes dependents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-reopen-migration-')), filename = join(dir, 'memory.sqlite');
  const db = legacyDatabase(f.snapshot, filename); migrateRelational(db); db.close();
  let store = new MeetingStore(filename);
  try {
    const service = new MeetingMemoryService(store, provider);
    assert.equal(store.get(f.named.id).speakers[0].nameConfirmation.name, 'Mike');
    assert.equal(store.get(f.corrected.id).speakers[0].nameConfirmation.name, 'Andy');
    assert.equal(store.get(f.anonymous.id).speakers[0].nameConfirmation, null);
    assert.deepEqual(store.repo.answer(f.namedAnswer.id), f.namedAnswer);
    const citation = f.answer.statements[0].citations[0];
    assert.equal(store.versions.source(f.live.id, citation.revisionId, citation.passageId).text, f.answer.sources[0].text);
    const before = store.get(f.live.id).publishedGenerationId;
    service.provider = { ...provider, embed: async () => { throw new Error('Synthetic embedding failure'); } };
    assert.equal((await run(service, f.live.id)).status, 'failed'); assert.equal(store.get(f.live.id).publishedGenerationId, before);
    service.provider = provider; const ready = await run(service, f.live.id);
    assert.equal(ready.status, 'ready'); assert.equal(ready.publishedGenerationId, f.job.generationId);
    const count = store.db.prepare('SELECT count(*) n FROM memory_source_chunks').get().n; await run(service, f.live.id);
    assert.equal(store.db.prepare('SELECT count(*) n FROM memory_source_chunks').get().n, count);
    const answer = await service.ask({ question: 'property estimate', filters: { meetingIds: [f.live.id] } }); assert.equal(answer.status, 'answered');
    store.close(); store = new MeetingStore(filename); assert.deepEqual(store.repo.answer(answer.id), answer);
    assert.equal(store.versions.source(f.live.id, citation.revisionId, citation.passageId).text, f.answer.sources[0].text);
    const interrupted = store.versions.begin(f.live.id, processingConfig(provider), true);
    store.close(); store = new MeetingStore(filename); assert.equal(store.versions.job(interrupted.id).status, 'failed');
    assert.equal(store.get(f.live.id).publishedGenerationId, ready.publishedGenerationId);
    store.versions.delete(f.live.id); assert.equal(store.repo.answer(answer.id), null); assert.equal(store.repo.answer(f.answer.id), null);
    for (const table of ['memory_revisions', 'memory_generations', 'memory_jobs', 'artifacts', 'memory_source_chunks', 'evidence_sets']) assert.equal(store.db.prepare(`SELECT count(*) n FROM ${table} WHERE meeting_id=?`).get(f.live.id).n, 0);
    assert.equal(store.repo.diarization(f.result.id).status, 'ready', 'meeting deletion does not delete independent audio-identification results');
    verifyIntegrity(store.db);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('relational constraints protect original evidence, names, citation generations and publication pointers', () => {
  const db = legacyDatabase(f.snapshot); migrateRelational(db); const repo = new RelationalMemory(db);
  try {
    assert.throws(() => db.prepare('UPDATE memory_revisions SET original_text=? WHERE id=?').run('changed', f.historicalRevision), /immutable/);
    assert.throws(() => db.exec("UPDATE speakers SET confirmed_name='Guessed'"), /new evidence version/);
    assert.throws(() => db.exec("UPDATE source_units SET original_text='changed'"), /immutable/);
    assert.throws(() => db.prepare('UPDATE meetings SET job_id=? WHERE id=?').run('missing-job', f.live.id), /FOREIGN KEY/);
    assert.throws(() => db.prepare('UPDATE meetings SET published_generation_id=? WHERE id=?').run(f.job.generationId, f.live.id), /completely published/);
    const bad = structuredClone(f.answer); bad.id = 'bad-generation'; bad.statements[0].citations[0].generationId = 'another-generation';
    assert.throws(() => repo.putAnswer(bad), /no exact saved source/); assert.equal(repo.answer(bad.id), null);
    verifyIntegrity(db);
  } finally { db.close(); }
});
