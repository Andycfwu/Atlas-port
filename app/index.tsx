import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimalSoundProvider } from '../src/features/atlas';
import { ChatProvider } from '../src/features/chat/ChatProvider';
import { RecorderProvider, RecordingPlayerProvider } from '../src/features/recorder';
import { AppNavigator } from '../src/navigation/AppNavigator';
import { AudioSessionProvider } from '../src/services/audio';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AudioSessionProvider>
        <AnimalSoundProvider>
          <RecorderProvider>
            <RecordingPlayerProvider>
              <ChatProvider>
                <AppNavigator />
              </ChatProvider>
            </RecordingPlayerProvider>
          </RecorderProvider>
        </AnimalSoundProvider>
      </AudioSessionProvider>
    </SafeAreaProvider>
  );
}
