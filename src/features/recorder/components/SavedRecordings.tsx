import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { LineIcon } from '../../../components/LineIcon';
import { colors } from '../../../config/theme';
import { formatDuration, formatRecordingDate } from '../recorder.service';
import { filterRecordings, hasRecordingTranscript, recordingNeedsAttention, recordingTranscriptLabel, type RecordingFilter } from '../recording-library.model';
import type { RecordingPlaybackPhase } from '../playback';
import type { SavedRecording } from '../recorder.types';

interface SavedRecordingsProps {
  activeRecordingId: string | null;
  isLoading: boolean;
  onOpenRecording: (recordingId: string) => void;
  onNewRecording: () => void;
  playbackPhase: RecordingPlaybackPhase;
  recordings: SavedRecording[];
  query: string;
  filter: RecordingFilter;
  onQueryChange: (query: string) => void;
  onFilterChange: (filter: RecordingFilter) => void;
  onResetFilters: () => void;
}

export function SavedRecordings({ activeRecordingId, isLoading, onOpenRecording, onNewRecording,
  playbackPhase, recordings, query, filter, onQueryChange, onFilterChange, onResetFilters }: SavedRecordingsProps) {
  const visible = useMemo(() => filterRecordings(recordings, query, filter), [recordings, query, filter]);
  const filters: { id: RecordingFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: recordings.length },
    { id: 'transcript', label: 'With text', count: recordings.filter(hasRecordingTranscript).length },
    { id: 'attention', label: 'Needs attention', count: recordings.filter(recordingNeedsAttention).length },
  ];

  return (
    <View>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>YOUR FIELD LIBRARY</Text>
          <Text accessibilityRole="header" style={styles.title}>Saved recordings</Text>
        </View>
        <View accessibilityLabel={`${recordings.length} saved recordings`} style={styles.countBadge}>
          <Text style={styles.countText}>{isLoading ? '…' : recordings.length}</Text>
        </View>
      </View>
      <Text style={styles.subtitle}>Revisit the conversation. Find the next step.</Text>

      <View style={styles.search}>
        <LineIcon name="search" color={colors.mutedInk} />
        <TextInput
          accessibilityLabel="Search recordings"
          autoCapitalize="none" autoCorrect={false} returnKeyType="search"
          placeholder="Search titles, dates or transcripts"
          placeholderTextColor={colors.mutedInk}
          onChangeText={onQueryChange} value={query} style={styles.searchInput}
        />
        {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onQueryChange('')} style={styles.clearSearch}><LineIcon name="close" color={colors.mutedInk} /></Pressable> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} keyboardShouldPersistTaps="handled">
        {filters.map(item => <Pressable
          key={item.id} accessibilityRole="button" accessibilityState={{ selected: filter === item.id }}
          onPress={() => onFilterChange(item.id)}
          style={({ pressed }) => [styles.filter, filter === item.id && styles.selectedFilter, pressed && styles.pressed]}
        >
          <Text style={[styles.filterLabel, filter === item.id && styles.selectedFilterLabel]}>{item.label} {item.count}</Text>
        </Pressable>)}
      </ScrollView>

      {isLoading ? <View style={styles.emptyCard}><ActivityIndicator color={colors.brand} /><Text style={styles.emptyTitle}>Loading recordings…</Text></View>
        : recordings.length === 0 ? <View style={styles.emptyCard}>
          <View style={styles.emptyMark}><LineIcon name="mic" color={colors.accent} /></View>
          <Text style={styles.emptyTitle}>Your next conversation starts here</Text>
          <Text style={styles.emptyBody}>Record a walkthrough, a client call or a quick thought. Your saved audio will be here when you need it.</Text>
          <Pressable accessibilityRole="button" onPress={onNewRecording} style={styles.emptyAction}><Text style={styles.emptyActionText}>Make a recording</Text><LineIcon name="arrow" color={colors.white} /></Pressable>
        </View>
          : visible.length === 0 ? <View style={styles.emptyCard}>
            <LineIcon name="search" color={colors.mutedInk} />
            <Text style={styles.emptyTitle}>No matching recordings</Text>
            <Text style={styles.emptyBody}>Try a different phrase or show all your recordings.</Text>
            <Pressable accessibilityRole="button" onPress={onResetFilters} style={styles.resetAction}><Text style={styles.resetText}>Clear search & filters</Text></Pressable>
          </View>
            : <View style={styles.list}>
              <Text accessibilityLiveRegion="polite" style={styles.results}>{query || filter !== 'all' ? `${visible.length} results · Newest first` : 'NEWEST FIRST'}</Text>
              {visible.map(recording => {
                const isActive = recording.id === activeRecordingId && playbackPhase !== 'idle';
                const playbackLabel = !isActive ? null : playbackPhase === 'playing' ? 'Playing'
                  : playbackPhase === 'loading' ? 'Loading audio' : playbackPhase === 'completed' ? 'Playback finished'
                    : playbackPhase === 'error' ? 'Playback error' : 'Playback paused';
                const attention = recordingNeedsAttention(recording);
                return <Pressable
                  accessibilityHint="Opens playback, transcripts and Meeting Memory actions"
                  accessibilityRole="button" key={recording.id} onPress={() => onOpenRecording(recording.id)}
                  style={({ pressed }) => [styles.recordingCard, isActive && styles.activeRecordingCard, pressed && styles.pressed]}
                >
                  <View style={[styles.audioMark, isActive && styles.activeAudioMark]}>
                    {[10, 19, 25, 15].map((height, index) => <View key={index} style={[styles.waveBar, { height }, isActive && styles.activeWaveBar]} />)}
                  </View>
                  <View style={styles.recordingDetails}>
                    <Text numberOfLines={2} style={styles.recordingTitle}>{recording.title}</Text>
                    <Text style={styles.recordingDate}>{formatRecordingDate(recording.createdAt)}</Text>
                    <View style={styles.metadata}>
                      <Text style={styles.duration}>{formatDuration(recording.durationMillis)}</Text>
                      <View style={[styles.transcriptBadge, attention && styles.attentionBadge]}>
                        <Text style={[styles.transcriptText, attention && styles.attentionText]}>{recordingTranscriptLabel(recording)}</Text>
                      </View>
                    </View>
                    {playbackLabel ? <Text style={styles.playbackState}>{playbackLabel}</Text> : null}
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </Pressable>;
              })}
              <Text style={styles.libraryNote}>Audio stays on this device. Open a recording to review its transcript or add it to Meeting Memory.</Text>
            </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headingCopy: { flex: 1 },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  title: { marginTop: 7, color: colors.ink, fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { color: colors.mutedInk, fontSize: 13, lineHeight: 20, marginTop: 8, marginBottom: 22 },
  countBadge: { minWidth: 38, minHeight: 38, padding: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.subduedSurface },
  countText: { color: colors.ink, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  search: { flexDirection: 'row', alignItems: 'center', paddingLeft: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, minHeight: 50 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 50, paddingHorizontal: 10, color: colors.ink, fontSize: 13 },
  clearSearch: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 7, paddingTop: 12, paddingBottom: 19 },
  filter: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  selectedFilter: { backgroundColor: colors.ink, borderColor: colors.ink },
  filterLabel: { color: colors.mutedInk, fontSize: 12, fontWeight: '600' },
  selectedFilterLabel: { color: colors.white },
  emptyCard: { alignItems: 'center', paddingHorizontal: 22, paddingVertical: 30, borderWidth: 1, borderColor: colors.border, borderRadius: 24, backgroundColor: colors.surface },
  emptyMark: { width: 54, height: 54, borderRadius: 18, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 16, color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  emptyBody: { marginTop: 9, color: colors.mutedInk, fontSize: 13, lineHeight: 21, textAlign: 'center' },
  emptyAction: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 48, marginTop: 22, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.brand },
  emptyActionText: { color: colors.white, fontSize: 13, fontWeight: '600' },
  resetAction: { minHeight: 48, justifyContent: 'center', marginTop: 12 },
  resetText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  list: { gap: 10 },
  results: { color: colors.mutedInk, fontSize: 9, letterSpacing: 1, marginBottom: 2 },
  recordingCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 19, backgroundColor: colors.surface },
  activeRecordingCard: { borderColor: colors.accentBright, backgroundColor: '#FFFCFA' },
  audioMark: { width: 40, height: 44, flexDirection: 'row', gap: 3, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.subduedSurface },
  activeAudioMark: { backgroundColor: colors.accentBright },
  waveBar: { width: 3, borderRadius: 2, backgroundColor: colors.mutedInk },
  activeWaveBar: { backgroundColor: colors.white },
  recordingDetails: { flex: 1, minWidth: 0 },
  recordingTitle: { color: colors.ink, fontSize: 14, fontWeight: '600', lineHeight: 20 },
  recordingDate: { marginTop: 4, color: colors.mutedInk, fontSize: 11, lineHeight: 16 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 9 },
  duration: { color: colors.mutedInk, fontSize: 10, fontWeight: '600', fontVariant: ['tabular-nums'] },
  transcriptBadge: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6, backgroundColor: colors.sageSoft },
  transcriptText: { color: colors.brand, fontSize: 9, fontWeight: '600' },
  attentionBadge: { backgroundColor: colors.accentSoft },
  attentionText: { color: colors.accent },
  playbackState: { color: colors.accent, fontSize: 10, fontWeight: '700', marginTop: 8 },
  chevron: { color: colors.mutedInk, fontSize: 24 },
  libraryNote: { color: colors.mutedInk, fontSize: 11, lineHeight: 18, textAlign: 'center', padding: 14 },
  pressed: { opacity: 0.7 },
});
