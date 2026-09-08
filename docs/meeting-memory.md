# Atlas Meeting Memory — first milestone

Meeting Memory is available through the existing Atlas menu. Paste or import a
UTF-8 `.txt` transcript, review its title/date/participants, save and process it,
browse topics, and ask within one meeting or across the library. Every answer
statement has tappable source references with an exact original quote. Source
sheets highlight the quote in its unchanged original passage.

The ordinary chat shell still saves local conversations and displays its existing
Atlas-disconnected status. Recording and playback remain on their own screen.
The subsequent [saved-transcript safeguard](saved-transcript-integrity.md) adds
direct Recording Detail → Meeting Memory intake, using saved live text by default.

The subsequent [phone-style transcript and attribution extension](meeting-memory-provenance.md)
adds messy-transcript evaluations and optional supplied speaker/audio provenance.
Attendance, identified speakers and user-confirmed voice names remain separate.

## Run on this Mac

Use Node **24** (tested with 24.14.1; `node:sqlite` emits an experimental warning).
From `/Users/andywu/Desktop/Codex/atlas-port`:

```sh
npm install
npm --prefix server install
```

Keep the existing server-only `OPENAI_API_KEY` and `PORT=8787` in `server/.env`.
The key was present and real-model checks were performed; no key is embedded in
the app or printed in logs. Optional settings are in `server/.env.example`.

Terminal 1:

```sh
npm run backend
```

Terminal 2, using the Mac's current Wi-Fi address:

```sh
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan --port 8081
```

The phone and Mac must share a reachable network. Check
`http://<MAC_WIFI_IP>:8787/health` from phone Safari. Metro on port 8081 and the
backend on port 8787 are separate connections. Meeting Memory uses the existing
`EXPO_PUBLIC_API_URL`; it does not introduce another application server.

**This milestone targets Expo Go on the physical iPhone. No Xcode or custom build
is required.** Use an Expo Go version supporting SDK 57, scan Metro's QR code with
the iPhone Camera, and open it in Expo Go. Allow Expo Go Local Network access and
allow Node incoming connections if the Mac firewall prompts. Do not disable the
firewall. The backend already binds to `0.0.0.0:8787`; the phone must use the Mac's
Wi-Fi address, not `localhost` or `0.0.0.0`. Avoid guest-network client isolation.
A Metro tunnel does not expose the separate backend. On this Mac the Wi-Fi IP was
`10.0.0.104` at handoff; the startup command recalculates it each time.

Ports 8081 and 8787 were already listening at handoff. Reuse those servers, or
stop the existing process with Ctrl+C in its terminal before starting a replacement
on the same port. Keep the Mac awake and both terminals running during testing.

### Expo Go dependency audit

| Dependency / function | Expo Go compatibility |
| --- | --- |
| `expo-document-picker ~57.0.1` / Files import | Included in SDK 57 Expo Go. No project-specific iCloud entitlement is used. `copyToCacheDirectory: true` allows immediate reading. |
| `expo-file-system ~57.0.5` / file bytes and local drafts | Included in SDK 57 Expo Go. Uses `File`, `Directory`, and `Paths`; strict UTF-8 decoding is plain TypeScript. |
| `react-native-safe-area-context ~5.7.0` / safe areas | Included in Expo Go. |
| React / React Native controls, keyboard, modal, fetch | Standard Expo Go runtime; no additional native dependency. |
| OpenAI SDK, Express, SQLite | Backend only; Node 24 on the Mac. No phone SQLite module, API key, or custom native module is needed. |
| `expo-dev-client` already in the project | Optional development tooling, not imported by Meeting Memory or required to open the app with `--go`. |

The picker module loads only when importing. Paste remains the practical fallback
if Files selection is unavailable; it uses the same review/process pipeline.
An older **development build** without the picker would require updating that
binary for file import, but this does not apply to SDK 57 Expo Go. No replacement
dependency is needed for this milestone. Nothing is published or submitted.

SDK 57 references: [DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/),
[FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/),
[safe areas](https://docs.expo.dev/versions/v57.0.0/sdk/safe-area-context/).

### Existing transcription in Expo Go

Foreground microphone capture, live text, Stop & Save, and playback use the
bundled SDK 57 `expo-audio` APIs, including `useAudioStream`; there is no custom
PCM module. The earlier physical-iPhone repair tests confirmed foreground live
text, complete playback, a second recording and navigation within Atlas. Saved
file transcription uses an HTTP upload to the same backend and has no custom-build
dependency. It is separate from Meeting Memory, and was not freshly retested here.

Continuous recording through phone lock or switching apps relies on the project's
native background-recording configuration. Expo Go cannot apply that configuration,
so that behavior is **unsupported for this milestone**; use foreground recording
and stop/save before leaving Expo Go. The live WebSocket draft intentionally pauses
on inactive/background app state even in a custom build. Background live text is
not implemented. See [Expo Audio background configuration](https://docs.expo.dev/versions/v57.0.0/sdk/audio/#recording-audio-in-the-background).

Expo Go and the separate installed RealTorch Atlas app have different local storage
containers; existing audio files do not automatically transfer between them.

## Models and data sent

| Stage | Default model | Input / purpose |
| --- | --- | --- |
| Cleanup and organization | `gpt-5.6-sol` | Entire completed transcript, stable passage IDs, title, date and participant metadata. Produces separate cleaned passages and linked topics/items. |
| Embeddings | `text-embedding-3-small`, 512 dimensions | Original contextual passages with adjacent passages and meeting metadata; questions are also embedded. |
| Answers | `gpt-5.6-sol` | The question and retrieved **original** passages with source IDs and meeting metadata. No web search or external research tools. |

Sol was selected for fidelity to uncertainty, speaker labels, and decision status
after smaller-model checks exposed overstatement and attribution issues. The
embedding model provides compact vectors for the local corpus. These are
configurable through `MEMORY_ORGANIZE_MODEL`, `MEMORY_ANSWER_MODEL`, and
`MEMORY_EMBEDDING_MODEL` on the backend. Changing the embedding model requires
reprocessing affected meetings; mixed embedding models are rejected at query time.

Calls use the existing OpenAI SDK and Responses API with strict JSON schemas and
`store: false`. This setting is not a promise of zero provider retention; provider
account data policies still apply. The backend stores no API key in meeting data.
It does not log transcript content, questions, provider response bodies, or audio.
A bounded correction request may send a failed structured output back with its
original sources to repair invalid references or changed numbers. At most one
correction is attempted, then failure is shown explicitly.

References: [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs),
[embeddings](https://developers.openai.com/api/docs/guides/embeddings),
[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol),
[Expo SDK 57 document picker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/).

## Persistence and boundaries

There is no authentication in the existing project. This is explicitly a
**single-user development workspace**, shared by anyone who can reach this Mac
backend. It is not a multi-user service, a cloud sync implementation, or an
internet deployment. An actual user identity and authorization boundary must be
added before serving independent users.

- Backend: `server/data/meeting-memory.sqlite` plus SQLite WAL/SHM files (ignored
  by Git). `MEMORY_DB_PATH` can point to another persistent absolute path.
- SQLite contains original transcripts, metadata, stable passages and offsets,
  cleaned versions, topics, item sources, vectors, processing state, model names,
  and completed questions/answers with cited-source snapshots.
- Mobile intake draft: `Documents/atlas-meeting-intake/draft-0.json` and
  `draft-1.json`, alternating snapshots using the same Expo File System approach
  as local chats. A failed write retains the previous readable snapshot.
- The completed library is loaded from the backend on reopening. It is not an
  offline mobile cache. Existing chat and audio directories are separate.

The original string is never trimmed, normalized, or replaced. UTF-8 import is
validated strictly, including Unicode/BOM handling, and retains supplied line
endings. Stable `P0001`-style IDs and UTF-16 start/end offsets refer to exact
original substrings. Labels/timestamps stay in the text; participants do not
supply missing speaker identities. Cleaned text is never used as the source for
citations.

Identical imports with the same details deduplicate by a content fingerprint.
An optional `sourceKey` makes saved-recording imports idempotent. Recording-source
provenance also participates in the fingerprint, so independently captured live
and post-recording versions cannot collapse into each other.
Repeated process requests share the active job; ready meetings are unchanged
unless explicitly reprocessed. Processing commits topics and the complete index
in one transaction, replacing passage rows by `(meeting_id, passage_id)`.
A failed attempt cannot leave a partially ready index. On backend restart,
interrupted jobs become failed with a retry message; original text remains saved.

Back up the SQLite database with the backend stopped (or a SQLite-aware backup
that includes WAL contents). There is no encryption-at-rest layer, deletion UI,
migration UI, or backup service in this development milestone.

## Retrieval and evidence

Passages group adjacent source lines up to about 1,100 characters. Embeddings
include the original neighboring passages, not isolated sentences or summaries.
Retrieval combines cosine similarity with Unicode-normalized keyword overlap,
weighting numeric identifiers more heavily. Explicit meeting, exact participant
(case-insensitive), and date filters apply before ranking.

The highest-ranked passages expand through topic source links, bringing back
nonadjacent recurrences and later corrections. Neighbor context is then included.
Source IDs and meeting IDs survive ranking, expansion, generation and display.
The answer prompt excludes unrelated small talk and distinguishes discussion,
proposals, confirmed decisions, actions and uncertainty. Insufficient evidence or
speaker ambiguity produces an explicit status or focused clarification.

Runtime validation requires complete cleanup coverage, retained numeric tokens,
valid sources on every topic/item, and exact original quote matches on every
answer statement. Action owners and deadlines must appear in cited originals.
Structural checks cannot prove all semantic claims: users should still inspect
citations, and broader real-meeting evaluation is required before relying on it.

## Limits

- At most 60,000 transcript characters / 240,000 imported UTF-8 bytes per meeting.
- One backend process and one local user. Up to two meeting jobs and two questions
  in flight; no durable worker queue or multi-process coordination.
- SQLite stores vectors as JSON and ranks them in memory. This is for a small
  development library, not a large corpus or production vector database.
- Retrieval uses six ranked seeds and a 72-passage context budget. The UI reports
  truncation if topic expansion exceeds that budget; filtering can narrow scope.
- Processing has a six-minute abort deadline and each question a two-minute
  deadline. Clients time out with recovery guidance; they do not display mock
  answers or claim successful processing after a failure.
- Model cleanup, grouping and answer meaning remain probabilistic. Exact quotes
  are checked mechanically, but a quote can still be interpreted incorrectly.

## Saved phone transcript integration

Recording Detail now offers **Add to Meeting Memory**. The independent adapter
`src/features/memory/memory.recording.ts` selects the persisted live text when
nonblank, otherwise the latest successful saved-audio transcription. It transfers
that exact original string to a dedicated review screen; it does not replace the
separate paste/import draft. Title, date and attendance can be reviewed. Original
text is read-only. No source is trimmed, cleaned, guessed, or automatically merged.

The adapter calls the existing `create(MeetingIntake)` / `process(meetingId)` API.
A stable key `recording:<recordingId>:<sourceKind>:<traceId-or-legacy>` prevents
repeated transfer from creating duplicates. Source metadata retains kind,
recording ID, trace ID, known model and completion/partial state in SQLite and
answer-source snapshots. Each recording ID already combines creation time with a
random suffix. Changed details under the same source key return a visible conflict;
use the existing meeting instead of silently replacing its metadata.

Only the selected text and metadata are sent to the Mac; M4A and alternative text
versions remain on the phone. Existing participant/speaker separation applies.
The live stream's item IDs do not establish human speakers or audio timing, so
this adapter supplies no invented speaker or timed segment records. Real
alignment/diarization is still future work. Partial live sources are marked for
review. Sources above the existing 60,000-character limit fail visibly, never
silently truncate. See [investigation and verification](saved-transcript-integrity.md).

The future generic chat boundary remains `atlas.service.ts`; it can eventually
route meeting questions to this service. The current chat shell does not call AI.

## Verification

```sh
npm run typecheck
npm run lint
npm test
npm run memory:verify
npm run memory:verify:messy
```

`npm test` is deterministic and includes HTTP routes, UTF-8 integrity, filtering,
contextual retrieval, source validation, bounded repair, duplicate prevention,
transaction rollback, interrupted processing, restart persistence, and the
existing chat/recording suites. `memory:verify` is a separate opt-in **real API**
check using only `tests/fixtures/meeting-memory-synthetic.txt`. It writes a clearly
labeled synthetic report to `.expo/dev/logs/meeting-memory-real-model.json` and
uses a temporary database; it does not import private recordings or production
meeting data. See the verification notes for actual results and remaining device
coverage.

`memory:verify:messy` separately uses the two noisy/unlabeled fixtures, including
cross-meeting answers. Both scripts make real model calls; neither substitutes
deterministic doubles for model-quality evaluation. Supplied speaker/segment
metadata also follows processing, contextual embedding input and retrieved answer
sources, while original audio remains on the phone. See the extension notes for
the exact optional data contract and current timing limitations.
