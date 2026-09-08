// Opt-in real-provider acceptance checks. Only the explicitly synthetic fixture is sent.
import { readFileSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { createMemoryProvider } from './memory/provider.mjs';
import { retrieve, validateFilters } from './memory/retrieval.mjs';

if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('Configure OPENAI_API_KEY in server/.env before running the real-model check.');
const original = readFileSync(new URL('../tests/fixtures/meeting-memory-synthetic.txt', import.meta.url), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'atlas-memory-real-'));
const dbPath = join(dir, 'memory.sqlite');
let store = new MeetingStore(dbPath);
const provider = createMemoryProvider(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 }));
const organize = provider.organize;
provider.organize = async (...args) => {
  const result = await organize(...args);
  report.rawOrganization = result; // This opt-in report contains SYNTHETIC data only.
  return result;
};
const answer = provider.answer;
provider.answer = async (...args) => {
  const result = await answer(...args);
  report.rawAnswers ??= [];
  report.rawAnswers.push({ repair: Boolean(args[3]), output: result });
  return result;
};
const service = new MeetingMemoryService(store, provider);
const report = { label: 'REAL MODEL CHECK · SYNTHETIC DATA ONLY', timestamp: new Date().toISOString(), models: provider.models, checks: [], answers: [] };
const output = fileURLToPath(new URL('../.expo/dev/logs/meeting-memory-real-model.json', import.meta.url));
async function check(name, run) {
  try { await run(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { report.checks.push({ name, passed: false, message: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
try {
  const { meeting } = store.create({ title: 'SYNTHETIC · Cedar Lane review', date: '2026-09-08', participants: ['Mike', 'Jordan'], originalTranscript: original });
  service.start(meeting.id); await service.jobs.get(meeting.id);
  const ready = store.get(meeting.id);
  assert.equal(ready.status, 'ready', ready.error ?? 'Processing did not complete.');
  report.meeting = ready;
  await check('Organization retains explicit owner, open questions, and suggestion modality', async () => {
    const items = ready.topics.flatMap(t => t.items);
    assert.ok(items.some(item => item.kind === 'action' && item.owner === 'Mike' && /Friday/.test(item.deadline ?? '')));
    assert.ok(items.some(item => item.kind === 'open_question' && /permit/i.test(item.text)));
    const folders = ready.topics.filter(t => /folder|evidence handling/i.test(t.title));
    assert.ok(folders.length);
    for (const topic of folders) assert.doesNotMatch(topic.summary.text, /agreed to revisit|agreed to.*organization|decided to.*folder/i);
  });
  await check('Original unchanged; early and revisited property discussion share a topic', async () => {
    assert.equal(ready.originalTranscript, original);
    const early = ready.passages.find(p => p.text.includes('My rough estimate is $18,000')).id;
    const later = ready.passages.find(p => p.text.includes('correct my earlier number')).id;
    assert.ok(ready.topics.some(t => t.sourceIds.includes(early) && t.sourceIds.includes(later) && /Cedar|drainage/i.test(t.title)));
    const [vector] = await provider.embed(['42 Cedar Lane drainage estimate correction']);
    const result = retrieve([ready], id => store.chunks(id), '42 Cedar Lane drainage estimate correction', vector, validateFilters({}));
    assert.ok(result.sources.some(s => s.passageId === early)); assert.ok(result.sources.some(s => s.passageId === later));
  });
  const questions = [
    ['Corrected estimate, uncertainty, decision and no weather in property answer', 'What did Mike and Jordan discuss about 42 Cedar Lane drainage, how did the cost estimate change, and what was actually decided?', answer => {
      assert.equal(answer.status, 'answered');
      const text = answer.statements.map(s => s.text).join(' ');
      assert.match(text, /26,?500/); assert.match(text, /18,?000/);
      assert.match(text, /preliminary|tentative|not final|estimate/i); assert.match(text, /permit/i); assert.match(text, /wait|inspection/i);
      assert.doesNotMatch(text, /camping|sunny|thunderstorm|umbrella|lake|weather/i);
    }],
    ['Ambiguous speaker is not assigned a participant identity', 'Who said "This could work if the inspection is clean"?', answer => {
      assert.ok(['clarification', 'insufficient_evidence'].includes(answer.status) || /unlabeled|not labeled|not identified|cannot identify/.test(answer.statements.map(s => s.text).join(' ').toLowerCase()));
    }],
    ['Unsupported mortgage question receives insufficient evidence', 'Which bank approved the mortgage, and what interest rate did it approve?', answer => assert.equal(answer.status, 'insufficient_evidence')],
    ['Explicit action and stated deadline retained', 'What action did Mike commit to and what deadline was explicitly stated?', answer => {
      assert.equal(answer.status, 'answered'); assert.match(answer.statements.map(s => s.text).join(' '), /Friday/);
      assert.match(answer.statements.map(s => s.text).join(' '), /quote|inspector/i);
    }],
  ];
  for (const [name, question, verify] of questions) await check(name, async () => {
    const answer = await service.ask({ question, filters: { meetingIds: [ready.id], participant: 'Mike', dateFrom: '2026-09-01', dateTo: '2026-09-30' } });
    report.answers.push(answer); verify(answer);
    for (const source of answer.sources) assert.equal(original.slice(source.start, source.end), source.text);
    for (const statement of answer.statements) for (const cite of statement.citations) assert.ok(answer.sources.find(s => s.meetingId === cite.meetingId && s.passageId === cite.passageId).text.includes(cite.quote));
  });
  await check('Ready retry and database reopen preserve result and index counts', async () => {
    const before = store.chunks(ready.id).length;
    service.start(ready.id); assert.equal(service.jobs.size, 0);
    store.close(); store = new MeetingStore(dbPath);
    assert.equal(store.get(ready.id).status, 'ready'); assert.equal(store.chunks(ready.id).length, before);
    assert.equal(store.get(ready.id).originalTranscript, original); assert.equal(store.answers().length, report.answers.length);
  });
} catch (error) { report.fatal = error.message; process.exitCode = 1; }
finally {
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2));
  store.close(); rmSync(dir, { recursive: true, force: true });
  if (report.checks.some(c => !c.passed)) process.exitCode = 1;
  console.log(`Synthetic real-model report: ${output}`);
}
