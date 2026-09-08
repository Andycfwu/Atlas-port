# RealTorch Atlas Mobile

An interactive Atlas mobile shell, adapted from the desktop reference, with
local conversations, Meeting Memory, and the existing voice recorder / live transcription screen.

- **Atlas** — welcome screen, Find It / Plan It / Sell It suggestions, and a
  keyboard-aware text composer. Suggestions populate the composer without sending.
- **Menu** — New Chat, Search Chats, Chat History, Meeting Memory, File Browser, Live
  Transcription, and Profile/Settings. File Browser and Profile/Settings are
  clearly marked **Coming soon**.
- **Local chats** — create, send, reopen, and search conversation titles and
  message contents. Sending saves only a user message and displays
  **“Atlas isn’t connected yet.”** No generated replies or Atlas API calls.
- **Live Transcription** — the existing recorder, live draft, saved recordings,
  playback, sharing, and post-stop transcription remain on a separate screen.
- **Meeting Memory** — paste/import completed transcripts, organize topics and
  supported decisions/actions, ask within or across meetings, and open cited
  original passages. Real AI processing runs on the existing Mac backend.

The implementation uses the existing Expo SDK 57 setup, strict TypeScript,
`expo-audio`, and modern `expo-file-system`. Chat authentication, cloud sync,
attachments, and the general chat backend integration remain outside this milestone. The
separate development Node server continues to support the existing optional
live and saved-recording transcription; the chat shell does not call it.

See [Meeting Memory setup, models, storage and integration](docs/meeting-memory.md),
[phone-style transcript verification and speaker/audio provenance](docs/meeting-memory-provenance.md),
[Meeting Memory verification](docs/meeting-memory-verification.md), and
[the shell handoff and verification notes](docs/atlas-shell.md).

## Requirements

- Node.js 24 recommended (24.14.1 tested for Meeting Memory's built-in SQLite)
- npm
- Expo Go supporting SDK 57 on a physical iPhone (the current milestone target)
- No Xcode, simulator or custom build is needed for Meeting Memory or foreground recording. Background-recording tests require a separate native build and are outside this milestone.

## Install and run (physical iPhone / Expo Go)

From `/Users/andywu/Desktop/Codex/atlas-port`, install dependencies if needed with
`npm install` and `npm --prefix server install`. Keep `OPENAI_API_KEY` only in
`server/.env` (use `server/.env.example` for the required names; never put the key
in a public Expo variable).

Terminal 1:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
npm run backend
```

Terminal 2:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan --port 8081
```

Both servers were already running at handoff; reuse them, or stop the corresponding
terminal with Ctrl+C before starting a replacement. Scan Metro's QR code in Expo Go.
Use the same Wi-Fi and allow Local Network access. The backend binds to `0.0.0.0`;
from iPhone Safari check `http://<Mac Wi-Fi IP>:8787/health` (`10.0.0.104` at handoff).
Metro connectivity alone does not prove the backend is reachable. Keep Atlas in
the foreground: project-specific background recording is unsupported in Expo Go,
and live transcription intentionally pauses when switching apps/locking.

See [saved live/post transcripts, investigation, and the short phone test](docs/saved-transcript-integrity.md).

## Brand assets

The menu reuses `assets/realtorch-torch.png` with a text RealTorch wordmark.
`src/features/chat/AtlasMark.tsx` contains a simple native compass placeholder.
The official Atlas compass/logo asset and the full RealTorch wordmark asset are
still needed. No identity or email from the desktop reference is used.

The earlier founder portrait and animal audio demo assets remain in `assets/atlas`
and their provider remains mounted for existing recorder audio coordination.
They are no longer presented as Atlas responses in the chat shell.

## Local chat persistence and future integration

`src/features/chat/chat.model.ts` defines local user messages and conversations.
`chat.store.ts` owns creation, selection, drafts, and send actions independently
of React. `ChatProvider.tsx` connects that store to the shell UI.
`chat.storage.ts` implements the native repository using the same Documents API
as the recorder, in a separate `Paths.document/atlas-chats/` directory.

Two versioned JSON snapshots alternate on successful saves. If one is interrupted,
loading recovers the previous readable snapshot and shows a notice. If neither is
readable, writes stay disabled and the original files remain untouched. A failed
save retains the composer draft for retry. Sent messages, empty chats explicitly
created with New Chat, and the selected conversation persist across app restarts.
Unsent drafts survive screen/menu navigation within the current session but are
not saved across termination. Chats are local app data and are removed when the
app is uninstalled; there is no account sync.

`src/features/atlas/atlas.service.ts` is the existing, **unwired** future Atlas API
boundary (`/v1/atlas/messages`). Once a backend is available, connect it through a
separate submission layer and extend the local message schema for assistant
responses and delivery state. Keep repository writes independent of network
success. Do not connect chat by changing recorder or live-transcription providers.

## Voice recorder

`RecorderProvider` is mounted above the application menu and all destinations. The
native recorder therefore remains alive when the user navigates between Atlas
and Live Transcription. One provider owns one `AudioRecorder`, and an operation guard
prevents concurrent microphone sessions.

Starting a recording performs these steps:

1. Check microphone permission and request it only when still undetermined.
2. Disable and stop all Atlas sound playback.
3. Configure the audio session with recording and background recording enabled.
4. Prepare one high-quality, metered recorder in the document directory.
5. Start native recording.

Stopping restores the playback audio mode and re-enables Atlas responses only
after the exact native file has stabilized, loaded through an Expo Audio player,
and passed a duration comparison against native pre-stop status. Metadata uses
the playable file duration.

### Development recorder integrity mode

For isolated physical-device diagnosis, set:

~~~bash
EXPO_PUBLIC_RECORDER_INTEGRITY_MODE=1
~~~

A development-only panel exposes one manual 10-second raw test and one manual
10-second production test. Raw tests retain the exact native source URI.
Production tests use the same move, destination validation, recordings.json
write, and in-memory library update as normal Stop & Save. Failed checks,
measured durations, file size, and source/destination URIs remain visible in the
panel. See docs/recorder-integrity.md for the lifecycle diagram and audit.

### Native background configuration

The Expo Audio config plugin is configured with `enableBackgroundRecording`:

- **iOS:** adds `UIBackgroundModes: [audio]` and the RealTorch microphone usage
  description. Runtime audio mode enables `allowsBackgroundRecording`.
- **Android:** adds microphone and foreground-service permissions and declares
  Expo Audio's microphone foreground service. Android displays its required,
  persistent recording notification while capture is active.

This supports Home, app switching, and screen lock while the operating system
keeps the application and recording service alive. It does not promise continued
recording after the user or operating system force-terminates the application.

### Persistence

Recordings begin in Expo's document directory rather than temporary cache. After
stop and successful source-file integrity validation, the app organizes each
file under:

```text
Paths.document/recordings/
```

Metadata is stored alongside the audio in `recordings.json`. Each record includes
its ID, filename, URI, title, creation time, duration, nullable transcript, and
one of four transcription states: `none`, `transcribing`, `complete`, or
`failed`. The saved audio file remains authoritative even if transcription fails.

### Saved recording playback and actions

Tapping a library row opens a RealTorch recording-detail view. A single
application-level `RecordingPlayerProvider` owns saved-recording playback and
subscribes to Expo Audio's native player status for load state, position,
duration, buffering, completion, and failures. Playback may continue while the
user moves between Atlas and Live Transcription screens; beginning microphone capture
always stops it.

The detail view supports play, pause, resume, replay after completion, and
native seeking. Rename changes only the persisted display title. Share / Export
passes the selected persistent audio URI to the system share sheet through
`expo-sharing`; it never uploads audio or exposes `recordings.json`. Delete uses
a native destructive confirmation, stops active playback, removes the audio
file, updates metadata, and returns to the library.

Library loading validates entries independently and ignores malformed metadata
without hiding unrelated healthy recordings. Metadata that points to a missing
audio file is treated as stale and cleaned up when possible. If iOS changes the
application-container UUID during an app update, the library first rebases each
URI from its persisted filename into the current recordings directory so a
healthy file is not mistaken for a stale one.

### Post-stop transcription

A normal successful Stop & Save finishes file validation, moves the M4A into the
persistent recording library, and writes its metadata before starting any
network request. Transcription then runs without blocking the recorder UI:

```text
saved M4A
  → POST /transcribe on the configured backend
  → OpenAI audio transcription
  → transcript + status persisted in recordings.json
```

The client uploads one M4A as the `file` field of `multipart/form-data`. It never
contacts OpenAI directly. The development endpoint accepts recordings up to 25
MB and returns a successful transcript as plain text. Recording Detail shows
processing, completed, failed, and not-started states; completed text is
selectable and copyable. A failed request leaves the audio untouched and exposes
Retry Transcription. If the app closes during an upload, a persisted
`transcribing` state is changed to `failed` on the next library load so it cannot
remain stuck permanently.

The development backend lives in `server/`, exposes `POST /transcribe`, and uses
the `gpt-transcribe` model. It is deliberately small and unauthenticated, so use
it only for local development or replace it with an authenticated RealTorch API
before production use.

### Foreground live-transcription spike

RecorderProvider prepares optional Expo Audio `useAudioStream` capture before
preparing the M4A recorder, then reapplies recording audio mode. Only after M4A
capture is confirmed does the network consumer connect. Mono int16 PCM is sent to
`WS /live-transcribe`; it is never retained as a complete recording in
JavaScript and is never written into recording metadata.

Expo reports the actual hardware sample rate after the stream starts. The client
sends both requested and actual rates in its start message. The backend validates
the format and explicitly resamples mono PCM16 to 24 kHz when necessary before
connecting to an OpenAI `gpt-live-transcribe` transcription session. Both client
and backend enforce bounded 512 KB audio queues and message/connection limits.

The Recorder screen labels this text **Live draft**. It is provisional and is
not saved as the recording transcript. Stop & Save drains the live connection
independently, stops the M4A recorder, then releases PCM capture and performs
integrity validation, persistence, and
`POST /transcribe` flow. The final `gpt-transcribe` result remains authoritative.
If the WebSocket, network, or upstream session fails, only the live draft stops;
the M4A recorder continues. Backgrounding or locking pauses the live spike and
does not change the background recorder or global audio-session coordinator.

The Realtime socket uses `?intent=transcription`, with `gpt-live-transcribe`
selected in `session.audio.input.transcription.model`. The live network hook
never starts/stops native capture. Failure stays visible after Stop. See
[the repair notes and physical-device test matrix](docs/recording-live-repair.md).
The [foreground live verification](docs/live-transcription-verification.md) covers
the final iOS startup order, backend freshness checks, and confirmed iPhone results.

### Audio-session coordination

`AudioSessionProvider` serializes transitions between the app's three audio
activities:

1. Atlas animal-sound playback
2. Saved voice-recording playback
3. Microphone recording

Starting either playback type stops the other and establishes playback mode.
Starting the microphone stops both players before recording mode is configured.
Recording completion or failure restores playback-compatible mode. This keeps
the global native audio session out of individual screen components and avoids
orphaned players during rapid actions.

## Transcription development setup

Install the app and backend dependencies:

```bash
npm install
npm --prefix server install
```

Create the server-only environment file and add your OpenAI API key:

```bash
cp server/.env.example server/.env
```

`server/.env`:

```bash
OPENAI_API_KEY=your_server_only_key
PORT=8787
```

Never put `OPENAI_API_KEY` in the project-root Expo environment file or in any
`EXPO_PUBLIC_*` variable. Start the backend from the project root:

```bash
npm run backend
```

For a physical iPhone, `localhost` points to the phone rather than the Mac. Find
the Mac's Wi-Fi address (commonly with `ipconfig getifaddr en0`) and create a
root `.env.local` containing its LAN URL:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.42:8787
```

Keep the phone and Mac on the same network, confirm
`http://<MAC_LAN_IP>:8787/health` is reachable from the phone, then start Expo:

```bash
npm start
```

After changing networks or computers, update the LAN URL and reload Expo; a
working Metro connection does not establish transcription backend connectivity.
For foreground testing in Expo Go on this Mac, use the current Wi-Fi address:

```bash
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan --clear
```

See the [Mac/iPhone repair and device verification notes](docs/mac-live-transcription.md)
for the diagnosed endpoint failure, device results, and native build setup.

The same `EXPO_PUBLIC_API_URL` is converted from `http(s)` to `ws(s)` for the
development live-transcription endpoint. No OpenAI credential or ephemeral token
is sent to the phone.

For foreground acceptance, record once for 30 seconds and once for 60 seconds.
Confirm the Live draft changes while speaking, Stop & Save still produces a
healthy M4A, and Recording Detail ultimately shows the post-stop transcript.
Then repeat while disabling Wi-Fi and while backgrounding/locking: the live draft
may become unavailable or paused, but Stop & Save, playback, restart persistence,
and Retry Transcription must continue to work.

Adding `expo-clipboard` changes the native dependency set. Create one fresh iOS
development build before physical-device acceptance; ordinary TypeScript edits
after that can use the existing development build.

### Trace a failed transcription

Every transcription attempt receives a unique ID such as
`atlas-tx-mabc1234-0001-x7k2p9qz`. The mobile client sends it in the
`X-Atlas-Trace-Id` header, and both Metro and the backend write structured
`[AtlasTranscription]` events containing that same ID. Logs include safe file
metadata, stages, statuses, timing, and available OpenAI error/request metadata;
they do not contain file paths, audio bytes, transcript text, API keys, or
authorization headers.

In a development build, open a failed recording and expand **Technical details**
under the transcript card. Use its trace ID to search both terminals:

1. Search the Metro terminal for the trace ID to see local file discovery,
   upload start, the typed client error, and local metadata persistence.
2. Search the `npm run backend` terminal for the same ID to see upload
   acceptance/rejection, the OpenAI request and response, and any upstream
   request ID.
3. Compare the persisted code and stage with the final `REQUEST_FAILED` event.

Stable error codes distinguish missing mobile configuration, unreachable or
timed-out backends, rejected/invalid/oversized files, OpenAI authentication,
rate limits and upstream failures, empty transcripts, invalid responses, and
local metadata persistence failures. Retrying creates a new trace ID; the prior
attempt remains distinguishable in terminal logs.

To verify the backend failure contract without an audio file or OpenAI request,
run this safe rejection test while the backend is running:

```bash
curl -i -X POST \
  -H 'X-Atlas-Trace-Id: atlas-tx-manual-safe-failure' \
  http://127.0.0.1:8787/transcribe
```

The response is structured JSON with `code`, `message`, `stage`, and `traceId`.
The backend OpenAI timeout is 120 seconds and the mobile request timeout is 130
seconds, allowing the backend time to return its more specific safe error first.

## Configuration and security

Copy `.env.example` to `.env.local` when a RealTorch API becomes available:

```bash
cp .env.example .env.local
```

`EXPO_PUBLIC_API_URL` is embedded in the client and may contain only the public
backend URL. Never place OpenAI keys, Supabase service-role keys, Atlas prompts,
or backend credentials in the mobile bundle. The included local endpoint has no
authentication and is a development adapter, not a production security boundary.

The future request path remains:

```text
RealTorch mobile client
  → authenticated RealTorch API
  → Atlas backend / agent runtime
  → RealTorch services, data, and AI tools
```

## Project structure

```text
app/                         Application composition root and providers
src/components/              Shared RealTorch mobile UI
src/navigation/              Lightweight destination shell and animated menu
src/config/                  Public runtime config and visual palette
src/features/atlas/          Atlas chat UI, retained sound provider, and future API contract
src/features/chat/           Local chat model, store, repository, history UI, and brand UI
src/features/recorder/       Recorder, detail UI, playback, transcription, persistence, and types
src/services/api/            Swappable RealTorch API client abstraction
src/services/audio/          Shared serialized native audio-session coordination
assets/atlas/                Local Atlas image and sound assets
server/                      Development-only OpenAI transcription adapter
server/live-transcription-*  Bounded WebSocket proxy, PCM resampling, and tests
```

## Checks

```bash
npm run typecheck
npm run lint
npm test
npx expo install --check
```
