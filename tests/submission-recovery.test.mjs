import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {BranchClient,mergeConfirmedBranch} from '../src/branch-client.js';
import {BranchLedger} from '../src/server-branch-ledger.mjs';
import {createSession} from '../src/core.js';
import {readerView,demoReadOnly,pendingRecord} from '../src/reading-ui.js';
import {richInteractionRequest} from '../src/rich-request.js';

// Exercise the app's actual submission/recovery orchestration, BranchClient
// journals and reader output; isolate only the network and browser shell.
const appSource=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const extract=(start,next)=>{
  const from=appSource.indexOf(start),to=appSource.indexOf(next,from);
  assert.ok(from>=0&&to>from,`app function boundary unavailable: ${start}`);
  return appSource.slice(from,to);
};
const orchestration=extract('function storyPreferences(','async function ensureLedger(')+extract('async function recoverStory(','async function editConfirmed(')+extract('function cancelRequest(','const dialogNavigation=')+extract('async function sendTurn(','function conflictPanel(');
const makeStory=(id,input)=>({id,title:id,mode:'real',activeBranch:'main',preferences:{},player:{},branches:[{id:'main',worldKey:'w@1',draft:input,opening:'雨落在窗外。',turns:[],initialState:{version:0,location:'屋檐下'}}]});
const scope=story=>({sessionId:story.id,branchId:story.activeBranch});

function fixture(existing){
  const a=existing?.a||makeStory('A','A 提交的长输入：请等店主回答，再把信交给他。');
  const b=existing?.b||makeStory('B','B 提交的输入：沿着小路走到桥边。');
  const storage=existing?.storage||(()=>{const values=new Map();return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};})();
  const stories=[a,b],requests=[],toasts=[];let active=a,latestHTML='',sequence=0;
  const branch=story=>story.branches.find(item=>item.id===story.activeBranch);
  const fields=new Map(stories.map(story=>[story.id,{value:branch(story).draft}]));
  let readReply=body=>({branch:structuredClone(branch(stories.find(story=>story.id===body.sessionId))),receipt:null});
  const client=new BranchClient(storage,async(path,options)=>{
    const body=JSON.parse(options.body);requests.push({path,body,signal:options.signal});
    if(path==='/api/generate')throw new TypeError('本机服务离线');
    assert.equal(path,'/api/branch/read');
    return new Response(JSON.stringify(await readReply(body,options.signal)),{headers:{'content-type':'application/json'}});
  });
  const context={AbortController,demoReadOnly,branchClient:client,sessionNow:()=>active,getBranch:branch,sessionWorld:()=>({id:'w',version:1,title:'雨天'}),currentState:story=>branch(story).turns.at(-1)?.state||branch(story).initialState,$:()=>fields.get(active.id),
    pending:null,assistantJob:null,recovering:false,recoveryJob:null,lastSubmission:null,retryRequest:null,readerError:'',readerNotice:'',readingPage:null,db:{settings:{}},modelConfig:{generativeUIEnabled:true},modelChecked:true,generativeUIEnabled:()=>context.modelConfig.generativeUIEnabled===true,
    dynamic:{busy:()=>false,cancel(){},cancelPrepare(){},hasPresentation:()=>false,route:async()=>({intentDecision:{kind:'story'}})},readerInputCommand:()=>null,richInteractionRequest:()=>null,gameQuery:()=>null,localCommand:()=>null,detectIntent:()=> 'action',
    interaction:{run:()=>false,selection:()=>null,hide(){}},experience:{references:()=>[]},repository:{hasExternalChange:()=>false},save:()=>true,gameActionForInput:()=>null,clone:structuredClone,uid:()=>`request-${++sequence}`,selectContext:()=>({}),narrativeForBranch:()=>null,
    ensureLedger:async()=>{},record(){},toast:message=>toasts.push(message),installConfirmed(story,confirmed){Object.assign(branch(story),mergeConfirmedBranch(branch(story),confirmed));}
  };
  const refresh=()=>{latestHTML=readerView({session:active,branch:branch(active),state:context.currentState(active),pending:[context.pending,context.lastSubmission].find(item=>item?.sid===active.id&&item?.bid===active.activeBranch)||null,busy:!!context.pending||context.recovering,error:context.readerError});};
  context.refreshReaderLive=refresh;context.render=refresh;
  vm.createContext(context);vm.runInContext(orchestration,context,{filename:'app-submission-orchestration.js'});
  return {a,b,storage,client,context,requests,toasts,html:()=>latestHTML,
    visit(story){active=story;context.readerError='';context.readerNotice='';},
    writeDraft(value){branch(active).draft=value;fields.get(active.id).value=value;},
    readWith(reply){readReply=reply;}
  };
}

async function failBoth(f){
  const inputA=f.a.branches[0].draft,inputB=f.b.branches[0].draft;
  await f.context.sendTurn();
  const journalA=f.client.journal(undefined,scope(f.a));
  assert.equal(f.a.branches[0].draft,'');
  f.writeDraft('A 另外写下的下一条草稿');
  f.visit(f.b);await f.context.sendTurn();
  const journalB=f.client.journal(undefined,scope(f.b));
  assert.notEqual(journalA.requestId,journalB.requestId);
  assert.equal(journalA.body.input,inputA);assert.equal(journalB.body.input,inputB);
  return {inputA,inputB,journalA,journalB};
}

test('new submissions omit retired overrides while recovered retries preserve their original request body',async()=>{
 const f=fixture();
 const preferences={perspective:'第一人称',length:'舒展',participation:'observe',boundaries:'保留重大决定',availableMinutes:'20'};
 f.a.preferences={...preferences,style:'细腻克制',pace:'从容'};
 await f.context.sendTurn();
 assert.deepEqual(f.requests.at(-1).body.preferences,preferences);
 const journal=f.client.journal(undefined,scope(f.a));
 journal.body.preferences={...preferences,style:'明快简洁',pace:'紧凑'};
 f.client.journal(journal);
 await f.context.recoverStory();
 await f.context.sendTurn('retry');
 assert.equal(f.requests.at(-1).body.requestId,journal.requestId);
 assert.deepEqual(f.requests.at(-1).body,journal.body);
 assert.deepEqual(f.client.journal(undefined,scope(f.a)).body,journal.body);
});

test('a committed legacy request survives offline recovery and replays the same persisted receipt',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'legacy-style-replay-'));
 t.after(async()=>{assert.ok(directory.startsWith(join(tmpdir(),'legacy-style-replay-')));await rm(directory,{recursive:true,force:true});});
 const world={id:'replay-world',version:1,title:'雨天',location:'门前',opening:'你来到门前。',identity:'旅人',rules:[],characters:[],narrative:{style:'冷峻幽默',pace:'急缓交替'}};
 const session=createSession(world,{},'real'),ledger=new BranchLedger(directory),owner='style-replay-owner';
 const preferences={perspective:'第一人称',length:'简短',style:'细腻克制',pace:'从容'};
 const original={...scope(session),requestId:'legacy-committed-request',baseVersion:0,input:'推开门',preferences};
 await ledger.register(owner,{session,worlds:[world]});
 let calls=0;
 const generate=async body=>{calls++;assert.deepEqual(body.preferences,{perspective:'第一人称',length:'简短'});return {requestId:body.requestId,baseVersion:body.state.version,prose:'门开了。',events:[{type:'fact',value:'门已打开',visibility:'player'}]};};
 const committed=await ledger.generate(owner,original,generate,new AbortController().signal);
 const f=fixture({a:session});
 f.client.journal({...scope(session),requestId:original.requestId,body:structuredClone(original)});
 f.readWith(()=>{throw new TypeError('恢复查询暂时离线');});
 await f.context.recoverStory();
 await f.context.sendTurn('retry');
 const retried=f.requests.at(-1);
 assert.equal(retried.path,'/api/generate');
 const replay=await ledger.generate(owner,retried.body,generate,new AbortController().signal);
 assert.deepEqual(replay,committed);
 assert.deepEqual(retried.body,original);
 assert.equal(calls,1);
});

test('A failure then B failure restores A input and request identity while keeping both next drafts independent',async()=>{
  const f=fixture(),{inputA,inputB,journalA,journalB}=await failBoth(f);
  f.writeDraft('B 另外写下的下一条草稿');
  f.visit(f.a);await f.context.recoverStory();
  assert.equal(f.context.lastSubmission.input,inputA);
  assert.equal(f.context.retryRequest.body.requestId,journalA.requestId);
  assert.equal(f.requests.at(-1).body.requestId,journalA.requestId);
  assert.ok(f.html().includes(inputA));assert.ok(!f.html().includes(inputB));
  assert.match(f.html(),/data-action="retry-turn"/);
  assert.equal(f.a.branches[0].draft,'A 另外写下的下一条草稿');
  assert.equal(f.b.branches[0].draft,'B 另外写下的下一条草稿');
  assert.deepEqual(f.client.journal(undefined,scope(f.b)),journalB);
});

test('stopping recovery releases the composer while preserving the pending input and next draft',async()=>{
 const f=fixture(),input=f.a.branches[0].draft;await f.context.sendTurn();
 const journal=f.client.journal(undefined,scope(f.a));f.writeDraft('下一条还没发送的草稿');
 let complete;f.readWith(()=>new Promise(resolve=>{complete=resolve;}));
 const recovery=f.context.recoverStory(true),request=f.requests.at(-1);
 f.context.cancelRequest(true);f.context.refreshReaderLive();
 assert.equal(f.context.recovering,false);assert.equal(request.signal?.aborted,true);
 assert.deepEqual(f.client.journal(undefined,scope(f.a)),journal);
 assert.equal(f.a.branches[0].draft,'下一条还没发送的草稿');assert.ok(f.html().includes(input));
 assert.match(f.html(),/data-action="retry-turn"/);
 complete({branch:structuredClone(f.a.branches[0]),receipt:{}});await recovery;
 assert.deepEqual(f.client.journal(undefined,scope(f.a)),journal,'a cancelled late receipt must not change recovery state');
});

test('another story starts its own recovery and a late prior response cannot release its lock',async()=>{
 const f=fixture(),replies=new Map();f.readWith(body=>new Promise(resolve=>replies.set(body.sessionId,resolve)));
 const first=f.context.recoverStory(true),firstRequest=f.requests.at(-1);
 f.visit(f.b);f.context.render();const second=f.context.recoverStory(true);
 assert.equal(f.requests.length,2);assert.equal(firstRequest.signal.aborted,true);
 replies.get('A')({branch:structuredClone(f.a.branches[0]),receipt:null});await first;
 assert.equal(f.context.recovering,true);assert.match(f.html(),/data-story-blocked="true"/);
 replies.get('B')({branch:structuredClone(f.b.branches[0]),receipt:null});await second;
 assert.equal(f.context.recovering,false);assert.match(f.html(),/data-story-blocked="false"/);
 assert.match(f.html(),/type="submit" aria-label="发送"/);
});

test('recovery completion refreshes the current reader even when the route changed without a replacement request',async()=>{
 const f=fixture();let complete;f.readWith(()=>new Promise(resolve=>{complete=resolve;}));
 const recovery=f.context.recoverStory(true);f.visit(f.b);f.context.render();
 complete({branch:structuredClone(f.a.branches[0]),receipt:null});await recovery;
 assert.equal(f.context.recovering,false);assert.match(f.html(),/data-story-blocked="false"/);
});

test('recovery timeout releases the reader and keeps the submission retryable',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture();await f.context.sendTurn();const journal=f.client.journal(undefined,scope(f.a));
 f.readWith((_body,signal)=>new Promise((resolve,reject)=>signal?.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 const recovery=f.context.recoverStory(true);t.mock.timers.tick(30000);
 await Promise.resolve();await Promise.resolve();await Promise.resolve();
 assert.equal(f.requests.at(-1).signal?.aborted,true,'a local read cannot hold the reader indefinitely');
 await recovery;assert.equal(f.context.recovering,false);assert.deepEqual(f.client.journal(undefined,scope(f.a)),journal);
 assert.match(f.html(),/data-action="retry-turn"/);assert.match(f.toasts.at(-1),/超时/);
});

for(const nextDraft of ['', '接下来我想问另一个问题'])test(`a newer confirmed version retires a stale request and preserves ${nextDraft?'both independent inputs':'the input for editing'}`,async()=>{
 const f=fixture(),original=f.a.branches[0].draft;await f.context.sendTurn();
 const oldJournal=f.client.journal(undefined,scope(f.a));f.writeDraft(nextDraft);
 const confirmed={...structuredClone(f.a.branches[0]),turns:[{id:'confirmed',input:'另一条已确认的行动',prose:'故事已经向前。',state:{version:1},events:[]}]};
 f.readWith(()=>({branch:confirmed,receipt:null}));await f.context.recoverStory();
 assert.equal(f.client.journal(undefined,scope(f.a)),null);assert.equal(f.context.retryRequest,null);
 assert.equal(f.context.lastSubmission,null);assert.equal(f.context.readerError,'');
 assert.equal(f.a.branches[0].draft,nextDraft||original);
 assert.equal(f.a.branches[0].recoveredSubmission.input,original);assert.match(f.context.readerNotice,/未执行|未提交|过期/);
 const recreated=fixture(f);await recreated.context.recoverStory(true);
 assert.equal(recreated.a.branches[0].recoveredSubmission.input,original);assert.ok(recreated.context.readerNotice.includes(original));
 await f.context.sendTurn();const request=f.requests.at(-1);
 assert.equal(request.path,'/api/generate');assert.equal(request.body.baseVersion,1);
 assert.notEqual(request.body.requestId,oldJournal.requestId);assert.equal(request.body.input,nextDraft||original);
});

test('after recreation, A recovery displays saved input before a remote reply and stays retryable offline',async()=>{
  const first=fixture(),{inputA,inputB,journalA,journalB}=await failBoth(first);
  const f=fixture(first);let rejectRead;
  f.readWith(()=>new Promise((resolve,reject)=>{rejectRead=reject;}));
  const recovering=f.context.recoverStory(true);
  assert.equal(f.context.recovering,true);
  assert.ok(f.html().includes(inputA),'local submission appears while remote recovery is still pending');
  assert.ok(!f.html().includes(inputB));
  assert.equal(f.context.retryRequest.body.requestId,journalA.requestId);
  rejectRead(new TypeError('本机服务离线'));await recovering;
  assert.equal(f.context.recovering,false);
  assert.ok(f.html().includes(inputA));assert.match(f.html(),/data-action="retry-turn"/);
  assert.equal(f.a.branches[0].draft,'A 另外写下的下一条草稿');
  assert.deepEqual(f.client.journal(undefined,scope(f.b)),journalB);
  await f.context.sendTurn('retry');
  const retried=f.requests.at(-1);
  assert.equal(retried.path,'/api/generate');assert.equal(retried.body.input,inputA);assert.equal(retried.body.requestId,journalA.requestId);
  assert.equal(f.a.branches[0].draft,'A 另外写下的下一条草稿');
});

test('clicking continue preserves an unsent draft even when it matches the generated continuation instruction',async()=>{
 const f=fixture(),draft='让当前场景自然继续。';f.writeDraft(draft);
 await f.context.sendTurn('continue');assert.equal(f.a.branches[0].draft,draft);
 assert.equal(f.client.journal(undefined,scope(f.a)).body.input,draft);
 f.writeDraft('失败后写下的新行动');const count=f.requests.length;
 await f.context.sendTurn();assert.equal(f.requests.length,count,'an unresolved real submission must be retried or recovered first');
 assert.equal(f.a.branches[0].draft,'失败后写下的新行动');
});

test('semantic follow-up edits bypass story generation including phrases the regex does not match',async()=>{
  for(const intent of ['把这个改成时间线','这个配色太淡了，帮我调深一点','这张图的文字再大一点']){
    const f=fixture();f.writeDraft(intent);let prepared=null;f.context.dynamic.hasPresentation=()=>true;f.context.dynamic.route=async text=>{
      prepared=text;return {intentDecision:{kind:'edit'},authoritativeBranch:{dynamic:{reason:'',definition:{id:'updated'}}}};
    };
    f.context.richInteractionRequest=richInteractionRequest;await f.context.sendTurn();
    assert.equal(prepared,intent);assert.equal(f.requests.length,0);assert.equal(f.a.branches[0].draft,'');
  }
});

test('disabled migration keeps explicit rich requests on legacy preparation without semantic routing',async()=>{
  const f=fixture(),intent='用表格比较路线';f.context.modelConfig.generativeUIEnabled=false;f.writeDraft(intent);let prepared;
  f.context.richInteractionRequest=richInteractionRequest;
  f.context.dynamic.route=()=>assert.fail('disabled migration cannot use semantic routing');
  f.context.dynamic.prepare=async(force,text)=>{assert.equal(force,true);prepared=text;return {authoritativeBranch:{dynamic:{reason:'',definition:{id:'legacy'}}}};};
  await f.context.sendTurn();assert.equal(prepared,intent);assert.equal(f.requests.length,0);assert.equal(f.a.branches[0].draft,'');
});

test('disabled migration sends ordinary story input directly even when a presentation exists',async()=>{
  const f=fixture();f.context.modelConfig.generativeUIEnabled=false;f.context.dynamic.hasPresentation=()=>true;
  f.context.dynamic.route=()=>assert.fail('ordinary story input must not enter the migration route');
  f.context.dynamic.prepare=()=>assert.fail('ordinary story input is not a display request');
  await f.context.sendTurn();assert.equal(f.requests.filter(request=>request.path==='/api/generate').length,1);
});

test('pending public configuration preserves an unmatched UI draft without story submission or queued duplicate sends',async()=>{
  const f=fixture(),input='这个配色太淡了，帮我调深一点';f.context.modelConfig={available:false};f.context.modelChecked=false;f.writeDraft(input);
  assert.equal(richInteractionRequest(input,{hasArtifact:false}),null,'this edit cannot rely on the legacy display regex');
  f.context.richInteractionRequest=richInteractionRequest;let routed=0;
  f.context.dynamic.route=async()=>{routed++;return {intentDecision:{kind:'edit'},authoritativeBranch:{dynamic:{reason:'',definition:{id:'updated'}}}};};
  await f.context.sendTurn();await f.context.sendTurn();
  assert.equal(f.requests.length,0);assert.equal(routed,0);assert.equal(f.a.branches[0].draft,input);assert.equal(f.client.journal(undefined,scope(f.a)),null);
  assert.equal(f.context.pending,null);assert.equal(f.context.lastSubmission,null);assert.equal(f.context.readerError,'');assert.match(f.toasts.at(-1),/配置.*草稿|草稿.*配置/);
  f.context.modelConfig={available:true,generativeUIEnabled:true};f.context.modelChecked=true;await Promise.resolve();assert.equal(routed,0,'readiness must not replay blocked submissions automatically');
  await f.context.sendTurn();assert.equal(routed,1);assert.equal(f.requests.length,0);assert.equal(f.a.branches[0].draft,'');
});

test('artifact and workbench getters observe asynchronous public configuration without pre-config generation',()=>{
  const artifactClient={},context={modelConfig:{available:false},modelChecked:false,pending:null,assistantJob:null,recovering:false,artifactClient,createDynamicControls:api=>api,download(){},repository:{storage:{}},ensureLedger(){},branchClient:{request(){}},installConfirmed(){},save(){},refreshReaderLive(){},toast(){}};
  vm.createContext(context);vm.runInContext(extract('const generativeUIEnabled=','let discoveryOrder=')+extract('const dynamic=createDynamicControls(','function mergeWorlds('),context);
  const controls=vm.runInContext('dynamic',context);
  assert.equal(controls.artifact,undefined);assert.equal(controls.workbench,false);assert.equal(controls.ready(),false);
  context.modelConfig={available:true,generativeUIEnabled:true};context.modelChecked=true;
  assert.equal(controls.artifact,artifactClient);assert.equal(controls.workbench,true);assert.equal(controls.ready(),true);
  context.modelConfig={available:true,generativeUIEnabled:false};assert.equal(controls.artifact,undefined);assert.equal(controls.workbench,false);
});

test('enabled migration routes ordinary natural story input even before the first artifact exists',async()=>{
  const f=fixture();let routed;f.context.dynamic.hasPresentation=()=>false;f.context.dynamic.route=async input=>{routed=input;return {intentDecision:{kind:'story'}};};
  const input=f.a.branches[0].draft;await f.context.sendTurn();assert.equal(routed,input);assert.equal(f.requests.filter(request=>request.path==='/api/generate').length,1);
});
test('mixed story and interface input preserves draft while semantic story input continues once',async()=>{
  const f=fixture(),intent='调整图表再去北路';f.writeDraft(intent);f.context.dynamic.hasPresentation=()=>true;
  f.context.dynamic.route=async()=>({intentDecision:{kind:'mixed',message:'是否同时前往北路？'}});
  await f.context.sendTurn();assert.equal(f.requests.length,0);assert.equal(f.a.branches[0].draft,intent);assert.match(f.toasts.at(-1),/北路/);
  f.context.dynamic.route=async()=>({intentDecision:{kind:'story'}});await f.context.sendTurn();assert.equal(f.requests.filter(r=>r.path==='/api/generate').length,1);
});
test('semantic creation is checked before any story submission when no artifact exists',async()=>{
 for(const intent of ['能帮我做个路线比较表吗？','我想要一个能调整数量的分配工具','帮我把这几条线索放到一张图里']){
   const f=fixture();f.writeDraft(intent);let routed;f.context.dynamic.route=async text=>{routed=text;return {intentDecision:{kind:'create'},authoritativeBranch:{dynamic:{reason:'',definition:{id:'new'}}}};};
   f.context.richInteractionRequest=richInteractionRequest;await f.context.sendTurn();assert.equal(routed,intent);assert.equal(f.requests.length,0);assert.equal(f.a.branches[0].draft,'');
 }
});

test('generation stage updates touch only pending output and never render or read saved story history',()=>{
 const s=makeStory('phase','下一条草稿'),host={innerHTML:''};
 Object.defineProperty(s.branches[0],'turns',{get(){assert.fail('phase updates must not read historical turns');}});
 const pending={sid:s.id,bid:s.activeBranch,input:'已提交的行动',status:'waiting',stage:'recording'};
 const context={sessionNow:()=>s,currentRoute:()=>({path:'story'}),getBranch:story=>story.branches[0],sessionWorld:()=>({}),$:()=>host,pending,lastSubmission:null,readerError:'',assistantJob:null,recovering:false,pendingRecord,demoReadOnly,reader:()=>assert.fail('phase updates must not render the complete reader')};
 vm.createContext(context);vm.runInContext(extract('function refreshReaderPending(','function refreshReaderLive('),context);
 context.refreshReaderPending();assert.match(host.innerHTML,/故事正在继续/);assert.match(host.innerHTML,/已提交的行动/);
 const waitingHTML=host.innerHTML;
 // A stage event must preserve the mounted animation and its keyboard stop control.
 host.querySelector=()=>({});
 Object.defineProperty(host,'innerHTML',{get:()=>waitingHTML,set(){assert.fail('stage updates must not remount the waiting visual');}});
 pending.stage='saving';context.refreshReaderPending();assert.equal(host.innerHTML,waitingHTML);assert.equal(s.branches[0].draft,'下一条草稿');
});

test('a clarification leaves the submitted text editable and permits the next reply',async()=>{
 const f=fixture(),input=f.a.branches[0].draft;
 f.context.branchClient.generate=async()=>{throw Object.assign(new Error('请说明给谁、几份。'),{code:'CLARIFY_ACTION'});};
 await f.context.sendTurn();
 assert.equal(f.a.branches[0].draft,input);
 assert.equal(f.context.readerError,'');
 assert.equal(f.context.lastSubmission,null);
 assert.equal(f.client.journal(undefined,scope(f.a)),null);
 assert.match(f.context.readerNotice,/给谁/);
 f.writeDraft('给阿青3份');let called=false;
 f.context.branchClient.generate=async()=>{called=true;throw new Error('another network failure');};
 await f.context.sendTurn();assert.equal(called,true);
});

test('clarification preserves writing entered while the first response was pending',async()=>{
 const f=fixture();let reject;
 f.context.branchClient.generate=()=>new Promise((_,r)=>{reject=r;});
 const job=f.context.sendTurn();await new Promise(r=>setImmediate(r));
 f.writeDraft('我已经写了下一条');reject(Object.assign(new Error('请补充数量'),{code:'CLARIFY_ACTION'}));await job;
 assert.equal(f.a.branches[0].draft,'我已经写了下一条');
 assert.equal(f.context.readerError,'');
});

for(const code of ['INVALID_MODEL_RESULT','INCONSISTENT_STORY','CONTEXT_TOO_LARGE'])for(const nextDraft of ['', '另一条尚未发送的行动'])test(`${code} preserves rejected input separately and permits a fresh edited submission ${nextDraft?'with a next draft':'after recreation'}`,async()=>{
 const f=fixture(),input=f.a.branches[0].draft,reason='模型结果被拒绝：'+code;let reject;
 f.context.branchClient.generate=()=>new Promise((_,r)=>{reject=r;});
 const job=f.context.sendTurn();await new Promise(r=>setImmediate(r));
 const journal=f.client.journal(undefined,scope(f.a));
 f.writeDraft(nextDraft);
 let saved=false;f.context.save=()=>{assert.ok(f.client.journal(undefined,scope(f.a)),'persist rejected input before clearing its journal');saved=true;return true;};
 reject(Object.assign(new Error(reason),{code}));await job;
 assert.equal(saved,true);assert.equal(f.client.journal(undefined,scope(f.a)),null);
 assert.equal(f.context.pending,null);assert.equal(f.context.retryRequest,null);assert.equal(f.context.lastSubmission,null);assert.equal(f.context.readerError,'');
 assert.equal(f.a.branches[0].recoveredSubmission.input,input);assert.equal(f.a.branches[0].draft,nextDraft||input);
 assert.ok(f.context.readerNotice.includes(reason));assert.match(f.context.readerNotice,/未写入/);
 assert.match(f.html(),/data-story-blocked="false"/);
 const recreated=fixture(f);await recreated.context.recoverStory(true);
 assert.ok(recreated.context.readerNotice.includes(input));assert.ok(recreated.context.readerNotice.includes(reason));assert.match(recreated.context.readerNotice,/未写入/);
 recreated.context.uid=()=> 'fresh-edited-request';
 recreated.writeDraft('编辑后的新行动');await recreated.context.sendTurn();
 const sent=recreated.requests.at(-1).body;assert.equal(sent.input,'编辑后的新行动');assert.notEqual(sent.requestId,journal.requestId);assert.equal(sent.baseVersion,journal.body.baseVersion);
});

test('a rejected result keeps its recovery journal and lock when preserving it cannot be saved',async()=>{
 const f=fixture();let reject;
 f.context.branchClient.generate=()=>new Promise((_,r)=>{reject=r;});
 const job=f.context.sendTurn();await new Promise(r=>setImmediate(r));
 const journal=f.client.journal(undefined,scope(f.a));f.writeDraft('期间写下的草稿');f.context.save=()=>false;
 reject(Object.assign(new Error('结果格式无效'),{code:'INVALID_MODEL_RESULT'}));await job;
 assert.deepEqual(f.client.journal(undefined,scope(f.a)),journal);assert.ok(f.context.retryRequest);assert.ok(f.context.lastSubmission);
 assert.equal(f.a.branches[0].draft,'期间写下的草稿');assert.match(f.html(),/data-story-blocked="true"/);
});

for(const code of [undefined,'INCOMPLETE_RESPONSE','TIMEOUT','MODEL_TIMEOUT','SERVER_ERROR','BRANCH_BUSY','AbortError'])test(`${code||'network failure'} retains uncertain submission identity and blocks replacement input`,async()=>{
 const f=fixture(),input=f.a.branches[0].draft;
 f.context.branchClient.generate=async()=>{throw Object.assign(new Error('请求结果尚不确定'),code==='AbortError'?{name:code}:{code});};
 await f.context.sendTurn();const journal=f.client.journal(undefined,scope(f.a));
 assert.ok(journal);assert.equal(f.context.lastSubmission.input,input);assert.equal(f.context.retryRequest.body.requestId,journal.requestId);
 f.writeDraft('不能冒险替换尚未确认的行动');await f.context.recoverStory();
 const count=f.requests.length;await f.context.sendTurn();assert.equal(f.requests.length,count);
 assert.deepEqual(f.client.journal(undefined,scope(f.a)),journal);assert.match(f.html(),/data-story-blocked="true"/);
});
