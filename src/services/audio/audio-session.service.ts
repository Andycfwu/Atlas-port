import { setAudioModeAsync } from 'expo-audio';
import { Platform } from 'react-native';

export const configurePlaybackAudioMode = async (): Promise<void> => {
  const playbackMode = {
    allowsRecording: false,
    allowsBackgroundRecording: false,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
  };

  if (Platform.OS === 'ios') {
    // SDK 57 AudioStream leaves AVAudioSession in .measurement, which lowers
    // output playback levels. Expo's empty-options path explicitly sets .default;
    // its mixWithOthers path sets only the category/options, retaining the mode.
    // Reset while capture is stopped, then preserve our existing mixing policy.
    await setAudioModeAsync({ ...playbackMode, interruptionMode: 'doNotMix' });
  }

  await setAudioModeAsync({
    ...playbackMode,
    interruptionMode: 'mixWithOthers',
  });
};

export const configureRecordingAudioMode = async (): Promise<void> => {
  await setAudioModeAsync({
    allowsRecording: true,
    allowsBackgroundRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    shouldRouteThroughEarpiece: false,
    interruptionMode: 'doNotMix',
  });
};
