import type { ImageSourcePropType } from 'react-native';

interface AtlasAssets {
  avatar: ImageSourcePropType | null;
}

export const atlasAssets: AtlasAssets = {
  avatar: require('../../../assets/atlas/founder.png') as ImageSourcePropType,
};

export type AnimalSoundId = 'moo' | 'oink' | 'rooster' | 'bark';

export interface AnimalSoundAction {
  id: AnimalSoundId;
  label: string;
  sequence: string;
  source: number;
}

export const ATLAS_SOUNDS = {
  moo: require('../../../assets/atlas/moo.mp3') as number,
  oink: require('../../../assets/atlas/oink.mp3') as number,
  rooster: require('../../../assets/atlas/rooster.mp3') as number,
  bark: require('../../../assets/atlas/bark.mp3') as number,
} as const satisfies Record<AnimalSoundId, number>;

export const animalSoundActions: readonly AnimalSoundAction[] = [
  { id: 'moo', label: 'Moo', sequence: '01', source: ATLAS_SOUNDS.moo },
  { id: 'oink', label: 'Oink', sequence: '02', source: ATLAS_SOUNDS.oink },
  { id: 'rooster', label: 'Rooster', sequence: '03', source: ATLAS_SOUNDS.rooster },
  { id: 'bark', label: 'Bark', sequence: '04', source: ATLAS_SOUNDS.bark },
];
