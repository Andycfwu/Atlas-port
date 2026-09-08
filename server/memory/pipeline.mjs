import { digest, MemoryError } from './transcript.mjs';
import { passageProvenance } from './provenance.mjs';

export const PIPELINE = Object.freeze({ processor: 'atlas-source-topics-v1', prompt: 'atlas-grouping-v1', notesPrompt: 'atlas-notes-v2', splitter: 'intl-sentence-bounded-v1', unitChars: 600, windowBytes: 16_000, windowUnits: 80, requestBytes: 64_000, chunkBytes: 6500, chunkUnits: 64, maxMemberships: 4, maxTopics: 80, embeddingVersion: 'openai-float-v1', normalization: 'cosine-nonzero' });
export const bytes = text => Buffer.byteLength(text, 'utf8');
const invalid = message => { throw new MemoryError(message, 502, 'MEMORY_INVALID_GROUPING'); };
const shape = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));

// A sentence is a useful boundary, not the only boundary. ICU handles abbreviations;
// real turn/segment boundaries, then bounded whitespace/code-point splits handle ASR runs.
// No normalization: units partition every UTF-16 code unit of the original exactly once.
export function sourceUnits(original, revisionId, segments = []) {
  const boundaries = new Set([0, original.length]);
  for (const { index, segment } of new Intl.Segmenter('en', { granularity: 'sentence' }).segment(original)) {
    if (!/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St)\.\s*$/u.test(segment)) boundaries.add(index + segment.length);
  }
  for (const match of original.matchAll(/\r?\n/g)) boundaries.add(match.index + match[0].length);
  for (const s of segments) { boundaries.add(s.start); boundaries.add(s.end); }
  const units = []; let start = 0;
  for (const boundary of [...boundaries].sort((a, b) => a - b)) {
    if (!Number.isInteger(boundary) || boundary < 0 || boundary > original.length) invalid('Invalid supplied source boundary.');
    while (start < boundary) {
      let end = Math.min(start + PIPELINE.unitChars, boundary);
      if (end < boundary) {
        const cut = original.slice(start, end).search(/\s+\S*$/u);
        if (cut > PIPELINE.unitChars / 2) end = start + cut + 1;
        if (/[\uD800-\uDBFF]/.test(original[end - 1])) end--;
      }
      const text = original.slice(start, end);
      // Attach whitespace-only boundaries to their preceding unit, preserving exact bytes.
      if (!text.trim() && units.length && units.at(-1).text.length + text.length <= PIPELINE.unitChars) { units.at(-1).end = end; units.at(-1).text += text; }
      else units.push({ id: `${revisionId.slice(0, 12)}:U${String(units.length + 1).padStart(4, '0')}`, start, end, text });
      start = end;
    }
  }
  validateUnits(original, units);
  return units;
}
export function validateUnits(original, units) {
  let end = 0; const ids = new Set();
  for (const unit of units) {
    if (typeof unit.id !== 'string' || ids.has(unit.id) || !Number.isInteger(unit.start) || !Number.isInteger(unit.end) || unit.start !== end || unit.end <= unit.start || unit.end > original.length || unit.text !== original.slice(unit.start, unit.end)) invalid('Source units do not exactly cover the original transcript.');
    ids.add(unit.id); end = unit.end;
  }
  if (end !== original.length) invalid('Source units lost text at a boundary.');
}
export function inputWindows(units) {
  const windows = []; let current = [], size = 0;
  for (const unit of units) {
    const length = bytes(JSON.stringify(unit));
    if (length > PIPELINE.windowBytes) invalid('A source unit exceeds the processing window.');
    if (current.length && (size + length > PIPELINE.windowBytes || current.length >= PIPELINE.windowUnits)) { windows.push(current); current = []; size = 0; }
    current.push(unit); size += length;
  }
  if (current.length) windows.push(current);
  return windows;
}
export function topicCatalog(groups, units) {
  const map = new Map(units.map(u => [u.id, u]));
  return groups.map(g => ({ id: g.id, title: g.title, firstExcerpt: map.get(g.sourceIds[0]).text.slice(0, 160), latestExcerpt: map.get(g.sourceIds.at(-1)).text.slice(-160) }));
}
export function validateGrouping(raw, units, catalog = []) {
  if (!shape(raw, ['groups', 'omissions']) || !Array.isArray(raw.groups) || !Array.isArray(raw.omissions) || raw.groups.length > PIPELINE.maxTopics) invalid('Grouping must contain bounded groups and an omission ledger.');
  const source = new Map(units.map(u => [u.id, u])), existing = new Set(catalog.map(t => t.id)), counts = new Map(), omitted = new Set();
  for (const g of raw.groups) {
    if (!shape(g, ['title', 'sourceIds', 'continuationOf']) || typeof g.title !== 'string' || !g.title.trim() || g.title.length > 160 || /\b(?:said|stated|promised|agreed|approved|confirmed)\b/i.test(g.title) || (g.continuationOf !== null && !existing.has(g.continuationOf)) || !Array.isArray(g.sourceIds) || !g.sourceIds.length || new Set(g.sourceIds).size !== g.sourceIds.length) invalid('Malformed or duplicate topic sources.');
    for (const id of g.sourceIds) {
      if (!source.has(id)) invalid('A topic selected an unknown source ID.');
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (counts.get(id) > PIPELINE.maxMemberships) invalid('A source may belong to at most four topics.');
    }
  }
  for (const o of raw.omissions) {
    if (!shape(o, ['sourceId', 'reason']) || !source.has(o.sourceId) || omitted.has(o.sourceId) || counts.has(o.sourceId) || !['noise', 'small_talk'].includes(o.reason)) invalid('Invalid, duplicate or conflicting omission.');
    // Conservative guard: short negations/qualifications, corrections and numeric facts
    // cannot disappear merely because the model marked them as marginal.
    const text = source.get(o.sourceId).text;
    if (/\b(?:no|not|never|unless|if|but|correct|correction|instead|deadline|approve|approved|maybe|perhaps|tentative|preliminary|unclear|depends|wait)\b|n['’]t|\d|^(?:yes|okay|ok|agreed)[.!?\s]*$/u.test(text.trim().toLowerCase())) invalid('An omitted source contains a potential qualification, correction or numeric fact. Keep it in a topic.');
    omitted.add(o.sourceId);
  }
  if (units.some(u => !counts.has(u.id) && !omitted.has(u.id))) invalid('Every source must be grouped or explicitly omitted.');
  return raw;
}
export function appendGroups(groups, raw, generationId, units) {
  const positions = new Map(units.map((u, i) => [u.id, i]));
  for (const item of raw.groups) {
    let group = item.continuationOf ? groups.find(g => g.id === item.continuationOf) : null;
    if (!group) { group = { id: `${generationId}:T${groups.length + 1}`, title: item.title, sourceIds: [] }; groups.push(group); }
    group.sourceIds = [...new Set([...group.sourceIds, ...item.sourceIds])].sort((a, b) => positions.get(a) - positions.get(b));
  }
  if (groups.length > PIPELINE.maxTopics) invalid('More than 80 topics were found. Use a smaller completed transcript.');
  return groups;
}
export function assembleChunks(groups, meeting, generationId) {
  const units = meeting.passages, byId = new Map(units.map(u => [u.id, u]));
  validateUnits(meeting.originalTranscript, units);
  const chunks = [];
  for (const topic of groups) {
    const selected = [...topic.sourceIds].sort((a, b) => byId.get(a)?.start - byId.get(b)?.start);
    if (!selected.length || new Set(selected).size !== selected.length || selected.some(id => !byId.has(id))) invalid('Invalid source group at assembly.');
    let body = '', links = [], previous = null, part = 0;
    const flush = () => {
      if (!links.length) return;
      const id = `${generationId}:C${chunks.length + 1}`;
      chunks.push({ id, generationId, revisionId: meeting.revisionId, topicId: topic.id, part: ++part, title: topic.title, text: body, inputHash: digest(`${topic.title}\n${body}`), sourceIds: links.map(l => l.sourceId), links, passageId: links[0].sourceId, contextSourceIds: links.map(l => l.sourceId) });
      body = ''; links = []; previous = null;
    };
    for (const id of selected) {
      const u = byId.get(id);
      let separator = previous && previous.end !== u.start ? '\n' : '';
      if (bytes(body + separator + u.text) > PIPELINE.chunkBytes || links.length >= PIPELINE.chunkUnits) { flush(); separator = ''; }
      if (bytes(u.text) > PIPELINE.chunkBytes) invalid('Source unit too large to embed safely.');
      body += separator + u.text;
      links.push({ sourceId: id, start: u.start, end: u.end, ...passageProvenance(meeting, u) }); previous = u;
    }
    flush();
  }
  return chunks;
}
export const embeddingInput = chunk => `${chunk.title}\n${chunk.text}`;
export function embeddingConfig(provider) { return { model: provider.models.embedding, dimensions: provider.dimensions ?? 512, version: PIPELINE.embeddingVersion, normalization: PIPELINE.normalization }; }
export function processingConfig(provider) { return { ...PIPELINE, groupingModel: provider.models.organization, notesModel: provider.models.organization, reasoning: 'low', embedding: embeddingConfig(provider) }; }
export function validateVectors(vectors, count, dimensions) {
  if (!Array.isArray(vectors) || vectors.length !== count || vectors.some(v => !Array.isArray(v) || v.length !== dimensions || v.some(n => typeof n !== 'number' || !Number.isFinite(n)) || !Number.isFinite(Math.hypot(...v)) || Math.hypot(...v) < 1e-12)) throw new MemoryError('The embedding response has invalid count, dimensions, values or zero norm. Retry processing.', 502, 'MEMORY_INVALID_EMBEDDING');
}
