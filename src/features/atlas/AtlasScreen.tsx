import {
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AppHeader } from '../../components/AppHeader';
import { Screen } from '../../components/Screen';
import { colors } from '../../config/theme';
import { useRecorder } from '../recorder';
import { useAnimalSounds } from './AnimalSoundProvider';
import { atlasAssets } from './atlas.assets';
import { AtlasAvatar } from './components/AtlasAvatar';
import { AtlasSoundControls } from './components/AtlasSoundControls';

export function AtlasScreen() {
  const { height } = useWindowDimensions();
  const { isRecording } = useRecorder();
  const {
    activeSoundId,
    errorMessage,
    isPlaybackEnabled,
    isSoundActive,
    playSound,
  } = useAnimalSounds();
  const isCompact = height < 720;

  const statusMessage = errorMessage
    ? errorMessage
    : isRecording
      ? 'Sound responses are paused while Voice Recorder is active.'
      : isSoundActive
        ? 'Atlas is responding with the selected local audio.'
        : 'Your RealTorch AI agent is ready.';

  return (
    <Screen>
      <ScrollView
        alwaysBounceVertical={false}
        contentContainerStyle={[styles.content, isCompact && styles.compactContent]}
        showsVerticalScrollIndicator={false}
      >
        <AppHeader badge="PROOF OF CONCEPT" product="ATLAS MOBILE" />

        <View style={[styles.hero, isCompact && styles.compactHero]}>
          <AtlasAvatar isActive={isSoundActive} source={atlasAssets.avatar} />

          <View style={styles.identity}>
            <Text style={styles.eyebrow}>REAL ESTATE INTELLIGENCE</Text>
            <Text style={styles.title}>Atlas</Text>
            <Text style={styles.subtitle}>
              A focused mobile home for the RealTorch Atlas AI agent.
            </Text>
          </View>
        </View>

        <View style={styles.actionArea}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusIndicator,
                isSoundActive && styles.playingIndicator,
                errorMessage && styles.errorIndicator,
                isRecording && styles.recordingIndicator,
              ]}
            />
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.statusText, errorMessage && styles.errorText]}
            >
              {statusMessage}
            </Text>
          </View>
          <AtlasSoundControls
            activeSoundId={activeSoundId}
            disabled={isRecording || !isPlaybackEnabled}
            onSelectSound={(soundId) => {
              void playSound(soundId);
            }}
          />
          <Text style={styles.helperText}>
            Only one response plays at a time. Recording always takes priority.
          </Text>
        </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 22,
  },
  compactContent: {
    paddingTop: 12,
    paddingBottom: 16,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 22,
  },
  compactHero: {
    paddingVertical: 16,
  },
  identity: {
    alignItems: 'center',
    marginTop: 20,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  title: {
    marginTop: 6,
    color: colors.ink,
    fontSize: 44,
    fontWeight: '700',
    letterSpacing: -1.6,
  },
  subtitle: {
    maxWidth: 320,
    marginTop: 6,
    color: colors.mutedInk,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  actionArea: {
    width: '100%',
  },
  statusRow: {
    minHeight: 25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 12,
  },
  statusIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  playingIndicator: {
    backgroundColor: colors.brand,
  },
  recordingIndicator: {
    backgroundColor: colors.danger,
  },
  errorIndicator: {
    backgroundColor: colors.danger,
  },
  statusText: {
    flexShrink: 1,
    color: colors.mutedInk,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
  },
  helperText: {
    marginTop: 11,
    color: colors.mutedInk,
    fontSize: 11,
    textAlign: 'center',
  },
});
