import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalRepository,STORAGE_KEY} from '../src/storage.js';
import {PRESET_WORLDS} from '../src/worlds.js';
import {createSession,getBranch,currentState,commitTurn} from '../src/core.js';
import {demoGenerate,demoActions} from '../src/demo.js';
test('persisted full story recovers current branch state and input draft',()=>{const memory=new Map(),storage={getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},repo=new LocalRepository(storage);const db=repo.load(PRESET_WORLDS),w=db.worlds[0],s=createSession(w);db.sessions.push(s);let action=demoActions(w,currentState(s))[0];commitTurn(s,w,action.text,demoGenerate({world:w,state:currentState(s),input:action.text,requestId:'one'}));getBranch(s).draft='尚未发出的行动';repo.save(db);const restored=repo.load(PRESET_WORLDS);assert.deepEqual(restored.sessions,db.sessions);});
test('failed save reports failure and leaves previous committed storage untouched',()=>{let saved='old';const repo=new LocalRepository({getItem:()=>saved,setItem:()=>{throw new Error('QuotaExceededError')}});assert.throws(()=>repo.save({schemaVersion:1}),/保存失败/);assert.equal(saved,'old');});
test('invalid existing data fails reading rather than being silently reset',()=>{let writes=0;const repo=new LocalRepository({getItem:()=>'{bad json',setItem:()=>writes++});assert.throws(()=>repo.load(PRESET_WORLDS),/原始数据未被覆盖/);assert.equal(writes,0);});
test('two tabs reject stale writes and preserve both external data and local drafts',()=>{
 const memory=new Map(),storage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)},a=new LocalRepository(storage),b=new LocalRepository(storage);
 const left=a.load(PRESET_WORLDS),right=b.load(PRESET_WORLDS);left.sessions.push(createSession(left.worlds[0]));a.save(left);
 right.sessions.push(createSession(right.worlds[0]));getBranch(right.sessions[0]).draft='第二个标签页尚未提交的完整草稿';const local=structuredClone(right),stored=memory.get(STORAGE_KEY);
 assert.equal(b.hasExternalChange(),true);
 assert.throws(()=>b.save(right),error=>error.code==='STORAGE_CONFLICT');
 assert.equal(memory.get(STORAGE_KEY),stored);assert.deepEqual(right,local);
 assert.equal(b.readExternal().sessions[0].id,left.sessions[0].id);assert.equal(b.hasExternalChange(),true);
 const accepted=b.acceptExternal();assert.equal(accepted.sessions[0].id,left.sessions[0].id);assert.equal(b.hasExternalChange(),false);
 accepted.sessions[0].title='确认读取后编辑';b.save(accepted);assert.equal(a.hasExternalChange(),true);
 assert.throws(()=>a.save(left),error=>error.code==='STORAGE_CONFLICT');
});
test('failed write does not advance optimistic baseline; a later retry can succeed',()=>{
 let raw=null,fail=true;const repo=new LocalRepository({getItem:()=>raw,setItem:(k,v)=>{if(fail)throw new Error('quota');raw=v;}});
 const data=repo.load(PRESET_WORLDS);const before=structuredClone(data);assert.throws(()=>repo.save(data),/保存失败/);assert.deepEqual(data,before);assert.equal(repo.hasExternalChange(),false);fail=false;assert.equal(repo.save(data),true);assert.equal(repo.hasExternalChange(),false);
});
test('external corruption cannot be accepted or silently overwritten after failed load',()=>{
 let raw='{bad';const repo=new LocalRepository({getItem:()=>raw,setItem:(k,v)=>{raw=v;}});
 assert.throws(()=>repo.load(PRESET_WORLDS));assert.throws(()=>repo.save({schemaVersion:1}),/读取|原始/);assert.equal(raw,'{bad');
});
test('an existing empty storage string is corruption, not a new empty library',()=>{
 let raw='';const repo=new LocalRepository({getItem:()=>raw,setItem:(k,v)=>{raw=v;}});
 assert.throws(()=>repo.load(PRESET_WORLDS),/读取失败/);assert.throws(()=>repo.save({}),/原始数据/);assert.equal(raw,'');
});
