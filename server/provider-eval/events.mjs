// Preserve native events and attribution first; derived views never use Atlas
// passage display or guesses from turn-level dominance / participant names.
export const knownSpeaker = id => id !== null && id !== undefined && !['PENDING', 'UU'].includes(id);
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const time = (n, scale) => finite(n) ? n * scale : null;
const id = value => value === undefined || value === null ? null :
  (typeof value === 'string' && value.length <= 100) || (Number.isSafeInteger(value) && value >= 0) ? value : null;
const text = value => { if (typeof value !== 'string' || value.length > 100000) throw new Error('INVALID_TEXT'); return value; };
const list = value => { if (!Array.isArray(value) || value.length > 4000) throw new Error('INVALID_WORDS'); return value; };
function word(value, provider, final) {
  const a = provider === 'speechmatics' ? value.alternatives?.[0] : value;
  if (!a) throw new Error('MISSING_WORD_ALTERNATIVE');
  const startMs = time(provider === 'speechmatics' ? value.start_time : value.start, provider === 'assemblyai' ? 1 : 1000);
  const endMs = time(provider === 'speechmatics' ? value.end_time : value.end, provider === 'assemblyai' ? 1 : 1000);
  return { text: text(provider === 'deepgram' ? a.punctuated_word ?? a.word : provider === 'speechmatics' ? a.content : a.text),
    startMs, endMs, providerSpeaker: id(a.speaker), wordFinal: provider === 'assemblyai' ? value.word_is_final === true : final,
    kind: provider === 'speechmatics' ? value.type : 'word',
    timingValid: startMs !== null && endMs !== null && endMs >= startMs };
}
export function decode(provider, event) {
  // Speechmatics uses message for the event and type for the error subtype.
  const kind = provider === 'speechmatics' ? event.message : event.type;
  if (kind === 'Error' || event.error) return { error: `PROVIDER_ERROR_${String(event.error_code ?? event.type ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)}` };
  if (provider === 'deepgram') {
    if (kind === 'Metadata') return { metadata: event, completionMetadata: true };
    if (kind !== 'Results') return {};
    if (typeof event.is_final !== 'boolean' || !finite(event.start) || !finite(event.duration)) throw new Error('INVALID_RESULT');
    const alternative = event.channel?.alternatives?.[0];
    if (!alternative) throw new Error('INVALID_ALTERNATIVE');
    return { metadata: event.metadata, record: { key: `r${Math.round(event.start * 1e6)}`, isFinal: event.is_final,
      text: text(alternative.transcript), startMs: event.start * 1000, endMs: (event.start + event.duration) * 1000,
      words: list(alternative.words).map(w => word(w, provider, event.is_final)), speakerLabel: null } };
  }
  if (provider === 'assemblyai') {
    if (kind === 'Begin') {
      if (event.configuration?.model !== 'universal-3-5-pro') throw new Error('UNVERIFIED_RESOLVED_MODEL');
      return { ready: true, metadata: event };
    }
    if (kind === 'Termination') return { complete: true, usage: event };
    if (kind === 'SpeakerRevision') return { revisions: list(event.revisions) };
    if (kind !== 'Turn') return {};
    if (!Number.isSafeInteger(event.turn_order) || event.turn_order < 0 || typeof event.end_of_turn !== 'boolean') throw new Error('INVALID_TURN');
    const words = list(event.words).map(w => word(w, provider, event.end_of_turn));
    return { record: { key: `turn${event.turn_order}`, text: text(event.transcript),
      isFinal: event.end_of_turn === true && event.turn_is_formatted === true,
      startMs: words[0]?.startMs ?? null, endMs: words.at(-1)?.endMs ?? null,
      speakerLabel: id(event.speaker_label), words } };
  }
  if (provider === 'speechmatics') {
    if (kind === 'RecognitionStarted') return { ready: true, metadata: event };
    if (kind === 'EndOfTranscript') return { complete: true };
    if (!['AddTranscript', 'AddPartialTranscript'].includes(kind)) return {};
    const final = kind === 'AddTranscript', meta = event.metadata;
    if (!finite(meta?.start_time) || !finite(meta?.end_time)) throw new Error('INVALID_TRANSCRIPT_TIMING');
    return { record: { key: `span${meta.start_time}:${meta.end_time}`, text: text(meta.transcript), isFinal: final,
      startMs: meta.start_time * 1000, endMs: meta.end_time * 1000,
      words: list(event.results).map(w => word(w, provider, final)), speakerLabel: null } };
  }
  throw new Error('UNKNOWN_PROVIDER');
}
export class EventJournal {
  constructor(provider, durationMs) {
    this.provider = provider; this.durationMs = durationMs; this.rawEvents = []; this.records = [];
    this.metadata = []; this.revisions = []; this.firstProvisionalLabeledMs = null; this.firstFinalLabeledMs = null;
    this.duplicateFinalEvents = 0; this.changedFinalEvents = 0; this.finals = new Map(); this.stopAtMs = null;
  }
  accept(event, atMs) {
    this.rawEvents.push({ receivedAtMs: atMs, event });
    const decoded = decode(this.provider, event);
    if (decoded.metadata) this.metadata.push(decoded.metadata);
    if (decoded.usage) this.usage = decoded.usage;
    if (decoded.revisions) this.revisions.push({ receivedAtMs: atMs, items: decoded.revisions });
    if (decoded.record) {
      const r = { ...decoded.record, receivedAtMs: atMs };
      r.words.forEach(w => { w.timingValid &&= w.endMs <= this.durationMs + 250; });
      this.records.push(r);
      const labeled = r.text && (r.words.some(w => knownSpeaker(w.providerSpeaker)) || knownSpeaker(r.speakerLabel));
      const field = r.isFinal ? 'firstFinalLabeledMs' : 'firstProvisionalLabeledMs';
      if (labeled && this[field] === null) this[field] = atMs;
      if (r.isFinal) {
        const previous = this.finals.get(r.key);
        if (previous) {
          const fingerprint = v => JSON.stringify({ text: v.text, words: v.words });
          if (fingerprint(previous) === fingerprint(r)) this.duplicateFinalEvents++;
          else this.changedFinalEvents++;
        }
        this.finals.set(r.key, r);
      }
    }
    return decoded;
  }
  markStop(atMs) { this.stopAtMs = atMs; this.beforeStop = [...this.finals.values()]; }
  snapshot() {
    const finalRecords = [...this.finals.values()];
    const revisedRecords = structuredClone(finalRecords), revisionIssues = [];
    for (const revision of this.revisions.flatMap(r => r.items)) {
      const record = revisedRecords.find(r => r.key === `turn${revision.turn_order}`);
      const words = revision.words;
      if (!record || !Array.isArray(words) || words.length !== record.words.length || words.some((w, i) =>
        w.text !== record.words[i].text || w.start !== record.words[i].startMs || w.end !== record.words[i].endMs)) {
        revisionIssues.push({ turn: revision.turn_order, issue: 'Revision has no exact unchanged text/timing match; retained raw, not applied.' }); continue;
      }
      record.speakerLabel = id(revision.speaker_label);
      words.forEach((w, i) => { record.words[i].providerSpeaker = id(w.speaker); });
    }
    const before = this.beforeStop ?? [];
    return { provider: this.provider, rawEvents: this.rawEvents, records: this.records, finalRecords, revisedRecords,
      revisions: this.revisions, revisionIssues, metadata: this.metadata, usage: this.usage ?? null,
      firstProvisionalLabeledMs: this.firstProvisionalLabeledMs, firstFinalLabeledMs: this.firstFinalLabeledMs,
      stop: { requestedAtMs: this.stopAtMs, finalRecordsBeforeStop: before,
        finalEventsAfterStop: this.stopAtMs === null ? null : this.records.filter(r => r.isFinal && r.receivedAtMs >= this.stopAtMs).length,
        lostFinalKeys: before.filter(a => !finalRecords.some(b => a.key === b.key)).map(r => r.key),
        changedFinalKeysAfterStop: before.filter(a => finalRecords.some(b => a.key === b.key && a.text !== b.text)).map(r => r.key),
        duplicateFinalEvents: this.duplicateFinalEvents, changedFinalEvents: this.changedFinalEvents },
    };
  }
}
