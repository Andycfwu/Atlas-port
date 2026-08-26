import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import express from 'express';
import multer from 'multer';
import OpenAI, { toFile } from 'openai';

const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const apiKey = process.env.OPENAI_API_KEY?.trim();

if (!apiKey) {
  throw new Error('OPENAI_API_KEY must be set in server/.env.');
}

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('PORT must be a positive integer.');
}

const openai = new OpenAI({ apiKey });
const app = express();
const upload = multer({
  dest: tmpdir(),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (extension !== '.m4a') {
      callback(new Error('Only M4A recordings are accepted.'));
      return;
    }

    callback(null, true);
  },
});

app.get('/health', (_request, response) => {
  response.json({ ok: true });
});

app.post('/transcribe', upload.single('file'), async (request, response) => {
  const uploadedFile = request.file;

  if (!uploadedFile) {
    response.status(400).json({ error: 'An M4A file is required.' });
    return;
  }

  try {
    const file = await toFile(
      createReadStream(uploadedFile.path),
      uploadedFile.originalname,
      { type: uploadedFile.mimetype || 'audio/mp4' },
    );
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'gpt-transcribe',
    });
    const text = transcription.text.trim();

    if (!text) {
      response.status(502).json({ error: 'OpenAI returned an empty transcript.' });
      return;
    }

    response.json({ text });
  } catch (error) {
    console.error('[TranscriptionServer] Transcription failed.', {
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(502).json({ error: 'Transcription failed.' });
  } finally {
    await unlink(uploadedFile.path).catch((error) => {
      console.warn('[TranscriptionServer] Temporary upload cleanup failed.', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
});

app.use((error, _request, response, _next) => {
  console.warn('[TranscriptionServer] Request rejected.', {
    error: error instanceof Error ? error.message : String(error),
  });
  response.status(400).json({ error: 'The uploaded recording was rejected.' });
});

app.listen(port, '0.0.0.0', (error) => {
  if (error) {
    console.error('[TranscriptionServer] Could not start.', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
    return;
  }

  console.info(`Atlas transcription server listening on http://0.0.0.0:${port}`);
});
