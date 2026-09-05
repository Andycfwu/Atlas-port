import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../config/theme';
import type { LiveTranscriptionState } from '../live';

interface LiveTranscriptDraftProps {
  state: LiveTranscriptionState;
}

const statusLabels: Record<LiveTranscriptionState['status'], string> = {
  completed: 'ENDED',
  finishing: 'FINISHING',
  connecting: 'CONNECTING',
  failed: 'UNAVAILABLE',
  idle: 'IDLE',
  paused: 'PAUSED',
  streaming: 'LIVE',
};

export function LiveTranscriptDraft({ state }: LiveTranscriptDraftProps) {
  if (state.status === 'idle') {
    return null;
  }

  const body = state.draft
    ? state.draft
    : state.status === 'connecting'
      ? 'Connecting to Atlas transcription…'
      : state.status === 'paused'
        ? 'Live draft paused in the background. The saved recording continues.'
        : state.status === 'failed'
          ? (state.errorMessage ?? 'Live transcript unavailable. Use saved-file transcription after saving.')
          : state.status === 'completed' || state.status === 'finishing'
            ? 'Use the saved recording for the final transcript.'
          : 'Listening for speech…';

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>PROVISIONAL TRANSCRIPT</Text>
          <Text style={styles.title}>Live draft</Text>
        </View>
        <View
          style={[
            styles.badge,
            state.status === 'failed' && styles.failureBadge,
          ]}
        >
          <Text
            style={[
              styles.badgeText,
              state.status === 'failed' && styles.failureBadgeText,
            ]}
          >
            {statusLabels[state.status]}
          </Text>
        </View>
      </View>
      <ScrollView nestedScrollEnabled style={styles.draftScroll}>
        <Text selectable style={styles.draftText}>
          {body}
        </Text>
      </ScrollView>
      {state.draft && state.errorMessage ? <Text style={styles.disclaimer}>{state.errorMessage}</Text> : null}
      <Text style={styles.disclaimer}>
        Draft only. The saved M4A transcript remains authoritative.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    padding: 17,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 21,
    backgroundColor: colors.surface,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.3,
  },
  title: {
    marginTop: 4,
    color: colors.ink,
    fontSize: 19,
    fontWeight: '800',
  },
  badge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
  },
  badgeText: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  failureBadge: {
    backgroundColor: colors.dangerSoft,
  },
  failureBadgeText: {
    color: colors.danger,
  },
  draftScroll: {
    maxHeight: 150,
    marginTop: 14,
    padding: 13,
    borderRadius: 14,
    backgroundColor: colors.canvas,
  },
  draftText: {
    paddingBottom: 13,
    color: colors.ink,
    fontSize: 13,
    lineHeight: 20,
  },
  disclaimer: {
    marginTop: 10,
    color: colors.mutedInk,
    fontSize: 9,
    lineHeight: 14,
  },
});
