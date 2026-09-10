const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { load } = require('./load-typescript.cjs');
const model = load('src/features/recorder/live-speakers/live-speakers.model.ts');
const evidence = load('src/features/recorder/live-speakers/speaker-evidence.ts', { './live-speakers.model': model });
const source = load('src/features/recorder/recorder.transcripts.ts');

test('provider IDs including zero and repeated nonadjacent voices survive grouping, wire validation, display, save/reopen and Memory intake', { timeout: 2000 }, async () => {
  const { normalizeResult, DEEPGRAM_CONFIG } = await import('../server/deepgram/protocol.mjs');
  const ids = [0, 0, 1, 6, null, 0], text = 'One agrees another disagrees unknown returns';
  const raw = { type: 'Results', channel_index: [0, 1], start: 0, duration: 1, is_final: true,
    channel: { alternatives: [{ transcript: text, words: text.split(' ').map((word, i) => ({ word, start: i / 10, end: (i + 1) / 10, ...(ids[i] === null ? {} : { speaker: ids[i] }) })) }] } };
  const normalized = normalizeResult(raw, 'dg-id-check', 1000);
  const wire = JSON.parse(JSON.stringify(normalized)); assert.equal(model.isSpeakerResult(wire), true);
  assert.deepEqual(wire.words.map(w => w.providerSpeaker), ids);
  assert.deepEqual(wire.passages.map(p => p.providerSpeaker), [0, 1, 6, null, 0]);
  const accumulator = new model.LiveSpeakerAccumulator();
  accumulator.start({ connectionId: 'dg-id-check', provider: 'deepgram', sampleRate: 24000, timebase: 'provider-stream', audioOffsetMs: null, configuration: DEEPGRAM_CONFIG });
  accumulator.accept(wire);
  const saved = source.savedLiveSpeakerSource({ provider: 'deepgram', status: 'completed', errorMessage: null, speakerSnapshot: accumulator.snapshot() }, 'synthetic-session');
  const reopened = JSON.parse(JSON.stringify(saved));
  const visible = model.displayedSpeakerPassages(reopened.finalResults[0], reopened.finalResults);
  assert.deepEqual(visible.map(p => p.speakerId), ['dg-id-check:speaker0', 'dg-id-check:speaker1', 'dg-id-check:speaker6', null, 'dg-id-check:speaker0']);
  assert.deepEqual(visible.map(p => evidence.speakerLabel(p.providerSpeaker)), ['Speaker 1', 'Speaker 2', 'Speaker 7', 'Unknown speaker', 'Speaker 1']);
  assert.deepEqual(evidence.speakerEvidence(wire, reopened.finalResults), { providerIds: [null, 0, 1, 6], groupedIds: [null, 0, 1, 6], displayedIds: [null, 0, 1, 6], labelsWithheld: false });
  const intake = load('src/features/memory/memory.recording.ts', { '../recorder/recorder.transcripts': source, './memory.intake': load('src/features/memory/memory.intake.ts') });
  const recording = { id: 'synthetic-recording', title: 'Synthetic', createdAt: '2026-09-10T00:00:00Z', liveSpeakerTranscripts: [reopened] };
  const data = intake.intakeFromLiveSpeakers(recording, reopened, { title: 'Synthetic', date: '2026-09-10', participantsText: 'Mike, Andy', originalTranscript: '' });
  assert.equal(data.originalTranscript, text);
  assert.deepEqual(data.segments.map(s => s.speakerId), visible.map(p => p.speakerId));
  assert.deepEqual(data.speakers.map(s => s.nameConfirmation), [null, null, null]);
  assert.deepEqual(reopened.finalResults[0], wire);
});

test('retained real synthetic finals already merge known generated voices at provider; Atlas preserves each word ID', { timeout: 2000 }, async () => {
  const { normalizeResult } = await import('../server/deepgram/protocol.mjs');
  const row = JSON.parse(readFileSync(new URL('./fixtures/deepgram-quiet/evaluation-after-timing-fix.json', `file://${__filename}`))).rows[0];
  const events = row.providerEvents.filter(e => e.type === 'Results' && e.is_final);
  for (const raw of events) {
    const value = normalizeResult(raw, 'dg-real-replay', 19257);
    assert.deepEqual(value.words.map(w => w.providerSpeaker), raw.channel.alternatives[0].words.map(w => w.speaker ?? null));
    const summary = evidence.speakerEvidence(value, [value]);
    assert.deepEqual(summary.groupedIds, summary.providerIds);
    assert.deepEqual(summary.displayedIds, summary.providerIds);
  }
  // Time windows come from the fixture generator; this is not identity inference
  // from spoken text or meeting attendees. Two different synthesized voices.
  const first = events.find(e => e.start === 0);
  const quietThird = events.find(e => e.start === 6.2);
  assert.deepEqual([...new Set(first.channel.alternatives[0].words.map(w => w.speaker))], [0]);
  assert.deepEqual([...new Set(quietThird.channel.alternatives[0].words.map(w => w.speaker))], [0]);
});

test('ID diagnostics withhold unsafe labels, remain bounded, and do not mistake a passage for overlapping itself', () => {
  const base = { id: 'dg-test:r0', connectionId: 'dg-test', isFinal: true, text: 'Complete original', startMs: 0, endMs: 100,
    words: [{ text: 'Complete', providerSpeaker: 3, startMs: 0, endMs: 100 }], passages: [{ id: 'dg-test:r0:p0', providerSpeaker: 3, startMs: 0, endMs: 100 }] };
  const summary = evidence.speakerEvidence(base, [base]);
  assert.deepEqual(summary.providerIds, [3]); assert.deepEqual(summary.displayedIds, [null]); assert.equal(summary.labelsWithheld, true);
  const interim = { ...base, isFinal: false, timingWarning: true, words: [], unvalidatedWords: base.words, passages: [{ ...base.passages[0], providerSpeaker: null }] };
  assert.deepEqual(evidence.speakerEvidence(interim, []).providerIds, [3]);
  assert.equal(evidence.formatSpeakerIds(Array.from({ length: 1001 }, (_, i) => i)).length < 80, true);
  const p = { id: 'visible0', startMs: 0, endMs: 100 };
  assert.equal(evidence.hasSpeakerTimingOverlap(p, [p]), false);
  assert.equal(evidence.hasSpeakerTimingOverlap(p, [p, { id: 'visible1', startMs: 100, endMs: 200 }]), false);
  assert.equal(evidence.hasSpeakerTimingOverlap(p, [p, { id: 'visible1', startMs: 90, endMs: 200 }]), true);
});

test('rendered panel keeps numeric labels distinct even when palette colors repeat and diagnostics are visible', () => {
  const node = (type, props) => ({ type, props });
  const { LiveSpeakerPanel } = load('src/features/recorder/live-speakers/LiveSpeakerPanel.tsx', {
    './live-speakers.model': model, './speaker-evidence': evidence,
    react: { useState: () => [true, () => {}] },
    'react/jsx-runtime': { jsx: node, jsxs: node, Fragment: 'Fragment' },
    'react-native': { Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View' },
    '../../memory/memory.ui': { Panel: 'Panel', s: {} }, '../../memory/SpeakerPassages': { audioTime: String },
  });
  const words = [0, 6, 1, 0].map((id, i) => ({ text: ['One', 'two', 'three', 'four'][i], rawWord: 'synthetic', providerSpeaker: id, startMs: i * 100, endMs: (i + 1) * 100 }));
  const result = { id: 'dg-ui:r0', connectionId: 'dg-ui', text: 'One two three four', isFinal: true, startMs: 0, endMs: 400, words,
    passages: words.map((w, i) => ({ ...w, id: `dg-ui:r0:p${i}`, speakerId: `dg-ui:speaker${w.providerSpeaker}` })) };
  const snapshot = { sessions: [{ connectionId: 'dg-ui' }], finalResults: [result], provisionalResults: [], text: result.text };
  const before = JSON.stringify(snapshot);
  const tree = LiveSpeakerPanel({ snapshot, status: 'completed', saved: true });
  const strings = [];
  function visit(value) {
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value?.props) visit(value.props.children);
  }
  visit(tree);
  assert.deepEqual(strings.filter(s => /^Speaker \d+$/.test(s)), ['Speaker 1', 'Speaker 7', 'Speaker 2', 'Speaker 1']);
  assert.ok(strings.includes('0, 1, 6')); assert.ok(strings.includes('Speaker 1, Speaker 2, Speaker 7'));
  assert.equal(strings.some(s => s.includes('Timing overlap')), false);
  assert.equal(JSON.stringify(snapshot), before);
});
