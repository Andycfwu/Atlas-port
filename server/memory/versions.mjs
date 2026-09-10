import { randomUUID } from 'node:crypto';
import { transaction } from '../storage/codec.mjs';
import { digest, MemoryError, validateIntake } from './transcript.mjs';
import { sourceUnits, validateUnits, validateVectors, embeddingInput, assembleChunks } from './pipeline.mjs';

const now = () => new Date().toISOString();
const unavailable = () => { throw new MemoryError('This exact historical source is unavailable or was deleted. No replacement was substituted.', 410, 'MEMORY_SOURCE_UNAVAILABLE'); };
export class MemoryVersions {
  constructor(store) {
    this.store = store; this.db = store.db;
    this.repo = store.repo;
    this.transaction(() => {
      for (const meeting of store.list()) this.ensure(meeting);
      // One local backend owns jobs. Persisted checkpoints survive restart; explicit Retry
      // resumes the same generation. A previously published generation remains readable.
      for (const { id } of this.db.prepare('SELECT id FROM memory_jobs').all()) {
        const job = this.repo.job(id);
        if (job.status === 'processing') this.fail(job, new MemoryError('Processing was interrupted by a backend restart. Retry resumes the saved generation.', 503, 'MEMORY_INTERRUPTED'));
      }
    });
  }
  transaction(fn) { return transaction(this.db, fn); }
  revisionData(meeting) {
    const { id, title, date, participants, originalTranscript, speakers = [], segments = [], transcriptSource } = meeting;
    const revisionId = digest(JSON.stringify([id, originalTranscript, speakers, segments, transcriptSource ?? null, title, date, participants]));
    return { id: revisionId, meetingId: id, title, date, participants, originalTranscript, speakers, segments, ...(transcriptSource ? { transcriptSource } : {}), contentHash: digest(originalTranscript), units: sourceUnits(originalTranscript, revisionId, segments), legacyPassages: meeting.passages ?? [], createdAt: now() };
  }
  ensure(meeting) {
    if (meeting.revisionId) return meeting;
    const revision = this.revisionData(meeting);
    this.repo.putRevision(revision);
    let publishedGenerationId = null;
    const legacyChunks = this.repo.legacyChunks(meeting.id);
    if (meeting.status === 'ready' || (legacyChunks.length && meeting.models?.embedding)) {
      publishedGenerationId = digest(`legacy:${meeting.id}:${revision.id}`);
      const chunks = legacyChunks;
      const generation = { id: publishedGenerationId, revisionId: revision.id, meetingId: meeting.id, legacy: true, status: 'published', config: { processor: 'legacy-context-v0', embedding: { model: meeting.models?.embedding, dimensions: chunks[0]?.embedding?.length ?? 512, version: 'openai-float-v1', normalization: 'cosine-nonzero' } }, result: { topics: meeting.topics, cleanedPassages: meeting.cleanedPassages, passages: meeting.passages, sourceTopics: [], omissions: [], models: meeting.models }, createdAt: meeting.updatedAt };
      this.repo.putGeneration(generation);
      for (const [i, c] of chunks.entries()) this.repo.putChunk({ ...c, id: `${generation.id}:legacy:${i}`, generationId: generation.id, revisionId: revision.id });
    }
    return this.store.update(meeting.id, { revisionId: revision.id, desiredRevisionId: revision.id, publishedGenerationId, pipelineSchema: 1 });
  }
  revision(meetingId, revisionId) {
    this.store.get(meetingId);
    const revision = this.repo.revision(revisionId);
    if (!revision || revision.meetingId !== meetingId) unavailable();
    return revision;
  }
  revise(meetingId, input) {
    const current = this.store.get(meetingId);
    const data = validateIntake({ ...input, sourceKey: null });
    // Text replacement never carries old diarization/recording evidence by guessed alignment.
    if (data.transcriptSource?.kind === 'diarized_audio') throw new MemoryError('Use the audio identification version action for diarized sources.');
    const revision = this.revisionData({ ...data, id: meetingId });
    return this.transaction(() => {
      this.repo.putRevision(revision);
      return this.store.update(meetingId, { desiredRevisionId: revision.id, jobId: null, status: current.publishedGenerationId ? 'ready' : 'draft', stage: 'revision_saved', error: null });
    });
  }
  generation(meetingId, id) {
    this.store.get(meetingId);
    const generation = this.repo.generation(id);
    if (!generation || generation.meetingId !== meetingId) unavailable(); return generation;
  }
  chunks(meetingId, generationId = this.store.get(meetingId).publishedGenerationId) {
    if (!generationId) return [];
    this.generation(meetingId, generationId);
    return this.repo.generationChunks(generationId);
  }
  chunk(meetingId, id) {
    this.store.get(meetingId);
    const row = this.repo.row('memory_source_chunks', id);
    if (!row || row.meeting_id !== meetingId) unavailable();
    return { ...this.repo.chunk(id), embedding: undefined };
  }

  source(meetingId, revisionId, sourceId) {
    const revision = this.revision(meetingId, revisionId);
    const unit = [...revision.units, ...revision.legacyPassages].find(p => p.id === sourceId);
    if (!unit || unit.text !== revision.originalTranscript.slice(unit.start, unit.end)) unavailable();
    return { ...unit, meetingId, revisionId };
  }
  job(id) { return this.repo.job(id); }
  writeJob(job) { return this.transaction(() => this.repo.putJob(job)); }
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
      this.repo.putGeneration(generation);
      for (const chunk of chunks) this.repo.putChunk(chunk);
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
    this.repo.deleteMeeting(meetingId);
  }
}
