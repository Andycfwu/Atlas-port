# Atlas remediation plan

September 10, 2026. Based on `ATLAS_PRODUCTION_READINESS_AUDIT.md`, HEAD `612a237915986622a9073eae3d83578be13a10a3` plus in-progress working-tree storage changes. Proposed work only; nothing in this plan has been implemented or deployed by this review.

**First priority: establish an authenticated, encrypted boundary around every connected feature and patch the upload parser.** The recording and AI integrity work is useful, but it does not protect shared business data from another reachable caller.

## Sequence and release gates

1. While development continues, use synthetic data and a restricted backend network. Verify actual exposure and current provider budget controls. This is proposed containment, not a claim that access was changed.
2. Patch Multer (A-03) and establish HTTPS/WSS (A-02). Choose the identity/sharing model and implement full authorization (A-01). These are the connected-feature critical path.
3. Finish recording recovery (A-04), establish storage/key/backup protection (A-05), and approve/implement recording/provider notice (A-06).
4. Complete lifecycle controls (A-07), quotas/idempotency (A-08), the in-progress migration (A-09), and operational/release verification (A-10).

**Synthetic demo gate:** synthetic data only, controlled network and provider use, compatible code/database snapshot. A demo does not establish production readiness.

**Real-data pilot gate:** all applicable P0s closed with evidence; each participant/device/workspace has an authorized scope; transport and file/backup protection verified; recording restart/low-disk behavior validated; notice/provider decisions approved; deletion/retention scope and operational owner documented; upload/parser/cost protections active. No risk exception is assumed. Limit to the platforms and recording behavior actually verified.

**Wider release gate:** P1 actions closed or explicitly resolved through the organization's release process; reproducible signed artifacts, device matrix, full relevant dependency review, traceable deployment, restore and rollback rehearsal, monitoring/incident response, support and privacy disclosures ready.

## A-01 — Authentication and authorization

- **Priority/outcome:** P0; close F-001. Backend access is attributable and constrained to authorized data.
- **Owner:** backend/security, with mobile and product support.
- **Work:** choose identity provider/session approach and individual versus shared-workspace ownership. Add middleware before parsers/routes in `server/server.mjs`; authenticate WebSocket upgrades in `server/live-transcription-server.mjs`. Carry the verified principal into memory/diarization routers, services, storage, jobs, search, answers and every source/revision/chunk read. Replace the constant development owner with enforced ownership, not client-supplied claims. Add native protected session storage, logout/account-switch handling and identity-scoped local data/queues. Protect existing unsynced data through explicit migration/export/discard behavior.
- **Dependencies:** approved identity/sharing model, TLS deployment path; coordinate with A-09 rather than designing conflicting schema migrations. Proposed auth modules and schema changes need a separate implementation review.
- **Effort:** large, likely several engineer-weeks across backend/mobile; scope depends heavily on organization/role requirements. Not a delivery promise.
- **Acceptance/validation:** unauthenticated HTTP and WebSocket requests rejected before sensitive reads, uploads or provider use; invalid/expired/revoked sessions fail; user A cannot list/read/edit/delete/process/export user B's objects through any direct or indirect route; membership removal has a documented bound; account switch cannot reveal or upload previous-user data. Use synthetic two-user/two-workspace fixtures and endpoint-level negative tests; then verify actual gateway configuration and signed client.
- **Rollout/rollback:** initially deny access to unmapped legacy records. Require explicit owner mapping; never assign all existing shared records to the first login. Canary with synthetic data. Rollback disables connected features rather than restoring unauthenticated access; preserve data/schema compatibility.

## A-02 — Encrypted transport and environment separation

- **Priority/outcome:** P0; close F-002 and release aspects of F-010.
- **Owner:** infrastructure/backend and mobile.
- **Work:** deploy a verified HTTPS/WSS boundary; keep backend origin private where TLS terminates at a proxy. Restrict release API schemes in `src/config/app.config.ts` and live URL derivation. Define development, staging and production endpoint/build configuration. Inspect generated iOS/Android network policies and final artifacts.
- **Dependencies:** hosting/endpoint decision; can proceed alongside auth and parser patch.
- **Effort:** small to medium with existing hosting, larger if no hosting baseline exists.
- **Acceptance/validation:** no sensitive HTTP/WS request in real-data builds; invalid certificates/hostnames rejected; no fallback; a dev URL cannot accidentally become a production endpoint; WebSocket traffic passes through the authenticated TLS boundary. Validate using an isolated staging environment and the intended native build.
- **Rollout/rollback:** maintain explicit version compatibility during endpoint changes. If TLS fails, fail closed and preserve local recordings; do not roll back to cleartext. No certificate pinning requirement is assumed.

## A-03 — Patch Multer and harden multipart admission

- **Priority/outcome:** P0 for reachable shared backend; close F-003 and part of F-008.
- **Owner:** backend.
- **Work:** update `server/package.json` and `server/package-lock.json` to a verified patched release, **at least 2.3.0 for GHSA-535w-7cp7-47q4**. Configure the lowest required field-array-index bound and field/count/size limits. Saved transcription needs no arbitrary form fields; diarization accepts only its documented metadata. Validate the expected audio container in addition to the declared filename/MIME where appropriate.
- **Dependencies:** none for the package fix; coordinate request admission with A-01/A-08.
- **Effort:** small, roughly 0.5–2 engineering days assuming compatibility, medium confidence.
- **Acceptance/validation:** ordinary saved uploads/diarization still work; oversized, malformed, aborted and unsupported multipart inputs fail cleanly; no orphan partial upload on handled failures. Use bounded local tests with deadlines and synthetic bytes; do not reproduce CPU-exhaustion attacks on shared/live services. Recheck maintainer advisories at implementation time.
- **Rollout/rollback:** staging first; monitor upload failures/latency. If regression occurs, disable affected upload routes while fixing it rather than returning to an exposed vulnerable version. Local audio remains safe.

## A-04 — Durable recording journal and startup recovery

- **Priority/outcome:** P0; close F-004.
- **Owner:** mobile.
- **Work:** replace direct catalog-overwrite behavior in `src/features/recorder/recorder.storage.ts` with a transactional store or recoverable snapshots; persist capture identity and file association before recording; reconcile active/partial/failed/destination files on startup. Wire a recovery UI into `RecorderProvider`/recorder screens. Preserve corrupt metadata for diagnosis and clearly distinguish empty, unreadable and recoverable libraries. Tie recovery artifacts to the final recording/owner for A-07 cleanup.
- **Dependencies:** agree supported capture/background/duration behavior; identity migration should be designed with A-01. Durability mechanics can be developed using synthetic fixtures meanwhile.
- **Effort:** medium to large, roughly 1–2 engineering weeks including representative device checks; low confidence until device behavior is measured.
- **Acceptance/validation:** force termination during capture, between copy and catalog save, and during metadata write preserves all recoverable audio without labeling truncation complete; startup can find and export/recover it. Low-disk errors show truthful state. Existing metadata remains readable across upgrade; corruption never appears as an ordinary empty library. Test both fixtures and devices with synthetic audio.
- **Rollout/rollback:** preserve old catalog and files through migration; commit the new manifest only after validation. Avoid deleting sole unsynced copies. Document which old client versions can read new data; keep a recovery/export route available if reverting UI/code.

## A-05 — Device, server, credential and backup protection

- **Priority/outcome:** P0 verification/implementation for F-005; P1 local permissions in F-011.
- **Owner:** mobile/platform and infrastructure/security; product sets data sensitivity requirements.
- **Work:** enumerate all report data-map copies and verify iOS file protection, Android app/backup policy, Mac volume/permissions, temp/backup access, device passcode/lock and restore behavior. Restrict key/database/data-directory permissions and effective ACLs. Select protected storage for future tokens/keys; choose database/file encryption if required by the threat model. Include key loss, reinstall, device migration and offline access limitations.
- **Dependencies:** data classification, intended device policy, background behavior and identity architecture. Do not prematurely mandate biometric unlock on every background file access.
- **Effort:** medium evidence exercise; implementation medium/large if encrypted storage or data migration is needed.
- **Acceptance/validation:** documented protection per data class/copy; unauthorized local accounts cannot read backend secrets/data; locked/rebooted device and backup restore behavior match approved requirements; old-user data is inaccessible after switching identity; key loss does not silently corrupt recordings. Use synthetic device/build/backup fixtures. Treat filesystem sandbox, disk encryption and application encryption as separate evidence.
- **Rollout/rollback:** protect old data/keys during encryption migration; verify recovery before retiring old keys/copies. Backups and rollback copies remain sensitive and require retention ownership. Evidence-only investigation has no rollout.

## A-06 — Recording notice, provider controls and disclosure

- **Priority/outcome:** P0 for F-006 before real participant data; P1 store/disclosure work for broader rollout.
- **Owner:** product/privacy with mobile/backend.
- **Work:** decide participant awareness/consent expectations and allowed customer data; make live transfer explicit before streaming begins. Provide an informed local-capture choice. Map Realtime, file transcription, diarization, Responses and embeddings separately to actual account/region/retention/access settings. Preserve existing Meeting Memory processing notice and align privacy/store documentation with actual behavior.
- **Dependencies:** intended audience, jurisdiction/customer restrictions and provider agreement/account evidence; qualified owners resolve those decisions. This is not solely a code task.
- **Effort:** small/medium UI work after decisions; policy/provider evidence timing unknown.
- **Acceptance/validation:** a user can tell before recording whether audio leaves the device; declining cloud processing causes no cloud audio requests; account/endpoint controls have dated evidence; disclosures reflect actual build and providers. Verify using a fake/recording network adapter, then a controlled build with synthetic data. No real meetings are needed for testing.
- **Rollout/rollback:** introduce versioned choices and conservative defaults for existing installations. Disabling streaming must preserve local capture. Evidence/contract work has no code rollback.

## A-07 — Complete deletion and retention lifecycle

- **Priority/outcome:** P1, with lifecycle decisions required for pilot; close F-007.
- **Owner:** backend/mobile; product/privacy owns retention and independent-copy semantics.
- **Work:** create an explicit policy for recordings, recovery files, live/post/diarized transcripts, intake caches/draft snapshots, imported meetings, revisions, chunks/vectors, answers/citations, temporary uploads, logs, exports and backups. Add authenticated memory/diarization deletion APIs and mobile controls. Link each recovery copy to its final recording; clean it after durable save where permitted. Use an app-owned temp directory and safe orphan cleanup. Clarify when a phone recording deletion leaves an independent imported meeting.
- **Dependencies:** A-01 identity and A-04 recovery guarantees; retention policy and allowed legal-hold behavior.
- **Effort:** medium to large, roughly 1–2 engineering weeks for core copies; provider/backup procedures may add work.
- **Acceptance/validation:** delete a synthetic recording and verify catalog/recovery/draft/cache behavior against policy; delete an imported meeting and verify revisions/chunks/vectors/answers; delete diarization results through a user-accessible flow; in-flight provider completion cannot reintroduce deleted content. Restore testing must not silently revive purged data. Define logical versus physical purge and completion timing.
- **Rollout/rollback:** deletion and retention jobs start in report-only mode with owned sample review; quarantine rather than destroy uncertain unsynced originals. Final destructive rollout needs verified mappings/backups and explicit policy. Purges are not generally reversible; stale rollback backups must not restore deleted records to use.

## A-08 — Quotas, upload limits and idempotent processing

- **Priority/outcome:** P1; close F-008 and cost/availability aspects of F-001.
- **Owner:** backend/infrastructure.
- **Work:** gate upload admission before disk/body processing, add per-principal rate/storage/cost quotas and finite pagination, persist saved-transcription jobs/results with caller-scoped idempotency keys and payload-conflict detection, and provide a server-side expensive-feature stop. Reuse existing bounded retry/checkpoint ideas while defining lease and restart behavior.
- **Dependencies:** A-01 principal/ownership; A-03 safe parser. Provider/account cost limits need configuration evidence.
- **Effort:** medium to large, roughly 1–2 engineering weeks depending on queue/hosting choice.
- **Acceptance/validation:** retry after response loss produces one logical paid operation/result; conflicts reject reuse; upload slots/disk remain bounded under concurrent synthetic clients; over-quota clients fail predictably; server-side disable prevents new billable requests; shutdown/restart marks interrupted work truthfully. Use a counting fake provider and temporary storage before controlled staging verification.
- **Rollout/rollback:** start with conservative limits and explicit capacity metrics, then tune. Version job/schema changes; preserve local audio and finished job results on rollback. Disable processing if accounting or authorization is uncertain.

## A-09 — Finish and verify the relational migration

- **Priority/outcome:** P1; close F-009 without risking existing data.
- **Owner:** backend/database maintainer.
- **Work:** stabilize the uncommitted `server/storage/` implementation and updated memory/diarization consumers. Resolve lint issues, review constraints and migration guards, and document exact old/new compatibility. Rehearse `migrate-cli.mjs` on an isolated copy using the explicit database path. The current default database is legacy and was not migrated in this review.
- **Dependencies:** stable work snapshot, backup location/access policy, quiescent backend and no in-flight processing. Coordinate ownership schema with A-01 to avoid unnecessary repeat migrations.
- **Effort:** small to medium after the current work is complete; 1–3 engineering days of review/rehearsal is a rough estimate, not a commitment.
- **Acceptance/validation:** exact source/citation/diarization/answer preservation; foreign-key/integrity checks pass; injected interruption rolls back; repeated migration is safe; unsupported historical owners are not reassigned; old-client behavior is documented; restore of the backup is demonstrated. Full test/lint/type checks rerun at a stable commit. Verify source version, actual loaded backend and actual database schema agree.
- **Rollout/rollback:** scheduled maintenance only after a verified backup and quiescence; record migration evidence without transcript content. Rollback restores a compatible code/database pair and must handle writes after migration; do not overwrite a newer database without a reconciliation plan. This assessment did not authorize or execute migration.

## A-10 — Release evidence, operations and remaining hardening

- **Priority/outcome:** P1 for F-010/F-011; P2 for optional resilience and nonessential About/settings polish.
- **Owner:** infrastructure/release/mobile, with a named service owner and privacy reviewer.
- **Work:** add CI for meaningful existing checks and auth-negative coverage; review direct/transitive/native dependency advisories and release bundles; define build/environment profiles, signing access and rollback. Establish crash/error/cost/data-loss metrics, alert destinations, actor/resource audit events, access/retention controls, backups with recovery objectives, restore evidence and incident runbooks. Validate signed iOS/Android permissions, deep links/dev launcher, privacy declarations, background behavior, large text/screen reader and core navigation on the platforms actually shipping. Assess pinning/attestation only after the threat model is clear.
- **Dependencies:** stable A-01–A-09 implementations; release/platform decisions and operational accounts. Evidence collection and runbook ownership can start immediately.
- **Effort:** medium to large, multi-role; typically at least 1–2 engineering weeks for an initial operational baseline, excluding organizational approvals or new infrastructure.
- **Acceptance/validation:** traceable signed build passes checks and a documented device matrix; no release secrets/dev endpoints; failure and cost alerts are delivered to an owner; restore meets agreed objectives and preserves deletion state; incident containment and rollback are rehearsed; logs provide useful IDs without content/credentials. Record platform/build/time and evidence limits.
- **Rollout/rollback:** staged release with explicit stop thresholds. Telemetry starts with minimized payloads and can be disabled server-side. Backup/restore drills use isolated synthetic data; access/signing changes require appropriate operational rollout. Evidence-only tasks have no rollback.

## Next five concrete actions

1. **Verification/containment — A-01/A-02/A-08:** confirm where this backend is reachable and restrict development use to synthetic data and intended machines while protection is built. Check provider budget controls; do not infer them from the key's presence.
2. **Implementation — A-03:** patch Multer to a verified fixed version and validate multipart behavior. This is the smallest independently actionable security fix.
3. **Business decision plus implementation — A-01/A-02:** choose identity/workspace ownership and the hosting boundary, then enforce authentication, authorization and HTTPS/WSS end to end. This is the main real-data release blocker.
4. **Implementation — A-04/A-07:** make recording recovery/catalog persistence reliable and give recovery copies explicit lifecycle ownership. Preserve all existing unsynced audio during migration.
5. **Verification plus product decision — A-05/A-06:** prove device/server/backup protection and approve notice/provider handling before using real meeting content. In parallel, coordinate the already-in-progress database migration through A-09 rather than restarting incompatible code against the legacy database.
