// Local, private presentation metadata. No dependency on core or model modules.
// Every editing function returns a clone; callers explicitly replace/apply it.
import {publicSituation} from './experience-state.js';
const copy=value=>structuredClone(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=20000)=>typeof value==='string'&&value.length<=max;
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
const integer=value=>Number.isSafeInteger(value)&&value>=0;
const viewportOffset=value=>Number.isFinite(value)&&Math.abs(value)<=1000000;
const timestamp=value=>Number.isFinite(value)&&value>=0&&value<8640000000000000;
const assert=(ok,message)=>{if(!ok)throw new Error(`个人资料无效：${message}`);};
const only=(value,keys)=>assert(object(value)&&Object.keys(value).every(key=>keys.includes(key)),'存在未知字段。');
const activeBranch=session=>session.branches?.find(branch=>branch.id===session.activeBranch);
const paragraphs=prose=>String(prose||'').split(/\n\s*\n/).map(part=>part.trim()).filter(Boolean);
const annotationLists=['bookmarks','clips','notes'];

export function ensurePersonal(branch) {
  return copy({bookmarks:[],clips:[],notes:[],objects:{},anchor:null,draftReferences:[],intent:'',...(branch.personal||{})});
}

function sourceAt(branch,turnId) {
  if(turnId===null)return {prose:branch.opening||'',version:0,revisions:[]};
  const turn=branch.turns?.find(item=>item.id===turnId);
  assert(turn,'来源回合不存在于本分支。');
  return {prose:turn.prose,version:turn.state.version,revisions:turn.revisions||[]};
}
function knownObjects(branch,turnId) {
  // Supply names only, never private character backgrounds. publicSituation
  // reveals a person only when their name occurs in this branch's public prose.
  const world={opening:branch.opening||'',characters:Object.entries(branch.initialState.characters||{}).map(([id,person])=>({id,name:person.name}))};
  return publicSituation(branch,world,turnId).objects;
}
function inspectReference(branch,reference,{allowHistorical=false}={}) {
  only(reference,['worldKey','branchId','turnId','quote','sourceVersion','objectId']);
  assert(reference.worldKey===branch.worldKey,'来源世界版本不匹配。');
  assert(reference.branchId===branch.id,'来源分支不匹配。');
  assert(reference.turnId===null||safeId(reference.turnId),'来源回合无效。');
  assert(text(reference.quote)&&reference.quote.trim(),'来源原文为空或过长。');
  assert(integer(reference.sourceVersion),'来源版本无效。');
  if(reference.objectId!==undefined)assert(safeId(reference.objectId),'来源对象标识无效。');
  const source=sourceAt(branch,reference.turnId);
  assert(source.version===reference.sourceVersion,'来源版本已过期。');
  let current=source.prose.includes(reference.quote);
  const historical=source.revisions.some(revision=>text(revision.prose)&&revision.prose.includes(reference.quote));
  assert(current||(allowHistorical&&historical),'来源原文已修订或不存在，请重新选择引用。');
  if(reference.objectId!==undefined) {
    let wasKnown=knownObjects(branch,reference.turnId).some(item=>item.id===reference.objectId);
    if(!wasKnown&&allowHistorical&&reference.turnId!==null) {
      // A legitimate rewrite may remove the first mention of a person. Keep
      // the quoted old note readable without promoting that revision to facts.
      wasKnown=source.revisions.some(revision=>{
        if(!text(revision.prose)||!revision.prose.includes(reference.quote))return false;
        const historicalBranch={...branch,turns:branch.turns.map(turn=>turn.id===reference.turnId?{...turn,prose:revision.prose}:turn)};
        return knownObjects(historicalBranch,reference.turnId).some(item=>item.id===reference.objectId);
      });
    }
    assert(wasKnown,'来源对象在该回合尚未成为已知对象。');
    const latest=knownObjects(branch).find(item=>item.id===reference.objectId);
    const objectCurrent=!!latest&&latest.sourceVersion<=reference.sourceVersion;
    assert(allowHistorical||objectCurrent,'来源对象已有更新，旧对象引用已过期，请重新选择。');
    current=current&&objectCurrent;
  }
  return {source,current};
}
export function createReference(branch,turnId,quote,objectId='') {
  const source=sourceAt(branch,turnId);
  const reference={worldKey:branch.worldKey,branchId:branch.id,turnId,quote,sourceVersion:source.version,...(objectId?{objectId}:{})};
  validateReference(branch,reference);return reference;
}
export const makeReference=createReference;
export function validateReference(branch,reference) {inspectReference(branch,reference);return copy(reference);}
export function resolveReference(branch,reference) {
  try {
    const {current}=inspectReference(branch,reference,{allowHistorical:true});
    return {reference:copy(reference),stale:!current,reason:current?'':'原句已被润色或对象已有更新，保留的是旧版来源。',prose:current?sourceAt(branch,reference.turnId).prose:reference.quote};
  } catch(error) {return {reference:copy(reference),stale:true,reason:error.message,prose:''};}
}

export function addAnnotation(branch,{turnId,quote,note='',kind='note',objectId=''}={}) {
  assert(['note','clip','bookmark'].includes(kind),'未知记录类型。');
  assert(text(note,8000),'笔记过长。');
  const reference=createReference(branch,turnId,quote,objectId),next=copy(branch);
  next.personal=ensurePersonal(branch);
  const list={note:'notes',clip:'clips',bookmark:'bookmarks'}[kind];
  assert(next.personal[list].length<2000,'此类记录已达本机存档上限，请导出整理后再添加。');
  next.personal[list].push({id:crypto.randomUUID(),reference,text:note,createdAt:Date.now()});
  return next;
}
export function removeAnnotation(branch,id) {
  const next=copy(branch);next.personal=ensurePersonal(branch);
  for(const list of annotationLists)next.personal[list]=next.personal[list].filter(item=>item.id!==id);
  return next;
}
export function updatePrivateNote(branch,id,note) {
  assert(text(note,8000),'笔记过长。');const next=copy(branch);next.personal=ensurePersonal(branch);
  const item=next.personal.notes.find(entry=>entry.id===id);assert(item,'笔记不存在。');item.text=note;return next;
}
export function addBookmark(branch,reference,note='') {validateReference(branch,reference);return addAnnotation(branch,{...reference,note,kind:'bookmark'});}
export function addClip(branch,reference,note='') {validateReference(branch,reference);return addAnnotation(branch,{...reference,note,kind:'clip'});}
export function addPrivateNote(branch,reference,note='') {validateReference(branch,reference);return addAnnotation(branch,{...reference,note,kind:'note'});}
export const removePersonalEntry=removeAnnotation;

export function setObjectPreference(branch,id,patch) {
  assert(safeId(id),'对象标识无效。');only(patch,['followed','muted']);
  for(const value of Object.values(patch))assert(typeof value==='boolean','关注与提醒必须是开关。');
  const next=copy(branch);next.personal=ensurePersonal(branch);
  next.personal.objects[id]={followed:false,muted:false,...next.personal.objects[id],...patch};
  return next;
}
export const toggleObjectFocus=(branch,id)=>setObjectPreference(branch,id,{followed:!branch.personal?.objects?.[id]?.followed});
export const muteReminder=(branch,id,muted=true)=>setObjectPreference(branch,id,{muted});

export function captureReadingAnchor(branch,{turnId=null,paragraphIndex=0,offset=0}={}) {
  const source=sourceAt(branch,turnId),parts=paragraphs(source.prose);
  assert(integer(paragraphIndex)&&paragraphIndex<Math.max(1,parts.length),'段落位置无效。');
  assert(viewportOffset(offset),'段落偏移无效。');
  const quote=parts[paragraphIndex]||'';
  // offset is the paragraph's signed viewport top, not a character index.
  return {worldKey:branch.worldKey,branchId:branch.id,turnId,sourceVersion:source.version,paragraphIndex,offset,quote};
}
function validateAnchor(branch,anchor) {
  only(anchor,['worldKey','branchId','turnId','sourceVersion','paragraphIndex','offset','quote']);
  assert(anchor.worldKey===branch.worldKey&&anchor.branchId===branch.id,'阅读锚点属于其他世界或分支。');
  assert(anchor.turnId===null||safeId(anchor.turnId),'阅读锚点回合无效。');
  assert(integer(anchor.paragraphIndex)&&integer(anchor.sourceVersion)&&(anchor.offset===undefined||viewportOffset(anchor.offset))&&text(anchor.quote),'阅读锚点格式无效。');
  assert(sourceAt(branch,anchor.turnId).version===anchor.sourceVersion,'阅读锚点来源版本无效。');
}
export function resolveReadingAnchor(branch,anchor=branch.personal?.anchor) {
  const fallback=(turnId,reason)=>({anchor:captureReadingAnchor(branch,{turnId,paragraphIndex:0}),stale:true,reason});
  if(!anchor)return {anchor:captureReadingAnchor(branch),stale:false,reason:''};
  try{validateAnchor(branch,anchor);}catch(error){return fallback(null,error.message);}
  const parts=paragraphs(sourceAt(branch,anchor.turnId).prose);
  if(parts[anchor.paragraphIndex]===anchor.quote)return {anchor:{...copy(anchor),offset:anchor.offset||0},stale:false,reason:''};
  // Only relocate by the exact original paragraph. Never reuse an unrelated index.
  const matches=parts.flatMap((part,index)=>part===anchor.quote?[index]:[]);
  if(matches.length===1)return {anchor:{...copy(anchor),paragraphIndex:matches[0],offset:anchor.offset||0},stale:false,reason:'原段落位置已迁移。'};
  return fallback(anchor.turnId,'原段落已修订或位置不唯一，已回到该回合开头。');
}
export function setReadingAnchor(branch,anchor) {
  validateAnchor(branch,anchor);
  // Story facts are untouched. Copy only the private subtree on this hot path.
  const personal=ensurePersonal(branch);personal.anchor=copy(anchor);
  return {...branch,personal};
}
export function setDraftContext(branch,{references=branch.personal?.draftReferences||[],intent=branch.personal?.intent||''}={}) {
  assert(Array.isArray(references)&&references.length<=20,'草稿引用最多二十项。');
  assert(text(intent,8000),'待办意图过长。');for(const reference of references)validateReference(branch,reference);
  const next=copy(branch);next.personal=ensurePersonal(branch);next.personal.draftReferences=copy(references);next.personal.intent=intent;return next;
}

export function updateStoryMetadata(session,patch) {
  only(patch,['pinned','note','group','title','archived']);const next=copy(session);next.personal={pinned:false,note:'',group:'',trashedAt:null,...next.personal};
  if(patch.pinned!==undefined){assert(typeof patch.pinned==='boolean','置顶必须是开关。');next.personal.pinned=patch.pinned;}
  if(patch.note!==undefined){assert(text(patch.note,8000),'备注过长。');next.personal.note=patch.note;}
  if(patch.group!==undefined){assert(text(patch.group,200),'分组名称过长。');next.personal.group=patch.group;}
  if(patch.title!==undefined){assert(text(patch.title,200)&&patch.title.trim(),'故事名称无效。');next.title=patch.title.trim();}
  if(patch.archived!==undefined){assert(typeof patch.archived==='boolean','封存必须是开关。');next.archived=patch.archived;}
  return next;
}
export function trashStory(session,now=Date.now()) {
  assert(timestamp(now),'回收时间无效。');const next=updateStoryMetadata(session,{});next.personal.trashedAt??=now;return next;
}
export function restoreStory(session) {const next=updateStoryMetadata(session,{});next.personal.trashedAt=null;return next;}
export function filterSessions(sessions,{query='',category='active',status,group='',sort='updated'}={}) {
  category=status||category;const terms=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return sessions.filter(session=>{
    const branch=activeBranch(session),personal=session.personal||{},trashed=personal.trashedAt!=null,ended=!!branch?.turns?.at(-1)?.ended;
    if(category==='trash'?!trashed:trashed)return false;
    if(category==='active'&&(session.archived||ended))return false;
    if(['ended','completed'].includes(category)&&(!ended||session.archived))return false;
    if(category==='archived'&&!session.archived)return false;
    if(category==='pinned'&&!personal.pinned)return false;
    if(group&&personal.group!==group)return false;
    // Only this branch's public text and explicitly private library fields.
    const haystack=[session.title,personal.note,personal.group,branch?.opening,...(branch?.turns||[]).flatMap(turn=>[turn.input,turn.prose])].filter(Boolean).join('\n').toLocaleLowerCase();
    return terms.every(term=>haystack.includes(term));
  }).sort((a,b)=>Number(!!b.personal?.pinned)-Number(!!a.personal?.pinned)||(sort==='title'?a.title.localeCompare(b.title,'zh-CN'):sort==='created'?(b.createdAt||0)-(a.createdAt||0):(b.updatedAt||0)-(a.updatedAt||0)));
}
export const filterStories=filterSessions;

export function validatePersonalMetadata(data) {
  assert(Array.isArray(data?.sessions),'存档缺少故事。');
  for(const session of data.sessions) {
    if(session.personal!==undefined) {
      const p=session.personal;only(p,['pinned','note','group','trashedAt']);
      if(p.pinned!==undefined)assert(typeof p.pinned==='boolean','置顶格式无效。');
      if(p.note!==undefined)assert(text(p.note,8000),'备注格式无效。');
      if(p.group!==undefined)assert(text(p.group,200),'分组格式无效。');
      if(p.trashedAt!==undefined)assert(p.trashedAt===null||timestamp(p.trashedAt),'回收时间无效。');
    }
    for(const branch of session.branches||[])if(branch.personal!==undefined) {
      only(branch.personal,[...annotationLists,'objects','anchor','draftReferences','intent']);
      const p=ensurePersonal(branch),seen=new Set();
      for(const list of annotationLists) {
        assert(Array.isArray(p[list])&&p[list].length<=2000,'收藏或笔记数量无效。');
        for(const item of p[list]) {
          only(item,['id','reference','text','createdAt']);
          assert(safeId(item.id)&&!seen.has(item.id)&&text(item.text,8000)&&timestamp(item.createdAt),'收藏或笔记条目无效。');seen.add(item.id);
          inspectReference(branch,item.reference,{allowHistorical:true});
        }
      }
      assert(object(p.objects)&&Object.keys(p.objects).length<=2000,'关注对象数量无效。');
      for(const [id,value] of Object.entries(p.objects)){assert(safeId(id),'对象标识无效。');only(value,['followed','muted']);assert(typeof value.followed==='boolean'&&typeof value.muted==='boolean','对象提醒格式无效。');}
      if(p.anchor!==null)validateAnchor(branch,p.anchor);
      assert(Array.isArray(p.draftReferences)&&p.draftReferences.length<=20&&text(p.intent,8000),'草稿资料无效。');
      // Old quoted drafts survive polish, but validateReference must pass again before use.
      for(const reference of p.draftReferences)inspectReference(branch,reference,{allowHistorical:true});
    }
  }
  return data;
}
