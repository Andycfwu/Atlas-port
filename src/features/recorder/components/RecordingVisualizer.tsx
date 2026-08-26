import { StyleSheet, View } from 'react-native';

import { colors } from '../../../config/theme';

interface RecordingVisualizerProps {
  isRecording: boolean;
  metering: number | null;
}

const barWeights = [
  0.28, 0.52, 0.36, 0.78, 0.46, 0.92, 0.58, 0.72, 1, 0.62, 0.86, 0.44,
  0.7, 0.34, 0.56, 0.26,
];

const normalizeMetering = (metering: number | null): number => {
  if (metering === null) {
    return 0.12;
  }

  return Math.max(0.08, Math.min(1, (metering + 60) / 60));
};

export function RecordingVisualizer({
  isRecording,
  metering,
}: RecordingVisualizerProps) {
  const level = isRecording ? normalizeMetering(metering) : 0.08;

  return (
    <View
      accessibilityLabel={isRecording ? 'Live microphone level' : 'Microphone is idle'}
      style={styles.visualizer}
    >
      {barWeights.map((weight, index) => (
        <View
          key={`${weight}-${index}`}
          style={[
            styles.bar,
            isRecording && styles.activeBar,
            { height: 6 + 36 * level * weight },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  visualizer: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginVertical: 16,
  },
  bar: {
    width: 4,
    minHeight: 5,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  activeBar: {
    backgroundColor: colors.accent,
  },
});
