import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, existsSync, realpathSync, statSync, renameSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, PROVIDERS } from './config.mjs';
import { sha256, referenceIssues, reserveAttempt } from './reference.mjs';
import { replay } from './replay.mjs';
import { scoreRun } from './score.mjs';
const local = fileURLToPath(new URL('./local/', import.meta.url));
const credentials = { deepgram: process.env.DEEPGRAM_API_KEY, assemblyai: process.env.ASSEMBLYAI_API_KEY, speechmatics: process.env.SPEECHMATICS_API_KEY };
const [provider, referencePath, mode] = process.argv.slice(2);
if (!PROVIDERS[provider] || !referencePath || (mode !== undefined && !['--dry-run','--execute'].includes(mode))) {
  console.log('Usage: node --env-file=server/.env --env-file-if-exists=.env.provider-eval server/provider-eval/run.mjs PROVIDER server/provider-eval/local/sample-1/reference.json [--dry-run|--execute]');
  process.exitCode = 1;
} else if (!existsSync(referencePath)) {
  console.log(JSON.stringify({ status: 'blocked', provider, reason: 'Approved human sample and reviewed reference are missing.', credential: credentials[provider]?.trim() ? 'configured' : 'missing', providerCalls: 0 }));
  process.exitCode = 2;
} else {
  const refPath = realpathSync(referencePath), localPath = realpathSync(local);
  if (relative(localPath, refPath).startsWith('..') || refPath === localPath) throw new Error('REFERENCE_MUST_BE_IN_ISOLATED_LOCAL_DIRECTORY');
  const pcmPath = realpathSync(resolve(dirname(refPath), 'audio.pcm'));
  if (relative(localPath, pcmPath).startsWith('..') || statSync(pcmPath).size > 4320000 || statSync(refPath).size > 256000) throw new Error('INPUT_BOUND');
  const reference = JSON.parse(readFileSync(refPath)), pcm = readFileSync(pcmPath), key = credentials[provider];
  const issues = referenceIssues(reference, pcm, provider);
  if (!key?.trim()) issues.push(`Configure ${PROVIDERS[provider].key} locally; do not send it in chat.`);
  console.log(JSON.stringify({ provider, status: issues.length ? 'blocked' : mode === '--execute' ? 'ready' : 'dry-run', issues,
    durationSeconds: pcm.length / 48000, estimatedAudioUsd: pcm.length / 48000 / 60 * PROVIDERS[provider].pricePerMinute,
    maxReservedUsd: LIMITS.sessionMs / 60000 * PROVIDERS[provider].reservePerMinute, providerCalls: 0 }));
  if (issues.length) process.exitCode = 2;
  else if (mode === '--execute') {
    // Prices/models are moving. A later task must re-check published prices,
    // rather than silently carrying this dated quote indefinitely.
    if (Date.now() > Date.parse('2026-09-17T23:59:59Z')) throw new Error('PRICING_REVIEW_EXPIRED');
    mkdirSync(resolve(local, 'runs'), { recursive: true, mode: 0o700 });
    const lockPath = resolve(local, 'run.lock'), lock = openSync(lockPath, 'wx', 0o600);
    writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const ledgerPath = resolve(local, 'ledger.json');
    const saveLedger = value => { writeFileSync(ledgerPath + '.next', JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(ledgerPath + '.next', ledgerPath); };
    try {
      const old = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath)) : { schemaVersion: 1, attempts: [] };
      const ledger = reserveAttempt(old, provider, sha256(pcm)); saveLedger(ledger);
      const index = ledger.attempts.length - 1, output = resolve(local, 'runs', `${index + 1}-${provider}.json`);
      const result = await replay({ provider, key, pcm });
      let scoring;
      try { scoring = scoreRun(result, reference); } catch { scoring = { status: 'unavailable', reason: 'Reference/provider shape cannot be scored; inspect isolated raw events.' }; }
      writeFileSync(output, JSON.stringify({ evaluationOnly: true, createdAt: new Date().toISOString(), audioSha256: sha256(pcm), reference, result, scoring }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      ledger.attempts[index] = { ...ledger.attempts[index], status: result.status, estimatedUsd: result.estimatedUsd, output: `${index + 1}-${provider}.json` }; saveLedger(ledger);
      console.log(JSON.stringify({ status: result.status, failure: result.failure, provider, finalizedRecords: result.finalRecords.length,
        estimatedUsd: result.estimatedUsd, invoiceCostUsd: null, artifact: output }));
      if (result.failure) process.exitCode = 2;
    } finally { closeSync(lock); unlinkSync(lockPath); }
  }
}
