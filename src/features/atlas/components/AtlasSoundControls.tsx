import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../config/theme';
import { animalSoundActions, type AnimalSoundId } from '../atlas.assets';
import { AtlasButton } from './AtlasButton';

interface AtlasSoundControlsProps {
  activeSoundId: AnimalSoundId | null;
  disabled: boolean;
  onSelectSound: (soundId: AnimalSoundId) => void;
}

export function AtlasSoundControls({
  activeSoundId,
  disabled,
  onSelectSound,
}: AtlasSoundControlsProps) {
  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>ASK ATLAS</Text>
          <Text style={styles.title}>Quick responses</Text>
        </View>
        <Text style={styles.hint}>LOCAL AUDIO</Text>
      </View>
      <View style={styles.grid}>
        {animalSoundActions.map((sound) => (
          <AtlasButton
            disabled={disabled}
            isActive={sound.id === activeSoundId}
            key={sound.id}
            label={sound.label}
            onPress={() => onSelectSound(sound.id)}
            sequence={sound.sequence}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  title: {
    marginTop: 3,
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
  },
  hint: {
    color: colors.mutedInk,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
});
