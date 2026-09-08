import type { IntakeDraft, MeetingIntake } from './memory.types';
export const MAX_TRANSCRIPT_CHARS = 60_000;
export const MAX_IMPORT_BYTES = 240_000;
export const emptyDraft = (): IntakeDraft => ({ title: '', date: '', participantsText: '', originalTranscript: '' });
export const validMeetingDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
export function intakeFromDraft(draft: IntakeDraft): MeetingIntake {
  if (!draft.originalTranscript.trim() || draft.originalTranscript.length > MAX_TRANSCRIPT_CHARS || draft.originalTranscript.includes('\0')) throw new Error('Add a transcript of 1–60,000 characters without null bytes.');
  if (!draft.title.trim() || draft.title.length > 160) throw new Error('Enter a title of at most 160 characters.');
  if (!validMeetingDate(draft.date)) throw new Error('Enter the meeting date as YYYY-MM-DD.');
  const participants = [...new Set(draft.participantsText.split(',').map(p => p.trim()).filter(Boolean))];
  if (participants.length > 40 || participants.some(p => p.length > 100)) throw new Error('Use up to 40 participant names, each at most 100 characters.');
  return { title: draft.title.trim(), date: draft.date, participants, originalTranscript: draft.originalTranscript };
}
// Strict UTF-8 decoding without relying on platform-specific TextDecoder behavior.
// Preserve the BOM, line endings, labels and whitespace in the original string.
export function decodeTranscript(bytes: Uint8Array, filename: string): string {
  if (!/\.txt$/i.test(filename)) throw new Error('Choose a UTF-8 .txt file.');
  if (bytes.length > MAX_IMPORT_BYTES) throw new Error('This file is too large. Use a transcript of at most 60,000 characters.');
  const output: string[] = [];
  const invalid = () => { throw new Error('This file is not valid UTF-8 text. Export it as UTF-8 .txt and try again.'); };
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++]!;
    let code: number, count: number, minimum: number;
    if (first < 0x80) { code = first; count = 0; minimum = 0; }
    else if (first >= 0xc2 && first <= 0xdf) { code = first & 0x1f; count = 1; minimum = 0x80; }
    else if (first >= 0xe0 && first <= 0xef) { code = first & 0x0f; count = 2; minimum = 0x800; }
    else if (first >= 0xf0 && first <= 0xf4) { code = first & 7; count = 3; minimum = 0x10000; }
    else return invalid();
    for (let j = 0; j < count; j++) {
      const next = bytes[i++];
      if (next === undefined || next < 0x80 || next > 0xbf) return invalid();
      code = (code << 6) | (next & 0x3f);
    }
    if (code < minimum || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code === 0) return invalid();
    output.push(String.fromCodePoint(code));
  }
  const text = output.join('');
  if (!text.trim()) throw new Error('The transcript file is empty.');
  if (text.length > MAX_TRANSCRIPT_CHARS) throw new Error('Use a transcript of at most 60,000 characters.');
  return text;
}
