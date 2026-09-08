import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { digest, MemoryError, validateIntake } from './transcript.mjs';
import { sourceUnits, validateUnits, validateVectors, embeddingInput, assembleChunks } from './pipeline.mjs';

const now = () => new Date().toISOString();
const unavailable = () => { throw new MemoryError('This exact historical source is unavailable or was deleted. No replacement was substituted.', 410, 'MEMORY_SOURCE_UNAVAILABLE'); };
export class MemoryVersions {
  constructor(store, filename) {
    this.store = store; this.db = store.db;
    const migrated = this.db.prepare("SELECT name FROM sqlite_master WHERE name='memory_revisions'").get();
    if (!migrated && filename !== ':memory:' && this.db.prepare('SELECT count(*) AS n FROM meetings').get().n && !existsSync(`${filename}.pre-source-v1.bak`)) this.db.prepare('VACUUM INTO ?').run(`${filename}.pre-source-v1.bak`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_revisions (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_generations (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, revision_id TEXT NOT NULL REFERENCES memory_revisions(id) ON DELETE CASCADE, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_source_chunks (id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES memory_generations(id) ON DELETE CASCADE, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_jobs (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, payload TEXT NOT NULL);`);
    this.transaction(() => {
      for (const meeting of store.list()) this.ensure(meeting);
      // One local backend owns jobs. Persisted checkpoints survive restart; explicit Retry
      // resumes the same generation. A previously published generation remains readable.
      for (const { payload } of this.db.prepare('SELECT payload FROM memory_jobs').all()) {
        const job = JSON.parse(payload);
        if (job.status === 'processing') this.fail(job, new MemoryError('Processing was interrupted by a backend restart. Retry resumes the saved generation.', 503, 'MEMORY_INTERRUPTED'));
      }
    });
  }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value = fn(); this.db.exec('COMMIT'); return value; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  revisionData(meeting) {
    const { id, title, date, participants, originalTranscript, speakers = [], segments = [], transcriptSource } = meeting;
    const revisionId = digest(JSON.stringify([id, originalTranscript, speakers, segments, transcriptSource ?? null, title, date, participants]));
    return { id: revisionId, meetingId: id, title, date, participants, originalTranscript, speakers, segments, ...(transcriptSource ? { transcriptSource } : {}), contentHash: digest(originalTranscript), units: sourceUnits(originalTranscript, revisionId, segments), legacyPassages: meeting.passages ?? [], createdAt: now() };
  }
  ensure(meeting) {
    if (meeting.revisionId) return meeting;
    const revision = this.revisionData(meeting);
    this.db.prepare('INSERT OR IGNORE INTO memory_revisions VALUES (?, ?, ?)').run(revision.id, meeting.id, JSON.stringify(revision));
    let publishedGenerationId = null;
    const legacyChunks = this.db.prepare('SELECT payload FROM chunks WHERE meeting_id=? ORDER BY passage_id').all(meeting.id).map(r => JSON.parse(r.payload));
    if (meeting.status === 'ready' || (legacyChunks.length && meeting.models?.embedding)) {
      publishedGenerationId = digest(`legacy:${meeting.id}:${revision.id}`);
      const chunks = legacyChunks;
      const generation = { id: publishedGenerationId, revisionId: revision.id, meetingId: meeting.id, legacy: true, status: 'published', config: { processor: 'legacy-context-v0', embedding: { model: meeting.models?.embedding, dimensions: chunks[0]?.embedding?.length ?? 512, version: 'openai-float-v1', normalization: 'cosine-nonzero' } }, result: { topics: meeting.topics, cleanedPassages: meeting.cleanedPassages, passages: meeting.passages, sourceTopics: [], omissions: [], models: meeting.models }, createdAt: meeting.updatedAt };
      this.db.prepare('INSERT OR IGNORE INTO memory_generations VALUES (?, ?, ?, ?)').run(generation.id, meeting.id, revision.id, JSON.stringify(generation));
      for (const [i, c] of chunks.entries()) this.db.prepare('INSERT OR IGNORE INTO memory_source_chunks VALUES (?, ?, ?)').run(`${generation.id}:legacy:${i}`, generation.id, JSON.stringify({ ...c, id: `${generation.id}:legacy:${i}`, generationId: generation.id, revisionId: revision.id }));
    }
    return this.store.update(meeting.id, { revisionId: revision.id, desiredRevisionId: revision.id, publishedGenerationId, pipelineSchema: 1 });
  }
  revision(meetingId, revisionId) {
    this.store.get(meetingId);
    const row = this.db.prepare('SELECT payload FROM memory_revisions WHERE id=? AND meeting_id=?').get(revisionId, meetingId);
    if (!row) unavailable();
    return JSON.parse(row.payload);
  }
  revise(meetingId, input) {
    const current = this.store.get(meetingId);
    const data = validateIntake({ ...input, sourceKey: null });
    // Text replacement never carries old diarization/recording evidence by guessed alignment.
    if (data.transcriptSource?.kind === 'diarized_audio') throw new MemoryError('Use the audio identification version action for diarized sources.');
    const revision = this.revisionData({ ...data, id: meetingId });
    return this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO memory_revisions VALUES (?, ?, ?)').run(revision.id, meetingId, JSON.stringify(revision));
      return this.store.update(meetingId, { desiredRevisionId: revision.id, jobId: null, status: current.publishedGenerationId ? 'ready' : 'draft', stage: 'revision_saved', error: null });
    });
  }
  generation(meetingId, id) {
    this.store.get(meetingId);
    const row = this.db.prepare('SELECT payload FROM memory_generations WHERE id=? AND meeting_id=?').get(id, meetingId);
    if (!row) unavailable(); return JSON.parse(row.payload);
  }
  chunks(meetingId, generationId = this.store.get(meetingId).publishedGenerationId) {
    if (!generationId) return [];
    this.generation(meetingId, generationId);
    return this.db.prepare('SELECT payload FROM memory_source_chunks WHERE generation_id=? ORDER BY rowid').all(generationId).map(r => JSON.parse(r.payload));
  }
  chunk(meetingId, id) {
    this.store.get(meetingId);
    const row = this.db.prepare('SELECT c.payload FROM memory_source_chunks c JOIN memory_generations g ON g.id=c.generation_id WHERE c.id=? AND g.meeting_id=?').get(id, meetingId);
    if (!row) unavailable(); const chunk = JSON.parse(row.payload);
    return { ...chunk, embedding: undefined };
  }
  source(meetingId, revisionId, sourceId) {
    const revision = this.revision(meetingId, revisionId);
    const unit = [...revision.units, ...revision.legacyPassages].find(p => p.id === sourceId);
    if (!unit || unit.text !== revision.originalTranscript.slice(unit.start, unit.end)) unavailable();
    return { ...unit, meetingId, revisionId };
  }
  job(id) { const row = this.db.prepare('SELECT payload FROM memory_jobs WHERE id=?').get(id); return row ? JSON.parse(row.payload) : null; }
  writeJob(job) { this.db.prepare('INSERT OR REPLACE INTO memory_jobs VALUES (?, ?, ?)').run(job.id, job.meetingId, JSON.stringify(job)); return job; }
  begin(meetingId, config, force = false) {
    return this.transaction(() => {
      const meeting = this.ensure(this.store.get(meetingId));
      const revisionId = meeting.desiredRevisionId;
      const key = digest(JSON.stringify([meetingId, revisionId, config]));
      const prior = this.job(key);
      if (prior?.status === 'processing' && prior.leaseUntil > Date.now()) return null;
      if (prior?.status === 'published' && !force && meeting.publishedGenerationId === prior.generationId) { this.store.update(meetingId, { status: 'ready', stage: 'ready', error: null }); return null; }
      // A failed/interrupted attempt resumes its exact checkpoint; a deliberate new
      // run after publication gets new immutable IDs and can never overwrite old chunks.
      const attempt = (prior?.attempts ?? 0) + 1;
      const resumable = prior && ['failed', 'processing'].includes(prior.status);
      const job = { ...(resumable ? prior : {}), id: key, meetingId, revisionId, runId: randomUUID(), leaseUntil: Date.now() + 960_000, generationId: resumable ? prior.generationId : digest(`${key}:${attempt}`), config, status: 'processing', stage: resumable ? prior.stage : 'grouping', attempts: attempt, error: null, updatedAt: now(), checkpoint: resumable ? prior.checkpoint : { window: 0, groups: [], omissions: [], cleanedPassages: [], topics: [] } };
      this.writeJob(job);
      this.store.update(meetingId, { jobId: job.id, status: 'processing', stage: job.stage, error: null, attempts: meeting.attempts + 1 });
      return job;
    });
  }
  owns(job) { try { const m = this.store.get(job.meetingId); return m.jobId === job.id && m.desiredRevisionId === job.revisionId && this.job(job.id)?.runId === job.runId; } catch { return false; } }
  checkpoint(job, checkpoint, stage) {
    if (!this.owns(job)) throw new MemoryError('A newer revision superseded this processing job.', 409, 'MEMORY_SUPERSEDED');
    this.writeJob({ ...this.job(job.id), checkpoint, stage, updatedAt: now() }); this.store.update(job.meetingId, { stage });
  }
  publish(job, result, chunks) {
    return this.transaction(() => {
      if (!this.owns(job)) throw new MemoryError('A newer revision superseded this processing job.', 409, 'MEMORY_SUPERSEDED');
      const revision = this.revision(job.meetingId, job.revisionId);
      validateUnits(revision.originalTranscript, result.passages);
      validateVectors(chunks.map(c => c.embedding), chunks.length, job.config.embedding.dimensions);
      const expected = assembleChunks(result.sourceTopics, { ...revision, revisionId: revision.id, passages: result.passages }, job.generationId);
      if (expected.length !== chunks.length || expected.some((c, i) => JSON.stringify(c) !== JSON.stringify(Object.fromEntries(Object.keys(c).map(k => [k, chunks[i][k]]))))) throw new MemoryError('Chunk bodies do not reconstruct the original evidence.', 502, 'MEMORY_GENERATION_INVALID');
      const selected = new Set(expected.flatMap(c => c.sourceIds)), omitted = new Set(result.omissions.map(o => o.sourceId));
      if (omitted.size !== result.omissions.length || result.omissions.some(o => selected.has(o.sourceId) || !revision.units.some(u => u.id === o.sourceId) || !['noise', 'small_talk'].includes(o.reason)) || revision.units.some(u => !selected.has(u.id) && !omitted.has(u.id))) throw new MemoryError('Generation coverage is incomplete.', 502, 'MEMORY_GENERATION_INVALID');
      if (new Set(chunks.map(c => c.id)).size !== chunks.length || chunks.some(c => c.generationId !== job.generationId || c.revisionId !== job.revisionId || c.inputHash !== digest(embeddingInput(c)) || c.links.some(l => this.source(job.meetingId, job.revisionId, l.sourceId).start !== l.start || this.source(job.meetingId, job.revisionId, l.sourceId).end !== l.end))) throw new MemoryError('Incomplete generation source integrity.', 502, 'MEMORY_GENERATION_INVALID');
      const generation = { id: job.generationId, revisionId: job.revisionId, meetingId: job.meetingId, config: job.config, status: 'published', result, createdAt: now() };
      this.db.prepare('INSERT INTO memory_generations VALUES (?, ?, ?, ?)').run(generation.id, job.meetingId, job.revisionId, JSON.stringify(generation));
      for (const chunk of chunks) this.db.prepare('INSERT INTO memory_source_chunks VALUES (?, ?, ?)').run(chunk.id, generation.id, JSON.stringify(chunk));
      const next = this.store.update(job.meetingId, { ...result, title: revision.title, date: revision.date, participants: revision.participants, originalTranscript: revision.originalTranscript, speakers: revision.speakers, segments: revision.segments, transcriptSource: revision.transcriptSource, revisionId: revision.id, publishedGenerationId: generation.id, processingConfig: job.config, status: 'ready', stage: 'ready', error: null });
      this.writeJob({ ...this.job(job.id), status: 'published', updatedAt: now() });
      return next;
    });
  }
  fail(attempt, error) {
    const job = this.job(attempt.id); if (!job || job.runId !== attempt.runId) return;
    this.writeJob({ ...job, status: 'failed', error: error.message, updatedAt: now() });
    // A stale failure cannot change a newer revision's status.
    if (this.owns(job)) return this.store.update(job.meetingId, { status: 'failed', stage: error.code, error: error.message });
  }
  delete(meetingId) {
    this.store.get(meetingId);
    this.transaction(() => {
      this.db.prepare('DELETE FROM diarized_selections WHERE meeting_id=?').run(meetingId);
      // Saved answers contain source snapshots: erase whole affected answers, including
      // mixed-meeting answers, so deleting a source also deletes retained quoted text.
      for (const { payload } of this.db.prepare('SELECT payload FROM answers').all()) { const a = JSON.parse(payload); if (a.sources.some(s => s.meetingId === meetingId) || a.filters?.meetingIds?.includes(meetingId)) this.db.prepare('DELETE FROM answers WHERE id=?').run(a.id); }
      this.db.prepare('DELETE FROM meetings WHERE id=?').run(meetingId);
    });
  }
}
