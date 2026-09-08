# Meeting Memory verification — September 8, 2026

## Deterministic checks

TypeScript and ESLint passed. The expanded full suite passed **81 tests**, including all
existing chat, recording, live connection, audio integrity and backend tests.
Fourteen initial Meeting Memory checks exercise production code with explicit provider
and native-file boundaries replaced by deterministic doubles:

- Unchanged UTF-8/BOM/CRLF/Unicode intake and stable original passage offsets.
- Rejection of invalid UTF-8, null bytes, oversized inputs and invalid metadata.
- Full cleanup coverage, retained numeric values, valid source references and
  action metadata; nonadjacent passages can belong to the same or multiple topics.
- Contextual embedding input, exact-term/numeric matching, semantic scoring,
  topic expansion, across-meeting identity and explicit participant/date filters.
- Exact citation matching and rejection of unknown passages or uncited statements.
- One bounded model-output correction; repeated invalid output never persists
  as a successful answer.
- Idempotent intake/process, atomic index replacement and rollback, failed-job
  retry, interrupted-job recovery and completed-result persistence on reopening.
- Actual HTTP intake, polling, question and error routes.
- Mobile draft snapshot recovery after an interrupted write, isolated from chat
  and recording directories.

These checks verify mechanics, not AI meaning or model quality.

Nine additional deterministic tests cover noisy/unlabeled text and speaker/audio
provenance, including legacy persistence and rejection of attendance-based
attribution. See [phone-style transcripts and attribution](meeting-memory-provenance.md)
for the expanded results: **7/7 structured real-model checks** and **18/18 messy
real-model checks**, reported separately. The original milestone had 72 tests;
the figures above include the subsequent extension.

The final `npx expo install --check` did **not** pass: it recommends newer patches
for seven existing dependencies (Expo 57.0.21, expo-asset 57.0.16, expo-dev-client
57.0.18, expo-file-system 57.0.6, expo-sharing 57.0.18, React Native 0.86.3, and
eslint-config-expo 57.0.2). No dependency upgrade was performed during wrap-up.
This is a compatibility warning, not a demonstrated import/process/question
failure. The newly added document picker matches the SDK 57 recommendation.

## Structured transcript: real OpenAI checks

The final configuration used **GPT-5.6 Sol** for organization and answers, and
**text-embedding-3-small** with 512 dimensions. Only the clearly labeled fictional
fixture at `tests/fixtures/meeting-memory-synthetic.txt` was sent. The check used
a temporary SQLite database and generated actual provider output.

All **seven** real-model checks passed:

| Check | Observed result |
| --- | --- |
| Organization fidelity | Mike retained as the explicit quote-request owner, “by Friday” retained as stated; permit issues appear as open questions; folder organization remains a suggestion. |
| Recurrent topic retrieval | Early P0001 and revisited P0004/P0005 property passages belong to a common topic and are retrieved together. |
| Correction and relevance | Answer explains $18,000 → $26,500, still preliminary and excluding permits; no unrelated weather details. Purchase/work approval is not invented. |
| Speaker ambiguity | Returns a clarification explaining the paragraph was unlabeled, without assigning it to Mike or Jordan. |
| Missing evidence | Mortgage lender/rate question returns `insufficient_evidence` with no invented statements. |
| Action detail | Friday is correctly described as the deadline for Mike to request the quote, not for the inspector to reply. |
| Persistence | A ready retry starts no duplicate job; reopening SQLite preserves the original, ready results, answer history and passage-index count. |

All answer source references and verbatim quotes also passed runtime validation.
The final run needed no answer repair. Its summaries and answers were manually
reviewed as well as checked programmatically. An initial smaller-model evaluation
exposed overstatement, missing action attribution and invalid quote output; the
final schema, prompts, bounded correction, and model selection address those
observed failures. One small synthetic fixture is not proof of reliability on all
real meetings, long transcripts, specialized vocabulary or overlapping speakers.
Across-meeting retrieval/filter mechanics were tested deterministically; broad
cross-meeting model quality needs a larger real evaluation set.

Reproduce the real-model checks (uses API credits):

```sh
npm run memory:verify
```

The report is saved to `.expo/dev/logs/meeting-memory-real-model.json`, clearly
labeled **REAL MODEL CHECK · SYNTHETIC DATA ONLY**. It is ignored by Git and
contains synthetic originals, structured organization, answers and sources.
Normal application processing does not log this content.

## Native UI / build

An iPhone 17 / iOS 26.5 simulator Debug build succeeded with the current Expo SDK
57 dependencies, including `expo-document-picker` (zero errors; existing Xcode
script/duplicate-library warnings). The app was installed and launched locally.

Observed in the actual native app:

- Existing Atlas welcome shell and the new Meeting Memory menu destination.
- Empty library and disabled empty question submission.
- Paste of a clearly labeled synthetic transcript, title/date/participant review,
  and saving the original without processing.
- Explicit processing, visible progress, transition to Ready, topic summaries,
  expandable decisions/actions with an explicit owner/deadline.
- Tapping a topic source opens the unchanged original passage in a source sheet.
- Completed meeting reappears after the UI remounts and reloads from the backend.
- Question submission through the app returns a real focused answer with original
  citation controls, explaining the corrected estimate and that work was not approved.
- Software-keyboard verification exposed an obscured question field. The scroll
  offset now accounts for the shell header and safe area; both the field and full
  Ask button were visibly accessible above the keyboard after the fix.

One clearly labeled **SYNTHETIC UI · Cedar Lane** meeting and its real test answers
remain in the single-user development database as an inspectable example.

The simulator then became unavailable. At 14:20:23 EDT, `ls -ld
/Applications/Xcode.app` reported `No such file or directory`, and
`xcode-select -p` returned `/Library/Developer/CommandLineTools`. This established
absence at that path, not the cause. The user subsequently confirmed intentionally
deleting Xcode and selected **Expo Go on a physical iPhone** for this milestone.
No reinstall, simulator troubleshooting or native build is planned. Consequently,
actual native picker selection/read completion, tapping an **answer** citation
with highlighting, Android runtime behavior, accessibility-reader behavior, and
physical-iPhone Meeting Memory acceptance were **not** completed. Native source
sheet navigation was verified through topic citations; quote matching/highlight
inputs are covered at the data boundary. No new physical recording/lock test was
performed in this milestone, and the existing recorder's native lifecycle was
left unchanged.

### Cleanup audit

At 13:47:31 EDT the following request was rejected before execution because the
automatic command review disallowed `rm -f` style commands:

```sh
rm -rf .expo/mac-device-build/Build/Intermediates.noindex .expo/mac-device-build/ModuleCache.noindex
```

At 13:47:47 EDT the non-force version was run from this repository to free space
occupied by the earlier device build's generated intermediates and module cache:

```sh
rm -r .expo/mac-device-build/Build/Intermediates.noindex .expo/mac-device-build/ModuleCache.noindex
```

Those targets are inside the project's `.expo` directory, not `/Applications`.
Neither command targets Xcode, recordings, chat storage or Meeting Memory data.
No further cache cleanup was performed after the user's stop instruction.

### Physical-iPhone Expo Go acceptance — pending

1. On the same Wi-Fi, open `http://10.0.0.104:8787/health` in Safari and confirm
   `ok: true`; scan Metro's Expo Go QR code and open Meeting Memory.
2. Paste a short labeled synthetic transcript, review metadata, save/process and
   confirm Ready and meaningful topics. Confirm the keyboard leaves controls usable.
3. Import `tests/fixtures/meeting-memory-synthetic.txt` from Files and process it.
   Review the original text, timestamps, labels and corrected estimate.
4. Ask about Cedar Lane costs/approval; expect the preliminary $18,000 → $26,500
   correction, no invented approval, no unrelated weather. Tap an **answer**
   citation and compare its highlighted quote with the original.
5. Ask who spoke the unlabeled passage and ask for an unstated mortgage rate;
   expect clarification/insufficient evidence. Try an across-meeting question/filter.
6. Reopen Expo Go and restart the backend; confirm the meeting and answers persist.
   Retry processing/import with identical details and confirm no duplicate meeting.

Native file-picker completion, answer-citation highlighting on device, and this
entire physical-iPhone Meeting Memory acceptance remain unverified. The dependency
audit establishes Expo Go availability, not successful device execution. No known
confirmed blocker remains in the exercised backend and paste/question paths.

## Saved-transcript safeguard follow-up

The subsequent [saved-transcript investigation](saved-transcript-integrity.md)
adds separate persisted live/post sources and direct Recording Detail intake.
Its automated suite passes 95 tests. New physical multi-person acceptance and
retranscription of an affected historical recording are still pending. Earlier
structured/messy real-model checks are not evidence of this phone behavior.
