import { displayedSpeakerPassages } from './live-speakers.model';
import type { LiveSpeakerPassage, LiveSpeakerResult } from './live-speakers.model';

export const speakerLabel = (id: number | null) => id === null ? 'Unknown speaker' : `Speaker ${id + 1}`;

// Read only: use evidence already saved with the result. No audio, extra network
// traffic, transcript logging, participant lookup or identity inference.
export function speakerEvidence(result: LiveSpeakerResult, finals: LiveSpeakerResult[]) {
  const unique = (ids: (number | null)[]) => [...new Set(ids)].sort((a, b) => (a ?? -1) - (b ?? -1));
  const words = result.timingWarning ? result.unvalidatedWords ?? [] : result.words;
  const displayed = displayedSpeakerPassages(result, finals);
  return {
    providerIds: unique(words.map(w => w.providerSpeaker)),
    groupedIds: unique(result.passages.map(p => p.providerSpeaker)),
    displayedIds: unique(displayed.map(p => p.providerSpeaker)),
    labelsWithheld: result.timingWarning === true || result.words.map(w => w.text).join(' ').trim() !== result.text.trim(),
  };
}

// Keep optional UI diagnostics bounded even for an unusual number of labels.
export function formatSpeakerIds(ids: (number | null)[], asLabels = false) {
  return ids.slice(0, 12).map(id => asLabels ? speakerLabel(id) : id === null ? 'unknown' : String(id)).join(', ')
    + (ids.length > 12 ? ` (+${ids.length - 12} more)` : ids.length ? '' : 'none');
}

export function hasSpeakerTimingOverlap(passage: LiveSpeakerPassage, displayed: LiveSpeakerPassage[]) {
  return displayed.some(other => other.id !== passage.id && other.startMs < passage.endMs && other.endMs > passage.startMs);
}
