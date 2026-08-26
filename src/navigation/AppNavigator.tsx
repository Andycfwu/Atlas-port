import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AtlasScreen } from '../features/atlas';
import {
  RecorderScreen,
  RecordingDetailScreen,
  useRecorder,
} from '../features/recorder';
import { AppTabBar, type AppDestination } from './AppTabBar';

export function AppNavigator() {
  const [destination, setDestination] = useState<AppDestination>('atlas');
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const { isRecording } = useRecorder();

  return (
    <View style={styles.container}>
      <View style={styles.destination}>
        {destination === 'atlas' ? (
          <AtlasScreen />
        ) : selectedRecordingId ? (
          <RecordingDetailScreen
            onBack={() => setSelectedRecordingId(null)}
            onDeleted={() => setSelectedRecordingId(null)}
            recordingId={selectedRecordingId}
          />
        ) : (
          <RecorderScreen onOpenRecording={setSelectedRecordingId} />
        )}
      </View>
      <AppTabBar
        activeDestination={destination}
        isRecording={isRecording}
        onChange={setDestination}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  destination: {
    flex: 1,
  },
});
