import { StyleSheet, Text } from 'react-native';

import { colors } from '../../../config/theme';
import { formatDuration } from '../recorder.service';

interface RecordingTimerProps {
  durationMillis: number;
  isRecording: boolean;
}

export function RecordingTimer({ durationMillis, isRecording }: RecordingTimerProps) {
  return (
    <Text
      accessibilityLabel={`Elapsed recording time ${formatDuration(durationMillis)}`}
      style={[styles.timer, isRecording && styles.activeTimer]}
    >
      {formatDuration(durationMillis)}
    </Text>
  );
}

const styles = StyleSheet.create({
  timer: {
    color: colors.ink,
    fontSize: 52,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: -2.2,
  },
  activeTimer: {
    color: colors.danger,
  },
});
