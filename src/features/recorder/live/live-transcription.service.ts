import type { AudioStreamBuffer } from 'expo-audio';

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
      typeof resampling === 'boolean'
      ? { backendRevision: readString(parsed, 'backendRevision'), resampling, targetSampleRate, traceId, type }
      : null;
  }

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

    this.audioQueue.push(buffer.data);
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
      this.ready = true;
      this.clearReadyTimer();
      this.callbacks.onReady(message.backendRevision);
      this.schedulePump(0);
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
