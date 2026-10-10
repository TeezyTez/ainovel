import {clone,uid,worldKey,validateArchive} from './core.js';
import {validatePersonalMetadata} from './personal-library.js';
const ordered=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export function mergeArchive(current,source){
  const incoming=validateArchive(source),next=clone(current);validatePersonalMetadata(incoming);
  for(const world of incoming.worlds){const existing=next.worlds.find(w=>worldKey(w)===worldKey(world));if(existing&&ordered(existing)!==ordered(world))throw new Error('同名世界版本内容冲突。请先备份，并在独立浏览器导入该存档。');if(!existing)next.worlds.push(world);}
  // Personal sources deliberately bind to world/branch/turn, never a session id.
  // Regenerating the imported session id therefore preserves valid local references.
  for(const session of incoming.sessions){session.id=uid();session.updatedAt=Date.now();for(const b of session.branches)b.opening??=incoming.worlds.find(w=>worldKey(w)===b.worldKey).opening;next.sessions.push(session);}
  if(incoming.settings)next.settings={...next.settings,...incoming.settings};
  if(Object.hasOwn(incoming,'worldDraft'))next.worldDraft=incoming.worldDraft;
  if(incoming.telemetry)next.telemetry=[...(next.telemetry||[]),...incoming.telemetry].slice(-500);
  validatePersonalMetadata(next);return next;
}
