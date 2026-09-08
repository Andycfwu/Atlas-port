const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load-typescript.cjs');
const intake = load('src/features/memory/memory.intake.ts');

test('UTF-8 import preserves BOM, CRLF, Unicode, speaker labels and timestamps', () => {
  const original = '\ufeff[00:12] Mike: café 🙂\r\nMaybe, not agreed.\n';
  assert.equal(intake.decodeTranscript(new Uint8Array(Buffer.from(original)), 'meeting.TXT'), original);
});

test('intake rejects malformed UTF-8, wrong file types, nulls, empty and oversized text', () => {
  for (const bytes of [[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82], [0], []]) {
    assert.throws(() => intake.decodeTranscript(new Uint8Array(bytes), 'transcript.txt'));
  }
  assert.throws(() => intake.decodeTranscript(new Uint8Array([65]), 'transcript.pdf'));
  assert.throws(() => intake.decodeTranscript(new Uint8Array(Buffer.from('a'.repeat(60001))), 'transcript.txt'));
});

test('review validates metadata without editing or attributing the original', () => {
  const draft = { title: ' Meeting ', date: '2026-09-08', participantsText: 'Mike, Jordan, Mike', originalTranscript: '  Unlabeled statement.\r\n' };
  const result = intake.intakeFromDraft(draft);
  assert.equal(result.originalTranscript, draft.originalTranscript);
  assert.deepEqual(result.participants, ['Mike', 'Jordan']);
  assert.throws(() => intake.intakeFromDraft({ ...draft, date: '2026-02-30' }));
  assert.throws(() => intake.intakeFromDraft({ ...draft, title: ' ' }));
});

test('native intake snapshots survive restart and partial writes without touching chat or audio storage', () => {
  const files = new Map(); let failWrite = false;
  class Directory { constructor(...parts) { this.uri = parts.map(p => p.uri ?? p).join('/'); } create() {} }
  class File {
    constructor(...parts) { this.uri = parts.map(p => p.uri ?? p).join('/'); }
    get exists() { return files.has(this.uri); }
    textSync() { return files.get(this.uri); }
    write(text) { files.set(this.uri, failWrite ? text.slice(0, 9) : text); if (failWrite) throw new Error('Disk full'); }
  }
  const { createIntakeDraftRepository } = load('src/features/memory/memory.draft.ts', {
    'expo-file-system': { Directory, File, Paths: { document: 'file:///documents' } }, './memory.intake': intake,
  });
  const repo = createIntakeDraftRepository();
  const draft = { ...intake.emptyDraft(), originalTranscript: '  Original\r\n', title: 'Synthetic draft' };
  assert.throws(() => repo.save(draft)); repo.load(); repo.save(draft);
  failWrite = true; assert.throws(() => repo.save({ ...draft, title: 'Interrupted write' }));
  assert.deepEqual(createIntakeDraftRepository().load(), draft);
  assert.ok([...files.keys()].every(path => path.includes('/atlas-meeting-intake/')));
});
