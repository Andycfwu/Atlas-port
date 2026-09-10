import { knownSpeaker } from './events.mjs';
const tokens = text => text.toLowerCase().replace(/[’‘]/g, "'").match(/[a-z0-9]+(?:'[a-z0-9]+)*/g) ?? [];
const eligible = t => !t.ambiguous && t.speaker !== null && !t.tags.includes('overlap');
const inTurn = (w, t) => w.timingValid && (w.startMs + w.endMs) / 2 >= t.startMs && (w.startMs + w.endMs) / 2 < t.endMs;
const allWords = records => records.flatMap(r => r.words).filter(w => w.kind === 'word');
// Exact maximum-weight one-to-one mapping over <=3 reference speakers and a
// bounded number of provider labels. A single mapping for the ENTIRE run;
// unmatched labels remain unmatched, exposing splits rather than remapping turns.
export function globalSpeakerMapping(words, turns) {
  const refs = [...new Set(turns.filter(eligible).map(t => t.speaker))].sort();
  if (refs.length > 3) throw new Error('REFERENCE_SPEAKER_BOUND');
  const labels = [...new Set(words.filter(w => knownSpeaker(w.providerSpeaker)).map(w => w.providerSpeaker))];
  if (labels.length > 32) throw new Error('PROVIDER_SPEAKER_BOUND');
  const matrix = Object.fromEntries(refs.map(r => [r, Object.fromEntries(labels.map(p => [String(p), 0]))]));
  for (const t of turns.filter(eligible)) for (const w of words.filter(w => inTurn(w, t) && knownSpeaker(w.providerSpeaker))) matrix[t.speaker][String(w.providerSpeaker)]++;
  let states = new Map([[0, { weight: 0, mapping: {} }]]);
  for (const label of labels) {
    const next = new Map(states);
    for (const [mask, state] of states) refs.forEach((ref, index) => {
      const weight = matrix[ref][String(label)];
      if (mask & (1 << index) || !weight) return;
      const nextMask = mask | (1 << index), candidate = { weight: state.weight + weight, mapping: { ...state.mapping, [String(label)]: ref } };
      if (!next.has(nextMask) || next.get(nextMask).weight < candidate.weight) next.set(nextMask, candidate);
    });
    states = next;
  }
  const best = [...states.values()].sort((a,b) => b.weight - a.weight)[0];
  return { mapping: best.mapping, contingency: matrix,
    possibleMerges: labels.filter(p => refs.filter(r => matrix[r][String(p)] > 0).length > 1),
    possibleSplits: refs.filter(r => labels.filter(p => matrix[r][String(p)] > 0).length > 1) };
}
function editDistance(reference, hypothesis) {
  let row = Array.from({ length: hypothesis.length + 1 }, (_, i) => i);
  for (let i = 1; i <= reference.length; i++) {
    const next = [i];
    for (let j = 1; j <= hypothesis.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1));
    row = next;
  }
  return row[hypothesis.length];
}
export function scoreRun(run, reference) {
  if (!reference.manuallyReviewed) throw new Error('REFERENCE_NOT_REVIEWED');
  const words = allWords(run.finalRecords), mapping = globalSpeakerMapping(words, reference.turns);
  const byTurn = records => reference.turns.map(t => {
    const selected = allWords(records).filter(w => inTurn(w, t));
    const expected = tokens(t.text), actual = tokens(selected.map(w => w.text).join(' '));
    const available = new Map(); actual.forEach(w => available.set(w, (available.get(w) ?? 0) + 1));
    const missingReferenceTokens = expected.filter(w => { const count = available.get(w) ?? 0; available.set(w, count - 1); return count <= 0; });
    return { referenceTurn: t.id, referenceSpeaker: t.speaker, referenceText: t.text, tags: t.tags,
      providerWords: selected, excludedFromAttributionScore: !eligible(t), missingReferenceTokens,
      attributedWordCount: selected.filter(w => knownSpeaker(w.providerSpeaker)).length,
      mappedSpeakerMismatchWords: eligible(t) ? selected.filter(w => knownSpeaker(w.providerSpeaker) && mapping.mapping[String(w.providerSpeaker)] !== t.speaker).length : null,
      // Approximate turn timing supports examples, not a defensible DER/WER.
      wordErrorRate: reference.verbatimTextReviewed === true && reference.timingAccuracy === 'precise-turn-boundaries' && eligible(t) && expected.length ? editDistance(expected, actual) / expected.length : null,
    };
  });
  return { qualityStatus: run.status === 'completed' ? 'needs-listening-review' : 'incomplete-run-not-a-quality-result',
    method: 'One maximum-weight, one-to-one word-count mapping fitted on all clear non-overlap turns; frozen for end-of-stream revisions. No per-turn remapping. Not DER.',
    ...mapping, liveFinals: byTurn(run.finalRecords), afterSpeakerRevisions: byTurn(run.revisedRecords),
    firstProvisionalLabeledMs: run.firstProvisionalLabeledMs, firstFinalLabeledMs: run.firstFinalLabeledMs,
    provisionalLabeledAfterFirstAudioMs: run.provisionalLabeledAfterFirstAudioMs,
    finalLabeledAfterFirstAudioMs: run.finalLabeledAfterFirstAudioMs,
    invalidTimingWords: words.filter(w => !w.timingValid).length, stop: run.stop,
    note: 'Missing-token examples are multiset coverage, not WER. Timing-boundary errors and possible merges/splits need listening review. No score alone selects a winner.' };
}
