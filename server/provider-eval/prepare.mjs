// Local-only conversion after explicit approval. Does not contact a provider.
import { execFileSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './reference.mjs';
const [source, sampleId, approval] = process.argv.slice(2);
if (!source || !/^[a-z0-9-]{1,40}$/.test(sampleId ?? '') || approval !== '--approved-synthetic') throw new Error('Usage: node server/provider-eval/prepare.mjs AUDIO_PATH sample-1 --approved-synthetic');
const input = realpathSync(source);
if (!['.m4a','.wav','.mp3','.aac','.flac'].includes(extname(input).toLowerCase()) || statSync(input).size > 50 * 1024 * 1024) throw new Error('Use an approved audio file at most 50 MiB.');
const duration = Number(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',input], { timeout: 10000, maxBuffer: 10000 }).toString().trim());
if (!Number.isFinite(duration) || duration <= 0 || duration > 90) throw new Error('Sample must be at most 90 seconds; no automatic trimming.');
const directory = resolve(fileURLToPath(new URL('./local/', import.meta.url)), sampleId);
if (existsSync(directory)) throw new Error('SAMPLE_EXISTS: choose a distinct ID; originals are never overwritten.');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const pcmFile = resolve(directory, 'audio.pcm');
execFileSync('ffmpeg', ['-nostdin','-v','error','-n','-i',input,'-map','0:a:0','-vn','-ac','1','-ar','24000','-acodec','pcm_s16le','-f','s16le',pcmFile], { timeout: 20000, maxBuffer: 10000 });
const unpadded = readFileSync(pcmFile), padding = (2400 - unpadded.length % 2400) % 2400;
if (!unpadded.length || unpadded.length + padding > 4320000) throw new Error('Decoded audio exceeds the 90-second bound.');
const pcm = Buffer.concat([unpadded, Buffer.alloc(padding)]); writeFileSync(pcmFile, pcm, { mode: 0o600 });
writeFileSync(resolve(directory, 'reference.json'), JSON.stringify({ schemaVersion: 1, sampleId, syntheticOnly: true,
  humanRecorded: false, approvedProviders: [], manuallyReviewed: false, reviewedBy: null, reviewedAt: null,
  pcmSha256: sha256(pcm), originalSha256: sha256(readFileSync(input)), conversion: { sampleRate: 24000, channels: 1,
    encoding: 'pcm_s16le', originalDurationMs: duration * 1000, paddingMs: padding / 48, gainAdjustment: false },
  timingAccuracy: 'approximate-turns', verbatimTextReviewed: false, turns: [],
}, null, 2) + '\n', { mode: 0o600 });
console.log(`Prepared ${sampleId}: ${(pcm.length / 48000).toFixed(2)} seconds. Review server/provider-eval/local/${sampleId}/reference.json before any provider run.`);
