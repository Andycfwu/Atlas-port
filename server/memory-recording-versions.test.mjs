import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MeetingStore } from './memory/store.mjs';
import { MeetingMemoryService } from './memory/service.mjs';
import { fixtureGrouping } from './memory/fixture-provider.mjs';
const input = text => ({ title: 'SYNTHETIC alternative sources', date: '2026-09-10', participants: ['Mike'], originalTranscript: text, transcriptSource: { kind: 'live', recordingId: 'synthetic-recording', traceId: 'live', model: 'synthetic', status: 'completed' } });
const provider = { dimensions: 2, models: { organization: 'fake', embedding: 'fake', answer: 'fake' }, group: fixtureGrouping,
  organize: async m => ({ cleanedPassages: m.passages.map(p => ({ passageId: p.id, text: p.text, smallTalk: false })), topics: [] }), embed: async texts => texts.map(() => [1,0]),
  answer: async (_q, sources) => ({ status: 'answered', scope: 'meeting', statements: [{ kind: 'discussion', text: sources[0].text, citations: [{ meetingId: sources[0].meetingId, passageId: sources[0].passageId, quote: sources[0].text }] }] }) };
const run = async (service,id) => { service.start(id); await service.jobs.get(id); return service.store.get(id); };
test('one recording uses revisions; failed replacement, alternative consultation, historical citation and restart stay exact', { timeout: 8000 }, async () => {
 const dir=mkdtempSync(join(tmpdir(),'atlas-version-check-')), file=join(dir,'memory.sqlite'); let store=new MeetingStore(file);
 try {
  let service=new MeetingMemoryService(store,provider);
  const a=store.create(input('The cedar property budget is forty thousand.')).meeting; await run(service,a.id);
  const answer=await service.ask({question:'What is the cedar property budget?'}); assert.equal(answer.status,'answered');
  const b=store.create({...input('The cedar property budget is fifty thousand.'), transcriptSource:{...input('').transcriptSource,kind:'saved_audio',traceId:'post'}}).meeting;
  assert.equal(a.id,b.id); assert.equal(store.list().length,1); assert.notEqual(b.desiredRevisionId,b.revisionId);
  const repeated=store.create({...input('The cedar property budget is fifty thousand.'), transcriptSource:{...input('').transcriptSource,kind:'saved_audio',traceId:'post'}}).meeting;
  assert.equal(repeated.desiredRevisionId,b.desiredRevisionId); assert.equal(store.versions.list(a.id).length,2);
  const failed=new MeetingMemoryService(store,{...provider,group:async()=>{throw new Error('synthetic failure');}}); await run(failed,a.id);
  assert.equal(store.get(a.id).revisionId,a.revisionId); await run(service,a.id); const primary=store.get(a.id);
  assert.equal(primary.revisionId,b.desiredRevisionId);
  const historical=await service.ask({question:'What is the cedar property budget?',filters:{meetingIds:[a.id],revisionId:a.revisionId}});
  assert.equal(historical.sources[0].revisionId,a.revisionId); assert.match(historical.sources[0].text,/forty/);
  const current=await service.ask({question:'What is the cedar property budget?'}); assert.equal(current.readyMeetingCount,1); assert.match(current.sources[0].text,/fifty/); assert.match(current.limitation,/different wording/);
  const originalCitation=answer.sources[0]; assert.equal(store.versions.source(a.id,originalCitation.revisionId,originalCitation.passageId).text,originalCitation.text);
  store.close(); store=new MeetingStore(file); service=new MeetingMemoryService(store,provider);
  assert.equal(store.versions.list(a.id).length,2); assert.equal(store.answers().length,3);
  assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
  store.versions.select(a.id,a.revisionId); await run(service,a.id); assert.equal(store.get(a.id).revisionId,a.revisionId);
  store.versions.delete(a.id); assert.equal(store.list().length,0); assert.throws(()=>store.versions.source(a.id,originalCitation.revisionId,originalCitation.passageId));
 } finally { store.close(); rmSync(dir,{recursive:true}); }
});

test('selecting a prior pasted revision uses its exact ID without inventing a recording or rebuilding its identity', () => {
 const store=new MeetingStore(':memory:');
 try {
  const {transcriptSource,...paste}=input('Original pasted uncertainty.');
  const first=store.create(paste).meeting;
  const second=store.versions.revise(first.id,{...paste,originalTranscript:'A different pasted account.'});
  assert.notEqual(second.desiredRevisionId,first.revisionId);
  assert.equal(store.versions.select(first.id,first.revisionId).desiredRevisionId,first.revisionId);
  assert.equal(store.versions.list(first.id).length,2);
  assert.equal(store.db.prepare('SELECT count(*) n FROM recordings').get().n,0);
 } finally { store.close(); }
});
test('stream speaker evidence retains exact spans without claiming file alignment or using attendee names', async () => {
 const {validateIntake}=await import('./memory/transcript.mjs');const {supportsSpeaker}=await import('./memory/provenance.mjs');
 const data=validateIntake({...input('Quiet roof estimate.'),transcriptSource:{...input('').transcriptSource,kind:'live_speakers',provider:'deepgram'},speakers:[{id:'dg-one:speaker2',label:'Speaker 3',nameConfirmation:null}],segments:[{id:'dg-one:r0:w0',start:0,end:20,speakerId:'dg-one:speaker2',attribution:'stream_diarization',audio:null,providerStream:{connectionId:'dg-one',startMs:100,endMs:400}}]});
 const source={...data,start:0,end:20,text:data.originalTranscript};
 assert.equal(supportsSpeaker(source,'roof estimate.','Speaker 3','dg-one:r0:w0'),true);
 assert.equal(supportsSpeaker(source,'roof estimate.','Mike','dg-one:r0:w0'),false);
 assert.equal(data.segments[0].audio,null);
 const store=new MeetingStore(':memory:');try{const m=store.create(data).meeting;assert.deepEqual(store.versions.revision(m.id,m.revisionId).segments,data.segments);}finally{store.close();}
});
