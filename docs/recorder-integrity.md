# Recorder integrity lifecycle

This document records the Expo SDK 57 recorder audit and the acceptance path for
physical audio files. The M4A file—not the visible timer or metadata—is the
source of truth.

## Authoritative lifecycle

~~~mermaid
flowchart TD
  A[Start button] --> B[Acquire operation mutex]
  B --> C[Confirm microphone permission]
  C --> D[Stop animal and saved-recording players]
  D --> E[Request serialized recording audio mode]
  E --> F[prepareToRecordAsync with stable module options]
  F --> G[Capture recorder ID, URI, and status]
  G --> H[Call record]
  H --> I{Within 2 seconds: native isRecording, status isRecording, canRecord, URI, and a live metering frame?}
  I -- No --> J[Fail start, keep timer off, stop native recorder if needed]
  J --> K[Restore playback mode only after native recorder is inactive]
  I -- Yes --> L[Store native confirmation time]
  L --> M[Start provider recording state, timer, metering, and background UI]
  M --> N[Stop button]
  N --> O[Acquire the same operation mutex]
  O --> P[Capture recorder ID, URI, status URL, duration, reset state]
  P --> Q[Call centralized native stop exactly once]
  Q --> R[Capture post-stop URI and status]
  R --> S[Poll exact native file until size and modification time stabilize]
  S --> T[Load exact URI with Expo Audio player]
  T --> U[Compare playable duration with native pre-stop duration]
  U -- Invalid --> V[Preserve diagnostic file; no successful metadata]
  U -- Valid and raw test --> W[Preserve original native URI; no move or metadata]
  U -- Valid and production or normal --> X[Move into Documents recordings without precreating destination]
  X --> Y[Verify destination size and playable duration]
  Y --> Z[Write recordings JSON using player duration]
  V --> AA[Restore playback mode]
  W --> AA
  Z --> AA
~~~

## Lifecycle audit

- RecorderProvider.tsx owns the only application useAudioRecorder and the only
  useAudioRecorderState. Recorder screens, controls, timer, visualizer, and tab
  state consume normalized provider state.
- The only application prepareToRecordAsync call is in the explicit Start
  operation. It receives module-level RECORDING_OPTIONS; no render, effect,
  navigation event, status callback, or Stop operation prepares the recorder.
- The only application recorder.stop call is inside stopNativeRecorderOnce. A
  per-session set rejects a second native Stop.
- audio-session.service.ts contains the only application setAudioModeAsync
  calls. AudioSessionProvider serializes and logs them. Playback mode is
  rejected while the recorder native isRecording property is true.
- The application does not call setIsAudioActiveAsync.
- Animal and saved-recording providers pause their own players; they never stop,
  prepare, recreate, or release the microphone recorder. Their iOS players use
  `keepAudioSessionActive: true`, leaving session ownership with the central
  coordinator.
- The recorder is mounted at application scope and is not recreated by the
  lightweight navigation shell. Its options contain no session ID, timestamp,
  title, callback, navigation state, playback state, or recording state.
- RecorderProvider wraps RecordingPlayerProvider so iOS constructs the one
  native recorder before constructing the long-lived saved-recording player.
  This order is intentional: the isolated physical-device reproduction failed
  whenever an idle Expo Audio player was constructed before the recorder, and
  passed when the recorder was constructed first.
- The only normal source-file move is in persistVerifiedRecordingFile, after
  source existence, stable size, playable load, and duration validation.
- There is no second microphone path: no useAudioStream, second
  useAudioRecorder, expo-av recorder, or third-party recorder library.
- There is no mounted video component or expo-video / react-native-video
  dependency.

## Installed Expo iOS behavior relevant to the incident

The installed Expo Audio iOS implementation has three important behaviors:

1. Preparing while its wrapper state is recording stops the current
   AVAudioRecorder, then replaces it with a newly prepared recorder and URI.
2. record calls AVAudioRecorder.record but does not propagate that Boolean
   return value. The Expo wrapper then marks itself recording and computes
   duration from the device clock.
3. Switching audio mode to allowsRecording false stops native recorders.
4. Unless `keepAudioSessionActive` is enabled, pausing a player schedules
   `AVAudioSession.setActive(false)` 100 ms later. That delayed native task
   checks whether a player is active, but does not check active recorders.

For that reason, wrapper status and a counting duration are insufficient proof.
Start acceptance also requires AudioRecorder.isRecording and a metering value
above Expo's pre-input `-120` dB sentinel. The timer therefore remains off when
iOS claims to be recording but has not delivered a microphone frame. Every
playback mode transition probes and rejects an active native recorder.

Two conditions contributed to the physical-file truncation. The full provider
tree constructed its long-lived saved-recording player before the recorder; an
isolated player-first reproduction created the same 22 ms file and `-120`
metering sentinel, while recorder-first produced a healthy 5-second file.
Starting the microphone also pauses application playback, whose default Expo
behavior can schedule delayed session deactivation. RecorderProvider now mounts
before RecordingPlayerProvider, and both players keep the session active, so
`AudioSessionProvider` remains the only owner of global session transitions.

iPhone Mirroring is excluded from recorder acceptance. With Mirroring active,
the same device reproduced a native `isRecording: true` / `-120` dB stalled
capture even after the application player-order fix. The RealTorch application
contains no video component; this is an external capture-session conflict, so
physical microphone validation must be performed directly on the unlocked
iPhone with Mirroring disconnected.

## Development diagnostic mode

Set this only in a development environment:

    EXPO_PUBLIC_RECORDER_INTEGRITY_MODE=1

The Recorder screen exposes two manually initiated tests. The 10-second raw test
leaves the exact native source at its document URI. The 10-second production
test uses the same finalization, move, destination verification, metadata write,
and library-state update as normal Stop & Save. Only one test runs at a time.

Every result retains the requested duration, native pre-Stop duration, playable
duration, file size, source URI, destination URI, and a check-by-check failure
list. A playable diagnostic source can be deliberately saved with the panel's
Save Test Recording to Library action, which calls the same production storage
and metadata path. No test starts automatically.
