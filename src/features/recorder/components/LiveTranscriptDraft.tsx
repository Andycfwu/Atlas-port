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
  idle: 'READY',
  paused: 'PAUSED',
  streaming: 'LIVE',
};

export function LiveTranscriptDraft({ state }: LiveTranscriptDraftProps) {
  const body = state.draft
    ? state.draft
    : state.status === 'idle'
      ? 'Your words will appear here as you record. After saving, review the transcript alongside the original audio.'
    : state.status === 'connecting'
      ? 'Connecting to Atlas transcription…'
      : state.status === 'paused'
        ? 'Live text paused in the background. Save this recording before starting another.'
        : state.status === 'failed'
          ? (state.errorMessage ?? 'Live transcript unavailable. Use saved-file transcription after saving.')
          : state.status === 'finishing'
            ? 'Waiting for final live words before saving…'
          : state.status === 'completed'
            ? 'No live words were received. Transcribe the saved audio instead.'
          : 'Listening for speech…';

  return (
    <View style={styles.card}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>LIVE TRANSCRIPTION</Text>
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
        <Text accessibilityLiveRegion="polite" selectable style={styles.draftText}>
          {body}
        </Text>
      </ScrollView>
      {state.draft && state.errorMessage ? <Text accessibilityRole="alert" style={styles.failureMessage}>{state.errorMessage}</Text> : null}
      <Text style={styles.disclaimer}>
        {state.status === 'idle' ? 'Live text needs a connection. Audio is saved on this device.' : 'Provisional text · Saved separately from the saved-audio transcript.'}
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
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  eyebrow: {
    color: colors.mutedInk,
    fontSize: 9,
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
    fontSize: 10,
    lineHeight: 16,
  },
  failureMessage: {
    marginTop: 12,
    color: colors.danger,
    fontSize: 13,
    lineHeight: 20,
  },
});
