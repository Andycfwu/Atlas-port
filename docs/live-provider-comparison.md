# Bounded live-provider comparison — prepared September 10, 2026

## Decision and actual results

**Evidence is insufficient to choose an alternative.** Keep OpenAI as the default
and Deepgram experimental. No provider integration or default change was made.
The user reports improved physical-phone word capture and good short-test saved-
audio identification; neither establishes live speaker separation quality.

New paid calls in this task: **0**. New provider audio usage/cost: **0 / $0**.
OpenAI windowed diarization is now included as an **untested fourth approach**;
see [its bounded evaluation specification](openai-windowed-evaluation.md). The
current runner cannot execute that approach. No new paid calls were made for it.
AssemblyAI and Speechmatics credentials are absent from the configured backend
environment. Only Deepgram is configured. Account entitlement for the candidates
has not been verified. There is no approved human-recorded sample or manually
reviewed reference available for this comparison. No private meeting was opened
or uploaded. The existing generated-voice fixture is insufficient to select a
winner for real people and was not replayed again.

| Provider / requested configuration | Genuine live audio ingestion and labels | Available measured evidence | Limitations / access |
| --- | --- | --- | --- |
| **Deepgram:** existing Nova-3, `version=latest`, `diarize_model=v1`, en-US; existing 300 ms endpointing, filler words retained, no smart formatting, MIP opt-out | Binary PCM over [`/v1/listen` WebSocket](https://developers.deepgram.com/reference/speech-to-text/listen-streaming); per-word numeric IDs, provisional/final events | **Prior work only:** two 19.256 s TTS replays, v1/latest same diarizer; both merged first and quiet third voice as ID 0. Atlas retained 39/39 final word IDs. Quiet statements present, overlap phrase absent, “stop” became “stock.” Human comparison: **not run**. | Key configured; prior resolved diarizer v1 UUID `6ff6f59c-c349-443b-aba1-352de7d75943`. Moving speech-model alias. See [prior evidence](deepgram-merged-speakers.md). |
| **AssemblyAI:** Universal-3.5 Pro Realtime (`speech_model=universal-3-5-pro`), `speaker_labels=true`, `language_codes=["en"]`; other recognition/turn defaults | Binary PCM over [v3 WebSocket](https://www.assemblyai.com/docs/streaming/api-spec/streaming-websocket). [Word IDs and turn-level dominant labels](https://www.assemblyai.com/docs/streaming/label-speakers-and-separate-channels), plus end-of-session corrections | **Not run.** No quality/latency/usage measurements | Key missing. `PENDING` remains unknown; dominant turn label never fills absent word attribution. `Begin.configuration.model` must confirm the requested model before audio. Live labels and final corrections are reported separately. |
| **Speechmatics:** Realtime Enhanced (`model=enhanced`), English, `diarization=speaker`, partials enabled; default sensitivity, no max-speaker cap | Binary raw audio after [`StartRecognition`](https://docs.speechmatics.com/api-ref/realtime-transcription-websocket), `AddPartialTranscript` / `AddTranscript` with [word labels](https://docs.speechmatics.com/speech-to-text/realtime/realtime-diarization) | **Not run.** No quality/latency/usage measurements | Key missing. `UU` stays unknown. Record returned language-pack/orchestrator metadata; do not invent a resolved model build if absent. Default final latency can be longer (documented `max_delay=4` seconds). |
| **OpenAI near-live:** existing `gpt-live-transcribe` immediate text plus `gpt-4o-transcribe-diarize` completed windows | Immediate text uses live ingestion; labels come from the [file Transcriptions API](https://developers.openai.com/api/docs/guides/speech-to-text), **not Realtime diarization** | **Not run.** No measured label delay, coverage, continuity or combined usage | Requires an isolated dual-path adapter, request-scoped attribution scoring and shared-budget accounting. Anonymous labels cannot establish cross-window identity. Two proposed configurations only; no known-speaker enrollment. |

The first three are incremental microphone-capable streaming endpoints. No file-upload
REST endpoint, batch diarization API, or SSE stream of an uploaded file's results
is being presented as live audio ingestion. Both alternatives support English
and signed 16-bit mono PCM at 24 kHz. No early-access model is assumed available.
The selection is based on documented capability, not vendor accuracy claims.

AssemblyAI is included because its acoustic word labels and separate final
refinement can be assessed honestly. Speechmatics is included because it exposes
acoustic word attribution during realtime recognition. There is no exhaustive
market survey, tuning grid, voiceprint enrollment or participant-name hinting.

## Small matrix and published cost, reported before paid execution

The table below covers **only the original three streaming providers**. Do not
add OpenAI calls on top of these reservations: the fourth approach requires a
revised shared-budget preflight described in the linked specification. The $0.15
total ceiling is unchanged; OpenAI is not enabled in the execution runner.

One human-recorded fictional meeting sample, **60–90 seconds**, replayed **twice
per provider**: six calls maximum. If a second recording is needed, it replaces
the second repeat for each provider. This is **two total attempts per provider**,
not two per file. At most two distinct PCM hashes are allowed in the ledger.
Failed or interrupted connections consume an attempt; there are no automatic retries.

| Provider | Published pay-as-you-go estimate | 2 × 90 s audio | Maximum reserved for 2 × 120 s sessions |
| --- | --- | --- | --- |
| [Deepgram](https://deepgram.com/pricing) | Promotional $0.0048/min Nova-3 English + $0.0020/min streaming diarization = **$0.0068/min** | $0.0204 | $0.0388 using regular $0.0077 + $0.0020/min |
| [AssemblyAI](https://www.assemblyai.com/pricing) | $0.45/hr Realtime + $0.12/hr diarization = **$0.57/hr** | $0.0285 before session overhead | $0.0380 |
| [Speechmatics](https://www.speechmatics.com/pricing) | **$0.43/hr** Realtime Enhanced, diarization included; no model-training discount assumed | $0.0215 | $0.0287 |
| **Total** | | **about $0.0704** | **about $0.1055**, within a **$0.15 reservation cap** |

Published rates were checked September 10, 2026. Account-specific pricing,
taxes, remaining credits and rounding are not independently verified. Deepgram
[documents no MIP opt-out surcharge](https://developers.deepgram.com/changelog/2026/3/5);
the existing opt-out remains on. No discount is obtained by changing data-use
settings. No plan purchase, signup, top-up, subscription or billing API is used.
Before using an existing account, confirm sufficient existing credit/budget and
that automatic top-ups are disabled in its console.

The runner expires this price review after September 17 and refuses paid execution
until it is revisited. It reserves conservatively before connecting. Cost output
is an **estimate**, not an invoice. AssemblyAI reports audio and billable session
seconds in `Termination`; those are retained. Otherwise both audio offered and
wall time are reported, and the larger is used for an estimate. No actual cost is
invented when a provider supplies no invoice/usage figure.

## Preparation and safe commands

Everything added is under `server/provider-eval/`, its focused test file, and this
document. No app code, production routes, schema, prompts, dependencies or live
configuration were changed. The scripts import the existing `ws` dependency and
Deepgram URL configuration but do not import the application server or SQLite.
They connect directly to the selected provider in one independent session.

1. In an **existing** AssemblyAI or Speechmatics account, obtain a key with
   streaming access. Do not create an account or purchase a plan for this task.
   Enter keys only in a local editor, never in chat or command-line arguments:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
umask 077
cp -n server/provider-eval/credentials.env.example .env.provider-eval
chmod 600 .env.provider-eval
open -e .env.provider-eval
```

Set `ASSEMBLYAI_API_KEY` and/or `SPEECHMATICS_API_KEY`. The existing Deepgram key
stays in `server/.env`. Both key-file paths are Git-ignored. Do not paste key values
into a test fixture or commit them. No backend restart is required.

2. Record and approve the fictional conversation using the
   [sample/reference checklist](../server/provider-eval/REFERENCE-CHECKLIST.md).
   Save it on the iPhone and share/export that explicitly selected sample to the
   Mac. Supply its local file path. Preparation never scans the phone library:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
node server/provider-eval/prepare.mjs /absolute/path/to/approved-synthetic.m4a sample-1 --approved-synthetic
open -e server/provider-eval/local/sample-1/reference.json
```

`prepare` uses the installed FFmpeg/ffprobe, leaves the input unchanged, rejects
audio over 90 seconds, and creates one shared 24 kHz mono PCM16 derivative. It
adds less than 50 ms of common trailing zero padding if necessary so every
provider receives the same complete 50 ms frames. No gain, denoising, trimming or
provider-specific conversion. Source and derivative SHA-256 hashes, conversion,
and padding are recorded. A repeated sample ID refuses to overwrite its files.

The generated reference is deliberately **unreviewed**: no made-up words,
timestamps or speakers. After listening, enter actual words/turns/approximate
times, mark overlap and uncertainty, confirm human recording, approved providers,
reviewer and actual review date. Another model's answer is never the reference.

3. Preflight each available candidate; omitted mode is also dry-run:

```sh
node --env-file=server/.env --env-file-if-exists=.env.provider-eval server/provider-eval/run.mjs deepgram server/provider-eval/local/sample-1/reference.json --dry-run
node --env-file=server/.env --env-file-if-exists=.env.provider-eval server/provider-eval/run.mjs assemblyai server/provider-eval/local/sample-1/reference.json --dry-run
node --env-file=server/.env --env-file-if-exists=.env.provider-eval server/provider-eval/run.mjs speechmatics server/provider-eval/local/sample-1/reference.json --dry-run
```

Preflight reports credential **presence only**, reference/approval/hash issues,
duration, estimated cost and zero calls. It does not test account access.
After approval/reference/billing checks, replace `--dry-run` with `--execute`
for one provider at a time. Manually repeat once for each provider (or use a second
reviewed sample). Do not reset the ledger to manufacture additional attempts.

4. Inspect `server/provider-eval/local/runs/N-provider.json`. This Git-ignored,
   permission-restricted artifact holds raw timestamped JSON events, all normalized
   revisions/partials/finals, supplied metadata, exact native IDs, transport counts,
   Stop snapshots, estimates and the reference-based report. It never creates an
   Atlas transcript version, meeting or citation. `local/ledger.json` durably
   records attempts; `local/run.lock` prevents concurrent runs. An interrupted run
   retains its reserved attempt. If a process is killed, inspect the PID in the
   lock and confirm it has ended before removing **only that stale lock**; keep
   the ledger. A killed process may lack its result artifact and must be reported
   as interrupted, not scored or silently repeated.

## Harness boundaries and measurement method

- One WSS connection at a time; no hosted service or running Atlas port is used.
  Exactly the same PCM hash is offered in 50 ms frames at approximately realtime.
  A 500 ms pacing slip aborts rather than bursting buffered audio. No extra
  silence is fabricated independently for a particular provider.
- Bounds: 90 s audio, 10 s readiness, 15 s finalization, 120 s total; 256 KiB
  socket/frame threshold; 4,096 events and 8 MiB total received JSON. Frames are
  never silently truncated. Failures are explicit, with no retry or reconnect.
- Deepgram sends `CloseStream` and waits for final results, metadata and clean
  close. AssemblyAI sends `Terminate` and waits for `Termination`, including
  late turns and `SpeakerRevision`. Speechmatics sends `EndOfStream` with the
  actual audio-frame count and waits for `EndOfTranscript`.
- Raw provider IDs, timings, text, unknown markers, final/provisional flags and
  messages are retained before Atlas formatting. Invalid provisional timing is
  flagged for scoring; its original event/text is preserved. The runner does not
  reinterpret turn-level dominance as word attribution. No identity labels are
  transferred between runs/providers or copied onto existing phone transcripts.
- Report first provisional/final **labeled** text arrival both from connection
  creation and from first audio. A provider offering no provisional label has a
  null value, not zero latency. Metadata/build fields remain absent when absent.
- `finalRecords` contains initial/live final evidence; AssemblyAI's optional
  post-stream corrections are in `revisedRecords`. Corrections apply only to an
  exact turn with identical words/times, and never rewrite the original event.
  Improvement only after Stop must not be described as better live labeling.
- Fit one maximum-weight one-to-one mapping from native labels to R1–R3 over
  clear non-overlap reference windows for the entire run; freeze it for later
  revisions. Extra labels stay unmatched. Show the contingency table and possible
  merge/split flags plus per-turn mismatch examples, including returning speakers.
  These are listening-review aids, not automatic verified identities or DER.
- Approximate reference timing enables examples/coverage, not WER. English
  per-turn WER is enabled only for precise reviewed boundaries and verbatim clear
  non-overlap turns; it uses lowercase punctuation-insensitive Levenshtein token
  edits, without numeric equivalence (“40” ≠ “forty”). Unknown/overlap sections are
  shown separately and excluded from attribution scores. No full-recording WER
  or diarization error rate is claimed from these approximate turn annotations.
- The Stop report retains pre-Stop finals, counts late/duplicate/changed finals,
  and checks for lost keys. Review the final-sentence reference and retained
  provisional records for speech never finalized; key retention alone does not
  establish complete text. Failed runs are not quality scores.
- Word recall, quiet statements, negation, overlap, merges/splits/swaps, final
  text, failures and latency must all be considered. Better labels with worse
  substantive word capture do not justify a winner. Client byte counts do not
  prove native microphone capture or waveform equality with an iPhone M4A.

## Verification and remaining gate

`npm test` passed **184/184**, including seven new deterministic tests for
configurations, human-reference gates, quotas, native unknown IDs, invalid interim
timing, exact speaker revision handling, a single global mapping, identical bytes,
explicit Stop, late events, and zero-audio readiness failures. TypeScript and lint
passed. After adding first-audio-relative latency fields and checking Speechmatics
error-subtype handling, the focused seven tests and affected lint checks were rerun.
These use provider doubles, **not real alternative accounts**.

The CLI preflight returned `blocked`, missing human sample/reference and candidate
key, with zero provider calls. Git ignore was checked for `.env.provider-eval` and
local audio. The backend retained its original load timestamp/revision and reported
no restart needed. Existing source fingerprints and auth-foundation work are
preserved. No services were restarted or phone reload requested.

Next action is to supply the approved human sample and at least one alternative
key, complete the listening reference, then run the six-call-or-fewer matrix.
Until then, **no real-speaker winner or integration prompt is justified**. If an
alternative passes a completed comparison without worse word capture, a subsequent
task can add only an optional experimental adapter using the existing capture/
Stop/version boundaries. That future pilot must test actual Expo Go microphone
capture, two/three people, quiet/returning speakers, overlap, immediate Stop,
save/reopen and playback before considering any default change. Offline file
replay alone does not verify that phone path.
