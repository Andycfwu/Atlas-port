import type { TranscriptSegment, TranscriptSpeaker } from '../../memory/memory.types';
export interface DiarizedTranscript {
  id: string; recordingId: string; provider: 'openai'; model: 'gpt-4o-transcribe-diarize';
  providerRequestId: string | null; audioSha256: string; audioByteSize: number;
  durationMillis: number; savedAudioDurationMillis: number; createdAt: string;
  providerText: string; originalTranscript: string;
  speakers: TranscriptSpeaker[];
  segments: (TranscriptSegment & { text: string; providerSegmentId: string })[];
}
export interface DiarizationJob {
  id: string | null; recordingId: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed'; error: string | null;
  result?: DiarizedTranscript | null;
}
