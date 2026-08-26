import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../config/theme';
import { formatDuration, formatRecordingDate } from '../recorder.service';
import type { RecordingPlaybackPhase } from '../playback';
import type { SavedRecording } from '../recorder.types';

interface SavedRecordingsProps {
  activeRecordingId: string | null;
  isLoading: boolean;
  onOpenRecording: (recordingId: string) => void;
  playbackPhase: RecordingPlaybackPhase;
  recordings: SavedRecording[];
}

export function SavedRecordings({
  activeRecordingId,
  isLoading,
  onOpenRecording,
  playbackPhase,
  recordings,
}: SavedRecordingsProps) {
  return (
    <View style={styles.section}>
      <View style={styles.headingRow}>
        <View>
          <Text style={styles.eyebrow}>LOCAL LIBRARY</Text>
          <Text style={styles.title}>Saved Recordings</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{recordings.length}</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>Loading recordings…</Text>
        </View>
      ) : recordings.length === 0 ? (
        <View style={styles.emptyCard}>
          <View style={styles.emptyMark}>
            <View style={styles.emptyLineWide} />
            <View style={styles.emptyLine} />
            <View style={styles.emptyLineShort} />
          </View>
          <Text style={styles.emptyTitle}>No saved recordings yet</Text>
          <Text style={styles.emptyBody}>
            Completed field recordings will appear here and remain available after the app restarts.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {recordings.map((recording, index) => {
            const isActive = recording.id === activeRecordingId;
            const playbackLabel = isActive
              ? playbackPhase === 'playing'
                ? 'PLAYING'
                : playbackPhase === 'loading'
                  ? 'LOADING'
                  : playbackPhase === 'completed'
                    ? 'FINISHED'
                    : playbackPhase === 'error'
                      ? 'PLAYBACK ERROR'
                      : 'PAUSED'
              : null;

            return (
              <Pressable
                accessibilityHint="Opens recording playback and actions"
                accessibilityRole="button"
                key={recording.id}
                onPress={() => onOpenRecording(recording.id)}
                style={({ pressed }) => [
                  styles.recordingCard,
                  isActive && styles.activeRecordingCard,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.sequenceBadge, isActive && styles.activeSequenceBadge]}>
                  <Text style={[styles.sequenceText, isActive && styles.activeSequenceText]}>
                    {String(index + 1).padStart(2, '0')}
                  </Text>
                </View>
                <View style={styles.recordingDetails}>
                  <Text numberOfLines={2} style={styles.recordingTitle}>
                    {recording.title}
                  </Text>
                  <Text style={styles.recordingDate}>
                    {formatRecordingDate(recording.createdAt)}
                  </Text>
                  {playbackLabel ? (
                    <View style={styles.playbackStateRow}>
                      <View
                        style={[
                          styles.playbackDot,
                          playbackPhase === 'playing' && styles.playingDot,
                        ]}
                      />
                      <Text style={styles.playbackState}>{playbackLabel}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.trailing}>
                  <Text style={styles.duration}>{formatDuration(recording.durationMillis)}</Text>
                  <Text style={styles.chevron}>›</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 28,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 13,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    marginTop: 4,
    color: colors.ink,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  countBadge: {
    minWidth: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.subduedSurface,
  },
  countText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '900',
  },
  emptyCard: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  emptyMark: {
    width: 48,
    height: 48,
    justifyContent: 'center',
    gap: 5,
    padding: 10,
    borderRadius: 15,
    backgroundColor: colors.subduedSurface,
  },
  emptyLineWide: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.brand,
  },
  emptyLine: {
    width: '76%',
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  emptyLineShort: {
    width: '52%',
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  emptyTitle: {
    marginTop: 13,
    color: colors.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  emptyBody: {
    maxWidth: 300,
    marginTop: 7,
    color: colors.mutedInk,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  list: {
    gap: 10,
  },
  recordingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 13,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 17,
    backgroundColor: colors.surface,
  },
  activeRecordingCard: {
    borderColor: colors.accent,
  },
  sequenceBadge: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: colors.subduedSurface,
  },
  sequenceText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
  },
  activeSequenceBadge: {
    backgroundColor: colors.brand,
  },
  activeSequenceText: {
    color: colors.white,
  },
  recordingDetails: {
    flex: 1,
    marginHorizontal: 11,
  },
  recordingTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  recordingDate: {
    marginTop: 4,
    color: colors.mutedInk,
    fontSize: 11,
  },
  playbackStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  playbackDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  playingDot: {
    backgroundColor: colors.brand,
  },
  playbackState: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  duration: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    color: colors.accent,
    fontSize: 22,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.68,
  },
});
