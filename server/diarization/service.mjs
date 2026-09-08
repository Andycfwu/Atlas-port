import { readFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { toFile } from 'openai';
import { digest, MemoryError } from '../memory/transcript.mjs';
import { safeMemoryError } from '../memory/service.mjs';
import { DEVELOPMENT_USER } from '../memory/store.mjs';
import { DIARIZATION_MODEL, resultId, validateAudioInput, validateDiarizedResult } from './result.mjs';

export class DiarizationService {
  constructor(db, provider) {
    this.db = db; this.provider = provider; this.jobs = new Map();
    db.exec('CREATE TABLE IF NOT EXISTS diarizations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL)');
    for (const { payload } of db.prepare('SELECT payload FROM diarizations WHERE user_id=?').all(DEVELOPMENT_USER)) {
      const job = JSON.parse(payload);
      if (job.status === 'processing') this.put({ ...job, status: 'failed', error: 'Identification was interrupted by a backend restart. Retry with the saved audio.' });
    }
  }
  put(job) { this.db.prepare('INSERT OR REPLACE INTO diarizations VALUES (?, ?, ?)').run(job.id, DEVELOPMENT_USER, JSON.stringify(job)); return job; }
  get(id) {
    const row = this.db.prepare('SELECT payload FROM diarizations WHERE id=? AND user_id=?').get(id, DEVELOPMENT_USER);
    if (!row) throw new MemoryError('Speaker identification was not found. Identify the saved recording again.', 404);
    return JSON.parse(row.payload);
  }
  async start(file, metadata) {
    // This method takes ownership of only the temporary upload, never the phone's original.
    let ownsUpload = true;
    try {
      validateAudioInput({ ...metadata, byteSize: file.size });
      const audioSha256 = digest(await readFile(file.path));
      const id = resultId(metadata.recordingId, audioSha256);
      const row = this.db.prepare('SELECT payload FROM diarizations WHERE id=? AND user_id=?').get(id, DEVELOPMENT_USER);
      const previous = row ? JSON.parse(row.payload) : null;
      if (previous?.status === 'ready' || this.jobs.has(id)) return this.get(id);
      if (this.jobs.size >= 2) throw new MemoryError('Two recordings are already identifying speakers. Wait and retry.', 429);
      const job = this.put({ id, recordingId: metadata.recordingId, status: 'processing', error: null,
        attempts: (previous?.attempts ?? 0) + 1, result: previous?.result ?? null, createdAt: previous?.createdAt ?? new Date().toISOString() });
      const input = { ...metadata, id, byteSize: file.size, audioSha256 };
      const work = this.process(file, input).finally(() => this.jobs.delete(id));
      this.jobs.set(id, work); ownsUpload = false;
      return job;
    } finally { if (ownsUpload) await unlink(file.path).catch(() => {}); }
  }
  async process(file, input) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 360_000);
    try {
      const { data, requestId } = await this.provider(file, controller.signal);
      const result = validateDiarizedResult(data, { ...input, providerRequestId: requestId });
      this.put({ ...this.get(input.id), status: 'ready', error: null, result });
    } catch (error) {
      const safe = safeMemoryError(error);
      this.put({ ...this.get(input.id), status: 'failed', error: safe.message });
    } finally { clearTimeout(timer); await unlink(file.path).catch(() => {}); }
  }
}
export const openAIDiarizationProvider = client => async (file, signal) => {
  const audio = await toFile(createReadStream(file.path), file.originalname, { type: 'audio/mp4' });
  const response = await client.audio.transcriptions.create({ file: audio, model: DIARIZATION_MODEL,
    response_format: 'diarized_json', chunking_strategy: 'auto' }, { signal, timeout: 350_000, maxRetries: 0 }).withResponse();
  return { data: response.data, requestId: response.request_id };
};
