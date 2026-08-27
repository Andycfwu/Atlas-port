# RealTorch Atlas Mobile

A RealTorch-themed React Native proof of concept for the future Atlas mobile
client. The app currently provides two destinations:

- **Atlas** — founder avatar plus coordinated Moo, Oink, Rooster, and Bark local
  audio responses
- **Recorder** — durable foreground and background voice capture with a local
  saved-recordings library

The implementation uses Expo SDK 57, strict TypeScript, `expo-audio`, and the
modern `expo-file-system` API. It contains no authentication, database, cloud
synchronization, realtime transcription, or client-side AI credentials. An
isolated development Node server supports optional post-stop transcription.

## Requirements

- Node.js 22.13 or newer
- npm
- Xcode with an iOS Simulator, or Android Studio with an Android emulator
- A development or production build for background-recording tests

## Install and run

```bash
npm install
npm start
```

Start a platform directly:

```bash
npm run ios
npm run android
```

The `expo-audio` config plugin changes native permissions and background modes.
After changing the plugin configuration, create a fresh native development build;
Expo Go does not contain project-specific native configuration and is not a valid
background-recording test environment.

## Local Atlas assets

Bundled assets live in `assets/atlas`:

- `founder.png`
- `moo.mp3`
- `oink.mp3`
- `rooster.mp3`
- `bark.mp3`

They are registered centrally in `src/features/atlas/atlas.assets.ts`. A single
application-level `AnimalSoundProvider` owns playback. Replacing the active
source stops the previous sound, so only one animal response can play at a time.
The original Rooster and Bark WAV source files are retained in
`assets/atlas/source` and are not part of the active Metro asset map.

## Voice recorder

`RecorderProvider` is mounted above the two-destination application shell. The
native recorder therefore remains alive when the user navigates between Atlas
and Recorder. One provider owns one `AudioRecorder`, and an operation guard
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
user moves between Atlas and Recorder screens; beginning microphone capture
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
src/navigation/              Lightweight Atlas / Recorder destination shell
src/config/                  Public runtime config and visual palette
src/features/atlas/          Atlas screen, sound provider, API contract, and types
src/features/recorder/       Recorder, detail UI, playback, transcription, persistence, and types
src/services/api/            Swappable RealTorch API client abstraction
src/services/audio/          Shared serialized native audio-session coordination
assets/atlas/                Local Atlas image and sound assets
server/                      Development-only OpenAI transcription adapter
```

## Checks

```bash
npm run typecheck
npm run lint
npx expo install --check
```
