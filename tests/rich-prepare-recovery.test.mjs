import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSession} from '../src/core.js';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';

async function fixture(t){
  const directory=await mkdtemp(join(tmpdir(),'elselife-rich-recovery-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const world={id:'rich-recovery',version:1,title:'雨中柜台',location:'柜台',identity:'旅人',rules:[],characters:[],opening:'你站在柜台前，门外正在下雨。'};
  const session=createSession(world,{},'real'),branch=session.branches[0],ledger=new BranchLedger(directory);
  await ledger.register('owner',{session,worlds:[world]});
  const definition={schemaVersion:1,id:'known-scene',revision:1,title:'眼前处境',summary:'公开描述',fields:[],steps:[],view:[{type:'cards',items:[{title:'柜台',body:'你站在柜台前。'},{title:'天气',body:'门外正在下雨。'}]}],actions:[]};
  const service=new DynamicInteractions(ledger,{}, {model:async(_config,kind)=>({value:kind==='prepare'?definition:{approved:true},metrics:{kind,durationMs:0}})});
  const body={sessionId:session.id,branchId:branch.id,baseVersion:0,intent:'整理当前处境'},signal=new AbortController().signal;
  const first=await service.prepare('owner',body,signal);
  return {service,ledger,body,signal,previous:first.authoritativeBranch.dynamic,load:()=>ledger.load('owner',session.id)};
}

test('failed reformat preserves the approved current view and leaves the failed intent retryable',async t=>{
  const f=await fixture(t);let calls=0;
  f.service.model=async()=>{calls++;throw new Error('temporary model failure');};
  const body={...f.body,intent:'用时间线重新整理'},result=await f.service.prepare('owner',body,f.signal),saved=result.authoritativeBranch.dynamic;
  assert.deepEqual(saved.definition,f.previous.definition);
  assert.equal(saved.digest,f.previous.digest);
  assert.equal(saved.intent,'整理当前处境');
  assert.match(saved.reason,/暂未形成可靠结果/);
  assert.equal(result.authoritativeBranch.turns.length,0);
  await f.service.prepare('owner',body,f.signal);
  assert.equal(calls,2);
  assert.deepEqual((await f.load()).session.branches[0].dynamic.definition,f.previous.definition);
});

test('a deliberate no-interface decision clears the previous approved view',async t=>{
  const f=await fixture(t);
  f.service.model=async()=>({value:{needed:false,reason:'这段只需继续阅读。'},metrics:{kind:'prepare',durationMs:0}});
  const result=await f.service.prepare('owner',{...f.body,intent:'只听雨声'},f.signal),saved=result.authoritativeBranch.dynamic;
  assert.equal(saved.definition,null);assert.equal(saved.digest,null);assert.equal(saved.reason,'');
  assert.equal(saved.intent,'只听雨声');assert.equal(saved.decisionReason,'这段只需继续阅读。');
});

test('failed generation cannot restore an unapproved or differently scoped prior definition',async t=>{
  const f=await fixture(t),data=await f.load(),branch=data.session.branches[0],approved=data.dynamicApprovals;
  f.service.model=async()=>{throw new Error('temporary model failure');};
  delete data.dynamicApprovals;await f.ledger.save('owner',data);
  let result=await f.service.prepare('owner',{...f.body,intent:'重新绘制'},f.signal);
  assert.equal(result.authoritativeBranch.dynamic.definition,null);
  data.dynamicApprovals=approved;branch.dynamic=structuredClone(f.previous);branch.dynamic.scope.sourceTurnId='another-turn';
  await f.ledger.save('owner',data);
  result=await f.service.prepare('owner',{...f.body,intent:'重新绘制'},f.signal);
  assert.equal(result.authoritativeBranch.dynamic.definition,null);
  branch.dynamic=structuredClone(f.previous);branch.dynamic.definition.title='未审核的替换标题';
  await f.ledger.save('owner',data);
  result=await f.service.prepare('owner',{...f.body,intent:'重新绘制'},f.signal);
  assert.equal(result.authoritativeBranch.dynamic.definition,null);
});
