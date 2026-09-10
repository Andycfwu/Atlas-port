# Deepgram merged-speaker investigation — September 10, 2026

## Finding

The user reports that physical Expo Go recording now captures the words but merges different speakers. That confirms improved phone text capture, not correct speaker attribution. This investigation did not access or upload the user's phone audio/transcripts.

**Provider-side merging was reproduced with synthetic audio. No Atlas ID collapse was found in the inspected path or exercised fixtures.** In both bounded real-provider runs, Deepgram assigned ID `0` to the first generated voice (Samantha) and the quieter third generated voice (Karen). Daniel received ID `1`. These are known synthesis inputs and isolated time windows from the fixture generator, not identities inferred from transcript wording, attendance or turn-taking. A specific phone recording's cause still requires checking its supplied IDs.

## Trace

| Stage | Implementation and evidence |
| --- | --- |
| Provider words | `server/deepgram/protocol.mjs` takes `words[].speaker` exactly; absent values stay null. Integer zero is retained. Valid IDs are 0–1000. |
| Atlas ID | The same file creates `${connectionId}:speaker${providerSpeaker}`. Every connection has its own UUID. No dense renumbering or participant-name matching. |
| Backend grouping | Adjacent words group only when their provider IDs are exactly equal. `0 → 1 → 0` remains three passages. Groups never convert `1` to `0`. |
| Event handling | `server/deepgram/session.mjs` sends normalized results. Final fingerprints include per-word IDs; conflicting finalized evidence fails visibly instead of overwriting an earlier assignment. Interim labels may change while provisional. |
| Client | `live-transcription.service.ts` validates wire results; `LiveSpeakerAccumulator` preserves final result objects. Existing partial-final and malformed-interim text safeguards remain intact. |
| Display | `displayedSpeakerPassages` builds adjacent same-ID groups from saved word evidence. Label N is provider ID N−1. Colors repeat after six labels, but numeric labels remain distinct. Unreconstructable wording or invalid interim timing displays unknown/withheld attribution, not a guessed replacement speaker. |
| Save/reopen | `savedLiveSpeakerSource` deep-copies the snapshot. `RecorderProvider` captures it after the Stop finalization barrier; recording metadata and recovery manifests retain words, passages and connection IDs. Post-transcription does not overwrite it. |
| Meeting Memory | `intakeFromLiveSpeakers` retains connection-scoped IDs only for exact word/source reconstruction. Participants never assign identities. Existing revisions, citations and original audio are unchanged. |

The optional **Show speaker ID diagnostics** control reads existing saved/live evidence. Per result, it shows provider word IDs, grouped IDs, and displayed labels, with a maximum of 12 listed IDs per stage. It makes no provider calls, emits no logs, and does not change stored evidence. Repaired provisional events explicitly report withheld labels. This works on historical live-speaker versions that already contain word evidence.

A separate display defect compared newly derived `visible` passage IDs against original `p` IDs, so a passage could be reported as overlapping itself. The display now checks other displayed passages and excludes itself. This was a false overlap annotation, **not the cause of merged speaker IDs**. Real supplied timing overlap remains visible; it is not treated as proof of two voices.

## Supported comparison and limits

Read the required [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/), current [Deepgram diarization documentation](https://developers.deepgram.com/docs/diarization), and [streaming API reference](https://developers.deepgram.com/reference/speech-to-text/listen-streaming).

The documented streaming choices are `diarize_model=v1` and `diarize_model=latest`; latest currently resolves to v1. `v2` is batch-only and unsupported for streaming. Deprecated `diarize=true` also selects v1 and must not be combined with `diarize_model`. No documented streaming speaker-count/sensitivity parameter was found in these references. Endpointing, gain, punctuation, speech model, and microphone/session settings were not tuned.

Exactly **two** paid calls replayed the same existing **19.256-second synthetic** PCM fixture, once per supported selector. Both used the improved live adapter and client, 24 kHz mono PCM16, Nova-3, endpointing 300 ms, and unchanged transcription settings. No active backend, SQLite database or real phone recording was used. There were no retries, automatic post-processing or additional comparisons.

| Result | `v1` | `latest` |
| --- | --- | --- |
| Resolved diarizer | v1 | v1 |
| Diarizer UUID | `6ff6f59c-c349-443b-aba1-352de7d75943` | Same |
| Final results / saved results | 7 / 7 | 7 / 7 |
| Final word IDs checked exactly | 39 / 39 preserved | 39 / 39 preserved |
| First / quiet third generated voice | Both ID 0 | Both ID 0 |
| Second generated voice | ID 1 | ID 1 |
| First text observed | 1.638 s | 1.281 s |
| Failure / provisional remainder | None / none | None / none |

Both runs returned identical final text, including the quiet roof and drainage statements. Both still missed the overlapping “Keep the porch white” phrase and transcribed the last “stop” as “stock.” Those are script-reference observations; the TTS audio has not received a human listening review, so this is not a human-verified accuracy/diarization score. Single-run timing differences do not demonstrate a latency improvement.

All four sample counters were 462,155 in both runs. Every finalized provider word ID matched its saved/reopened Atlas word ID, and every displayed final ID set matched its provider set. The comparison artifact contains synthetic raw events and snapshots only: `tests/fixtures/deepgram-quiet/speaker-id-evaluation.json`. `actualConfiguration` records the real upstream query; the test-only latest override does not change the application's pinned configuration.

Reproduction is explicit and bounded to two provider connections, 45 seconds per run, at most 256 events / 4 MiB of responses, and at most 30 seconds of checked-in synthetic input:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
node --env-file=server/.env server/evaluate-speaker-ids.mjs --synthetic-only
```

This sends only the synthetic PCM to Deepgram and may incur charges. No further run is needed to establish the observed merge. The provider key remains backend-only and is never printed. Keep `diarize_model=v1` and OpenAI as the default; Deepgram remains experimental. Saved-audio Identify speakers remains an explicit alternative, not a guarantee of correct attribution or an automatic paid fallback. Never transfer its labels onto live text through guessed matching.

## Verification and activation

- `npm test`: **177/177 passed**, including five added checks for ID preservation through normalized/wire results, rendered numeric labels (including repeated palette colors), save/reopen and recovery metadata, separate post-transcription, exact Memory source spans, and honest withheld/overlap display. Provider doubles and mocked Expo file storage are distinguished from the two actual synthetic provider calls above. Existing text-capture, Stop, recording/playback, Memory publication and citation regressions passed.
- `npm run typecheck`, `npm run lint`, and `git diff --check` passed. The running Metro compiled the iOS JavaScript bundle with the optional ID control and current LAN endpoint. No native build or device test is implied.
- The optional display update is in the main project. No automatic phone reload or backend restart was requested. The backend health check still reported its original load time `2026-09-10T21:05:30.974Z`, matching loaded/source revision `6ed80a3c9ba7310c`, and `restartRequired:false`.
- Original source/transcript storage, capture, streaming parser/assembly, provider settings, audio files, database schema/data, and authentication-foundation implementation were not changed. Only the live-speaker view and its read-only diagnostic helper affect app behavior. The test runner used isolated fixtures; the paid comparison only used its own localhost sockets and synthetic PCM.
- **Pending:** the new optional display on a physical Expo Go phone and the exact provider IDs for the user's observed merged recording. No original phone recording was inspected. Reload only after any active recording has been saved.

No Xcode, simulator, native build, database migration, deployment or publishing was used.

## One short phone test

When no recording is active, reload Expo Go. Open **Menu → Live Transcription → Record → Live speaker labels — experimental**. Have two distinct people alternate three short turns over about 30 seconds, including a quieter turn, then Stop & Save. Reopen the recording and turn on **Show speaker ID diagnostics**. Compare the **finalized** passages from the different people:

- Same provider ID and same displayed speaker: the provider merged them; Atlas must not invent a split.
- Different provider IDs but the same displayed number (within the same connection): report that result as an Atlas mapping defect.
- Unknown/withheld labels: retain the wording and report the explicit reason; this does not establish a provider merge.

Confirm that words, original playback and final sentence survive reopening. Share only the ID/label observations; private transcript/audio content is not required. The user has confirmed the earlier phone text improvement; this new diagnostic display and the specific phone speaker-ID result still need device confirmation.
