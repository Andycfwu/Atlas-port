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
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        source_key TEXT, payload TEXT NOT NULL,
        UNIQUE(user_id, fingerprint), UNIQUE(user_id, source_key)
      );
      CREATE TABLE IF NOT EXISTS chunks (
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        passage_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(meeting_id, passage_id)
      );
      CREATE TABLE IF NOT EXISTS answers (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, payload TEXT NOT NULL
      );`);
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
    const existing = this.db.prepare('SELECT payload FROM meetings WHERE user_id=? AND (fingerprint=? OR source_key=?)').get(DEVELOPMENT_USER, fingerprint, data.sourceKey);
    if (existing) {
      const meeting = JSON.parse(existing.payload);
      if (meeting.fingerprint !== fingerprint) throw new MemoryError('This source was already imported with different content or details.', 409, 'MEMORY_SOURCE_CONFLICT');
      if (JSON.stringify([meeting.speakers ?? [], meeting.segments ?? []]) !== JSON.stringify([data.speakers, data.segments])) throw new MemoryError('This transcript is already saved with different speaker or audio evidence. Existing provenance was preserved; importing cannot overwrite it.', 409, 'MEMORY_PROVENANCE_CONFLICT');
      return { meeting, existing: true };
    }
    const now = new Date().toISOString();
    const meeting = { id: randomUUID(), ...data, fingerprint, passages: splitPassages(data.originalTranscript), status: 'draft', stage: 'saved', error: null, topics: [], cleanedPassages: [], models: null, attempts: 0, createdAt: now, updatedAt: now };
    this.db.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?)').run(meeting.id, DEVELOPMENT_USER, fingerprint, data.sourceKey, JSON.stringify(meeting));
    return { meeting, existing: false };
  }
  get(id) {
    const row = this.db.prepare('SELECT payload FROM meetings WHERE id=? AND user_id=?').get(id, DEVELOPMENT_USER);
    if (!row) throw new MemoryError('Meeting not found in this development workspace.', 404, 'MEMORY_NOT_FOUND');
    return JSON.parse(row.payload);
  }
  list() {
    return this.db.prepare('SELECT payload FROM meetings WHERE user_id=?').all(DEVELOPMENT_USER).map(row => JSON.parse(row.payload)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  update(id, patch) {
    const next = { ...this.get(id), ...patch, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE meetings SET payload=? WHERE id=? AND user_id=?').run(JSON.stringify(next), id, DEVELOPMENT_USER);
    return next;
  }
  complete(id, organization, chunks, models) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM chunks WHERE meeting_id=?').run(id);
      const insert = this.db.prepare('INSERT INTO chunks VALUES (?, ?, ?)');
      for (const chunk of chunks) insert.run(id, chunk.passageId, JSON.stringify(chunk));
      const meeting = this.update(id, { ...organization, models, status: 'ready', stage: 'ready', error: null });
      this.db.exec('COMMIT');
      return meeting;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  chunks(id) {
    this.get(id);
    return this.db.prepare('SELECT payload FROM chunks WHERE meeting_id=? ORDER BY passage_id').all(id).map(row => JSON.parse(row.payload));
  }
  saveAnswer(answer) {
    this.db.prepare('INSERT INTO answers VALUES (?, ?, ?)').run(answer.id, DEVELOPMENT_USER, JSON.stringify(answer));
    return answer;
  }
  answers() {
    return this.db.prepare('SELECT payload FROM answers WHERE user_id=? ORDER BY rowid DESC LIMIT 100').all(DEVELOPMENT_USER).map(row => JSON.parse(row.payload));
  }
  close() { this.db.close(); }
}
