import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { MeetingStore } from './memory/store.mjs';
import { DiarizationService } from './diarization/service.mjs';
import { createDiarizationRouter } from './diarization/router.mjs';
import { createTranscriptionRouter } from './transcription-router.mjs';
import { AUDIO_UPLOAD_LIMITS, cleanupAudioUpload } from './audio-upload.mjs';
import { validateM4aContainer } from './audio-container.mjs';

// Locally encoded silence, never user audio. Providers below are counting doubles.
const audio = await readFile(new URL('../tests/fixtures/upload-synthetic-silence.m4a', import.meta.url));
const text = '\n  SYNTHETIC first voice.\n  SYNTHETIC second voice.  \n';
const deadline = { timeout: 8000 };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (await predicate()) return; await delay(10); }
  assert.fail('Condition did not finish within the bounded one-second wait');
}
const rawDiarization = () => ({ task: 'transcribe', duration: 10, text, segments: [
  { id: 'a', type: 'transcript.text.segment', speaker: 'A', start: 0, end: 5, text: 'SYNTHETIC first voice.' },
  { id: 'b', type: 'transcript.text.segment', speaker: 'B', start: 5, end: 10, text: 'SYNTHETIC second voice.' },
] });
async function harness(t, { fileSizeLimit = 16_384, transcribeFailure = false, diarize = async () => ({ data: rawDiarization() }) } = {}) {
  t.mock.method(console, 'info', () => {}); t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {});
  const directory = await mkdtemp(join(tmpdir(), 'atlas-upload-test-'));
  await writeFile(join(directory, 'unrelated-original.m4a'), 'unrelated sentinel');
  const store = new MeetingStore(':memory:'), calls = { transcription: 0, diarization: 0 };
  const sdk = { audio: { transcriptions: { create: args => {
    calls.transcription++; assert.equal(args.model, 'gpt-transcribe');
    return { withResponse: async () => {
      if (transcribeFailure) throw new Error('SYNTHETIC upstream failure /private/secret-path');
      assert.ok(args.file.size >= audio.length);
      return { data: { text }, request_id: 'synthetic-request', response: { status: 200 } };
    } };
  } } } };
  const service = new DiarizationService(store.db, async (file, signal) => {
    calls.diarization++; assert.ok((await readFile(file.path)).length >= audio.length);
    return diarize(file, signal);
  });
  const app = express(), uploadOptions = { temporaryRoot: directory, fileSizeLimit };
  app.use('/transcribe', createTranscriptionRouter(sdk, { uploadOptions }));
  app.use('/v1/diarizations', createDiarizationRouter(service, { uploadOptions }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const owned = async () => (await readdir(directory)).filter(name => name.startsWith('atlas-audio-'));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await Promise.allSettled(service.jobs.values()); store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const clean = async () => {
    await until(async () => (await owned()).length === 0);
    assert.equal(await readFile(join(directory, 'unrelated-original.m4a'), 'utf8'), 'unrelated sentinel');
  };
  const send = (kind, form, headers = {}) => fetch(base + (kind === 'transcription' ? '/transcribe' : '/v1/diarizations'), {
    method: 'POST', body: form, headers, signal: AbortSignal.timeout(3000),
  });
  return { directory, base, store, service, calls, owned, clean, send };
}
function form(kind, { bytes = audio, filename = 'synthetic.m4a', mime = 'audio/mp4', fields, fileField = 'file', extraFile = false } = {}) {
  const body = new FormData();
  body.append(fileField, new Blob([bytes], { type: mime }), filename);
  if (extraFile) body.append('file', new Blob([bytes], { type: mime }), filename);
  for (const [key, value] of fields ?? (kind === 'diarization' ? [['recordingId', 'synthetic-room'], ['durationMillis', '10000']] : [])) body.append(key, value);
  return body;
}
const headers = (bytes = audio) => ({ 'X-Atlas-Audio-Bytes': String(bytes.length) });
async function rejected(h, kind, body, header = headers(), expectedStatus) {
  const before = { ...h.calls }, response = await h.send(kind, body, header);
  assert.ok(response.status >= 400 && response.status < 500, `Expected clean rejection, got ${response.status}`);
  if (expectedStatus) assert.equal(response.status, expectedStatus);
  const message = await response.text();
  assert.ok(!message.includes(h.directory) && !message.includes('secret-path') && !message.includes('<html'));
  assert.ok(JSON.parse(message).message || JSON.parse(message).error?.message);
  assert.deepEqual(h.calls, before, 'Rejected upload must not call either provider');
  await h.clean();
}

test('production route bounds and resolved parser release remain explicit', deadline, async () => {
  const installed = JSON.parse(await readFile(new URL('./node_modules/multer/package.json', import.meta.url)));
  assert.equal(installed.version, '2.3.0');
  assert.deepEqual(AUDIO_UPLOAD_LIMITS.transcription, { files: 1, fileSize: 26_214_400, fields: 0, fieldSize: 0, parts: 2, fieldNameSize: 32, fieldNestingDepth: 0, fieldArrayIndexLimit: 0 });
  assert.deepEqual(AUDIO_UPLOAD_LIMITS.diarization, { files: 1, fileSize: 25_000_000, fields: 2, fieldSize: 256, parts: 4, fieldNameSize: 32, fieldNestingDepth: 0, fieldArrayIndexLimit: 0 });
});

test('valid AAC uploads preserve saved-transcription text and separate diarized results; legacy byte-header compatibility remains', deadline, async t => {
  const h = await harness(t);
  for (const mime of ['audio/mp4', 'audio/m4a', 'audio/x-m4a', 'application/octet-stream']) {
    const response = await h.send('transcription', form('transcription', { mime }), mime === 'audio/mp4' ? {} : headers());
    assert.equal(response.status, 200); assert.equal(await response.text(), text); await h.clean();
  }
  const response = await h.send('diarization', form('diarization'), headers());
  assert.equal(response.status, 202); const job = await response.json();
  await h.service.jobs.get(job.id); assert.equal(h.service.get(job.id).status, 'ready');
  assert.equal(h.service.get(job.id).result.segments.length, 2); await h.clean();
  const duplicate = await h.send('diarization', form('diarization'), headers());
  assert.equal(duplicate.status, 200); assert.equal((await duplicate.json()).id, job.id);
  assert.deepEqual(h.calls, { transcription: 4, diarization: 1 }); await h.clean();
});

test('exact byte-size cap succeeds; oversized files, extra files, fields and total parts fail before either provider', deadline, async t => {
  const h = await harness(t), cap = 16_384;
  const padding = Buffer.alloc(cap - audio.length); padding.writeUInt32BE(padding.length); padding.write('free', 4);
  const exact = Buffer.concat([audio, padding]);
  for (const kind of ['transcription', 'diarization']) {
    const valid = await h.send(kind, form(kind, { bytes: exact }), headers(exact)); assert.ok(valid.status < 300);
    if (kind === 'diarization') await h.service.jobs.get((await valid.json()).id); else await valid.text();
    await h.clean();
    const oversized = Buffer.concat([exact, Buffer.from([0])]);
    await rejected(h, kind, form(kind, { bytes: oversized }), headers(oversized), 413);
    await rejected(h, kind, form(kind, { extraFile: true }));
    await rejected(h, kind, form(kind, { fileField: 'unexpected' }));
    const fields = kind === 'diarization' ? [['recordingId', 'synthetic-room'], ['durationMillis', '10000'], ['extra', 'x']] : [['extra', 'x']];
    await rejected(h, kind, form(kind, { fields }));
    await rejected(h, kind, form(kind, { extraFile: true, fields: [...fields, ['extra2', 'x']] }));
  }
});

test('flat allowlists, duplicate fields, small bracket indexes, oversized fields and malformed metadata are rejected', deadline, async t => {
  const h = await harness(t);
  const cases = [
    [['recordingId', 'x']], [['unknown', 'x'], ['durationMillis', '10000']],
    [['recordingId', 'x'], ['recordingId', 'y']],
    [['recordingId[1]', 'x'], ['durationMillis', '10000']],
    [['recordingId[]', 'x'], ['durationMillis', '10000']],
    [['recordingId[name]', 'x'], ['durationMillis', '10000']],
    [['x'.repeat(33), 'x'], ['durationMillis', '10000']],
    [['recordingId', 'x'.repeat(257)], ['durationMillis', '10000']],
    [['recordingId', '../private/audio'], ['durationMillis', '10000']],
    ...['', ' ', 'NaN', 'Infinity', '-1', '0', '1e4', '0x2710', '10,000', '10000junk', '30000', '1200001'].map(value => [['recordingId', 'x'], ['durationMillis', value]]),
  ];
  for (const fields of cases) await rejected(h, 'diarization', form('diarization', { fields }));
  for (const kind of ['transcription', 'diarization']) {
    for (const value of ['NaN', '-1', '1.2', '999', '9007199254740993']) await rejected(h, kind, form(kind), { 'X-Atlas-Audio-Bytes': value });
  }
  await rejected(h, 'diarization', form('diarization'), {});
});

test('container checks reject renamed WAV/MP3, video tracks, non-AAC codecs, missing atoms, truncated bounds and false durations', deadline, async t => {
  const h = await harness(t);
  const video = Buffer.from(audio); const handler = video.indexOf(Buffer.from('soun')); assert.ok(handler > 0); video.write('vide', handler);
  const codec = Buffer.from(audio); const sample = codec.indexOf(Buffer.from('mp4a')); assert.ok(sample > 0); codec.write('enca', sample);
  const wrongBrand = Buffer.from(audio); wrongBrand.write('nope', 8); for (let i = 16; i < wrongBrand.readUInt32BE(0); i += 4) wrongBrand.write('nope', i);
  for (const kind of ['transcription', 'diarization']) {
    for (const bytes of [Buffer.alloc(0), Buffer.from('RIFF0000WAVEfmt '), Buffer.from('ID3not-an-m4a'), audio.subarray(0, 24), audio.subarray(0, audio.length - 1), video, codec, wrongBrand]) {
      await rejected(h, kind, form(kind, { bytes }), headers(bytes), kind === 'diarization' && !bytes.length ? 413 : 415);
    }
    await rejected(h, kind, form(kind, { filename: 'synthetic.wav' }), headers(), 415);
    await rejected(h, kind, form(kind, { mime: 'audio/wav' }), headers(), 415);
  }
  // Small finite malformed extended box: no large allocation or adversarial index.
  const malformed = Buffer.from(audio); malformed.writeUInt32BE(1); malformed.writeBigUInt64BE(999999n, 8);
  await rejected(h, 'transcription', form('transcription', { bytes: malformed }), headers(malformed), 415);
});

test('malformed multipart, missing file and truncated bodies clean their private directories', deadline, async t => {
  const h = await harness(t);
  for (const kind of ['transcription', 'diarization']) {
    await rejected(h, kind, new FormData());
    await rejected(h, kind, '{"file":"/private/original.m4a"}', { 'Content-Type': 'application/json' });
    await rejected(h, kind, 'incomplete', { 'Content-Type': 'multipart/form-data' });
    const truncated = Buffer.concat([Buffer.from('--finite\r\nContent-Disposition: form-data; name="file"; filename="synthetic.m4a"\r\nContent-Type: audio/mp4\r\n\r\n'), audio]);
    await rejected(h, kind, truncated, { ...headers(), 'Content-Type': 'multipart/form-data; boundary=finite' });
  }
});

test('disconnect during each multipart upload removes partial files and makes zero provider calls', deadline, async t => {
  const h = await harness(t);
  for (const path of ['/transcribe', '/v1/diarizations']) {
    const req = httpRequest(h.base + path, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=finite' } });
    req.on('error', () => {}); req.setTimeout(2000, () => req.destroy());
    req.write('--finite\r\nContent-Disposition: form-data; name="file"; filename="synthetic.m4a"\r\nContent-Type: audio/mp4\r\n\r\n'); req.write(audio.subarray(0, 100));
    try {
      await until(async () => {
        const dirs = await h.owned();
        return dirs.length > 0 && (await readdir(join(h.directory, dirs[0]))).length > 0;
      });
    } finally { req.destroy(); }
    await h.clean(); assert.deepEqual(h.calls, { transcription: 0, diarization: 0 });
  }
});

test('accepted background identification owns its upload past HTTP response; failures and retries clean it', deadline, async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fallback = setTimeout(() => release(), 2000);
  const h = await harness(t, { diarize: async file => { await gate; assert.ok((await readFile(file.path)).length); throw new Error('Synthetic provider failure'); } });
  try {
    const response = await h.send('diarization', form('diarization'), headers()); const job = await response.json();
    assert.equal(response.status, 202); assert.equal((await h.owned()).length, 1);
    release(); await h.service.jobs.get(job.id); assert.equal(h.service.get(job.id).status, 'failed'); await h.clean();
    const retry = await h.send('diarization', form('diarization'), headers()); assert.equal((await retry.json()).id, job.id);
    await h.service.jobs.get(job.id); assert.equal(h.calls.diarization, 2); await h.clean();
    await cleanupAudioUpload({ path: join(h.directory, 'unrelated-original.m4a') }); await h.clean();
  } finally { clearTimeout(fallback); release(); }
});

test('handled saved-transcription provider failure removes only the request upload', deadline, async t => {
  const h = await harness(t, { transcribeFailure: true });
  const response = await h.send('transcription', form('transcription'), headers());
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes('secret-path'));
  assert.equal(h.calls.transcription, 1); await h.clean();
});

test('real encoded synthetic fixture validates without reading audio into diagnostics', deadline, async () => {
  const result = await validateM4aContainer(new URL('../tests/fixtures/upload-synthetic-silence.m4a', import.meta.url), audio.length);
  assert.equal(result.codec, 'aac'); assert.ok(Math.abs(result.durationMillis - 10000) < 100);
});
