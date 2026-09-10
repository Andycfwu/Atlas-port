import { canonical, decode, encode, has, hash, issue, put, transaction } from './codec.mjs';
const USER='single-user-development';
const evidenceFields=['speakers','segments','transcriptSource'];
const artifactFields=['passages','topics','sourceTopics','omissions','cleanedPassages','models'];
const selectFields=(o,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(o,k)).map(k=>[k,o[k]]));
const maps={
 meeting:{id:'id',fingerprint:'fingerprint',sourceKey:'source_key',title:'title',date:'meeting_date',status:'status',stage:'stage',error:'error',attempts:'attempts',createdAt:'created_at',updatedAt:'updated_at',revisionId:'revision_id',desiredRevisionId:'desired_revision_id',publishedGenerationId:'published_generation_id',jobId:'job_id',pipelineSchema:'pipeline_schema'},
 revision:{id:'id',meetingId:'meeting_id',title:'title',date:'meeting_date',originalTranscript:'original_text',contentHash:'content_hash',createdAt:'created_at'},
 speaker:{id:'id',label:'label',providerLabel:'provider_label','nameConfirmation.name':'confirmed_name','nameConfirmation.confirmedAt':'confirmed_at'},
 segment:{id:'id',start:'start_offset',end:'end_offset',speakerId:'speaker_id',attribution:'attribution',attributionStatus:'attribution_status',text:'segment_text',providerSegmentId:'provider_segment_id',providerSpeaker:'provider_speaker',providerOverlap:'provider_overlap:bool','audio.recordingId':'audio_recording_id','audio.startMs':'audio_start_ms','audio.endMs':'audio_end_ms','audio.timingSource':'timing_source'},
 provenance:{kind:'kind',recordingId:'recording_id',traceId:'trace_id',model:'model',status:'status',diarizationId:'diarization_id',namesKey:'names_key'},
 unit:{id:'id',start:'start_offset',end:'end_offset',text:'original_text'},
 artifact:{'models.organization':'organization_model','models.embedding':'embedding_model','models.answer':'answer_model'},
 topic:{id:'id',title:'title','summary.text':'summary_text',derived:'derived:bool'},
 item:{kind:'kind',text:'item_text',owner:'owner',deadline:'deadline'},
 generation:{id:'id',meetingId:'meeting_id',revisionId:'revision_id',status:'status',legacy:'legacy:bool',createdAt:'created_at'},
 chunk:{id:'id',generationId:'generation_id',revisionId:'revision_id',topicId:'topic_id',part:'part',title:'title',text:'body',inputHash:'input_hash'},
 job:{id:'id',meetingId:'meeting_id',revisionId:'revision_id',generationId:'generation_id',runId:'run_id',leaseUntil:'lease_until',status:'status',stage:'stage',attempts:'attempts',error:'error',updatedAt:'updated_at','checkpoint.window':'window_index'},
 diarization:{id:'id',recordingId:'recording_id',status:'status',error:'error',attempts:'attempts',createdAt:'created_at'},
 diarized:{id:'id',recordingId:'recording_id',provider:'provider',model:'model',providerRequestId:'provider_request_id',audioSha256:'audio_sha256',audioByteSize:'audio_byte_size',durationMillis:'duration_ms',savedAudioDurationMillis:'saved_audio_duration_ms',originalTranscript:'original_text',providerText:'provider_text',createdAt:'created_at'},
 answer:{id:'id',question:'question',status:'status',scope:'scope',requestedSpeaker:'requested_speaker',clarification:'clarification',limitation:'limitation',readyMeetingCount:'ready_meeting_count',retrievalTruncated:'retrieval_truncated:bool',model:'model',createdAt:'created_at','filters.participant':'filter_participant','filters.dateFrom':'filter_date_from','filters.dateTo':'filter_date_to'},
 answerSource:{meetingId:'referenced_meeting_id',revisionId:'referenced_revision_id',generationId:'referenced_generation_id',passageId:'passage_id',meetingTitle:'meeting_title',date:'meeting_date',start:'start_offset',end:'end_offset',text:'original_text',startsAtLineBoundary:'starts_at_line_boundary:bool'},
 citation:{meetingId:'referenced_meeting_id',revisionId:'referenced_revision_id',generationId:'referenced_generation_id',passageId:'passage_id',quote:'quote',speaker:'speaker',segmentId:'segment_id'},
 config:{processor:'processor',prompt:'prompt',notesPrompt:'notes_prompt',splitter:'splitter',groupingModel:'grouping_model',notesModel:'notes_model',reasoning:'reasoning','embedding.model':'embedding_model','embedding.dimensions':'embedding_dimensions','embedding.version':'embedding_version','embedding.normalization':'normalization'},
};
export class RelationalMemory {
 constructor(db){this.db=db;}
 rows(table,where='',args=[]){return this.db.prepare(`SELECT * FROM ${table}${where?' WHERE '+where:''} ORDER BY rowid`).all(...args);}
 row(table,id){return this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);}
 immutable(table,id,dto,read,write){const old=this.row(table,id);if(old){if(canonical(read())!==canonical(dto))issue(table,id,'immutable content mismatch');return id;}write();return id;}
 recording(id){if(id!=null)this.db.prepare('INSERT OR IGNORE INTO recordings(id) VALUES (?)').run(id);}
 config(dto){if(dto==null)return null;const id=hash(dto),direct=Object.hasOwn(dto,'model')||Object.hasOwn(dto,'dimensions');const map=direct?{model:'embedding_model',dimensions:'embedding_dimensions',version:'embedding_version',normalization:'normalization'}:maps.config;if(!this.row('configurations',id))put(this.db,'configurations',{...encode(dto,map),id,config_scope:direct?'embedding':'processing'});return id;}
 readConfig(id){if(!id)return null;const row=this.row('configurations',id);return decode(row,row.config_scope==='embedding'?{model:'embedding_model',dimensions:'embedding_dimensions',version:'embedding_version',normalization:'normalization'}:maps.config);}
 evidence(dto,meetingId=null){
  const value=selectFields(dto,evidenceFields),id=hash([meetingId,value]); if(this.row('evidence_sets',id))return id;
  put(this.db,'evidence_sets',{id,meeting_id:meetingId,metadata_json:JSON.stringify(Object.fromEntries(Object.entries(value).map(([k,v])=>[k,v===null?null:true])))});
  for(const [ordinal,s]of(value.speakers??[]).entries())put(this.db,'speakers',{...encode(s,maps.speaker),evidence_id:id,ordinal},['evidence_id','id']);
  for(const [ordinal,s]of(value.segments??[]).entries()){
   if(!Number.isInteger(s.start)||!Number.isInteger(s.end)||s.end<=s.start||s.start<0)issue('transcript_segments',s.id,'invalid original offsets');
   this.recording(s.audio?.recordingId);put(this.db,'transcript_segments',{...encode(s,maps.segment),evidence_id:id,ordinal},['evidence_id','id']);
  }
  if(value.transcriptSource){this.recording(value.transcriptSource.recordingId);put(this.db,'transcript_provenance',{...encode(value.transcriptSource,maps.provenance),evidence_id:id},['evidence_id']);}
  return id;
 }
 readEvidence(id){
  const row=this.row('evidence_sets',id);if(!row)return {};const d=JSON.parse(row.metadata_json);
  if(has(d,'speakers'))d.speakers=this.rows('speakers','evidence_id=?',[id]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>decode(r,maps.speaker));
  if(has(d,'segments'))d.segments=this.rows('transcript_segments','evidence_id=?',[id]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>decode(r,maps.segment));
  if(has(d,'transcriptSource'))d.transcriptSource=decode(this.db.prepare('SELECT * FROM transcript_provenance WHERE evidence_id=?').get(id),maps.provenance);
  return d;
 }
 participants(table,ownerKey,id,names){this.db.prepare(`DELETE FROM ${table} WHERE ${ownerKey}=?`).run(id);for(const [i,name]of(names??[]).entries())this.db.prepare(`INSERT INTO ${table}(${ownerKey},ordinal,name) VALUES (?,?,?)`).run(id,i,name);}
 readParticipants(table,key,id){return this.rows(table,`${key}=?`,[id]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>r.name);}
 putRevision(dto,internal=false){
  return this.immutable('memory_revisions',dto.id,dto,()=>this.revision(dto.id),()=>{
   if(typeof dto.originalTranscript!=='string')issue('memory_revisions',dto.id,'original text is missing');
   const evidenceId=this.evidence(dto,dto.meetingId);
   for(const s of(dto.segments??[]))if(s.end>dto.originalTranscript.length||(s.text!==undefined&&s.text!==dto.originalTranscript.slice(s.start,s.end)))issue('memory_revisions',dto.id,'segment text or bounds disagree with original');
   put(this.db,'memory_revisions',{...encode(dto,maps.revision,['participants','units','legacyPassages',...evidenceFields]),evidence_id:evidenceId,internal_snapshot:Number(internal)});
   this.participants('revision_participants','revision_id',dto.id,dto.participants);
   for(const [kind,field]of[['unit','units'],['legacy','legacyPassages']]){
    const ids=new Set();for(const [ordinal,p]of(dto[field]??[]).entries()){
     if(ids.has(p.id))issue('memory_revisions',dto.id,'duplicate source ID');ids.add(p.id);
     if(!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.end<=p.start||p.end>dto.originalTranscript.length||p.text!==dto.originalTranscript.slice(p.start,p.end))issue('source_units',`${dto.id}/${p.id}`,'source offsets/text do not match original');
     put(this.db,'source_units',{...encode(p,maps.unit),unit_key:hash([dto.id,kind,p.id]),revision_id:dto.id,kind,ordinal},['unit_key']);
    }
   }
  });
 }
 revision(id){const row=this.row('memory_revisions',id),d=decode(row,maps.revision);if(!d)return null;
  if(has(d,'participants'))d.participants=this.readParticipants('revision_participants','revision_id',id);
  for(const [kind,field]of[['unit','units'],['legacy','legacyPassages']])if(has(d,field))d[field]=this.rows('source_units','revision_id=? AND kind=?',[id,kind]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>decode(r,maps.unit));
  return Object.assign(d,this.readEvidence(row.evidence_id));
 }
 unitKey(revisionId,sourceId,passage){
  const rows=this.rows('source_units','revision_id=? AND id=?',[revisionId,sourceId]).filter(r=>!passage||(r.start_offset===passage.start&&r.end_offset===passage.end&&r.original_text===passage.text));
  if(!rows.length)issue('source_units',`${revisionId}/${sourceId}`,'source reference cannot resolve exactly');
  if(rows.some(r=>r.original_text!==rows[0].original_text||r.start_offset!==rows[0].start_offset||r.end_offset!==rows[0].end_offset))issue('source_units',`${revisionId}/${sourceId}`,'ambiguous original source');
  return rows[0].unit_key;
 }
 unit(key){return decode(this.db.prepare('SELECT * FROM source_units WHERE unit_key=?').get(key),maps.unit);}
 artifact(dto,meetingId,revisionId){
  const id=hash([meetingId,revisionId,dto]);if(this.row('artifacts',id))return id;
  put(this.db,'artifacts',{...encode(dto,maps.artifact,['passages','topics','sourceTopics','groups','cleanedPassages','omissions']),id,meeting_id:meetingId,revision_id:revisionId});
  for(const [ordinal,p]of(dto.passages??[]).entries())put(this.db,'artifact_passages',{artifact_id:id,ordinal,unit_key:this.unitKey(revisionId,p.id,p)},['artifact_id','ordinal']);
  for(const [field,kind]of[['topics','derived'],['sourceTopics','source'],['groups','source']])for(const [ordinal,t]of(dto[field]??[]).entries()){
   put(this.db,'topics',{...encode(t,maps.topic,['sourceIds','summary.sourceIds','items']),artifact_id:id,kind,ordinal},['artifact_id','kind','id']);
   for(const [role,refs]of[['members',t.sourceIds],['summary',t.summary?.sourceIds]])for(const [i,ref]of(refs??[]).entries())put(this.db,'topic_sources',{artifact_id:id,topic_kind:kind,topic_id:t.id,role,ordinal:i,unit_key:this.unitKey(revisionId,ref)},['artifact_id','topic_kind','topic_id','role','ordinal']);
   for(const [i,item]of(t.items??[]).entries()){
    put(this.db,'topic_items',{...encode(item,maps.item,['sourceIds']),artifact_id:id,topic_id:t.id,ordinal:i},['artifact_id','topic_id','ordinal']);
    for(const [j,ref]of(item.sourceIds??[]).entries())put(this.db,'item_sources',{artifact_id:id,topic_id:t.id,item_ordinal:i,ordinal:j,unit_key:this.unitKey(revisionId,ref)},['artifact_id','topic_id','item_ordinal','ordinal']);
   }
  }
  for(const [ordinal,p]of(dto.cleanedPassages??[]).entries())put(this.db,'cleaned_passages',{...encode(p,{text:'cleaned_text',smallTalk:'small_talk:bool'},['passageId']),artifact_id:id,ordinal,unit_key:this.unitKey(revisionId,p.passageId)},['artifact_id','ordinal']);
  for(const [ordinal,o]of(dto.omissions??[]).entries())put(this.db,'omissions',{...encode(o,{reason:'reason'},['sourceId']),artifact_id:id,ordinal,unit_key:this.unitKey(revisionId,o.sourceId)},['artifact_id','ordinal']);
  return id;
 }
 readArtifact(id){const row=this.row('artifacts',id),d=decode(row,maps.artifact);if(!d)return null;
  const refs=(table,where,args)=>this.rows(table,where,args).sort((a,b)=>a.ordinal-b.ordinal).map(r=>this.unit(r.unit_key).id);
  if(has(d,'passages'))d.passages=this.rows('artifact_passages','artifact_id=?',[id]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>this.unit(r.unit_key));
  for(const [field,kind]of[['topics','derived'],['sourceTopics','source'],['groups','source']])if(has(d,field))d[field]=this.rows('topics','artifact_id=? AND kind=?',[id,kind]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>{
   const t=decode(r,maps.topic);
   if(has(t,'sourceIds'))t.sourceIds=refs('topic_sources','artifact_id=? AND topic_kind=? AND topic_id=? AND role=?',[id,kind,r.id,'members']);
   if(has(t,'summary.sourceIds'))t.summary.sourceIds=refs('topic_sources','artifact_id=? AND topic_kind=? AND topic_id=? AND role=?',[id,kind,r.id,'summary']);
   if(has(t,'items'))t.items=this.rows('topic_items','artifact_id=? AND topic_id=?',[id,r.id]).sort((a,b)=>a.ordinal-b.ordinal).map(x=>{const item=decode(x,maps.item);if(has(item,'sourceIds'))item.sourceIds=refs('item_sources','artifact_id=? AND topic_id=? AND item_ordinal=?',[id,r.id,x.ordinal]);return item;});return t;
  });
  if(has(d,'cleanedPassages'))d.cleanedPassages=this.rows('cleaned_passages','artifact_id=?',[id]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>({...decode(r,{text:'cleaned_text',smallTalk:'small_talk:bool'}),passageId:this.unit(r.unit_key).id}));
  if(has(d,'omissions'))d.omissions=this.rows('omissions','artifact_id=?',[id]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>({...decode(r,{reason:'reason'}),sourceId:this.unit(r.unit_key).id}));
  return d;
 }
 putMeeting(dto,{revision=null,stub=false,indexed=null}={}){
  return transaction(this.db,()=>{
   let originalId=dto.revisionId;
   if(!originalId||(!this.row('memory_revisions',originalId)&&!revision)){
    const payload={meetingId:dto.id,...selectFields(dto,['title','date','participants','originalTranscript',...evidenceFields]),units:[],legacyPassages:dto.passages??[]};
    originalId=`snapshot:${hash(payload)}`;revision={id:originalId,...payload};
   }
   const previousIndex=indexed??this.row('meetings',dto.id);
   const base={...encode(dto,maps.meeting,['originalTranscript','participants','processingConfig',...evidenceFields,...artifactFields]),user_id:USER,original_revision_id:originalId,evidence_id:null,artifact_id:null,config_id:null};
   if(dto.fingerprint===undefined&&previousIndex)base.fingerprint=previousIndex.fingerprint;
   if(dto.sourceKey===undefined&&previousIndex)base.source_key=previousIndex.source_key;
   if(stub){base.published_generation_id=null;put(this.db,'meetings',base);return;}
   const existed=this.row('meetings',dto.id);
   // Establish the parent before its dependent immutable source rows.
   if(!existed)put(this.db,'meetings',{...base,published_generation_id:null});
   if(revision)this.putRevision(revision,originalId.startsWith('snapshot:'));
   const original=this.revision(originalId);
   if(!original||original.meetingId!==dto.id||original.originalTranscript!==dto.originalTranscript)issue('meetings',dto.id,'current original does not match its immutable revision');
   const evidenceId=this.evidence(dto,dto.id),artifactId=this.artifact(selectFields(dto,artifactFields),dto.id,originalId);
   put(this.db,'meetings',{...base,evidence_id:evidenceId,artifact_id:artifactId,config_id:this.config(dto.processingConfig)});
   this.participants('meeting_participants','meeting_id',dto.id,dto.participants);return dto;
  });
 }
 meeting(id){const row=this.row('meetings',id);if(!row||row.user_id!==USER)return null;const d=decode(row,maps.meeting);
  if(has(d,'originalTranscript'))d.originalTranscript=this.revision(row.original_revision_id).originalTranscript;
  if(has(d,'participants'))d.participants=this.readParticipants('meeting_participants','meeting_id',id);
  if(has(d,'processingConfig'))d.processingConfig=this.readConfig(row.config_id);
  return Object.assign(d,this.readEvidence(row.evidence_id),this.readArtifact(row.artifact_id));
 }
 meetings(){return this.rows('meetings','user_id=?',[USER]).map(r=>this.meeting(r.id)).sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''));}
 putGeneration(dto){
  const old=this.row('memory_generations',dto.id);
  if(old&&!old.internal_building){if(canonical(this.generation(dto.id))!==canonical(dto))issue('memory_generations',dto.id,'published generation cannot change');return dto;}
  const artifactId=dto.result?this.artifact(dto.result,dto.meetingId,dto.revisionId):null;
  put(this.db,'memory_generations',{...encode(dto,maps.generation,['config','result']),config_id:this.config(dto.config),artifact_id:artifactId,internal_building:0});return dto;
 }
 generation(id){const row=this.row('memory_generations',id);if(!row||row.internal_building)return null;const d=decode(row,maps.generation);if(has(d,'config'))d.config=this.readConfig(row.config_id);if(has(d,'result'))d.result=this.readArtifact(row.artifact_id);return d;}
 putChunk(dto,meetingId=null,revisionId=null,storageId=null){
  const generation=dto.generationId?this.row('memory_generations',dto.generationId):null;
  meetingId??=generation?.meeting_id;revisionId??=dto.revisionId??generation?.revision_id;
  const id=dto.id??storageId;if(!id||!revisionId||!meetingId)issue('memory_source_chunks',id??'missing','missing storage identity');
  const existing=this.row('memory_source_chunks',id);if(existing){if(canonical(this.chunk(id))!==canonical(dto))issue('memory_source_chunks',id,'immutable chunk cannot change');return id;}
  const map=maps.chunk;
  put(this.db,'memory_source_chunks',{...encode(dto,map,['passageId','sourceIds','contextSourceIds','links','embedding','embeddingConfig']),id,meeting_id:meetingId,revision_id:revisionId,topic_artifact_id:dto.topicId?generation?.artifact_id:null,primary_unit_key:dto.passageId?this.unitKey(revisionId,dto.passageId):null,config_id:this.config(dto.embeddingConfig)});
  for(const [role,field]of[['members','sourceIds'],['context','contextSourceIds'],['link','links']])for(const [ordinal,value]of(dto[field]??[]).entries()){
   const ref=role==='link'?value.sourceId:value,unitKey=this.unitKey(revisionId,ref),unit=this.unit(unitKey);
   if(role==='link'&&(value.start!==unit.start||value.end!==unit.end))issue('chunk_sources',id,'link bounds do not match source');
   put(this.db,'chunk_sources',{chunk_id:id,role,ordinal,unit_key:unitKey,start_offset:role==='link'?value.start:null,end_offset:role==='link'?value.end:null,evidence_id:role==='link'?this.evidence(value,meetingId):null,metadata_json:role==='link'?encode(value,{start:'start_offset',end:'end_offset'},['sourceId',...evidenceFields]).metadata_json:null},['chunk_id','role','ordinal']);
  }
  if(dto.embedding){
   if(!Array.isArray(dto.embedding)||!dto.embedding.length||dto.embedding.some(n=>!Number.isFinite(n)))issue('embeddings',id,'invalid vector');
   const config=dto.embeddingConfig??(generation?this.readConfig(generation.config_id)?.embedding:null);
   if(config?.dimensions!=null&&config.dimensions!==dto.embedding.length)issue('embeddings',id,'dimension mismatch');
   const vector=Buffer.alloc(dto.embedding.length*8);dto.embedding.forEach((v,i)=>vector.writeDoubleLE(v,i*8));
   put(this.db,'embeddings',{chunk_id:id,model:config?.model??null,dimensions:dto.embedding.length,config_version:config?.version??null,normalization:config?.normalization??null,input_hash:dto.inputHash??null,vector},['chunk_id']);
  }return id;
 }
 chunk(id){const row=this.row('memory_source_chunks',id),d=decode(row,maps.chunk);if(!d)return null;
  if(has(d,'passageId'))d.passageId=this.unit(row.primary_unit_key).id;
  for(const [role,field]of[['members','sourceIds'],['context','contextSourceIds'],['link','links']])if(has(d,field))d[field]=this.rows('chunk_sources','chunk_id=? AND role=?',[id,role]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>role==='link'?{...decode(r,{start:'start_offset',end:'end_offset'}),sourceId:this.unit(r.unit_key).id,...this.readEvidence(r.evidence_id)}:this.unit(r.unit_key).id);
  if(has(d,'embeddingConfig'))d.embeddingConfig=this.readConfig(row.config_id);
  if(has(d,'embedding')){const e=this.db.prepare('SELECT * FROM embeddings WHERE chunk_id=?').get(id);if(!e)issue('embeddings',id,'missing vector');const b=Buffer.from(e.vector);d.embedding=Array.from({length:e.dimensions},(_,i)=>b.readDoubleLE(i*8));}
  return d;
 }
 generationChunks(id){return this.rows('memory_source_chunks','generation_id=?',[id]).map(r=>this.chunk(r.id));}
 putLegacyChunk(meetingId,dto){
  const meeting=this.row('meetings',meetingId),originalId=meeting.original_revision_id;
  const candidates=this.rows('memory_source_chunks','meeting_id=?',[meetingId]);
  const candidate=candidates.find(c=>canonical(selectFields(this.chunk(c.id),Object.keys(dto)))===canonical(dto));
  const id=candidate?.id??`legacy:${hash([meetingId,dto])}`;
  if(!candidate)this.putChunk(dto,meetingId,originalId,id);
  put(this.db,'legacy_chunk_aliases',{meeting_id:meetingId,passage_id:dto.passageId,chunk_id:id,fields_json:JSON.stringify(Object.keys(dto))},['meeting_id','passage_id']);
 }
 legacyChunks(meetingId){return this.rows('legacy_chunk_aliases','meeting_id=?',[meetingId]).sort((a,b)=>a.passage_id.localeCompare(b.passage_id)).map(r=>selectFields(this.chunk(r.chunk_id),JSON.parse(r.fields_json)));}
 putJob(dto){
  const configId=this.config(dto.config);
  if(!this.row('memory_generations',dto.generationId))put(this.db,'memory_generations',{id:dto.generationId,meeting_id:dto.meetingId,revision_id:dto.revisionId,status:'building',config_id:configId,internal_building:1,metadata_json:'{}'});
  const checkpoint=dto.checkpoint?structuredClone(dto.checkpoint):null;if(checkpoint)delete checkpoint.window;
  put(this.db,'memory_jobs',{...encode(dto,maps.job,['config','checkpoint.groups','checkpoint.topics','checkpoint.sourceTopics','checkpoint.passages','checkpoint.cleanedPassages','checkpoint.omissions','checkpoint.models']),checkpoint_artifact_id:checkpoint?this.artifact(checkpoint,dto.meetingId,dto.revisionId):null,config_id:configId});return dto;
 }
 job(id){const row=this.row('memory_jobs',id),d=decode(row,maps.job);if(!d)return null;
  if(has(d,'config'))d.config=this.readConfig(row.config_id);
  if(row.checkpoint_artifact_id)d.checkpoint={...d.checkpoint,...this.readArtifact(row.checkpoint_artifact_id)};return d;
 }
 putDiarization(dto){return transaction(this.db,()=>{
  this.recording(dto.recordingId);put(this.db,'diarizations',{...encode(dto,maps.diarization,['result']),user_id:USER});
  if(dto.result){
   const r=dto.result,old=this.row('diarized_transcripts',dto.id);if(old){if(canonical(this.diarization(dto.id).result)!==canonical(r))issue('diarized_transcripts',dto.id,'immutable result cannot change');}
   else {this.recording(r.recordingId);put(this.db,'diarized_transcripts',{...encode(r,maps.diarized,evidenceFields),evidence_id:this.evidence(r)});}
  }else if(this.row('diarized_transcripts',dto.id))issue('diarizations',dto.id,'existing result cannot be erased');return dto;
 });}
 diarization(id){const row=this.row('diarizations',id);if(!row||row.user_id!==USER)return null;const d=decode(row,maps.diarization);
  if(has(d,'result')){const r=this.row('diarized_transcripts',id);d.result={...decode(r,maps.diarized),...this.readEvidence(r.evidence_id)};}return d;
 }
 putAnswer(dto){return transaction(this.db,()=>{
  if(this.row('answers',dto.id)){if(canonical(this.answer(dto.id))!==canonical(dto))issue('answers',dto.id,'saved answer cannot change');return dto;}
  put(this.db,'answers',{...encode(dto,maps.answer,['filters.meetingIds','sources','statements']),user_id:USER});
  for(const [ordinal,id]of(dto.filters?.meetingIds??[]).entries())put(this.db,'answer_meeting_filters',{answer_id:dto.id,ordinal,requested_meeting_id:id},['answer_id','ordinal']);
  for(const [ordinal,s]of(dto.sources??[]).entries()){
   const meeting=this.row('meetings',s.meetingId),revisionId=s.revisionId;
   let units=[];
   if(meeting&&s.passageId&&Number.isInteger(s.start)&&Number.isInteger(s.end))units=this.db.prepare(`SELECT u.* FROM source_units u JOIN memory_revisions r ON r.id=u.revision_id WHERE r.meeting_id=? AND u.id=? AND u.start_offset=? AND u.end_offset=? AND u.original_text=?${revisionId?' AND r.id=?':''}`).all(s.meetingId,s.passageId,s.start,s.end,s.text,...(revisionId?[revisionId]:[]));
   const uniqueRevisions=new Set(units.map(u=>u.revision_id)),exact=uniqueRevisions.size===1?units[0]:null;
   if(revisionId&&!exact)issue('answer_sources',`${dto.id}/${ordinal}`,'explicit historical source does not match revision');
   const generation=s.generationId?this.row('memory_generations',s.generationId):null;
   if(s.generationId&&(!generation||generation.meeting_id!==s.meetingId||generation.revision_id!==revisionId))issue('answer_sources',`${dto.id}/${ordinal}`,'generation reference is inconsistent');
   // Legacy snapshots remain authoritative. A unique exact text match is a nullable
   // resolution aid, never a new speaker/timing assertion or a fabricated original ID.
   put(this.db,'answer_sources',{...encode(s,maps.answerSource,['participants',...evidenceFields]),answer_id:dto.id,ordinal,meeting_id:meeting?.id??null,resolved_unit_key:exact?.unit_key??null,resolved_generation_id:generation?.id??null,resolution:exact?'exact':'snapshot_only',evidence_id:this.evidence(s,meeting?.id??null)},['answer_id','ordinal']);
   for(const [i,name]of(s.participants??[]).entries())put(this.db,'answer_source_participants',{answer_id:dto.id,source_ordinal:ordinal,ordinal:i,name},['answer_id','source_ordinal','ordinal']);
  }
  for(const [ordinal,statement]of(dto.statements??[]).entries()){
   put(this.db,'answer_statements',{...encode(statement,{text:'statement_text',kind:'kind'},['citations']),answer_id:dto.id,ordinal},['answer_id','ordinal']);
   for(const [i,c]of(statement.citations??[]).entries()){
    const sourceOrdinal=(dto.sources??[]).findIndex(s=>s.meetingId===c.meetingId&&s.passageId===c.passageId&&(!c.revisionId||s.revisionId===c.revisionId)&&(!c.generationId||s.generationId===c.generationId));
    if(sourceOrdinal<0||typeof c.quote!=='string'||!dto.sources[sourceOrdinal].text.includes(c.quote))issue('answer_citations',`${dto.id}/${ordinal}/${i}`,'citation has no exact saved source/quote');
    if(c.revisionId&&c.revisionId!==dto.sources[sourceOrdinal].revisionId)issue('answer_citations',`${dto.id}/${ordinal}/${i}`,'citation revision differs from source');
    put(this.db,'answer_citations',{...encode(c,maps.citation),answer_id:dto.id,statement_ordinal:ordinal,ordinal:i,source_ordinal:sourceOrdinal},['answer_id','statement_ordinal','ordinal']);
   }
  }return dto;
 });}
 answer(id){const row=this.row('answers',id);if(!row||row.user_id!==USER)return null;const d=decode(row,maps.answer);
  if(has(d,'filters.meetingIds'))d.filters.meetingIds=this.rows('answer_meeting_filters','answer_id=?',[id]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>r.requested_meeting_id);
  if(has(d,'sources'))d.sources=this.rows('answer_sources','answer_id=?',[id]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>{const s=decode(r,maps.answerSource);if(has(s,'participants'))s.participants=this.rows('answer_source_participants','answer_id=? AND source_ordinal=?',[id,r.ordinal]).sort((a,b)=>a.ordinal-b.ordinal).map(x=>x.name);return {...s,...this.readEvidence(r.evidence_id)};});
  if(has(d,'statements'))d.statements=this.rows('answer_statements','answer_id=?',[id]).sort((a,b)=>a.ordinal-b.ordinal).map(r=>{const s=decode(r,{text:'statement_text',kind:'kind'});if(has(s,'citations'))s.citations=this.rows('answer_citations','answer_id=? AND statement_ordinal=?',[id,r.ordinal]).sort((a,b)=>a.ordinal-b.ordinal).map(x=>decode(x,maps.citation));return s;});return d;
 }
 answers(limit=100){return this.db.prepare('SELECT id FROM answers WHERE user_id=? ORDER BY rowid DESC LIMIT ?').all(USER,limit).map(r=>this.answer(r.id));}
 deleteMeeting(id){transaction(this.db,()=>{
  this.db.exec('PRAGMA defer_foreign_keys=ON');
  this.db.prepare('DELETE FROM answers WHERE id IN (SELECT answer_id FROM answer_sources WHERE meeting_id=? OR referenced_meeting_id=? UNION SELECT answer_id FROM answer_meeting_filters WHERE requested_meeting_id=?)').run(id,id,id);
  this.db.prepare('DELETE FROM diarized_selections WHERE meeting_id=?').run(id);
  for(const table of ['memory_source_chunks','memory_jobs','memory_generations','artifacts','memory_revisions'])this.db.prepare(`DELETE FROM ${table} WHERE meeting_id=?`).run(id);
  this.db.prepare('DELETE FROM meetings WHERE id=?').run(id);
 });}
 // Used only by migration verification, not by runtime writes. No JSON shadow tables.
 snapshot(){return {
  meetings:this.rows('meetings').map(r=>({id:r.id,user_id:r.user_id,fingerprint:r.fingerprint,source_key:r.source_key,value:this.meeting(r.id)})),
  memory_revisions:this.rows('memory_revisions','internal_snapshot=0').map(r=>({id:r.id,meeting_id:r.meeting_id,value:this.revision(r.id)})),
  memory_generations:this.rows('memory_generations','internal_building=0').map(r=>({id:r.id,meeting_id:r.meeting_id,revision_id:r.revision_id,value:this.generation(r.id)})),
  memory_source_chunks:this.rows('memory_source_chunks','generation_id IS NOT NULL').map(r=>({id:r.id,generation_id:r.generation_id,value:this.chunk(r.id)})),
  memory_jobs:this.rows('memory_jobs').map(r=>({id:r.id,meeting_id:r.meeting_id,value:this.job(r.id)})),
  chunks:this.rows('legacy_chunk_aliases').map(r=>({meeting_id:r.meeting_id,passage_id:r.passage_id,value:selectFields(this.chunk(r.chunk_id),JSON.parse(r.fields_json))})),
  diarizations:this.rows('diarizations').map(r=>({id:r.id,user_id:r.user_id,value:this.diarization(r.id)})),
  diarized_selections:this.rows('diarized_selections').map(r=>({...r})),
  answers:this.rows('answers').map(r=>({id:r.id,user_id:r.user_id,value:this.answer(r.id)})),
 };}
}
