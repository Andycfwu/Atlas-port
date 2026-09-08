// Real-model checks using fictional, messy text ONLY. No phone recording is read.
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { createMemoryProvider } from './memory/provider.mjs';
import { retrieve, validateFilters } from './memory/retrieval.mjs';

if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('Configure OPENAI_API_KEY in server/.env before the real-model checks.');
const dir = mkdtempSync(join(tmpdir(), 'atlas-memory-messy-real-')), db = join(dir, 'memory.sqlite');
let store = new MeetingStore(db);
const provider = createMemoryProvider(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 }));
const report = { label: 'REAL MODEL CHECK · MESSY SYNTHETIC TRANSCRIPTS ONLY', timestamp: new Date().toISOString(), models: provider.models, fixtures: [], checks: [], answers: [], rawAnswers: [] };
const originalAnswer = provider.answer;
provider.answer = async (...args) => {
  const output = await originalAnswer(...args);
  report.rawAnswers.push({ question: args[0], repair: Boolean(args[3]), output }); return output;
};
const service = new MeetingMemoryService(store, provider);
const output = fileURLToPath(new URL('../.expo/dev/logs/meeting-memory-messy-real-model.json', import.meta.url));
const configurations = [
  { name: 'messy-unlabeled', topic: '42 Cedar Lane drainage', early: '$18,000', corrected: '$26,500', uncertainty: /easement|east mint/i,
    question: 'What did Mike and I discuss about 42 Cedar Lane drainage, the estimate change, and whether any work was approved?',
    unclear: 'What did the transcript establish about an easement and the inspection condition?', action: 'email|request', deadline: 'Friday',
  },
  { name: 'messy-flat', topic: 'Harbor Court B-17 cabinets', early: '$15,000', corrected: '$17,800', uncertainty: /soft clothes|soft close|walnut|wall nut/i,
    question: 'What did Mike and I discuss about the Harbor Court B-17 cabinet allowance, its correction, and order approval?',
    unclear: 'Which exact hinge type and wood finish were confirmed for the B-17 cabinets?', action: 'send|sheet', deadline: null,
  },
];
async function check(name, run) {
  try { await run(); report.checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (e) { report.checks.push({ name, passed: false, message: e.message }); console.log(`FAIL ${name}: ${e.message}`); }
}
const textOf = answer => answer.statements.map(s => s.text).join(' ');
function assertSources(answer, originals) {
  for (const source of answer.sources) assert.equal(originals.get(source.meetingId).slice(source.start, source.end), source.text);
  for (const statement of answer.statements) for (const c of statement.citations) {
    const s = answer.sources.find(p => p.meetingId === c.meetingId && p.passageId === c.passageId);
    assert.ok(s?.text.includes(c.quote));
    assert.equal(c.speaker, null, 'No speaker may be attributed in these unlabeled fixtures.');
    assert.equal(c.segmentId, null);
  }
  assert.doesNotMatch(textOf(answer), /\b(?:Mike|Jordan) (?:said|stated|thought|agreed|promised|committed|estimated|corrected|offered|will)\b/i);
}
try {
  const originals = new Map();
  for (const config of configurations) {
    const original = readFileSync(new URL(`../tests/fixtures/meeting-memory-${config.name}.txt`, import.meta.url), 'utf8');
    const input = { title: `SYNTHETIC · ${config.name}`, date: '2026-09-08', participants: ['Mike', 'Jordan'], originalTranscript: original };
    const { meeting } = store.create(input); originals.set(meeting.id, original);
    service.start(meeting.id); await service.jobs.get(meeting.id);
    const ready = store.get(meeting.id);
    report.fixtures.push({ name: config.name, meeting: ready });
    await check(`${config.name}: real processing and topics without invented identity/timing`, async () => {
      assert.equal(ready.status, 'ready', ready.error ?? 'Processing incomplete'); assert.ok(ready.topics.length);
      assert.equal(ready.originalTranscript, original); assert.deepEqual(ready.speakers, []); assert.deepEqual(ready.segments, []);
      for (const p of ready.cleanedPassages) assert.doesNotMatch(p.text, /(?:^|\n)\s*(?:\[\d{1,2}:\d{2}|Mike:|Jordan:|Speaker \d+:)/);
      const actions = ready.topics.flatMap(t => t.items).filter(i => i.kind === 'action');
      assert.ok(ready.topics.flatMap(t => t.items).every(i => i.kind !== 'decision'), 'These fixtures contain no explicit concluded decisions; no-approval status and identifier corrections are discussion.');
      assert.ok(actions.some(a => new RegExp(config.action, 'i').test(a.text)), 'Explicit unlabeled action should be retained.');
      assert.ok(actions.every(a => a.owner === null), 'Unknown voices must not become named action owners.');
      if (config.deadline) assert.ok(actions.some(a => a.deadline?.includes(config.deadline)));
      else assert.ok(actions.every(a => a.deadline === null));
      assert.match(ready.cleanedPassages.map(p => p.text).join(' '), config.uncertainty);
    });
    if (ready.status !== 'ready') continue;
    await check(`${config.name}: recurrent discussion and correction retrieved together`, async () => {
      const early = ready.passages.find(p => p.text.includes(config.early)).id;
      const later = ready.passages.find(p => p.text.includes(config.corrected)).id;
      assert.notEqual(early, later, 'Test must exercise separated passages.');
      assert.ok(ready.topics.some(t => t.sourceIds.includes(early) && t.sourceIds.includes(later)));
      const [vector] = await provider.embed([config.topic]);
      const sources = retrieve([ready], id => store.chunks(id), config.topic, vector, validateFilters({})).sources;
      assert.ok(sources.some(s => s.passageId === early)); assert.ok(sources.some(s => s.passageId === later));
    });
    const questions = [
      ['meeting-level answer remains useful, corrected and impersonal', config.question, answer => {
        assert.equal(answer.status, 'answered'); assert.equal(answer.scope, 'meeting'); assert.equal(answer.requestedSpeaker, null);
        const text = textOf(answer);
        assert.ok(answer.statements.every(s => s.kind !== 'decision'), 'Absence of approval is not a concluded decision.');
        for (const cost of [config.early, config.corrected]) assert.ok(text.replaceAll(',', '').includes(cost.replaceAll(',', '').slice(1)), `Missing estimate ${cost}`);
        assert.match(text, /preliminary|tentative|rough|not final/i);
        assert.match(text, /not approved|no.*approv|not.*order|no.*order|not.*authoriz|unapproved/i);
        assert.doesNotMatch(text, /\b(weather|coffee|umbrella|forecast|dog|weekend game|hike|rain|lake)\b/i);
      }],
      ['speaker-specific question explicitly lacks attribution', `What did Mike say about ${config.topic}?`, answer => {
        assert.ok(['insufficient_evidence', 'clarification'].includes(answer.status)); assert.equal(answer.statements.length, 0);
        assert.equal(answer.scope, 'speaker'); assert.match(answer.limitation, /Insufficient speaker attribution/);
      }],
      ['unresolved transcription errors/conditions stay unresolved', config.unclear, answer => {
        const text = [textOf(answer), answer.clarification, answer.limitation].filter(Boolean).join(' ');
        assert.ok(answer.status !== 'answered' || /unclear|unresolved|not confirm|not establish|not decid|undecided|cannot|uncertain|unverified|not.*resolv|no.*confirm/i.test(text), text);
      }],
      ['unlabeled action retained without owner/deadline invention', 'What explicit follow-up action was committed to, by whom, and by when?', answer => {
        assert.equal(answer.status, 'answered'); assert.match(textOf(answer), new RegExp(config.action, 'i'));
        assert.match([textOf(answer), answer.limitation].join(' '), /unlabeled|unknown|not (?:named|identified|stated|specified)|does not identify|cannot.*identif/i);
        if (config.deadline) assert.match(textOf(answer), /Friday/);
        else assert.match(textOf(answer), /\bno\b[^.]*\bdeadline\b|deadline.*(?:not|unstated|unspecified)|not.*deadline/i);
      }],
      ['unsupported bank/rate receives insufficient evidence', 'Which mortgage bank approved financing and at what interest rate?', answer => assert.equal(answer.status, 'insufficient_evidence')],
    ];
    for (const [name, question, verify] of questions) await check(`${config.name}: ${name}`, async () => {
      const answer = await service.ask({ question, filters: { meetingIds: [meeting.id], participant: 'Mike' } });
      report.answers.push({ fixture: config.name, ...answer }); assertSources(answer, originals); verify(answer);
    });
    await check(`${config.name}: retry keeps one meeting and consistent index`, async () => {
      assert.equal(store.create(input).meeting.id, meeting.id); const count = store.chunks(meeting.id).length;
      service.start(meeting.id); assert.equal(service.jobs.size, 0); assert.equal(store.chunks(meeting.id).length, count);
    });
  }
  await check('messy corpus: cross-meeting answers retain separate cited meetings', async () => {
    const answer = await service.ask({ question: 'Compare the corrected preliminary Cedar Lane drainage estimate with the Harbor Court B-17 cabinet allowance. Was either approved?', filters: { participant: 'Mike' } });
    report.answers.push({ fixture: 'cross-meeting', ...answer }); assertSources(answer, originals);
    assert.equal(answer.status, 'answered'); assert.match(textOf(answer), /26,?500/); assert.match(textOf(answer), /17,?800/);
    assert.equal(new Set(answer.sources.map(s => s.meetingId)).size, 2);
  });
  await check('messy corpus: restart preserves originals, provenance and completed answers', async () => {
    const before = store.list().map(m => ({ id: m.id, count: store.chunks(m.id).length, original: m.originalTranscript }));
    store.close(); store = new MeetingStore(db);
    for (const m of before) {
      assert.equal(store.get(m.id).status, 'ready'); assert.equal(store.get(m.id).originalTranscript, m.original);
      assert.deepEqual(store.get(m.id).speakers, []); assert.deepEqual(store.get(m.id).segments, []);
      assert.equal(store.chunks(m.id).length, m.count);
    }
    assert.equal(store.answers().length, report.answers.length);
  });
} catch (e) { report.fatal = e.message; process.exitCode = 1; }
finally {
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2));
  store.close(); rmSync(dir, { recursive: true, force: true });
  if (report.checks.some(c => !c.passed)) process.exitCode = 1;
  console.log(`Synthetic messy-model report: ${output}`);
}
