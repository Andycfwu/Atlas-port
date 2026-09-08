# Saved live/post transcripts — investigation and handoff

September 8, 2026. Expo Go on the physical iPhone is the target. No Xcode,
simulator, native build, cache cleanup, app reinstall, publication or historical
recording deletion was performed for this change. Existing work is preserved.

## Confirmed findings versus unresolved cause

The reported symptom is audible room participants in saved audio and visible live
words, but sometimes a saved transcript containing only one person's words.
Inspection against `22f867d` and current `b559f88` found:

1. **Confirmed persistence gap, predating the shell:** live text existed only in
   hook refs/React state. `SavedRecording` had only `transcript`, populated by the
   independent post-recording request. A new session/reset discarded the live
   draft. The app never compared or saved the richer live source.
2. **Confirmed Stop race:** the provider requested live completion without
   awaiting it, before stopping native capture. Saving did not read final live
   events or the accumulated draft. The UI publishes on a 250 ms batch timer, so
   it is also unsuitable as the source of truth for final-event saving.
3. **Confirmed storage race risk:** save, rename, post updates, deletion and
   startup normalization independently read and rewrote the whole recordings
   array. Concurrent operations could clobber another update. Tests now exercise
   concurrent mutations. No affected historical JSON is available to establish
   that this race caused a particular missing-speaker incident.
4. **No demonstrated audio clipping or response truncation in this path:** the
   recorder copies the original encoded M4A and verifies source/destination size
   and playable duration before metadata and duplicate-source cleanup. The phone
   sends the whole Expo File in multipart FormData. Multer receives the completed
   upload; the server passes the whole temporary file to `gpt-transcribe` and
   returns its text. The API client awaits the complete HTTP response body. There
   is no speaker filter, audio clip, text-length slice or summary substitution.
   The text endpoint reads a string/`.text`, not a streamed segment assembly.
   Unexpected segment-only results fail as empty text, rather than guessing a
   concatenation. Response segment counts are now logged if supplied.

**The reason the independent post-recording model sometimes omits audible voices
remains unproven.** We have not replayed an affected recording with matched byte
counts and its provider response. Neither microphone quality nor model behavior
is established as the cause. A matched upload byte count establishes length, not
an audio checksum or proof that every utterance was recognized.

## Changes

- Native recording stops first; PCM is released afterward as before. Live
  completion then drains its network queue. Saving awaits a snapshot of current
  refs through completion/failure/pause, including final events received during
  Stop. A 16-second outer bound retains partial text with a visible failed state
  if finalization stalls (the connection also has its own timeout).
- `SavedRecording.liveTranscript` holds original accumulated text, ordered item
  IDs, raw accumulated deltas and final strings, trace/session IDs, known model,
  capture status, saved time and failure message. Item IDs are not speaker labels
  or audio timestamps. Existing delta-to-final updates for the same item remain
  intact; independent transcripts are never guessed into a merged source.
- `postTranscripts` retains successful saved-audio versions with provenance. The
  legacy `transcript` field remains the latest post result for compatibility.
  Starting/retrying/failing cannot erase previous text or live text. Trace guards
  ignore obsolete post responses. All metadata mutations are serialized.
- Original strings are validated for nonblank content without trimming them.
  Live per-item whitespace is retained, with a separator between items. No filler
  or small talk is removed here. Cleanup stays in Meeting Memory's derived notes.
- Recording Detail shows saved live and saved-audio text separately, including
  partial status, version history and an explicit **Transcribe audio again (keeps
  previous)** action. Automatic post-recording transcription still runs after a
  normal save; its result cannot overwrite the live source.
- **Add to Meeting Memory** opens a separate review form using saved live text
  by default; absent/blank live text falls back to a successful post transcript.
  Original text is read-only; participants are attendance, never inferred voices.
  No copy/paste is needed. The paste/import draft is kept separate. Source
  identity persists in SQLite and cited-answer source snapshots. Repeated
  transfers reuse the same source key; changed details cause a visible conflict.
- The phone sends its measured audio byte count. The backend rejects a mismatch
  before contacting OpenAI. Diagnostics record sizes/character counts/trace IDs,
  not source text, audio or credentials. This is backward-compatible with older
  clients that do not supply the header; those uploads cannot be size-compared.

Storage remains phone `Documents/recordings/recordings.json` and original M4As.
A separate `Documents/atlas-recording-recovery/<sessionId>.live.json` preserves
live text if subsequent audio validation or library metadata saving fails. It is
an additional recovery copy, not an automatic recovery/import UI. Single-file
recording metadata does not gain transactional crash recovery or cloud backup.
Live text is persisted during Stop, not continuously during capture; force-quitting
before Stop can still lose the unsaved live draft.
Meeting Memory uses the existing Mac SQLite database; selected text and metadata
are sent on explicit transfer, then to OpenAI on processing. Audio and alternate
transcript versions remain on the phone. No new native dependency was added.

## Verification actually completed

- `npm test`: **95/95 passing**. New deterministic checks cover late final-event
  capture before the UI batch, immutable snapshots across reset, Stop timeout,
  background pause, raw per-item deltas/finals, save/reopen persistence,
  concurrent mutations, stale-response rejection, failed retries, earlier post
  versions, legacy migration, live-first/fallback transfer, source deduplication,
  byte-count rejection, full multipart file contents and full HTTP text retention.
- `npm run typecheck`, `npm run lint`, and `git diff --check`: passing.
- Metro generated the updated iOS JS bundle over HTTP without a native build.
- Running backend `/health` returned `ok: true`, with loaded/source live revision
  matching. A deliberately mismatched **synthetic** multipart upload returned
  HTTP 400 `UPLOAD_REJECTED` before transcription. This was not a real audio test.
- No real-model transcription or new model-quality evaluation was performed for
  this safeguard. Previous structured/messy Meeting Memory evaluations remain
  documented separately; mocked tests do not establish recognition quality.
- **Pending:** the new physical multi-person save/reopen/transfer test below,
  including Expo Go's actual multipart file handling, late native PCM delivery,
  and an affected recording's upstream transcription. Earlier user-confirmed
  live/playback/navigation tests predate this change and do not verify it.

## Historical recordings

Recordings saved before this change have no persisted live source unless one was
separately exported outside Atlas. Their missing live words cannot be recovered
from `recordings.json`, a restart, or Meeting Memory. If words are present in the
original audio but absent from saved text, retranscription is required to attempt
recovery. The new retry keeps previous results; it cannot guarantee the model
will recognize every audible speaker. Existing audio and text were not rewritten.
The phone's historical library was not accessible for enumerating affected IDs,
so no specific recording is claimed repaired. Existing limits remain: 25 MB file
transcription and 60,000 characters for one Meeting Memory intake.

## Exact startup commands

From two terminals (reuse current servers or Ctrl+C their terminals before
starting replacements on the same ports):

```sh
# Terminal 1
cd /Users/andywu/Desktop/Codex/atlas-port
npm run backend
```

```sh
# Terminal 2
cd /Users/andywu/Desktop/Codex/atlas-port
EXPO_PUBLIC_API_URL="http://$(ipconfig getifaddr en0):8787" npx expo start --go --lan --port 8081
```

Keep `OPENAI_API_KEY` in `server/.env` only. Both servers were running at handoff;
the current Mac Wi-Fi address was `10.0.0.104`. The backend already binds to
`0.0.0.0:8787`; iPhone Safari must reach `http://10.0.0.104:8787/health` on the same
Wi-Fi. Allow Expo Go Local Network access and Node incoming connections when
prompted. Metro's QR/connection does not expose the separate backend. Scan the
Metro QR in Expo Go, or use `http://10.0.0.104:8081/_expo/loading` and choose Expo
Go. Reload only while no recording is active. No native rebuild is necessary.

Foreground recording, playback, files, clipboard and Meeting Memory use existing
SDK 57 Expo Go-compatible modules. Project-specific background audio configuration
cannot be applied in Expo Go. Live transcription intentionally pauses on phone
lock/app switching; continuous background recording is unsupported here.

## One short physical-iPhone acceptance test

Reload Atlas in Expo Go while idle. Keep it in the foreground and record about
20 seconds with three people at normal room distances, each stating a different
property fact. Let the quieter person finish just before tapping **Stop & Save**.
Wait for saving, leave the recording, then reopen it. Check complete playback and
that **Saved live transcript** contains all three facts, including the last one;
post-recording text must appear separately even if different. Tap **Add to Meeting
Memory**, review the unchanged original, then save/process and ask “What property
facts were discussed?” Open its citations and confirm they quote that same live
source. Report any missing fact or the first step that fails. This tests content
coverage, not attribution of unlabeled voices to people.
