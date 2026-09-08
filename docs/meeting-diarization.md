# Post-recording speaker diarization — September 8, 2026

## Implemented flow

In **Live Transcription → Saved Recordings → recording detail**, tap **Identify
speakers**. Atlas uploads the actual saved M4A to the existing Mac backend. The
result appears as timed passages with anonymous **Speaker 1**, **Speaker 2**, etc.,
using consistent colors plus visible labels. Unknown and provider-marked overlap
remain explicit; overlapping time ranges are retained and marked in the UI.

Tap **Use diarized version in Meeting Memory** to review the meeting details,
optionally confirm names, then **Save & process meeting**. Names are assigned in
that meeting's review, not inferred from attendance or copied onto live text.
Ask about an anonymous label or a confirmed name and open its cited passages.
Meeting Detail → **Confirm / correct speaker names** lets you change or clear
names later. **Save names & process version** creates/selects a separate source
version and indexes it, preserving earlier originals, indexes and cited answers.
No audio processing is repeated for name changes.

The previous preservation dependency is present in commit `adaad84`:
`finishLiveTranscription()` waits for final events; live and post versions are
separate; metadata mutations are serialized. Those regression checks still pass.
This milestone does not change microphone preparation, capture, Stop, playback,
or which transcript is used by the existing **Add to Meeting Memory** action.
That action still defaults to live text. Diarized intake requires its own explicit
**Use diarized version** action. Original audio/live/post text remains usable
while identification runs or fails. Physical verification of these safeguards
still depends on the phone tests; automated checks alone do not establish it.

## Provider, limits and configuration

Selected API: OpenAI `POST /v1/audio/transcriptions`, model
**`gpt-4o-transcribe-diarize`**, `response_format: "diarized_json"`,
`chunking_strategy: "auto"`. This is the documented specialized diarization model;
the project already uses the OpenAI SDK/backend. It returns speaker labels and
segment start/end times. No known-speaker reference clips, names, prompts,
participant lists, log probabilities or identity recognition are requested.

Official documentation consulted:

- [Speaker diarization and file limits](https://developers.openai.com/api/docs/guides/speech-to-text#speaker-diarization)
- [Diarized response schema](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create)
- [Supported diarization model](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize)
- [Required Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) and
  [Expo Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/)

The provider documents a 25 MB file limit and requires a chunking strategy for
inputs over 30 seconds. Atlas conservatively accepts at most **25,000,000 bytes**
and **20 minutes** per identification. The duration cap is an Atlas milestone
limit, not a claimed universal provider maximum; the consulted guide does not
specify a universal maximum recording duration. Each file is sent as one request
with provider-managed chunking. Atlas never independently splits files or assumes
voice identities match across separate requests. Unsupported files show a clear
message while their originals remain untouched. Meeting Memory retains its
separate 60,000-character / 180-passage intake limit.

Use the existing `OPENAI_API_KEY` in `server/.env` only. No new key or mobile native
dependency is required. The account must have access/quota for the model; that
access was not tested by a real-audio call in this turn. Organization, embeddings
and answers keep the existing Meeting Memory models/configuration. All new phone
code uses existing Expo Go-compatible JavaScript, File System and networking.
No Xcode, simulator or native build was used or is needed for this feature.

## Data and source integrity

- The complete M4A is sent from the phone to the Mac, then to OpenAI on explicit
  identification. File size is checked against the phone's byte count. SHA-256
  of the received audio, recording ID and model determine a stable job/version
  key. Concurrent submissions and retries reuse the same job; a ready result is
  immutable and returned again without another provider call. Failed jobs can
  retry. The backend admits at most two simultaneous identification jobs, with
  bounded requests and visible failures. Restarted processing becomes retryable.
- The result validates shape, unique provider segment IDs, start order, finite
  nonnegative times, positive segment durations and bounds. Provider duration
  must agree with the saved playable duration within one second (container/timing
  rounding tolerance); times are never clamped or synthesized. Overlapping time
  intervals are allowed. Unknown/ambiguous speaker values are retained rather
  than converted into named people. No confidence score is manufactured.
- The raw provider combined text is retained as `providerText`. The diarized
  original used for retrieval consists of each **unchanged segment text**, in
  provider order, separated by newlines. Offsets address these exact strings;
  this is not guessed alignment to the combined text or to another transcript.
  Provider segment IDs and Atlas stable IDs, raw speaker labels, provider overlap
  flags, timing, model/request provenance and audio fingerprint are retained.
- Speaker IDs include the result's recording-specific scope. Provider labels
  such as `A` remain distinct from display labels and user-confirmed names. A
  Speaker 1 in another recording is a different local identity. Names are not
  propagated to other recordings, live transcripts or earlier source versions.
- Phone: cached results and job state live alongside, not over, the existing
  `liveTranscript` and `postTranscripts` in `Documents/recordings/recordings.json`.
  Original M4As remain in their existing directory. An interrupted phone upload
  becomes retryable on reopening; processing jobs resume polling by saved ID.
- Mac: the existing `server/data/meeting-memory.sqlite` (or `MEMORY_DB_PATH`) gains
  `diarizations` and `diarized_selections` tables. It persists jobs, results,
  provenance and selected source versions. Successful imports and name snapshots
  use the existing meetings/passages/chunks/answers storage. It remains a
  **single-user development backend**, without authentication or cloud sync.
- Temporary upload files are removed after normal completion/failure or duplicate
  submission. Abrupt backend termination can leave an OS temporary upload behind;
  no blanket cache cleanup was performed. Saved phone originals are never removed
  by identification. There is no diarization deletion/backup UI in this milestone.

Name-confirmation timestamps are recorded separately from the provider labels.
Repeating a transfer or the same name mapping deduplicates, retaining the first
confirmation timestamp for that stored mapping. A changed mapping creates a new
source entry with the same audio-derived text/times. This simple versioning uses
separate Meeting Memory library entries, rather than a nested version browser.
Changing meeting title/date/attendance for an already imported source returns the
existing source-conflict message instead of overwriting it.

Default cross-meeting questions use the explicitly selected diarized version for
each audio source; correcting or clearing names updates that selection. If that
version is still processing, it is not replaced by an older name mapping. Explicit
meeting filters can still query historical versions. Old answer-source snapshots
retain the names/evidence used at answer time. Anonymous-speaker questions spanning
multiple recordings ask which meeting is intended. For diarized speaker-specific
answers, citation validation requires a quote inside the identified segment and
an anonymous label or its user-confirmed name. A mentioned name in the plain text
cannot substitute for that evidence. Unknown passages cannot support personal
attribution. The model is instructed to preserve overlap/identity uncertainty.

## Verification — mechanical versus real audio

**Passing:** `npm run typecheck`, `npm run lint`, `npm test` (**106/106**) and
`git diff --check`. Metro generated the updated iOS JavaScript bundle without a
native build. The existing backend health endpoint and new route were reachable.

New deterministic tests cover invalid bounds/shapes/duplicate segments, raw text
and overlapping/unknown attribution, distinct IDs across recordings, upload byte
identity, provider request options, in-flight deduplication, failure/restart retry,
name correction/clearing persistence across SQLite reopening, old index/citation
preservation, explicit source selection, wrong-speaker citation rejection and
cross-recording anonymous-label clarification. A complete multipart HTTP → job →
Meeting Memory import → correction test uses the actual routers and storage with
a **mocked provider**. Mobile storage tests ensure diarization cannot overwrite
live/post/audio, and intake tests ensure default live selection remains unchanged.

**Not verified:** recognition/attribution quality on real audio, OpenAI account
access for this model, the physical Expo Go multipart/polling/UI flow, timing
accuracy against actual speech, overlap separation, or long-recording performance.
No real-audio model request was made in this turn. Prior structured/messy text
model checks are not diarization quality checks. Synthetic API responses are test
fixtures and are never displayed in the app as real results.

Diarization can confuse similar voices, split one person into multiple voices,
merge different people, omit words or misattribute overlap. Anonymous labels are
provider estimates; a user-confirmed name does not prove every segment assignment
is correct. This milestone allows name correction, not splitting/merging voices
or editing individual segment attribution. Audio seeking from a citation is still
not connected; recording playback remains available separately.

## Startup and one physical-phone test

Two terminals, reusing current servers or stopping their terminals with Ctrl+C
before starting replacements:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
npm run backend
```

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan --port 8081
```

The backend binds to `0.0.0.0:8787`. Use the same Wi-Fi, allow Expo Go Local Network
access, and check `http://10.0.0.104:8787/health` in iPhone Safari (current Mac IP;
the Metro command recalculates it). Keep the Mac backend running. Scan the Metro
QR in Expo Go. No reinstall or native rebuild is needed. Keep recording in the
foreground; Expo Go cannot apply this project's background recording entitlement.

**Short acceptance test:** Two people alternate stating different property facts
for 20–30 seconds, briefly overlap, then Stop & Save. Reopen and verify the audio,
live and post text remain available. Tap **Identify speakers**; check the timed
anonymous passages against what each person actually said, including overlap.
Tap **Use diarized version in Meeting Memory**, assign names only to voices you
can verify, save/process, and ask “What did [confirmed name] say about the
property?” Open its citations and check the original passage and speaker/times.
Correct or clear one name in Meeting Detail, save/process that version, reopen,
and confirm the correction persists while the earlier answer still opens its
original sources. Report mistakes as observed, including any merged voices or
unrecognized overlap; do not assume a successful request means correct attribution.
