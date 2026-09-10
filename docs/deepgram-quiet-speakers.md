# Deepgram speech preservation and transcript revision selection

Follow-up: [Merged-speaker ID investigation](deepgram-merged-speakers.md) traces the provider IDs, records the bounded v1/latest comparison, and documents the optional phone diagnostics. It preserves this milestone's improved text capture.

## Status and demonstrated findings

Implemented and tested in the isolated `atlas-live-speaker-prototype` checkout, then integrated into the main `atlas-port` project after the user confirmed the phone was idle. The backend has restarted successfully; the integration record is below. Authentication-foundation files, microphone configuration, playback, original recordings, database schema, models and production prompts are not part of this change. Deepgram remains explicitly experimental; OpenAI remains the initial recording mode. No preference was silently changed.

Two result-handling defects were reproduced:

1. A shorter final response cleared a longer provisional response in its entirety. Deepgram documents this partial-final sequence. The remaining provisional tail is now retained through failure/Stop/save; visible finalized prefixes are excluded using supplied word timing, without rewriting the original provisional text or promoting it to final evidence.
2. A real synthetic streaming response covered 6.82–8.30 seconds, but its last provisional word ended at 10.42 seconds. Only 8.40 seconds of PCM had been forwarded. The previous adapter rejected the response and terminated the stream, losing subsequent speech. The new adapter retains the original provisional text and explicitly unvalidated word evidence, withholds its unreliable speaker/timing display, and continues waiting for valid results. Finals still undergo strict validation. The real replay after the fix encountered one such repair and completed successfully.

A third safeguard shows the complete original provider alternative without guessed speaker attribution when its word list does not reconstruct that text. This prevents the word-derived view from hiding words still present in the original alternative.

These findings demonstrate application failure paths. They do **not** prove that either defect caused every quieter-speaker omission on the user's iPhone. No original phone recordings were uploaded for this investigation.

## Audio path and limits

The installed Expo SDK 57 implementation was read alongside the [exact SDK reference](https://docs.expo.dev/versions/v57.0.0/) and [Audio documentation](https://docs.expo.dev/versions/v57.0.0/sdk/audio/).

- `RecorderProvider` still requests one mono PCM16 stream at 24 kHz. `RecorderPcmCapture` owns it, independently of networking. File recording stops before capture is released; the finalization barrier then drains the network and waits for provider completion.
- Installed `expo-audio/ios/AudioStream.swift` uses an AVAudioEngine tap and AVAudioConverter for hardware-rate/channel/format conversion. Atlas declares the stream's reported actual sample rate, not an assumed hardware rate. Deepgram receives little-endian PCM16 without additional backend resampling. Existing OpenAI resampling remains unchanged.
- There is no application-level silence gate, confidence threshold, gain boost, denoising, redaction, filler removal or quiet-speaker filter. Endpointing changes pause-based finalization, not microphone sensitivity. Queue overflow and socket failures remain explicit failures; buffers are not silently dropped.
- The client now owns a copy of each queued PCM buffer, so a caller's buffer reuse cannot alter queued audio. Synthetic byte-for-byte tests cover zeros, quiet positive/negative samples and loud samples.
- The separate local M4A uses AVAudioRecorder; it is not a copy of the transmitted PCM buffer stream. Preparation/start boundaries, the native converter, AAC encoding and independent capture APIs mean identical audio cannot be claimed. Live timestamps remain provider-stream coordinates, with no fabricated saved-file offsets. Expo's native timestamp field is retained as diagnostic input, not assumed to be a verified M4A clock.
- The SDK's converter-failure fallback can expose the hardware format; this was not observed on the phone here. The phone acceptance must inspect the reported sample rate/counts. No native package was patched and no session changes were made speculatively.
- Existing bounds remain: 15-minute live sessions, 512 KiB audio queues/socket thresholds, 256 KiB frames, four combined live connections, finite readiness/idle/finalization deadlines, and bounded saved text. No automatic reconnect or dual-provider streaming was introduced.

## Bounded diagnostics

Each connection keeps counters, never private audio/transcript logs: received/sent samples, buffer counts, peak and RMS amplitude, clipped sample counts, peak queue size, first-text delay, and provider/forwarded/duplicate/covered/repaired result counts. Server summaries use the existing trace ID and emit at most once per five seconds plus completion/failure. Client/server summaries are preserved in the separate phone live-speaker version and shown on its panel.

Stages can be compared as native-to-client received → client sent → backend received → backend forwarded → provider result → displayed/saved result. Sample counts alone do not prove waveform equality or that all physical microphone events were delivered. Aggregate levels cannot identify an individual quiet speaker. These diagnostics help locate a missing stage without storing audio or transcript content in backend logs.

## Controlled provider comparison

Selected application settings stay unchanged: `atlas-deepgram-live-v1`, Nova-3, `version=latest` (a moving alias, not a dated build), streaming `diarize_model=v1`, en-US, linear16 mono at actual stream rate, interim results on, punctuation on, smart formatting off, filler words retained, endpointing 300 ms, model-improvement opt-out on. Returned model metadata is retained where supplied.

Official sources: [streaming format](https://developers.deepgram.com/docs/determining-your-audio-format-for-live-streaming-audio), [partial-final/interim sequence](https://developers.deepgram.com/docs/understand-endpointing-interim-results), [diarization](https://developers.deepgram.com/docs/diarization), [model choices](https://developers.deepgram.com/docs/model), [endpointing](https://developers.deepgram.com/docs/endpointing). No alternative model was adopted without evidence. A single 500 ms endpointing comparison was run; it is not a recognition-sensitivity adjustment and supplied no reason to change the application setting.

The fixture is generated locally by macOS speech synthesis, then mixed with FFmpeg: two alternating voices, a third attenuated to 7% amplitude, a short acknowledgment, a three-second pause before quiet speech, deliberate overlap, and a final sentence. This alters **only generated synthetic fixture audio**, never user recordings. Duration: 19.256 seconds; mono 24 kHz PCM16; 462,155 samples. All real calls used only this fixture through isolated localhost WebSocket sessions; no app database was opened by the evaluator.

| Run | First text, approximate | Final passages / unique IDs | Quiet scripted statements | Other observations |
| --- | --- | --- | --- | --- |
| Baseline, 300 ms | 1.237 s | 7 / 7 | Roof uncertainty and drainage both present | Quiet voice mostly merged with another voice; overlap phrase absent; “stop” transcribed as “stock” |
| Improved assembly/diagnostics, 300 ms | 1.146 s | 7 / 7 | Both present | Same final wording; only two speaker numbers returned |
| 500 ms comparison before timing fix | 1.388 s | 2 / 2 before failure | Later statements lost after adapter failure | Exposed provisional word ending beyond audio sent |
| After timing fix, 300 ms | 1.145 s | 7 / 7 | Both present | One malformed interim repaired; complete stream; same speaker merge and word error remain |

There were five bounded provider connections in total: one initial failed baseline probe, then the three comparison runs, then one verification after the diagnosed fix. The first failed probe did not retain sufficient event detail to establish its exact cause and is not attributed retroactively. No further model search or paid post-recording evaluation was run.

The last successful run had exactly 462,155 samples at all four counted transport stages, no clipped samples, and a peak queue of one 4,800-byte buffer. It had no duplicated final IDs or provisional remainder after completion. Final saved text and provenance can be serialized/reopened in deterministic tests; physical phone persistence remains a separate check.

These are **script-reference measurements**, not a human-verified accuracy score. The TTS pronunciation and overlapped reference need human listening review. Speaker counts are not identities: even the baseline's three numeric labels did not consistently represent three voices. Latency differences from single network runs are not a demonstrated speed improvement. No improvement in quiet-speaker recognition or diarization quality is claimed.

Artifacts: `tests/fixtures/deepgram-quiet/conversation.wav`, `reference.json`, `evaluation.json`, `evaluation-after-timing-fix.json`; the invalid synthetic event is separately retained in `tests/fixtures/deepgram-interim-timing.json`. The generator and evaluator have finite input/call/deadline bounds. The evaluator needs an explicit **unchanged baseline checkout**; using an already-updated checkout as baseline is not a valid before/after comparison.

## Meeting Memory

- Recording intake now offers saved OpenAI live, finalized Deepgram live speaker text, each available post-recording transcript, and saved-audio diarization as explicit alternatives. Existing saved-live preference is retained; Deepgram can be chosen when it exists. Provisional Deepgram text stays in the recording and is not indexed as finalized evidence.
- Importing another source from an already linked recording creates/selects an immutable revision under the existing logical meeting. Retries reuse the same source revision; the same provenance cannot silently change wording or speaker evidence. Confirmed-name revisions remain separate and repeat safely.
- `Transcript versions` on meeting detail supports reviewing both originals, **Make primary & process**, and **Ask using only this version** for a previously indexed revision. Selecting a version does not expose incomplete chunks: the previous published generation remains current until processing succeeds.
- Default retrieval searches only current published generations and deduplicates legacy meetings sharing an actual recording reference. Existing explicit diarization selections are respected when choosing a legacy canonical meeting. Older duplicate meeting records are not deleted or merged; their original IDs and citations remain explicitly accessible. Future imports reuse the canonical record. No historical recording relationship is invented.
- Explicit alternative questions use one meeting and its exact requested revision/generation. Saved answers retain exact revision/source citations. Differing source wording produces a disclosure that other versions were not merged or counted as corroboration; it does not declare either transcript correct.
- Deepgram attribution is transferred only where its own full result text exactly equals its ordered word text. Exact UTF-16 spans come from that reconstruction, adjacent words of the same provider voice are grouped, and optional provider-stream timing is separate from `audio:null`. A mismatch leaves attribution absent instead of fuzzy-aligning text. Participant names never assign speakers, and no live identity is transferred to post-recording text.
- No SQLite schema migration, new hosting, account system, prompt changes or phone-audio migration. Existing relational revision/evidence/generation/answer tables are reused. Flexible provider-stream metadata uses existing metadata columns; source IDs, original spans and speaker links remain relational.

Post-recording Transcribe Recording and Identify speakers are still explicit recovery actions. They may incur provider charges and retain their own versions. Deepgram recordings still do not automatically invoke paid OpenAI post-processing on save.

## Phone acceptance gate

Use Expo Go. Before restarting services/reloading, finish any active recording. Then:

1. Reload Atlas; menu → Live Transcription → Record → Recording mode → Refresh availability → **Live speaker labels — experimental**.
2. Record 45–60 seconds with two alternating people, a quieter third person, “yes/okay,” a pause followed by quiet speech, and brief overlap. Use only synthetic meeting content. Write down what each person actually said; that manually checked reference is the authority, not another model's output.
3. Say “This is the final sentence before Stop,” then immediately Stop & Save. Reopen and restart Expo Go. Check final/provisional text, sample counts, complete original playback, omissions, speaker swaps/merges, and time until text/labels first appeared.
4. Explicitly run saved-audio transcription if comparison is wanted. Add to Meeting Memory, select the live source and process; import the post source into the **same meeting**. Compare originals, change primary, ask using each indexed version, and open an older answer's original citation.
5. Make one short recording in **Existing live transcription** to confirm the fallback remains available.

Deepgram becomes the default only after the user explicitly confirms acceptance. If its quiet-speaker coverage remains worse, keep the fallback and report that result.

## Startup

Already-running services should not be duplicated. From the main project, use separate terminals when a coordinated restart is needed:

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
npm run backend
```

```sh
cd /Users/andywu/Desktop/Codex/atlas-port
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan
```

Keep the Mac/iPhone on the same Wi-Fi. `DEEPGRAM_API_KEY` and the experimental enable flag remain only in the ignored backend `.env`. This preserves the existing development LAN setup and does not resolve authentication/TLS production gates.

## Verification and integration record

Automated checks and the final activation state are recorded below. No Xcode, simulator, native build, deployment or publishing was used.

- Integrated September 10, 2026 through a checked, focused 48-file patch from the tested checkout. Each integrated file matched the tested source byte for byte. A fingerprint comparison found no unexpected changes outside the patch, and all 210 snapshotted files in the separate authentication-foundation checkout were unchanged. Existing uncommitted work was preserved; no dependency update or database migration was performed.
- The user confirmed no active phone recording. Immediately before the coordinated restart, read-only checks found no established backend connections or active processing jobs. The backend restarted successfully from the main project's `server` directory with `npm run dev` (equivalent to root `npm run backend`).
- Localhost and LAN health checks both returned `ok:true`, `liveSpeakerLabels.available:true`, configuration `atlas-deepgram-live-v1`, matching loaded/source revision `6ed80a3c9ba7310c`, and `restartRequired:false`. Metro remained running on port 8081. The private key stayed in the ignored backend environment file.
- After integration, `npm test` passed **172/172**, including deterministic PCM transport/borrowed-buffer ownership, shorter-final retention, malformed-interim recovery, Stop/save/reopen persistence, transcript separation, revision selection, failed publication, exact historical citations, recording/playback and upload regressions. These tests use isolated synthetic fixtures and provider doubles; the separate real-provider comparison is reported above.
- `npm run typecheck`, `npm run lint` and `git diff --check` passed. Metro compiled the iOS development bundle containing the experimental selector, transcript-version controls and current LAN endpoint. This is a JavaScript bundle check, not a native build or device test.
- Read-only post-restart checks still showed SQLite schema v2, eight ready meetings, four ready diarizations and two published memory jobs. No active-data processing or paid Meeting Memory evaluation was run.
- **Awaiting physical-phone acceptance:** actual Expo Go microphone transport, quieter-speaker coverage, speaker assignment accuracy, Stop/save/reopen completeness, playback, and the source-selection/question/citation UI flow. The synthetic reference also still needs human listening review; no human-verified accuracy score or successful default-mode gate is claimed.

For the current running app, shake the iPhone to open Expo Go's developer menu and choose **Reload**. If it has lost the Metro session, open `http://10.0.0.104:8081/_expo/loading` on the same Wi-Fi and choose Expo Go. The backend and Metro are already running; do not start duplicate processes.
