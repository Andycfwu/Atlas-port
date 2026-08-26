import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../config/theme';

interface AppHeaderProps {
  badge: string;
  isRecording?: boolean;
  product: string;
}

export function AppHeader({ badge, isRecording = false, product }: AppHeaderProps) {
  return (
    <View style={styles.header}>
      <View>
        <Text style={styles.brand}>REALTORCH</Text>
        <Text style={styles.product}>{product}</Text>
      </View>
      <View style={[styles.badge, isRecording && styles.recordingBadge]}>
        <View style={[styles.badgeDot, isRecording && styles.recordingDot]} />
        <Text style={[styles.badgeText, isRecording && styles.recordingText]}>{badge}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2.4,
  },
  product: {
    marginTop: 3,
    color: colors.mutedInk,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
  },
  recordingBadge: {
    borderColor: colors.dangerSoft,
    backgroundColor: colors.dangerSoft,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  recordingDot: {
    backgroundColor: colors.danger,
  },
  badgeText: {
    color: colors.mutedInk,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  recordingText: {
    color: colors.danger,
  },
});
