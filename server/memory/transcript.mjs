import { createHash } from 'node:crypto';
import { passageProvenance, sameName, validateProvenance } from './provenance.mjs';

export const MAX_TRANSCRIPT_CHARS = 60_000;
export const MAX_PASSAGES = 180;
export class MemoryError extends Error {
  constructor(message, status = 400, code = 'MEMORY_INVALID_INPUT') {
    super(message); this.status = status; this.code = code;
  }
}
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function validateIntake(input) {
  if (!input || typeof input !== 'object') throw new MemoryError('Meeting details are required.');
  const { originalTranscript, title, date, participants, sourceKey = null } = input;
  if (typeof originalTranscript !== 'string' || !originalTranscript.trim() || originalTranscript.length > MAX_TRANSCRIPT_CHARS || originalTranscript.includes('\0')) {
    throw new MemoryError(`Use a non-empty text transcript of at most ${MAX_TRANSCRIPT_CHARS.toLocaleString()} characters, without null bytes.`);
  }
  if (typeof title !== 'string' || !title.trim() || title.length > 160) throw new MemoryError('Enter a meeting title of at most 160 characters.');
  if (!validDate(date)) throw new MemoryError('Enter a valid meeting date as YYYY-MM-DD.');
  if (!Array.isArray(participants) || participants.length > 40 || participants.some(p => typeof p !== 'string' || !p.trim() || p.length > 100)) throw new MemoryError('Use up to 40 participant names, each at most 100 characters.');
  if (sourceKey !== null && (typeof sourceKey !== 'string' || sourceKey.length > 200 || !sourceKey.trim())) throw new MemoryError('Invalid transcript source key.');
  let transcriptSource;
  if (input.transcriptSource !== undefined) {
    const source = input.transcriptSource;
    if (!source || !['live', 'saved_audio', 'diarized_audio', 'live_speakers'].includes(source.kind)
      || typeof source.recordingId !== 'string' || !source.recordingId.trim() || source.recordingId.length > 200
      || !['completed', 'paused', 'failed', 'finishing'].includes(source.status)
      || [source.traceId, source.model].some(v => v !== null && (typeof v !== 'string' || !v.trim() || v.length > 200))) throw new MemoryError('Invalid recording transcript provenance.');
    if (source.kind === 'diarized_audio' && (!/^[a-f0-9]{64}$/.test(source.diarizationId) || !/^[a-f0-9]{64}$/.test(source.namesKey))) throw new MemoryError('Invalid diarized source version.');
    const extra = {};
    for (const key of ['provider', 'sourceVersionId', 'createdAt', 'configurationVersion']) if (source[key] !== undefined) {
      if (typeof source[key] !== 'string' || !source[key].trim() || source[key].length > 200) throw new MemoryError('Invalid transcript version metadata.');
      extra[key] = source[key];
    }
    transcriptSource = { ...extra, ...(source.kind === 'diarized_audio' ? { diarizationId: source.diarizationId, namesKey: source.namesKey } : {}), kind: source.kind, recordingId: source.recordingId, traceId: source.traceId, model: source.model, status: source.status };
  }
  let provenance;
  try { provenance = validateProvenance(input, originalTranscript); }
  catch (error) { throw new MemoryError(error.message); }
  return { originalTranscript, title: title.trim(), date, participants: [...new Set(participants.map(p => p.trim()))], sourceKey, ...provenance, ...(transcriptSource ? { transcriptSource } : {}) };
}

// Offsets address the immutable original JS string (UTF-16), not cleaned text.
// Group complete lines/turns into contextual passages; never synthesize speakers or times.
export function splitPassages(original) {
  const passages = [];
  let start = 0;
  while (start < original.length) {
    let end = Math.min(start + 1100, original.length);
    if (end < original.length) {
      const newline = original.lastIndexOf('\n', end);
      const space = original.lastIndexOf(' ', end);
      if (newline > start + 250) end = newline + 1;
      else if (space > start + 600) end = space + 1;
      // Avoid bisecting a surrogate pair on an unusually long unbroken line.
      else if (/[\uD800-\uDBFF]/.test(original[end - 1])) end -= 1;
    }
    passages.push({ id: `P${String(passages.length + 1).padStart(4, '0')}`, start, end, text: original.slice(start, end) });
    start = end;
  }
  if (passages.length > MAX_PASSAGES) throw new MemoryError('This transcript has too many passages. Import a shorter meeting.');
  return passages;
}

export function contextualChunks(meeting) {
  return meeting.passages.map((passage, index) => {
    const neighbors = meeting.passages.slice(Math.max(0, index - 1), index + 2);
    const evidence = passageProvenance(meeting, { start: neighbors[0].start, end: neighbors.at(-1).end });
    return {
      passageId: passage.id,
      contextSourceIds: neighbors.map(p => p.id),
      text: `Meeting: ${meeting.title}\nDate: ${meeting.date}\nParticipants (metadata, not speaker attribution): ${meeting.participants.join(', ')}\n${evidence.speakers.length ? `Supplied speaker evidence (separate from attendance): ${JSON.stringify(evidence)}\n` : ''}Focus passage: ${passage.id}\n${neighbors.map(p => `[${p.id}] ${p.text}`).join('\n')}`,
    };
  });
}

const nonempty = (value) => typeof value === 'string' && Boolean(value.trim());
const numericTokens = (value) => value.match(/\d+(?:[,.:%/-]\d+)*%?/g) ?? [];
export function validateOrganization(result, passages, meeting = {}) {
  const originals = new Map(passages.map(p => [p.id, p.text]));
  const refs = (ids) => {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !originals.has(id)) || new Set(ids).size !== ids.length) throw new MemoryError('The model returned invalid source references. Retry processing.', 502, 'MEMORY_INVALID_MODEL_OUTPUT');
    return ids;
  };
  const invalid = () => { throw new MemoryError('The model returned incomplete or unsupported structured data. Retry processing.', 502, 'MEMORY_INVALID_MODEL_OUTPUT'); };
  if (!result || !Array.isArray(result.cleanedPassages) || result.cleanedPassages.length !== passages.length || !Array.isArray(result.topics) || result.topics.length > 40) invalid();
  const seen = new Set();
  for (const p of result.cleanedPassages) {
    if (!originals.has(p.passageId) || seen.has(p.passageId) || (!nonempty(p.text) && p.text !== originals.get(p.passageId)) || typeof p.smallTalk !== 'boolean') invalid();
    seen.add(p.passageId);
    // A colon can be ordinary edited punctuation ("Harbor Court lot B-17:").
    // Only check actual identity/timing markers here. Attendance is used solely to
    // reject newly invented name labels, never to establish a speaker's identity.
    const names = [...(meeting.participants ?? []), ...(meeting.speakers ?? []).flatMap(s => [s.label, s.nameConfirmation?.name].filter(Boolean))];
    const markers = p.text.match(/(?:^|\n)\s*(?:Speaker \d+|Unknown speaker|Unlabeled speaker)\s*:/gi) ?? [];
    markers.push(...(p.text.match(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g) ?? []));
    for (const line of p.text.split(/\r?\n/)) for (const name of names) if (line.trimStart().toLowerCase().startsWith(`${name.toLowerCase()}:`)) markers.push(line.trimStart().slice(0, name.length + 1));
    for (const marker of markers) if (!originals.get(p.passageId).includes(marker.trimStart())) invalid();
    // Digits in supplied labels, dates, costs and identifiers must survive cleanup verbatim.
    if (numericTokens(originals.get(p.passageId)).some(n => !numericTokens(p.text).includes(n))) throw new MemoryError('The cleaned version changed or omitted a number or timestamp. The original is preserved; retry processing.', 502, 'MEMORY_NUMERIC_FIDELITY');
  }
  const topics = result.topics.map((topic, index) => {
    if (!nonempty(topic.title) || !nonempty(topic.summary?.text) || !Array.isArray(topic.items)) invalid();
    refs(topic.summary.sourceIds);
    for (const item of topic.items) {
      if (!nonempty(item.text) || !['discussion', 'proposal', 'decision', 'open_question', 'action'].includes(item.kind)) invalid();
      refs(item.sourceIds);
      const source = item.sourceIds.map(id => originals.get(id)).join('\n');
      for (const field of ['owner', 'deadline']) {
        const suppliedOwner = field === 'owner' && item.sourceIds.some(id => {
          const evidence = passageProvenance(meeting, passages.find(p => p.id === id));
          return evidence.speakers.some(s => sameName(s.label, item.owner) || sameName(s.nameConfirmation?.name, item.owner));
        });
        if (item[field] !== null && (!nonempty(item[field]) || (!source.includes(item[field]) && !suppliedOwner))) invalid();
      }
      if (item.kind !== 'action' && (item.owner !== null || item.deadline !== null)) invalid();
    }
    return { ...topic, id: `T${String(index + 1).padStart(3, '0')}`, sourceIds: [...new Set([...topic.summary.sourceIds, ...topic.items.flatMap(item => item.sourceIds)])] };
  });
  return { cleanedPassages: result.cleanedPassages, topics };
}
