import { MemoryError, digest } from '../memory/transcript.mjs';
export const DIARIZATION_MODEL = 'gpt-4o-transcribe-diarize';
export const MAX_AUDIO_BYTES = 25_000_000; // Conservative decimal 25 MB boundary.
export const MAX_AUDIO_MS = 20 * 60_000; // Atlas milestone cap, not a claimed provider maximum.
export function validateAudioInput({ recordingId, durationMillis, byteSize }) {
  if (typeof recordingId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(recordingId)) throw new MemoryError('Invalid recording identity.');
  if (!Number.isFinite(durationMillis) || durationMillis <= 0 || durationMillis > MAX_AUDIO_MS) throw new MemoryError('Identify speakers supports saved recordings up to 20 minutes in this milestone. The original is preserved; Atlas will not split and guess matching voices across files.', 413);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0 || byteSize > MAX_AUDIO_BYTES) throw new MemoryError('Identify speakers accepts M4A recordings up to 25 MB. The original remains unchanged; no automatic splitting is performed.', 413);
}
export const resultId = (recordingId, audioSha256) => digest(JSON.stringify([recordingId, audioSha256, DIARIZATION_MODEL]));
export function validateDiarizedResult(raw, input) {
  const invalid = () => { throw new MemoryError('The provider returned invalid speaker segments or audio timing. Existing transcripts are safe. Retry identification.', 502, 'DIARIZATION_INVALID_RESULT'); };
  if (!raw || raw.task !== 'transcribe' || !Number.isFinite(raw.duration) || raw.duration <= 0
    || Math.abs(raw.duration * 1000 - input.durationMillis) > 1000
    || raw.duration * 1000 > MAX_AUDIO_MS || typeof raw.text !== 'string'
    || !Array.isArray(raw.segments) || !raw.segments.length || raw.segments.length > 2000) invalid();
  const ids = new Set(), voices = new Map(), speakers = [];
  let originalTranscript = '';
  const segments = raw.segments.map((segment, index) => {
    if (!segment || typeof segment.id !== 'string' || !segment.id || ids.has(segment.id)
      || segment.type !== 'transcript.text.segment' || typeof segment.text !== 'string' || !segment.text.trim() || segment.text.includes('\0')
      || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start
      || segment.end > raw.duration + 0.00001 || segment.end * 1000 > input.durationMillis + 1000
      || (segment.speaker !== null && typeof segment.speaker !== 'string')
      || (typeof segment.speaker === 'string' && segment.speaker.length > 100)
      || (segment.overlap !== undefined && typeof segment.overlap !== 'boolean')) invalid();
    if (index > 0 && segment.start < raw.segments[index - 1].start) invalid();
    ids.add(segment.id);
    const providerSpeaker = segment.speaker;
    const unknown = !providerSpeaker?.trim() || /^(unknown|unidentified|\?)$/i.test(providerSpeaker);
    const ambiguous = /overlap|multiple|[+&/]/i.test(providerSpeaker ?? '');
    let speakerId = null;
    if (!unknown && !ambiguous) {
      if (!voices.has(providerSpeaker)) {
        const number = voices.size + 1;
        if (number > 100) invalid();
        const speaker = { id: `${input.id}:s${number}`, label: `Speaker ${number}`, providerLabel: providerSpeaker, nameConfirmation: null };
        voices.set(providerSpeaker, speaker.id); speakers.push(speaker);
      }
      speakerId = voices.get(providerSpeaker);
    }
    if (index) originalTranscript += '\n';
    const start = originalTranscript.length;
    originalTranscript += segment.text; // Verbatim segment text; no text-to-live alignment.
    return { id: `${input.id}:seg${index + 1}`, providerSegmentId: segment.id, providerSpeaker,
      providerOverlap: segment.overlap ?? null, text: segment.text, start, end: originalTranscript.length,
      speakerId, attribution: speakerId ? 'diarization' : null,
      attributionStatus: ambiguous ? 'overlap' : unknown ? 'unknown' : 'speaker',
      audio: { recordingId: input.recordingId, startMs: segment.start * 1000, endMs: segment.end * 1000, timingSource: 'transcription' } };
  });
  // The provider's combined text is retained separately; passages address its exact segment strings.
  return { id: input.id, recordingId: input.recordingId, provider: 'openai', model: DIARIZATION_MODEL,
    providerRequestId: input.providerRequestId ?? null, audioSha256: input.audioSha256,
    audioByteSize: input.byteSize, durationMillis: raw.duration * 1000, savedAudioDurationMillis: input.durationMillis,
    originalTranscript, providerText: raw.text, speakers, segments, createdAt: new Date().toISOString() };
}
