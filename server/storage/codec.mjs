import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export const canonical = value => JSON.stringify(value, function (_k, v) { return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v; });
export const get = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
export function set(o, path, value) { const keys = path.split('.'); let p = o; for (const k of keys.slice(0,-1)) p = p[k] ??= {}; p[keys.at(-1)] = value; }
// Presence markers preserve historical missing vs null fields. Values and relationships
// live in columns/tables; only unrecognized extension metadata stays as JSON values.
export function encode(dto, map, children = []) {
  const meta = structuredClone(dto), row = {};
  for (const [path, spec] of Object.entries(map)) {
    const [column, type] = spec.split(':'); const value = get(dto, path);
    row[column] = value == null ? null : type === 'bool' ? Number(value) : value;
    if (value !== undefined) set(meta, path, 0);
  }
  for (const path of children) if (get(dto,path) !== undefined) set(meta,path,get(dto,path) === null ? null : true);
  return { ...row, metadata_json: JSON.stringify(meta) };
}
export function decode(row, map) {
  if (!row) return null; const dto = JSON.parse(row.metadata_json);
  for (const [path, spec] of Object.entries(map)) if (get(dto,path) !== undefined) { const [column,type] = spec.split(':'); set(dto,path,row[column] === null ? null : type === 'bool' ? Boolean(row[column]) : row[column]); }
  return dto;
}
export const has = (dto, field) => get(dto,field) === true;
export function put(db, table, row, keys=['id']) {
  const columns=Object.keys(row), updates=columns.filter(k=>!keys.includes(k));
  db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')}) ON CONFLICT(${keys.join(',')}) DO UPDATE SET ${updates.map(k=>`${k}=excluded.${k}`).join(',')}`).run(...columns.map(c=>row[c]??null));
}
export function transaction(db, fn) {
  const nested = db.isTransaction;
  db.exec(nested ? 'SAVEPOINT relational_write' : 'BEGIN IMMEDIATE');
  try { const result=fn(); db.exec(nested ? 'RELEASE relational_write' : 'COMMIT');return result; }
  catch(e){ db.exec(nested ? 'ROLLBACK TO relational_write' : 'ROLLBACK');if(nested)db.exec('RELEASE relational_write');throw e; }
}
export function issue(table,id,reason) { const e=new Error(`${table} record ${id}: ${reason}`);e.code='SQLITE_MIGRATION_INVALID_RECORD';throw e; }
