import {
  getRecordingPermissionsAsync,
  PermissionStatus,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  type RecordingOptions,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  createRecorderSessionId,
  logRecorderIntegrity,
  validateFinalizedRecording,
  waitForIntegrityTarget,
} from '../../src/features/recorder/recorder.integrity';
import type { RecordingFileValidation } from '../../src/features/recorder/recorder.integrity.types';

const MINIMAL_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  directory: 'document',
  isMeteringEnabled: true,
};
const AUTORUN_ENABLED =
  __DEV__ && process.env.EXPO_PUBLIC_MINIMAL_RECORDER_AUTORUN === '1';
const NATIVE_METERING_SENTINEL_DB = -120;
let minimalAutorunStarted = false;

interface MinimalSession {
  recorderId: string;
  sessionId: string;
  sourceUri: string;
}

const waitForNativeStart = async (
  recorder: ReturnType<typeof useAudioRecorder>,
): Promise<string> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= 2_000) {
    const status = recorder.getStatus();
    const uri = recorder.uri ?? status.url;

    if (
      recorder.isRecording &&
      status.isRecording &&
      status.canRecord &&
      uri &&
      typeof status.metering === 'number' &&
      status.metering > NATIVE_METERING_SENTINEL_DB
    ) {
      return uri;
    }

    await waitForIntegrityTarget(50);
  }

  throw new Error('Minimal recorder did not become natively active within two seconds.');
};

export default function MinimalRecorderRepro() {
  const recorder = useAudioRecorder(MINIMAL_RECORDING_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 200);
  const [lastValidation, setLastValidation] =
    useState<RecordingFileValidation | null>(null);
  const [message, setMessage] = useState('Ready');
  const [playbackUri, setPlaybackUri] = useState<string | null>(null);
  const player = useAudioPlayer(playbackUri ? { uri: playbackUri } : null, {
    keepAudioSessionActive: true,
    updateInterval: 100,
  });
  const playerStatus = useAudioPlayerStatus(player);
  const activeSessionRef = useRef<MinimalSession | null>(null);
  const operationRef = useRef(false);

  const start = useCallback(async (): Promise<boolean> => {
    if (operationRef.current || recorder.isRecording) {
      return false;
    }

    operationRef.current = true;
    const sessionId = createRecorderSessionId();
    setMessage('Starting native recorder…');
    setLastValidation(null);
    setPlaybackUri(null);
    logRecorderIntegrity(sessionId, 'SESSION_CREATED', {
      minimalReproduction: true,
      recorderId: recorder.id,
      recorderOptions: MINIMAL_RECORDING_OPTIONS,
    });

    try {
      let permission = await getRecordingPermissionsAsync();

      if (
        !permission.granted &&
        permission.status === PermissionStatus.UNDETERMINED &&
        permission.canAskAgain
      ) {
        permission = await requestRecordingPermissionsAsync();
      }

      if (!permission.granted) {
        throw new Error('Microphone permission was not granted.');
      }

      logRecorderIntegrity(sessionId, 'AUDIO_MODE_RECORDING_REQUESTED', {
        minimalReproduction: true,
        recorderId: recorder.id,
      });
      await setAudioModeAsync({
        allowsBackgroundRecording: true,
        allowsRecording: true,
        interruptionMode: 'doNotMix',
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      logRecorderIntegrity(sessionId, 'AUDIO_MODE_RECORDING_READY', {
        minimalReproduction: true,
        recorderId: recorder.id,
      });
      logRecorderIntegrity(sessionId, 'PREPARE_STARTED', {
        recorderId: recorder.id,
        status: recorder.getStatus(),
        uri: recorder.uri,
      });
      await recorder.prepareToRecordAsync(MINIMAL_RECORDING_OPTIONS);
      logRecorderIntegrity(sessionId, 'PREPARE_FINISHED', {
        nativeIsRecording: recorder.isRecording,
        recorderId: recorder.id,
        status: recorder.getStatus(),
        uri: recorder.uri,
      });
      recorder.record();
      logRecorderIntegrity(sessionId, 'RECORD_CALLED', {
        nativeIsRecording: recorder.isRecording,
        recorderId: recorder.id,
        status: recorder.getStatus(),
        uri: recorder.uri,
      });
      const sourceUri = await waitForNativeStart(recorder);
      activeSessionRef.current = {
        recorderId: recorder.id,
        sessionId,
        sourceUri,
      };
      logRecorderIntegrity(sessionId, 'NATIVE_RECORDING_CONFIRMED', {
        nativeIsRecording: recorder.isRecording,
        recorderId: recorder.id,
        status: recorder.getStatus(),
        sourceUri,
      });
      setMessage('Native recorder confirmed');
      return true;
    } catch (error) {
      logRecorderIntegrity(sessionId, 'SESSION_FAILED', {
        error: error instanceof Error ? error.message : String(error),
        minimalReproduction: true,
        nativeIsRecording: recorder.isRecording,
        recorderId: recorder.id,
        status: recorder.getStatus(),
      });

      if (recorder.isRecording) {
        try {
          await recorder.stop();
        } catch (stopError) {
          logRecorderIntegrity(sessionId, 'SESSION_FAILED', {
            cleanupStopError:
              stopError instanceof Error ? stopError.message : String(stopError),
            minimalReproduction: true,
          });
        }
      }

      await setAudioModeAsync({
        allowsBackgroundRecording: false,
        allowsRecording: false,
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      setMessage(error instanceof Error ? error.message : 'Minimal recorder start failed.');
      return false;
    } finally {
      operationRef.current = false;
    }
  }, [recorder]);

  const stop = useCallback(async (): Promise<void> => {
    const session = activeSessionRef.current;

    if (!session || operationRef.current) {
      return;
    }

    operationRef.current = true;
    setMessage('Stopping and validating exact native URI…');
    const before = recorder.getStatus();
    const uriBefore = recorder.uri;
    logRecorderIntegrity(session.sessionId, 'STATUS_BEFORE_STOP', {
      minimalReproduction: true,
      nativeIsRecording: recorder.isRecording,
      recorderId: recorder.id,
      status: before,
      uri: uriBefore,
    });

    try {
      await recorder.stop();
      const after = recorder.getStatus();
      const uriAfter = recorder.uri;
      logRecorderIntegrity(session.sessionId, 'STATUS_AFTER_STOP', {
        minimalReproduction: true,
        nativeIsRecording: recorder.isRecording,
        recorderId: recorder.id,
        status: after,
        uri: uriAfter,
        uriChanged: uriAfter !== uriBefore,
      });

      if (uriAfter !== session.sourceUri || uriBefore !== session.sourceUri) {
        throw new Error('The minimal native URI changed during Stop.');
      }

      const validation = await validateFinalizedRecording(
        session.sessionId,
        session.sourceUri,
        before.durationMillis,
      );
      setLastValidation(validation);
      setPlaybackUri(session.sourceUri);
      setMessage(validation.passed ? 'PASS: native file duration matched' : 'FAIL: native file was truncated');
    } catch (error) {
      logRecorderIntegrity(session.sessionId, 'SESSION_FAILED', {
        error: error instanceof Error ? error.message : String(error),
        minimalReproduction: true,
      });
      setMessage(error instanceof Error ? error.message : 'Minimal recorder stop failed.');
    } finally {
      activeSessionRef.current = null;
      operationRef.current = false;
      await setAudioModeAsync({
        allowsBackgroundRecording: false,
        allowsRecording: false,
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
    }
  }, [recorder]);

  useEffect(() => {
    if (!AUTORUN_ENABLED || minimalAutorunStarted) {
      return;
    }

    // A module-level guard also survives development-only component remounts,
    // keeping this diagnostic to exactly one native recording operation.
    minimalAutorunStarted = true;
    const timeout = setTimeout(() => {
      void (async () => {
        if (await start()) {
          await waitForIntegrityTarget(5_000);
          await stop();
        }
      })();
    }, 1_500);

    return () => clearTimeout(timeout);
  }, [start, stop]);

  const playNativeUri = useCallback(async () => {
    if (!player.currentStatus.isLoaded) {
      return;
    }

    await player.seekTo(0);
    player.play();
  }, [player]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>ISOLATED EXPO AUDIO REPRODUCTION</Text>
        <Text style={styles.title}>One native recorder</Text>
        <Text style={styles.body}>
          No RealTorch providers, players, navigation, persistence, or file moves are mounted.
        </Text>

        <View style={styles.card}>
          <Text style={styles.message}>{message}</Text>
          <Text style={styles.status}>
            ID {recorder.id}{'\n'}
            Native recording: {String(recorder.isRecording)}{'\n'}
            Wrapper recording: {String(recorderState.isRecording)}{'\n'}
            Duration: {recorderState.durationMillis} ms
          </Text>

          <Pressable onPress={() => void start()} style={styles.button}>
            <Text style={styles.buttonLabel}>Record</Text>
          </Pressable>
          <Pressable onPress={() => void stop()} style={styles.button}>
            <Text style={styles.buttonLabel}>Stop</Text>
          </Pressable>
          <Pressable
            disabled={!playerStatus.isLoaded}
            onPress={() => void playNativeUri()}
            style={[styles.button, !playerStatus.isLoaded && styles.disabled]}
          >
            <Text style={styles.buttonLabel}>Play exact native URI</Text>
          </Pressable>
        </View>

        {lastValidation ? (
          <Text style={styles.status}>
            File: {lastValidation.fileSize} bytes{'\n'}
            Native: {lastValidation.nativeDurationMillis} ms{'\n'}
            Player: {lastValidation.playerDurationMillis} ms{'\n'}
            Passed: {String(lastValidation.passed)}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F1EA',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  eyebrow: {
    color: '#C57A4A',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    marginTop: 8,
    color: '#16342F',
    fontSize: 32,
    fontWeight: '800',
  },
  body: {
    marginTop: 8,
    color: '#61716D',
    fontSize: 14,
    lineHeight: 21,
  },
  card: {
    marginTop: 24,
    gap: 12,
    padding: 18,
    borderRadius: 20,
    backgroundColor: '#FFFEFB',
  },
  message: {
    color: '#16342F',
    fontSize: 16,
    fontWeight: '800',
  },
  status: {
    marginTop: 12,
    color: '#61716D',
    fontSize: 12,
    lineHeight: 19,
    fontVariant: ['tabular-nums'],
  },
  button: {
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#214F46',
  },
  buttonLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  disabled: {
    opacity: 0.42,
  },
});
