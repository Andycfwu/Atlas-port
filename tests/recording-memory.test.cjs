const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load-typescript.cjs');
const transcripts = load('src/features/recorder/recorder.transcripts.ts');
const intake = load('src/features/memory/memory.recording.ts', { '../recorder/recorder.transcripts': transcripts, './memory.intake': load('src/features/memory/memory.intake.ts') });
const recording = { id: 'recording-1', title: 'Room discussion', createdAt: '2026-09-08T16:00:00Z', transcript: 'Only one voice.', transcriptionTraceId: 'post-1', liveTranscript: { text: '  Three people.\nWeather. Maybe forty—no, fifty. ', source: 'live', status: 'completed', model: 'gpt-live-transcribe', traceId: 'live-1' } };

test('direct Meeting Memory intake defaults to exact saved live text, separate attendance and stable identity', () => {
  const draft = intake.recordingDraft(recording);
  draft.originalTranscript = 'Must never overwrite the original';
  draft.participantsText = 'Mike, Andy';
  const data = intake.intakeFromRecording(recording, draft);
  assert.equal(data.originalTranscript, recording.liveTranscript.text);
  assert.deepEqual(data.participants, ['Mike', 'Andy']);
  assert.deepEqual(data.speakers, []);
  assert.deepEqual(data.segments, []);
  assert.equal(data.transcriptSource.kind, 'live');
  assert.equal(data.transcriptSource.recordingId, recording.id);
  assert.deepEqual(intake.intakeFromRecording(recording, draft), data);
});

test('absent/blank live text falls back to post source; partial live remains default and explicitly marked', () => {
  for (const liveTranscript of [null, { ...recording.liveTranscript, text: '   ' }]) {
    const historical = { ...recording, liveTranscript };
    const data = intake.intakeFromRecording(historical, intake.recordingDraft(historical));
    assert.equal(data.originalTranscript, historical.transcript);
    assert.equal(data.transcriptSource.kind, 'saved_audio');
    assert.equal(data.transcriptSource.model, null);
  }
  const partial = { ...recording, liveTranscript: { ...recording.liveTranscript, status: 'paused' } };
  assert.equal(intake.intakeFromRecording(partial, intake.recordingDraft(partial)).transcriptSource.status, 'paused');
  assert.throws(() => intake.recordingDraft({ ...recording, liveTranscript: null, transcript: null }), /No saved transcript/);
});

test('diarized selection is explicit, carries confirmed names separately and cannot label live text', () => {
  const version = { id: 'diarized-version', recordingId: recording.id, originalTranscript: 'Original audio-derived segment text' };
  const draft = intake.recordingDraft(recording, version);
  const speakerNames = [{ speakerId: 'scoped-voice-1', name: 'Mike' }];
  const request = intake.intakeFromDiarizedRecording(recording, version, draft, speakerNames);
  assert.equal(request.diarizationId, version.id);
  assert.deepEqual(request.speakerNames, speakerNames);
  assert.equal(request.originalTranscript, version.originalTranscript);
  assert.equal(intake.intakeFromRecording(recording, intake.recordingDraft(recording)).originalTranscript, recording.liveTranscript.text);
  assert.throws(() => intake.intakeFromDiarizedRecording(recording, { ...version, recordingId: 'different' }, draft, speakerNames), /different recording/);
});
