const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load-typescript.cjs');
const errors = load('src/features/recorder/recording-transcription.errors.ts', { './recording-transcription.types': load('src/features/recorder/recording-transcription.types.ts') });

test('saved-file upload supplies the whole file and preserves the entire HTTP text response', async () => {
  const bytes = Buffer.from(Array.from({ length: 240000 }, (_, i) => i % 256)); // Synthetic transport bytes, not an audio-quality fixture.
  const text = '  Voice one.\r\nQuiet voice two. ' + 'Voice three, maybe fifty. '.repeat(8000) + '\nlast voice.\n';
  class AudioFile extends Blob { constructor(uri) { super([bytes], { type: 'audio/mp4' }); this.uri = uri; this.exists = true; this.extension = '.m4a'; } }
  let requests = 0;
  const api = load('src/services/api/api.client.ts', { 'expo/fetch': { fetch: async (url, options) => {
    requests += 1;
    assert.equal(url, 'http://backend.test/transcribe');
    assert.equal(options.headers['X-Atlas-Audio-Bytes'], String(bytes.length));
    assert.equal(options.headers['X-Atlas-Trace-Id'], 'test-trace');
    const uploaded = Buffer.from(await options.body.get('file').arrayBuffer());
    assert.deepEqual(uploaded, bytes);
    return new Response(text, { headers: { 'content-type': 'text/plain' } });
  } } });
  const service = load('src/features/recorder/recording-transcription.service.ts', {
    'expo-file-system': { File: AudioFile }, '../../config/app.config': { appConfig: { apiUrl: 'http://backend.test' } },
    '../../services/api': api, './recording-transcription.errors': errors,
  });
  const result = await service.transcribeRecordingFile({ id: 'saved', uri: 'file:///saved.m4a' }, 'test-trace');
  assert.equal(requests, 1);
  assert.equal(result.text, text);
  assert.equal(result.traceId, 'test-trace');
});
