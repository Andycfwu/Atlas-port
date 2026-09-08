import { Image, StyleSheet, Text, View } from 'react-native';

import { chatColors as c } from './chat.theme';

/** Placeholder compass until the official Atlas mark is supplied. */
export function AtlasMark({ small = false }: { small?: boolean }) {
  return (
    <View accessible accessibilityLabel="Atlas" style={[styles.mark, small && styles.small]}>
      <View style={[styles.compass, small && { transform: [{ scale: 0.65 }] }]}>
        <View style={styles.ring} /><View style={styles.ellipse} />
        <View style={[styles.ellipse, { transform: [{ rotate: '90deg' }] }]} />
        <View style={styles.north} /><View style={styles.east} />
      </View>
    </View>
  );
}

export function RealTorchWordmark() {
  return (
    <View accessible accessibilityLabel="RealTorch" style={styles.wordmark}>
      <View style={styles.torchCrop}><Image source={require('../../../assets/realtorch-torch.png')} style={styles.torch} /></View>
      <Text style={styles.word}>Real<Text style={{ color: c.mark }}>Torch</Text></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { width: 64, height: 64, borderRadius: 21, backgroundColor: c.mark, alignItems: 'center', justifyContent: 'center' },
  small: { width: 38, height: 38, borderRadius: 13 },
  compass: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: 30, height: 30, borderWidth: 1.7, borderColor: 'white', borderRadius: 15 },
  ellipse: { position: 'absolute', width: 14, height: 40, borderWidth: 1.7, borderColor: 'white', borderRadius: 20 },
  north: { width: 1.7, height: 44, position: 'absolute', backgroundColor: 'white' },
  east: { width: 44, height: 1.7, position: 'absolute', backgroundColor: 'white' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  torchCrop: { width: 21, height: 36, overflow: 'hidden', backgroundColor: 'white' },
  torch: { position: 'absolute', width: 41, height: 41, left: -10, top: -2 },
  word: { color: c.ink, fontSize: 24, fontWeight: '800', letterSpacing: -0.8 },
});
