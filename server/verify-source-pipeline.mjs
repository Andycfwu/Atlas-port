// Bounded real-model evaluation. Sends ONLY the named synthetic fixtures to OpenAI.
// Mechanical assertions do not establish factual fidelity; review the source/omission
// and derived-note audit saved in the report as well as the answer checks.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { createMemoryProvider } from './memory/provider.mjs';
import { retrieve, validateFilters } from './memory/retrieval.mjs';
import { processingConfig } from './memory/pipeline.mjs';
if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('Configure backend OPENAI_API_KEY before this opt-in evaluation.');
const dir = mkdtempSync(join(tmpdir(), 'atlas-source-real-'));
const store = new MeetingStore(join(dir, 'eval.sqlite'));
const provider = createMemoryProvider(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 }));
const service = new MeetingMemoryService(store, provider);
const six = JSON.parse(readFileSync(new URL('../tests/fixtures/founder-six-sentences.json', import.meta.url)));
const cases = [
  { name: 'founder-six', text: six.sentences.join(' '), topic: 'stable recording ID', first: six.sentences[0], last: six.sentences[5], question: 'How will Atlas avoid duplicate meetings when renamed?', expect: /stable|recording ID|identifier/i },
  { name: 'structured', file: 'meeting-memory-synthetic.txt', topic: '42 Cedar Lane drainage estimate', first: '$18,000', last: '$26,500', question: 'What did Mike and I discuss about the Cedar Lane cost estimate, its correction, and whether work was approved?', expect: /26,?500/, also: /18,?000/ },
  { name: 'messy-unlabeled', file: 'meeting-memory-messy-unlabeled.txt', topic: '42 Cedar Lane drainage estimate', first: '$18,000', last: '$26,500', question: 'What did Mike and I discuss about Cedar Lane costs and approval?', expect: /26,?500/, also: /18,?000/, anonymous: true },
  { name: 'messy-flat', file: 'meeting-memory-messy-flat.txt', topic: 'B-17 Harbor Court cabinet allowance', first: '$15,000', last: '$17,800', question: 'What did Mike and I discuss about the B-17 cabinet allowance, its correction, and order approval?', expect: /17,?800/, also: /15,?000/, anonymous: true },
];
const report = { label: 'REAL PROVIDER · SYNTHETIC DATA ONLY', timestamp: new Date().toISOString(), config: processingConfig(provider), cases: [], checks: [] };
const out = new URL(`../.expo/dev/logs/source-pipeline-real-model${process.env.ATLAS_EVAL_FIXTURE ? '-' + process.env.ATLAS_EVAL_FIXTURE.replace(/[^a-z-]/g, '') : ''}.json`, import.meta.url);
async function check(name, fn) { try { await fn(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); } catch (e) { report.checks.push({ name, passed: false, error: e.message }); console.log(`FAIL ${name}: ${e.message}`); } }
const textOf = answer => answer.statements.map(s => s.text).join(' ');
try {
  for (const config of cases.filter(c => !process.env.ATLAS_EVAL_FIXTURE || c.name === process.env.ATLAS_EVAL_FIXTURE)) {
    const original = config.text ?? readFileSync(new URL(`../tests/fixtures/${config.file}`, import.meta.url), 'utf8');
    const { meeting } = store.create({ title: `SYNTHETIC · ${config.name}`, date: '2026-09-08', participants: ['Mike', 'Jordan'], originalTranscript: original });
    const audit = { name: config.name, answers: [] }; report.cases.push(audit);
    await check(`${config.name}: processing`, async () => { service.start(meeting.id); await service.jobs.get(meeting.id); assert.equal(store.get(meeting.id).status, 'ready', store.get(meeting.id).error); });
    const ready = store.get(meeting.id); if (ready.status !== 'ready') { audit.error = ready.error; continue; }
    audit.meeting = ready; audit.chunks = store.chunks(ready.id).map(({ embedding, ...c }) => c);
    audit.omissionAudit = ready.omissions.map(o => ({ ...o, original: ready.passages.find(p => p.id === o.sourceId).text }));
    await check(`${config.name}: recurrence, original chunks and meaningful coverage`, async () => {
      const first = ready.passages.find(p => p.text.includes(config.first)), last = ready.passages.find(p => p.text.includes(config.last));
      assert.ok(ready.sourceTopics.some(t => t.sourceIds.includes(first.id) && t.sourceIds.includes(last.id)), 'Early and later topic evidence must share a source topic.');
      const [vector] = await provider.embed([config.topic]);
      const retrieved = retrieve([ready], id => store.chunks(id), config.topic, vector, validateFilters({}));
      assert.ok(retrieved.sources.some(s => s.passageId === first.id)); assert.ok(retrieved.sources.some(s => s.passageId === last.id));
      for (const o of audit.omissionAudit) assert.doesNotMatch(o.original, /\$|preliminary|inspection|quote|permit|cabinet|easement|east mint|not approved|no order|i'll|I'll|Friday|Monday|recording ID|project teams/i);
      for (const p of ready.passages) assert.equal(p.text, original.slice(p.start, p.end));
      if (config.name === 'founder-six') assert.ok(audit.omissionAudit.some(o => /Testing one two three/.test(o.original)));
    });
    await check(`${config.name}: grounded question and immutable citations`, async () => {
      const answer = await service.ask({ question: config.question, filters: { meetingIds: [ready.id], participant: 'Mike' } }); audit.answers.push(answer);
      assert.equal(answer.status, 'answered'); assert.equal(answer.scope, 'meeting'); assert.match(textOf(answer), config.expect); if (config.also) assert.match(textOf(answer), config.also);
      assert.doesNotMatch(textOf(answer), /\bweather|umbrella|coffee|dog|hike\b/i);
      if (config.anonymous) {
        assert.equal(ready.speakers.length, 0); assert.equal(ready.segments.length, 0);
        assert.ok(answer.statements.every(s => s.kind !== 'decision')); assert.match(textOf(answer), /preliminary|tentative|rough|not final/i);
        assert.doesNotMatch(textOf(answer), /\b(?:Mike|Jordan) (?:said|stated|estimated|corrected|promised)/i);
      }
      for (const statement of answer.statements) for (const c of statement.citations) {
        const resolved = store.versions.source(c.meetingId, c.revisionId, c.passageId); assert.ok(resolved.text.includes(c.quote));
        if (config.anonymous) assert.equal(c.speaker, null);
      }
    });
    if (config.anonymous) await check(`${config.name}: speaker-specific question lacks attribution`, async () => {
      const answer = await service.ask({ question: `What did Mike say about ${config.topic}?`, filters: { meetingIds: [ready.id] } }); audit.answers.push(answer);
      assert.ok(['clarification', 'insufficient_evidence'].includes(answer.status)); assert.equal(answer.statements.length, 0); assert.match(answer.limitation, /Insufficient speaker attribution/);
    });
    if (config.name === 'messy-flat') await check('unsupported question has insufficient evidence', async () => {
      const answer = await service.ask({ question: 'Which bank approved the mortgage and at what interest rate?', filters: { meetingIds: [ready.id] } }); audit.answers.push(answer); assert.equal(answer.status, 'insufficient_evidence');
    });
  }
} catch (e) { report.fatal = e.message; process.exitCode = 1; }
finally {
  mkdirSync(new URL('.', out), { recursive: true }); writeFileSync(out, JSON.stringify(report, null, 2));
  store.close(); rmSync(dir, { recursive: true, force: true });
  if (report.checks.some(c => !c.passed)) process.exitCode = 1;
  console.log(`Synthetic evaluation report: ${out.pathname}`);
}
