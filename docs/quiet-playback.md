# Quiet iPhone playback — September 10, 2026

## Evidence and diagnosis

Reported: playback is quiet with phone volume raised, including both phone
outputs; a screen recording of playback sounds normal. A force-quit/reopen
comparison has not yet been reported. These observations support investigating
output/session state, but do not measure the actual native route or audio gain.

Read `AGENTS.md`, the [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
and [SDK 57 Audio documentation](https://docs.expo.dev/versions/v57.0.0/sdk/audio/),
then traced the installed `expo-audio` **57.0.4** source:

1. `prepareRecordingCapture` on iOS configures recording mode, prepares the M4A
   recorder, then starts PCM. This order is intentional: preparing the file
   recorder after starting PCM can stop the live audio engine.
2. SDK `ios/AudioStream.swift:start()` sets `.record` / `.measurement`. M4A
   `record()` does not change that session. Stream Stop deactivates the session
   but does not reset its mode.
3. Atlas awaits file Stop, releases PCM, drains final live events, validates and
   preserves the recording, then restores playback. Live networking has no
   native audio-session controls. One shared audio provider owns transitions;
   navigation does not create a second recorder/provider.
4. The old playback configuration already disabled recording, but used
   `mixWithOthers`. In SDK `ios/AudioModule.swift:setAudioMode`, that selects
   `setCategory(category, options:)`, without explicitly resetting `.measurement`.
   `.measurement` is valid for `.playback`, so changing category alone is not a
   reliable reset. Apple's [measurement documentation](https://developer.apple.com/documentation/avfaudio/avaudiosession/mode-swift.struct/measurement)
   explicitly describes reduced playback output level in this mode.
5. Subsequent Play/Resume requests previously skipped native configuration when
   the JavaScript mode cache said `playback`. Fresh app startup does not inherit
   the same preceding live-capture sequence.

This is a concrete session-reset defect and a strong explanation for the
symptom. Its audible effect on this iPhone remains unverified. No evidence
establishes an earpiece-only route. SDK 57 documents that
`shouldRouteThroughEarpiece` affects iOS only in recording-enabled mode; simply
adding that flag to playback would not fix the retained measurement mode.

Atlas has no player volume/mute assignments. Runtime player volume is not yet
measured on this phone. The screen recording observation alone does not prove
that the source file level is correct.

## Change

- On iOS, while capture is stopped, request recording-disabled playback with
  `doNotMix` first. SDK 57's empty-options branch explicitly sets `.default`.
  Then restore the existing `mixWithOthers` policy. Both calls are awaited in
  the existing serialized audio-session transition. This uses Expo Go APIs;
  no native module patch or new dependency is required. The brief reset uses
  exclusive session policy; simultaneous other-app audio should be checked if
  that use case matters. The final policy remains mixing.
- Reapply native playback configuration on each Play/Resume request, retaining
  active-microphone and stale-request guards. Native errors still reject the
  request and use the existing visible playback error.
- Log only recording ID, player volume/mute, and requested policy at playback
  start in development. This is not a measured route/mode report. No new audio,
  transcript, URI, or credential logging.

Original audio, recording levels, player gain, capture ordering, live-final
preservation, post-transcription, diarization, storage and UI are unchanged.
The backend and Metro were already running and were not restarted for this fix.
Earlier uncommitted upload-hardening work was preserved.

## Verification

- Focused audio-session/live suite: **28 passed**, including six new tests.
- Full `npm test`: **144 passed** (temporary storage and provider/native doubles).
- `npm run typecheck`, `npm run lint`, `git diff --check`: passed.
- New regressions cover live capture → playback mode reset, second recording,
  cold start/replay after external native-state changes, microphone protection,
  superseded queued playback, configuration failure/retry, and Android policy.
  TS loader now supports TSX so tests execute the actual audio provider.
- Existing final live-event, audio preservation, separate transcript versions,
  chat, diarization and Meeting Memory regressions passed.

Native mode behavior is modeled from the inspected SDK implementation; these
tests do not measure physical routing, loudness, or iPhone recording behavior.
No paid provider calls, device automation, Xcode, simulator or native build was
used. Device acceptance is pending.

## Short Expo Go acceptance test

1. When recording is stopped, reload Atlas in Expo Go. Turn screen recording
   off and disconnect Bluetooth/headphones. Record about 10 seconds of normal
   speech, confirm live text, Stop & Save, and immediately play it. Note volume
   and whether sound comes from the phone speakers.
2. Fully close Expo Go, reopen Atlas, and play **the same saved file** with the
   same phone volume and output route. Compare loudness with step 1.
3. Make and play a second short recording to confirm the microphone/live text
   still work after playback. Report any remaining loudness difference.

If startup is needed (do not duplicate already-running servers), from
`/Users/andywu/Desktop/Codex/atlas-port`, run in separate terminals:

```sh
npm run backend
```

```sh
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan
```

Use the same Wi-Fi for Mac and iPhone. Keep the existing backend credentials
in `server/.env`. Playback of an existing local recording does not need a
provider call; a new recording can use the existing transcription backend.
