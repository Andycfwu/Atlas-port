// Explicit, bounded paid evaluation of the checked-in SYNTHETIC fixture only.
// Never opens the app database or reads existing recordings.
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import WebSocket, { WebSocketServer } from 'ws';
import { attachDeepgramSession as improved } from './deepgram/session.mjs';
const require = createRequire(import.meta.url), { load } = require('../tests/load-typescript.cjs');
const baselineRoot = process.argv[2];
if (!baselineRoot || !process.env.DEEPGRAM_API_KEY?.trim()) throw new Error('Supply a baseline checkout and backend Deepgram configuration.');
const { attachDeepgramSession: baseline } = await import(baselineRoot + '/server/deepgram/session.mjs');
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/deepgram-quiet/reference.json', import.meta.url)));
const pcm = readFileSync(new URL('../tests/fixtures/deepgram-quiet/conversation.pcm', import.meta.url));
if (fixture.synthetic !== true || pcm.length > 2_880_000 || fixture.sampleRate !== 24000) throw new Error('Synthetic fixture bound failed.');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const rows = [];
for (const [name, attach, root, endpointing] of [['baseline', baseline, baselineRoot, 300], ['improved', improved, null, 300], ['endpointing-500-comparison', improved, null, 500]].filter(row => !process.argv.includes('--improved-only') || row[0] === 'improved')) {
 const http = createServer(), wss = new WebSocketServer({ server: http }); let upstreamCalls=0; const providerEvents=[];
 wss.on('connection', socket => attach(socket,{ enabled:true,apiKey:process.env.DEEPGRAM_API_KEY, createUpstreamSocket:(url,options)=>{ upstreamCalls++; if(upstreamCalls!==1)throw new Error('Provider call bound');const actual=new URL(url);actual.searchParams.set('endpointing',String(endpointing));const socket=new WebSocket(actual,options); socket.on('message',data=>{try{providerEvents.push(JSON.parse(data.toString()));}catch{}}); return socket; } }));
 http.listen(0,'127.0.0.1');await once(http,'listening');
 const model=load((root?root+'/':'')+'src/features/recorder/live-speakers/live-speakers.model.ts');
 const {LiveTranscriptionConnection}=load((root?root+'/':'')+'src/features/recorder/live/live-transcription.service.ts',{'../live-speakers/live-speakers.model':model},{WebSocket});
 let snapshot, readyResolve, doneResolve;const ready=new Promise(resolve=>{readyResolve=resolve;}),done=new Promise(resolve=>{doneResolve=resolve;});const started=Date.now();let firstTextMs=null, failure=null;
 const connection=new LiveTranscriptionConnection(`ws://127.0.0.1:${http.address().port}`,{actualSampleRate:24000,requestedSampleRate:24000,channels:1,encoding:'int16',traceId:'atlas-synthetic-'+name},{onReady:()=>readyResolve(),onDraft(){},onSpeakers:s=>{snapshot=s;if(firstTextMs===null&&[...s.finalResults,...s.provisionalResults].some(r=>r.text))firstTextMs=Date.now()-started;},onFailure:e=>{failure=e.message.match(/DEEPGRAM_[A-Z_]+/)?.[0] ?? e.code;readyResolve();doneResolve();},onCompleted:()=>doneResolve()});
 const deadline=setTimeout(()=>{failure='EVALUATION_DEADLINE';connection.close('deadline');readyResolve();doneResolve();},75000);
 try {
  connection.connect();await ready;
  const feedStart=Date.now();
  for(let offset=0;offset<pcm.length&&!failure;offset+=4800){const part=pcm.subarray(offset,Math.min(offset+4800,pcm.length));connection.sendAudio({data:part.buffer.slice(part.byteOffset,part.byteOffset+part.length),sampleRate:24000,channels:1,timestamp:offset/48000});await delay(Math.max(0,feedStart+(offset+part.length)/48-Date.now()));}
  if(!failure)connection.complete();await done;
  const finals=snapshot?.finalResults??[],words=finals.flatMap(r=>r.words),text=finals.map(r=>r.text).join(' ');
  const expected=['cedar','inspection','tuesday','forty','thousand','roof','estimate','uncertain','drainage','sign','final','sentence','stop'];
  const recognized=new Set(text.toLowerCase().match(/[a-z]+/g)??[]);
  const report={name,endpointing,upstreamCalls,durationMs:fixture.durationMs,failure,firstTextMs,finalResults:finals.length,uniqueFinalIds:new Set(finals.map(r=>r.id)).size,provisionalResults:snapshot?.provisionalResults.length??0,missingScriptKeywords:expected.filter(w=>!recognized.has(w)),speakerNumbers:[...new Set(words.map(w=>w.providerSpeaker))],referenceStatus:fixture.referenceStatus,providerEvents,snapshot};
  rows.push(report);console.log(JSON.stringify({...report,snapshot:undefined,providerEvents:undefined}));
 } finally {clearTimeout(deadline);connection.close('evaluation_finished');for(const client of wss.clients)client.terminate();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>http.close(resolve));}
 // Abort comparison if credentials/configuration are rejected; no blind paid retries.
 if(failure === 'DEEPGRAM_CONNECTION' || failure === 'DEEPGRAM_UNAVAILABLE')break;
}
writeFileSync(new URL('../tests/fixtures/deepgram-quiet/' + (process.argv.includes('--improved-only') ? 'evaluation-after-timing-fix.json' : 'evaluation.json'),import.meta.url),JSON.stringify({performedAt:new Date().toISOString(),rows},null,2)+'\n');
