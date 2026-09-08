export interface MeetingIntake {
  title: string; date: string; participants: string[]; originalTranscript: string; sourceKey?: string | null;
  speakers?: TranscriptSpeaker[]; segments?: TranscriptSegment[];
  transcriptSource?: { kind: 'live' | 'saved_audio'; recordingId: string; traceId: string | null; model: string | null; status: 'completed' | 'paused' | 'failed' | 'finishing' };
}
/** Supplied identity evidence, separate from attendance. Never model-generated. */
export interface TranscriptSpeaker {
  id: string; label: string;
  nameConfirmation: { name: string; confirmedAt: string } | null;
}
export interface TranscriptSegment {
  id: string; start: number; end: number; // UTF-16 offsets into unchanged original
  speakerId: string | null;
  attribution: 'transcript_label' | 'diarization' | 'user_confirmed' | null;
  audio: { recordingId: string; startMs: number; endMs: number; timingSource: 'transcription' | 'alignment' | 'user_confirmed' } | null;
}
export interface Passage { id: string; start: number; end: number; text: string }
export type ItemKind = 'discussion' | 'proposal' | 'decision' | 'open_question' | 'action';
export interface TopicItem { kind: ItemKind; text: string; sourceIds: string[]; owner: string | null; deadline: string | null }
export interface Topic { id: string; title: string; summary: { text: string; sourceIds: string[] }; sourceIds: string[]; items: TopicItem[] }
export interface MeetingSummary {
  id: string; title: string; date: string; participants: string[];
  status: 'draft' | 'processing' | 'ready' | 'failed'; stage: string; error: string | null;
  topicCount?: number; passageCount?: number; updatedAt: string; createdAt: string;
}
export interface Meeting extends MeetingSummary, MeetingIntake {
  passages: Passage[]; topics: Topic[];
  cleanedPassages: { passageId: string; text: string; smallTalk: boolean }[];
  models: { organization: string; embedding: string; answer: string } | null;
}
export interface MeetingFilters { meetingIds: string[]; participant: string; dateFrom: string; dateTo: string }
export interface SourceReference { meetingId: string; meetingTitle: string; date: string; participants: string[]; passageId: string; start: number; end: number; text: string; speakers?: TranscriptSpeaker[]; segments?: TranscriptSegment[]; startsAtLineBoundary?: boolean; transcriptSource?: MeetingIntake['transcriptSource'] }
export interface Citation { meetingId: string; passageId: string; quote: string; speaker?: string | null; segmentId?: string | null }
export interface MemoryAnswer {
  id: string; question: string; filters: MeetingFilters;
  status: 'answered' | 'insufficient_evidence' | 'clarification'; clarification: string | null;
  scope?: 'meeting' | 'speaker'; requestedSpeaker?: string | null; limitation?: string | null;
  statements: { text: string; kind: Exclude<ItemKind, 'open_question'> | 'uncertainty'; citations: Citation[] }[];
  sources: SourceReference[]; readyMeetingCount: number; retrievalTruncated: boolean; model: string | null; createdAt: string;
}
export interface IntakeDraft { title: string; date: string; participantsText: string; originalTranscript: string }
