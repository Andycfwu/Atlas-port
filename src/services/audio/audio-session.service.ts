import { setAudioModeAsync } from 'expo-audio';

export const configurePlaybackAudioMode = async (): Promise<void> => {
  await setAudioModeAsync({
    allowsRecording: false,
    allowsBackgroundRecording: false,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
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
