import { SCHEMA, VERSION } from './schema.mjs';
import { RelationalMemory } from './relational.mjs';
import { canonical, hash, issue } from './codec.mjs';
export const LEGACY_TABLES=['meetings','memory_revisions','memory_generations','memory_source_chunks','memory_jobs','chunks','diarizations','diarized_selections','answers'];
export function schemaVersion(db){return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()?db.prepare('SELECT max(version) v FROM schema_migrations').get().v:0;}
export function initializeEmpty(db){db.exec('BEGIN IMMEDIATE');try{db.exec(SCHEMA);db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(VERSION,new Date().toISOString(),'Relational Meeting Memory storage');db.exec(`PRAGMA user_version=${VERSION}; COMMIT`);}catch(e){db.exec('ROLLBACK');throw e;}}
export function legacySnapshot(db){
 const result={};for(const table of LEGACY_TABLES){
  const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  result[table]=exists?db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row=>{
   if(!Object.hasOwn(row,'payload'))return {...row};
   let value;try{value=JSON.parse(row.payload);}catch{issue(table,row.id??row.passage_id,'malformed JSON');}
   if(!value||typeof value!=='object'||Array.isArray(value))issue(table,row.id??row.passage_id,'payload is not an object');
   if(row.id&&value.id!==row.id)issue(table,row.id,'payload ID disagrees with primary key');
   if(row.user_id&&row.user_id!=='single-user-development')issue(table,row.id,'unsupported historical owner; migration must not reassign ownership');
   const {payload,...columns}=row;return {...columns,value};
  }):[];
 }return result;
}
const sortRows=rows=>[...rows].sort((a,b)=>canonical([a.id??a.meeting_id,a.passage_id??a.source_id]).localeCompare(canonical([b.id??b.meeting_id,b.passage_id??b.source_id])));
function difference(a,b,path=''){
 if(canonical(a)===canonical(b))return null;
 if(a&&b&&typeof a==='object'&&typeof b==='object')for(const k of new Set([...Object.keys(a),...Object.keys(b)])){const d=difference(a[k],b[k],path?`${path}.${k}`:k);if(d)return d;}
 return path||'(root)';
}
export function compareSnapshots(before,after){
 for(const table of LEGACY_TABLES){const a=sortRows(before[table]),b=sortRows(after[table]);if(a.length!==b.length)issue(table,'count','record count changed');for(let i=0;i<a.length;i++){const diff=difference(a[i],b[i]);if(diff)issue(table,a[i].id??a[i].passage_id??a[i].source_id,`round-trip mismatch at ${diff}`);}}
 return Object.fromEntries(LEGACY_TABLES.map(t=>[t,{count:before[t].length,sha256:hash(sortRows(before[t]))}]));
}
export function verifyIntegrity(db){
 const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();if(foreignKeys.length)throw new Error(`Foreign-key violations: ${foreignKeys.map(r=>{
  const columns=db.prepare(`PRAGMA table_info("${r.table}")`).all().filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
  const row=db.prepare(`SELECT ${columns.map(c=>`"${c}"`).join(',')} FROM "${r.table}" WHERE rowid=?`).get(r.rowid);
  return `${r.table} record ${row?Object.values(row).join('/'):r.rowid} parent ${r.parent}`;
 }).join('; ')}`);
 const rows=db.prepare('PRAGMA integrity_check').all();if(rows.length!==1||rows[0].integrity_check!=='ok')throw new Error('SQLite integrity_check failed');
 return {foreignKeys:'ok',integrity:'ok'};
}
export function migrateRelational(db,{faultAfter=null}={}){
 if(schemaVersion(db)===VERSION)return {alreadyApplied:true,...verifyIntegrity(db)};
 if(schemaVersion(db)>VERSION)throw new Error('Database schema is newer than this code.');
 db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
 try{
  // Read the migration snapshot under the same write lock used for publication.
  const before=legacySnapshot(db);
  for(const table of ['meetings','memory_jobs','diarizations'])for(const row of before[table])if(row.value.status==='processing')issue(table,row.id,'processing is active or interrupted; resolve recovery with matching old backend before migration');
  const existing=LEGACY_TABLES.filter(t=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t));
  const each=(table,fn)=>{for(const row of before[table])try{fn(row);}catch(error){
   if(error.code==='SQLITE_MIGRATION_INVALID_RECORD')throw error;
   issue(table,row.id??row.passage_id??row.source_id,`could not normalize related fields (${error.code??error.name}); original record retained`);
  }};
  for(const table of existing)db.exec(`ALTER TABLE ${table} RENAME TO migration_old_${table}`);
  db.exec(SCHEMA);const repo=new RelationalMemory(db);
  each('meetings',row=>repo.putMeeting(row.value,{stub:true,indexed:row,revision:before.memory_revisions.find(r=>r.id===row.value.revisionId)?.value}));
  each('memory_revisions',row=>repo.putRevision(row.value));
  // Internal snapshots only cover genuinely unversioned older records. They do not
  // claim a historical revision ID, speaker mapping or recording relationship.
  each('meetings',row=>{if(!row.value.revisionId)repo.putMeeting({...row.value,publishedGenerationId:null});});
  if(faultAfter==='sources')throw new Error('Injected migration interruption after sources');
  each('diarizations',row=>repo.putDiarization(row.value));
  each('memory_generations',row=>repo.putGeneration(row.value));
  each('memory_source_chunks',row=>repo.putChunk(row.value));
  each('chunks',row=>repo.putLegacyChunk(row.meeting_id,row.value));
  each('memory_jobs',row=>repo.putJob(row.value));
  each('meetings',row=>repo.putMeeting(row.value));
  each('diarized_selections',row=>db.prepare('INSERT INTO diarized_selections VALUES (?,?)').run(row.source_id,row.meeting_id));
  each('answers',row=>repo.putAnswer(row.value));
  if(faultAfter==='answers')throw new Error('Injected migration interruption after answers');
  const manifest=compareSnapshots(before,repo.snapshot());
  // Remove the old writable representation only after exact round-trip validation.
  for(const table of [...existing].reverse())db.exec(`DROP TABLE migration_old_${table}`);
  const integrity=verifyIntegrity(db);
  db.prepare('INSERT INTO schema_migrations VALUES (?,?,?)').run(VERSION,new Date().toISOString(),'Relational Meeting Memory; lossless verified JSON-to-columns migration');
  db.exec(`PRAGMA user_version=${VERSION}`);
  if(faultAfter==='commit')throw new Error('Injected migration interruption before commit');
  db.exec('COMMIT');return {alreadyApplied:false,version:VERSION,manifest,...integrity};
 }catch(error){db.exec('ROLLBACK');throw error;}
}
