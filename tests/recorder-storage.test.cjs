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
    './recording-transcription.errors': {},
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
