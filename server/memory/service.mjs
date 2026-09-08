import { inputWindows, topicCatalog, validateGrouping, appendGroups, assembleChunks, embeddingInput, processingConfig, embeddingConfig, validateVectors } from './pipeline.mjs';
import { directSpeakerTarget } from './provenance.mjs';
import { randomUUID } from 'node:crypto';
import { MemoryError, validateOrganization } from './transcript.mjs';
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
    if (this.jobs.has(id)) return meeting;
    if (this.jobs.size >= 2) throw new MemoryError('Two meetings are already processing. Wait for one to finish, then retry.', 429, 'MEMORY_BUSY');
    const job = this.store.versions.begin(id, processingConfig(this.provider), reprocess);
    if (!job) return this.store.get(id);
    const pending = this.process(job).finally(() => this.jobs.delete(id));
    this.jobs.set(id, pending);
    return this.store.get(id);
  }
  async process(job) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 900_000);
    try {
      const revision = this.store.versions.revision(job.meetingId, job.revisionId);
      const meeting = { ...revision, id: job.meetingId, revisionId: revision.id, passages: revision.units };
      const windows = inputWindows(meeting.passages);
      const state = structuredClone(job.checkpoint);
      for (let i = state.window; i < windows.length; i++) {
        const passages = windows[i];
        const first = meeting.passages.indexOf(passages[0]), last = first + passages.length;
        const catalog = topicCatalog(state.groups, meeting.passages);
        const input = { title: meeting.title, participants: meeting.participants, passages, priorTopics: catalog, contextBefore: meeting.passages.slice(Math.max(0, first - 1), first), contextAfter: meeting.passages.slice(last, last + 1) };
        const raw = await this.provider.group(input, controller.signal);
        let grouping;
        try { grouping = validateGrouping(raw, passages, catalog); }
        catch (error) {
          if (!(error instanceof MemoryError) || error.code !== 'MEMORY_INVALID_GROUPING') throw error;
          grouping = validateGrouping(await this.provider.group(input, controller.signal, { previousOutput: raw, validationIssue: error.message }), passages, catalog);
        }
        const windowMeeting = { ...meeting, passages, segments: meeting.segments.filter(s => s.start < passages.at(-1).end && s.end > passages[0].start) };
        const rawNotes = await this.provider.organize(windowMeeting, controller.signal);
        let notes;
        try { notes = validateOrganization(rawNotes, passages, windowMeeting); }
        catch (error) {
          if (!(error instanceof MemoryError) || !['MEMORY_INVALID_MODEL_OUTPUT', 'MEMORY_NUMERIC_FIDELITY'].includes(error.code)) throw error;
          notes = validateOrganization(await this.provider.organize(windowMeeting, controller.signal, { previousOutput: rawNotes, validationIssue: error.code }), passages, windowMeeting);
        }
        appendGroups(state.groups, grouping, job.generationId, meeting.passages);
        state.omissions.push(...grouping.omissions);
        state.cleanedPassages.push(...notes.cleanedPassages);
        state.topics.push(...notes.topics.map(t => ({ ...t, id: `${job.generationId}:N${i + 1}:${t.id}`, derived: true })));
        state.window = i + 1;
        this.store.versions.checkpoint(job, state, `grouping ${state.window}/${windows.length}`);
      }
      this.store.versions.checkpoint(job, state, 'embedding');
      const chunks = assembleChunks(state.groups, meeting, job.generationId);
      const vectors = chunks.length ? await this.provider.embed(chunks.map(embeddingInput), controller.signal) : [];
      validateVectors(vectors, chunks.length, job.config.embedding.dimensions);
      return this.store.versions.publish(job, { passages: meeting.passages, topics: state.topics, cleanedPassages: state.cleanedPassages, sourceTopics: state.groups, omissions: state.omissions, models: this.provider.models }, chunks.map((c, i) => ({ ...c, embedding: vectors[i], embeddingConfig: job.config.embedding })));
    } catch (error) {
      const safe = safeMemoryError(error);
      this.store.versions.fail(job, safe);
      try { return this.store.get(job.meetingId); } catch { return null; }
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
      const meetings = this.store.questionMeetings(filters);
      const ready = meetings.filter(m => (m.publishedGenerationId || m.status === 'ready') && matchesFilters(m, filters));
      let result = { status: 'insufficient_evidence', clarification: null, statements: [] };
      let sources = [], truncated = false;
      const target = directSpeakerTarget(question);
      const ambiguousLabel = /^speaker \d+$/i.test(target ?? '') && new Set(ready.map(m => m.transcriptSource?.recordingId ?? m.id)).size > 1;
      if (ambiguousLabel) result = { status: 'clarification', scope: 'speaker', requestedSpeaker: target, limitation: 'Anonymous labels are local to each meeting, not shared identities.', clarification: 'Which meeting do you mean? Select one meeting before asking about an anonymous speaker.', statements: [] };
      if (ready.length && !ambiguousLabel) {
        if (ready.some(m => { const config = this.store.versions.generation(m.id, m.publishedGenerationId).config.embedding; return JSON.stringify(config) !== JSON.stringify(embeddingConfig(this.provider)); })) throw new MemoryError('The embedding model changed. Reprocess the selected meetings before asking questions.', 409, 'MEMORY_REINDEX_REQUIRED');
        const hasIndex = ready.some(m => this.store.chunks(m.id).length);
        const queryVectors = hasIndex ? await this.provider.embed([question], controller.signal) : [];
        if (hasIndex) validateVectors(queryVectors, 1, this.provider.dimensions ?? 512);
        const vector = queryVectors[0] ?? [];
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
      for (const statement of result.statements) for (const citation of statement.citations) {
        const source = sources.find(s => s.meetingId === citation.meetingId && s.passageId === citation.passageId);
        citation.revisionId = source.revisionId; citation.generationId = source.generationId;
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
