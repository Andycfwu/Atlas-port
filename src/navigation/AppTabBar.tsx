import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../config/theme';

export type AppDestination = 'atlas' | 'recorder';

interface AppTabBarProps {
  activeDestination: AppDestination;
  isRecording: boolean;
  onChange: (destination: AppDestination) => void;
}

const destinations: readonly {
  id: AppDestination;
  label: string;
  monogram: string;
}[] = [
  { id: 'atlas', label: 'Atlas', monogram: 'A' },
  { id: 'recorder', label: 'Recorder', monogram: 'R' },
];

export function AppTabBar({
  activeDestination,
  isRecording,
  onChange,
}: AppTabBarProps) {
  return (
    <SafeAreaView edges={['right', 'bottom', 'left']} style={styles.safeArea}>
      <View accessibilityRole="tablist" style={styles.tabBar}>
        {destinations.map((destination) => {
          const isActive = destination.id === activeDestination;
          const showRecording = destination.id === 'recorder' && isRecording;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={destination.id}
              onPress={() => onChange(destination.id)}
              style={({ pressed }) => [styles.tab, pressed && styles.pressedTab]}
            >
              <View style={[styles.monogram, isActive && styles.activeMonogram]}>
                <Text style={[styles.monogramText, isActive && styles.activeMonogramText]}>
                  {destination.monogram}
                </Text>
                {showRecording ? <View style={styles.recordingDot} /> : null}
              </View>
              <Text style={[styles.label, isActive && styles.activeLabel]}>
                {destination.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 36,
    paddingTop: 7,
  },
  tab: {
    minWidth: 104,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    borderRadius: 14,
  },
  pressedTab: {
    opacity: 0.65,
  },
  monogram: {
    width: 27,
    height: 27,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  activeMonogram: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  monogramText: {
    color: colors.mutedInk,
    fontSize: 12,
    fontWeight: '900',
  },
  activeMonogramText: {
    color: colors.white,
  },
  recordingDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.danger,
  },
  label: {
    color: colors.mutedInk,
    fontSize: 11,
    fontWeight: '700',
  },
  activeLabel: {
    color: colors.ink,
  },
});
