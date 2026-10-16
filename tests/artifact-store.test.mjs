import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm, writeFile, utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ArtifactStore} from '../src/artifacts/store.mjs';

const scope={owner:'reader',sessionId:'novel',branchId:'main'};
const definition={title:'分配',view:[{type:'text',text:'试算'}]};
const candidate=(extra={})=>({requestId:'req-1',requestHash:'hash-1',definition,expectedHead:null,expectedStateRevision:0,...extra});
const importedRecord=()=>({artifactId:'art_imported',head:'rev_imported_two',stateRevision:0,state:{count:0,enabled:false},revisions:[{id:'rev_imported_one',parentId:null,definition:{view:[{type:'interactive',initialState:{count:2}}]},contentHash:'0'.repeat(64),createdAt:'2026-10-15T00:00:00.000Z',reason:'imported first'},{id:'rev_imported_two',parentId:'rev_imported_one',definition:null,contentHash:'0'.repeat(64),createdAt:'2026-10-15T00:01:00.000Z',reason:'imported second'}]});
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'artifact-store-'));t.after(()=>rm(directory,{recursive:true,force:true}));return {directory,store:new ArtifactStore(directory)};}

test('artifact revisions and zero-like state survive restart with an atomic request receipt',async t=>{
  const {directory,store}=await fixture(t);
  assert.equal(await store.read(scope),null);
  const created=await store.commit(scope,candidate({state:{zero:0,no:false,nil:null,empty:[]}}));
  assert.ok(created.artifactId);assert.ok(created.head);assert.equal(created.stateRevision,1);
  assert.deepEqual(created.state,{zero:0,no:false,nil:null,empty:[]});
  assert.equal(created.revisions[0].parentId,null);
  assert.match(created.revisions[0].contentHash,/^[a-f0-9]{64}$/);
  const restarted=new ArtifactStore(directory);
  assert.deepEqual(await restarted.read(scope),created);
  assert.deepEqual(await restarted.commit(scope,candidate({state:{zero:0,no:false,nil:null,empty:[]}})),created);
  await assert.rejects(restarted.commit(scope,candidate({requestHash:'changed'})),error=>error.code==='request_conflict'&&error.status===409);
  assert.equal((await restarted.read(scope)).revisions.length,1);
});

test('concurrent state updates have one CAS winner even across store instances',async t=>{
  const {directory,store}=await fixture(t),created=await store.commit(scope,candidate());
  const results=await Promise.allSettled([store,new ArtifactStore(directory)].map((item,index)=>item.saveState(scope,{artifactId:created.artifactId,revisionId:created.head,expectedStateRevision:created.stateRevision,state:{quantity:index+7}})));
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.find(result=>result.status==='rejected').reason.code,'artifact_conflict');
  const record=await store.read(scope);assert.equal(record.stateRevision,2);assert.ok([7,8].includes(record.state.quantity));
  await assert.rejects(store.commit(scope,candidate({requestId:'req-2',requestHash:'hash-2',expectedHead:created.head,expectedStateRevision:created.stateRevision,state:{quantity:99}})),{code:'artifact_conflict'});
  assert.deepEqual((await store.read(scope)).state,record.state);
});

test('head CAS prevents two candidates replacing the same parent',async t=>{
  const {store}=await fixture(t),first=await store.commit(scope,candidate());
  const next={expectedHead:first.head,expectedStateRevision:first.stateRevision};
  const results=await Promise.allSettled([store.commit(scope,candidate({...next,requestId:'next-a',requestHash:'a'})),store.commit(scope,candidate({...next,requestId:'next-b',requestHash:'b'}))]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal((await store.history(scope)).length,2);
});

test('restore changes the presentation head and restores its saved state without losing revisions',async t=>{
  const {store}=await fixture(t),first=await store.commit(scope,candidate({state:{amount:3}}));
  await store.saveState(scope,{artifactId:first.artifactId,revisionId:first.head,expectedStateRevision:1,state:{amount:4}});
  const second=await store.commit(scope,candidate({requestId:'next',requestHash:'next',expectedHead:first.head,expectedStateRevision:2,definition:null,state:{amount:9}}));
  const restored=await store.restore(scope,{revisionId:first.head,expectedHead:second.head,expectedStateRevision:3,requestId:'restore-1'});
  assert.equal(restored.head,first.head);assert.equal(restored.artifactId,first.artifactId);
  assert.deepEqual(restored.state,{amount:4});assert.equal(restored.stateRevision,4);
  assert.equal(restored.revisions.length,2);assert.equal(restored.revisions[1].definition,null);
  assert.deepEqual(await store.restore(scope,{revisionId:first.head,expectedHead:second.head,expectedStateRevision:3,requestId:'restore-1'}),restored);
});

test('scope isolation and hashed filenames prevent cross-owner reads and path traversal',async t=>{
  const {store,directory}=await fixture(t),first=await store.commit(scope,candidate());
  for(const isolated of [{...scope,owner:'other'},{...scope,sessionId:'other'},{...scope,branchId:'other'}]){
    assert.equal(await store.read(isolated),null);
    await assert.rejects(store.saveState(isolated,{artifactId:first.artifactId,revisionId:first.head,expectedStateRevision:1,state:{}}),{code:'artifact_not_found'});
  }
  await store.commit({...scope,owner:'../../outside'},candidate());
  assert.ok((await readdir(directory)).every(name=>/^[a-f0-9]{64}\.json$/.test(name)));
  const manifest=JSON.parse(await readFile(join(directory,(await readdir(directory))[0]),'utf8'));
  assert.ok(manifest.head);
});

test('unsafe state or definition cannot mutate a durable record',async t=>{
  const {store}=await fixture(t),first=await store.commit(scope,candidate());
  for(const state of [JSON.parse('{"__proto__":{"admin":true}}'),{bad:Infinity},{bad:undefined},{bad:new Date()},Array(2),{text:'x'.repeat(6001)}]){
    await assert.rejects(store.saveState(scope,{artifactId:first.artifactId,revisionId:first.head,expectedStateRevision:1,state}));
    assert.deepEqual(await store.read(scope),first);
  }
  await assert.rejects(store.commit(scope,candidate({requestId:'bad',requestHash:'bad',expectedHead:first.head,expectedStateRevision:1,definition:JSON.parse('{"constructor":{}}')})));
  assert.deepEqual(await store.read(scope),first);
});

test('old-frame state cannot be applied to a newer revision',async t=>{
  const {store}=await fixture(t),first=await store.commit(scope,candidate());
  const second=await store.commit(scope,candidate({requestId:'next',requestHash:'next',expectedHead:first.head,expectedStateRevision:1}));
  await assert.rejects(store.saveState(scope,{artifactId:first.artifactId,revisionId:first.head,expectedStateRevision:second.stateRevision,state:{old:true}}),{code:'artifact_conflict'});
  assert.deepEqual(await store.read(scope),second);
});

test('reserved request IDs and explicitly undefined state are rejected before persistence',async t=>{
  const {store}=await fixture(t);
  for(const requestId of ['__proto__','constructor','prototype'])await assert.rejects(store.commit(scope,candidate({requestId})));
  await assert.rejects(store.commit(scope,candidate({state:undefined})));
  assert.equal(await store.read(scope),null);
});

test('null revisions retain their validated source scope for later recovery',async t=>{
  const {directory,store}=await fixture(t);
  const result=await store.commit(scope,candidate({definition:null,sourceScope:{sessionId:'novel',branchId:'main',storyVersion:4}}));
  assert.deepEqual((await new ArtifactStore(directory).read(scope)).revisions[0].sourceScope,{sessionId:'novel',branchId:'main',storyVersion:4});
  assert.equal(result.revisions[0].definition,null);
});

test('restart recovers an old empty lock left by a crash during lock creation',async t=>{
  const {directory,store}=await fixture(t),first=await store.commit(scope,candidate());
  const lock=join(directory,(await readdir(directory))[0]+'.lock');
  await writeFile(lock,'');const past=new Date(Date.now()-60000);await utimes(lock,past,past);
  const result=await new ArtifactStore(directory).saveState(scope,{artifactId:first.artifactId,revisionId:first.head,expectedStateRevision:1,state:{recovered:true}});
  assert.deepEqual(result.state,{recovered:true});
  assert.equal(result.stateRevision,2);
});

test('a candidate aborted while waiting for the transaction lock never commits',async t=>{
  const {store}=await fixture(t),first=await store.commit(scope,candidate());
  let unlock,entered;const held=new Promise(resolve=>{unlock=resolve;}),ready=new Promise(resolve=>{entered=resolve;});
  const holder=store.transaction(scope,async()=>{entered();await held;return {result:null};});await ready;
  const controller=new AbortController();
  const pending=store.commit(scope,candidate({requestId:'aborted',requestHash:'aborted',expectedHead:first.head,expectedStateRevision:1}),{signal:controller.signal});
  controller.abort();unlock();await holder;
  await assert.rejects(pending,{name:'AbortError'});
  assert.deepEqual(await store.read(scope),first);
});

test('cancellation after candidate preparation but before atomic rename leaves no revision or receipt',async t=>{
  const {store,directory}=await fixture(t),first=await store.commit(scope,candidate()),controller=new AbortController();
  const transaction=store.transaction.bind(store);
  store.transaction=(target,change,options)=>transaction(target,async manifest=>{const outcome=await change(manifest);controller.abort();return outcome;},options);
  await assert.rejects(store.commit(scope,candidate({requestId:'aborted',requestHash:'aborted',expectedHead:first.head,expectedStateRevision:1}),{signal:controller.signal}),{name:'AbortError'});
  assert.deepEqual(await store.read(scope),first);
  assert.ok((await readdir(directory)).every(name=>name.endsWith('.json')));
});

test('archive import appends isolated revisions and preserves existing history and artifact identity',async t=>{
  const {directory,store}=await fixture(t),old=await store.commit(scope,candidate({state:{old:true}})),record=importedRecord();
  const input={record,expectedHead:old.head,expectedStateRevision:1,requestId:'import-1',requestHash:'import-hash'};
  const result=await store.importArchive(scope,input);
  assert.equal(result.artifactId,old.artifactId);assert.equal(result.revisions.length,3);
  assert.deepEqual(result.revisions[0],old.revisions[0]);assert.equal(result.revisions[1].parentId,old.head);
  assert.equal(result.head,'rev_imported_two');assert.equal(result.stateRevision,2);assert.deepEqual(result.state,{count:0,enabled:false});
  assert.deepEqual(Object.keys(result.requests).sort(),['import-1','req-1']);
  assert.deepEqual(await new ArtifactStore(directory).importArchive(scope,input),result);
  await assert.rejects(store.importArchive(scope,{...input,requestHash:'changed'}),{code:'request_conflict'});
  const restored=await store.restore(scope,{revisionId:'rev_imported_one',expectedHead:result.head,expectedStateRevision:2,requestId:'restore-import'});
  assert.deepEqual(restored.state,{count:2});
});

test('an archive can seed an empty scope and stale import CAS cannot overwrite local state',async t=>{
  const {store}=await fixture(t),record=importedRecord();
  const created=await store.importArchive(scope,{record,expectedHead:null,expectedStateRevision:0,requestId:'seed',requestHash:'seed'});
  assert.equal(created.artifactId,'art_imported');assert.equal(created.stateRevision,1);
  const next=importedRecord();next.revisions[0].id='rev_different_one';next.revisions[1].id='rev_different_two';next.revisions[1].parentId='rev_different_one';next.head='rev_different_two';
  await store.saveState(scope,{artifactId:created.artifactId,revisionId:created.head,expectedStateRevision:1,state:{latest:7}});
  await assert.rejects(store.importArchive(scope,{record:next,expectedHead:created.head,expectedStateRevision:1,requestId:'stale',requestHash:'stale'}),{code:'artifact_conflict'});
  assert.deepEqual((await store.read(scope)).state,{latest:7});
});

test('archive imports reject foreign receipts, duplicate IDs, absent parents and more than 64 revisions atomically',async t=>{
  const {store}=await fixture(t),first=await store.commit(scope,candidate());
  const bad=[];let value=importedRecord();value.requests={foreign:{}};bad.push(value);
  value=importedRecord();value.head='rev_missing';bad.push(value);
  value=importedRecord();value.revisions[1].parentId='rev_missing';bad.push(value);
  value=importedRecord();value.revisions[1].id=value.revisions[0].id;value.head=value.revisions[0].id;bad.push(value);
  value=importedRecord();value.revisions=Array.from({length:65},(_,index)=>({...value.revisions[0],id:'rev_bulk_'+index,parentId:index?'rev_bulk_'+(index-1):null}));value.head='rev_bulk_64';bad.push(value);
  value=importedRecord();value.revisions[0].id=first.head;value.revisions[1].parentId=first.head;bad.push(value);
  for(const record of bad){await assert.rejects(store.importArchive(scope,{record,expectedHead:first.head,expectedStateRevision:1,requestId:'invalid-import',requestHash:'invalid'}));assert.deepEqual(await store.read(scope),first);}
});

test('archive append refuses to exceed retained revision capacity instead of discarding history',async t=>{
  const {store}=await fixture(t);let saved=null;
  for(let batch=0;batch<8;batch++){
    const record=importedRecord(),base=record.revisions[0];record.revisions=Array.from({length:64},(_,index)=>({...base,id:`rev_batch_${batch}_${index}`,parentId:index?`rev_batch_${batch}_${index-1}`:null}));record.head=`rev_batch_${batch}_63`;
    saved=await store.importArchive(scope,{record,expectedHead:saved?.head??null,expectedStateRevision:saved?.stateRevision??0,requestId:'batch-'+batch,requestHash:'batch-'+batch});
  }
  assert.equal(saved.revisions.length,512);
  await assert.rejects(store.importArchive(scope,{record:importedRecord(),expectedHead:saved.head,expectedStateRevision:saved.stateRevision,requestId:'overflow',requestHash:'overflow'}),{code:'artifact_storage_limit'});
  assert.deepEqual(await store.read(scope),saved);
});
