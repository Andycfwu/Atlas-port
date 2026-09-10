# Atlas security and production readiness review

Reviewed September 10, 2026. Repository: `/Users/andywu/Desktop/Codex/atlas-port`. Branch `main`, HEAD `612a237915986622a9073eae3d83578be13a10a3`, plus existing uncommitted work.

## Assessment

**Atlas is a functional development prototype, not ready for employee/customer data or a production rollout.** Recording integrity and AI source fidelity have received substantial engineering work. Identity, access control, secure transport, and the complete data lifecycle remain unfinished.

The supplied document is an audit **brief**, not a prior completed audit. I used its controls as review criteria for the user's request to assess the code and next steps. This is a security-focused source review and local validation, not a claim to have executed every device, accessibility, operational, or legal check in that brief. There is no defensible “percentage of the audit completed” without a completed baseline and release evidence.

| Intended use | Assessment | Conditions or blockers |
| --- | --- | --- |
| Synthetic-data development demo | Conditional | Restricted development network, synthetic recordings/transcripts, supervised provider usage, and a compatible backend/database snapshot. Do not expose the current backend publicly. |
| Internal pilot with real data | Not ready | Authentication/authorization, TLS, vulnerable upload dependency, recording recovery, storage/backup protection evidence, and appropriate recording/provider notice must be addressed. “Internal” does not solve these gaps. |
| Wider production release | Not ready | Pilot blockers plus complete deletion/retention, operational ownership, backup/restore, abuse controls, and release/device verification. |

Most consequential findings:

1. Anyone able to reach the inspected backend can use sensitive APIs. Meeting Memory has one shared development identity; UUIDs do not authorize access.
2. The local client configuration uses HTTP, and live audio follows the corresponding unencrypted WebSocket path.
3. Installed and locked Multer 2.2.0 is in the affected range of a current upload-parser denial-of-service advisory.
4. Audio is recorded into Documents, but crash recovery and the recording catalog are not transactional or fully recoverable.
5. Deletion does not cover every transcript copy, and production storage, backup, consent, provider, and operational evidence is missing.

No implementation fixes, package changes, key changes, migrations, deployments, or live endpoint probes were performed in this review.

## What is already implemented

| Capability/control | What the evidence supports | Limits |
| --- | --- | --- |
| Real local recording, playback, rename, export | Recording uses Expo Audio and Documents; validates playable duration and copied byte size before catalog save. `src/features/recorder/RecorderProvider.tsx:117-120,865-896`; `src/features/recorder/recorder.storage.ts:382-494`. | Native interruption, low-disk, crash, lock-state, and longest-duration acceptance remain unverified here. |
| Audio survives transcription failures | Upload uses the saved file, previous transcript versions are retained, late trace IDs are rejected, and transcription does not delete authoritative audio. `src/features/recorder/recording-transcription.service.ts:174-315`; `src/features/recorder/recorder.storage.ts:531-570`. | No durable server audio library or general cloud synchronization. |
| Real live/saved transcription and speaker identification | Node proxies provider requests; diarization uses content hashes, result identity, two-job concurrency, timeouts, and temporary-upload cleanup. `server/server.mjs:196-262`; `server/diarization/service.mjs:25-60`. | No caller identity or tenant boundary. Live capture is foreground-dependent and stops streaming on background. |
| Real Meeting Memory | Durable SQLite storage, original transcript revisions, source-linked chunks, citations, and checkpointed processing. `server/memory/store.mjs:14-47`; `server/memory/versions.mjs:85-124`. | Relational migration is uncommitted and the default local database is still legacy. |
| AI result integrity | Trusted instructions are separate from transcript input; strict schemas, source IDs, verbatim quote validation, and bounded correction attempts. `server/memory/provider.mjs:33-45,54-83`; `server/memory/retrieval.mjs:75-96`; `server/memory/service.mjs:97-102`. | These controls do not prove semantic accuracy or tenant isolation. No privileged AI tools are wired into this flow. |
| Secret separation | Long-lived provider key is read only by the backend; native client config exposes an API URL, not the provider key. `server/server.mjs:32-55`; `src/config/app.config.ts:1-17`. | Local file permissions, deployed secret access, rotation, and release-bundle inspection still need work. |
| Some diagnostic redaction | Backend errors redact token/path patterns; live logs also remove the exact configured key; mobile transcription logs and integrity panel are development-gated. `server/transcription-observability.mjs:3-40`; `server/live-transcription-server.mjs:146-156`; `src/features/recorder/recording-transcription.errors.ts:157-175`. | Production crash collection, audit events, log storage/access/retention, and comprehensive diagnostic minimization are not established. |
| Honest placeholders | General Atlas chat saves local user messages without generated replies. File Browser and Profile/Settings are marked coming soon. `README.md:3-28`; `src/navigation/AppDrawer.tsx:11-19`; `src/features/atlas/atlas.service.ts:8-18`. | General chat backend, accounts, and cloud sync are not connected. |

The local suite passed **120/120 tests**, with zero skipped tests, and TypeScript passed. Tests use native/provider doubles and temporary or in-memory storage; those results do not establish device or deployed security. Lint failed with **8 errors and 2 warnings**. Storage files were being edited externally during this review, so the run is evidence for the code loaded at execution, not certification of later edits.

## Scope and evidence limits

- Inspected mobile services and recording/chat/memory flows, all backend route registrations, live WebSocket upgrade handling, persistence/worker/provider boundaries, package manifests and lockfiles, tests, relevant engineering documents, and generated local iOS configuration.
- Expo 57.0.16, React Native 0.86.2, React 19.2.3; Expo Audio 57.0.4 and FileSystem 57.0.5. Backend locks Express 5.2.1, Multer 2.2.0, OpenAI SDK 7.5.0, and ws 8.21.3. Installed Multer/ws versions match these lock entries.
- The generated iOS project exists even though it is Git-ignored. It has deployment target 16.4, a microphone usage description, audio background mode, local networking enabled, arbitrary loads disabled, and OTA updates disabled. `ios/RealTorchAtlas/Info.plist:46-68`; `ios/RealTorchAtlas/Supporting/Expo.plist:5-12`; `ios/RealTorchAtlas.xcodeproj/project.pbxproj:377,410`.
- No Android native project, root release artifact directory, EAS build profiles, or `.github/workflows` was found in this scope. No signed release binary or installed app was validated. The current README targets physical iPhone development; Android has source configuration but lacks equivalent acceptance evidence here.
- No identity-provider configuration, hosting/firewall configuration, production endpoint, provider account settings, signing access, cloud backup, or external operational system was inspected. A network gateway could affect exposure; none is represented in the route code. Internet reachability is **unknown**, not assumed.
- Did not read business records/audio/transcripts from the local database. A read-only SQLite connection inspected only schema metadata: default database `PRAGMA user_version = 0`, no `schema_migrations` table, and legacy `meetings.payload` present. No provider requests or live-service test scripts were run.
- Local Git secret-pattern review covered all 8 commits reachable through local refs and 278 unique blobs. Current tracked/nonignored text and those historical blobs had no matches for the selected provider-token, GitHub-token, AWS-key, JWT, private-key, and credential-URL patterns. This is a limited pattern scan, not a full entropy/encoded-secret scan or proof about remote/deleted/unreachable history or binary assets.
- Ignored environment files were inspected with values suppressed. `.env.local:1` configures an HTTP API URL; `server/.env:1` contains a provider key. Neither is tracked. No credential values were printed or tested.

Source citations below refer to the working tree observed during review. Dirty/untracked files must not be attributed solely to HEAD. See the integrity note and evidence records for changes during the review.

## Architecture and data lifecycle

```text
Phone app
  ├─ Local chat JSON and intake draft JSON in Documents
  ├─ Expo Audio → Documents/ExpoAudio → validated copy → recordings/ + recordings.json
  ├─ Live PCM → HTTP-derived WebSocket → Node → provider Realtime
  ├─ Saved M4A → HTTP multipart → temporary server file → provider transcription
  └─ Transcript intake/questions → HTTP JSON → Node → SQLite + provider AI/embeddings

Current Node trust boundary: shared development workspace, no authenticated principal
Production identity boundary: not implemented
```

| Data/copy | Location and protection observed | Retention/deletion/access implications |
| --- | --- | --- |
| Provider credential | Ignored `server/.env`; POSIX mode 0644. Read by server startup. | No key in reviewed client source; local least privilege and provider-side restrictions/rotation unknown. Directory traversal/ACLs affect actual other-user access. |
| Raw/partial and saved audio | `Paths.document` / ExpoAudio and `recordings/`; application sandbox APIs. | Saved audio deleted explicitly by local user. Failed copies and interrupted captures may persist outside the library. File protection, device encryption configuration, and backup exclusions not verified. |
| Catalog and saved transcript variants | `recordings/recordings.json`: audio identity, title/date/duration, live text, post-transcription history, diarized results. | Single direct JSON overwrite; not scoped to an account. Catalog entry removal does not cover independent recovery/server copies. |
| Recovery audio metadata/live text | `atlas-recording-recovery/{sessionId}.json` and `{sessionId}.live.json`. | Live recovery text is written on normal Stop, not just errors. No corresponding startup reader or cleanup/deletion path was found. `recorder.storage.ts:58-71,663-668`; `RecorderProvider.tsx:980-984`. |
| Chat messages | Alternating `atlas-chats/history-0.json` and `history-1.json`. | Good partial-write recovery. Device-local, no identity scoping or end-user retention policy. An older snapshot deliberately retains previous content. `src/features/chat/chat.storage.ts:16-60`. |
| Intake drafts/imported file cache | Alternating `atlas-meeting-intake/draft-*.json`; DocumentPicker copies imports into cache. | Saving a new/empty draft can leave a previous snapshot. Import code does not remove the cache copy. `src/features/memory/memory.draft.ts:9-36`; `MeetingIntakeScreen.tsx:14-30`. |
| Temporary upload audio | OS temp directory via Multer, before provider requests. | Normal completion/error paths unlink files; process-crash cleanup and owned-directory sweeper are absent in inspected code. Temp copies are not a durable server recording archive. |
| Meeting originals, historical revisions, participants, speaker names, AI topics, embeddings, answers and cited excerpts | Local SQLite database with WAL; ordinary filesystem access. | Shared development owner. Meeting deletion removes its relational derivatives/retained answers, but diarization results and independent phone copies remain. Physical page/WAL/backup erasure not established. |
| Provider copies | Realtime audio, whole-file transcription/diarization, transcript metadata, AI processing windows, embedding inputs, questions/retrieved passages. | Responses requests set `store: false`; actual account/endpoint retention, region, access, and contractual controls need evidence. This review makes no zero-retention claim. |
| Diagnostics | Backend console events; development mobile console and integrity panel. | Some redaction is tested. Collection destination, retention, access controls, crash coverage, and incident auditability are unknown. |
| Exports and backups | User-initiated system audio share; migration backup utility; OS/server backup configuration not established. | Export recipients control their copies. No authenticated data export/deletion workflow or tested restore process. |

There is no implemented login/logout/account-switch flow, so there is no established account-specific cleanup or lost-device revocation behavior. No server-side durable audio store, signed recording URLs, push subscription system, or privileged WebView bridge was identified in the inspected feature paths. These should be assessed if introduced, not described as existing protected capabilities.

## Findings and next steps

Priority means P0 before affected real-data use; P1 before broad rollout; P2 subsequent hardening. UNKNOWN is an evidence gap, not a confirmed vulnerability.

### F-001 — Sensitive backend operations have no authenticated caller

**FAIL · P0 · All connected features.** Brief controls ARC-03, AUTH-01 through AUTH-06, AUTH-08, DATA-06, SYNC-02, and the tenant aspects of API-08.

`server/server.mjs:56-58,104-158,293` installs routes and binds all interfaces without authentication middleware. `server/memory/router.mjs:13-35` exposes meeting lists/full transcripts, revisions, sources, answers, processing, edits and deletion. `server/diarization/router.mjs:15-21` exposes uploads/results. `server/live-transcription-server.mjs:74-96` admits WebSocket clients based on path and connection count alone. `server/memory/store.mjs:11-12,34` and `server/storage/relational.mjs:2,134-140,237` use a constant development owner.

**Failure path:** another reachable client can read or alter shared meeting data and initiate paid requests without a session. This is demonstrated by route source and the existing unauthenticated loopback HTTP integration tests, not a probe of a live deployment. Exact external exposure remains unknown.

**Action A-01:** implement validated server-side identity and object authorization, then user/workspace scoping throughout data access, worker state, source resolution, answers, local caches, and account switching. Do not merely add a login screen or replace the constant with a request-body user ID. Choose organization/project roles only after the intended sharing model is decided. Acceptance: unauthenticated requests fail before reading/parsing expensive bodies; two users cannot access each other's IDs/lists/search/results; disabled users and removed memberships lose access within an agreed bound; WebSocket upgrades enforce the same policy.

### F-002 — Client-to-backend data uses cleartext transport

**FAIL · P0 · Current local connected configuration.** NET-01, SEC-04, REL-04.

Sanitized inspection found `EXPO_PUBLIC_API_URL` uses `http` in `.env.local:1`. `src/config/app.config.ts:1-17` trims but does not restrict the scheme; `src/services/api/api.client.ts:49-85` sends to that base. `src/features/recorder/live/live-transcription.service.ts:59-74` maps HTTP to `ws:`. Node uses `node:http` (`server/server.mjs:5,57`). The generated iOS configuration permits local networking (`ios/RealTorchAtlas/Info.plist:46-51`). Provider-side WSS does not encrypt the phone-to-backend hop.

**Action A-02:** provide HTTPS/WSS for real-data environments, reject insecure endpoints in release configuration, and separate development/staging/production configuration. Validate hostname/certificate failures, no cleartext fallback, and the actual signed release configuration. A trusted TLS reverse proxy is an acceptable architecture if its configuration and private backend boundary are verified.

### F-003 — Installed upload parser has a current denial-of-service vulnerability

**FAIL · P0 for a reachable shared backend · Source/installed dependency match, no exploit test.** REL-03, API-01, API-03.

`server/package-lock.json:572-584` locks Multer **2.2.0**; installed package metadata reports the same. Both `/transcribe` and diarization use Multer before any authentication (`server/server.mjs:130-158`; `server/diarization/router.mjs:12-18`). The maintainer advisory reports multipart field-name array-index processing can exhaust synchronous CPU in versions **below 2.3.0**, including this version. Fixed version: **2.3.0**. Body/file byte limits alone do not remove that parser path. [Multer GHSA-535w-7cp7-47q4](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4), published August 28, 2026; accessed September 10.

**Action A-03:** upgrade to a verified patched compatible version, update the server lockfile, restrict accepted multipart fields/indexes, and validate ordinary/oversized/aborted/malformed uploads using bounded isolated fixtures. No dependency was changed here. Protect the shared backend before allowing untrusted traffic; auth alone does not protect against malicious authorized users.

For comparison, locked ws **8.21.3** is outside the affected ranges of the reviewed [fragment exhaustion advisory](https://github.com/websockets/ws/security/advisories/GHSA-96hv-2xvq-fx4p) and [close-reason memory disclosure advisory](https://github.com/websockets/ws/security/advisories/GHSA-58qx-3vcg-4xpx). Multer 2.2.0 also contains the fix for the earlier [aborted-upload cleanup advisory](https://github.com/expressjs/multer/security/advisories/GHSA-3p4h-7m6x-2hcm). This targeted check is not a full transitive/native dependency clearance.

### F-004 — Recording recovery does not survive all crash/catalog failure paths

**PARTIAL · P0 for relying on Atlas as the only recording copy.** DATA-04, REC-05, REC-06, SYNC-01, SYNC-08.

Documents storage and copy-before-source-cleanup are good. However, active-session identity is held in React refs (`RecorderProvider.tsx:543-553,618-619`), recovery reports are created during Stop/error handling, and startup reads only the completed library (`RecorderProvider.tsx:439-457`). Searches for `atlas-recording-recovery`, recovery report functions, directory enumeration, and load paths across `src/` found writers but no recovery reader/UI. Termination before Stop can therefore leave raw audio outside the discoverable catalog.

The catalog is a direct overwrite of one JSON file (`recorder.storage.ts:227-234`). An interrupted/corrupt read is caught and returned as an empty library (`:368-373`), suppressing the provider's visible load-error path. Later mutations reject unreadable JSON, which helps avoid overwriting corruption, but it does not recover the library. This is a discoverability/durability defect, not a claim that every crash physically erases audio.

**Action A-04:** journal recording identity before capture, checkpoint recoverable state, reconcile partial/source/destination files on restart, and make catalog writes transactional or recoverable with versioned snapshots. Show a recovery state and protect preserved files; never silently turn unreadable metadata into “no recordings.” Test termination at capture/copy/catalog boundaries, interrupted JSON writes, disk exhaustion and partial playable audio on devices as well as fixtures.

### F-005 — At-rest, backup and lost-device protection are not established

**UNKNOWN · P0 verification gate for sensitive data.** DATA-02, DATA-03, DATA-09, AUTH-09.

The client writes plain JSON and audio through app-private Documents APIs; the backend opens ordinary SQLite without an application encryption layer. This does **not** prove OS-level encryption is absent. The review did not establish iOS file protection classes, locked/rebooted-device access, Android protection/backup behavior, Mac volume protection, backup access, or key recovery. The iOS entitlement file is empty; that alone is not evidence that iOS Data Protection is absent.

There is currently no client authentication token to secure, and SecureStore is not a dependency. Its absence is not itself a leaked-token finding. Introducing real sessions will require a deliberate protected credential/key store; audio and transcript databases should not be placed in a small-secret store.

**Action A-05:** define sensitive data classes and the device threat model, inspect actual file/backup attributes on the intended build, and implement protection where the evidence does not meet that model. Decide lock-state/background-recording tradeoffs explicitly. Prove backup exclusions, restore behavior, key availability, and user isolation with synthetic fixtures. Do not equate HTTPS or sandbox isolation with at-rest protection.

### F-006 — Recording-to-provider behavior needs notice and consent decisions

**PARTIAL · P0 for recordings of real participants.** PRIV-01 through PRIV-05, PRIV-07.

OS microphone permission is checked and recording state is visible (`RecorderProvider.tsx:492-519,562-565`; `RecorderScreen.tsx:50-74`). Live mode defaults on unless explicitly disabled (`RecorderProvider.tsx:134`); starting a normal recording initiates live transcription after capture starts (`:631-632`). The recorder screen does not explain this provider transfer before capture. Meeting transcript intake has a useful explicit Mac/OpenAI processing notice and “Save without processing” option (`MeetingIntakeScreen.tsx:52-54`).

**Action A-06:** decide appropriate participant notice/consent and customer restrictions with the product/privacy owner, make local capture versus provider streaming an informed choice, and verify actual endpoint/account data controls and region. Maintain a clear provider data map and matching release disclosures. No legal conclusion or zero-retention assurance is made here. `store: false` is present in Responses requests (`server/memory/provider.mjs:57-63`); it is not evidence about every provider endpoint/account setting. Generated iOS privacy declarations exist, but release/store accuracy is unverified.

### F-007 — Delete and retention do not cover all copies

**PARTIAL · P1; must have an approved lifecycle before a real-data pilot.** DATA-05, DATA-07, DATA-08, PRIV-06, PRIV-07, SYNC-06.

Local deletion removes the library audio and its catalog entry (`recorder.storage.ts:599-646`), but does not remove separately persisted live recovery text (`:663-668`). That copy is created on ordinary Stop (`RecorderProvider.tsx:980-984`) and lacks a matching deletion or retention path. Imported transcript cache and prior draft snapshots also persist independently.

Meeting deletion exists on the backend (`server/memory/router.mjs:32`; `server/storage/relational.mjs:238-244`) and removes meeting derivatives and saved answers; the mobile memory service exposes no deletion method (`src/features/memory/memory.service.ts:24-32`). Diarization has no deletion route (`server/diarization/router.mjs:15-25`) and its stored transcript is not removed by deleting the phone recording or meeting. Keeping an independently imported meeting is a documented product choice (`docs/source-topic-pipeline.md:136-138`), but the user needs clear controls for that copy. SQL row deletion does not establish removal from WAL/free pages/backups (`docs/source-topic-pipeline.md:150-153`).

**Action A-07:** define separate versus linked deletion semantics, give every copy an owner and retention trigger, expose authorized deletion controls, add recovery/import-cache cleanup and a temp-upload reconciliation job, and verify convergence when requests are in flight. Test provider completion after deletion and retention across backup restores. No retention duration is invented by this review.

### F-008 — Abuse controls and retry guarantees are incomplete

**PARTIAL · P1, coupled to F-001 for immediate exposure.** API-03, API-04, NET-03, SYNC-03 through SYNC-05, OPS-07.

Live has four concurrent sockets, a 15-minute limit, bounded buffers and deadlines (`server/live-transcription-server.mjs:24-31,68-96`). Memory limits processing and questions to two each (`server/memory/service.mjs:15-28,72-79`); diarization similarly limits active provider jobs. Those are useful process-wide controls.

`/transcribe` has a file-size ceiling and provider timeout but no route concurrency, caller rate limit, spend quota, or durable idempotent job/result (`server/server.mjs:130-158,196-262`). A retry after a lost response can perform the same paid transcription again. Admission to diarization provider work happens after multipart disk upload and whole-file hashing (`server/diarization/service.mjs:25-39`), so the two-job cap is not an upload admission limit. HTTP create/list endpoints can accumulate or return growing shared data.

**Action A-08:** enforce request/upload admission and per-principal usage quotas before expensive work; provide a server-side cost stop, persistent idempotency/result lookup for saved transcription, finite list pagination and storage quotas. Validate lost responses, provider 429/timeouts, retries and a saturated worker/upload pool. Keep the local original until explicit user deletion; these uploads currently do not establish durable cloud audio storage.

### F-009 — In-progress database work is not a deployable migration yet

**PARTIAL · P1; immediate development startup coordination.** DATA-10, REL-01, REL-02, REL-07, OPS-05.

Uncommitted relational storage adds constraints, immutable source records, integrity checks and migration verification (`server/storage/schema.mjs`; `server/storage/migration.mjs:30-68`). These are integrity improvements, not authentication. The current `MeetingStore` requires schema version 2 (`server/memory/store.mjs:18-20`), while the default local database's read-only schema metadata remains legacy. Starting this source against that database will refuse startup. A running backend could still have older code loaded; no live process was probed or restarted.

**Action A-09:** finish and review this work at a stable commit; rehearse migration and rollback on an isolated copy, verify backup integrity and exact transcript/citation preservation, then coordinate backend quiescence and the actual migration separately. A rollback cannot casually point old code at a newly changed schema. Do not treat temporary-database unit tests as proof the real database has been migrated.

### F-010 — Production release and operations evidence is incomplete

**PARTIAL · P1; P2 for optional resilience controls and nonessential settings polish.** ARC-04, ARC-05, OPS-01 through OPS-07, REL-01 through REL-08, PLAT-01 through PLAT-06, applicable UX checks.

There are useful diagnostics and local tests, but no checked-in CI workflow, production build profiles, operational alert destinations, incident ownership, access audit trail or tested scheduled restore process in the inspected paths. Existing engineering docs call out unverified physical-device acceptance (`docs/meeting-diarization.md:138` and `docs/recording-live-repair.md:102-139`). Generated iOS configuration is evidence of local configuration only. Android merged permissions, signed release checks, store disclosures, signing-account permissions and deployment posture remain UNKNOWN.

The reviewed local lint command failed: `Buffer` undeclared in six files (eight errors), plus two unused imports in relational storage. These are lint configuration/import issues; they are not evidence of eight exploitable security defects. Subsequent external edits may alter that result.

**Action A-10:** establish a traceable release/CI baseline, fix check failures, define operational and incident owners, configure privacy-aware monitoring/alerts, rehearse restores and rollback, and run the intended device matrix. Verify deep-link/dev-launcher and sharing configuration from actual release artifacts. Assess pinning/attestation/root checks against a threat model rather than making them automatic P0 requirements. No assertion of store or regulatory compliance follows from this review.

### F-011 — Local credential and database filesystem permissions need hardening

**PARTIAL · P1.** SEC-03, SEC-05, DATA-03.

Metadata inspection found `server/.env` and the default SQLite database at mode **0644**, and `server/` plus `server/data/` at **0755**. POSIX file bits allow non-owner read if ancestor traversal and ACLs allow it. Effective access through the complete path and Mac account/volume controls was not verified, so this is not proof another account actually read them. Git ignores both the credential file and data directory.

**Action A-05/A-10:** restrict secrets/data/backup access to intended service and operator identities, account for ACLs and temp files, and use appropriately scoped managed secrets for deployment. Establish issuance/rotation and incident procedures. No confirmed credential exposure was found that would justify claiming a compromise or silently rotating the key.

## Verification performed and still needed

Commands ran from the repository root, September 10, 2026, using Node **v24.14.1**, npm **11.11.0**, and existing installed dependencies. Definitions, imports, fixtures, and network/storage boundaries were inspected first. Provider calls were mocked; HTTP/WebSocket integration used temporary loopback servers. No install, autofix, snapshots update, native generation, paid-provider verification, or shared-service test was used.

| Evidence | Executed command / method | Result and meaning |
| --- | --- | --- |
| T-01 | `node --test tests/*.test.cjs server/*.test.mjs` | Exit 0; 120 passed, 0 failed/skipped. Recording storage/live/upload, transcript fidelity, memory pipeline, citations, migration mechanics, diarization, log redaction. Native APIs/provider behavior mocked. |
| T-02 | `./node_modules/.bin/tsc --noEmit` | Exit 0; typecheck passed. |
| T-03 | `./node_modules/.bin/eslint . --no-cache` | Exit 1; 8 errors, 2 warnings. Direct local ESLint avoids Expo CLI installation/setup side effects. |
| E-01 | Redacted pattern review of current tracked/nonignored text and all local-ref Git history | No matches for selected credential patterns; 8 commits/278 unique blobs. Coverage limits above. |
| E-02 | Environment key names, schemes and filesystem permissions; SQLite schema metadata using read-only connection | HTTP local base URL, server key present/untracked, 0644 key/database files, default database still legacy. Values/customer records omitted. |
| E-03 | Locked/installed dependency versions plus maintainer advisories | Multer affected; reviewed ws advisories patched. Full transitive/native advisory analysis pending. |

| Scenario from the brief | Execution state | What remains |
| --- | --- | --- |
| Permission granted/denied/revoked; capture interruption; lock/background; calls/audio routes | PROPOSED device verification | Source has permission/operation guards and interruption detection, but device state and surviving audio must be checked. |
| Offline save/restart, kill during capture, interrupted catalog write, low disk, longest recording | PROPOSED device verification | Fixture tests prove selected storage contracts; startup recovery/catalog weakness remains F-004. Define duration/storage budgets first. |
| Failed live stream, final-event ordering, backpressure, duplicate start/finish, stale transcript callbacks | RUN T-01 with doubles/loopback | Tests passed; repeat appropriate native flows on a signed intended build. |
| Lost upload response, retry and duplicate billing | Source review / PROPOSED | `/transcribe` has no durable idempotent result. Exercise after A-08 using a counting fake provider. |
| User/org switch, session expiry, cross-user ID substitution, membership revocation | PROPOSED after A-01 | Current routes demonstrably lack auth. No current token or signed upload URL exists to expire. |
| Delete during processing; remove every local/server/provider copy | RUN selected generation/deletion unit tests; full scenario PROPOSED | Partial transactional deletion is covered. Complete lifecycle, in-flight queries/diarization and recovery files are not covered by a production claim. |
| Provider timeout/429/malformed response | RUN selected fixture/error tests | Verify real environment quotas and kill switches separately; no paid calls made here. |
| Upgrade and migrate existing data; restore a backup | RUN synthetic migration tests; actual migration/restore PROPOSED | Default database remains legacy. Separate maintenance procedure and verification required. |
| Release logs, privacy manifests, exported components, screen reader/large text | Source inspection / PROPOSED artifact-device verification | Local iOS configuration and some accessibility attributes exist; no complete release/UX acceptance claimed. |

## Priorities and evidence requests

The six P0 findings/gates are F-001 through F-006: three confirmed failures, two partial controls, and one explicit protection-evidence gap. They cannot be offset by passing tests. F-007 through F-011 are five P1 findings/groups. These are **finding counts**, not totals for every checklist row in the supplied brief; no aggregate compliance score is given.

Engineering needs: intended hosting/access boundary; identity and sharing model; actual release artifacts; device file/backup protection evidence; production secret permissions; a stable migration snapshot; backup/restore evidence; full dependency inventory/advisory review. Product/privacy decisions: allowed data, participant notice, provider endpoints/region/account terms, retention/deletion scope, export policy, supported recording duration/platforms and operational owners. No exception or launch approval is implied.

See `ATLAS_REMEDIATION_PLAN.md` for ordered actions, owners, acceptance criteria and rollback considerations.

## Documentation checked

Accessed September 10, 2026. These explain expected behavior, not actual deployment:

- [Exact Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/): version/framework/platform reference required by AGENTS.md.
- [Expo SDK 57 Audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/): recording directory behavior and native background configuration. Documents is deliberately selected in this app; plugin configuration requires a native build to take effect.
- The four maintainer dependency advisories linked in F-003. Public queries contained only public package names, not private source or manifests.
- The exact versioned FileSystem webpage returned an error twice; no behavior claim here relies on inaccessible documentation. Local app source was reviewed directly.

## Workspace integrity

Initial status had five modified tracked files: `server/diarization/service.mjs`, `server/meeting-memory-provenance.test.mjs`, `server/memory-pipeline.test.mjs`, `server/memory/store.mjs`, and `server/memory/versions.mjs`; `server/storage/` was untracked. The review preserved these changes.

A hash snapshot of 179 tracked/nonignored files was recorded before checks. External edits were observed during review in `server/memory/store.mjs`, `server/memory/versions.mjs`, and four storage modules (`migrate-cli.mjs`, `migration.mjs`, `relational.mjs`, `schema.mjs`). A new `server/storage-migration.test.mjs` appeared after the test run and was not part of its 120 tests. The review did not make these edits. Generated iOS files were inspected as existing ignored local artifacts. The review's intentional repository writes are only this report, the remediation plan, and sanitized evidence under this audit directory. Initial/final comparison and test logs are retained alongside the report; tests apply to their execution snapshot. No attempt was made to reset concurrent work or migrate/restart the backend.
