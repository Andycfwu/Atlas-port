import express from 'express';
import { createAudioUpload, cleanupAudioUpload, AudioUploadError } from '../audio-upload.mjs';
import { safeMemoryError } from '../memory/service.mjs';

export function createDiarizationRouter(service, { uploadOptions = {} } = {}) {
  const router = express.Router();
  router.post('/', createAudioUpload('diarization', uploadOptions), async (req, res) => {
    const job = await service.start(req.file, req.audioMetadata);
    res.status(job.status === 'ready' ? 200 : 202).json(job);
  });
  router.get('/:id', (req, res) => res.json(service.get(req.params.id)));
  router.use(async (error, req, res, _next) => {
    await cleanupAudioUpload(req.file);
    const safe = error instanceof AudioUploadError ? error : safeMemoryError(error);
    if (!res.destroyed && !res.headersSent) res.status(safe.status).json({ error: { message: safe.message, code: safe.code } });
  });
  return router;
}
