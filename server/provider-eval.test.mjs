import test from 'node:test';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { connectionConfig, LIMITS } from './provider-eval/config.mjs';
import { EventJournal, decode } from './provider-eval/events.mjs';
import { reserveAttempt, referenceIssues, sha256 } from './provider-eval/reference.mjs';
import { globalSpeakerMapping, scoreRun } from './provider-eval/score.mjs';
import { replay } from './provider-eval/replay.mjs';

const pcm = Buffer.alloc(4800);
const ref = { schemaVersion: 1, syntheticOnly: true, humanRecorded: true, approvedProviders: ['deepgram'], manuallyReviewed: true,
  reviewedBy: 'deterministic-test-double', reviewedAt: '2026-09-10T00:00:00Z', pcmSha256: sha256(pcm),
  turns: [{ id:'one', speaker:'R1', startMs:0, endMs:50, text:'hello', ambiguous:false, tags:['normal'] },
    { id:'two', speaker:'R2', startMs:50, endMs:100, text:'yes', ambiguous:false, tags:['quiet'] }] };
const aaiTurn = (speaker = 'A') => ({ type:'Turn', turn_order:0, end_of_turn:true, turn_is_formatted:true, transcript:'Hello.', speaker_label:speaker,
  words:[{text:'Hello.',start:0,end:50,speaker,word_is_final:true}] });
test('evaluation configurations use real streaming endpoints and documented labels without provider keys in URLs', () => {
  for (const provider of ['deepgram','assemblyai','speechmatics']) {
    const config = connectionConfig(provider,'SYNTHETIC-KEY');
    assert.equal(new URL(config.url).protocol,'wss:'); assert.equal(config.url.includes('SYNTHETIC'),false);
  }
  const aai = new URL(connectionConfig('assemblyai','fake').url);
  assert.equal(aai.searchParams.get('speech_model'),'universal-3-5-pro'); assert.equal(aai.searchParams.get('speaker_labels'),'true');
  assert.equal(aai.searchParams.has('voice_focus'),false); assert.equal(aai.searchParams.has('max_speakers'),false);
  const sm = connectionConfig('speechmatics','fake'); assert.equal(sm.start.transcription_config.model,'enhanced');
  assert.deepEqual(sm.finish(2),{message:'EndOfStream',last_seq_no:2});
  assert.throws(()=>connectionConfig('assemblyai',''),/MISSING_CREDENTIAL/);
});
test('unapproved/unreviewed/changed audio is blocked; quotas survive attempts and budget/recording bounds apply', () => {
  assert.deepEqual(referenceIssues(ref,pcm,'deepgram'),[]);
  for (const changed of [{...ref,manuallyReviewed:false},{...ref,approvedProviders:[]},{...ref,humanRecorded:false},{...ref,pcmSha256:'changed'}]) assert.ok(referenceIssues(changed,pcm,'deepgram').length);
  const badOverlap = structuredClone(ref); badOverlap.turns[1].startMs=20;
  assert.ok(referenceIssues(badOverlap,pcm,'deepgram').some(v=>v.includes('Overlapping')));
  let ledger={attempts:[]}; ledger=reserveAttempt(ledger,'deepgram','audio1'); ledger=reserveAttempt(ledger,'deepgram','audio1');
  assert.throws(()=>reserveAttempt(JSON.parse(JSON.stringify(ledger)),'deepgram','audio1'),/ATTEMPT_LIMIT/);
  ledger=reserveAttempt(ledger,'assemblyai','audio2'); assert.throws(()=>reserveAttempt(ledger,'speechmatics','audio3'),/RECORDING_LIMIT/);
  assert.throws(()=>reserveAttempt({attempts:[{provider:'deepgram',audioHash:'a',reservedUsd:.15}]},'assemblyai','a'),/BUDGET_LIMIT/);
});
test('native unknown IDs and partial/final status survive; invalid provisional timing does not discard text', () => {
  assert.equal(decode('speechmatics',{message:'Error',type:'not_authorised',reason:'synthetic'}).error,'PROVIDER_ERROR_not_authorised');
  const aai=decode('assemblyai',{...aaiTurn('PENDING'),end_of_turn:false,turn_is_formatted:false});
  assert.equal(aai.record.words[0].providerSpeaker,'PENDING'); assert.equal(aai.record.isFinal,false);
  const dg=decode('deepgram',{type:'Results',start:0,duration:.05,is_final:false,channel:{alternatives:[{transcript:'Quiet complete wording',words:[{word:'quiet',start:.1,end:.01,speaker:0}]}]}});
  assert.equal(dg.record.text,'Quiet complete wording'); assert.equal(dg.record.words[0].timingValid,false); assert.equal(dg.record.words[0].providerSpeaker,0);
  assert.throws(()=>decode('assemblyai',{type:'Begin',configuration:{model:'unknown'}}),/RESOLVED_MODEL/);
});
test('speaker revisions are separate from live finals and may only change IDs on exact original words/times', () => {
  const journal = new EventJournal('assemblyai',100); journal.accept(aaiTurn(),10); journal.markStop(15);
  journal.accept({type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'B',words:[{text:'Hello.',start:0,end:50,speaker:'B'}]}]},20);
  let output=journal.snapshot(); assert.equal(output.finalRecords[0].words[0].providerSpeaker,'A'); assert.equal(output.revisedRecords[0].words[0].providerSpeaker,'B');
  journal.accept({type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'C',words:[{text:'Rewritten',start:0,end:50,speaker:'C'}]}]},21);
  output=journal.snapshot(); assert.equal(output.revisionIssues.length,1); assert.equal(output.revisedRecords[0].text,'Hello.');
  assert.equal(output.rawEvents.length,3); assert.deepEqual(JSON.parse(JSON.stringify(output)),output);
});
test('one global speaker mapping exposes merge/split/swaps and remains frozen across end-of-stream revisions', () => {
  const turns=[...ref.turns,{id:'return',speaker:'R1',startMs:100,endMs:150,text:'return',ambiguous:false,tags:['returning']}];
  const words=[{text:'hello',kind:'word',startMs:0,endMs:40,timingValid:true,providerSpeaker:'A'},
    {text:'yes',kind:'word',startMs:60,endMs:90,timingValid:true,providerSpeaker:'A'},
    {text:'return',kind:'word',startMs:110,endMs:140,timingValid:true,providerSpeaker:'B'}];
  const mapping=globalSpeakerMapping(words,turns); assert.deepEqual(mapping.possibleMerges,['A']); assert.deepEqual(mapping.possibleSplits,['R1']);
  const result=scoreRun({finalRecords:[{words}],revisedRecords:[{words:words.map(w=>({...w,providerSpeaker:'A'}))}],stop:{}},{...ref,turns});
  assert.equal(result.liveFinals.some(t=>t.mappedSpeakerMismatchWords>0),true);
  assert.equal(result.liveFinals.every(t=>t.wordErrorRate===null),true,'Approximate turns must not claim WER or DER');
  assert.deepEqual(result.mapping,mapping.mapping);
});

test('real-time replay uses identical PCM, explicit EOS, late final events and provider revision before termination', {timeout:3000}, async () => {
  for (const provider of ['deepgram','assemblyai','speechmatics']) {
    let socket; const sent=[];
    class Fake extends EventEmitter {
      readyState=1; bufferedAmount=0;
      constructor(){super();setTimeout(()=>{this.emit('open');if(provider==='assemblyai')this.event({type:'Begin',configuration:{model:'universal-3-5-pro'}});},0);}
      event(e){this.emit('message',Buffer.from(JSON.stringify(e)),false);}
      send(data,options,callback){
        if(options?.binary){sent.push(Buffer.from(data));callback?.();return;}
        const message=JSON.parse(data);
        if(message.message==='StartRecognition'){this.event({message:'RecognitionStarted',id:'synthetic'});return;}
        sent.push(message);
        if(provider==='assemblyai'){
          this.event(aaiTurn());this.event({type:'SpeakerRevision',revisions:[{turn_order:0,speaker_label:'B',words:[{text:'Hello.',start:0,end:50,speaker:'B'}]}]});
          this.event({type:'Termination',audio_duration_seconds:.1,session_duration_seconds:.2});
        }else if(provider==='speechmatics'){
          this.event({message:'AddTranscript',metadata:{start_time:0,end_time:.1,transcript:'Hello.'},results:[{type:'word',start_time:0,end_time:.05,alternatives:[{content:'Hello.',speaker:'S1'}]}]});
          this.event({message:'EndOfTranscript'});
        }else{
          this.event({type:'Results',start:0,duration:.1,is_final:true,channel:{alternatives:[{transcript:'Hello.',words:[{word:'Hello.',start:0,end:.05,speaker:0}]}]}});
          this.event({type:'Metadata',duration:.1});this.emit('close',1000);
        }
      }
      terminate(){this.readyState=3;}
    }
    const result=await replay({provider,key:'SYNTHETIC-KEY',pcm,createSocket:()=>socket=new Fake(),limits:{...LIMITS,sessionMs:1500,readyMs:200,finishMs:200}});
    assert.equal(result.failure,null); assert.equal(result.finalRecords.length,1); assert.equal(result.stop.finalEventsAfterStop,1);
    assert.deepEqual(Buffer.concat(sent.filter(Buffer.isBuffer)),pcm); assert.equal(result.audioBytesSent,pcm.length);
    assert.equal(socket.readyState,3); assert.equal(JSON.stringify(result).includes('SYNTHETIC-KEY'),false);
    if(provider==='assemblyai')assert.equal(result.revisedRecords[0].words[0].providerSpeaker,'B');
    if(provider==='speechmatics')assert.deepEqual(sent.at(-1),{message:'EndOfStream',last_seq_no:2});
  }
});
test('readiness failures have deadlines, zero audio, one connection and no retry', {timeout:1000}, async () => {
  let calls=0,audio=0;class NeverReady extends EventEmitter {readyState=1;bufferedAmount=0;send(_d,o){if(o?.binary)audio++;}terminate(){this.readyState=3;}}
  const result=await replay({provider:'assemblyai',key:'fake',pcm,createSocket:()=>{calls++;return new NeverReady();},limits:{...LIMITS,readyMs:20,sessionMs:100,finishMs:20}});
  assert.equal(result.failure,'READY_DEADLINE'); assert.equal(calls,1); assert.equal(audio,0);
});
