import { createHash } from 'node:crypto';
import { LIMITS, PROVIDERS } from './config.mjs';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function referenceIssues(ref, pcm, provider) {
  const issues = [];
  if (ref.schemaVersion !== 1 || ref.syntheticOnly !== true || ref.humanRecorded !== true) issues.push('A human-recorded, synthetic-only sample is required.');
  if (!Array.isArray(ref.approvedProviders) || !ref.approvedProviders.includes(provider)) issues.push('Explicit sample approval for this provider is missing.');
  if (ref.manuallyReviewed !== true || typeof ref.reviewedBy !== 'string' || !ref.reviewedBy.trim() || !Number.isFinite(Date.parse(ref.reviewedAt))) issues.push('A manually reviewed reference and reviewer/date are required.');
  if (!pcm.length || pcm.length % LIMITS.frameBytes || pcm.length / 48 > LIMITS.audioMs || ref.pcmSha256 !== sha256(pcm)) issues.push('PCM format/duration/hash validation failed.');
  if (!Array.isArray(ref.turns) || !ref.turns.length || ref.turns.length > 100) return [...issues, 'Supply 1–100 manually checked turns.'];
  const ids = new Set(), speakers = new Set();
  for (const turn of ref.turns) {
    if (typeof turn.id !== 'string' || !turn.id || ids.has(turn.id)) issues.push('Turn IDs must be unique.');
    ids.add(turn.id);
    if (turn.speaker !== null) speakers.add(turn.speaker);
    if (turn.speaker !== null && !/^R[1-3]$/.test(turn.speaker)) issues.push('Use reference speakers R1–R3 or null for ambiguity.');
    if (!Number.isFinite(turn.startMs) || !Number.isFinite(turn.endMs) || turn.startMs < 0 || turn.endMs <= turn.startMs || turn.endMs > pcm.length / 48) issues.push('Reference timing is outside the approved audio.');
    if (typeof turn.text !== 'string' || turn.text.length > 2000 || typeof turn.ambiguous !== 'boolean' || !Array.isArray(turn.tags) || turn.tags.some(t => !['normal','quiet','acknowledgment','pause-following','overlap','returning','stop'].includes(t))) issues.push('Malformed reference turn.');
  }
  for (let i = 0; i < ref.turns.length; i++) for (let j = i + 1; j < ref.turns.length; j++) {
    const a = ref.turns[i], b = ref.turns[j];
    if (a.startMs < b.endMs && b.startMs < a.endMs && !(a.tags?.includes('overlap') && b.tags?.includes('overlap'))) issues.push('Overlapping reference intervals must both be explicitly tagged overlap.');
  }
  if (speakers.size < 2) issues.push('At least two independently identified reference speakers are required.');
  return [...new Set(issues)];
}
// One ledger for the entire bounded comparison, not one quota per invocation.
// Consuming an attempt before connecting makes failed/interrupted runs count.
export function reserveAttempt(ledger, provider, audioHash, now = new Date()) {
  if (!PROVIDERS[provider] || !Array.isArray(ledger.attempts)) throw new Error('INVALID_LEDGER');
  if (ledger.attempts.some(a => !PROVIDERS[a.provider] || !Number.isFinite(a.reservedUsd) || a.reservedUsd < 0 || typeof a.audioHash !== 'string')) throw new Error('INVALID_LEDGER');
  if (ledger.attempts.filter(a => a.provider === provider).length >= LIMITS.runsPerProvider) throw new Error('PROVIDER_ATTEMPT_LIMIT');
  const hashes = new Set(ledger.attempts.map(a => a.audioHash)); hashes.add(audioHash);
  if (hashes.size > LIMITS.samples) throw new Error('RECORDING_LIMIT');
  const reservedUsd = LIMITS.sessionMs / 60000 * PROVIDERS[provider].reservePerMinute;
  if (ledger.attempts.reduce((n, a) => n + a.reservedUsd, 0) + reservedUsd > LIMITS.budgetUsd) throw new Error('BUDGET_LIMIT');
  return { ...ledger, attempts: [...ledger.attempts, { provider, audioHash, startedAt: now.toISOString(), reservedUsd, status: 'reserved' }] };
}
