import express from 'express';
import multer from 'multer';
import { tmpdir } from 'node:os';
import { unlink } from 'node:fs/promises';
import { MAX_AUDIO_BYTES } from './result.mjs';
import { uploadSizeMatches } from '../transcription-integrity.mjs';
import { MemoryError } from '../memory/transcript.mjs';
import { safeMemoryError } from '../memory/service.mjs';

export function createDiarizationRouter(service) {
  const router = express.Router();
  const upload = multer({ dest: tmpdir(), limits: { fileSize: MAX_AUDIO_BYTES, files: 1, fields: 2, fieldSize: 256 },
    fileFilter: (_req, file, cb) => cb(/\.m4a$/i.test(file.originalname) && ['audio/mp4','audio/m4a','audio/x-m4a','application/octet-stream'].includes(file.mimetype)
      ? null : new MemoryError('Identify speakers accepts saved M4A audio only.', 415), true) });
  router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) throw new MemoryError('Select a saved audio recording first.');
    if (!req.get('X-Atlas-Audio-Bytes') || !uploadSizeMatches(req.get('X-Atlas-Audio-Bytes'), req.file.size)) throw new MemoryError('The uploaded byte count differs from the saved audio. Retry identification.');
    const job = await service.start(req.file, { recordingId: req.body.recordingId, durationMillis: Number(req.body.durationMillis) });
    res.status(job.status === 'ready' ? 200 : 202).json(job);
  });
  router.get('/:id', (req, res) => res.json(service.get(req.params.id)));
  router.use(async (error, req, res, _next) => {
    if (req.file?.path) await unlink(req.file.path).catch(() => {});
    const safe = error?.code === 'LIMIT_FILE_SIZE' ? new MemoryError('This recording exceeds the 25 MB identification limit. No audio was split or changed.', 413) : safeMemoryError(error);
    res.status(safe.status).json({ error: { message: safe.message, code: safe.code } });
  });
  return router;
}
