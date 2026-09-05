# Recording integrity and live transcription repair — September 5, 2026

See the [foreground live follow-up](live-transcription-verification.md) for the
subsequent iOS preparation-order correction, stale backend fix, full speech test,
and user-confirmed iPhone live text/playback. Its startup sequence supersedes the
initial ordering described below.

The full supplied attachment was read from
`C:\Users\Wua02\.codex\attachments\3928c977-e705-413f-a710-951189cb86ed\pasted-text.txt`.
The originally supplied path omitted the backslash before `.codex`.

## Evidence and causes

| Recording session | Live trace ID | Native duration | Playable duration | File size |
| --- | --- | --- | --- | --- |
| rec-mtom1ntn-99izp4 | atlas-tx-mtom1nyg-0001-dexyv6a8 | 5905 ms | 1461 ms | 68834 B |
| rec-mtom2kjo-3ihmiy | atlas-tx-mtom2kxt-0003-oidwcvf7 | 6718 ms | 1252 ms | 64301 B |

In the first session, native capture was confirmed at 16:41:55.333 UTC,
the live error arrived at 16:41:56.675, and live cleanup finished at
16:41:56.873. In the second, those times were 16:42:38.081,
16:42:39.231, and 16:42:39.393. Playable audio ends within those cleanup
windows. Both recordings later report the -120 dB native sentinel.

Installed `expo-audio` 57.0.4 iOS source confirms the coupling:

- `ios/AudioStream.swift` start sets the shared AVAudioSession category to
  `.record` / `.measurement`; stop calls `setActive(false)` without consulting
  AVAudioRecorder. The old live hook called this stop on connection failure.
- `ios/AudioRecorder.swift` computes `durationMillis` from `deviceCurrentTime`
  and wrapper state. It can report elapsed time despite stalled input. Loading
  the finalized M4A is still required to establish actual recorded duration.
- Atlas's JS session coordinator cannot intercept these native side effects.

This establishes a concrete native-session deactivation path matching the
truncation timing. The repaired lifecycle still requires direct iPhone capture
and playback verification; Windows tests cannot establish native audio fidelity.

The attachment and available Metro logs contain mobile events, not the original
backend upstream response bodies. The historical upstream code cannot be recovered
from those logs. A new credentialed, **audio-free** handshake comparison using
`node --env-file=.env diagnose-live.mjs` reproduced the configuration failure:

- Old `?model=gpt-live-transcribe`: HTTP 101, followed by `invalid_model`.
  OpenAI explicitly says this transcription model cannot be the Realtime
  session model and belongs under `audio.input.transcription.model`.
- Corrected `?intent=transcription`: HTTP 101 and `session.updated` with
  `session.type = transcription`, using the same credentials and model.

The saved-file success trace `atlas-tx-mtom1z2w-0002-hrthq9ze` remains a separate
working path. This was not a missing API URL or missing-credential diagnosis.

## Implementation

- RecorderProvider owns PCM startup and release. Startup runs while the shared
  microphone lock is held, after playback stops and before recording audio mode
  and native M4A preparation. No PCM startup reconfigures an active recorder.
- Native M4A Stop resolves before PCM release. The network-only live hook cannot
  stop or release native capture on failure, timeout, backpressure, background
  pause, stale callbacks, or unmount. Failed/paused states survive Stop.
- Failed live sessions discard subsequent PCM buffers until the recording owner
  stops capture. This deliberately keeps the native stream alive to protect the
  shared session. Network failure does not reactivate or restart the recorder.
- Existing duration tolerances and file validation remain intact. Even the
  diagnostic library action rejects failed integrity checks. Storage copies,
  validates the copy, writes metadata, then deletes the original only on success.
- Failed recordings remain at their original document URI. Separate JSON
  manifests under `Documents/atlas-recording-recovery/<sessionId>.json` retain
  source URI/filename, measured durations, and failed checks across app restarts.
  The error states that the recording may be incomplete and provides a recovery
  ID. A manifest-write failure never deletes the audio. Export sources via app
  container access or developer tooling; do not present them as complete notes.
- Realtime uses the dedicated transcription endpoint, current nested session
  schema, and mono little-endian PCM16 at 24 kHz. Actual native sample rates are
  validated and resampled when needed. Manual commits bound turns to approximately
  five seconds; the model can emit live deltas before commit. Stop drains all
  queued audio and waits for every committed item's final result. A short network
  tail is zero-padded to the API's 100 ms commit minimum; local M4A is unaffected.
- Transcript ordering follows committed audio items, even when final events
  arrive out of order. Finalization timeout and upstream closure remain failures.
- Server failure logs correlate by mobile trace ID and include sanitized upstream
  code/message/type/parameter/event ID, handshake status, HTTP status, and request
  ID when available. Rejected upgrade bodies are bounded and parsed, never logged
  raw. Credentials, audio payloads, and transcript text are excluded from logs.
  Client errors include the server error code and stage; the UI retains a clear
  fallback message and any provisional text.

## Verification performed

- TypeScript typecheck and ESLint pass.
- `npm test`: mobile production-hook/connection/ownership/storage tests and backend
  protocol/loopback WebSocket tests. Native APIs are mocked. Regression fixtures
  reject both reported truncated files without widening tolerance.
- Loopback integration covers final queue draining, multiple pending turns,
  upstream failure/closure after Stop, short final buffers, trace correlation,
  and sanitized rejected-upgrade diagnostics.
- The real OpenAI handshake comparison above passed with the corrected URL.
  No user audio or saved recording was sent during this check.
- No physical iPhone or Android recordings, speaker playback, app reopen test,
  or real microphone transcription was performed in this Windows workspace.

## Physical-device acceptance (required)

Restart the Windows backend with `npm run backend` so it loads the changed
server. Keep the working `EXPO_PUBLIC_API_URL` pointing to its LAN address.
In `.env.local`, set `EXPO_PUBLIC_RECORDER_INTEGRITY_MODE=1` and choose each
`EXPO_PUBLIC_LIVE_TRANSCRIPTION_MODE` value below. Restart/reload Expo after
each change; do not hot-refresh in the middle of a recording.

| Mode | Expected live behavior |
| --- | --- |
| `off` | No native PCM stream is started; normal M4A recording and saved-file transcription run. |
| `on` | Backend reports HTTP 101/session ready; provisional words appear while speaking. |
| `force-failure` | Development mode forces live connection failure at 1.3 seconds; UNAVAILABLE remains visible after Stop. |

For **each mode**, on the iPhone in foreground Expo Go:

1. Record spoken counting for 10–20 seconds, including an audible final number
   immediately before Stop. Continue speaking after any live failure.
2. Stop and verify full playback from first through last number. Native duration,
   playable duration and actual listening length must agree; all integrity checks
   must pass, and library recording ID/destination URI must be non-null.
3. Rename the note for the mode. Fully close and reopen Atlas, verify the note
   remains, replay it, and verify its duration and final number again.
4. Verify automatic saved-file transcription or retry with the saved recording's
   Transcribe action. Confirm persisted transcript/REQUEST_COMPLETED, including
   numbers spoken after the forced failure. Reopen once more to check persistence.
5. Play a saved note and an animal sound, then make another recording to catch
   session-restoration problems. Repeat the same three modes on Android.

Also repeat `on` while cutting Wi-Fi after the first words appear. Stop during
connection setup and during speech; the live result must either finish honestly
or display failure, while the full M4A still saves. Capture backend logs and match
the trace ID to the mobile log for any failure.

Expo Go supports this foreground procedure without a native patch. Its fixed
native binary cannot incorporate changes to AudioStream.swift. The JS ownership
fix works around the demonstrated SDK side effects without editing node_modules.
Concurrent native PCM/file capture still needs device confirmation on each
platform; these automated tests are not a claim about microphone routing.

Background recording settings remain enabled in `app.json` and the audio-session
service for custom development/production builds. On those builds, repeat a
15–20 second recording with a screen lock/app switch halfway through. The live
network draft pauses, while native local recording must retain the entire count.
Use custom builds to accept background behavior; Expo Go foreground success is
not evidence of custom-build background support. Restore live mode to `on` after
testing.

## References read

- [Exact Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [SDK 57 Audio API](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)
- [Current OpenAI Realtime transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
- Installed official OpenAI SDK 7.5.0 `realtime/internal-base.mjs`:
  `buildRealtimeURL` explicitly selects transcription with `intent=transcription`.
