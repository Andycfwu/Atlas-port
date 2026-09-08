# Phone-style transcripts, attribution, and audio provenance

## What changed

Meeting Memory now evaluates noisy, unlabeled text as well as structured meeting
transcripts. The same intake, processing, original-passage retrieval and cited
answer pipeline is used. No new native dependency, recording change or diarization
service was introduced. Expo Go remains the mobile target.

Two additional clearly labeled **fictional** fixtures model phone transcription:

- `tests/fixtures/meeting-memory-messy-unlabeled.txt`: no timestamps or speaker
  labels; six contextual passages with repeated property/photo/weather topic
  changes, "drain age", Cedarline, unresolved "easement/east mint", interrupted
  conditions, a corrected cost and an unlabeled first-person action. Mike is
  mentioned as someone who might know an inspector, not as the voice speaking.
- `tests/fixtures/meeting-memory-messy-flat.txt`: an almost unpunctuated transcript
  without turn boundaries; two contextual passages with B-17/B-71 confusion,
  a corrected allowance, unresolved "soft clothes/soft close" and "walnut/wall
  nut", interruptions, repeated topic changes and an unnamed commitment without
  a deadline.

No private phone transcript or audio was uploaded for these checks. They test
real model behavior on synthetic text; they do not measure speech-recognition
error rate or prove quality on actual recorded meetings.

## Meeting attendance is not speaker identity

`participants` remains meeting-level attendance metadata and a meeting filter.
It never populates speaker records or segment assignments.

- **"What did Mike and I discuss about drainage?"** is a meeting-level question.
  The model may summarize the selected meeting's discussion in impersonal terms,
  without identifying which voice was Mike or the user.
- **"What did Mike say about drainage?"** requires speaker evidence. An unlabeled
  meeting with Mike on its attendance list returns explicit insufficient
  attribution or a focused clarification, rather than presenting the meeting's
  discussion as Mike's words.
- An unlabeled "I'll email the inspector" can still yield a useful action item
  with `owner: null`. A deadline is kept only when stated.

Answers now carry `scope`, `requestedSpeaker`, and an optional `limitation`, which
the phone displays. Personally attributed citations carry `speaker` and optionally
`segmentId`. Runtime validation requires either an exact quote containing the
speaker label on that same original line, or a quote contained within a supplied
segment linked to that speaker. It rejects adjacent unlabeled text, a mere name
mention, another meeting's mapping and missing attribution. Common direct speaker
question patterns are also checked independently of the model's scope choice.
Unknown-voice replies explicitly explain that attendance does not identify voices.

This is not a complete natural-language proof system. Other question wording is
classified by the model, and semantic interpretation of quotes and action owners
remains probabilistic. Correct source offsets and labels alone cannot prove that
every paraphrase is correct.

## Optional supplied provenance

The `MeetingIntake` and saved meeting payload support optional `speakers` and
`segments`. Missing provenance defaults to empty arrays; existing records remain
readable without a destructive migration. Plain paste/UTF-8 import does not invent
entries for attendees, parse text into estimated audio times, or fabricate labels.

| Field | Meaning |
| --- | --- |
| `speakers[].id` | Stable speaker ID local to one meeting, never a cross-meeting identity. |
| `speakers[].label` | Supplied label, including an anonymous label such as Speaker A. |
| `speakers[].nameConfirmation` | Null, or a separately supplied `{name, confirmedAt}` user-confirmation record. An attendee name is not confirmation. |
| `segments[].id` | Stable supplied speech-segment ID, scoped to the meeting. |
| `segments[].start/end` | Exact UTF-16 offsets into the unchanged original text, not time. |
| `segments[].speakerId` | Null when unknown, otherwise a reference to that meeting's speaker record. |
| `segments[].attribution` | Null, `transcript_label`, `diarization`, or `user_confirmed`; the producer must supply the actual evidence source. |
| `segments[].audio` | Null, or `{recordingId, startMs, endMs, timingSource}`. Times are real offsets from the beginning of the referenced audio file. |
| `audio.timingSource` | `transcription`, `alignment`, or `user_confirmed`; never estimated from text length or word counts. |

Intake validates references, unique IDs, character boundaries, nonoverlapping text
spans and positive audio ranges. A `transcript_label` segment must actually begin
with that label and stay within its line. A diarization assignment requires an
audio reference. Neither this schema nor the current backend verifies the
existence of a phone-local file or measures the accuracy of supplied time offsets;
the future producer must do that against the preserved recording.

Provenance persists in SQLite, follows retrieval, and is saved with answer-source
snapshots. Relevant speaker evidence is included in contextual embedding input;
organization receives supplied provenance and answering receives retrieved source
provenance. Opaque recording IDs and supplied offsets may go to the model, but
Meeting Memory sends no audio or local audio file URI. Source sheets display
supplied labels, explicit name confirmations and audio references. Seeking audio
is clearly marked as not connected.

Retrying an identical intake reuses the meeting. An import that tries to change
existing speaker/audio provenance fails with `MEMORY_PROVENANCE_CONFLICT`; it does
not overwrite evidence or create a second index. Editing confirmations needs a
future explicit review/update path; this milestone adds the data contract, not a
speaker naming editor. The organization model cannot emit or overwrite these
provenance fields.

## What the recorder preserves (updated for the saved-transcript safeguard)

Inspection covered `RecorderProvider.tsx`, `recorder.storage.ts`,
`recorder.types.ts`, `recording-transcription.service.ts`, `server/server.mjs`,
and both sides of the live transcription protocol.

| Data | Current availability |
| --- | --- |
| Complete audio | The Expo Audio high-quality M4A is saved under the phone app's Documents/recordings directory. Saving copies the encoded file, validates the playable duration/copy, and persists metadata before removing the duplicate source. Recovery paths preserve failed recordings. No Meeting Memory code changes this. |
| Whole-recording metadata | `SavedRecording` retains ID, filename, URI, title, creation time and measured `durationMillis`. Creation time is assigned during persistence; it is not an exact first-sample timestamp. |
| Completed transcript | `/transcribe` calls `gpt-transcribe` and returns its exact text (no trimming except blank validation). The phone retains successful results in `postTranscripts`, with the latest available as the legacy `transcript` field. It does not save provider segment/word timing or speaker output. Backend upload files are temporary and cleaned after the request. |
| Live draft | `gpt-live-transcribe` deltas/finals are ordered by item IDs and commit order. Stop waits for finalization, then stores the concatenated text and per-item accumulated deltas/final strings in `liveTranscript`. Item boundaries are processing turns, not established human speaker changes. Pre-safeguard live drafts were never persisted. |
| Real segment timing | Not durably preserved or associated with transcript passages. PCM sample-rate and diagnostic elapsed times exist transiently, but they are not text-to-audio alignment. The live/file starts are separate operations, so elapsed live time cannot safely become a file seek offset. |
| Speaker identity/diarization | Not produced or persisted. Mono live PCM, participant names, turn IDs and order do not establish who spoke. |
| Supplied text timestamps | Meeting Memory preserves them literally if present, but does not treat them as verified links to an audio file. |

The earlier user-reported Expo Go checks verified complete playback and navigation
during recording. This extension did not repeat those device tests or test new
recordings, locking, background behavior, segment alignment or diarization.

## What future diarization would require

1. Use the preserved completed M4A and its stable recording/installation identity.
   Do not replace it with the provisional live draft or rewrite existing files.
2. Add a separate backend operation that returns actual speaker-labeled segments
   and real start/end times. The current OpenAI file-transcription documentation
   describes `gpt-4o-transcribe-diarize` with `diarized_json`, containing speaker,
   start and end fields; audio longer than 30 seconds requires a chunking strategy.
   Speaker labeling is not provided by the current Realtime transcription path.
3. Persist that output and its provenance/version. Establish exact text offsets
   for its own original transcript. If reconciling with an existing transcript,
   align to that original or retain a separate version; never reuse mismatched
   offsets after text changes. Account for each chunk's offset in the full file.
4. Keep voices anonymous initially. Add an explicit user review step to map a
   voice label to a name. Store confirmation separately from attendance, and scope
   anonymous labels independently per meeting.
5. Validate against physical-phone audio, especially overlapping voices, noise,
   speaker changes, omitted words and boundaries. Audio seeking and confirmation
   changes also need tests and retrieval/index invalidation rules.

Source: [OpenAI file transcription — speaker diarization](https://developers.openai.com/api/docs/guides/speech-to-text#speaker-diarization).
This is a future integration outline; no diarization calls or native rebuilds were
performed, and voice identity or segment timing quality has not been verified.

## Results, kept separate

Final runs used `gpt-5.6-sol` for organization/answers and `text-embedding-3-small`
for embeddings. Real-provider results were inspected directly as well as checked
programmatically. Source quotes were checked against exact original passages.

| Evaluation | Final observed result |
| --- | --- |
| Structured transcript | **7/7 checks passed**: repeated property discussion, corrected estimate, explicit decisions and named action, ambiguous voice refusal, unsupported question and persistence. |
| Messy unlabeled paragraphs | **8/8 checks passed**: useful property topics/answers, $18,000 → $26,500 correction, unresolved easement wording/conditions, unknown action owner with Friday deadline, refusal to identify Mike, no unrelated small talk, retry consistency. |
| Messy flat transcript | **8/8 checks passed**: useful topics despite absent turn boundaries, $15,000 → $17,800 correction, unresolved hinge/finish wording, unnamed action without invented deadline, refusal to identify Mike and unsupported financing answers. |
| Across the two messy meetings | **2/2 checks passed**: distinct meeting citations and consistent database reopening. |
| Deterministic regression suite | **81 tests passed**, including nine new tests for messy intake/retrieval mechanics, attribution boundaries, optional name confirmations/audio references, persistence and legacy data. These do not establish model quality. |

Both final real-model runs required zero citation repair attempts. Manual review of
the first messy run found a semantic classification problem: "no work was approved"
was labeled as a decision, and a lot-number clarification became a decision item.
The instructions now reserve decisions for explicit concluded choices; expanded
checks and the rerun verified discussion/status labels for those cases. A separate
wording assertion was corrected to accept the valid sentence "No owner name or
deadline was stated." No application fact was changed to satisfy that assertion.

Run separately:

```sh
npm run typecheck
npm run lint
npm test
npm run memory:verify
npm run memory:verify:messy
```

The last two commands use real API credits and isolated temporary SQLite databases.
Their synthetic-only reports are `.expo/dev/logs/meeting-memory-real-model.json`
and `.expo/dev/logs/meeting-memory-messy-real-model.json`, ignored by Git. They do
not add test meetings to the user's development corpus.

Remaining coverage: actual phone transcript quality, physical-iPhone Files import
and source-sheet/keyboard behavior after these changes, broader languages and
vocabulary, long meetings and larger corpora. Diarization, audio seeking and a
speaker-confirmation editor remain unimplemented. Previously noted Expo patch
recommendations remain; no package upgrade or Xcode/cache work was performed.

The [saved-transcript safeguard](saved-transcript-integrity.md) now connects saved
live text directly to Meeting Memory and preserves separate post-recording
versions. It does not add diarization, timing inference, or new native dependencies.
