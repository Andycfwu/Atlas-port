const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./load-typescript.cjs');

const fixture = ({ destinationPasses = true } = {}) => {
  const files = new Map([['file:///documents/ExpoAudio/source.m4a', { size: 240000 }]]);
  const sourceUri = [...files.keys()][0];
  class Directory {
    constructor(base, name) { this.uri = `${base}/${name}`; }
    create() {}
  }
  class File {
    constructor(base, name) { this.uri = name ? `${base.uri}/${name}` : base; }
    get exists() { return files.has(this.uri); }
    get name() { return this.uri.split('/').at(-1); }
    get extension() { return '.m4a'; }
    get size() { return files.get(this.uri)?.size ?? 0; }
    async text() { const value = files.get(this.uri)?.text; await Promise.resolve(); return value; }
    info() { return files.get(this.uri); }
    copy(destination) { files.set(destination.uri, { ...files.get(this.uri) }); }
    move() { assert.fail('Sources must not be moved before durable metadata'); }
    delete() { files.delete(this.uri); }
    write(text) { files.set(this.uri, { text }); }
  }
  const validation = { uri: sourceUri, nativeDurationMillis: 15000, playerDurationMillis: 15000, passed: true, isPlayable: true, fileSize: 240000, checks: [], failedChecks: [] };
  const storage = load('src/features/recorder/recorder.storage.ts', {
    'expo-file-system': { Directory, File, Paths: { document: 'file:///documents' } },
    './recorder.service': { createRecordingId: () => 'saved-id', createRecordingTitle: () => 'Recording', sortRecordingsNewestFirst: (list) => list },
    './recorder.transcripts': load('src/features/recorder/recorder.transcripts.ts'),
    './recording-transcription.errors': { createTranscriptionTraceId: () => 'interrupted', getTranscriptionUserMessage: () => 'Interrupted', isTranscriptionErrorCode: () => true, isTranscriptionStage: () => true },
    './recorder.integrity': {
      logRecorderIntegrity() {},
      waitForStableRecordingFile: async () => ({ size: 240000, modificationTime: 1 }),
      validateFinalizedRecording: async (_id, uri) => ({ ...validation, uri, passed: destinationPasses }),
    },
  });
  return { storage, files, sourceUri, validation };
};

test('truncated yet playable audio cannot enter the complete-recording library', async () => {
  const { storage, files, validation } = fixture();
  await assert.rejects(storage.persistVerifiedRecordingFile('rec-test', { ...validation, passed: false, playerDurationMillis: 1461 }, { allowPlayableDiagnostic: true }), /unverified/);
  assert.equal(files.size, 1);
});

test('verified source survives copy and remains until metadata is durable', async () => {
  const { storage, files, sourceUri, validation } = fixture();
  const result = await storage.persistVerifiedRecordingFile('rec-test', validation);
  assert.ok(files.has(sourceUri));
  assert.ok(files.has(result.recording.uri));
  assert.equal(result.recording.durationMillis, 15000);
  storage.removePersistedRecordingSource(sourceUri); // Provider calls only after saveRecordingMetadata resolves.
  assert.equal(files.has(sourceUri), false);
  assert.ok(files.has(result.recording.uri));
});

test('failed destination validation preserves the original audio', async () => {
  const { storage, files, sourceUri, validation } = fixture({ destinationPasses: false });
  await assert.rejects(storage.persistVerifiedRecordingFile('rec-test', validation), /duration/);
  assert.ok(files.has(sourceUri));
});

test('failed recordings get a durable recovery manifest without complete library metadata', () => {
  const { storage, files, sourceUri } = fixture();
  storage.preserveRecordingRecoveryReport({ sessionId: 'rec-test', sourceUri, passed: false, libraryRecordingId: null, nativeDurationBeforeStopMillis: 5905, playerDurationMillis: 1461 });
  const report = JSON.parse(files.get('file:///documents/atlas-recording-recovery/rec-test.json').text);
  assert.equal(report.sourceFilename, 'source.m4a');
  assert.equal(report.passed, false);
  assert.equal(report.libraryRecordingId, null);
  assert.ok(files.has(sourceUri));
});

const liveSource = { source: 'live', text: '  First person. Second person.\nThird person.', segments: [{ itemId: 'final', deltaText: 'Third', finalText: 'Third person.' }], status: 'completed', traceId: 'live-1', recorderSessionId: 'session-1', model: 'gpt-live-transcribe', savedAt: '2026-09-08T18:00:00.000Z', errorMessage: null };
async function savedFixture() {
  const f = fixture();
  const { recording } = await f.storage.persistVerifiedRecordingFile('session-1', f.validation);
  recording.liveTranscript = liveSource;
  f.storage.preserveLiveTranscript('session-1', liveSource);
  await f.storage.saveRecordingMetadata(recording);
  return { ...f, recording };
}

test('live text, final-event segments and raw post versions survive save/reopen independently', async () => {
  const { storage, recording, files } = await savedFixture();
  await storage.updateRecordingTranscription(recording.id, 'transcribing', null, 'post-1');
  await storage.updateRecordingTranscription(recording.id, 'complete', '  Only first person.\r\n', 'post-1');
  const [reopened] = await storage.loadRecordings();
  assert.deepEqual(reopened.liveTranscript, liveSource);
  assert.equal(reopened.transcript, '  Only first person.\r\n');
  assert.equal(reopened.postTranscripts[0].text, reopened.transcript);
  assert.deepEqual(JSON.parse(files.get('file:///documents/atlas-recording-recovery/session-1.live.json').text), liveSource);
  assert.ok(files.has(recording.uri), 'audio is kept');
});

test('retry, failure, stale responses and interrupted restart never erase live or previous post text', async () => {
  const { storage, recording } = await savedFixture();
  await storage.updateRecordingTranscription(recording.id, 'transcribing', null, 'post-1');
  await storage.updateRecordingTranscription(recording.id, 'complete', 'Version one', 'post-1');
  await storage.updateRecordingTranscription(recording.id, 'transcribing', null, 'post-2');
  const stale = await storage.updateRecordingTranscription(recording.id, 'complete', 'STALE', 'post-1');
  assert.equal(stale.transcriptionTraceId, 'post-2');
  assert.equal(stale.transcript, 'Version one');
  await storage.updateRecordingTranscription(recording.id, 'failed', null, 'post-2');
  await storage.updateRecordingTranscription(recording.id, 'transcribing', null, 'post-3');
  await storage.updateRecordingTranscription(recording.id, 'complete', 'Version three', 'post-3');
  await storage.updateRecordingTranscription(recording.id, 'transcribing', null, 'interrupted');
  const [reopened] = await storage.loadRecordings();
  assert.equal(reopened.transcriptionStatus, 'failed');
  assert.equal(reopened.transcript, 'Version three');
  assert.deepEqual(reopened.postTranscripts.map(v => v.text), ['Version one', 'Version three']);
  assert.deepEqual(reopened.liveTranscript, liveSource);
});

test('concurrent rename, transcription and new-save mutations cannot replace one another', async () => {
  const { storage, recording, files } = await savedFixture();
  const second = { ...recording, id: 'second', filename: 'second.m4a', uri: 'file:///documents/recordings/second.m4a' };
  files.set(second.uri, { size: 120000 });
  await storage.updateRecordingTranscription(recording.id, 'transcribing', null, 'post-1');
  await Promise.all([
    storage.renameRecording(recording.id, 'Renamed together'),
    storage.updateRecordingTranscription(recording.id, 'complete', 'Post text', 'post-1'),
    storage.saveRecordingMetadata(second),
  ]);
  const reopened = await storage.loadRecordings();
  assert.equal(reopened.length, 2);
  const first = reopened.find(r => r.id === recording.id);
  assert.equal(first.title, 'Renamed together');
  assert.equal(first.transcript, 'Post text');
  assert.deepEqual(first.liveTranscript, liveSource);
});

test('legacy transcript is retained with unknown provenance when retranscribing, without fabricating a live source', async () => {
  const { storage, validation } = fixture();
  const { recording } = await storage.persistVerifiedRecordingFile('legacy', validation);
  recording.transcript = '\nHistorical words.  ';
  recording.transcriptionStatus = 'complete';
  await storage.saveRecordingMetadata(recording);
  const retry = await storage.updateRecordingTranscription(recording.id, 'transcribing', null, 'new-post');
  assert.equal(retry.liveTranscript, undefined);
  assert.equal(retry.postTranscripts[0].text, '\nHistorical words.  ');
  assert.equal(retry.postTranscripts[0].model, null);
  assert.equal(retry.postTranscripts[0].savedAt, null);
});

test('diarization save/reopen and retry cannot overwrite live, post, audio or existing diarized versions', async () => {
  const { storage, recording, files } = await savedFixture();
  await storage.updateRecordingTranscription(recording.id, 'transcribing', null, 'post');
  await storage.updateRecordingTranscription(recording.id, 'complete', 'Previous post text', 'post');
  const result = { id: 'diarized-v1', recordingId: recording.id, originalTranscript: 'Separate diarized text', speakers: [], segments: [] };
  await storage.saveDiarizationJob(recording.id, { id: result.id, recordingId: recording.id, status: 'ready', error: null, result });
  await storage.saveDiarizationJob(recording.id, { id: result.id, recordingId: recording.id, status: 'ready', error: null, result });
  await storage.saveDiarizationJob(recording.id, { id: null, recordingId: recording.id, status: 'uploading', error: null });
  const [reopened] = await storage.loadRecordings();
  assert.equal(reopened.diarization.status, 'failed');
  assert.equal(reopened.diarizedTranscripts.length, 1);
  assert.deepEqual(reopened.diarizedTranscripts[0], result);
  assert.deepEqual(reopened.liveTranscript, liveSource);
  assert.equal(reopened.transcript, 'Previous post text');
  assert.ok(files.has(recording.uri));
  await assert.rejects(storage.saveDiarizationJob(recording.id, { id: result.id, recordingId: 'wrong', status: 'ready', result }), /does not match/);
});
