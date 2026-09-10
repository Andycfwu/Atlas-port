// Supplied provenance only. Attendance is deliberately not an input to these functions.
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
const shortText = value => typeof value === 'string' && Boolean(value.trim()) && value.length <= 100;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const sameName = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
const labelPattern = label => new RegExp(`^(?:\\[[^\\]\\r\\n]{1,24}\\]\\s*)?${escape(label)}\\s*:\\s*`, 'i');

export function validateProvenance(input, original) {
  const invalid = () => { throw new Error('Invalid speaker or audio provenance. Supply exact original text offsets, explicit attribution evidence, and real audio times only.'); };
  const speakers = input.speakers ?? [], segments = input.segments ?? [];
  if (!Array.isArray(speakers) || speakers.length > 100 || !Array.isArray(segments) || segments.length > 2000) invalid();
  const ids = new Set();
  const cleanSpeakers = speakers.map(s => {
    if (!s || !identifier(s.id) || ids.has(s.id) || !shortText(s.label)) invalid();
    ids.add(s.id);
    const confirmation = s.nameConfirmation ?? null;
    if (confirmation !== null && (!shortText(confirmation.name) || typeof confirmation.confirmedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(confirmation.confirmedAt) || !Number.isFinite(Date.parse(confirmation.confirmedAt)))) invalid();
    if (s.providerLabel !== undefined && !shortText(s.providerLabel)) invalid();
    return { ...(s.providerLabel !== undefined ? { providerLabel: s.providerLabel } : {}), id: s.id, label: s.label, nameConfirmation: confirmation && { name: confirmation.name, confirmedAt: confirmation.confirmedAt } };
  });
  const segmentIds = new Set();
  const cleanSegments = segments.map(s => {
    if (!s || !identifier(s.id) || segmentIds.has(s.id) || !Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start < 0 || s.end <= s.start || s.end > original.length) invalid();
    // A text boundary may not split a UTF-16 surrogate pair.
    if ((s.start > 0 && /[\uD800-\uDBFF]/.test(original[s.start - 1])) || /[\uD800-\uDBFF]/.test(original[s.end - 1])) invalid();
    segmentIds.add(s.id);
    const speakerId = s.speakerId ?? null, attribution = s.attribution ?? null, audio = s.audio ?? null;
    if (speakerId !== null && !ids.has(speakerId)) invalid();
    if (speakerId === null ? attribution !== null : !['transcript_label', 'diarization', 'stream_diarization', 'user_confirmed'].includes(attribution)) invalid();
    if (audio !== null && (!identifier(audio.recordingId) || !Number.isFinite(audio.startMs) || !Number.isFinite(audio.endMs) || audio.startMs < 0 || audio.endMs <= audio.startMs || !['transcription', 'alignment', 'user_confirmed'].includes(audio.timingSource))) invalid();
    let providerStream;
    if (s.providerStream !== undefined) {
      const stream = s.providerStream;
      if (input.transcriptSource?.kind !== 'live_speakers' || !stream || !/^dg-[a-zA-Z0-9-]{1,80}$/.test(stream.connectionId) || !Number.isFinite(stream.startMs) || !Number.isFinite(stream.endMs) || stream.startMs < 0 || stream.endMs < stream.startMs || (speakerId && !speakerId.startsWith(stream.connectionId + ':speaker'))) invalid();
      providerStream = { connectionId: stream.connectionId, startMs: stream.startMs, endMs: stream.endMs };
    }
    if (attribution === 'stream_diarization' && (!providerStream || audio)) invalid();
    if (attribution === 'diarization' && !audio) invalid();
    if (attribution === 'transcript_label') {
      const speaker = cleanSpeakers.find(p => p.id === speakerId);
      // Supplied line labels establish only that line, never the next unlabeled turn.
      const text = original.slice(s.start, s.end).trim();
      if ((s.start > 0 && !/[\r\n]/.test(original[s.start - 1])) || !labelPattern(speaker.label).test(text) || /[\r\n]/.test(text)) invalid();
    }
    if (s.attributionStatus !== undefined && !['speaker', 'unknown', 'overlap'].includes(s.attributionStatus)) invalid();
    if (s.providerOverlap !== undefined && s.providerOverlap !== null && typeof s.providerOverlap !== 'boolean') invalid();
    if (s.providerSpeaker !== undefined && s.providerSpeaker !== null && (typeof s.providerSpeaker !== 'string' || s.providerSpeaker.length > 100)) invalid();
    return { ...(providerStream ? { providerStream } : {}), ...(s.attributionStatus !== undefined ? { attributionStatus: s.attributionStatus, providerSpeaker: s.providerSpeaker ?? null, providerOverlap: s.providerOverlap ?? null } : {}), id: s.id, start: s.start, end: s.end, speakerId, attribution, audio: audio && { recordingId: audio.recordingId, startMs: audio.startMs, endMs: audio.endMs, timingSource: audio.timingSource } };
  });
  // Different speech segments cannot silently assign the same text to different voices.
  const sorted = [...cleanSegments].sort((a, b) => a.start - b.start);
  if (sorted.some((s, i) => i > 0 && s.start < sorted[i - 1].end)) invalid();
  return { speakers: cleanSpeakers, segments: sorted };
}

export function passageProvenance(meeting, passage) {
  const segments = (meeting.segments ?? []).filter(s => s.start < passage.end && s.end > passage.start);
  const speakers = (meeting.speakers ?? []).filter(s => segments.some(segment => segment.speakerId === s.id));
  return { speakers, segments };
}

// A citation attributed to a voice must fit inside that exact turn/segment.
// A named participant, a mention of a name, and neighboring labels never suffice.
export function supportsSpeaker(source, quote, name, segmentId = null) {
  if (!shortText(name) || typeof quote !== 'string' || !quote.trim()) return false;
  if (segmentId) {
    const segment = source.segments?.find(s => s.id === segmentId);
    const speaker = source.speakers?.find(s => s.id === segment?.speakerId);
    if (!segment || !speaker || ![speaker.label, speaker.nameConfirmation?.name].some(n => sameName(n, name))) return false;
    const excerpt = source.text.slice(Math.max(0, segment.start - source.start), Math.min(source.text.length, segment.end - source.start));
    return excerpt.includes(quote);
  }
  if (['diarized_audio', 'live_speakers'].includes(source.transcriptSource?.kind)) return false;
  return source.text.split(/\r?\n/).some((line, index) => {
    if (index === 0 && source.start > 0 && source.startsAtLineBoundary !== true) return false;
    return labelPattern(name).test(line.trimStart()) && line.includes(quote) && labelPattern(name).test(quote.trimStart());
  });
}

// Conservative coverage for common direct speaker questions. Other wording is
// classified by the model's explicit scope field and evaluated separately.
export function directSpeakerTarget(question = '') {
  return question.match(/\bwhat (?:did|does) (.+?) (?:say|state|suggest|propose|promise|recommend|mean|think)\b/i)?.[1]?.trim()
    ?? question.match(/\bwhat (?:was|is) (.+?)[’']s (?:view|opinion|position|proposal)\b/i)?.[1]?.trim()
    ?? null;
}
