import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { colors } from '../../../config/theme';

interface RenameRecordingModalProps {
  currentTitle: string;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}

export function RenameRecordingModal({
  currentTitle,
  onClose,
  onSave,
}: RenameRecordingModalProps) {
  const [draftTitle, setDraftTitle] = useState(currentTitle);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const trimmedTitle = draftTitle.trim();

  const handleSave = async () => {
    if (!trimmedTitle) {
      setErrorMessage('Enter a title for this recording.');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);

    try {
      await onSave(trimmedTitle);
      onClose();
    } catch (error) {
      if (__DEV__) {
        console.error('[Recorder] Rename UI failed.', error);
      }
      setErrorMessage('The recording title could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={isSaving ? undefined : onClose}
      transparent
      visible
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <View style={styles.card}>
          <Text style={styles.eyebrow}>LOCAL RECORDING</Text>
          <Text style={styles.title}>Rename recording</Text>
          <Text style={styles.body}>
            Update the display title. The underlying audio filename will stay unchanged.
          </Text>

          <TextInput
            autoFocus
            editable={!isSaving}
            maxLength={120}
            onChangeText={setDraftTitle}
            onSubmitEditing={() => {
              void handleSave();
            }}
            placeholder="Recording title"
            placeholderTextColor={colors.mutedInk}
            returnKeyType="done"
            selectTextOnFocus
            style={styles.input}
            value={draftTitle}
          />

          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={onClose}
              style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={isSaving || !trimmedTitle}
              onPress={() => {
                void handleSave();
              }}
              style={({ pressed }) => [
                styles.primaryAction,
                pressed && styles.pressed,
                (isSaving || !trimmedTitle) && styles.disabled,
              ]}
            >
              {isSaving ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.primaryText}>Save title</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(22,52,47,0.38)',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    padding: 22,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    marginTop: 6,
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  body: {
    marginTop: 8,
    color: colors.mutedInk,
    fontSize: 13,
    lineHeight: 19,
  },
  input: {
    minHeight: 50,
    marginTop: 18,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    color: colors.ink,
    backgroundColor: colors.canvas,
    fontSize: 15,
    fontWeight: '600',
  },
  error: {
    marginTop: 9,
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  secondaryAction: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    backgroundColor: colors.surface,
  },
  secondaryText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  primaryAction: {
    minWidth: 104,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 13,
    backgroundColor: colors.brand,
  },
  primaryText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  disabled: {
    opacity: 0.48,
  },
});
