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
      adjustsFontSizeToFit
      numberOfLines={1}
      minimumFontScale={0.6}
      style={[styles.timer, isRecording && styles.activeTimer]}
    >
      {formatDuration(durationMillis)}
    </Text>
  );
}

const styles = StyleSheet.create({
  timer: {
    color: colors.ink,
    fontSize: 46,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    letterSpacing: -1.5,
  },
  activeTimer: {
    color: colors.ink,
  },
});
