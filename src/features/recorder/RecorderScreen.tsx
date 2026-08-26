import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '../../components/AppHeader';
import { Screen } from '../../components/Screen';
import { colors } from '../../config/theme';
import { MicrophonePermissionCard } from './components/MicrophonePermissionCard';
import { RecordingControls } from './components/RecordingControls';
import { RecorderIntegrityPanel } from './components/RecorderIntegrityPanel';
import { SavedRecordings } from './components/SavedRecordings';
import { useRecordingPlayer } from './playback';
import { useRecorder } from './RecorderProvider';

interface RecorderScreenProps {
  onOpenRecording: (recordingId: string) => void;
}

export function RecorderScreen({ onOpenRecording }: RecorderScreenProps) {
  const {
    clearError,
    durationMillis,
    errorMessage,
    integrityModeEnabled,
    integrityResults,
    integrityTestRunning,
    isLoadingRecordings,
    isRecording,
    metering,
    openSettings,
    permissionState,
    phase,
    recordings,
    requestPermission,
    runProductionIntegrityTest,
    runRawIntegrityTest,
    saveIntegrityResultToLibrary,
    startRecording,
    stopRecording,
  } = useRecorder();
  const { activeRecordingId, phase: playbackPhase } = useRecordingPlayer();

  return (
    <Screen>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader
          badge={isRecording ? 'RECORDING' : 'FIELD TOOL'}
          isRecording={isRecording}
          product="ATLAS MOBILE"
        />

        <View style={styles.intro}>
          <Text style={styles.eyebrow}>ATLAS FIELD CAPTURE</Text>
          <Text style={styles.title}>Voice Recorder</Text>
          <Text style={styles.subtitle}>
            Capture durable voice notes in the field. Audio remains the source of truth.
          </Text>
        </View>

        <RecordingControls
          durationMillis={durationMillis}
          isRecording={isRecording}
          metering={metering}
          onToggle={isRecording ? stopRecording : startRecording}
          phase={phase}
        />

        {integrityModeEnabled ? (
          <RecorderIntegrityPanel
            onRunProduction={runProductionIntegrityTest}
            onRunRaw={runRawIntegrityTest}
            onSaveToLibrary={saveIntegrityResultToLibrary}
            results={integrityResults}
            runningTest={integrityTestRunning}
          />
        ) : null}

        {errorMessage ? (
          <View style={styles.errorCard}>
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>Recorder notice</Text>
              <Text style={styles.errorBody}>{errorMessage}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={clearError}
              style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </Pressable>
          </View>
        ) : null}

        <MicrophonePermissionCard
          onOpenSettings={openSettings}
          onRequestPermission={requestPermission}
          permissionState={permissionState}
        />

        <Text style={styles.backgroundNote}>
          Active recordings continue when you move between Atlas and Recorder. Native background
          recording also supports app switching and screen lock in a development or production build.
        </Text>

        <SavedRecordings
          activeRecordingId={activeRecordingId}
          isLoading={isLoadingRecordings}
          onOpenRecording={onOpenRecording}
          playbackPhase={playbackPhase}
          recordings={recordings}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 28,
  },
  intro: {
    marginTop: 30,
    marginBottom: 20,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.7,
  },
  title: {
    marginTop: 7,
    color: colors.ink,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1.3,
  },
  subtitle: {
    maxWidth: 390,
    marginTop: 9,
    color: colors.mutedInk,
    fontSize: 15,
    lineHeight: 22,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    padding: 14,
    borderRadius: 17,
    backgroundColor: colors.dangerSoft,
  },
  errorCopy: {
    flex: 1,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '900',
  },
  errorBody: {
    marginTop: 3,
    color: colors.ink,
    fontSize: 12,
    lineHeight: 18,
  },
  dismiss: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 9,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.68,
  },
  dismissText: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '800',
  },
  backgroundNote: {
    marginTop: 15,
    paddingHorizontal: 4,
    color: colors.mutedInk,
    fontSize: 11,
    lineHeight: 17,
    textAlign: 'center',
  },
});
