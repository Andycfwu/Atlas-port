import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Hash source only: no environment values, credentials, audio, or transcripts.
const readSourceRevision = () => {
  const hash = createHash('sha256');
  for (const file of ['live-transcription-server.mjs', 'live-transcription-protocol.mjs', 'live-transcription-runtime.mjs']) {
    hash.update(readFileSync(new URL(file, import.meta.url)));
  }
  return hash.digest('hex').slice(0, 16);
};

export const createLiveRuntimeStatus = (readRevision = readSourceRevision) => {
  const loadedRevision = readRevision();
  const loadedAt = new Date().toISOString();
  return () => {
    let sourceRevision = null;
    try { sourceRevision = readRevision(); } catch { /* A removed file still requires a restart. */ }
    return { loadedAt, loadedRevision, sourceRevision, restartRequired: sourceRevision !== loadedRevision };
  };
};

export const getLiveRuntimeStatus = createLiveRuntimeStatus();
