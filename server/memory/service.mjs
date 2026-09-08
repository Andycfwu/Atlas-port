import { randomUUID } from 'node:crypto';
import { contextualChunks, MemoryError, validateOrganization } from './transcript.mjs';
import { matchesFilters, retrieve, validateAnswer, validateFilters } from './retrieval.mjs';

export function safeMemoryError(error) {
  if (error instanceof MemoryError) return error;
  if (error?.status === 401 || error?.status === 403) return new MemoryError('The model provider rejected the backend credentials or model access. Check server/.env and restart the backend.', 503, 'MEMORY_PROVIDER_ACCESS');
  if (error?.status === 429) return new MemoryError('The model provider reached a rate or usage limit. Check backend account limits, then retry.', 503, 'MEMORY_PROVIDER_LIMIT');
  if (error?.name?.includes('Abort') || error?.name?.includes('Timeout')) return new MemoryError('This model request timed out. Your original is saved. Retry or use a shorter transcript.', 504, 'MEMORY_TIMEOUT');
  return new MemoryError('Meeting Memory could not complete this request. Check the backend connection and model configuration, then retry. Saved originals are preserved.', 500, 'MEMORY_REQUEST_FAILED');
}
export class MeetingMemoryService {
  constructor(store, provider) { this.store = store; this.provider = provider; this.jobs = new Map(); this.activeQuestions = 0; }
  start(id, reprocess = false) {
    const meeting = this.store.get(id);
    if (this.jobs.has(id) || (meeting.status === 'ready' && !reprocess)) return meeting;
    if (this.jobs.size >= 2) throw new MemoryError('Two meetings are already processing. Wait for one to finish, then retry.', 429, 'MEMORY_BUSY');
    const starting = this.store.update(id, { status: 'processing', stage: 'organizing', error: null, attempts: meeting.attempts + 1 });
    const job = this.process(starting).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
    return starting;
  }
  async process(meeting) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 360_000);
    try {
      const raw = await this.provider.organize(meeting, controller.signal);
      let organization;
      try { organization = validateOrganization(raw, meeting.passages, meeting); }
      catch (error) {
        if (!(error instanceof MemoryError) || !['MEMORY_INVALID_MODEL_OUTPUT', 'MEMORY_NUMERIC_FIDELITY'].includes(error.code)) throw error;
        organization = validateOrganization(await this.provider.organize(meeting, controller.signal, { previousOutput: raw, validationIssue: error.code }), meeting.passages, meeting);
      }
      this.store.update(meeting.id, { stage: 'embedding' });
      const chunks = contextualChunks(meeting);
      const vectors = await this.provider.embed(chunks.map(c => c.text), controller.signal);
      if (vectors.length !== chunks.length || vectors.some(v => !v?.length || v.some(n => !Number.isFinite(n)))) throw new MemoryError('The passage index was incomplete. Retry processing.', 502, 'MEMORY_INVALID_EMBEDDING');
      return this.store.complete(meeting.id, organization, chunks.map((c, i) => ({ ...c, embedding: vectors[i] })), this.provider.models);
    } catch (error) {
      const safe = safeMemoryError(error);
      return this.store.update(meeting.id, { status: 'failed', stage: safe.code, error: safe.message });
    } finally { clearTimeout(timer); }
  }
  async ask(input) {
    if (!input || typeof input.question !== 'string' || !input.question.trim() || input.question.length > 1200) throw new MemoryError('Enter a question of at most 1,200 characters.');
    const question = input.question.trim();
    const filters = validateFilters(input.filters);
    if (this.activeQuestions >= 2) throw new MemoryError('Two questions are already running. Please try again shortly.', 429, 'MEMORY_BUSY');
    this.activeQuestions += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const meetings = this.store.list();
      const ready = meetings.filter(m => m.status === 'ready' && matchesFilters(m, filters));
      let result = { status: 'insufficient_evidence', clarification: null, statements: [] };
      let sources = [], truncated = false;
      if (ready.length) {
        if (ready.some(m => m.models.embedding !== this.provider.models.embedding)) throw new MemoryError('The embedding model changed. Reprocess the selected meetings before asking questions.', 409, 'MEMORY_REINDEX_REQUIRED');
        const [vector] = await this.provider.embed([question], controller.signal);
        const retrieved = retrieve(ready, id => this.store.chunks(id), question, vector, filters);
        sources = retrieved.sources; truncated = retrieved.truncated;
        if (sources.length) {
          const raw = await this.provider.answer(question, sources, controller.signal);
          try { result = validateAnswer(raw, sources, question); }
          catch (error) {
            if (!(error instanceof MemoryError) || error.code !== 'MEMORY_CITATION_INVALID') throw error;
            result = validateAnswer(await this.provider.answer(question, sources, controller.signal, { previousOutput: raw, validationIssue: error.code }), sources, question);
          }
        }
      }
      const cited = new Set(result.statements.flatMap(s => s.citations.map(c => `${c.meetingId}/${c.passageId}`)));
      return this.store.saveAnswer({ id: randomUUID(), question, filters, ...result,
        sources: sources.filter(s => cited.has(`${s.meetingId}/${s.passageId}`)),
        readyMeetingCount: ready.length, retrievalTruncated: truncated,
        model: ready.length && sources.length ? this.provider.models.answer : null,
        createdAt: new Date().toISOString(),
      });
    } catch (error) { throw safeMemoryError(error); }
    finally { clearTimeout(timer); this.activeQuestions -= 1; }
  }
}
