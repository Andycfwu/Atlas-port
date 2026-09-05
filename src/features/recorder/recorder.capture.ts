import type { AudioStream } from 'expo-audio';

/** The recording owner, never the network consumer, owns the native microphone. */
export class RecorderPcmCapture {
  constructor(
    private readonly stream: Pick<AudioStream, 'start' | 'stop' | 'isStreaming' | 'sampleRate' | 'channels'>,
    private readonly isRecorderActive: () => boolean,
  ) {}

  async prepare(): Promise<{ actualSampleRate: number; channels: 1 }> {
    if (this.isRecorderActive()) throw new Error('PCM capture cannot start while the file recorder is active.');
    try {
      await this.stream.start();
      if (!Number.isFinite(this.stream.sampleRate) || this.stream.sampleRate <= 0 || this.stream.channels !== 1) {
        throw new Error('The native live capture format is unsupported.');
      }
      return { actualSampleRate: this.stream.sampleRate, channels: 1 };
    } catch (error) {
      this.release();
      throw error;
    }
  }

  release(): void {
    if (this.isRecorderActive()) throw new Error('PCM capture cannot stop before the file recorder stops.');
    if (this.stream.isStreaming) this.stream.stop();
  }
}

interface RecordingCapturePreparation {
  platform: string;
  liveEnabled: boolean;
  capture: RecorderPcmCapture;
  prepareAudioSession: (prepareCapture?: () => Promise<void>) => Promise<boolean>;
  prepareFile: () => Promise<void>;
}

/** All session changes finish before iOS PCM starts; M4A record() runs afterward. */
export const prepareRecordingCapture = async ({
  platform, liveEnabled, capture, prepareAudioSession, prepareFile,
}: RecordingCapturePreparation): Promise<{ actualSampleRate: number | null; captureError: string | undefined }> => {
  let actualSampleRate: number | null = null;
  let captureError: string | undefined;
  const preparePcm = async () => {
    if (!liveEnabled) return;
    try { actualSampleRate = (await capture.prepare()).actualSampleRate; }
    catch (error) { captureError = error instanceof Error ? error.message : String(error); }
  };
  const prepareSession = async (beforeMode?: () => Promise<void>) => {
    if (!(await prepareAudioSession(beforeMode))) throw new Error('The microphone audio session request became stale.');
  };

  if (platform === 'ios') {
    // SDK 57 AudioRecorder.prepare changes category/mode, which can stop an
    // already-running AVAudioEngine. record() itself does not change the session.
    await prepareSession();
    await prepareFile();
    await preparePcm();
    // Failed stream startup can deactivate the session. Restore it before M4A.
    if (captureError) await prepareSession();
  } else {
    // Preserve the established Android microphone acquisition order.
    await prepareSession(preparePcm);
    await prepareFile();
  }
  return { actualSampleRate, captureError };
};
