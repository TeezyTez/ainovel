// Public, evidence-backed experience records. Real elapsed time is never inferred
// from request counts, wall-clock timestamps, private state or future plans.
import {gameItemAliases} from './game-state.js';
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max=2000)=>typeof v==='string'&&v.length<=max;
const nonempty=(v,max=2000)=>text(v,max)&&!!v.trim();
const id=v=>nonempty(v,200)&&/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
export const EXPERIENCE_KINDS=['person','item','agreement','clue','location','resource','event','fact'];
export const EXPERIENCE_FIELDS=['owner','custodian','location','occurredAt','learnedAt','scheduledAt','actualAt','deadline','condition','amount','unit','source','relationship','role','age','stage','duration','route','availability','purpose','participants','outcome'];
const exactKeys=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const normalized=v=>String(v).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
export function knownObjectId(kind,name){let hash=2166136261;for(const char of normalized(name)){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}return `${kind}:${(hash>>>0).toString(36)}`;}
const publicObject=o=>({id:o.id,kind:o.kind,name:o.name,summary:o.summary,status:o.status,certainty:o.certainty,fields:o.fields.map(f=>({key:f.key,label:f.label,value:f.value})),relatedIds:[...o.relatedIds],sourceVersion:o.sourceVersion});

export function validateExperience(receipt,prose,{snapshot=false,version=0,world}={}){
  if(receipt==null)return receipt;
  assert(exactKeys(receipt,['clock','objects','stop','folded',...(snapshot?['schemaVersion']:[])])&&['clock','objects','stop','folded'].every(k=>Object.hasOwn(receipt,k)),'时间与情况记录格式无效。');
  if(snapshot&&receipt.schemaVersion!==undefined)assert(receipt.schemaVersion===1,'已知对象更新版本无效。');
  const witness=(v,keys)=>{assert(exactKeys(v,[...keys,...(snapshot?['sourceVersion']:[])])&&nonempty(v.quote)&&(!prose||prose.includes(v.quote)),'时间或情况变化缺少正文原句依据。');if(snapshot)assert(Number.isSafeInteger(v.sourceVersion)&&v.sourceVersion>=0&&v.sourceVersion<=version,'情况来源版本无效。');};
  if(receipt.clock!=null){const c=receipt.clock;witness(c,['label','elapsed','precision','quote']);assert(nonempty(c.label,200)&&text(c.elapsed,200)&&['unknown','approximate','exact'].includes(c.precision),'故事时间格式无效。');}
  assert(Array.isArray(receipt.objects)&&receipt.objects.length<=(snapshot?2000:40),'已知对象列表无效。');
  const seen=new Set();for(const o of receipt.objects){witness(o,['id','kind','name','summary','status','certainty','fields','relatedIds','quote']);assert(id(o.id)&&!seen.has(o.id)&&EXPERIENCE_KINDS.includes(o.kind)&&nonempty(o.name,200)&&text(o.summary)&&nonempty(o.status,200)&&['confirmed','reported','inferred','unknown'].includes(o.certainty),'已知对象记录无效或重复。');seen.add(o.id);
    assert(Array.isArray(o.fields)&&o.fields.length<=24&&o.fields.every(f=>exactKeys(f,['key','label','value'])&&EXPERIENCE_FIELDS.includes(f.key)&&nonempty(f.label,100)&&text(f.value))&&new Set(o.fields.map(f=>f.key)).size===o.fields.length,'对象字段须为白名单文字记录。');
    assert(Array.isArray(o.relatedIds)&&o.relatedIds.length<=20&&o.relatedIds.every(id),'对象关联格式无效。');
    if(o.kind==='person'){assert(o.id.startsWith('person:'),'人物对象需要独立的稳定标识。');const known=world?.characters.find(c=>o.id===`person:${c.id}`);if(known)assert(o.name===known.name,'已有的人物标识不能冒充其他人物。');}
  }
  if(receipt.stop!=null){witness(receipt.stop,['reason','quote']);assert(nonempty(receipt.stop.reason,1000),'停点说明无效。');}
  assert(Array.isArray(receipt.folded)&&receipt.folded.length<=12,'折叠记录无效。');for(const f of receipt.folded){witness(f,['id','title','summary','quote']);assert(id(f.id)&&nonempty(f.title,200)&&nonempty(f.summary),'折叠记录缺少已保存内容。');}
  return receipt;
}

export function advanceExperience(before,receipt,version,{legacyFields=false}={}){
  if(receipt==null)return before===undefined?undefined:structuredClone(before);
  validateExperience(receipt);
  const next=before?structuredClone(before):{clock:null,objects:[],stop:null,folded:[]};
  if(!legacyFields)next.schemaVersion=1;
  const sourced=v=>({...structuredClone(v),sourceVersion:version});
  if(receipt.clock)next.clock=sourced(receipt.clock);
  for(const o of receipt.objects){const record=sourced(o),index=next.objects.findIndex(old=>old.id===o.id);if(index===-1)next.objects.push(record);else{const old=next.objects[index];assert(old.kind===o.kind,'同一对象标识不能变成另一类对象。');if(old.kind==='agreement'&&['已履行','已取消','已失效','fulfilled','cancelled','expired'].includes(old.status))assert(o.status===old.status,'已结束的约定不能重开，请登记新的约定。');if(!legacyFields)record.fields=[...new Map([...old.fields,...record.fields].map(f=>[f.key,f])).values()];next.objects[index]=record;}}
  next.stop=receipt.stop?sourced(receipt.stop):null;
  next.folded=receipt.folded.map(sourced);
  return next;
}

export function validateControl(control,{worldKey,version,branchId}={}){
  if(control===undefined)return undefined;
  assert(exactKeys(control,['kind','goal','until','limit','forbidden','reserved','worldKey','baseVersion','branchId'])&&['advance','wait','delegate','read','act','epilogue'].includes(control.kind),'推进安排格式无效。');
  for(const key of ['goal','until','limit','forbidden','reserved'])assert(text(control[key],2000),'推进安排需要完整的文字边界。');
  if(['wait','advance','delegate'].includes(control.kind))assert(nonempty(control.limit),'等待与委托必须有本次上限。');
  if(control.worldKey!==undefined)assert(control.worldKey===worldKey,'推进安排来自其他世界。');
  if(control.baseVersion!==undefined)assert(control.baseVersion===version,'推进安排已过期。');
  if(control.branchId!==undefined)assert(control.branchId===branchId,'推进安排来自其他分支。');
  return Object.fromEntries(['kind','goal','until','limit','forbidden','reserved'].map(k=>[k,control[k]]));
}

function selectedTurns(branch,turnId){if(turnId===undefined)return branch.turns;if(turnId===null)return [];const at=branch.turns.findIndex(t=>t.id===turnId);assert(at>=0,'回顾位置已不存在。');return branch.turns.slice(0,at+1);}
function knownSentence(prose,name){return prose.split(/(?<=[。！？\n])/).find(line=>line.includes(name))?.trim().slice(0,2000)||'';}
export function publicSituation(branch,world,turnId){
  const turns=selectedTurns(branch,turnId),state=turns.at(-1)?.state||branch.initialState,records=new Map();
  const put=(kind,name,summary,version,extra={})=>{const key=extra.id||knownObjectId(kind,name);records.set(key,{id:key,kind,name,summary,status:'已知',certainty:'confirmed',fields:[],relatedIds:[],sourceVersion:version,...extra});};
  const observe=(prose,version)=>{for(const person of world.characters){const sentence=knownSentence(prose,person.name);if(sentence&&!records.has(`person:${person.id}`))put('person',person.name,sentence,version,{id:`person:${person.id}`});}};
  observe(branch.opening??world.opening,0);
  if(branch.initialState.location)put('location',branch.initialState.location,'故事开始时所在地点',0);
  for(const fact of branch.initialState.facts||[])put('fact',fact,fact,0);
  for(const item of branch.initialState.inventory||[])put('item',item,'开篇记录的随身物品',0,{fields:[{key:'custodian',label:'保管者',value:'你'}]});
  for(const t of turns){observe(t.prose,t.state.version);for(const e of t.events||[]){if(e.visibility!=='player'||e.type==='flag')continue;if(e.type==='fact')put('fact',e.value,e.value,t.state.version);if(e.type==='item-add')put('item',e.value,'已得到或由你保管',t.state.version,{fields:[{key:'custodian',label:'保管者',value:'你'}]});if(e.type==='item-remove'){const old=records.get(knownObjectId('item',e.value));put('item',e.value,'已离开随身物品',t.state.version,{...old,status:'不再持有',sourceVersion:t.state.version,fields:[]});}if(e.type==='location')put('location',e.value,'曾到达的地点',t.state.version);if(e.type==='relation'){const p=world.characters.find(c=>c.id===e.entity);if(p)put('person',p.name,e.value,t.state.version,{id:`person:${p.id}`,fields:[{key:'relationship',label:'关系',value:e.value}]});}}
    // Apply each snapshot at its historical position so later legacy events can
    // supersede it; never merge a future branch or private narrative record.
    for(const o of t.state.experience?.objects||[])if(o.sourceVersion===t.state.version){const fallback=knownObjectId(o.kind,o.name);if(fallback!==o.id&&!t.state.experience.objects.some(other=>other.id===fallback))records.delete(fallback);records.set(o.id,publicObject(o));}
  }
  for(const o of branch.initialState.experience?.objects||[])if(!records.has(o.id))records.set(o.id,publicObject(o));
  // Generic gameplay is the canonical numeric ledger. Older descriptive records
  // remain provenance, but their old amounts/statuses must not become current UI.
  const gameKinds={meter:'resource',item:'item',place:'location',clue:'clue',objective:'event',actor:'person'};
  for(const entity of state.game?.entities??[]){
    const compatibleKinds=entity.kind==='objective'?['agreement','event']:[gameKinds[entity.kind]],sameName=(state.game.entities.filter(e=>e.kind===entity.kind&&e.name===entity.name).length===1);
    const candidates=[...records.values()].filter(o=>sameName&&compatibleKinds.includes(o.kind)&&o.name===entity.name);
    const exact=records.get(entity.id),existing=exact||(candidates.length===1?candidates[0]:undefined);
    const kind=entity.kind==='objective'&&compatibleKinds.includes(existing?.kind)?existing.kind:gameKinds[entity.kind];
    const fields=(existing?.fields??[]).filter(f=>!['amount','unit'].includes(f.key));
    if(entity.value!==null)fields.push({key:'amount',label:'数量',value:String(entity.value)});
    if(entity.unit)fields.push({key:'unit',label:'单位',value:entity.unit});
    const aliases=gameItemAliases(entity,state.experience);
    for(const [id,o] of records)if(id!==entity.id&&sameName&&compatibleKinds.includes(o.kind)&&(o.name===entity.name||(kind==='item'&&aliases.has(o.name)))&&!state.game.entities.some(e=>e.id===id)&&(id===knownObjectId(o.kind,o.name)||(!exact&&id===existing?.id)))records.delete(id);
    const currentPlace=entity.kind==='place'&&entity.name===state.location;
    const outdatedPlace=entity.kind==='place'&&!currentPlace&&['当前位置','当前所在'].includes(entity.status);
    put(kind,entity.name,outdatedPlace?'已知地点；当前位于'+state.location:entity.detail,entity.sourceVersion,{id:entity.id,status:currentPlace?'当前所在':outdatedPlace?'已知地点':entity.status||(entity.kind==='item'&&entity.value===0?'已耗尽':'已知'),fields,relatedIds:existing?.relatedIds??[]});
  }
  const c=state.experience?.clock;
  const legacyLabel=/^第\s*\d+\s*个片刻$/.test(state.time)||state.time==='开篇'?'故事时间未说明':state.time;
  const currentClock=c?.sourceVersion===state.version;
  const clock=c?{label:currentClock?c.label:`最后确认：${c.label}`,elapsed:currentClock?c.elapsed:'',precision:currentClock?c.precision:'unknown'}:{label:legacyLabel||'故事时间未说明',elapsed:'',precision:'unknown'};
  const objects=[...records.values()].map(o=>({...o,...(o.kind==='fact'&&o.sourceVersion<state.version?{status:'历史记录'}:{}),relatedIds:o.relatedIds.filter(id=>records.has(id))}));
  return {clock,objects,summary:`${state.location||'地点未说明'} · ${clock.label}${state.experience?.stop?` · ${state.experience.stop.reason}`:''}`};
}

export function historyEntries(branch,query=''){
  const safeState=s=>({version:s.version,location:s.location,time:s.experience?.clock?.label||(/^第\s*\d+\s*个片刻$/.test(s.time)?'故事时间未说明':s.time),facts:[...(s.facts||[])],inventory:[...(s.inventory||[])]});
  const entries=[{id:null,input:'',prose:branch.opening||'',state:safeState(branch.initialState)},...branch.turns.map(t=>({id:t.id,input:t.input,prose:t.prose,state:safeState(t.state),ended:!!t.ended,...(t.experience?{experience:structuredClone(t.experience)}:{})}))];
  const search=normalized(query);return search?entries.filter(t=>normalized(t.input+'\n'+t.prose).includes(search)):entries;
}
