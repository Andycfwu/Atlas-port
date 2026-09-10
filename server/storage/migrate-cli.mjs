import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compareSnapshots, legacySnapshot, migrateRelational, schemaVersion, verifyIntegrity } from './migration.mjs';
import { RelationalMemory } from './relational.mjs';
const args=process.argv.slice(2), option=name=>{
 const value=args[args.indexOf(name)+1];
 if(!value||value.startsWith('--'))throw new Error(`Missing value for ${name}`);
 return value;
};
const modes=['--backup','--verify-against','--apply'].filter(flag=>args.includes(flag));
if(modes.length>1)throw new Error('Choose only one operation: backup, verify-against, or apply.');
const filename=args.includes('--database')?resolve(option('--database')):resolve('server',process.env.MEMORY_DB_PATH||'data/meeting-memory.sqlite');
if(!existsSync(filename))throw new Error('Configured database does not exist; refusing to create a replacement.');
const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
try{
 if(args.includes('--backup')){const output=resolve(option('--backup'));if(existsSync(output))throw new Error('Backup destination exists; refusing to overwrite it.');db.prepare('VACUUM INTO ?').run(output);console.log(JSON.stringify({database:filename,backup:output,...verifyIntegrity(db)}));}
 else if(args.includes('--verify-against')){
  const backup=new DatabaseSync(resolve(option('--verify-against')),{readOnly:true});
  try{console.log(JSON.stringify({database:filename,manifest:compareSnapshots(legacySnapshot(backup),new RelationalMemory(db).snapshot()),...verifyIntegrity(db)},null,2));}finally{backup.close();}
 }else if(args.includes('--apply')){
  if(!args.includes('--backend-stopped'))throw new Error('Stop the backend and confirm no recording/transcription/processing is active. Then use --backend-stopped.');
  const report={database:filename,...migrateRelational(db)};
  if(args.includes('--report'))writeFileSync(resolve(option('--report')),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }else console.log(JSON.stringify({database:filename,schemaVersion:schemaVersion(db),...verifyIntegrity(db)}));
}finally{db.close();}
