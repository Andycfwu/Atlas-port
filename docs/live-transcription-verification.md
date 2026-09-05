# Foreground live transcription follow-up — 2026-09-05

## Reproduced failures

The backend listening on port 8787 was an old Node process (started 12:40:44
local time). The repaired live server/protocol files were edited at 12:56–13:14.
The previous `dev` command did not watch for changes, so the running process had
never loaded those fixes. Metro started at 13:17 and served the current iOS code.

Fresh mobile traces `atlas-tx-mtonca34-0001-7enhl5ag` and
`atlas-tx-mtoncntd-0003-itp1f545` failed with `LIVE_CONNECTION_FAILED`, wrapping
`LIVE_OPENAI_UPSTREAM_FAILED` at `openai_connection`, before any draft.
The effective live mode was `on`: no process/user/machine or `.env.local`
override, and no injected mode override in the served iOS bundle. Native capture
reported 24,000 Hz. Saved-file trace `atlas-tx-mtoncvau-0004-ckvujkgc` completed.

Synthetic speech through the actual mobile connection class and the old running
backend reproduced the identical code/stage, trace
`atlas-live-smoke-a1f0999f-1e4d-4ca8-bce6-4c6427b705ce`. Restarting with the
already-correct files immediately produced live text from that same fixture.
The original process's upstream error body was not recoverable; this follow-up
does not claim a newly observed OpenAI `invalid_model` response. The existing
`?intent=transcription` URL fix was not repeated or changed.

After that restart, the user tested again: the UI said it was listening but
showed no words. Trace `atlas-tx-mtoo22j6-0006-12i2r8o9` connected to the current
backend and OpenAI, then ended after 17.029 seconds with **zero forwarded audio
bytes**. The saved recording still transcribed successfully. This isolates a
second problem before backend audio processing, rather than an OpenAI rejection.
The mobile Metro log connection had timed out, so that attempt did not provide
new native buffer diagnostics.

SDK 57 iOS source explains an unsafe startup ordering: AudioStream starts an
AVAudioEngine in `.record`/`.measurement`, then Atlas changes recording mode and
AudioRecorder.prepare changes to `.playAndRecord`/`.default`. Apple documents that
input/output hardware format changes stop the engine. The stream implementation
has no configuration-change recovery, and its `isStreaming` flag is not an engine
liveness check. Moving stream startup after preparation restored continuous
PCM and live text in the user's next iPhone test, supporting this explanation.
The exact native configuration notification was not instrumented in Expo Go.

## Changes

- Restarted the active backend with current source. `npm run backend` now runs
  Node watch mode so imported server edits restart the development process.
- `/health` reports loaded/source revisions, load time, and `restartRequired`.
  Live ready messages and backend connection logs carry the loaded revision.
  The revision is a hash of source files only.
- Mobile request logs identify client revision and effective mode. Separate
  count-only events identify first native buffer, backend ready, first draft
  publication, and buffer totals/delivery span at Stop or failure. A ready
  connection is no longer logged as proof of audio streaming.
- Added a generated counting-speech fixture and repeatable smoke test, plus
  regressions for stale runtime detection, revision propagation, diagnostic
  privacy, and the observed rejection before native delivery.
- iOS now completes audio-mode configuration and M4A preparation **before**
  starting PCM, then starts M4A recording. No session changes occur between PCM
  start and M4A record. Android retains its previous acquisition order. Failed
  PCM startup restores the session before local recording proceeds.
- Completing a live session with zero audio now produces
  `LIVE_NO_AUDIO_RECEIVED` at `audio_streaming`, never a misleading completion.

Recorder ownership, strict validation, recovery storage, playback, and saved-file
transcription remain intact. PCM still starts before M4A capture and stops only
after M4A stops. Live failure only closes networking and remains failed when Stop
is pressed. The startup fix uses existing Expo Go APIs; no native patch or custom
build requirement was introduced.

## Verification performed

- Typecheck, ESLint, and all **47** automated tests pass. The suite includes
  recorder independence with live off/success/failure, sticky failures after
  Stop, queue draining, final transcript ordering, strict duration checks and
  recovery preservation. Native hardware is mocked in these tests.
- Real OpenAI speech test before the iOS-order follow-up, trace
  `atlas-live-smoke-934ead2c-e5ed-4045-ad06-e8ca9ecbea07`, backend revision
  `e0a2a57902db148f`: **31.4145 s**, mono little-endian PCM16 at **24 kHz**,
  **1,507,896 bytes**, **63** nonempty draft updates, first draft **1.935 s**
  after connecting and before Stop, completed successfully, final counting
  fixture recognized. No private recording was sent or transcript content logged.
- That trace links backend connection/HTTP 101, first 4,800-byte buffer, streaming
  with no resampling, first OpenAI partial, and completion. This verifies fixture
  PCM → production mobile transport → backend queue/resampler → OpenAI → mobile
  draft callback. The React publication path is separately covered by a hook test.
- Repeated against the final server revision `4f9705bc866eabb5`, trace
  `atlas-live-smoke-1ebdb7ca-0418-4198-b563-0a73e07fa579`: the same 31.4145-second
  fixture produced **62** draft updates, first at **1.873 seconds**, completed,
  and recognized the fixture. The zero-audio guard does not reject valid speech.
- `/health` reports matching loaded/source revisions and no restart required.
  The freshly served iOS bundle contains `live-pcm-after-prepare-3` and the new events.
- **User-operated iPhone test passed** after the ordering fix. The user confirmed
  “Live words appear; full playback works.” Mobile trace
  `atlas-tx-mtoobscw-0001-vg7brgu5`, recorder `rec-mtoobs4h-g1ri3k`, confirms live
  mode `on`, current client/server revisions, 24 kHz mono PCM16, **140 native
  buffers / 671,558 bytes over 13.909 seconds**, and first UI draft publication
  **2.258 seconds** after the request, well before Stop. The backend received
  the same byte total, returned partial/final events and completed. This checks
  continued PCM delivery after M4A starts, rather than only stream metadata.
- Strict source/destination validation passed: **14,071 ms native vs 14,070 ms
  playable**, 220,860 bytes, and library metadata saved. Saved-file trace
  `atlas-tx-mtooc4i8-0002-ixid6odc` returned HTTP 200; mobile
  `RECORDING_METADATA_PERSISTED` and `REQUEST_COMPLETED` confirm the saved
  transcript persisted for recording `mtooc3qu-s5gxgw`.
- The agent inspected logs remotely and did not operate or hear the phone.
  Reopen persistence, a new forced-failure playback test, and Android physical
  checks remain unperformed in this follow-up. Background testing remains deferred.

## Repeat the backend test

From the repository root, with the Windows backend running:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File diagnostics/generate-live-fixture.ps1
node server/smoke-live.mjs
```

The process-scoped execution policy applies only to this fixture generator.
It creates synthetic counting in ignored `.expo/live-counting.wav`. The smoke
test reads only that fixed fixture, checks backend freshness, streams in real
time, and requires text **before Stop**, completion and fixture recognition.
Credentials remain in the backend. Audio and transcript content are never logged.

## iPhone acceptance

1. Keep Atlas in foreground Expo Go. Reload the app to load the current bundle.
   Leave live mode unset or `on` (not `off` or `force-failure`).
2. Speak counting for 15–20 seconds. Confirm words appear **before Stop**.
3. Stop, save, and listen from the first through the last number. Confirm full
   duration. Reopen Atlas and verify the saved note still plays fully.
4. Verify the saved recording's Transcribe action still works. A separate forced
   live failure should remain visible while the full recording still saves/plays.

If live still fails, report the test time and keep these events with their shared
`traceId` (no transcript text or audio needed):

- Mobile `.expo/dev/logs/start.log`: `LIVE_TRANSCRIPTION_REQUESTED`,
  `LIVE_FIRST_NATIVE_BUFFER`, `LIVE_CONNECTION_READY`, `LIVE_FIRST_DRAFT_PUBLISHED`,
  `LIVE_AUDIO_DELIVERY_SUMMARY`, `LIVE_STREAM_FAILED`/`LIVE_STREAM_COMPLETED`.
- Backend `.expo/dev/logs/backend-live-current.stdout.log` and `.stderr.log`:
  `LIVE_CLIENT_CONNECTED`, `LIVE_OPENAI_CONNECTED`,
  `LIVE_FIRST_AUDIO_BUFFER_RECEIVED`, `LIVE_AUDIO_STREAMING_STARTED`,
  `LIVE_FIRST_TRANSCRIPT_EVENT_RECEIVED`, `LIVE_STREAM_FAILURE`/`LIVE_STREAM_COMPLETED`.
  Include failure code/stage, sanitized upstream details and handshake status.
- Include `/health` revision fields. Buffer count/byte count/delivery span separates
  a native delivery stall from transport/upstream/UI problems without guessing.

Background recording, Apple account setup and deployment remain outside this
follow-up. Existing custom-build background configuration is retained.

## Official references checked before editing

- [Exact Expo SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/)
- [SDK 57 Audio API](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)
- [OpenAI Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
  — transcription intent, `gpt-live-transcribe`, nested PCM format at 24 kHz,
  manual commits and incremental/final transcript events remain correct.
- Installed `expo-audio` 57.0.4 iOS stream/recorder source was inspected for
  shared-session effects. Native code was not patched.
- [Apple AVAudioEngine configuration changes](https://developer.apple.com/documentation/foundation/nsnotification/name-swift.struct/avaudioengineconfigurationchange)
  — hardware channel/rate changes stop and uninitialize the engine.
