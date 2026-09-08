# Atlas source-based topic pipeline — 8 September 2026

This adapts section 12 of the founder's `atlas-transcript-pipeline.html` to the
existing Expo/Express/SQLite application. The document's “Current” sections describe
another system. Its embedded scripts and machine-specific commands were not run.
The [verbatim grouping prompt](reference/founder-grouping-baseline.txt) is a
comparison baseline, not the prompt used by Atlas. The six-sentence example was
recreated as an explicitly synthetic JSON fixture; its authored grouping is not a
claim about model behavior.

## Changes from the previous Atlas pipeline

| Handoff requirement | Implementation |
| --- | --- |
| Immutable text and source identity | `memory_revisions` stores exact originals, metadata/provenance, a content hash, immutable revision ID, and source units with UTF-16 offsets. Meeting IDs and recording IDs remain independent of titles/paths. |
| Original evidence chunks | `pipeline.mjs` partitions text, validates model-selected source IDs, and assembles chunk bodies from original substrings in source order. Nonadjacent spans have explicit links and a newline separator; no body is summarized, normalized, or silently truncated. |
| Versioned grouping prompt | `grouping-prompt.mjs` contains Atlas v1 instructions and a strict response schema. Transcript JSON, prior topic catalog, and repair output remain untrusted data in the user input; instructions are separate. |
| Recurring topics and overlap | Bounded windows include a read-only neighbor on either side and a rolling catalog of earlier titles plus first/latest excerpts. The model may continue an existing topic. A primary source unit is selected only in its own window and may belong to at most four topics. |
| Coverage and omissions | Every unit must be selected or explicitly marked `noise`/`small_talk`, never both. Numbers and common negation/qualification terms block omission. The phone exposes an omission review with original-source links. Omitted text remains available to keyword retrieval. |
| Derived notes | Cleanup, summaries, proposals, decisions, questions and action items remain separately labeled, with their own source references. Notes are generated per bounded window; they are not embedding/chunk bodies. |
| Atomic publication | `memory_jobs` saves stage, attempt, run token, lease and per-window checkpoints. New chunks/vectors are validated in a transaction before a generation becomes current. Failed replacements leave the previous generation searchable. |
| Stable citations | Each new answer citation carries meeting, revision, generation and source IDs. Original source snapshots remain in saved answers. Exact revision/source and immutable chunk endpoints never use fuzzy aliases. Missing/deleted sources return explicit errors. |
| Hybrid retrieval | Embeds generated title + original chunk body. Cosine similarity combines with Unicode keyword matching and extra weight for numeric identifiers. Current published generations are searched; complete chunks and related topic parts precede neighboring context. |
| Deletion boundary | Meeting deletion cascades through revisions, generations, chunks, vectors and jobs, and deletes every saved answer containing that meeting, including mixed-meeting answers. Recording audio is an independent phone asset. |

The chat shell, recording screen, audio capture, live connection and Stop barrier
were not changed for this milestone. The existing **Add to Meeting Memory** adapter
still chooses exact saved live text by default, with saved-audio transcription as
the fallback. Neither version is merged or overwritten. Existing diarization work
is preserved, but no diarization/audio-upload work was added to this text milestone.

## Models, bounds and configuration

- Grouping, derived organization, answers: existing **`gpt-5.6-sol`**, reasoning `low`.
- Embeddings: existing **`text-embedding-3-small`**, **512 dimensions**, float output.
- Processor: `atlas-source-topics-v1`; grouping prompt: `atlas-grouping-v1`;
  notes prompt: `atlas-notes-v2`; splitter: `intl-sentence-bounded-v1`;
  embedding response contract: `openai-float-v1`.
- Generation identity includes the complete processor configuration, model names,
  dimensions, normalization contract, prompt versions, limits and immutable revision.
  Explicit reprocessing after successful publication creates new immutable IDs.
- Inputs retain the existing **60,000 UTF-16 character / 240,000 UTF-8 import-byte**
  limit. This is a deliberately bounded development milestone, not unlimited upload.
- Units prefer real segment/line boundaries and ICU sentence boundaries, with a
  common-abbreviation guard and whitespace/code-point splits at **600 characters**
  for unpunctuated or very long runs. Offsets cover every original character.
  Sentence detection is heuristic; it is derived segmentation, not rewritten text.
- Primary model windows: at most **80 units / 16,000 serialized UTF-8 bytes**;
  complete JSON requests, including catalog/context/repair: at most **64,000 bytes**.
  Byte bounds are conservative token upper bounds for text; instructions and output
  have separate headroom. No tokenizer dependency was introduced.
- At most **80 source topics**. Oversized catalogs/requests fail visibly instead of
  losing text. Catalog excerpts are explicitly partial aids for cross-window linking;
  only chunk bodies contain all selected original source text. Unlike the reference’s
  normalized single-space joins, Atlas retains source whitespace and inserts a newline
  only between nonadjacent selections.
- Chunk bodies split at source-unit boundaries at **6,500 UTF-8 bytes or 64 units**, retaining
  the same topic ID and ordered part numbers. Embedding inputs must be nonempty and
  at most **8,000 bytes**, below the provider's documented 8,192-token limit.
- Embeddings use batches of 32. Response count, integer index association, exact
  dimensions, finite components and nonzero finite norm are validated. Retrieval
  calculates cosine explicitly; it does not assume every returned vector is unit
  normalized. Model/dimensions/version/normalization mismatches require reprocessing
  selected meetings; incompatible spaces are never silently combined.
- Retrieval takes six ranked seeds and admits complete supporting chunks within
  a **42,000-byte compact-evidence budget**. Related topic parts precede neighbors.
  If a complete chunk/context cannot fit, `retrievalTruncated` is set; narrow the
  question/meeting filter. A question with no indexed or keyword evidence returns
  insufficient evidence without a model answer; an empty index needs no query embedding.
- One backend process, up to two active processing jobs and two questions.
  Processing aborts after **15 minutes**; questions after two minutes. A provider
  call has its own timeout and no SDK automatic retries. Each invalid grouping,
  organization or answer response permits at most one explicit repair.

The defaults were kept because the prior Atlas checks selected Sol for uncertainty
and attribution fidelity, and nothing in the handoff demonstrates a benefit from
changing to its nano/large-embedding combination. No model comparison was launched.
Backend overrides remain `MEMORY_ORGANIZE_MODEL`, `MEMORY_ANSWER_MODEL`, and
`MEMORY_EMBEDDING_MODEL`; credentials stay in `server/.env`.

Provider inputs: completed text windows, supplied metadata/identity evidence,
neighbor context, prior generated topic titles/excerpts, and bounded repair data;
embedding inputs are titles + original evidence and user questions; answer inputs
are questions plus retrieved original evidence and meeting metadata. **No audio is
sent by this pipeline.** Responses use `store: false`, which is not a guarantee of
zero provider retention. No private transcript or secret is printed in diagnostics.
See [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings)
and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Migration, revisions and recovery

The existing database remains `server/data/meeting-memory.sqlite` (or
`MEMORY_DB_PATH`), including WAL/SHM. New tables are additive. On first migration
of a nonempty library, SQLite `VACUUM INTO` makes a consistent
`<database>.pre-source-v1.bak` snapshot. Existing originals, legacy `P0001` offsets,
derived notes, vectors, answers, diarization selections and recording metadata
are retained. Ready legacy indexes (and retained valid indexes from a failed/interrupted older
attempt) become explicitly marked legacy generations;
no model call or automatic reprocessing occurs during migration. Use **Reprocess
meeting** to build source-based chunks for an older meeting.

A new text revision is immutable and belongs to the same meeting ID. Supplied
speaker/audio evidence must be supplied and validated again; it is never copied
onto changed text through guessed alignment. The currently published revision
continues to serve questions until the desired replacement is fully published.
Titles/date/attendance are snapshot metadata in each revision, not resource keys.

`memory_jobs` checkpoints are committed after each complete grouping + notes window.
A backend restart marks an in-flight job failed/interrupted. **Retry** resumes its
completed windows with the same generation identity; a partly finished window is
repeated. Embedding failures repeat the embedding stage (vectors are not published
piecemeal). Completed retries do not duplicate meetings or indexed sources. A run
token and desired-revision check prevent superseded jobs, late failures and duplicate
services from overwriting newer work. Leases expire after 16 minutes. This is durable
single-process recovery, not a production distributed job scheduler.

Saved answer sources remain exact immutable snapshots. Legacy citations without a
revision ID remain their originally saved text; they are not redirected through
new `P0001` lookups. New direct reads require explicit revision/source or chunk IDs.
No historical content is silently reinterpreted as a similar current passage.

## API additions

All paths are under `/v1/memory`; all existing intake/process/question APIs remain.

- `GET /meetings/:id` includes current source topics, chunks and omission ledger;
  vector arrays are excluded from this phone response.
- `POST /meetings/:id/revisions` accepts a complete text intake payload and saves a
  new desired revision. Follow with the existing `POST /meetings/:id/process`.
  This is an integration endpoint; there is no transcript-editing UI in this milestone.
- `GET /meetings/:id/revisions/:revisionId` reads that immutable original and units.
- `GET /meetings/:id/revisions/:revisionId/sources/:sourceId` resolves an exact unit.
- `GET /meetings/:id/chunks/:chunkId` reads an immutable chunk and its source links.
- `GET /meetings/:id/generations/:generationId` reads historical processing metadata
  and derived content.
- `DELETE /meetings/:id` deletes the meeting and its derivatives/retained answers.
  There is no phone deletion UI yet. Deleting a phone recording does not delete its
  independent imported Meeting Memory copy; the two stores are intentionally separate.

## Deliberate deviations and remaining work

No authentication exists. This remains an explicitly **single-user development
workspace** shared by anyone who can reach the backend. IDs are not access tokens,
there are no pretend tenant filters, and no cross-tenant security claim is made.
Production needs authenticated ownership checks on search and every direct source,
chunk, revision and audio read; revocation, retention policies, encrypted storage,
backup lifecycle, deletion auditing, a real job queue and corpus-scale vector storage.
SQLite JSON vectors and in-memory ranking suit a small development library only.

Deletion removes live database rows and retrieval results, but **does not securely
erase SQLite free pages, WAL, exported data or pre-migration backups**. Production
retention/erasure remains work. Preserve the migration backup until reviewed; manage
its retention explicitly. Private database/backup files are ignored by Git.

No Limitless, QMD, Python workers, MCP server, cloud hosting, audio object store,
automatic research, new native dependency or model migration was introduced. Rolling
catalog matching can miss a cross-window topic recurrence; grouping and omission
quality remain probabilistic. Structural validation cannot prove semantic fidelity.
Short meaningful content is conservatively retained, but the omission review and
real-model audits remain necessary. Notes generated in separate windows may repeat
a topic even when the source-topic chunk catalog correctly joins it.

No timestamps, speaker labels, confidence, names or audio alignment are fabricated.
“What did Mike and I discuss?” uses attendance as a meeting filter. “What did Mike
say?” still requires actual source attribution; otherwise the answer explicitly
acknowledges insufficient attribution. Any speaker/timing provenance supplied by an
existing source version follows its exact spans into chunks and retrieved evidence.

## Startup and one phone acceptance test

No dependency updates were needed. Use the installed Node 24 environment.

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

Reuse running servers instead of starting duplicates. The backend binds to
`0.0.0.0:8787`; the phone must use the Mac's Wi-Fi IP, currently `10.0.0.104`, not
localhost. On the same Wi-Fi, phone Safari should open
`http://10.0.0.104:8787/health` and show `ok: true`. Allow Local Network access in
Expo Go and Node incoming connections if the Mac prompts. Keep the Mac awake.
Metro connectivity alone does not prove backend connectivity. Use Expo Go's SDK 57
runtime, scan Metro's QR code, and reload the app. No Xcode, simulator or native build.

One short test: keep Expo Go foreground, record two people discussing a fictional
property estimate, change topics briefly, then explicitly correct that estimate.
Stop & Save, reopen, check saved live text and audio, and tap **Add to Meeting
Memory**. Confirm it selected the live source, process, open **Topic chunks**, and
check that both estimates appear with original references. Ask what changed, then
tap the answer citation: verify the exact original wording/offsets. Ask “What did
Mike say?” on an unlabeled source and expect insufficient attribution. Reopen the
meeting to confirm it persists. Physical-phone behavior for this change remains
unverified until that test is completed.

Expo Go supports this text pipeline's existing file picker/filesystem/React Native
controls. Foreground live recording remains supported; continuous background audio
through lock/app switching depends on native configuration Expo Go cannot apply.
Stop/save before leaving Expo Go. No device-tooling troubleshooting was attempted.

## Verification performed

Final full deterministic pass: **119/119 tests passed** (`npm test`). A subsequent
focused pass of **14/14 pipeline tests** added one multi-window checkpoint/continuation
regression; **120 distinct tests** passed across these bounded runs. TypeScript
(`npm run typecheck`), Expo lint (`npm run lint`) and `git diff --check` passed.
The suite includes the six-sentence fixture, punctuation-free/multilingual and
long-unit boundaries, short affirmatives/negations versus noise, strict grouping
shapes/IDs/coverage, prompt-injection separation, source reconstruction, vector
index association/dimensions/nonzero norms, same-length/shorter revisions, historical
source resolution, failed/superseded publication, concurrent attempts, durable retry,
restart, migration backup, deletion, empty indexes and embedding configuration changes.
Existing shell, recording integrity, final-live-event save, separate live/post
persistence, and live-default Meeting Memory transfer regressions passed as well.
Those recording tests use deterministic doubles; they are not a new phone recording.

The opt-in real-model evaluator is `npm run memory:verify:sources`. It uses temporary
SQLite databases and sends only four named synthetic fixtures. Reports are local,
Git-ignored, and contain synthetic text only:

- `.expo/dev/logs/source-pipeline-real-model.json`: initial full evaluation, including
  its recorded flat-transcript failure (retained, not disguised as a passing run).
- `.expo/dev/logs/source-pipeline-real-model-messy-flat.json`: targeted real-model
  recheck after the diagnosed validation fix.

| Real-model fixture | Final checked result | Human review of omissions/meaning |
| --- | --- | --- |
| Founder six sentences | 3/3 checks passed: processing, recurring ID topic/retrieval, grounded cited question | Only “Testing one two three.” omitted. Identity discussion retained early and late; pilot dates/teams retained separately. |
| Structured named/timed transcript | 3/3 passed | Only the synthetic disclaimer omitted. Both drainage estimates, permit exclusion, preliminary status, inspection-dependent decision and Mike's Friday action remain supported. Weather was absent from the property answer. |
| Messy unlabeled transcript with paragraphs | 4/4 passed, including insufficient speaker attribution | No source units omitted. Corrected $18,000 → $26,500, CL-204 versus CL-240, no approval, proposed waiting, and the unlabeled Friday action remained distinct. Participants did not become speakers. |
| Flat unpunctuated transcript | 5/5 passed after fix, including unsupported-bank question | No units omitted. $15,000 → $17,800 remained preliminary, B-17/B-71 stayed distinct, no order was asserted, and the action owner/deadline stayed unknown. Derived notes preserved soft clothes/soft close, walnut/wall nut and the unfinished condition as unresolved. |

That is **15 final real-model checks across four synthetic cases**, not a claim that
the initial full run passed. The original flat failure was reproducible: a newly
added broad colon check interpreted ordinary cleaned punctuation (“Harbor Court lot
B-17:”) as an invented speaker label. The fix checks actual identity/timing markers,
with a focused regression proving that prose punctuation passes while fabricated
`Mike:`, `Speaker 1:` and `[00:30]` fail. The failed fixture was rerun; the other real
model calls were not needlessly repeated. All four real grouping outputs were also
revalidated/reassembled against the final conservative omission and 64-unit chunk
bounds without further model calls; their evidence stayed complete.

This was an omission/content review as well as JSON/citation checking. It remains a
small synthetic evaluation: **no real phone audio/text quality run, no real-model
long multi-window evaluation, and no broad recall benchmark** were performed.
Long-window coverage, continuation mechanics and publication failure paths are
covered deterministically. Cross-window topic matching, paraphrase fidelity and
speaker interpretation can still be wrong; inspect original citations.

The running backend health endpoint passed and its list showed **six existing
meetings with published generations and none processing** after additive migration.
The existing Metro Expo Go iOS launcher returned HTTP 200 with the required iOS
platform header/query. An initial generic curl omitted that platform and returned
its expected “Must specify expo-platform” error; this was not an app failure and
required no server restart/tool repair.

Physical iPhone rendering, keyboard behavior, recording → import → chunk browsing
and tappable citation navigation for this new change remain **awaiting the acceptance
test above**. No Xcode, simulator, native build, reinstall, cache cleanup, publish,
deploy or App Store submission was used. Existing work remains uncommitted and intact.
