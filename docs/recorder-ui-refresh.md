# Realtorch recorder UI refresh

The supplied recorder and library designs inspired the warm canvas, rounded surfaces,
orange capture control and persistent Record / Library navigation. The implementation
uses native React Native components and existing Realtorch providers.

The library searches titles, dates, saved live text, saved-audio transcript versions
and diarized text. “With text” and “Needs attention” use persisted source/job state.
Search and filter selection survive recording-detail and app-menu navigation. Active
capture remains visible from the library, recording details and Meeting Memory.

Recording details retain playback, seeking, rename, sharing, confirmed deletion,
transcription retries and explicit Meeting Memory import. The selected recording now
shows Play correctly when a different recording is playing. Audio capture, storage,
transcription and playback providers were not changed by this UI refresh.

## Verification

- `npm run typecheck` and `npm run lint`.
- `npm test`, including library search/filter/source-preservation checks, capture
  transition controls and the selected-recording playback regression.
- `npx expo export --platform ios --output-dir /tmp/realtorch-ui-check/native-export`.
- Actual screen components and AppNavigator rendered through React Native Web at
  390 × 844 and 320 × 740, with synthetic data and mocked native/network boundaries.
  Checked search, combined filters/reset, query persistence, playback selection,
  rename, Record/Library switching during capture, failed live text, return from
  Meeting Memory, save-to-library, empty library and blocked microphone states.
  No browser runtime errors or document horizontal overflow were detected.

Physical microphone capture, audio output, OS sharing and on-device safe areas still
need a phone smoke test. On Expo Go, record a short conversation, switch to Library
and back, Stop & Save, play/seek the saved audio, and open its transcript in Meeting
Memory. Keep the app foregrounded for live transcription. No app dependencies or
native recording settings were added or changed.
