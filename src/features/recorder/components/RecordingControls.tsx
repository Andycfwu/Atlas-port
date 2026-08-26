import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../config/theme';
import type { RecorderPhase } from '../recorder.types';
import { RecordingTimer } from './RecordingTimer';
import { RecordingVisualizer } from './RecordingVisualizer';

interface RecordingControlsProps {
  durationMillis: number;
  isRecording: boolean;
  metering: number | null;
  onToggle: () => Promise<void>;
  phase: RecorderPhase;
}

const phaseLabels: Record<RecorderPhase, string> = {
  idle: 'READY TO CAPTURE',
  starting: 'OPENING MICROPHONE',
  recording: 'RECORDING IN PROGRESS',
  stopping: 'SAVING RECORDING',
  error: 'RECORDER NEEDS ATTENTION',
};

export function RecordingControls({
  durationMillis,
  isRecording,
  metering,
  onToggle,
  phase,
}: RecordingControlsProps) {
  const isBusy = phase === 'starting' || phase === 'stopping';
  const buttonLabel = isRecording
    ? 'Stop & Save'
    : phase === 'starting'
      ? 'Starting…'
      : phase === 'stopping'
        ? 'Saving…'
        : 'Start Recording';

  return (
    <View style={styles.card}>
      <View style={styles.stateRow}>
        <View style={[styles.stateDot, isRecording && styles.recordingDot]} />
        <Text style={[styles.stateText, isRecording && styles.recordingText]}>
          {phaseLabels[phase]}
        </Text>
      </View>

      <RecordingTimer durationMillis={durationMillis} isRecording={isRecording} />
      <RecordingVisualizer isRecording={isRecording} metering={metering} />

      <Pressable
        accessibilityLabel={buttonLabel}
        accessibilityRole="button"
        accessibilityState={{ busy: isBusy, disabled: isBusy }}
        disabled={isBusy}
        onPress={() => {
          void onToggle();
        }}
        style={({ pressed }) => [
          styles.control,
          isRecording && styles.stopControl,
          pressed && styles.pressed,
          isBusy && styles.busy,
        ]}
      >
        <View style={[styles.controlMark, isRecording && styles.stopMark]}>
          {isBusy ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <View style={[styles.markCore, isRecording && styles.stopCore]} />
          )}
        </View>
        <Text style={styles.controlLabel}>{buttonLabel}</Text>
        <Text style={styles.controlMeta}>{isRecording ? 'SAVE' : 'VOICE NOTE'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.surface,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 4,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
  },
  stateDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  recordingDot: {
    backgroundColor: colors.danger,
  },
  stateText: {
    color: colors.mutedInk,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  recordingText: {
    color: colors.danger,
  },
  control: {
    width: '100%',
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: colors.brand,
  },
  stopControl: {
    backgroundColor: colors.ink,
  },
  pressed: {
    backgroundColor: colors.brandPressed,
    transform: [{ scale: 0.99 }],
  },
  busy: {
    opacity: 0.78,
  },
  controlMark: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  stopMark: {
    backgroundColor: colors.danger,
  },
  markCore: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  stopCore: {
    borderRadius: 3,
  },
  controlLabel: {
    flex: 1,
    marginLeft: 12,
    color: colors.white,
    fontSize: 17,
    fontWeight: '800',
  },
  controlMeta: {
    marginRight: 4,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
});
