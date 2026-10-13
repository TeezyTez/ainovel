import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSession,forkBranch} from '../src/core.js';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'elselife-prepare-concurrency-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const world={id:'prepare-concurrency',version:1,title:'雨中柜台',location:'柜台',identity:'旅人',rules:[],characters:[],opening:'你站在柜台前，门外正在下雨。'};
  const session=createSession(world,{},'real'),branch=session.branches[0],ledger=new BranchLedger(directory),requests=[];
  await ledger.register('owner',{session,worlds:[world]});
  const service=new DynamicInteractions(ledger,{}, {model:async(_config,kind,context)=>{const request={kind,context,...deferred()};requests.push(request);return request.promise;}});
  const body={sessionId:session.id,branchId:branch.id,baseVersion:0},signal=new AbortController().signal;
  async function started(count=1){for(let i=0;requests.length<count&&i<100;i++)await new Promise(r=>setTimeout(r,2));assert.equal(requests.length,count,'expected the model request to start');}
  const finish=(i,reason)=>requests[i].resolve({value:{needed:false,reason},metrics:{kind:'prepare',durationMs:0}});
  return {ledger,service,requests,body,signal,started,finish,load:()=>ledger.load('owner',session.id)};
}

test('a pending optional model request does not lock story input and cannot overwrite a committed turn',async t=>{
  const f=await fixture(t),pending=f.service.prepare('owner',f.body,f.signal);const settled=pending.then(value=>({value}),error=>({error}));await f.started();
  assert.equal((await f.service.input('owner',{...f.body,requestId:'walk',input:'走到门口'},f.signal)).handled,false);
  await f.ledger.generate('owner',{...f.body,requestId:'walk',input:'走到门口'},async()=>({requestId:'walk',baseVersion:0,prose:'你走到门口，雨水落在石阶上。',events:[]}),f.signal);
  f.finish(0,'旧场景无需界面。');const result=await settled;
  assert.equal(result.error?.code,'VERSION_CONFLICT');
  const branch=(await f.load()).session.branches[0];assert.equal(branch.turns.length,1);assert.equal(branch.turns[0].prose,'你走到门口，雨水落在石阶上。');assert.equal(branch.dynamic,undefined);
});

test('a newer preparation wins even when the older model response finishes last',async t=>{
  const f=await fixture(t),first=f.service.prepare('owner',f.body,f.signal),firstSettled=first.then(value=>({value}),error=>({error}));await f.started();
  const latest=f.service.prepare('owner',{...f.body,retry:true,intent:'只比较路线'},f.signal),latestSettled=latest.then(value=>({value}),error=>({error}));await f.started(2);
  f.finish(1,'路线尚无可靠差异。');assert.equal((await latestSettled).value?.authoritativeBranch.dynamic.intent,'只比较路线');
  f.finish(0,'过时决定');assert.equal((await firstSettled).error?.code,'PREPARATION_SUPERSEDED');
  assert.equal((await f.load()).session.branches[0].dynamic.decisionReason,'路线尚无可靠差异。');
});

test('cancellation after a model ignores abort never persists a presentation',async t=>{
  const f=await fixture(t),controller=new AbortController(),pending=f.service.prepare('owner',f.body,controller.signal),settled=pending.then(value=>({value}),error=>({error}));await f.started();
  controller.abort();f.finish(0,'被取消的结果');assert.equal((await settled).error?.code,'CANCELLED');assert.equal((await f.load()).session.branches[0].dynamic,undefined);
});

test('an aborted draft does not start an extra model review when the provider ignores abort',async t=>{
  const f=await fixture(t),controller=new AbortController(),pending=f.service.prepare('owner',f.body,controller.signal),settled=pending.then(value=>({value}),error=>({error}));await f.started();
  controller.abort();f.requests[0].resolve({value:{schemaVersion:1,id:'scene',revision:1,title:'雨声',summary:'',fields:[],steps:[],view:[{type:'text',text:'门外正在下雨。'}],actions:[]},metrics:{kind:'prepare',durationMs:0}});
  await new Promise(r=>setTimeout(r,20));assert.equal(f.requests.length,1,'cancelled preparation must not start its review');
  assert.equal((await settled).error?.code,'CANCELLED');
});

test('polishing the same turn invalidates a presentation generated from its previous prose',async t=>{
  const f=await fixture(t),first=await f.ledger.generate('owner',{...f.body,requestId:'walk',input:'走到门口'},async()=>({requestId:'walk',baseVersion:0,prose:'你走到门口，雨水落在石阶上。',events:[]}),f.signal);
  const pending=f.service.prepare('owner',{...f.body,baseVersion:1},f.signal),settled=pending.then(value=>({value}),error=>({error}));await f.started();
  await f.ledger.edit('owner',{...f.body,baseVersion:1,requestId:'polish',kind:'polish',turnId:first.committedTurn.id,expectedProse:first.committedTurn.prose,text:'门口的石阶湿漉漉的，你停下脚步。'});
  f.finish(0,'旧正文不需要额外整理。');assert.equal((await settled).error?.code,'VERSION_CONFLICT');
  const branch=(await f.load()).session.branches[0];assert.equal(branch.turns[0].prose,'门口的石阶湿漉漉的，你停下脚步。');assert.equal(branch.dynamic,undefined);
});

test('short commit reloads current local records instead of replacing the generation snapshot',async t=>{
  const f=await fixture(t),pending=f.service.prepare('owner',f.body,f.signal);await f.started();
  const current=await f.load();current.session.branches[0].draft='生成期间保存的草稿';current.session.saves.push({id:'new-save',name:'雨声',branchId:f.body.branchId,turnId:null,createdAt:Date.now()});await f.ledger.save('owner',current);
  f.finish(0,'只需继续阅读。');await pending;
  const saved=await f.load();assert.equal(saved.session.branches[0].draft,'生成期间保存的草稿');assert.equal(saved.session.saves.at(-1).id,'new-save');
});

test('background preparation never switches the authoritative active branch back to its source',async t=>{
  const f=await fixture(t),pending=f.service.prepare('owner',f.body,f.signal);await f.started();
  const current=await f.load(),other=forkBranch(current.session,null,'另一条路');await f.ledger.save('owner',current);
  f.finish(0,'旧分支只需继续阅读。');await pending;
  const saved=await f.load();assert.equal(saved.session.activeBranch,other.id);assert.equal(saved.session.branches.find(b=>b.id===f.body.branchId).dynamic.decisionReason,'旧分支只需继续阅读。');
});
