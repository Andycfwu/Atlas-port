import express from 'express';
import { safeMemoryError } from './service.mjs';

export const meetingSummary = (m) => ({
  id: m.id, title: m.title, date: m.date, participants: m.participants, status: m.status,
  stage: m.stage, error: m.error, topicCount: m.topics.length, passageCount: m.passages.length,
  updatedAt: m.updatedAt, createdAt: m.createdAt,
});
export function createMemoryRouter(service) {
  const router = express.Router();
  router.use(express.json({ limit: '512kb' }));
  router.get('/meetings', (_req, res) => res.json({ mode: 'single-user-development', meetings: service.store.list().map(meetingSummary) }));
  router.post('/meetings', (req, res) => {
    const result = service.store.create(req.body);
    res.status(result.existing ? 200 : 201).json(result);
  });
  router.get('/meetings/:id', (req, res) => res.json(service.store.get(req.params.id)));
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
