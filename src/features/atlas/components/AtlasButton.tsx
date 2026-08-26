import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../config/theme';

interface AtlasButtonProps {
  disabled: boolean;
  isActive: boolean;
  label: string;
  onPress: () => void;
  sequence: string;
}

export function AtlasButton({
  disabled,
  isActive,
  label,
  onPress,
  sequence,
}: AtlasButtonProps) {
  return (
    <Pressable
      accessibilityLabel={`Play ${label}`}
      accessibilityRole="button"
      accessibilityState={{ busy: isActive, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.pressed,
        isActive && styles.activeButton,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.headingRow}>
        <Text style={[styles.sequence, isActive && styles.activeText]}>{sequence}</Text>
        {isActive ? <ActivityIndicator color={colors.white} size="small" /> : null}
      </View>
      <Text style={[styles.label, isActive && styles.activeText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: '47%',
    flexGrow: 1,
    minHeight: 82,
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.subduedSurface,
    transform: [{ scale: 0.99 }],
  },
  activeButton: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  disabled: {
    opacity: 0.42,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sequence: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  label: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  activeText: {
    color: colors.white,
  },
});
