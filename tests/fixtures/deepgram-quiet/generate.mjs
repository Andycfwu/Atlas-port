// Synthetic speech only; never reads or modifies a phone recording.
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const directory=fileURLToPath(new URL('.',import.meta.url));
const rows=[
 ['Samantha','The cedar house inspection is Tuesday.',1,0.5],
 ['Daniel','Yes. The repair budget is forty thousand dollars.',1,0.5],
 ['Karen','Wait. The roof estimate is uncertain.',0.07,0.5],
 ['Samantha','Okay.',1,3],
 ['Karen','Please check the drainage before we sign.',0.07,0.5],
 ['Samantha','Paint the garage blue.',0.7,0],
 ['Daniel','Keep the porch white.',0.7,0.5],
 ['Daniel','This is the final sentence before stop.',1,0],
];
let samples=0;const audio=[],reference=[];
for(const [index,[voice,text,gain,pause]]of rows.entries()){
 const file=directory+index+'.wav';
 execFileSync('/usr/bin/say',['-v',voice,'-r','160','-o',file,'--data-format=LEI16@24000',text],{stdio:'ignore',timeout:20000});
 const pcm=execFileSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i',file,'-ac','1','-ar','24000','-af','volume='+gain,'-f','s16le','pipe:1'],{timeout:10000});
 reference.push({voice,text,gain,startMs:samples/24,endMs:(samples+pcm.length/2)/24,overlap:index===5||index===6});
 if(index===6){ // Deliberate synthetic overlap with the previous voice, no normalization.
  const previous=audio.pop();samples-=previous.length/2;
  reference[index].startMs=samples/24;reference[index].endMs=(samples+pcm.length/2)/24;
  const mix=Buffer.alloc(Math.max(previous.length,pcm.length));
  for(let i=0;i<mix.length;i+=2)mix.writeInt16LE(Math.max(-32768,Math.min(32767,(i<previous.length?previous.readInt16LE(i):0)+(i<pcm.length?pcm.readInt16LE(i):0))),i);
  audio.push(mix);samples+=mix.length/2;
 }else {audio.push(pcm);samples+=pcm.length/2;}
 if(pause){const silence=Buffer.alloc(Math.round(pause*48000));audio.push(silence);samples+=silence.length/2;}
}
const output=Buffer.concat(audio);writeFileSync(directory+'conversation.pcm',output);
writeFileSync(directory+'reference.json',JSON.stringify({synthetic:true,sampleRate:24000,channels:1,encoding:'int16',referenceStatus:'TTS script; pronunciation and overlap require human listening review',durationMs:output.length/48,reference},null,2)+'\n');
execFileSync('/opt/homebrew/bin/ffmpeg',['-y','-v','error','-f','s16le','-ar','24000','-ac','1','-i',directory+'conversation.pcm',directory+'conversation.wav'],{timeout:10000});
console.log('Generated bounded synthetic fixture:',readFileSync(directory+'conversation.pcm').length,'bytes');
