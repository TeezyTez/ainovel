import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSession,commitTurn} from '../src/core.js';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {DynamicInteractions} from '../src/server-dynamic.mjs';
import {ArtifactError} from '../src/artifacts/protocol.mjs';

async function fixture(t,{prepared=true}={}){
  const directory=await mkdtemp(join(tmpdir(),'elselife-prepare-lifecycle-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const world={id:'prepare-lifecycle',version:1,title:'雨中柜台',location:'柜台',identity:'旅人',rules:[],characters:[],opening:'你站在柜台前，门外正在下雨。'};
  const session=createSession(world,{},'real'),branch=session.branches[0],ledger=new BranchLedger(directory);
  await ledger.register('owner',{session,worlds:[world]});
  const definition={schemaVersion:1,id:'known-scene',revision:1,title:'眼前处境',summary:'公开描述',fields:[],steps:[],view:[{type:'cards',items:[{title:'柜台',body:'你站在柜台前。'}]}],actions:[]};
  const service=new DynamicInteractions(ledger,{}, {model:async(_config,kind)=>({value:kind==='prepare'?definition:{approved:true},metrics:{kind,durationMs:0}})});
  const body={sessionId:session.id,branchId:branch.id,baseVersion:0,intent:'整理当前处境'},signal=new AbortController().signal;
  const previous=prepared?(await service.prepare('owner',body,signal)).authoritativeBranch.dynamic:null;
  return {service,ledger,world,body,signal,previous,load:()=>ledger.load('owner',session.id)};
}
const reply=value=>({value,metrics:{kind:'prepare',durationMs:0}});

test('ledger lock preserves typed artifact conflicts for retry and recovery',async t=>{
  const f=await fixture(t,{prepared:false});
  const conflict=new ArtifactError('artifact_conflict','作品版本已改变。',409);
  await assert.rejects(f.service.locked('owner',f.body,async()=>{throw conflict;}),error=>error===conflict&&error.status===409);
  assert.equal(f.ledger.pending.size,0);
});

test('legacy preparation cannot activate unverified React and requests a supported repair',async t=>{
 const f=await fixture(t,{prepared:false});let calls=0;
 f.service.model=async(_config,_kind,ctx)=>{calls++;assert.deepEqual(ctx.renderers,['standard','interactive']);if(calls===1)return reply({schemaVersion:1,id:'unsafe-react',revision:1,title:'计数',summary:'本地试算',fields:[],steps:[],actions:[],view:[{type:'react',title:'计数',description:'本地试算',source:'export default function App(){return <button>1</button>}'}]});assert.match(ctx.validationIssue,/React/);return reply({decision:'none',reason:'当前无需其他界面。'});};
 const result=await f.service.prepare('owner',f.body,f.signal);
 assert.equal(calls,2);assert.equal(result.authoritativeBranch.dynamic.definition,null);assert.equal(result.authoritativeBranch.dynamic.reason,'');
});

test('first failed prepare remains retryable for the same automatic scope and intent',async t=>{
  const f=await fixture(t,{prepared:false});let calls=0;
  f.service.model=async()=>{calls++;if(calls===1)throw new Error('temporary failure');return reply({decision:'none',reason:'继续阅读即可。'});};
  const first=await f.service.prepare('owner',{...f.body,intent:''},f.signal);
  assert.ok(first.authoritativeBranch.dynamic.reason);
  const second=await f.service.prepare('owner',{...f.body,intent:''},f.signal);
  assert.equal(second.authoritativeBranch.dynamic.reason,'');
  assert.equal(second.authoritativeBranch.dynamic.decisionReason,'继续阅读即可。');
  assert.equal(calls,2);
});

test('keep preserves only the approved current definition and caches the new successful intent',async t=>{
  const f=await fixture(t);let calls=0;
  f.service.model=async()=>{calls++;return reply({decision:'keep',reason:'当前界面已经覆盖这个问题。'});};
  const body={...f.body,intent:'沿用当前整理'},result=await f.service.prepare('owner',body,f.signal);
  assert.deepEqual(result.authoritativeBranch.dynamic.definition,f.previous.definition);
  assert.equal(result.authoritativeBranch.dynamic.digest,f.previous.digest);
  assert.equal(result.authoritativeBranch.dynamic.reason,'');
  assert.equal(result.authoritativeBranch.dynamic.intent,'沿用当前整理');
  assert.equal(result.authoritativeBranch.dynamic.decisionReason,'当前界面已经覆盖这个问题。');
  await f.service.prepare('owner',body,f.signal);assert.equal(calls,1);
});

test('none clears the current approved presentation without advancing story state',async t=>{
  const f=await fixture(t);f.service.model=async()=>reply({decision:'none',reason:'普通阅读无需界面。'});
  const result=await f.service.prepare('owner',{...f.body,intent:'只读正文'},f.signal);
  assert.equal(result.authoritativeBranch.dynamic.definition,null);
  assert.equal(result.authoritativeBranch.dynamic.digest,null);
  assert.equal(result.authoritativeBranch.dynamic.reason,'');
  assert.equal(result.authoritativeBranch.dynamic.decisionReason,'普通阅读无需界面。');
  assert.equal(result.authoritativeBranch.turns.length,0);
});

test('invalid keep is retried without pending or fabricated approvals',async t=>{
  for(const kind of ['old-protocol','unapproved','tampered','wrong-scope','expired']){
    const f=await fixture(t),data=await f.load(),b=data.session.branches[0];
    if(kind==='old-protocol')b.dynamic.promptVersion='old';
    if(kind==='unapproved')delete data.dynamicApprovals;
    if(kind==='tampered')b.dynamic.definition.title='未经审核';
    if(kind==='wrong-scope')b.dynamic.definition.scope.sourceTurnId='elsewhere';
    if(kind==='expired')commitTurn(data.session,f.world,'继续',{requestId:'continue',baseVersion:0,prose:'雨仍在下。',events:[]},b.id);
    await f.ledger.save('owner',data);let calls=0,contexts=[];
    f.service.model=async(_config,phase,ctx)=>{assert.equal(phase,'prepare');contexts.push(structuredClone(ctx));calls++;return reply(calls===1?{decision:'keep',reason:'沿用'}:{decision:'none',reason:'没有可沿用的当前界面。'});};
    const result=await f.service.prepare('owner',{...f.body,baseVersion:kind==='expired'?1:0,intent:'恢复界面'},f.signal);
    assert.equal(result.authoritativeBranch.dynamic.reason,'',kind);
    assert.equal(result.authoritativeBranch.dynamic.definition,null,kind);
    assert.equal(calls,2,kind);
    assert.equal(contexts[0].pending,null,kind);
    assert.equal(contexts[0].previousPresentation.actions,undefined,kind);
    assert.equal(contexts[0].previousPresentation.view,undefined,kind);
    assert.deepEqual((await f.load()).dynamicApprovals,data.dynamicApprovals,kind);
  }
});

test('repeated invalid keep fails safely and remains retryable',async t=>{
  const f=await fixture(t,{prepared:false});let calls=0;f.service.model=async()=>{calls++;return reply({decision:'keep'});};
  const first=await f.service.prepare('owner',f.body,f.signal);
  assert.ok(first.authoritativeBranch.dynamic.reason);
  assert.equal(first.authoritativeBranch.dynamic.definition,null);
  assert.equal(calls,2);
  await f.service.prepare('owner',f.body,f.signal);assert.equal(calls,4);
  assert.equal((await f.load()).dynamicApprovals,undefined);
});

test('a matching intent never caches a tampered approved definition',async t=>{
  const f=await fixture(t),data=await f.load();
  data.session.branches[0].dynamic.definition.title='未经审核的标题';await f.ledger.save('owner',data);
  let calls=0;f.service.model=async()=>{calls++;return reply({decision:'none',reason:'重新检查后无需界面。'});};
  const result=await f.service.prepare('owner',f.body,f.signal);
  assert.equal(calls,1);
  assert.equal(result.authoritativeBranch.dynamic.definition,null);
  assert.equal(result.authoritativeBranch.dynamic.decisionReason,'重新检查后无需界面。');
});

test('prepare passes matching bounded UI state as untrusted presentation context',async t=>{
  const f=await fixture(t);let context;
  f.service.model=async(_config,_kind,ctx)=>{context=ctx;return reply({decision:'keep'});};
  const artifact={id:f.previous.definition.id,digest:f.previous.digest,state:{slider:35,nested:[true,null,'local']},error:'按钮未加载'};
  await f.service.prepare('owner',{...f.body,intent:'修复按钮',ui:{artifact,world:{secret:'CLIENT_WORLD'},facts:['CLIENT_FACT']}},f.signal);
  assert.deepEqual(context.uiArtifact.state,artifact.state);
  assert.equal(context.uiArtifact.error,'按钮未加载');
  assert.match(context.uiArtifact.trust,/不是.*事实.*授权/);
  assert.doesNotMatch(JSON.stringify(context),/CLIENT_WORLD|CLIENT_FACT/);
  assert.deepEqual((await f.load()).session.branches[0].initialState.facts,[]);
});

test('a matching UI error reaches preparation even when the intent is unchanged',async t=>{
  const f=await fixture(t);let context,calls=0;
  f.service.model=async(_config,_kind,ctx)=>{context=ctx;calls++;return reply({decision:'keep'});};
  const artifact={id:f.previous.definition.id,digest:f.previous.digest,state:{slider:35},error:'脚本异常'};
  await f.service.prepare('owner',{...f.body,ui:{artifact}},f.signal);
  assert.equal(calls,1);
  assert.equal(context.uiArtifact.error,'脚本异常');
});

test('state accepted by the runtime reaches a revised view without a tighter hidden server limit',async t=>{
  const f=await fixture(t);let context;
  const state={note:'本'.repeat(2100),selected:Array.from({length:110},(_,i)=>i)};
  f.service.model=async(_config,kind,ctx)=>{
    if(kind==='judge')return reply({approved:true});
    context=ctx;
    return reply({schemaVersion:1,id:'revised',revision:1,title:'继续试算',summary:'仅准备',fields:[],steps:[],actions:[],view:[{type:'interactive',title:'分配',description:'仅试算',html:'<button>调整</button>',css:'',script:'',initialState:ctx.uiArtifact?.state}]});
  };
  const artifact={id:f.previous.definition.id,digest:f.previous.digest,state,error:''};
  const result=await f.service.prepare('owner',{...f.body,intent:'调整当前界面',ui:{artifact}},f.signal);
  assert.deepEqual(context.uiArtifact?.state,state);
  assert.deepEqual(result.authoritativeBranch.dynamic.definition?.view[0].initialState,state);
  assert.equal(result.authoritativeBranch.turns.length,0);
});

test('prepare ignores stale, oversized and non-JSON UI artifact state',async t=>{
  const f=await fixture(t);let context;
  f.service.model=async(_config,_kind,ctx)=>{context=ctx;return reply({decision:'keep'});};
  const valid={id:f.previous.definition.id,digest:f.previous.digest,state:{slider:35},error:''};
  let deep={};for(let i=0;i<15;i++)deep={child:deep};
  const artifacts=[{...valid,digest:'stale'},{...valid,id:'other'},{...valid,state:{long:'x'.repeat(8001)}},{...valid,state:deep},{...valid,state:{x:NaN}},{...valid,state:{x:()=>1}},{...valid,state:JSON.parse('{"__proto__":{}}')},{...valid,state:{x:new Date()}},{...valid,state:[,1]},{...valid,state:Object.fromEntries(Array.from({length:500},(_,i)=>['k'+i,i]))}];
  for(const [i,artifact] of artifacts.entries()){
    await f.service.prepare('owner',{...f.body,intent:'修复'+i,ui:{artifact}},f.signal);
    assert.equal(context.uiArtifact,undefined,String(i));
  }
});

test('a rejected rule receives the actual review issue when it is repaired',async t=>{
 const f=await fixture(t,{prepared:false});let candidate=0,review=0,repairIssue='';
 f.service.model=async(_config,kind,ctx)=>{
   if(kind==='judge')return reply({approved:++review>1,reason:'试算结果必须标明未实际分发。'});
   if(++candidate>1)repairIssue=ctx.validationIssue;
   return reply({schemaVersion:1,id:'draft',revision:1,title:'试算',summary:'未实际分发',fields:[],steps:[],actions:[{id:'record',label:'记录',mode:'rule',targets:[],checks:[],effects:[],result:'你站在柜台前。',evidence:[f.world.opening]}],view:[{type:'text',text:'仅试算'}]});
 };
 const result=await f.service.prepare('owner',f.body,f.signal);
 assert.match(repairIssue,/试算结果必须标明未实际分发/);
 assert.equal(result.authoritativeBranch.dynamic.reason,'');assert.equal(candidate,2);
});

test('display, sandbox and attempt preparations return after one model call without review',async t=>{
 for(const kind of ['display','sandbox','attempt']){
  const f=await fixture(t,{prepared:false}),before=structuredClone((await f.load()).session.branches[0]);
  const candidate={schemaVersion:1,id:'fast-view',revision:1,title:'眼前处境',summary:'仅作参考',fields:[],steps:[],actions:[],view:[{type:'text',text:'你站在柜台前。'}]};
  if(kind==='sandbox')candidate.view=[{type:'interactive',title:'观察',description:'局部试算',html:'<button>试算</button>',css:'',script:'ui.setState({count:0});'}];
  if(kind==='attempt')candidate.actions=[{id:'ask',label:'询问',mode:'attempt',targets:[],checks:[],effects:[],result:'尝试询问',evidence:[f.world.opening]}];
  const calls=[];f.service.model=async(_config,phase)=>{calls.push(phase);return reply(phase==='prepare'?candidate:{approved:false,reason:'不应调用'});};
  const result=await f.service.prepare('owner',f.body,f.signal),saved=result.authoritativeBranch.dynamic;
  assert.equal(saved.definition?.id,'fast-view',kind);
  assert.equal(saved.reason,'',kind);assert.deepEqual(calls,['prepare'],kind);
  const data=await f.load();assert.deepEqual(data.session.branches[0].initialState,before.initialState,kind);assert.deepEqual(data.session.branches[0].turns,before.turns,kind);
  assert.equal(data.dynamicApprovals[saved.digest],true,kind);
  if(kind==='attempt')await assert.rejects(f.service.execute('owner',{sessionId:f.body.sessionId,branchId:f.body.branchId,requestId:'cannot-execute',definitionDigest:saved.digest,interactionId:saved.definition.id,revision:1,scope:saved.scope,actionId:'ask',targets:[],params:{}},f.signal),/不能直接宣布成功/);
  await f.service.prepare('owner',f.body,f.signal);assert.deepEqual(calls,['prepare'],kind+' cache');
 }
});

test('mixed actions and zero-effect rules still require model review without view or retry context',async t=>{
 for(const mixed of [false,true]){
  const f=await fixture(t),calls=[];
  const rule={id:'record',label:'记录',mode:'rule',targets:[],checks:[],effects:[],result:'你站在柜台前。',evidence:[f.world.opening]};
  const candidate={schemaVersion:1,id:'record-scene',revision:1,title:'记录处境',summary:'观察柜台',fields:[],steps:[],actions:mixed?[{...rule,id:'ask',mode:'attempt'},rule]:[rule],view:[{type:'text',text:'VIEW_SENTINEL'}]};
  f.service.model=async(_config,phase,ctx)=>{calls.push({phase,ctx:structuredClone(ctx)});return reply(phase==='prepare'?candidate:{approved:true});};
  const result=await f.service.prepare('owner',{...f.body,intent:'记录当前处境',ui:{artifact:{id:f.previous.definition.id,digest:f.previous.digest,state:{note:'LOCAL_DRAFT_SENTINEL'},error:''}}},f.signal);
  assert.equal(result.authoritativeBranch.dynamic.definition?.id,'record-scene');
  assert.deepEqual(calls.map(c=>c.phase),['prepare','judge']);
  const review=calls[1].ctx;
  assert.equal(review.definition.actions.length,1);assert.equal(review.definition.actions[0].mode,'rule');
  assert.deepEqual(review.definition.view,[]);
  for(const key of ['pending','invalidDefinition','validationIssue','uiArtifact','previousPresentation','reading'])assert.equal(review.publicContext[key],undefined,key);
  assert.doesNotMatch(JSON.stringify(review),/VIEW_SENTINEL|LOCAL_DRAFT_SENTINEL/);
  assert.ok(review.publicContext.recent.includes(f.world.opening));
 }
});

test('the fast path still repairs invalid scripts and never publishes invalid action modes or effects',async t=>{
 for(const fault of ['script','mode','effects']){
  const f=await fixture(t,{prepared:false}),calls=[];
  const candidate={schemaVersion:1,id:'invalid',revision:1,title:'处境',summary:'观察',fields:[],steps:[],actions:[],view:[{type:'text',text:'柜台'}]};
  if(fault==='script')candidate.view=[{type:'interactive',title:'处境',description:'观察',html:'<button>观察</button>',css:'',script:'const = ;'}];
  else candidate.actions=[{id:'ask',label:'询问',mode:fault==='mode'?'display':'attempt',targets:[],checks:[],effects:fault==='effects'?[{entityId:'missing',kind:'delta',value:1}]:[],result:'尝试询问',evidence:[f.world.opening]}];
  f.service.model=async(_config,phase,ctx)=>{calls.push({phase,issue:ctx.validationIssue});return reply(candidate);};
  const result=await f.service.prepare('owner',f.body,f.signal);
  assert.equal(result.authoritativeBranch.dynamic.definition,null,fault);assert.ok(result.authoritativeBranch.dynamic.reason,fault);
  assert.deepEqual(calls.map(c=>c.phase),['prepare','prepare'],fault);assert.ok(calls[1].issue,fault);
  assert.equal((await f.load()).dynamicApprovals,undefined,fault);
 }
});
