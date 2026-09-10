export interface MeetingIntake {
  title: string; date: string; participants: string[]; originalTranscript: string; sourceKey?: string | null;
  speakers?: TranscriptSpeaker[]; segments?: TranscriptSegment[];
  diarizationId?: string; speakerNames?: SpeakerNameInput[];
  transcriptSource?: { kind: 'live' | 'saved_audio' | 'diarized_audio' | 'live_speakers'; provider?: string; sourceVersionId?: string; createdAt?: string; configurationVersion?: string; diarizationId?: string; namesKey?: string; recordingId: string; traceId: string | null; model: string | null; status: 'completed' | 'paused' | 'failed' | 'finishing' };
}
/** Supplied identity evidence, separate from attendance. Never model-generated. */
export interface TranscriptSpeaker {
  id: string; label: string; providerLabel?: string;
  nameConfirmation: { name: string; confirmedAt: string } | null;
}
export interface TranscriptSegment {
  id: string; start: number; end: number; // UTF-16 offsets into unchanged original
  speakerId: string | null;
  attributionStatus?: 'speaker' | 'unknown' | 'overlap'; providerSpeaker?: string | null; providerOverlap?: boolean | null;
  attribution: 'transcript_label' | 'diarization' | 'stream_diarization' | 'user_confirmed' | null;
  providerStream?: { connectionId: string; startMs: number; endMs: number };
  audio: { recordingId: string; startMs: number; endMs: number; timingSource: 'transcription' | 'alignment' | 'user_confirmed' } | null;
}
export interface Passage { id: string; start: number; end: number; text: string }
export type ItemKind = 'discussion' | 'proposal' | 'decision' | 'open_question' | 'action';
export interface TopicItem { kind: ItemKind; text: string; sourceIds: string[]; owner: string | null; deadline: string | null }
export interface Topic { id: string; title: string; summary: { text: string; sourceIds: string[] }; sourceIds: string[]; items: TopicItem[] }
export interface MeetingSummary {
  id: string; title: string; date: string; participants: string[];
  revisionId?: string; desiredRevisionId?: string; publishedGenerationId?: string | null;
  status: 'draft' | 'processing' | 'ready' | 'failed'; stage: string; error: string | null;
  transcriptSource?: NonNullable<MeetingIntake['transcriptSource']>;
  topicCount?: number; passageCount?: number; updatedAt: string; createdAt: string;
}
export interface Meeting extends MeetingSummary, MeetingIntake {
  passages: Passage[]; topics: Topic[];
  sourceTopics?: { id: string; title: string; sourceIds: string[] }[];
  sourceChunks?: { id: string; topicId?: string; title?: string; text: string; sourceIds?: string[]; part?: number }[];
  omissions?: { sourceId: string; reason: 'noise' | 'small_talk' }[];
  cleanedPassages: { passageId: string; text: string; smallTalk: boolean }[];
  models: { organization: string; embedding: string; answer: string } | null;
}
export interface MeetingFilters { revisionId?: string; meetingIds: string[]; participant: string; dateFrom: string; dateTo: string }
export interface SourceReference { revisionId?: string; generationId?: string; meetingId: string; meetingTitle: string; date: string; participants: string[]; passageId: string; start: number; end: number; text: string; speakers?: TranscriptSpeaker[]; segments?: TranscriptSegment[]; startsAtLineBoundary?: boolean; transcriptSource?: MeetingIntake['transcriptSource'] }
export interface Citation { revisionId?: string; generationId?: string; meetingId: string; passageId: string; quote: string; speaker?: string | null; segmentId?: string | null }
export interface MemoryAnswer {
  id: string; question: string; filters: MeetingFilters;
  status: 'answered' | 'insufficient_evidence' | 'clarification'; clarification: string | null;
  scope?: 'meeting' | 'speaker'; requestedSpeaker?: string | null; limitation?: string | null;
  statements: { text: string; kind: Exclude<ItemKind, 'open_question'> | 'uncertainty'; citations: Citation[] }[];
  sources: SourceReference[]; readyMeetingCount: number; retrievalTruncated: boolean; model: string | null; createdAt: string;
}
export interface IntakeDraft { title: string; date: string; participantsText: string; originalTranscript: string }

export interface SpeakerNameInput { speakerId: string; name: string | null }

export interface TranscriptRevisionSummary { id: string; createdAt: string; characters: number; generationId: string | null; transcriptSource?: MeetingIntake["transcriptSource"] }
