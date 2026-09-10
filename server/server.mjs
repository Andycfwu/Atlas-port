import { DiarizationService, openAIDiarizationProvider } from './diarization/service.mjs';
import { createDiarizationRouter } from './diarization/router.mjs';
import { createServer } from 'node:http';

import express from 'express';
import OpenAI from 'openai';
import { createTranscriptionRouter } from './transcription-router.mjs';

import { attachLiveTranscriptionWebSocketServer } from './live-transcription-server.mjs';
import { getLiveRuntimeStatus } from './live-transcription-runtime.mjs';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { createMemoryProvider } from './memory/provider.mjs';
import { createMemoryRouter } from './memory/router.mjs';
import { fileURLToPath } from 'node:url';
import { deepgramAvailability } from './deepgram/protocol.mjs';


const port = Number.parseInt(process.env.PORT ?? '8787', 10);
const apiKey = process.env.OPENAI_API_KEY?.trim();
const OPENAI_REQUEST_TIMEOUT_MS = 120_000;

if (!apiKey) {
  throw new Error('OPENAI_API_KEY must be set in server/.env.');
}

if (!Number.isFinite(port) || port <= 0) {
  throw new Error('PORT must be a positive integer.');
}

const openai = new OpenAI({
  apiKey,
  maxRetries: 0,
  timeout: OPENAI_REQUEST_TIMEOUT_MS,
});
const app = express();
const httpServer = createServer(app);
const deepgram = { apiKey: process.env.DEEPGRAM_API_KEY, enabled: process.env.ATLAS_DEEPGRAM_LIVE_ENABLED === '1' };
attachLiveTranscriptionWebSocketServer({ apiKey, httpServer, deepgram });

app.get('/health', (_request, response) => {
  response.set('Cache-Control', 'no-store').json({ ok: true, live: getLiveRuntimeStatus(), liveSpeakerLabels: deepgramAvailability(deepgram) });
});

const meetingStore = new MeetingStore(process.env.MEMORY_DB_PATH || fileURLToPath(new URL('./data/meeting-memory.sqlite', import.meta.url)));
const meetingMemory = new MeetingMemoryService(meetingStore, createMemoryProvider(openai));
const diarization = new DiarizationService(meetingStore.db, openAIDiarizationProvider(openai));
app.use('/v1/diarizations', createDiarizationRouter(diarization));
app.use('/v1/memory', createMemoryRouter(meetingMemory, diarization));

app.use('/transcribe', createTranscriptionRouter(openai));

httpServer.listen(port, '0.0.0.0', (error) => {
  if (error) {
    console.error('[TranscriptionServer] Could not start.', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
    return;
  }

  console.info(`Atlas transcription server listening on http://0.0.0.0:${port}`);
});
