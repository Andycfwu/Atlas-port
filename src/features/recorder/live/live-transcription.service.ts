import type { AudioStreamBuffer } from 'expo-audio';
import { isSpeakerSession, isSpeakerResult, isSpeakerMetadata, LiveSpeakerAccumulator } from '../live-speakers/live-speakers.model';
import type { LiveProvider, LiveSpeakerSnapshot } from '../live-speakers/live-speakers.model';

import type {
  LiveTranscriptionServerMessage,
  LiveTranscriptionStreamMetadata,
} from './live-transcription.types';

const MAX_QUEUED_AUDIO_BYTES = 512 * 1024;
const MAX_SOCKET_BUFFERED_BYTES = 512 * 1024;
const READY_TIMEOUT_MS = 10_000;
const FINISH_TIMEOUT_MS = 15_000;
const QUEUE_RETRY_MS = 20;

type LiveConnectionFailureCode =
  | 'LIVE_INVALID_AUDIO'
  | 'LIVE_BACKPRESSURE'
  | 'LIVE_CONNECTION_CLOSED'
  | 'LIVE_CONNECTION_FAILED'
  | 'LIVE_CONNECTION_TIMEOUT'
  | 'LIVE_INVALID_RESPONSE'
  | 'LIVE_STREAM_FORMAT_CHANGED';

export class LiveTranscriptionConnectionError extends Error {
  constructor(
    readonly code: LiveConnectionFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'LiveTranscriptionConnectionError';
  }
}

interface LiveTranscriptionConnectionCallbacks {
  onSpeakers?: (snapshot: LiveSpeakerSnapshot) => void;
  onCompleted: () => void;
  onDraft: (draft: string, segments?: import('../recorder.types').LiveTranscriptSegment[]) => void;
  onFailure: (error: LiveTranscriptionConnectionError) => void;
  onReady: (backendRevision: string | null) => void;
}

interface TranscriptSegment {
  draft: string;
  final: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const readString = (
  value: Record<string, unknown>,
  key: string,
): string | null => {
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : null;
};

export const deriveLiveTranscriptionWebSocketUrl = (
  apiUrl: string | null,
  provider: LiveProvider = 'openai',
): string | null => {
  if (!apiUrl) {
    return null;
  }

  try {
    const url = new URL(apiUrl);

    if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    } else if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else {
      return null;
    }

    url.pathname = `${url.pathname.replace(/\/+$/, '')}/live-transcribe`;
    url.search = '';
    if (provider === 'deepgram') url.searchParams.set('provider', 'deepgram');
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

export const parseLiveTranscriptionServerMessage = (
  rawMessage: unknown,
): LiveTranscriptionServerMessage | null => {
  if (typeof rawMessage !== 'string') {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawMessage) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const type = readString(parsed, 'type');
  const traceId = readString(parsed, 'traceId');

  if (!type || !traceId) {
    return null;
  }

  if (type === 'ready') {
    const targetSampleRate = parsed.targetSampleRate;
    const resampling = parsed.resampling;

    return typeof targetSampleRate === 'number' &&
      Number.isFinite(targetSampleRate) &&
      typeof resampling === 'boolean' && (parsed.speakerSession === undefined || isSpeakerSession(parsed.speakerSession))
      ? { backendRevision: readString(parsed, 'backendRevision'), resampling, targetSampleRate, traceId, type,
          ...(isSpeakerSession(parsed.speakerSession) ? { speakerSession: parsed.speakerSession } : {}) }
      : null;
  }
  if (type === 'speaker_diagnostics') return isRecord(parsed.metrics) && Object.keys(parsed.metrics).length <= 32 && Object.values(parsed.metrics).every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0) ? { type, traceId, metrics: parsed.metrics as Record<string, number> } : null;
  if (type === 'speaker_result') return isSpeakerResult(parsed.result) ? { type, traceId, result: parsed.result } : null;
  if (type === 'speaker_metadata') return typeof parsed.connectionId === 'string' && isSpeakerMetadata(parsed.metadata)
    ? { type, traceId, connectionId: parsed.connectionId, metadata: parsed.metadata } : null;

  if (type === 'partial') {
    const delta = readString(parsed, 'delta');
    const itemId = readString(parsed, 'itemId');
    return delta !== null && itemId
      ? { delta, itemId, traceId, type }
      : null;
  }

  if (type === 'final') {
    const itemId = readString(parsed, 'itemId');
    const transcript = readString(parsed, 'transcript');
    return itemId && transcript !== null
      ? { itemId, traceId, transcript, type }
      : null;
  }

  if (type === 'completed') {
    return { traceId, type };
  }

  if (type === 'committed') {
    const itemId = readString(parsed, 'itemId');
    return itemId ? { type, itemId, previousItemId: readString(parsed, 'previousItemId'), traceId } : null;
  }

  if (type === 'error') {
    const code = readString(parsed, 'code');
    const message = readString(parsed, 'message');
    const stage = readString(parsed, 'stage');
    return code && message && stage
        ? { code, message, stage, traceId, type }
      : null;
  }

  return null;
};

const socketBufferedAmount = (socket: WebSocket): number => {
  const value = socket.bufferedAmount;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

export class LiveTranscriptionConnection {
  private readonly diagnostics = { receivedSamples: 0, sentSamples: 0, nativeBuffers: 0, peak: 0, squared: 0, clippedSamples: 0, queuePeakBytes: 0, firstTextDelayMs: 0, finalEvents: 0, interimEvents: 0, firstNativeTimestamp: 0, lastNativeTimestamp: 0 };
  private serverDiagnostics: Record<string, number> = {};
  private readonly beganAt = Date.now();
  private speakerMode = false;
  private emitSpeakers() {
    const { squared, ...counts } = this.diagnostics;
    this.callbacks.onSpeakers?.({ ...this.speakers.snapshot(), diagnostics: { client: { ...counts, rms: Math.sqrt(squared / Math.max(1, counts.receivedSamples)) }, server: this.serverDiagnostics } });
  }
  private readonly speakers = new LiveSpeakerAccumulator();
  private readonly audioQueue: ArrayBuffer[] = [];
  private readonly segmentOrder: string[] = [];
  private readonly segments = new Map<string, TranscriptSegment>();
  private readonly committedOrder: string[] = [];
  private audioQueueBytes = 0;
  private completeRequested = false;
  private completeSent = false;
  private closed = false;
  private finishTimer: ReturnType<typeof setTimeout> | null = null;
  private failed = false;
  private pumpTimer: ReturnType<typeof setTimeout> | null = null;
  private ready = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private socket: WebSocket | null = null;

  constructor(
    private readonly url: string,
    private readonly metadata: LiveTranscriptionStreamMetadata,
    private readonly callbacks: LiveTranscriptionConnectionCallbacks,
  ) {}

  connect(): void {
    if (this.socket) {
      return;
    }

    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.readyTimer = setTimeout(() => {
      this.fail(
        new LiveTranscriptionConnectionError(
          'LIVE_CONNECTION_TIMEOUT',
          `The live transcription connection was not ready within ${READY_TIMEOUT_MS}ms.`,
        ),
      );
    }, READY_TIMEOUT_MS);

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'start',
          ...this.metadata,
        }),
      );
    };

    socket.onmessage = (event) => {
      this.handleServerMessage(event.data);
    };

    socket.onerror = (event) => {
      const message = (event as { message?: unknown }).message;
      this.fail(
        new LiveTranscriptionConnectionError(
          'LIVE_CONNECTION_FAILED',
          typeof message === 'string' && message
            ? message
            : 'The live transcription socket reported an error.',
        ),
      );
    };

    socket.onclose = (event) => {
      this.clearTimers();

      if (!this.closed && !this.failed) {
        this.fail(
          new LiveTranscriptionConnectionError(
            'LIVE_CONNECTION_CLOSED',
            `The live transcription connection closed unexpectedly (${event.code ?? 0}).`,
          ),
        );
      }
    };
  }

  sendAudio(buffer: AudioStreamBuffer): void {
    if (this.failed || this.completeRequested) {
      return;
    }

    if (
      buffer.sampleRate !== this.metadata.actualSampleRate ||
      buffer.channels !== this.metadata.channels
    ) {
      this.fail(
        new LiveTranscriptionConnectionError(
          'LIVE_STREAM_FORMAT_CHANGED',
          'The native PCM stream format changed after live transcription started.',
        ),
      );
      return;
    }

    if (!buffer.data.byteLength || buffer.data.byteLength % 2) {
      this.fail(new LiveTranscriptionConnectionError('LIVE_INVALID_AUDIO', 'PCM16 requires complete 16-bit samples. Local audio is preserved.')); return;
    }
    const view = new DataView(buffer.data);
    const d = this.diagnostics;
    d.nativeBuffers++;
    if (Number.isFinite(buffer.timestamp)) { if (d.nativeBuffers === 1) d.firstNativeTimestamp = buffer.timestamp; d.lastNativeTimestamp = buffer.timestamp; }
    for (let offset = 0; offset < view.byteLength; offset += 2) {
      const raw = view.getInt16(offset, true), value = raw / 32768;
      d.receivedSamples++; d.squared += value * value; d.peak = Math.max(d.peak, Math.abs(value));
      if (raw === -32768 || raw === 32767) d.clippedSamples++;
    }
    const nextSize = this.audioQueueBytes + buffer.data.byteLength;

    if (nextSize > MAX_QUEUED_AUDIO_BYTES) {
      this.fail(
        new LiveTranscriptionConnectionError(
          'LIVE_BACKPRESSURE',
          'Live transcription could not keep up with the microphone stream.',
        ),
      );
      return;
    }

    this.diagnostics.queuePeakBytes = Math.max(this.diagnostics.queuePeakBytes, nextSize);
    this.audioQueue.push(buffer.data.slice(0));
    this.audioQueueBytes = nextSize;
    this.schedulePump(0);
  }

  complete(): void {
    if (this.completeRequested) {
      return;
    }

    this.completeRequested = true;
    this.finishTimer = setTimeout(() => this.fail(new LiveTranscriptionConnectionError(
      'LIVE_CONNECTION_TIMEOUT', 'The live transcript did not finish in time. Use saved-file transcription.',
    )), FINISH_TIMEOUT_MS);
    this.schedulePump(0);
  }

  close(reason: string): void {
    this.closed = true;
    this.completeRequested = true;
    this.clearTimers();
    this.audioQueue.length = 0;
    this.audioQueueBytes = 0;

    const socket = this.socket;
    this.socket = null;

    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      socket.close(1000, reason.slice(0, 100));
    }
  }

  private handleServerMessage(rawMessage: unknown): void {
    if (this.closed || this.failed) return;
    const message = parseLiveTranscriptionServerMessage(rawMessage);

    if (!message || message.traceId !== this.metadata.traceId) {
      this.fail(
        new LiveTranscriptionConnectionError(
          'LIVE_INVALID_RESPONSE',
          'The live transcription backend returned an invalid response.',
        ),
      );
      return;
    }

    if (message.type === 'ready') {
      if (message.speakerSession) {
        this.speakerMode = true;
        this.speakers.start(message.speakerSession);
        this.emitSpeakers();
      }
      this.ready = true;
      this.clearReadyTimer();
      this.callbacks.onReady(message.backendRevision);
      this.schedulePump(0);
      return;
    }
    if (message.type === 'speaker_diagnostics') { this.serverDiagnostics = message.metrics; this.emitSpeakers(); return; }
    if (message.type === 'speaker_result' || message.type === 'speaker_metadata') {
      try {
        if (message.type === 'speaker_result') {
          if (message.result.text && !this.diagnostics.firstTextDelayMs) this.diagnostics.firstTextDelayMs = Date.now() - this.beganAt;
          this.diagnostics[message.result.isFinal ? 'finalEvents' : 'interimEvents']++;
          this.speakers.accept(message.result);
        }
        else this.speakers.metadata(message.connectionId, message.metadata);
        this.emitSpeakers();
      } catch {
        this.fail(new LiveTranscriptionConnectionError('LIVE_INVALID_RESPONSE', 'Live speaker results were inconsistent. Received text is preserved.'));
      }
      return;
    }

    if (message.type === 'partial') {
      this.updateSegment(message.itemId, message.delta, null);
      return;
    }

    if (message.type === 'committed') {
      if (!this.committedOrder.includes(message.itemId)) this.committedOrder.push(message.itemId);
      this.emitDraft();
      return;
    }

    if (message.type === 'final') {
      this.updateSegment(message.itemId, '', message.transcript);
      return;
    }

    if (message.type === 'completed') {
      if (!this.completeSent) {
        this.fail(new LiveTranscriptionConnectionError('LIVE_INVALID_RESPONSE', 'The backend completed before audio was drained.'));
        return;
      }
      if (this.speakerMode) this.emitSpeakers();
      this.callbacks.onCompleted();
      this.close('stream_completed');
      return;
    }

    this.fail(
      new LiveTranscriptionConnectionError(
        'LIVE_CONNECTION_FAILED',
        `${message.code} (${message.stage}): ${message.message}`,
      ),
    );
  }

  private updateSegment(
    itemId: string,
    delta: string,
    final: string | null,
  ): void {
    const existing = this.segments.get(itemId);

    if (!existing) {
      this.segmentOrder.push(itemId);
    }

    this.segments.set(itemId, {
      draft: `${existing?.draft ?? ''}${delta}`,
      final: final ?? existing?.final ?? null,
    });

    this.emitDraft();
  }

  private emitDraft(): void {
    const order = [...this.committedOrder, ...this.segmentOrder.filter((id) => !this.committedOrder.includes(id))];
    const draft = order
      .map((id) => {
        const segment = this.segments.get(id);
        return segment?.final ?? segment?.draft ?? '';
      })
      .filter(Boolean)
      .join(' ');
    this.callbacks.onDraft(draft, order.map(itemId => ({ itemId, deltaText: this.segments.get(itemId)?.draft ?? '', finalText: this.segments.get(itemId)?.final ?? null })));
  }

  private schedulePump(delay: number): void {
    if (this.pumpTimer || !this.ready || this.closed || this.failed) {
      return;
    }

    this.pumpTimer = setTimeout(() => {
      this.pumpTimer = null;
      this.pumpAudioQueue();
    }, delay);
  }

  private pumpAudioQueue(): void {
    const socket = this.socket;

    if (!socket || socket.readyState !== WebSocket.OPEN || !this.ready) {
      return;
    }

    if (socketBufferedAmount(socket) > MAX_SOCKET_BUFFERED_BYTES) {
      this.schedulePump(QUEUE_RETRY_MS);
      return;
    }

    const next = this.audioQueue.shift();

    if (!next) {
      if (this.completeRequested && !this.completeSent) {
        try {
          this.completeSent = true;
          socket.send(JSON.stringify({ type: 'complete' }));
        } catch {
          this.fail(new LiveTranscriptionConnectionError('LIVE_CONNECTION_FAILED', 'Could not finish the live stream.'));
        }
      }
      return;
    }

    this.audioQueueBytes -= next.byteLength;

    try {
      socket.send(next);
      this.diagnostics.sentSamples += next.byteLength / 2;
    } catch (error) {
      this.fail(
        new LiveTranscriptionConnectionError(
          'LIVE_CONNECTION_FAILED',
          error instanceof Error ? error.message : String(error),
        ),
      );
      return;
    }

    if (this.audioQueue.length > 0 || this.completeRequested) {
      this.schedulePump(0);
    }
  }

  private fail(error: LiveTranscriptionConnectionError): void {
    if (this.failed || this.closed) {
      return;
    }

    this.failed = true;
    if (this.speakerMode) this.emitSpeakers();
    this.callbacks.onFailure(error);
    this.close('live_transcription_failed');
  }

  private clearPumpTimer(): void {
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  private clearReadyTimer(): void {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  private clearTimers(): void {
    if (this.finishTimer) clearTimeout(this.finishTimer);
    this.finishTimer = null;
    this.clearPumpTimer();
    this.clearReadyTimer();
  }
}
