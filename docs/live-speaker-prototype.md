# Optional Deepgram live speaker-label prototype

**Later update:** [Speech preservation and transcript revision selection](deepgram-quiet-speakers.md) documents the integrated result-handling fixes, bounded real-provider comparison, and Meeting Memory revision controls. It supersedes this initial milestone's Meeting Memory deferral and verification counts; the initial activation record below remains historical.

Initially developed in the isolated `atlas-live-speaker-prototype` checkout, then integrated on September 10, 2026 into `/Users/andywu/Desktop/Codex/atlas-port` on `main` using a focused 25-file patch. Pre-existing upload, playback and recording-library changes were preserved. Source fingerprints verified that unrelated main files and the separate `atlas-auth-foundation` checkout were unchanged; that foundation was neither modified nor merged.

**Activation status:** integrated into the main checkout and backend restarted successfully after the user confirmed no phone recording and read-only checks found no active processing jobs or established backend connections. The user entered the key through the hidden local Terminal prompt. A second idle check and coordinated restart loaded it. Localhost and LAN (`http://10.0.0.104:8787/health`) checks now return `liveSpeakerLabels.available=true`, configuration `atlas-deepgram-live-v1`, and `restartRequired=false`. This verifies configuration availability, not that Deepgram has accepted the key or processed real audio. Metro remains running on port 8081; its iOS development bundle compiles and contains the experimental selector, capability check and current LAN backend. No real provider audio calls, native builds, deployment, or publishing were performed.

## Behavior

- The recorder offers **Existing live transcription** (OpenAI, default) and **Live speaker labels — experimental**. Selection is disabled during starting, recording and saving, including a provider-level guard. Only the selected live provider receives the existing `useAudioStream` PCM buffers; no second microphone session or native dependency was added.
- The experimental option explains that microphone audio goes through the Atlas backend to Deepgram. It remains unavailable until the backend advertises the enabled configuration. Missing flags/keys never create a provider connection; invalid credentials produce an actionable failure when the user records.
- OpenAI live recording, its final-event barrier, local M4A integrity verification, playback routing, saved live/post versions and saved-audio **Identify speakers** remain intact.
- Experimental recordings **do not automatically trigger OpenAI post-transcription on save**. This avoids automatically sending the same recording to another provider. The user can still explicitly choose Transcribe Recording or Identify speakers afterward. Existing-mode automatic post-transcription behavior is unchanged.
- Interim text and labels are provisional. A final replaces its interim result. Exact duplicate finals are ignored; conflicting finalized results fail visibly rather than silently rewriting evidence. “Finalized speech” does not mean the speaker's identity is verified.
- Anonymous labels use provider numbers plus one for display. Absent labels display **Unknown speaker**. Colors always accompany visible labels. Names, missing timings and confidence values are never inferred.
- The Stop path first stops the native recorder, releases its owned PCM capture, drains queued network audio and waits for final events. Snapshot refs, not delayed UI state, are saved. A timeout or disconnect retains finalized and unfinished text separately with failed/paused status; local audio saving proceeds independently.
- A clean provider close that leaves provisional words is marked incomplete/failed rather than presenting all speech as finalized. Starting another recording or changing mode clears the previous live display without touching its saved version.

## Configuration selected

The versioned configuration is in `server/deepgram/protocol.mjs`: `atlas-deepgram-live-v1`.

| Setting | Value |
| --- | --- |
| Provider endpoint | `wss://api.deepgram.com/v1/listen` (US endpoint) |
| Transcription model | `nova-3` |
| Model version selector | Explicit `version=latest`; this is a moving provider alias, **not a frozen model build** |
| Streaming diarizer | `diarize_model=v1`; no `diarize` or batch v2 parameter |
| Language | `en-US` |
| Audio | Headerless signed PCM16 little-endian, mono; measured native sample rate passed as `sample_rate` (requested capture rate remains 24 kHz) |
| Results | `interim_results=true`, `endpointing=300`, `punctuate=true` |
| Source wording | `smart_format=false`, `filler_words=true`; no redaction, summarization, name recognition or participant prompts |
| Provider model improvement | `mip_opt_out=true` |

The request configuration and v1 diarizer selection are fixed in code. A dated Nova-3 build was not invented without a provider-supported version/account check. Returned model/version/request/diarizer metadata is whitelisted and retained when supplied, so evaluations can identify the resolved build. Pin a supported dated transcription version before a controlled longitudinal comparison if required; no open-ended comparison was run.

Current official documentation was reviewed, including the [SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/) and [Expo Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/). Nova-3 is used because its streaming API supports diarization. The current [diarization guide](https://developers.deepgram.com/docs/diarization) documents streaming `diarize_model=v1`; an older May changelog predates that support. The current page says streaming v2 is unsupported, so this prototype does not request it. Live results provide speaker numbers without the batch speaker-confidence field.

The [streaming API](https://developers.deepgram.com/reference/speech-to-text/listen-streaming) documents the selected PCM/feature parameters. The [model-version guide](https://developers.deepgram.com/docs/version) explains the explicit `latest` selector. The [endpointing/interim guide](https://developers.deepgram.com/docs/understand-endpointing-interim-results) distinguishes `is_final` from `speech_final`.

## Streaming limits and failure behavior

Both providers use the existing `/live-transcribe` upgrade boundary; experimental selection adds `?provider=deepgram`. Unknown provider choices are rejected. There is no alternate standalone upload server or authentication bypass. The active main checkout still has the previous single-user development security boundary: outstanding authentication, ownership and client-to-backend TLS work remains open. This prototype does not import or activate the separate foundation. When that foundation is integrated, keep both provider branches behind its admission policy.

- Existing maximum: 4 combined client live connections. Deepgram account/region limits may be lower; provider rejection is surfaced. [Official concurrency limits](https://developers.deepgram.com/reference/api-rate-limits) vary by plan and region.
- Prototype maximum: 15 minutes per live connection and corresponding PCM byte count; original local recording is independent of streaming termination.
- 256 KiB WebSocket frame limits; 512 KiB audio queues and socket backpressure thresholds; bounded retained client text (4 MiB / 5,000 final results). Queue overflow fails visibly rather than dropping arbitrary speech and pretending success.
- Start message: 5 seconds. Deepgram readiness: 8 seconds. Client readiness: existing 10 seconds. Client audio idle: 20 seconds. KeepAlive: 3 seconds as a text control message, following [Deepgram's guidance](https://developers.deepgram.com/docs/audio-keep-alive).
- Buffered audio catch-up is paced at at most 1.25x realtime. Stop has a 10-second backend deadline including drain, followed by the existing 15-second client/16-second hook safety limits. Backlogged sessions can therefore save an incomplete transcript honestly.
- On Stop, send **CloseStream** after queued audio. The [documented close protocol](https://developers.deepgram.com/docs/close-stream) processes remaining audio, sends final Results and summary Metadata, then closes. Completion requires that summary and a clean close. We do not assume `from_finalize` will always arrive; [Finalize](https://developers.deepgram.com/docs/finalize) alone does not guarantee such a response.
- No automatic reconnect or silent provider fallback. A disconnect tells the user to save, then start another recording to reconnect. No audio replay is attempted. Every connection gets a fresh UUID namespace; tests demonstrate that provider speaker 0 in a new connection cannot equal speaker 0 in the prior connection. Future within-recording reconnect must retain separate namespaces and actual audio offsets. The [recovery guide](https://developers.deepgram.com/docs/recovering-from-connection-errors-and-timeouts-when-live-streaming-audio) explains stream-timing resets and buffering considerations.
- Backgrounding follows the existing foreground-live policy: networking pauses, received results remain, and capture/session handling is unchanged. Physical interruption behavior requires phone verification.

## Preservation and storage

No SQLite schema or historical recording migration is needed. The additive optional `SavedRecording.liveSpeakerTranscripts[]` field lives in the existing phone `Documents/recordings/recordings.json`, written through the same serialized metadata queue. Old records remain valid. OpenAI `liveTranscript`, `postTranscripts` and `diarizedTranscripts` are independent fields and are never overwritten by experimental results.

A version stores its stable ID, recorder-session identity, provider/configuration, connection namespaces, whitelisted model metadata, original alternative text, word timings, anonymous word labels, source-derived passages, final/provisional results, status and error. Separate recovery JSON uses `<session>.live-speakers.json` alongside existing recovery artifacts. It never modifies audio. Post-transcription, diarization and rename mutations preserve the added field.

The full provider alternative text is retained unchanged. Readable speaker passages are derived deterministically from consecutive provider words with the same label; their spacing may differ from the full alternative. The saved view exposes **View original provider text** for inspection. No filler removal, merging across providers, participant-name inference or guessed alignment is performed.

Timing is explicitly `provider-stream` with `audioOffsetMs:null`. Because PCM delivery begins separately from the M4A timeline and there is no verified alignment, stream timestamps are **not advertised as exact seeks into the saved audio**. No fabricated M4A offsets are stored. Overlapping passage timings are displayed when present; a mono diarizer may omit or misattribute simultaneous voices.

Direct Meeting Memory selection is **deferred**: its existing explicit diarized-source path resolves backend saved-audio jobs and their verified source revisions. Treating an experimental live result as one of those jobs would manufacture provenance. Existing OpenAI live-default transfer and explicit saved-audio diarized selection remain unchanged. The next milestone can add a new validated source kind with immutable full text, original offsets, connection-scoped speaker evidence and honest optional audio alignment. It must not transfer names by matching text.

## Configuration and startup after coordinated integration

The focused integration is complete. The backend was stopped only after the idle checks, then restarted from the original main server directory using its existing `.env` and SQLite v2 database. Counts remain 8 ready meetings, 4 ready diarization results and 2 published memory jobs. No schema/data migration was performed.

Store the key only in `/Users/andywu/Desktop/Codex/atlas-port/server/.env`, retaining its existing OpenAI key and database configuration. A temporary local Terminal helper, `/tmp/atlas-configure-deepgram.command`, was prepared for this activation: it reads with echo disabled and atomically writes just the two Deepgram settings, with file permissions 0600. It never puts the key in command arguments, chat or logs. The `.env` is Git-ignored; nothing was committed. The helper is temporary, so create future keys using the [official Console instructions](https://developers.deepgram.com/docs/create-additional-api-keys) and enter them locally. The required settings are:

```dotenv
ATLAS_DEEPGRAM_LIVE_ENABLED=1
DEEPGRAM_API_KEY=<your Deepgram server key>
```

The value belongs only on the backend. Availability is configuration detection, not a paid test of the key. `mip_opt_out=true` opts out of model-improvement use and may affect provider pricing; it is not a promise of zero retention. Audio and returned transcript data are handled under the provider/account terms. No existing private recordings are automatically uploaded for testing.

When the existing backend is safely stopped, start the normal backend:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port/server
npm run dev
```

It retains the existing port (`8787` by default), database path and development LAN binding. For the current Expo Go development setup, keep the phone and Mac on the same Wi-Fi. Read the current Wi-Fi address rather than assuming the old address still applies:

```sh
ipconfig getifaddr en0
```

Set the existing `EXPO_PUBLIC_API_URL` in the mobile `.env.local` to that backend (for example `http://10.0.0.104:8787` **only if that is still the Mac's address**). This preserves the existing development HTTP/WS setup; it does not solve A-02. Use an already-approved HTTPS endpoint instead if one has been configured. The Deepgram upstream itself always uses WSS.

Start Metro only if it is not already running:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
npx expo start --go --lan
```

On the iPhone, shake to open the Expo Go developer menu and choose **Reload**. Then open the Atlas menu → **Live Transcription** → bottom **Record** tab → find **Recording mode** above the recording controls → **Refresh availability** → **Live speaker labels — experimental**. Select it before recording. When the mode is unavailable, it shows configuration/connectivity guidance and the existing mode remains usable. No native build is needed for these changes.

To return to the original behavior: finish/save the current recording, select **Existing live transcription** before the next recording. The choice defaults to OpenAI when the provider remounts/app restarts. To disable the prototype server-wide, set `ATLAS_DEEPGRAM_LIVE_ENABLED=0` and restart only when recordings/jobs are idle. Saved experimental results remain readable.

## Verification

- After integration, the full deterministic suite passed **162/162** in the main checkout. It includes existing live final-event, local audio integrity/playback, upload, chat, diarization, Meeting Memory and SQLite regressions. TypeScript, lint and `git diff --check` also passed there.
- First focused streaming/client/hook pass: **37/37 passed**. Added save/reopen and hook-finalization coverage was included in the full pass.
- TypeScript passed after correcting explicit optional fields. Lint and `git diff --check` passed. No dependencies were installed or updated for this prototype.
- A final review found stale live-display state and a clean-close/provisional-status edge case. After fixing them, the affected **28/28 hook and speaker tests passed**, including one new regression. TypeScript, lint and whitespace checks passed again. The initial full 161-test run preceded that last change; all 162 tests subsequently passed during main-project integration.
- Real local WebSocket transport was tested against counting fake provider sockets with finite synthetic PCM buffers and test deadlines. Coverage includes disabled/missing-key zero calls, only one live provider, alternating/absent labels, malformed events/times, duplicate finals, Stop ordering, timeout, backpressure, failure and distinct reconnect namespaces.
- React hook tests exercised the shared Stop snapshot barrier and capture ownership with native boundaries mocked. Storage tests exercised production serialization and reload logic against a mocked Expo filesystem; they are not proof of iPhone filesystem behavior.
- **Real Deepgram audio and physical iPhone checks: not performed.** The key is now stored locally and configuration availability is verified; provider acceptance and real-audio quality await the user’s synthetic phone recording. No claims about transcription quality, speaker accuracy, latency, overlap handling or phone save completeness are made from mocks.

Reproduce checks in the main implementation checkout:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
node --test server/deepgram-live.test.mjs tests/live-speakers.test.cjs tests/recorder-live.test.cjs tests/recorder-storage.test.cjs
npm run typecheck
npm run lint
npm test
```

## One short synthetic phone evaluation

After configuration and coordinated activation, use Expo Go for a 45–60 second test with no private meeting content:

1. Select the experimental mode before recording. Two people alternate: “Red house, budget forty thousand” and “Blue house, budget fifty thousand.” Note the seconds until labeled text first appears.
2. A third person joins: “Green house, inspection Tuesday.” Have one person say “The quiet speaker says yellow house” more softly. Briefly overlap two distinct short phrases. Do not assume a label equals a real identity.
3. Say “This is the final sentence before Stop” immediately before **Stop & Save**. Reopen the recording, inspect finalized and provisional text, view the original provider text, and play the audio through the final sentence. Close/reopen Expo Go and verify the saved labels still appear.
4. Select **Existing live transcription** for a separate short synthetic recording and confirm the original live mode still works.

Record observations rather than pass/fail guesses:

| Measure | Phone result |
| --- | --- |
| First labeled text delay (seconds, approximate wall-clock) | Not measured |
| Omitted/misheard phrases, especially third/quieter speaker | Not tested |
| Speaker swaps or one person receiving multiple labels | Not tested |
| Brief overlap: which words/labels were returned | Not tested |
| Final sentence retained after Stop/save/reopen | Not tested |
| Complete original audio and preserved prior versions | Not tested |
| Original OpenAI mode on the next recording | Not tested |

If attribution is wrong, retain both the audio and original returned text for that user-initiated synthetic test. Do not silently relabel, normalize or merge it into another provider's version.
