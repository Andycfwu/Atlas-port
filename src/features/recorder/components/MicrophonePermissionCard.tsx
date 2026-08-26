import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../config/theme';
import type { MicrophonePermissionState } from '../recorder.types';

interface MicrophonePermissionCardProps {
  onOpenSettings: () => Promise<void>;
  onRequestPermission: () => Promise<boolean>;
  permissionState: MicrophonePermissionState;
}

export function MicrophonePermissionCard({
  onOpenSettings,
  onRequestPermission,
  permissionState,
}: MicrophonePermissionCardProps) {
  if (permissionState === 'granted' || permissionState === 'undetermined') {
    return null;
  }

  const isBlocked = permissionState === 'blocked';

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View style={styles.mark}>
          <Text style={styles.markText}>MIC</Text>
        </View>
        <Text style={styles.title}>Microphone access required</Text>
      </View>
      <Text style={styles.body}>
        {isBlocked
          ? 'Microphone access is disabled for RealTorch Atlas. Enable it in device settings to capture field notes.'
          : 'Atlas needs microphone access to create voice recordings. Access is requested only when you choose to allow it.'}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void (isBlocked ? onOpenSettings() : onRequestPermission());
        }}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.actionText}>{isBlocked ? 'Open Settings' : 'Allow Microphone'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.accentSoft,
    borderRadius: 18,
    backgroundColor: colors.accentSoft,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mark: {
    overflow: 'hidden',
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  markText: {
    color: colors.white,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  title: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  body: {
    marginTop: 10,
    color: colors.mutedInk,
    fontSize: 13,
    lineHeight: 19,
  },
  action: {
    alignSelf: 'flex-start',
    marginTop: 13,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: colors.brand,
  },
  pressed: {
    opacity: 0.72,
  },
  actionText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '800',
  },
});
