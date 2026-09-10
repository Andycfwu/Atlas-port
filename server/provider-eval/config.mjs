// Evaluation-only, checked against official docs on 2026-09-10. Never imported
// by the application server. No automatic fallback or provider discovery.
import { deepgramUrl } from '../deepgram/protocol.mjs';
export const LIMITS = Object.freeze({ sampleRate: 24000, frameBytes: 2400, audioMs: 90000,
  readyMs: 10000, finishMs: 15000, sessionMs: 120000, socketBytes: 256 * 1024,
  messageBytes: 256 * 1024, eventBytes: 8 * 1024 * 1024, events: 4096, runsPerProvider: 2,
  samples: 2, budgetUsd: 0.15 });
export const PROVIDERS = Object.freeze({
  deepgram: { key: 'DEEPGRAM_API_KEY', pricePerMinute: 0.0068, reservePerMinute: 0.0097,
    docs: 'https://developers.deepgram.com/reference/speech-to-text/listen-streaming',
    pricing: 'https://deepgram.com/pricing' },
  assemblyai: { key: 'ASSEMBLYAI_API_KEY', pricePerMinute: 0.57 / 60, reservePerMinute: 0.57 / 60,
    docs: 'https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels',
    pricing: 'https://www.assemblyai.com/pricing' },
  speechmatics: { key: 'SPEECHMATICS_API_KEY', pricePerMinute: 0.43 / 60, reservePerMinute: 0.43 / 60,
    docs: 'https://docs.speechmatics.com/api-ref/realtime-transcription-websocket',
    pricing: 'https://www.speechmatics.com/pricing' },
});
export function connectionConfig(provider, key) {
  if (!PROVIDERS[provider]) throw new Error('UNKNOWN_PROVIDER');
  if (!key?.trim()) throw new Error('MISSING_CREDENTIAL');
  if (provider === 'deepgram') return { url: deepgramUrl(LIMITS.sampleRate), headers: { Authorization: `Token ${key}` }, start: null, finish: () => ({ type: 'CloseStream' }) };
  if (provider === 'assemblyai') {
    const url = new URL('wss://streaming.assemblyai.com/v3/ws');
    for (const [name, value] of Object.entries({ speech_model: 'universal-3-5-pro', sample_rate: LIMITS.sampleRate, encoding: 'pcm_s16le', speaker_labels: true, language_codes: '["en"]' })) url.searchParams.set(name, String(value));
    return { url: String(url), headers: { Authorization: key }, start: null, finish: () => ({ type: 'Terminate' }) };
  }
  return { url: 'wss://global.rt.speechmatics.com/v2/', headers: { Authorization: `Bearer ${key}` }, start: {
    message: 'StartRecognition', audio_format: { type: 'raw', encoding: 'pcm_s16le', sample_rate: LIMITS.sampleRate },
    transcription_config: { language: 'en', model: 'enhanced', diarization: 'speaker', enable_partials: true },
  }, finish: frames => ({ message: 'EndOfStream', last_seq_no: frames }) };
}
