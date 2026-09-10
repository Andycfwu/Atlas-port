import { MemoryError, validDate } from './transcript.mjs';
import { directSpeakerTarget, passageProvenance, sameName, supportsSpeaker } from './provenance.mjs';

const STOP = new Set('a an the about and or of to in on at for from with did do does what when how why is was were are have has had i we you me my our it this that discuss discussed meeting said tell please'.split(' '));
export const normalize = (s) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
export const terms = (s) => [...new Set((normalize(s).match(/[\p{L}\p{N}]+/gu) ?? []).filter(t => !STOP.has(t)))];
export function lexicalScore(query, text) {
  const q = terms(query), tokens = new Set(terms(text));
  return q.reduce((score, term) => score + (tokens.has(term) ? (/\d/.test(term) ? 3 : 1) : 0), 0) / Math.max(1, q.length);
}
export function cosine(a, b) {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}
export function validateFilters(filters = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) throw new MemoryError('Invalid meeting filters.');
  const { meetingIds = [], participant = '', dateFrom = '', dateTo = '' } = filters;
  if (!Array.isArray(meetingIds) || meetingIds.length > 100 || meetingIds.some(id => typeof id !== 'string' || id.length > 100)) throw new MemoryError('Invalid meeting selection.');
  if (typeof participant !== 'string' || participant.length > 100 || typeof dateFrom !== 'string' || typeof dateTo !== 'string' || (dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo)) || (dateFrom && dateTo && dateFrom > dateTo)) throw new MemoryError('Use valid participant and YYYY-MM-DD date filters, with From no later than To.');
  if (filters.revisionId !== undefined && (meetingIds.length !== 1 || typeof filters.revisionId !== 'string' || !/^[a-f0-9]{64}$/.test(filters.revisionId))) throw new MemoryError('Select exactly one meeting for an explicit transcript revision.');
  return { ...(filters.revisionId ? { revisionId: filters.revisionId } : {}), meetingIds, participant: participant.trim(), dateFrom, dateTo };
}
export function matchesFilters(meeting, filters) {
  return (!filters.meetingIds.length || filters.meetingIds.includes(meeting.id))
    && (!filters.participant || meeting.participants.some(p => normalize(p) === normalize(filters.participant)))
    && (!filters.dateFrom || meeting.date >= filters.dateFrom) && (!filters.dateTo || meeting.date <= filters.dateTo);
}

// Rank source-assembled chunks; admit whole chunks to the evidence budget. Related
// parts precede adjacent context. No partially truncated chunk is passed as complete.
export function retrieve(meetings, chunksFor, query, vector, filters) {
  const eligible = meetings.filter(m => (m.publishedGenerationId || m.status === 'ready') && matchesFilters(m, filters));
  const scored = eligible.flatMap(meeting => chunksFor(meeting.id).map(chunk => ({
    meeting, chunk, score: Math.max(0, cosine(vector, chunk.embedding)) + 1.4 * lexicalScore(query, `${chunk.title ?? ''} ${chunk.text}`),
  }))).sort((a, b) => b.score - a.score || a.meeting.id.localeCompare(b.meeting.id) || a.chunk.passageId.localeCompare(b.chunk.passageId));
  const seeds = scored.filter(row => row.score >= 0.23).slice(0, 6);
  const selected = new Map(), selectedChunks = new Map(); let size = 0, truncated = false;
  const source = (meeting, id) => {
    const passage = meeting.passages.find(p => p.id === id);
    return passage && { meetingId: meeting.id, meetingTitle: meeting.title, date: meeting.date, participants: meeting.participants, passageId: id, revisionId: meeting.revisionId, generationId: meeting.publishedGenerationId, start: passage.start, end: passage.end, text: passage.text, startsAtLineBoundary: passage.start === 0 || /[\r\n]/.test(meeting.originalTranscript[passage.start - 1]), ...passageProvenance(meeting, passage), ...(meeting.transcriptSource ? { transcriptSource: meeting.transcriptSource } : {}) };
  };
  const add = (meeting, ids, chunk) => {
    const rows = ids.filter(id => !selected.has(`${meeting.id}/${id}`)).map(id => source(meeting, id)).filter(Boolean);
    const cost = Buffer.byteLength(JSON.stringify(rows.map(({ revisionId, generationId, meetingTitle, date, participants, transcriptSource, ...evidence }) => evidence)), 'utf8');
    if (size + cost > 42_000) { truncated = true; return; }
    for (const row of rows) selected.set(`${meeting.id}/${row.passageId}`, row);
    size += cost;
    if (chunk) selectedChunks.set(chunk.id ?? `${meeting.id}/${chunk.passageId}`, { ...chunk, embedding: undefined });
  };
  for (const { meeting, chunk } of seeds) {
    if (chunk.sourceIds) {
      add(meeting, chunk.sourceIds, chunk);
      for (const related of scored.filter(r => r.meeting.id === meeting.id && r.chunk.topicId === chunk.topicId && r.chunk.id !== chunk.id).sort((a, b) => a.chunk.part - b.chunk.part)) add(meeting, related.chunk.sourceIds, related.chunk);
    } else { // Read-only legacy generation migration: retain its original retrieval links.
      const topics = meeting.topics.filter(t => t.sourceIds.includes(chunk.passageId)).sort((a, b) => lexicalScore(query, b.title) - lexicalScore(query, a.title)).slice(0, 2);
      for (const topic of topics) add(meeting, topic.sourceIds);
      add(meeting, chunk.contextSourceIds ?? [chunk.passageId], chunk);
    }
  }
  // Omitted text is still searchable verbatim (e.g. an explicit weather question).
  // It has no vector and does not enter unrelated topic chunks.
  for (const meeting of eligible) for (const omission of meeting.omissions ?? []) {
    const p = meeting.passages.find(p => p.id === omission.sourceId);
    if (p && lexicalScore(query, p.text) >= 0.6) add(meeting, [p.id]);
  }
  const originals = [...selected.values()];
  for (const row of originals) {
    const meeting = eligible.find(m => m.id === row.meetingId), index = meeting.passages.findIndex(p => p.id === row.passageId);
    add(meeting, meeting.passages.slice(Math.max(0, index - 1), index + 2).map(p => p.id));
  }
  return { sources: [...selected.values()], chunks: [...selectedChunks.values()], truncated, eligibleMeetings: eligible.length };
}

export function validateAnswer(answer, sources, question = '') {
  const invalid = () => { throw new MemoryError('The answer could not be verified against its original passages. Please retry or narrow the question.', 502, 'MEMORY_CITATION_INVALID'); };
  if (!answer || !['answered', 'insufficient_evidence', 'clarification'].includes(answer.status) || !Array.isArray(answer.statements)) invalid();
  const target = directSpeakerTarget(question) ?? answer.requestedSpeaker ?? null;
  const scope = target ? 'speaker' : (answer.scope ?? 'meeting');
  if (!['meeting', 'speaker'].includes(scope)) invalid();
  if (answer.status !== 'answered') {
    if (answer.statements.length || (answer.status === 'clarification' && (typeof answer.clarification !== 'string' || !answer.clarification.trim()))) invalid();
    return { ...answer, scope, requestedSpeaker: target, limitation: scope === 'speaker' ? 'Insufficient speaker attribution: the retrieved evidence does not identify the requested speaker’s statements. Meeting participants are attendance metadata, not voice identities.' : (answer.limitation ?? null), clarification: answer.status === 'clarification' ? answer.clarification : null, statements: [] };
  }
  if (!answer.statements.length || answer.statements.length > 20) invalid();
  const map = new Map(sources.map(p => [`${p.meetingId}/${p.passageId}`, p]));
  for (const statement of answer.statements) {
    if (typeof statement.text !== 'string' || !statement.text.trim() || !['discussion', 'proposal', 'decision', 'action', 'uncertainty'].includes(statement.kind) || !Array.isArray(statement.citations) || !statement.citations.length) invalid();
    for (const citation of statement.citations) {
      const source = map.get(`${citation.meetingId}/${citation.passageId}`);
      if (!source || typeof citation.quote !== 'string' || !citation.quote.trim() || !source.text.includes(citation.quote)) invalid();
      if (citation.speaker && !supportsSpeaker(source, citation.quote, citation.speaker, citation.segmentId)) invalid();
    }
    if (scope === 'speaker' && (!target || !statement.citations.some(c => sameName(c.speaker, target) && supportsSpeaker(map.get(`${c.meetingId}/${c.passageId}`), c.quote, target, c.segmentId)))) invalid();
  }
  return { ...answer, scope, requestedSpeaker: target, limitation: answer.limitation ?? null, clarification: null };
}
