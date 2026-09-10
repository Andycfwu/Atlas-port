# OpenAI windowed diarization — evaluation specification, September 10, 2026

**Untested; not integrated or executable in the current harness.** This extends
the [comparison](live-provider-comparison.md), not Atlas's provider selection.
No API calls, audio uploads, credential changes, service restarts or database
writes were performed for this addition. The approved human sample and manual
reference are still missing. Existing phone results for whole-recording speaker
identification do not verify short-window attribution or identity continuity.

## Verified API and existing integration

[Official file transcription documentation](https://developers.openai.com/api/docs/guides/speech-to-text)
supports `gpt-4o-transcribe-diarize`, `diarized_json`, and timed speaker segments.
Use `chunking_strategy: "auto"`; it is required beyond 30 seconds. WAV uploads
are supported, with a 25 MB file ceiling. File-result streaming is supported,
but it does not accept a continuously growing microphone stream. No prompt is
supported for this model. Known-speaker enrollment permits up to four approved
2–10 second clips, separately supplied as references. None are supplied here;
that option is deferred and must not be conflated with anonymous detection.

The [model contract](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize)
lists only the Transcriptions endpoint, a 16,000-token context and 2,000-token
maximum output. Atlas already calls this model in
`server/diarization/service.mjs`; it is a persistent saved-recording workflow,
not an isolated evaluation runner. Do not invoke its route for this experiment.
`server/live-transcription-server.mjs` uses `gpt-live-transcribe` for immediate
text. Preserve that configuration and its Stop handling.

## Two proposed configurations, no tuning sweep

Use one approved 60–90 second human recording, the same PCM hash and reviewed
reference as all other providers. Replay at 1× pace. Wrap exact PCM slices in
WAV containers without normalization, gain changes, padding between windows or
speech-based boundary manipulation. Keep original audio unchanged.

| Configuration | Windows for a 90-second sample (seconds) | Upload duration / requests | Earliest first-window submission |
| --- | --- | --- | --- |
| A: 20-second windows, no overlap | [0,20), [20,40), [40,60), [60,80), [80,90) | 90 seconds / 5 | 20 seconds after first audio |
| B: 30-second windows, 2-second overlap | [0,30), [28,58), [56,86), [84,90) | 96 seconds / 4 | 30 seconds after first audio |

Flush the final partial window at Stop, including the last sample. These are
collection delays, not measured response latency. Send no window before its
audio has arrived. Preserve the final partial window even when very short;
report any provider rejection rather than retrying with invented silence.
Each configuration is one experiment attempt, with its listed child requests;
two attempts maximum across all samples, not two attempts for each window.
No automatic retries, alternative window sizes or known-reference runs.

## Required isolated harness work (not implemented)

1. Add an OpenAI immediate-text replay adapter with the existing session settings,
   using no application server or storage. Retain raw deltas, finals, errors,
   request/model metadata and finalization evidence. It can run **once** on the
   same sample and serve as the explicitly shared immediate-text baseline for
   both window configurations; do not imply two measured live runs.
2. Add a separate completed-WAV request scheduler. Bound each request to 30 seconds
   of audio and 60 seconds of wall time, one in flight, a bounded five-window
   queue and a 180-second experiment deadline. Abort and report failures; never
   drop queued audio silently. Record collection, queue, upload, first result
   and completion times separately. Include queue time in user-visible delay.
3. Extend the durable ledger **before** adding execution: reserve both paths and
   every child request before network access, retain reservations on failure,
   and keep the existing global $0.15 ceiling and maximum two approved hashes.
   The current ledger only reserves whole WebSocket attempts. Current
   `connectionConfig` and journal do not implement OpenAI window requests.
4. Store separate immediate-text and per-window raw responses in ignored local
   artifacts, with sample hash, exact sample offsets, request IDs, usage and
   arrival times. Validate segment structure and finite ordered timing within
   each submitted window; retain malformed raw responses as failed evidence.
   Convert valid local times to sample times using the known window offset only.
   Never use text similarity to move labels onto the immediate transcript.
5. Namespace speaker IDs by configuration, run and window/request. Unknown labels
   remain unknown. Preserve provider labels verbatim and keep overlapping-window
   outputs separate. Do not concatenate A/B labels as a stable meeting identity.
6. Extend deterministic tests for slice coverage, final sample retention, overlap
   byte counts, request namespaces, timeout/failed-window accounting, immutable
   outputs and zero calls when sample approval or combined budget is missing.
   The present WebSocket tests do not validate these requirements.

## Continuity and quality review

Report immediate text and window text coverage independently against the manually
reviewed human reference. Inspect quiet words, acknowledgments, returning voices,
negations and the last sentence. For each labeled passage, measure arrival minus
its referenced spoken end time; report first label, median/range and post-Stop
completion. There is no provisional speaker label before a window result arrives.

Within each request, use one fixed mapping to reviewed R1/R2/R3 across all turns;
never remap turn by turn. Report merges, splits and swaps within that request.
Across requests, explicitly list which reviewed voices each raw label represents,
including label reuse for a different voice and label changes for a returning
voice. A request-local best mapping is **not** a continuity score. No mapping
derived using the reference is an operational identity resolver. End-to-end
continuous speaker identity remains unavailable unless separately demonstrated.

Review both sides of every boundary, particularly cut words, corrections and
overlap. Count missing substantive words and duplicate passages caused by overlap
separately from provider repetition. Keep raw duplicates; do not repair them by
guessed alignment. Report overlap as ambiguous when listening cannot resolve it.
Do not claim word-level diarization metrics from segment-level or approximate
reference timing. Preserve concrete examples alongside any supported scores.

## Usage and budget gate

Current [live model pricing](https://developers.openai.com/api/docs/models/gpt-live-transcribe)
is $0.017/minute: one shared 90-second live baseline costs about **$0.0255**
before any account-specific adjustments. Two separate live runs would double it.
The [diarization model page](https://developers.openai.com/api/docs/models/gpt-4o-transcribe-diarize)
publishes $2.50 per million input audio tokens and $10 per million output tokens.
Record actual returned usage for every window; cost is
`input_tokens × 2.50 / 1e6 + output_tokens × 10 / 1e6` for those categories.
Retain full usage detail and verify any other charged categories against pricing.
Do not treat audio seconds as a verified token count or invoice.

Both configurations upload 186 seconds in total for a 90-second source, plus
90 seconds on the shared live path: **276 seconds across both paths**. This is
not nine free subdivisions of one request. The original streaming reservations
are approximately $0.1055; adding only this live baseline already reaches
$0.1310, leaving roughly $0.0190 for all nine diarization calls. That is not a
verified safe reservation. The documented 2,000-output-token ceiling alone could
cost $0.02 per request, so a conservative worst-case reservation does not fit.

Therefore **paid execution remains blocked**, with no invented per-minute rate
or extra allowance. Before execution, the shared planner must produce a bounded
estimate from the approved sample and applicable billing rules, reducing the
other provider repeats and/or choosing one of these two configurations if needed.
Report the revised matrix before any calls; do not exceed $0.15, reset the ledger,
or silently enlarge the budget. A strict worst-case cap that still cannot fit is
a stopping condition, not permission to rely on expected usage.

## Result and commands

No measured coverage, merges, swaps, boundary errors, label latency or usage exists
for this approach. Actual additional usage is **zero**, cost **$0**. Better
whole-recording attribution is promising but does not establish whether this
approach justifies delay, separate identities, extra uploads and cost. Retain the
current default; evidence is insufficient to recommend integration.

There is intentionally **no OpenAI execution command**: the current runner only
supports Deepgram, AssemblyAI and Speechmatics. Reuse the comparison's sample
preparation command and listening checklist; explicitly approve OpenAI upload in
the reference before any future execution. No backend restart or Expo reload is
needed. This addition changes documentation only; API support and existing code
were inspected, but no model or phone verification was performed. Existing test
results in the main comparison belong to the preceding harness work and were not
rerun for this documentation-only addition.
