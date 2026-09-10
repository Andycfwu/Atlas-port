import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LineIcon } from '../../components/LineIcon';
import { Screen } from '../../components/Screen';
import { colors } from '../../config/theme';
import { MicrophonePermissionCard } from './components/MicrophonePermissionCard';
import { LiveTranscriptDraft } from './components/LiveTranscriptDraft';
import { RecordingControls } from './components/RecordingControls';
import { RecorderIntegrityPanel } from './components/RecorderIntegrityPanel';
import { SavedRecordings } from './components/SavedRecordings';
import { useRecordingPlayer } from './playback';
import { useRecorder } from './RecorderProvider';
import { formatDuration } from './recorder.service';
import type { RecorderViewState } from './recording-library.model';
import { RecordingModeChoice } from './live-speakers/RecordingModeChoice';
import { LiveSpeakerPanel } from './live-speakers/LiveSpeakerPanel';

interface RecorderScreenProps {
  onOpenRecording: (recordingId: string) => void;
  onOpenMeetingMemory: () => void;
  viewState: RecorderViewState;
  onViewStateChange: (state: RecorderViewState) => void;
}

export function RecorderScreen({ onOpenRecording, onOpenMeetingMemory, viewState, onViewStateChange }: RecorderScreenProps) {
  const {
    clearError, durationMillis, errorMessage, integrityModeEnabled, integrityResults,
    integrityTestRunning, isLoadingRecordings, isRecording, liveTranscription, metering,
    openSettings, permissionState, phase, recordings, requestPermission,
    runProductionIntegrityTest, runRawIntegrityTest, saveIntegrityResultToLibrary,
    startRecording, stopRecording, liveProvider, selectLiveProvider,
  } = useRecorder();
  const { activeRecordingId, phase: playbackPhase } = useRecordingPlayer();
  const captureActive = isRecording || phase === 'starting' || phase === 'stopping';
  const selectTab = (tab: RecorderViewState['tab']) => { Keyboard.dismiss(); onViewStateChange({ ...viewState, tab }); };

  return (
    <Screen>
      <ScrollView
        key={viewState.tab}
        alwaysBounceVertical={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {errorMessage ? <View style={styles.errorCard}>
          <View style={styles.errorCopy}><Text style={styles.errorTitle}>Recorder notice</Text><Text accessibilityRole="alert" style={styles.errorBody}>{errorMessage}</Text></View>
          <Pressable accessibilityRole="button" onPress={clearError} style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}><Text style={styles.dismissText}>Dismiss</Text></Pressable>
        </View> : null}
        {viewState.tab === 'record' ? <>
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>REALTORCH · ATLAS</Text>
            <Text accessibilityRole="header" style={styles.title}>Keep the details.</Text>
            <Text style={styles.subtitle}>Walkthroughs, client conversations, and the ideas worth coming back to.</Text>
          </View>
          <RecordingModeChoice provider={liveProvider} onSelect={selectLiveProvider} disabled={captureActive} />
          <RecordingControls durationMillis={durationMillis} isRecording={isRecording} metering={metering}
            onToggle={isRecording ? stopRecording : startRecording} phase={phase} />
          <MicrophonePermissionCard onOpenSettings={openSettings} onRequestPermission={requestPermission} permissionState={permissionState} />
          {liveProvider === 'deepgram' ? <LiveSpeakerPanel snapshot={liveTranscription.speakerSnapshot} status={liveTranscription.status} error={liveTranscription.errorMessage} /> : <LiveTranscriptDraft state={liveTranscription} />}
          <Pressable accessibilityRole="button" accessibilityLabel="Open Meeting Memory" onPress={onOpenMeetingMemory}
            style={({ pressed }) => [styles.memoryCard, pressed && styles.pressed]}>
            <View style={styles.memoryMark}><LineIcon name="chat" color={colors.brand} /></View>
            <View style={styles.memoryCopy}>
              <Text style={styles.memoryTitle}>From conversation to next steps</Text>
              <Text style={styles.memoryBody}>Add a saved transcript to Meeting Memory to explore decisions and follow-ups.</Text>
              <Text style={styles.memoryLink}>Explore Meeting Memory →</Text>
            </View>
          </Pressable>
          <Text style={styles.backgroundNote}>Keep the app open for live text. Recording continues as you move around Atlas.</Text>
        </> : <>
          {captureActive ? <Pressable accessibilityRole="button" accessibilityLabel="Return to active recording" onPress={() => selectTab('record')} style={styles.activeBanner}>
            <View style={styles.activeDot} />
            <View style={styles.activeCopy}><Text style={styles.activeTitle}>{phase === 'starting' ? 'Opening microphone…' : phase === 'stopping' ? 'Saving your recording…' : 'Recording in progress'}</Text><Text style={styles.activeBody}>Return to recorder →</Text></View>
            <Text style={styles.activeTime}>{formatDuration(durationMillis)}</Text>
          </Pressable> : null}
          <SavedRecordings activeRecordingId={activeRecordingId} isLoading={isLoadingRecordings}
            onOpenRecording={onOpenRecording} onNewRecording={() => selectTab('record')}
            playbackPhase={playbackPhase} recordings={recordings} query={viewState.query} filter={viewState.filter}
            onQueryChange={query => onViewStateChange({ ...viewState, query })}
            onResetFilters={() => onViewStateChange({ ...viewState, query: '', filter: 'all' })}
            onFilterChange={filter => onViewStateChange({ ...viewState, filter })} />
        </>}

        {integrityModeEnabled ? <RecorderIntegrityPanel onRunProduction={runProductionIntegrityTest} onRunRaw={runRawIntegrityTest}
          onSaveToLibrary={saveIntegrityResultToLibrary} results={integrityResults} runningTest={integrityTestRunning} /> : null}
      </ScrollView>

      <View style={styles.dockArea}>
        <View accessibilityRole="tablist" style={styles.dock}>
          <Pressable accessibilityRole="tab" accessibilityLabel={captureActive ? 'Record, capture active' : 'Record'}
            accessibilityState={{ selected: viewState.tab === 'record' }} onPress={() => selectTab('record')}
            style={({ pressed }) => [styles.tab, viewState.tab === 'record' && styles.selectedTab, pressed && styles.pressed]}>
            <LineIcon name="mic" color={viewState.tab === 'record' ? colors.white : colors.mutedInk} />
            <Text style={[styles.tabText, viewState.tab === 'record' && styles.selectedTabText]}>Record</Text>
            {captureActive ? <View style={styles.activeDot} /> : null}
          </Pressable>
          <Pressable accessibilityRole="tab" accessibilityLabel={`Library, ${recordings.length} recordings`}
            accessibilityState={{ selected: viewState.tab === 'library' }} onPress={() => selectTab('library')}
            style={({ pressed }) => [styles.tab, viewState.tab === 'library' && styles.selectedTab, pressed && styles.pressed]}>
            <LineIcon name="folder" color={viewState.tab === 'library' ? colors.white : colors.mutedInk} />
            <Text style={[styles.tabText, viewState.tab === 'library' && styles.selectedTabText]}>Library</Text>
            <View style={[styles.tabCount, viewState.tab === 'library' && styles.selectedCount]}><Text style={[styles.countText, viewState.tab === 'library' && styles.selectedTabText]}>{isLoadingRecordings ? '…' : recordings.length}</Text></View>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16 },
  intro: { marginBottom: 22 },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 1.5 },
  title: { marginTop: 8, color: colors.ink, fontSize: 32, fontWeight: '700', letterSpacing: -1 },
  subtitle: { maxWidth: 380, marginTop: 8, color: colors.mutedInk, fontSize: 13, lineHeight: 21 },
  memoryCard: { flexDirection: 'row', gap: 12, padding: 17, borderRadius: 20, backgroundColor: colors.sageSoft, marginTop: 16 },
  memoryMark: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#DAE6DA', alignItems: 'center', justifyContent: 'center' },
  memoryCopy: { flex: 1 },
  memoryTitle: { color: colors.brand, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  memoryBody: { color: colors.mutedInk, fontSize: 11, lineHeight: 17, marginTop: 4 },
  memoryLink: { color: colors.brand, fontSize: 11, fontWeight: '700', marginTop: 10 },
  backgroundNote: { marginTop: 14, paddingHorizontal: 12, color: colors.mutedInk, fontSize: 10, lineHeight: 16, textAlign: 'center' },
  dockArea: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10, backgroundColor: colors.canvas },
  dock: { width: '100%', maxWidth: 380, alignSelf: 'center', flexDirection: 'row', padding: 5, gap: 5, borderRadius: 25, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, shadowColor: colors.ink, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.04, shadowRadius: 10, elevation: 3 },
  tab: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 20 },
  selectedTab: { backgroundColor: colors.ink },
  tabText: { color: colors.mutedInk, fontSize: 13, fontWeight: '600', flexShrink: 1 },
  selectedTabText: { color: colors.white },
  tabCount: { minWidth: 23, paddingHorizontal: 5, paddingVertical: 3, alignItems: 'center', borderRadius: 8, backgroundColor: colors.subduedSurface },
  selectedCount: { backgroundColor: '#3E4A45' },
  countText: { color: colors.mutedInk, fontSize: 10, fontWeight: '700' },
  activeBanner: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 14, borderRadius: 16, backgroundColor: colors.accentSoft, marginBottom: 20 },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accentBright },
  activeCopy: { flex: 1 },
  activeTitle: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  activeBody: { color: colors.accent, fontSize: 10, marginTop: 4 },
  activeTime: { color: colors.accent, fontSize: 12, fontVariant: ['tabular-nums'] },
  errorCard: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, padding: 14, borderRadius: 17, backgroundColor: colors.dangerSoft },
  errorCopy: { flex: 1 },
  errorTitle: { color: colors.danger, fontSize: 12, fontWeight: '700' },
  errorBody: { marginTop: 3, color: colors.ink, fontSize: 12, lineHeight: 18 },
  dismiss: { marginLeft: 10, paddingHorizontal: 10, minHeight: 44, justifyContent: 'center', borderRadius: 9, backgroundColor: colors.surface },
  dismissText: { color: colors.danger, fontSize: 11, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
