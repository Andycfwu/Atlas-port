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
  return { meetingIds, participant: participant.trim(), dateFrom, dateTo };
}
export function matchesFilters(meeting, filters) {
  return (!filters.meetingIds.length || filters.meetingIds.includes(meeting.id))
    && (!filters.participant || meeting.participants.some(p => normalize(p) === normalize(filters.participant)))
    && (!filters.dateFrom || meeting.date >= filters.dateFrom) && (!filters.dateTo || meeting.date <= filters.dateTo);
}

// Hybrid scoring is over original contextual passages. Topic links expand recurrent
// discussion before answering, so a later correction can accompany an earlier estimate.
export function retrieve(meetings, chunksFor, query, vector, filters) {
  const eligible = meetings.filter(m => m.status === 'ready' && matchesFilters(m, filters));
  const scored = eligible.flatMap(meeting => chunksFor(meeting.id).map(chunk => ({
    meeting, chunk, score: Math.max(0, cosine(vector, chunk.embedding)) + 1.4 * lexicalScore(query, chunk.text),
  }))).sort((a, b) => b.score - a.score || a.meeting.id.localeCompare(b.meeting.id) || a.chunk.passageId.localeCompare(b.chunk.passageId));
  const seeds = scored.filter(row => row.score >= 0.23).slice(0, 6);
  const selected = new Map();
  const add = (meeting, id) => {
    const passage = meeting.passages.find(p => p.id === id);
    if (passage) selected.set(`${meeting.id}/${id}`, { meetingId: meeting.id, meetingTitle: meeting.title, date: meeting.date, participants: meeting.participants, passageId: id, start: passage.start, end: passage.end, text: passage.text, startsAtLineBoundary: passage.start === 0 || /[\r\n]/.test(meeting.originalTranscript[passage.start - 1]), ...passageProvenance(meeting, passage), ...(meeting.transcriptSource ? { transcriptSource: meeting.transcriptSource } : {}) });
  };
  // Add ALL linked topic passages first, ahead of neighbor context, up to the source budget.
  for (const { meeting, chunk } of seeds) {
    const topics = meeting.topics.filter(t => t.sourceIds.includes(chunk.passageId))
      .map(t => ({ topic: t, score: lexicalScore(query, `${t.title} ${t.summary.text}`) }))
      .sort((a, b) => b.score - a.score).slice(0, 2);
    for (const { topic } of topics) for (const id of topic.sourceIds) add(meeting, id);
    add(meeting, chunk.passageId);
  }
  for (const { meeting, chunk } of seeds) for (const id of chunk.contextSourceIds) add(meeting, id);
  const all = [...selected.values()];
  return { sources: all.slice(0, 72), truncated: all.length > 72, eligibleMeetings: eligible.length };
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
