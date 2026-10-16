import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createSession} from '../src/core.js';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';
import {ArtifactService} from '../src/server-artifact-service.mjs';
const definition=title=>({schemaVersion:1,id:'routes',revision:1,title,summary:'比较当前路线',fields:[],steps:[],actions:[],view:[{type:'cards',items:[{title:'北路',body:'经过茶馆'}]}]});
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'artifact-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const world={id:'route-world',version:1,title:'两条路',opening:'北路经过茶馆，南路经过渡口。',location:'街口',identity:'旅人',rules:[],characters:[]};
 const session=createSession(world,{},'real'),ledger=new BranchLedger(join(dir,'branches'));await ledger.register('owner',{session,worlds:[world]});
 let result=definition('两条路线'),calls=0;
 const dynamic=new DynamicInteractions(ledger,{}, {model:async()=>{calls++;return {value:structuredClone(result),metrics:{kind:'prepare'}};}});
 const service=new ArtifactService({ledger,dynamic,directory:join(dir,'artifacts'),verify:async()=>{}});
 const body={sessionId:session.id,branchId:session.activeBranch,baseVersion:0,intent:'整理路线',requestId:'first',retry:true};
 return {service,body,ledger,session,dir,set:v=>result=v,calls:()=>calls,prepare:b=>service.start('owner',b??body).then(job=>job.done)};
}
test('artifact commits versions and durable UI state without story turns',async t=>{
 const f=await fixture(t),first=await f.prepare();assert.ok(first.artifact.head);
 const state=await f.service.saveState('owner',{...f.body,artifactId:first.artifact.artifactId,revisionId:first.artifact.head,expectedStateRevision:first.artifact.stateRevision,state:{quantity:4}});
 f.set(definition('路线卡片'));const second=await f.prepare({...f.body,requestId:'second'});
 assert.notEqual(second.artifact.head,first.artifact.head);assert.deepEqual(second.artifact.state,{quantity:4});assert.equal(second.authoritativeBranch.turns.length,0);
 const restored=await f.service.restore('owner',{...f.body,requestId:'restore',revisionId:first.artifact.head,expectedHead:second.artifact.head,expectedStateRevision:second.artifact.stateRevision});
 assert.equal(restored.authoritativeBranch.dynamic.definition.title,'两条路线');assert.deepEqual(restored.artifact.state,{quantity:4});
 assert.equal(state.artifact.stateRevision,first.artifact.stateRevision+1);
});
test('replayed prepare after restart returns committed result without calling model again',async t=>{
 const f=await fixture(t),first=await f.prepare(),calls=f.calls();
 f.service.jobs=new (f.service.jobs.constructor)();const replay=await f.prepare();assert.equal(replay.artifact.head,first.artifact.head);assert.equal(f.calls(),calls);
 await assert.rejects(f.prepare({...f.body,intent:'different'}),/请求/);
});
test('semantic edits and mixed inputs never advance the story',async t=>{
 const f=await fixture(t),first=await f.prepare();
 f.set({intentDecision:{kind:'edit',target:first.artifact.artifactId},output:definition('更深的颜色')});
 const edited=await f.prepare({...f.body,requestId:'edit',intent:'这个配色太淡了，帮我调深一点',inputRouting:true});assert.equal(edited.intentDecision.kind,'edit');assert.equal(edited.authoritativeBranch.turns.length,0);
 f.set({intentDecision:{kind:'mixed',message:'是否也要前往北路？'},output:null});
 const mixed=await f.prepare({...f.body,requestId:'mixed',inputRouting:true});assert.equal(mixed.intentDecision.kind,'mixed');assert.equal(mixed.artifact.head,edited.artifact.head);
});
test('replaying an old completed job or restore never projects its stale head',async t=>{
 const f=await fixture(t),first=await f.prepare();f.set(definition('第二版'));const second=await f.prepare({...f.body,requestId:'second'});
 const replay=await f.prepare();assert.equal(replay.artifact.head,second.artifact.head);assert.equal(replay.committedRevision,first.artifact.head);
 const request={...f.body,requestId:'restore',revisionId:first.artifact.head,expectedHead:second.artifact.head,expectedStateRevision:second.artifact.stateRevision};
 await f.service.restore('owner',request);f.set(definition('第三版'));const third=await f.prepare({...f.body,requestId:'third'});
 const restored=await f.service.restore('owner',request);assert.equal(restored.artifact.head,third.artifact.head);assert.equal(restored.authoritativeBranch.dynamic.definition.title,'第三版');
});
test('durable artifact commit survives failed ledger projection and recovers on read',async t=>{
 const f=await fixture(t),save=f.ledger.save.bind(f.ledger);let fail=true;
 f.ledger.save=async(...args)=>{if(fail){fail=false;throw new Error('disk projection failure');}return save(...args);};
 const result=await f.prepare();assert.equal(result.projectionPending,true);assert.ok(result.artifact.head);
 const recovered=await f.service.read('owner',f.body);assert.equal(recovered.artifact.head,result.artifact.head);assert.equal(recovered.authoritativeBranch.dynamic.definition.title,'两条路线');
});
test('export/import keeps versions and local state under fresh identities without story authority',async t=>{
 const f=await fixture(t),first=await f.prepare();f.set(definition('第二版'));const second=await f.prepare({...f.body,requestId:'second'});
 const archive=await f.service.export('owner',f.body);assert.equal(archive.records[0].revisions.length,2);assert.equal(archive.records[0].requests,undefined);
 const restored=await f.service.import('owner',{...f.body,requestId:'import',expectedHead:second.artifact.head,expectedStateRevision:second.artifact.stateRevision,archive});
 assert.equal(restored.artifact.revisions.length,4);assert.notEqual(restored.artifact.head,second.artifact.head);assert.equal(restored.authoritativeBranch.turns.length,0);assert.deepEqual(restored.authoritativeBranch.dynamic.definition.actions,[]);
 assert.notEqual(restored.authoritativeBranch.dynamic.definition.id,'routes');assert.notEqual(first.artifact.head,restored.artifact.head);
});

test('valid archives over 500k import and replay canonically without repeated candidate probes',async t=>{
 const f=await fixture(t),first=await f.prepare(),archive=await f.service.export('owner',f.body);
 const original=archive.records[0].revisions[0];
 archive.records[0].revisions=Array.from({length:24},(_,index)=>({...structuredClone(original),id:'rev_large_'+index,parentId:index?'rev_large_'+(index-1):null,definition:{...structuredClone(original.definition),title:'历史版本 '+index,view:[{type:'cards',items:Array.from({length:12},(_,item)=>({title:'路线 '+item,body:'x'.repeat(1900)}))}]}}));
 archive.records[0].head='rev_large_23';assert.ok(JSON.stringify(archive).length>500000);
 let probes=0;f.service.verify=async()=>{probes++;};
 const body={...f.body,requestId:'large-import',expectedHead:first.artifact.head,expectedStateRevision:first.artifact.stateRevision,archive};
 const result=await f.service.import('owner',body);
 assert.equal(result.artifact.revisions.length,25);assert.equal(probes,24);
 const reordered=Object.fromEntries(Object.entries(body).reverse());
 const replay=await f.service.import('owner',reordered);
 assert.equal(replay.artifact.head,result.artifact.head);assert.equal(replay.committedRevision,result.artifact.head);assert.equal(probes,24);
 const changed=structuredClone(body);changed.archive.records[0].revisions[0].reason='changed payload';
 await assert.rejects(f.service.import('owner',changed),error=>error.code==='REQUEST_CONFLICT');
 assert.equal(probes,24);
});
