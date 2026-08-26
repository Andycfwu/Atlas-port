import { useState } from 'react';
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '../../../config/theme';
import { formatDuration } from '../recorder.service';

interface RecordingScrubberProps {
  disabled: boolean;
  durationMillis: number;
  onSeek: (positionMillis: number) => Promise<void>;
  positionMillis: number;
}

const clampFraction = (value: number): number =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export function RecordingScrubber({
  disabled,
  durationMillis,
  onSeek,
  positionMillis,
}: RecordingScrubberProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPositionMillis, setScrubPositionMillis] = useState(positionMillis);
  const hasDuration = Number.isFinite(durationMillis) && durationMillis > 0;
  const isDisabled = disabled || !hasDuration || trackWidth <= 0;

  const getPosition = (locationX: number): number => {
    if (!hasDuration || trackWidth <= 0) {
      return 0;
    }

    return Math.round(clampFraction(locationX / trackWidth) * durationMillis);
  };

  const updateScrubPosition = (event: GestureResponderEvent): number => {
    const nextPosition = getPosition(event.nativeEvent.locationX);
    setScrubPositionMillis(nextPosition);
    return nextPosition;
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const handleRelease = (event: GestureResponderEvent) => {
    if (isDisabled) {
      return;
    }

    const nextPosition = updateScrubPosition(event);
    setIsScrubbing(false);
    void onSeek(nextPosition);
  };

  const displayPositionMillis = Math.min(
    Math.max(0, isScrubbing ? scrubPositionMillis : positionMillis),
    Math.max(0, durationMillis),
  );
  const progress = hasDuration
    ? clampFraction(displayPositionMillis / durationMillis)
    : 0;
  const thumbOffset = Math.max(0, Math.min(trackWidth - 18, progress * trackWidth - 9));

  return (
    <View style={styles.container}>
      <View
        accessibilityActions={[
          { name: 'decrement', label: 'Seek backward 5 seconds' },
          { name: 'increment', label: 'Seek forward 5 seconds' },
        ]}
        accessibilityLabel="Recording playback position"
        accessibilityRole="adjustable"
        accessibilityState={{ disabled: isDisabled }}
        accessibilityValue={{
          min: 0,
          max: Math.max(0, durationMillis),
          now: displayPositionMillis,
          text: `${formatDuration(displayPositionMillis)} of ${formatDuration(durationMillis)}`,
        }}
        onAccessibilityAction={(event) => {
          if (isDisabled) {
            return;
          }

          const offset = event.nativeEvent.actionName === 'increment' ? 5_000 : -5_000;
          void onSeek(displayPositionMillis + offset);
        }}
        onLayout={handleLayout}
        onMoveShouldSetResponder={() => !isDisabled}
        onResponderGrant={(event) => {
          if (!isDisabled) {
            setIsScrubbing(true);
            updateScrubPosition(event);
          }
        }}
        onResponderMove={(event) => {
          if (!isDisabled) {
            updateScrubPosition(event);
          }
        }}
        onResponderRelease={handleRelease}
        onResponderTerminate={() => setIsScrubbing(false)}
        onStartShouldSetResponder={() => !isDisabled}
        style={[styles.trackTouchTarget, isDisabled && styles.disabled]}
      >
        <View style={styles.track}>
          <View style={[styles.progress, { width: `${progress * 100}%` }]} />
        </View>
        <View style={[styles.thumb, { left: thumbOffset }]} />
      </View>

      <View style={styles.timeRow}>
        <Text style={styles.time}>{formatDuration(displayPositionMillis)}</Text>
        <Text style={styles.time}>{formatDuration(durationMillis)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  trackTouchTarget: {
    height: 34,
    justifyContent: 'center',
  },
  track: {
    overflow: 'hidden',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.subduedSurface,
  },
  progress: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    top: 8,
    width: 18,
    height: 18,
    borderWidth: 4,
    borderColor: colors.surface,
    borderRadius: 9,
    backgroundColor: colors.brand,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 2,
  },
  disabled: {
    opacity: 0.48,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 1,
  },
  time: {
    color: colors.mutedInk,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
