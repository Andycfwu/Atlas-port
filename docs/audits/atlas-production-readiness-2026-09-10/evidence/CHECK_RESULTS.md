# Local verification evidence

Date: September 10, 2026. Working directory: `/Users/andywu/Desktop/Codex/atlas-port`. Node v24.14.1, npm 11.11.0. Commands used existing local dependencies; no install/autofix or live provider calls. Times below are log last-write timestamps in UTC.

| Command | Output timestamp | Result | Log |
| --- | --- | --- | --- |
| `node --test tests/*.test.cjs server/*.test.mjs` | 2026-09-10T18:16:27.930727+00:00 | Exit 0; 120 passed, 0 failed, 0 skipped; native/provider doubles and temporary loopback only. | [tests.log](tests.log) |
| `./node_modules/.bin/tsc --noEmit` | 2026-09-10T18:16:25.391750+00:00 | Exit 0; no diagnostics. | [typecheck.log](typecheck.log) |
| `./node_modules/.bin/eslint . --no-cache` | 2026-09-10T18:16:33.315972+00:00 | Exit 1; 8 errors, 2 warnings. | [lint.log](lint.log) |

The initial source hashes precede these checks. Final hashes differ because external storage work was in progress. The newly added storage-migration test was not part of this test run. No claim is made that the later working tree has passed these checks. See `workspace-comparison.json` and both source hash files for scope.

Secret review: an in-process Python pattern scan inspected current tracked/nonignored text and 8 commits/278 unique historical Git blobs reachable through local refs. Categories: provider-key shapes, GitHub token shapes, AWS access-key shapes, JWT shapes, private-key PEM headers, credential-bearing database URLs. Zero pattern matches; binary/encoded/entropy and unreachable/remote-only history were not fully covered. Ignored env values were suppressed; only variable names, value presence, HTTP scheme and POSIX modes were reported. No key validation request was made.

Schema review: Python sqlite3 opened the default local database with `mode=ro` and queried sqlite_master, PRAGMA user_version and PRAGMA table_info(meetings). Result: user_version 0, schema_migrations absent, legacy payload column present. No business rows were queried. The source requires schema version 2. No migration or backend restart was performed.
