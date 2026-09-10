# Human synthetic sample and reference

This is a **recording script/checklist, not a reviewed reference or model result**.
Use fictional details only. Two or three real people may read/ad-lib the script.
Record 60–90 seconds on the physical iPhone, save, and explicitly approve that
file for Deepgram, AssemblyAI and/or Speechmatics. Do not select private meetings.

Suggested content, using anonymous reference identities R1, R2, R3:

1. R1, normal: “The fictional Cedar project inspection is Tuesday. We have not approved the repair budget.”
2. R2, normal: “My tentative estimate is forty thousand dollars. We still need a written roof quote.”
3. R1: “Yes.”
4. R3, quieter: “Please include drainage. The roof estimate is uncertain.”
5. Leave a three-second pause; R3 quietly adds: “Do not sign before the inspection.”
6. R2: “Okay. I will request the quote tomorrow.”
7. Briefly overlap R1 saying “Paint the garage blue” with R2 saying “Keep the porch white.”
8. R1 returns after being silent: “We discussed options. We did not make a final purchase decision.”
9. R2: “This is the final sentence before Stop.” Immediately Stop & Save.

Use the same saved file for each provider. Another model's transcript is not the
reference. Listen to the actual audio, correct every scripted deviation, and
record approximate start/end milliseconds for each audible turn. Use overlapping
time ranges for overlap; mark both with `overlap`. Use `speaker:null` and
`ambiguous:true` where the recording cannot support attribution. Do not fill in
inaudible words from the script. The human who knows which person spoke can use
R1–R3; personal names are unnecessary.

After `prepare.mjs` creates the local sample directory, edit its `reference.json`:

```json
{
  "humanRecorded": true,
  "approvedProviders": ["deepgram", "assemblyai", "speechmatics"],
  "manuallyReviewed": true,
  "reviewedBy": "reviewer initials",
  "reviewedAt": "REPLACE WITH ACTUAL ISO REVIEW TIME",
  "timingAccuracy": "approximate-turns",
  "verbatimTextReviewed": true,
  "turns": [
    {
      "id": "turn-1",
      "speaker": "R1",
      "startMs": 0,
      "endMs": 1000,
      "text": "REPLACE WITH WORDS ACTUALLY HEARD",
      "ambiguous": false,
      "tags": ["normal"]
    }
  ]
}
```

This fragment is an **editing template**: retain the generated hash/conversion
fields; replace all example text/times and add every turn. Review the whole sample,
not just convenient sections. Tags: `normal`, `quiet`, `acknowledgment`,
`pause-following`, `overlap`, `returning`, `stop`.

Keep `approximate-turns` unless boundaries were carefully checked against the
audio. The scorer intentionally withholds WER for approximate boundaries. Only
`precise-turn-boundaries` plus verbatim review enables per-turn English WER for
clear, non-overlapping speech. It lowercases and ignores punctuation, does not
equate “40” and “forty,” and is not a full-recording or diarization error rate.

For each run, listen alongside the raw provider output and note:

- Missing substantive words, especially quiet statements and negations.
- One ID spanning different people (merge), one person getting several IDs
  (split), and wrong labels when a person returns (swap).
- Both words and attribution during overlap; explicitly note ambiguity.
- Final sentence present after Stop, duplicates, and unfinished provisional text.
- First provisional/final labeled text latency, provider errors and completion.

The scorer fits one global one-to-one mapping on clear, non-overlap initial final
words, and freezes it for that run's later speaker revisions. Its contingency
table and possible merge/split flags require listening review. Never remap each
turn or treat equivalent-looking IDs as the same person across runs/providers.
