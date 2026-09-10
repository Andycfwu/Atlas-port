import multer from 'multer';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AudioUploadError, validateM4aContainer } from './audio-container.mjs';
import { uploadSizeMatches } from './transcription-integrity.mjs';
import { MAX_AUDIO_BYTES, MAX_AUDIO_MS, validateAudioInput } from './diarization/result.mjs';

export { AudioUploadError } from './audio-container.mjs';
export const AUDIO_UPLOAD_LIMITS = Object.freeze({
  transcription: Object.freeze({ files: 1, fileSize: 25 * 1024 * 1024, fields: 0, fieldSize: 0, parts: 2, fieldNameSize: 32, fieldNestingDepth: 0, fieldArrayIndexLimit: 0 }),
  diarization: Object.freeze({ files: 1, fileSize: MAX_AUDIO_BYTES, fields: 2, fieldSize: 256, parts: 4, fieldNameSize: 32, fieldNestingDepth: 0, fieldArrayIndexLimit: 0 }),
});
const acceptedMime = new Set(['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'application/octet-stream']);
const reject = message => { throw new AudioUploadError('UPLOAD_REJECTED', 400, message); };
const ownership = new WeakMap();

// Only files registered by this middleware may cause deletion. Paths from a body,
// original filenames, phone storage and persisted result IDs are never cleanup targets.
export async function cleanupAudioUpload(file) { await ownership.get(file)?.cleanup(); }
export function claimAudioUpload(file) { ownership.get(file)?.claim(); }

export function safeAudioUploadError(error, kind) {
  if (error instanceof AudioUploadError) return error;
  const messages = {
    LIMIT_FILE_SIZE: kind === 'diarization'
      ? 'The recording exceeds the 25 MB speaker-identification limit. Use a shorter saved recording.'
      : 'The recording exceeds the 25 MiB transcription limit. Use a shorter saved recording.',
    LIMIT_FILE_COUNT: 'Send exactly one saved recording in the file field.',
    LIMIT_UNEXPECTED_FILE: 'Only one audio file named file is accepted.',
    LIMIT_FIELD_COUNT: 'This upload contains too many text fields. Use the saved recording action in Atlas.',
    LIMIT_PART_COUNT: 'This upload contains too many parts. Send only the recording and required metadata.',
    LIMIT_FIELD_VALUE: 'An upload metadata field is too long.',
    LIMIT_FIELD_KEY: 'An upload field name is too long.',
    LIMIT_FIELD_NESTING: 'Upload metadata must use flat field names, without brackets or nested values.',
    LIMIT_FIELD_ARRAY_INDEX: 'Upload metadata cannot contain arrays.',
    INVALID_FIELD_NAME: 'An upload field name is invalid.',
  };
  return new AudioUploadError(Object.hasOwn(messages, error?.code) ? error.code : 'UPLOAD_REJECTED',
    error?.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
    messages[error?.code] ?? 'The audio upload was incomplete or malformed. Retry using the original saved recording.');
}

function metadataFor(kind, req) {
  const fields = Object.keys(req.body ?? {});
  if (kind === 'transcription') {
    if (fields.length) reject('Saved transcription accepts only the audio file, without text fields.');
    return null;
  }
  if (fields.length !== 2 || fields.some(name => !['recordingId', 'durationMillis'].includes(name))) {
    reject('Identify speakers requires only recordingId and durationMillis alongside the audio file.');
  }
  const { recordingId, durationMillis } = req.body;
  if (typeof recordingId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(recordingId)
    || typeof durationMillis !== 'string' || !/^\d+(?:\.\d+)?$/.test(durationMillis) || durationMillis.length > 32) {
    reject('The recording ID or measured duration is invalid. Retry from the saved recording in Atlas.');
  }
  const metadata = { recordingId, durationMillis: Number(durationMillis) };
  validateAudioInput({ ...metadata, byteSize: req.file.size });
  return metadata;
}

export function createAudioUpload(kind, { temporaryRoot = tmpdir(), fileSizeLimit } = {}) {
  if (!Object.hasOwn(AUDIO_UPLOAD_LIMITS, kind)) throw new Error('Unknown audio upload route.');
  // Tests can lower the byte bound in an isolated server without sending large bodies.
  const limits = { ...AUDIO_UPLOAD_LIMITS[kind] };
  if (fileSizeLimit !== undefined) {
    if (!Number.isSafeInteger(fileSizeLimit) || fileSizeLimit <= 0 || fileSizeLimit > limits.fileSize) throw new Error('Invalid test upload size bound.');
    limits.fileSize = fileSizeLimit;
  }
  // Busboy fires partsLimit when reaching the bound: 2 allows one part, 4 allows three.
  const upload = multer({
    limits,
    storage: multer.diskStorage({
      destination: (req, _file, cb) => cb(null, req.audioUploadDirectory),
      filename: (_req, _file, cb) => cb(null, 'recording.m4a'),
    }),
    fileFilter: (_req, file, cb) => {
      const valid = Buffer.byteLength(file.originalname) <= 255
        && path.extname(file.originalname).toLowerCase() === '.m4a' && acceptedMime.has(file.mimetype.toLowerCase());
      cb(valid ? null : new AudioUploadError('INVALID_AUDIO_FILE', 415, 'Only saved AAC/M4A audio recordings are accepted.'), valid);
    },
  }).single('file');

  return async (req, res, next) => {
    if (!req.is('multipart/form-data')) return next(new AudioUploadError('UPLOAD_REJECTED', 400, 'Send the saved recording as multipart/form-data.'));
    const controller = new AbortController();
    let directory, parsing = true, claimed = false, cleanupPromise;
    const cleanup = () => {
      if (!directory) return Promise.resolve();
      return cleanupPromise ??= rm(directory, { recursive: true, force: true }).catch(() => {
        // No directory, filename, metadata, or provider payload in cleanup diagnostics.
        console.warn('[AtlasAudioUpload] TEMPORARY_UPLOAD_CLEANUP_FAILED: check temporary-storage permissions.');
      });
    };
    const disconnected = () => {
      if (claimed) return; // A fully accepted durable identification job now owns the upload.
      controller.abort();
      if (!parsing) void cleanup().catch(() => {});
    };
    req.once('aborted', disconnected);
    res.once('close', () => { if (!res.writableFinished) disconnected(); });
    try {
      directory = await mkdtemp(path.join(temporaryRoot, 'atlas-audio-'));
      req.audioUploadDirectory = directory;
      if (req.aborted || res.destroyed || controller.signal.aborted) { await cleanup(); return; }
      upload(req, res, error => {
        parsing = false;
        const finish = async () => {
          try {
            if (error) throw safeAudioUploadError(error, kind);
            controller.signal.throwIfAborted();
            if (!req.file) reject('Select one saved M4A recording first.');
            const file = req.file;
            ownership.set(file, { cleanup, claim: () => { controller.signal.throwIfAborted(); claimed = true; } });
            Object.defineProperty(file, 'uploadSignal', { value: controller.signal });
            const expected = req.headers['x-atlas-audio-bytes'];
            if ((kind === 'diarization' && expected === undefined) || !uploadSizeMatches(expected, file.size)) {
              reject('The uploaded byte count differs from the saved audio. Retry; the original remains on your phone.');
            }
            req.audioMetadata = metadataFor(kind, req);
            const container = await validateM4aContainer(file.path, file.size, controller.signal);
            if (kind === 'diarization' && (container.durationMillis > MAX_AUDIO_MS + 1000
              || Math.abs(container.durationMillis - req.audioMetadata.durationMillis) > 1000)) {
              reject('The audio container duration does not match the saved duration or exceeds 20 minutes. Retry from the original saved recording.');
            }
            controller.signal.throwIfAborted();
            next();
          } catch (failure) {
            await cleanup();
            if (!req.aborted && !res.destroyed) next(failure);
          }
        };
        void finish().catch(next);
      });
    } catch (error) {
      await cleanup();
      next(error);
    }
  };
}
