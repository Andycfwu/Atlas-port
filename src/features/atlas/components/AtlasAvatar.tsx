import { useState } from 'react';
import {
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { colors } from '../../../config/theme';

interface AtlasAvatarProps {
  source: ImageSourcePropType | null;
  isActive: boolean;
}

export function AtlasAvatar({ source, isActive }: AtlasAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = source !== null && !imageFailed;

  return (
    <View
      accessibilityLabel={showImage ? 'Atlas avatar' : 'Atlas avatar placeholder'}
      style={[styles.frame, isActive && styles.activeFrame]}
    >
      {showImage ? (
        <Image
          onError={() => setImageFailed(true)}
          resizeMode="cover"
          source={source}
          style={styles.image}
        />
      ) : (
        <View style={styles.fallback}>
          <Text style={styles.fallbackText}>A</Text>
        </View>
      )}

      <View style={[styles.statusDot, isActive && styles.activeStatusDot]} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: 244,
    height: 244,
    padding: 7,
    borderRadius: 72,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 7,
  },
  activeFrame: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 65,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 65,
    backgroundColor: colors.brand,
  },
  fallbackText: {
    color: colors.white,
    fontSize: 88,
    fontWeight: '300',
  },
  statusDot: {
    position: 'absolute',
    right: 13,
    bottom: 17,
    width: 25,
    height: 25,
    borderRadius: 13,
    borderWidth: 5,
    borderColor: colors.surface,
    backgroundColor: colors.accent,
  },
  activeStatusDot: {
    backgroundColor: colors.brand,
  },
});
