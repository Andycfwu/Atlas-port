# A-03 — Multer patch and audio upload hardening

Completed September 10, 2026. This addresses A-03 from the production-readiness audit. It does not close the audit's authentication, TLS, quota, or production-readiness findings.

## Verified dependency change

Before: `server/package.json` requested `^2.2.0`; both `server/package-lock.json` and the installed dependency resolved **Multer 2.2.0**.

After: package manifest pins **`2.3.0`**, lockfile resolves `https://registry.npmjs.org/multer/-/multer-2.3.0.tgz`, and `npm --prefix server ls multer` reports **2.3.0**. Its declared Node requirement (`>=10.16.0`) is compatible with this project's Node 24 runtime. Only Multer changed in the lockfile; no broad upgrades, force audit fix, or native dependencies were introduced.

The minimum release was verified independently against the maintainer's advisories, release notes, tagged README, installed source and registry metadata:

| Official maintainer advisory | Affected range | Patched stable release |
| --- | --- | --- |
| [GHSA-535w-7cp7-47q4 — oversized field-array indexes](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4) | `<2.3.0` | `2.3.0`; configure `fieldArrayIndexLimit` |
| [GHSA-wc9g-mqfw-jrwm — crafted field names](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm) | `<2.3.0` | `2.3.0` |
| [GHSA-qvfw-j98x-7q72 — async file-filter size-limit race](https://github.com/expressjs/multer/security/advisories/GHSA-qvfw-j98x-7q72) | `<2.3.0` | `2.3.0` |
| [GHSA-qfvm-cv95-jqjf — aborted-upload file descriptor leak](https://github.com/expressjs/multer/security/advisories/GHSA-qfvm-cv95-jqjf) | `=2.2.0` | `2.3.0` |

The earlier stable-branch fixes for [deeply nested names](https://github.com/expressjs/multer/security/advisories/GHSA-72gw-mp4g-v24j) and [incomplete aborted-upload cleanup](https://github.com/expressjs/multer/security/advisories/GHSA-3p4h-7m6x-2hcm) shipped in 2.2.0 and remain included. The newer file-descriptor advisory above is a separate issue affecting 2.2.0.

Sources: [2.3.0 release](https://github.com/expressjs/multer/releases/tag/v2.3.0), [versioned README limits](https://github.com/expressjs/multer/blob/v2.3.0/README.md#limits), [maintainer advisory listing](https://github.com/expressjs/multer/security/advisories). Checked September 10, 2026. No assertion is made about unrelated dependency advisories.

Targeted installation command used:

```sh
npm --prefix server install multer@2.3.0 --save-exact --ignore-scripts --no-audit --no-fund
```

## Route-specific handling

Both multipart entry points now use [`server/audio-upload.mjs`](../server/audio-upload.mjs). There is no global multipart parser. The saved-transcription handler moved unchanged in purpose into [`server/transcription-router.mjs`](../server/transcription-router.mjs), so tests exercise the real handler with a fake provider. Its model, full-text response behavior, trace header and error response contract remain intact.

| Limit / input | `POST /transcribe` | `POST /v1/diarizations` |
| --- | --- | --- |
| Files | Exactly 1, field `file` | Exactly 1, field `file` |
| Maximum file bytes | **26,214,400** (existing 25 MiB cap retained) | **25,000,000** (existing 25 MB cap retained) |
| Text fields | **0** | Exactly **2**: `recordingId`, `durationMillis` |
| Maximum field value bytes | **0** | **256** |
| Maximum field name length | **32** | **32** |
| Allowed parts / parser `parts` setting | 1 / **2** | 3 / **4** |
| `fieldNestingDepth` | **0** | **0** |
| `fieldArrayIndexLimit` | **0** | **0** |
| Upload byte-count header | Validated when present; omitted header still supports existing older phone builds | Required and must match the received bytes exactly |
| Duration | No new recording-duration limit | Existing **20-minute** limit; positive measured milliseconds |

The patched parser's documented `parts` behavior fires when the configured bound is reached, so the setting is one more than the allowed total. All extra files/fields/parts are rejected. Array and nested field names are unnecessary here and forbidden, including small harmless bracket indexes used in the tests. No large-index or CPU-exhaustion attack was reproduced.

Diarization accepts only a flat scalar recording ID using the existing allowed characters, and a positive decimal duration string. Missing, duplicate, unknown, array/object-shaped, oversized, nonnumeric and malformed fields are rejected. The file-size and duration checks still run before job creation/provider work. The container's measured media duration must agree with the phone's duration within one second (allowing AAC encoder padding); recordings beyond the existing 20-minute metadata cap are rejected, with the same one-second tolerance when checking container timing.

## Audio container validation

The existing filename/MIME allowlist remains `.m4a` with `audio/mp4`, `audio/m4a`, `audio/x-m4a`, or `application/octet-stream`. Client filenames never determine a filesystem destination.

[`server/audio-container.mjs`](../server/audio-container.mjs) additionally opens the actual uploaded file and validates its ISO BMFF/QuickTime structure:

- Declared file bytes agree with the disk file; atom lengths and extended lengths stay inside parent/file bounds.
- Recognized M4A/MP4/QuickTime compatibility brands, one movie atom, nonempty media data, and audio tracks are required.
- Tracks have `soun` handlers, `mp4a` sound sample descriptions, and valid media timescale/duration. Video and encrypted/unsupported sample descriptions are rejected.
- Atom traversal has a fixed depth through the known movie hierarchy, at most 10,000 visited boxes, and at most 16 tracks/sample descriptions. Individual metadata reads are at most 4 KiB; media/sample payloads are skipped rather than copied for inspection. Both ordinary and extended atom sizes are supported.
- Metadata placement before or after media data is supported. The validator does not assume that one `ftyp` signature proves valid audio.

The selected format follows the installed Expo SDK 57 `RecordingPresets.HIGH_QUALITY` (M4A/AAC on iOS and MPEG-4/AAC on Android), checked after reading the required [SDK 57 docs](https://docs.expo.dev/versions/v57.0.0/) and [audio docs](https://docs.expo.dev/versions/v57.0.0/sdk/audio/). Structure references: Apple's [QuickTime atoms](https://developer.apple.com/documentation/quicktime-file-format/atoms), [media header](https://developer.apple.com/documentation/quicktime-file-format/media_header_atom) and [handler reference](https://developer.apple.com/documentation/quicktime-file-format/handler_reference_atom).

This is **container validation, not full audio decoding**. Structurally plausible files can still contain corrupt encoded frames or bad sample tables that only a decoder/provider detects. No promise is made that every possible corrupt audio bitstream is rejected before a provider request. The tested metadata/container/parser rejection cases make zero provider calls.

## Temporary file ownership and errors

Each accepted multipart request gets a new private `atlas-audio-*` directory under the OS temporary directory and a server-chosen `recording.m4a` filename. Cleanup is registered against that exact parsed file using a WeakMap. A client-provided path or an arbitrary file object cannot become a cleanup target.

Multer 2.3.0 handles parser/file-stream failures and closes its pending disk streams. The request wrapper removes its own directory after parser rejection, validation failure or disconnect. Saved transcription removes its upload after success or handled provider failure. A fully validated diarization job explicitly takes ownership before background processing; its file survives the 202 response and is removed when work succeeds/fails. Duplicate/rejected starts remove only the new request's upload. A disconnect during validation/hash preparation cannot start a provider call afterward.

Errors explain the needed correction/retry without exposing filenames, server paths, field values, keys, or transcript content. Filesystem cleanup failures produce only a fixed warning about temporary-storage permissions. As with the prior system, an abrupt OS/process crash or filesystem permission failure can leave temporary files; this patch does not sweep the shared temp directory or delete unrelated files.

Original phone audio, live/post/diarized text, persistent diarization results, Meeting Memory data, SQLite schema v2, prompts, models and app design are unchanged.

## Verification actually performed

- Focused tests: **19/19 passed** (`server/audio-upload.test.mjs` and existing diarization tests).
- Full regressions: **138/138 passed** via `npm test`, including recording integrity, final live-event saving, independent transcript preservation, Meeting Memory, relational storage, citation and diarization regressions.
- `npm run typecheck`, `npm run lint`, `git diff --check`: passed.
- New tests use real route handlers on ephemeral loopback ports, temporary directories, in-memory databases, finite synthetic bodies, counting fake providers, 8-second test deadlines, 3-second HTTP deadlines, and bounded cleanup waits. File-size tests lower the production cap to 16 KiB on those isolated test servers; they check the exact boundary and one byte above it without uploading 25 MB repeatedly.
- Covered valid uploads, duplicate/retried diarization, preserved saved-transcription whitespace, size/files/fields/parts limits, bracket names, malformed metadata, byte-count mismatches, renamed WAV/MP3, video/non-AAC declarations, truncated/invalid container lengths, false durations, malformed multipart, disconnected partial uploads, cleanup while a background job runs, and handled provider failures. An unrelated sentinel file remained intact throughout.
- The committed [synthetic silence fixture](../tests/fixtures/upload-synthetic-silence.md) was encoded locally with FFmpeg. A separate Apple Core Audio `afconvert` re-encoding of that silence also passed container validation (measured duration approximately 10.054 seconds). This checks container compatibility, **not an actual Expo phone capture** or transcription quality.
- No paid provider calls, CPU-exhaustion reproductions, Xcode, simulator, native build, broad upgrade, deploy or publish action occurred.

Before pausing the backend watcher, there were no client/upstream TCP connections and no active Meeting Memory or diarization jobs. Before restart, all three processing-status queries remained clear. The backend restarted successfully on `0.0.0.0:8787`; `/health` passed and reported no pending live-code restart. A read-only Meeting Memory API request still returned 8 meetings. SQLite remained schema v2 with a clean foreign-key check and `integrity_check=ok`. No malformed upload tests targeted the shared running backend.

## Startup and remaining physical phone check

The backend is already running. If restarting it later, let active recording/processing finish, stop its terminal with Ctrl+C, then run:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
npm run backend
```

Start Metro in another terminal if it is not already running:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan --port 8081
```

**Still awaiting physical-iPhone verification:** In Expo Go, have two people say a short clearly synthetic script, save the recording, use its **Transcribe** action, then **Identify speakers**. Confirm both uploads succeed, both separate text versions remain available, and the original still plays. Keep the app foregrounded and use the Mac's Wi-Fi address; no native build is needed. These phone actions use the existing paid provider normally, unlike the automated doubles above.

Authentication, TLS deployment, caller/upload quotas, aggregate disk/bandwidth limits and production operations remain separate work. This change does not make the backend production-ready.
