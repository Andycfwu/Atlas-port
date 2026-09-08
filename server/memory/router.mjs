import { MemoryError } from './transcript.mjs';
import { createDiarizedMeeting, reviseMeetingSpeakers } from '../diarization/meeting.mjs';
import express from 'express';
import { safeMemoryError } from './service.mjs';

export const meetingSummary = (m) => ({
  publishedGenerationId: m.publishedGenerationId, revisionId: m.revisionId, desiredRevisionId: m.desiredRevisionId, id: m.id, title: m.title, date: m.date, participants: m.participants, status: m.status,
  stage: m.stage, error: m.error, topicCount: m.topics.length, passageCount: m.passages.length,
  updatedAt: m.updatedAt, createdAt: m.createdAt, transcriptSource: m.transcriptSource,
});
export function createMemoryRouter(service, diarization) {
  const router = express.Router();
  router.use(express.json({ limit: '512kb' }));
  router.get('/meetings', (_req, res) => res.json({ mode: 'single-user-development', meetings: service.store.list().map(meetingSummary) }));
  router.post('/meetings', (req, res) => {
    if (req.body?.transcriptSource?.kind === 'diarized_audio' && !req.body?.diarizationId) throw new MemoryError('Use a completed audio identification result to import diarized text.');
    const result = req.body?.diarizationId
      ? createDiarizedMeeting(service.store, diarization, req.body) : service.store.create(req.body);
    res.status(result.existing ? 200 : 201).json(result);
  });
  router.post('/meetings/:id/speakers', (req, res) => res.json(reviseMeetingSpeakers(service.store, req.params.id, req.body?.speakerNames)));
  router.get('/meetings/:id', (req, res) => {
    const meeting = service.store.get(req.params.id);
    const chunks = service.store.chunks(meeting.id).map(c => ({ ...c, embedding: undefined }));
    res.json({ ...meeting, sourceChunks: chunks });
  });
  router.post('/meetings/:id/revisions', (req, res) => res.status(201).json(service.store.versions.revise(req.params.id, req.body)));
  router.get('/meetings/:id/revisions/:revisionId', (req, res) => res.json(service.store.versions.revision(req.params.id, req.params.revisionId)));
  router.get('/meetings/:id/revisions/:revisionId/sources/:sourceId', (req, res) => res.json(service.store.versions.source(req.params.id, req.params.revisionId, req.params.sourceId)));
  router.get('/meetings/:id/chunks/:chunkId', (req, res) => res.json(service.store.versions.chunk(req.params.id, req.params.chunkId)));
  router.get('/meetings/:id/generations/:generationId', (req, res) => res.json(service.store.versions.generation(req.params.id, req.params.generationId)));
  router.delete('/meetings/:id', (req, res) => { service.store.versions.delete(req.params.id); res.status(204).end(); });
  router.post('/meetings/:id/process', (req, res) => res.status(202).json(service.start(req.params.id, req.body?.reprocess === true)));
  router.get('/answers', (_req, res) => res.json(service.store.answers()));
  router.post('/questions', async (req, res) => res.json(await service.ask(req.body)));
  router.use((error, _req, res, _next) => {
    const safe = error?.type === 'entity.too.large'
      ? { status: 413, code: 'MEMORY_IMPORT_TOO_LARGE', message: 'This transcript is too large. Use at most 60,000 characters.' }
      : error instanceof SyntaxError
        ? { status: 400, code: 'MEMORY_INVALID_JSON', message: 'The meeting request was not valid JSON.' }
        : safeMemoryError(error);
    // Do not log transcript text, questions, provider payloads, or credentials.
    res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
  });
  return router;
}
