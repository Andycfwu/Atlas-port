import test from 'node:test';
import assert from 'node:assert/strict';
import { originalTranscriptionText, uploadSizeMatches } from './transcription-integrity.mjs';
import { MeetingStore } from './memory/store.mjs';

test('upload byte counts reject incomplete or invalid sizes while retaining old-client compatibility', () => {
  assert.equal(uploadSizeMatches('240000', 240000), true);
  assert.equal(uploadSizeMatches('240000', 15000), false);
  for (const value of ['NaN', '-1', '1.2', '1e5', ['240000'], '9007199254740993']) assert.equal(uploadSizeMatches(value, 240000), false);
  assert.equal(uploadSizeMatches(undefined, 240000), true);
});

test('post-transcription response text retains whitespace, all voices and full length', () => {
  const text = '\n  First voice.\r\nQuieter voice. ' + 'Third person said maybe. '.repeat(10000) + '\n';
  assert.equal(originalTranscriptionText(text), text);
  assert.equal(originalTranscriptionText({ text }), text);
  assert.equal(originalTranscriptionText({ segments: [{ text: 'Unexpected shape' }] }), '', 'unsupported response must fail visibly, not invent a merged text');
});

test('recording import retries preserve source identity and independent versions even with identical wording', () => {
  const store = new MeetingStore(':memory:');
  try {
    const data = { title: 'Three voices', date: '2026-09-08', participants: ['Mike'], originalTranscript: '  One. Two. Three.\n', sourceKey: 'recording:a:live:1', transcriptSource: { kind: 'live', recordingId: 'a', traceId: '1', model: 'gpt-live-transcribe', status: 'completed' } };
    const first = store.create(data).meeting;
    assert.equal(store.create(data).meeting.id, first.id);
    assert.deepEqual(store.get(first.id).transcriptSource, data.transcriptSource);
    assert.equal(store.get(first.id).passages.map(p => p.text).join(''), data.originalTranscript);
    const post = store.create({ ...data, sourceKey: 'recording:a:saved_audio:2', transcriptSource: { ...data.transcriptSource, kind: 'saved_audio', traceId: '2', model: 'gpt-transcribe' } }).meeting;
    assert.notEqual(post.id, first.id);
    assert.throws(() => store.create({ ...data, originalTranscript: 'Only one.' }), /already imported/);
    assert.equal(store.get(first.id).originalTranscript, data.originalTranscript);
  } finally { store.close(); }
});
