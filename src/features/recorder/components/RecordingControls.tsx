import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../config/theme';
import type { RecorderPhase } from '../recorder.types';
import { RecordingTimer } from './RecordingTimer';
import { RecordingVisualizer } from './RecordingVisualizer';

interface RecordingControlsProps {
  durationMillis: number;
  isRecording: boolean;
  metering: number | null;
  onToggle: () => Promise<void>;
  phase: RecorderPhase;
}

const phaseLabels: Record<RecorderPhase, string> = {
  idle: 'Ready to record', starting: 'Opening microphone', recording: 'Recording',
  stopping: 'Saving audio', error: 'Needs attention',
};

export function RecordingControls({ durationMillis, isRecording, metering, onToggle, phase }: RecordingControlsProps) {
  const isBusy = phase === 'starting' || phase === 'stopping';
  const buttonLabel = phase === 'starting' ? 'Starting…' : phase === 'stopping' ? 'Saving…'
    : isRecording ? 'Stop & Save' : 'Start Recording';

  return (
    <View style={[styles.card, isRecording && styles.activeCard]}>
      <View style={styles.topRow}>
        <Text style={styles.eyebrow}>VOICE CAPTURE</Text>
        <View style={[styles.statePill, (isRecording || phase === 'error') && styles.activePill]}>
          <View style={[styles.stateDot, (isRecording || phase === 'error') && styles.activeDot]} />
          <Text accessibilityLiveRegion="polite" style={[styles.stateText, (isRecording || phase === 'error') && styles.activeText]}>{phaseLabels[phase]}</Text>
        </View>
      </View>
      <View style={styles.timerBlock}>
        <RecordingTimer durationMillis={durationMillis} isRecording={isRecording} />
        <Text style={styles.timerCaption}>{isRecording ? 'Capturing your conversation' : phase === 'stopping' ? 'Securing your original audio' : 'Ready for a new voice note'}</Text>
      </View>
      <RecordingVisualizer isRecording={isRecording} metering={metering} />
      <Pressable
        accessibilityLabel={buttonLabel}
        accessibilityHint={isRecording ? 'Stops capture and saves the original audio to your library' : 'Starts microphone recording'}
        accessibilityRole="button"
        accessibilityState={{ busy: isBusy, disabled: isBusy }}
        disabled={isBusy}
        onPress={() => { void onToggle(); }}
        style={({ pressed }) => [styles.control, pressed && styles.pressed, isBusy && styles.busy]}
      >
        <View style={[styles.controlRing, isRecording && styles.activeRing]}>
          <View style={[styles.controlCore, isRecording && styles.stopControl]}>
            {isBusy ? <ActivityIndicator color={colors.white} /> : <View style={[styles.mark, isRecording && styles.stopMark]} />}
          </View>
        </View>
        <Text style={styles.controlLabel}>{buttonLabel}</Text>
      </Pressable>
      <View style={styles.footer}>
        <View style={styles.footerDot} />
        <Text style={styles.footerText}>Original audio · Saved on this device</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', padding: 20, borderWidth: 1, borderColor: colors.border, borderRadius: 28, backgroundColor: colors.surface, shadowColor: colors.ink, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.035, shadowRadius: 16, elevation: 2 },
  activeCard: { borderColor: '#EAC5B4' },
  topRow: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eyebrow: { color: colors.mutedInk, fontSize: 9, fontWeight: '700', letterSpacing: 1.3 },
  statePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 9, borderRadius: 20, backgroundColor: colors.sageSoft },
  activePill: { backgroundColor: colors.accentSoft },
  stateDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.brand },
  activeDot: { backgroundColor: colors.accentBright },
  stateText: { color: colors.brand, fontSize: 10, fontWeight: '600' },
  activeText: { color: colors.accent },
  timerBlock: { alignItems: 'center', marginTop: 16 },
  timerCaption: { color: colors.mutedInk, fontSize: 12, lineHeight: 18, marginTop: 5, textAlign: 'center' },
  control: { alignItems: 'center', paddingHorizontal: 20, paddingBottom: 4 },
  controlRing: { width: 82, height: 82, borderRadius: 41, borderWidth: 1, borderColor: '#EFD6C8', padding: 6 },
  activeRing: { borderColor: colors.accentBright },
  controlCore: { flex: 1, borderRadius: 40, backgroundColor: colors.accentBright, alignItems: 'center', justifyContent: 'center' },
  stopControl: { backgroundColor: colors.ink },
  mark: { width: 23, height: 23, borderRadius: 12, backgroundColor: colors.white },
  stopMark: { borderRadius: 5 },
  controlLabel: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 10 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.97 }] },
  busy: { opacity: 0.65 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderColor: colors.border, width: '100%', justifyContent: 'center' },
  footerDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.brand },
  footerText: { color: colors.mutedInk, fontSize: 10, flexShrink: 1 },
});
