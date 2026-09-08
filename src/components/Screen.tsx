import type { PropsWithChildren } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../config/theme';

export function Screen({ children }: PropsWithChildren) {
  // AppNavigator supplies top and side insets; tool screens own the bottom inset.
  return (
    <SafeAreaView edges={['bottom']} style={styles.screen}>
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
});
