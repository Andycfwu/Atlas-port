// Versioned prototype configuration. No provider selection or keys come from audio/text.
export const DEEPGRAM_CONFIG = Object.freeze({
  configurationVersion: 'atlas-deepgram-live-v1', model: 'nova-3', version: 'latest',
  diarize_model: 'v1', language: 'en-US', encoding: 'linear16', channels: 1,
  interim_results: true, punctuate: true, smart_format: false, filler_words: true,
  endpointing: 300, mip_opt_out: true,
});
export function deepgramAvailability({ enabled = false, apiKey } = {}) {
  return { available: enabled && Boolean(apiKey?.trim()), configurationVersion: DEEPGRAM_CONFIG.configurationVersion,
    message: !enabled ? 'Live speaker labels are unavailable. Enable ATLAS_DEEPGRAM_LIVE_ENABLED=1 on the backend.'
      : !apiKey?.trim() ? 'Live speaker labels are unavailable. Configure DEEPGRAM_API_KEY on the backend.' : 'Experimental: audio goes through the Atlas backend to Deepgram.' };
}
export function deepgramUrl(sampleRate) {
  const url = new URL('wss://api.deepgram.com/v1/listen');
  for (const [key, value] of Object.entries(DEEPGRAM_CONFIG)) if (key !== 'configurationVersion') url.searchParams.set(key, String(value));
  url.searchParams.set('sample_rate', String(sampleRate));
  return url.toString();
}
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const text = value => typeof value === 'string' && value.length <= 32_000;
const invalid = () => { throw new Error('DEEPGRAM_INVALID_RESULT'); };
export function providerMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const rawModel = metadata.model_info;
  const model = rawModel?.name ? rawModel : Object.values(rawModel ?? {}).find(value => value && typeof value === 'object' && value.name);
  const candidates = { requestId: metadata.request_id, modelName: model?.name, modelVersion: model?.version,
    modelUuid: Array.isArray(metadata.models) ? metadata.models[0] : undefined,
    diarizerUuid: metadata.diarize_info?.model_uuid, diarizerVersion: metadata.diarize_info?.arch };
  return Object.fromEntries(Object.entries(candidates).filter(([, value]) => typeof value === 'string' && value.length <= 200));
}
// Timings are provider-stream coordinates, NOT guessed offsets into the M4A.
// Keep the provider's full alternative text as well as word-derived passages.
export function normalizeResult(event, connectionId, audioDurationMs) {
  if (!event || event.type !== 'Results' || typeof event.is_final !== 'boolean'
    || !finite(event.start) || !finite(event.duration)
    || !Array.isArray(event.channel_index) || event.channel_index[0] !== 0 || event.channel_index[1] !== 1
    || !Array.isArray(event.channel?.alternatives) || !event.channel.alternatives.length) invalid();
  const alternative = event.channel.alternatives[0];
  if (!text(alternative?.transcript) || !Array.isArray(alternative.words) || alternative.words.length > 2000) invalid();
  const startMs = Math.round(event.start * 1000), endMs = Math.round((event.start + event.duration) * 1000);
  if (endMs > audioDurationMs + 250 || endMs < startMs) invalid();
  const id = `${connectionId}:r${Math.round(event.start * 1_000_000)}`;
  let previousStart = -1;
  const words = alternative.words.map(word => {
    if (!word || !text(word.word) || !word.word.length || !finite(word.start) || !finite(word.end)
      || word.start < previousStart || word.end < word.start
      || word.start * 1000 < startMs - 100 || word.end * 1000 > endMs + 100
      || word.end * 1000 > audioDurationMs + 250
      || (word.punctuated_word !== undefined && !text(word.punctuated_word))
      || (word.speaker != null && (!Number.isSafeInteger(word.speaker) || word.speaker < 0 || word.speaker > 1000))) invalid();
    previousStart = word.start;
    return { text: word.punctuated_word ?? word.word, rawWord: word.word,
      startMs: Math.round(word.start * 1000), endMs: Math.round(word.end * 1000),
      providerSpeaker: word.speaker ?? null };
  });
  const passages = [];
  for (const word of words) {
    const last = passages.at(-1);
    if (last && last.providerSpeaker === word.providerSpeaker && last.text.length < 1000) {
      last.text += ` ${word.text}`; last.endMs = Math.max(last.endMs, word.endMs);
    } else passages.push({ id: `${id}:p${passages.length}`, text: word.text, startMs: word.startMs, endMs: word.endMs,
      providerSpeaker: word.providerSpeaker, speakerId: word.providerSpeaker === null ? null : `${connectionId}:speaker${word.providerSpeaker}` });
  }
  if (!words.length && alternative.transcript) passages.push({ id: `${id}:p0`, text: alternative.transcript, startMs, endMs, providerSpeaker: null, speakerId: null });
  return { id, connectionId, startMs, endMs, isFinal: event.is_final, text: alternative.transcript,
    speechFinal: event.speech_final === true, fromFinalize: event.from_finalize === true,
    words, passages, providerMetadata: providerMetadata(event.metadata) };
}

// Observed in the bounded synthetic comparison: a provisional word ended at
// 10.42s while its result covered 6.82–8.30s and only 8.40s had been sent.
// Preserve that provisional text and raw evidence, withhold unreliable labels,
// and keep listening for valid finals. Final responses remain strictly checked.
export function normalizeStreamingResult(event, connectionId, audioDurationMs) {
  try { return normalizeResult(event, connectionId, audioDurationMs); }
  catch (error) {
    const alternative = event?.channel?.alternatives?.[0];
    const words = alternative?.words;
    if (event?.is_final !== false || !Array.isArray(words) || words.length > 2000 || !words.length
      || words.some(w => !w || !text(w.word) || !finite(w.start) || !finite(w.end)
        || w.start > 86400 || w.end > 86400 || (w.punctuated_word !== undefined && !text(w.punctuated_word))
        || (w.speaker != null && (!Number.isSafeInteger(w.speaker) || w.speaker < 0 || w.speaker > 1000)))) throw error;
    const fallback = normalizeResult({ ...event, channel: { alternatives: [{ transcript: alternative.transcript, words: [] }] } }, connectionId, audioDurationMs);
    return { ...fallback, timingWarning: true, unvalidatedWords: words.map(w => ({ text: w.punctuated_word ?? w.word, startMs: w.start * 1000, endMs: w.end * 1000, providerSpeaker: w.speaker ?? null })) };
  }
}
