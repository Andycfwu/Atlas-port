export type LiveProvider = 'openai' | 'deepgram';
export interface LiveSpeakerPassage {
  id: string; text: string; startMs: number; endMs: number; providerSpeaker: number | null; speakerId: string | null;
}
export interface LiveSpeakerResult {
  id: string; connectionId: string; startMs: number; endMs: number; isFinal: boolean; text: string;
  timingWarning?: boolean;
  unvalidatedWords?: { text: string; startMs: number; endMs: number; providerSpeaker: number | null }[];
  speechFinal: boolean; fromFinalize: boolean;
  words: { text: string; rawWord: string; startMs: number; endMs: number; providerSpeaker: number | null }[];
  passages: LiveSpeakerPassage[]; providerMetadata: Record<string, string>;
}
export interface LiveSpeakerSession {
  connectionId: string; provider: 'deepgram'; sampleRate: number; timebase: 'provider-stream'; audioOffsetMs: null;
  configuration: { configurationVersion: string; model: string; version: string; diarize_model: string; language: string; [key: string]: string | number | boolean };
  providerMetadata?: Record<string, string>;
}
export interface LiveSpeakerSnapshot {
  sessions: LiveSpeakerSession[]; finalResults: LiveSpeakerResult[]; provisionalResults: LiveSpeakerResult[]; text: string;
  diagnostics?: { client: Record<string, number>; server: Record<string, number> };
}
export interface SavedLiveSpeakerTranscript extends LiveSpeakerSnapshot {
  id: string; schemaVersion: 1; source: 'live_speakers'; provider: 'deepgram'; recorderSessionId: string;
  status: 'completed' | 'paused' | 'failed' | 'finishing'; savedAt: string; errorMessage: string | null;
}
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const string = (value: unknown): value is string => typeof value === 'string' && value.length <= 32_000;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const speaker = (value: unknown): value is number | null => value === null || (Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1000);
export const isSpeakerMetadata = (value: unknown): value is Record<string, string> => record(value) && Object.entries(value).every(([key, v]) => ['requestId', 'modelName', 'modelVersion', 'modelUuid', 'diarizerUuid', 'diarizerVersion'].includes(key) && typeof v === 'string' && v.length <= 200);
export function isSpeakerSession(value: unknown): value is LiveSpeakerSession {
  if (!record(value) || typeof value.connectionId !== 'string' || !/^dg-[a-zA-Z0-9-]{1,80}$/.test(value.connectionId)
    || value.provider !== 'deepgram' || !time(value.sampleRate) || value.sampleRate < 8000 || value.sampleRate > 96000
    || value.timebase !== 'provider-stream' || value.audioOffsetMs !== null || !record(value.configuration)) return false;
  const config = value.configuration;
  return config.configurationVersion === 'atlas-deepgram-live-v1' && config.model === 'nova-3' && config.version === 'latest'
    && config.diarize_model === 'v1' && config.language === 'en-US' && Object.values(config).every(v => ['string','number','boolean'].includes(typeof v));
}
export function isSpeakerResult(value: unknown): value is LiveSpeakerResult {
  if (!record(value) || typeof value.connectionId !== 'string' || !/^dg-[a-zA-Z0-9-]{1,80}$/.test(value.connectionId)
    || typeof value.id !== 'string' || !value.id.startsWith(`${value.connectionId}:r`)
    || !time(value.startMs) || !time(value.endMs) || value.endMs < value.startMs || !string(value.text)
    || typeof value.isFinal !== 'boolean' || typeof value.speechFinal !== 'boolean' || typeof value.fromFinalize !== 'boolean'
    || !isSpeakerMetadata(value.providerMetadata) || !Array.isArray(value.words) || value.words.length > 2000
    || !Array.isArray(value.passages) || value.passages.length > 2000) return false;
  if (value.timingWarning !== undefined && (value.timingWarning !== true || value.isFinal || !Array.isArray(value.unvalidatedWords) || value.unvalidatedWords.length > 2000 || value.unvalidatedWords.some(w => !record(w) || !string(w.text) || !time(w.startMs) || !time(w.endMs) || w.startMs > 86400000 || w.endMs > 86400000 || !speaker(w.providerSpeaker)))) return false;
  const inBounds = (part: Record<string, unknown>) => time(part.startMs) && time(part.endMs) && part.endMs >= part.startMs
    && part.startMs >= Number(value.startMs) - 100 && part.endMs <= Number(value.endMs) + 100;
  return value.words.every(w => record(w) && string(w.text) && string(w.rawWord) && speaker(w.providerSpeaker) && inBounds(w))
    && value.passages.every((p, i) => record(p) && p.id === `${value.id}:p${i}` && string(p.text) && speaker(p.providerSpeaker) && inBounds(p)
      && p.speakerId === (p.providerSpeaker === null ? null : `${value.connectionId}:speaker${p.providerSpeaker}`));
}
// One replaceable provisional result per connection. Final results are immutable.
// A different connection always introduces a different anonymous speaker namespace.
export class LiveSpeakerAccumulator {
  private sessions = new Map<string, LiveSpeakerSession>();
  private finals = new Map<string, LiveSpeakerResult>();
  private provisional = new Map<string, LiveSpeakerResult>();
  private bytes = 0;
  start(session: LiveSpeakerSession) {
    if (!isSpeakerSession(session)) throw new Error('Invalid live speaker session.');
    if (!this.sessions.has(session.connectionId)) this.sessions.set(session.connectionId, session);
  }
  metadata(connectionId: string, metadata: Record<string, string>) {
    const session = this.sessions.get(connectionId);
    if (!session || !isSpeakerMetadata(metadata)) throw new Error('Invalid speaker provenance.');
    this.sessions.set(connectionId, { ...session, providerMetadata: { ...session.providerMetadata, ...metadata } });
  }
  accept(result: LiveSpeakerResult) {
    if (!isSpeakerResult(result) || !this.sessions.has(result.connectionId)) throw new Error('Invalid live speaker result.');
    const existing = this.finals.get(result.id);
    if (existing && result.isFinal) {
      if (JSON.stringify(existing) === JSON.stringify(result)) return;
      throw new Error('Conflicting finalized live text.');
    }
    if (result.isFinal) {
      const size = JSON.stringify(result).length * 2;
      if (this.bytes + size > 4 * 1024 * 1024 || this.finals.size >= 5000) throw new Error('Live speaker text reached its storage bound.');
      this.bytes += size; this.finals.set(result.id, result);
      // A final may cover only the prefix of a longer interim (Deepgram's
      // documented partial-final sequence). Retain the unfinalized evidence.
      const pending = this.provisional.get(result.connectionId);
      if (pending && pending.endMs <= result.endMs + 5) this.provisional.delete(result.connectionId);
    } else {
      const lastEnd = Math.max(0, ...Array.from(this.finals.values()).filter(r => r.connectionId === result.connectionId).map(r => r.endMs));
      if (result.endMs <= lastEnd + 5) return;
      this.provisional.set(result.connectionId, result);
    }
  }
  snapshot(): LiveSpeakerSnapshot {
    const finalResults = Array.from(this.finals.values());
    return { sessions: Array.from(this.sessions.values()), finalResults, provisionalResults: Array.from(this.provisional.values()),
      text: finalResults.map(r => r.text).filter(Boolean).join('\n') };
  }
}

// Only provider timing is used to hide a finalized prefix. The stored original
// interim is unchanged, and is never promoted to finalized text.
export function displayedSpeakerPassages(result: LiveSpeakerResult, finals: LiveSpeakerResult[]) {
  const covered = result.isFinal ? -1 : Math.max(-1, ...finals.filter(r => r.connectionId === result.connectionId).map(r => r.endMs));
  if (result.words.map(w => w.text).join(' ').trim() !== result.text.trim()) {
    return [{ id: `${result.id}:original`, text: result.text, startMs: result.startMs, endMs: result.endMs, providerSpeaker: null, speakerId: null }];
  }
  const passages: LiveSpeakerPassage[] = [];
  for (const word of result.words.filter(w => w.endMs > covered + 5)) {
    const last = passages.at(-1);
    if (last && last.providerSpeaker === word.providerSpeaker) { last.text += ` ${word.text}`; last.endMs = Math.max(last.endMs, word.endMs); }
    else passages.push({ id: `${result.id}:visible${passages.length}`, text: word.text, startMs: word.startMs, endMs: word.endMs, providerSpeaker: word.providerSpeaker,
      speakerId: word.providerSpeaker === null ? null : `${result.connectionId}:speaker${word.providerSpeaker}` });
  }
  return passages;
}
