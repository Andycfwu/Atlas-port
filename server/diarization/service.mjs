import { RelationalMemory } from '../storage/relational.mjs';
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
    this.repo = new RelationalMemory(db);
    for (const { id } of db.prepare('SELECT id FROM diarizations WHERE user_id=?').all(DEVELOPMENT_USER)) {
      const job = this.repo.diarization(id);
      if (job.status === 'processing') this.put({ ...job, status: 'failed', error: 'Identification was interrupted by a backend restart. Retry with the saved audio.' });
    }
  }
  put(job) { return this.repo.putDiarization(job); }
  get(id) {
    const job = this.repo.diarization(id);
    if (!job) throw new MemoryError('Speaker identification was not found. Identify the saved recording again.', 404);
    return job;
  }
  async start(file, metadata) {
    // This method takes ownership of only the temporary upload, never the phone's original.
    let ownsUpload = true;
    try {
      validateAudioInput({ ...metadata, byteSize: file.size });
      const audioSha256 = digest(await readFile(file.path));
      const id = resultId(metadata.recordingId, audioSha256);
      const previous = this.repo.diarization(id);
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
