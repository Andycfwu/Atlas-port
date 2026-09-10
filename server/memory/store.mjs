import { RelationalMemory } from '../storage/relational.mjs';
import { initializeEmpty, schemaVersion } from '../storage/migration.mjs';
import { transaction } from '../storage/codec.mjs';
import { MemoryVersions } from './versions.mjs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { digest, MemoryError, splitPassages, validateIntake } from './transcript.mjs';

// No authentication exists in Atlas yet. Every record belongs to this single dev workspace.
export const DEVELOPMENT_USER = 'single-user-development';
export class MeetingStore {
  constructor(filename) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    const hasMeetings = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meetings'").get();
    if (!hasMeetings) initializeEmpty(this.db);
    if (schemaVersion(this.db) !== 2) { this.db.close(); throw new Error('Meeting Memory requires the verified relational migration. Back up and run server/storage/migrate-cli.mjs before starting the backend.'); }
    this.repo = new RelationalMemory(this.db);
    this.versions = new MemoryVersions(this);
    // A crashed worker must not leave a meeting permanently spinning. Originals remain intact.
    for (const meeting of this.list()) {
      if (meeting.status === 'processing') this.update(meeting.id, { status: 'failed', stage: 'interrupted', error: 'Processing was interrupted by a backend restart. Retry to rebuild this meeting’s index.' });
    }
  }
  create(input) {
    const data = validateIntake(input);
    const fingerprintParts = [data.originalTranscript, data.title, data.date, [...data.participants].sort()];
    // Independently captured versions remain distinct even if their wording matches.
    if (data.transcriptSource) fingerprintParts.push(data.transcriptSource);
    const fingerprint = digest(JSON.stringify(fingerprintParts));
    const existing = this.db.prepare('SELECT id FROM meetings WHERE user_id=? AND (fingerprint=? OR source_key=?)').get(DEVELOPMENT_USER, fingerprint, data.sourceKey);
    if (existing) {
      const meeting = this.get(existing.id);
      if (meeting.fingerprint !== fingerprint) throw new MemoryError('This source was already imported with different content or details.', 409, 'MEMORY_SOURCE_CONFLICT');
      if (meeting.originalTranscript !== data.originalTranscript) throw new MemoryError('This original import is preserved as a historical revision, but the meeting now uses a newer source. Open the existing meeting or its exact historical revision.', 409, 'MEMORY_SOURCE_SUPERSEDED');
      const comparableSpeakers = speakers => (speakers ?? []).map(s => data.transcriptSource?.kind === 'diarized_audio' ? { ...s, nameConfirmation: s.nameConfirmation ? { name: s.nameConfirmation.name } : null } : s);
      if (JSON.stringify([comparableSpeakers(meeting.speakers), meeting.segments ?? []]) !== JSON.stringify([comparableSpeakers(data.speakers), data.segments])) throw new MemoryError('This transcript is already saved with different speaker or audio evidence. Existing provenance was preserved; importing cannot overwrite it.', 409, 'MEMORY_PROVENANCE_CONFLICT');
      return { meeting, existing: true };
    }
    const now = new Date().toISOString();
    const meeting = { id: randomUUID(), ...data, fingerprint, passages: splitPassages(data.originalTranscript), status: 'draft', stage: 'saved', error: null, topics: [], cleanedPassages: [], models: null, attempts: 0, createdAt: now, updatedAt: now };
    const revision = this.versions.revisionData(meeting);
    const saved = { ...meeting, revisionId: revision.id, desiredRevisionId: revision.id, publishedGenerationId: null, pipelineSchema: 1 };
    this.repo.putMeeting(saved, { revision });
    return { meeting: saved, existing: false };
  }
  selectDiarized(meeting) {
    const source = meeting.transcriptSource;
    if (source?.kind === 'diarized_audio') this.db.prepare('INSERT OR REPLACE INTO diarized_selections VALUES (?, ?)').run(source.diarizationId, meeting.id);
    return meeting;
  }
  questionMeetings(filters) {
    const meetings = this.list();
    if (filters.meetingIds.length) return meetings; // Explicit historical source selection remains supported.
    const selected = new Map(this.db.prepare('SELECT * FROM diarized_selections').all().map(row => [row.source_id, row.meeting_id]));
    return meetings.filter(m => m.transcriptSource?.kind !== 'diarized_audio' || !selected.has(m.transcriptSource.diarizationId) || selected.get(m.transcriptSource.diarizationId) === m.id);
  }
  get(id) {
    const meeting = this.repo.meeting(id);
    if (!meeting) throw new MemoryError('Meeting not found in this development workspace.', 404, 'MEMORY_NOT_FOUND');
    return meeting;
  }
  list() { return this.repo.meetings(); }
  update(id, patch) {
    const next = { ...this.get(id), ...patch, updatedAt: new Date().toISOString() };
    this.repo.putMeeting(next); return next;
  }
  complete(id, organization, chunks, models) {
    return transaction(this.db, () => {
      if (new Set(chunks.map(c => c.passageId)).size !== chunks.length) throw new MemoryError('Duplicate legacy chunks.');
      this.db.prepare('DELETE FROM legacy_chunk_aliases WHERE meeting_id=?').run(id);
      for (const chunk of chunks) this.repo.putLegacyChunk(id, chunk);
      return this.update(id, { ...organization, models, status: 'ready', stage: 'ready', error: null });
    });
  }
  chunks(id) {
    const meeting = this.get(id);
    return meeting.publishedGenerationId ? this.versions.chunks(id) : this.repo.legacyChunks(id);
  }
  saveAnswer(answer) { return this.repo.putAnswer(answer); }
  answers() { return this.repo.answers(); }
  close() { this.db.close(); }
}
