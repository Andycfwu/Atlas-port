# Relational Meeting Memory storage — schema v2

Implemented and migrated on September 10, 2026. This remains a **single-user development SQLite system**. Mobile recording files and metadata, local chats, UI, model choices, prompts, and retrieval algorithms are unchanged. No phone-only recordings were migrated.

The previous tables stored meeting details, transcript originals, speaker evidence, processing configuration/checkpoints, topics, vectors, and answer citations inside `payload` JSON. The existing meeting, revision, generation, chunk, job, answer, and diarization tables now have explicit columns and relational children. The application reconstructs its existing API objects from these rows; it does not maintain a second writable JSON copy.

## Schema reference

See [`server/storage/schema.mjs`](../server/storage/schema.mjs) for the exact DDL and [`server/storage/relational.mjs`](../server/storage/relational.mjs) for the storage adapter.

| Tables | Important columns and relationships |
| --- | --- |
| `schema_migrations` | `version` PK, `applied_at`, `description`; also sets SQLite `user_version=2`. |
| `meetings` | Stable `id` PK, `user_id`, deduplication `fingerprint`/`source_key`, `title`, `meeting_date`, status/stage/error/attempts, timestamps. FKs identify original/current/desired revisions, current published generation, job, evidence, processing artifact and configuration. |
| `recordings` | `id` PK and `reference_only=1`. Registry of **already supplied recording IDs only**, with no audio, phone path, or invented historical relationship. |
| `meeting_participants`, `revision_participants` | Ordered attendance names, with meeting/revision FKs. These are independent of speakers. |
| `memory_revisions` | `id` PK, meeting FK, immutable `original_text`, `content_hash`, title/date snapshot, timestamp, evidence FK. Original wording is never replaced by cleaned notes. |
| `evidence_sets` | Immutable content-addressed evidence version, nullable meeting FK. Meeting evidence is scoped by meeting ID; raw diarization evidence remains independent of a Meeting Memory import. |
| `speakers` | Composite PK `(evidence_id,id)`, order, anonymous/display `label`, `provider_label`, nullable `confirmed_name` and `confirmed_at`. Confirmation changes create another immutable evidence version. |
| `transcript_segments` | Composite PK `(evidence_id,id)`, order, exact `start_offset`/`end_offset`, optional provider text, speaker FK **within the same evidence version**, attribution/overlap/provider IDs, nullable recording FK and actual audio start/end milliseconds and timing source. |
| `transcript_provenance` | Evidence FK, source `kind` (`live`, `saved_audio`, `diarized_audio`), supplied recording ID, trace/model/status, supplied diarization ID and names key. Missing historical references remain absent/null. |
| `source_units` | `unit_key` PK, revision FK, original source `id`, order, `kind` (`unit` or `legacy`), exact offsets and `original_text`. Unique IDs/order within each revision/kind. |
| `artifacts`, `artifact_passages` | Immutable processing output/checkpoint snapshots tied to meeting and revision, model columns, ordered source-unit links. Jobs and generations point to these outputs. |
| `topics`, `topic_sources` | Topic PK includes artifact, `kind` and ID. Generated title, separate derived summary, and ordered source-unit links for membership or summary support. A source can support multiple topics. |
| `topic_items`, `item_sources` | Explicit item kind/text, nullable owner/deadline, ordered supporting source-unit FKs. |
| `cleaned_passages`, `omissions` | Derived cleaned text/small-talk flag and explicit omission reason, both referencing original source units. |
| `configurations` | Content-addressed processor/prompt/splitter/grouping/notes model, reasoning, embedding model/dimensions/version/normalization columns. Flexible size limits and extension settings remain metadata. |
| `memory_generations` | Immutable generation `id`, meeting/revision/config/artifact FKs, publication status and timestamp. `internal_building=1` represents an unpublished job's reserved generation. |
| `memory_source_chunks`, `chunk_sources` | Immutable chunk `id`, meeting/generation/revision/topic FKs, part, title, original-source-assembled `body`, input hash. Ordered member/context/span links point to exact source units, offsets and evidence snapshots. |
| `embeddings` | Chunk PK/FK, model, dimensions, configuration version, normalization, input hash and vector BLOB. Vectors use little-endian float64 to preserve the existing JS numeric values exactly; `length(vector)=dimensions*8`. No re-embedding occurred. Unknown legacy model/hash/config fields remain null. |
| `legacy_chunk_aliases`, `chunks` | Existing contextual-chunk IDs map to immutable chunk rows. Exact duplicates reuse those rows; `chunks` is a **read-only compatibility view**. `fields_json` records old response field names, not another chunk payload. |
| `memory_jobs` | Stable job PK, meeting/revision/generation/config FKs, run token, lease, status, stage, attempts, error, timestamp, window index and checkpoint-artifact FK. |
| `diarizations`, `diarized_transcripts` | Job status/retry/error plus a separately immutable result: provider/model/request ID, actual audio hash/bytes/duration, original segment-assembled text, separately retained provider text, evidence FK. |
| `diarized_selections` | Existing selection from supplied diarization source ID to its selected Meeting Memory representation. |
| `answers`, `answer_meeting_filters` | Saved answer PK, question, status, scope, requested speaker, clarification/limitation, model/date and filter columns. Requested filter IDs are criteria, not fabricated meeting relationships. |
| `answer_sources`, `answer_source_participants` | Exact saved source snapshots: original referenced IDs, text/offsets, title/date/attendance/evidence. Nullable resolved source/generation FKs and explicit `exact` or `snapshot_only` resolution. |
| `answer_statements`, `answer_citations` | Ordered statement text/kind and citations with exact quote, original meeting/revision/generation/passage references, optional speaker/segment, and FK to the exact saved answer source. |

Foreign keys, ordered composite primary keys, uniqueness checks, vector-length/offset constraints and immutable-evidence triggers protect the relationships. Indexes cover meeting dates/status, attendance names, revision/source order, speaker passages/names, generation chunks, source links, job status/lease, and saved answers/citations.

`metadata_json` preserves **field presence** (missing versus null), flexible extension metadata and any historical extra fields. Scalar values mapped to columns become `0` markers and child relationships become `true` markers; these are serialization metadata, not duplicated core values. SQL readers use the columns and child tables. Do not edit the markers as application data.

All text offsets remain zero-based **UTF-16 code units**, matching the original JavaScript string. Do not use them directly with SQLite's Unicode-code-point `substr()` when non-BMP characters such as emoji occur. `source_units.original_text` is already the exact validated slice. Timing is nullable and never inferred from text length or attendance.

Renaming speakers retains the existing application behavior: it creates/selects a new Meeting Memory representation for that diarized source. Old meetings, revisions, names, chunks and answer snapshots remain available. Shared `recording_id`/diarization references identify the relationship only when it was actually supplied; anonymous voices are not identities across recordings.

## Publication, recovery and deletion

The existing processing identity, prompt/model configuration, grouping, embedding validation and retrieval mechanics are unchanged. New results and vectors are built and validated before one SQLite transaction publishes the generation and changes the meeting pointer. A failed replacement leaves the previous generation searchable. Run IDs, leases and revision ownership prevent superseded jobs from publishing. Restart marks interrupted work failed; explicit Retry resumes its checkpoint/generation without duplicate chunks.

Migration preserves older optional fields exactly. Genuinely unversioned originals get internal storage snapshots (`internal_snapshot=1`), without inventing a public historical revision ID. The existing runtime upgrade path may subsequently version such older records when opened. The actual development database already had public revisions for all eight meetings.

Legacy saved answers without revision IDs keep their exact stored text and original missing IDs. A unique exact source match can supply an internal FK; otherwise `resolution='snapshot_only'`. Nothing redirects to similar text. Versioned citations resolve through their original revision and passage IDs, or the existing explicit unavailable response.

Meeting deletion removes its revisions, chunks/vectors, artifacts/topics/omissions, jobs, meeting-scoped evidence, selections, and affected saved answers (including answers across meetings). It preserves independently saved diarization results, matching existing behavior. Unreferenced configuration/reference records, independent diarization data and retained backups need a future retention policy; this task adds no automatic purging.

## Database, backups and performed migration

Actual configured database (`MEMORY_DB_PATH` was unset):

`/Users/andywu/Desktop/Codex/atlas-port/server/data/meeting-memory.sqlite`

Retained backup directory:

`/Users/andywu/Desktop/Codex/atlas-port/server/data/backups/relational-v2-20260910/`

- **`pre-apply.sqlite`**: final pre-migration database, including all 8 meetings. This is the matching data rollback point.
- `before.sqlite`: earlier 7-meeting backup; retained, but do not use it for the latest rollback.
- **`code-612a237.tar`**: matching pre-refactor tracked code from commit `612a237`. Environment files, dependencies and phone audio are not inside this archive.
- `trial-current.sqlite`, `trial-current-report.json`: separately migrated copy of the final backup and exact-comparison report.
- `active-report.json`: active migration record and per-table canonical SHA-256 verification manifests. Earlier trial copies/reports are also retained.

Backups used SQLite **`VACUUM INTO`**, including committed WAL content. No main-file-only copy, reset, deletion of meetings, model request, or re-embedding was used. Before the final copy, an idle backend watcher was stopped; it had no child/listener, and meeting, memory-job and diarization states showed no active processing. A new completed meeting had appeared since the first backup, so the final backup and trial were refreshed before applying the migration. The backend was restarted successfully afterward.

The migration uses `BEGIN IMMEDIATE`, takes its snapshot under that write lock, normalizes every record, reconstructs every old API payload, compares IDs/counts/all fields, checks foreign keys and SQLite integrity, then drops the old payload tables and commits. Any malformed record or failed check rolls back the whole migration and identifies the affected record without printing its transcript. A repeated invocation is a verified no-op. Starting this backend against an unmigrated database refuses startup with migration instructions rather than silently rewriting it.

Commands from the project root (the active migration is **already applied**):

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
# Read-only comparison with the matching pre-migration backup:
node server/storage/migrate-cli.mjs --database server/data/meeting-memory.sqlite \
  --verify-against server/data/backups/relational-v2-20260910/pre-apply.sqlite

# For another old database: stop its backend after jobs/recordings finish,
# create a NEW backup path, migrate a separate trial, verify it, then apply.
node server/storage/migrate-cli.mjs --database /absolute/path/old.sqlite \
  --backup /absolute/path/new-backup.sqlite
node server/storage/migrate-cli.mjs --database /absolute/path/new-backup.sqlite \
  --backup /absolute/path/new-trial.sqlite
node server/storage/migrate-cli.mjs --database /absolute/path/new-trial.sqlite \
  --apply --backend-stopped --report /absolute/path/trial-report.json
node server/storage/migrate-cli.mjs --database /absolute/path/new-trial.sqlite \
  --verify-against /absolute/path/new-backup.sqlite
node server/storage/migrate-cli.mjs --database /absolute/path/old.sqlite \
  --apply --backend-stopped --report /absolute/path/active-report.json
```

`--backend-stopped` is an operator acknowledgement, not a process stopper. Check for backend listeners/open DB handles and active jobs before using it. The migration itself rejects processing jobs/meetings/diarizations, including interrupted ones that need the matching old backend's recovery first. The final comparison against a pre-migration backup is expected to differ after legitimate new app writes; the recorded migration report establishes the original migration result.

## Matching code/database rollback

Only roll back after recording, processing and questions finish. Stop the current backend with Ctrl+C and verify no process is holding the DB. Preserve any post-migration changes with another SQLite-aware backup. Then run the archived old backend against a **separate clone of `pre-apply.sqlite`**; do not overwrite the current DB or delete its WAL files. This restores the exact pre-migration point, not later user edits. Choose unused output paths below (the backup CLI refuses overwrites):

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
node server/storage/migrate-cli.mjs --database server/data/meeting-memory.sqlite \
  --backup server/data/backups/relational-v2-20260910/post-migration-preserved.sqlite
node server/storage/migrate-cli.mjs \
  --database server/data/backups/relational-v2-20260910/pre-apply.sqlite \
  --backup server/data/backups/relational-v2-20260910/rollback.sqlite
mkdir /Users/andywu/Desktop/Codex/atlas-port-rollback-612a237
tar -xf server/data/backups/relational-v2-20260910/code-612a237.tar \
  -C /Users/andywu/Desktop/Codex/atlas-port-rollback-612a237
npm --prefix /Users/andywu/Desktop/Codex/atlas-port-rollback-612a237/server ci
MEMORY_DB_PATH=/Users/andywu/Desktop/Codex/atlas-port/server/data/backups/relational-v2-20260910/rollback.sqlite \
  node --env-file=/Users/andywu/Desktop/Codex/atlas-port/server/.env \
  /Users/andywu/Desktop/Codex/atlas-port-rollback-612a237/server/server.mjs
```

This keeps the refactored working tree, current DB, backup and original archive intact. Do not point the old backend at a v2 database. To resume v2, stop the rollback backend and start `npm run backend` in the current project; no database swap is necessary. Retain access to the existing server environment/key; keys were not copied into the code archive.

## Read-only SQL examples

Open with `sqlite3 -readonly server/data/meeting-memory.sqlite` from the project root, or a read-only SQLite client. Replace `:meeting_id` / `:chunk_id` with IDs from the listing, or bind them in the client.

```sql
-- List meetings and the searchable generation, independent of filenames/titles.
SELECT m.id, m.title, m.meeting_date, m.status,
       m.revision_id, m.published_generation_id,
       count(c.id) AS published_chunks
FROM meetings m
LEFT JOIN memory_source_chunks c ON c.generation_id=m.published_generation_id
GROUP BY m.id ORDER BY m.meeting_date DESC;

-- View the currently selected original transcript in exact source order.
SELECT u.id, u.ordinal, u.start_offset, u.end_offset, u.original_text
FROM meetings m JOIN source_units u ON u.revision_id=m.original_revision_id
WHERE m.id=:meeting_id AND u.kind='unit' ORDER BY u.ordinal;

-- Inspect supplied speakers and the original units overlapping each segment.
-- Confirmed names are distinct from anonymous/provider labels. Missing means unknown.
SELECT r.id AS revision_id, s.id AS segment_id, sp.label,
       sp.provider_label, sp.confirmed_name, sp.confirmed_at,
       s.attribution_status, s.start_offset, s.end_offset,
       s.audio_recording_id, s.audio_start_ms, s.audio_end_ms,
       u.id AS source_id, u.original_text
FROM memory_revisions r
JOIN transcript_segments s ON s.evidence_id=r.evidence_id
LEFT JOIN speakers sp ON sp.evidence_id=s.evidence_id AND sp.id=s.speaker_id
LEFT JOIN source_units u ON u.revision_id=r.id AND u.kind='unit'
  AND u.start_offset<s.end_offset AND u.end_offset>s.start_offset
WHERE r.meeting_id=:meeting_id ORDER BY r.created_at,s.ordinal,u.ordinal;

-- Trace a topic chunk through exact spans to its immutable original wording.
SELECT c.id, c.title, c.generation_id, c.revision_id, c.topic_id,
       l.ordinal, u.id AS source_id, l.start_offset, l.end_offset, u.original_text
FROM memory_source_chunks c
JOIN chunk_sources l ON l.chunk_id=c.id AND l.role='link'
JOIN source_units u ON u.unit_key=l.unit_key
WHERE c.id=:chunk_id ORDER BY l.ordinal;
-- Older contextual chunks may have only role='context' instead of 'link';
-- join that role and read offsets from source_units for those legacy rows.

-- Inspect exact saved citation references, including snapshot-only historical answers.
SELECT a.id AS answer_id, c.statement_ordinal, c.quote,
       c.referenced_meeting_id, c.referenced_revision_id,
       c.referenced_generation_id, c.passage_id,
       s.resolution, s.resolved_unit_key, s.original_text
FROM answers a JOIN answer_citations c ON c.answer_id=a.id
JOIN answer_sources s ON s.answer_id=c.answer_id AND s.ordinal=c.source_ordinal
ORDER BY a.created_at,c.statement_ordinal,c.ordinal;

PRAGMA foreign_key_check;
PRAGMA integrity_check;
```

The speaker query deliberately shows original source units, which can include adjacent whitespace. It does not assign unlabeled text to participants or infer audio times. For a precise segment excerpt in JS, slice the revision's original with the segment's UTF-16 offsets.

## Verification and limitations

- `npm test`: **128/128 passed**, including 8 new migration tests, existing messy/structured transcript mechanics, atomic publication/retry/restart, speaker corrections/citations, chat, recording integrity, final live-event persistence, independent post transcripts and live-default Meeting Memory intake.
- `npm run typecheck` and `npm run lint`: passed.
- Final trial and active migration: exact canonical round-trip comparisons passed for **8 meetings, 8 revisions, 8 published generations, 20 source chunks, 14 legacy chunk aliases, 2 jobs, 2 diarizations, 2 selections and 4 answers**. This checks all source text/offsets, evidence/name mappings, vectors/configuration, publication/jobs and saved citations, not just row totals. Foreign-key and SQLite integrity checks passed.
- Restarted backend: health passed; read-only HTTP reads reproduced all 8 original meeting objects, all 20 chunk bodies and all 4 saved answer objects. These existing answers predate explicit revision IDs, so they retain their original snapshots. Versioned historical citation resolution and renamed-speaker preservation were exercised separately with deterministic fixtures.
- No paid model evaluations or real-audio requests were made. The storage refactor introduces no new model-quality claim. No Xcode, simulator, native build, mobile UI testing, deployment or dependency updates were performed.
- Physical iPhone acceptance after this refactor is **not yet verified**. This remains one local backend with full in-memory vector search, no authentication, account isolation, cloud sync, encryption/retention policy, multi-worker orchestration or production backup management. The database and retained backups contain private text/embeddings. Existing background recording limitations in Expo Go remain unchanged.

## Startup and short Expo Go acceptance

Backend (already restarted at this handoff; use Ctrl+C before launching a replacement):

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
npm run backend
```

Metro in a second terminal:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan --port 8081
```

Keep the existing `server/.env` and backend-only `OPENAI_API_KEY`. The unchanged backend binds to `0.0.0.0:8787`. Mac Wi-Fi IP was `10.0.0.104` at handoff; refresh it with `ipconfig getifaddr en0` after network changes. iPhone and Mac must share Wi-Fi, Local Network access must be allowed, and the Mac firewall must allow Node/8787. Confirm `http://10.0.0.104:8787/health` in iPhone Safari, then scan Metro's Expo Go QR code. No native build is needed.

1. Open an existing Meeting Memory meeting. Check its original text, topics and any supplied speaker labels/confirmed names.
2. Ask one question, open a citation, and confirm the quoted original passage and speaker evidence match. This uses the existing real provider and may incur its normal charge.
3. Close/reopen Expo Go and reopen that meeting and saved answer. Confirm the same sources and topics persist.

The Atlas shell and separate recording screen are unchanged. Saved live text still transfers directly by default; post-recording text remains the fallback and diarized text requires explicit selection. Phone audio and its separate transcript versions remain in the phone's existing storage.
