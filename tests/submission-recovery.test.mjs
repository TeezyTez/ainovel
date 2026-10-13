import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {BranchClient} from '../src/branch-client.js';
import {readerView,demoReadOnly,pendingRecord} from '../src/reading-ui.js';

// Exercise the app's actual submission/recovery orchestration, BranchClient
// journals and reader output; isolate only the network and browser shell.
const appSource=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const extract=(start,next)=>{
  const from=appSource.indexOf(start),to=appSource.indexOf(next,from);
  assert.ok(from>=0&&to>from,`app function boundary unavailable: ${start}`);
  return appSource.slice(from,to);
};
const orchestration=extract('async function recoverStory(','async function editConfirmed(')+extract('async function sendTurn(','function conflictPanel(');
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
    const body=JSON.parse(options.body);requests.push({path,body});
    if(path==='/api/generate')throw new TypeError('本机服务离线');
    assert.equal(path,'/api/branch/read');
    return new Response(JSON.stringify(await readReply(body)),{headers:{'content-type':'application/json'}});
  });
  const context={AbortController,demoReadOnly,branchClient:client,sessionNow:()=>active,getBranch:branch,sessionWorld:()=>({id:'w',version:1,title:'雨天'}),currentState:story=>branch(story).turns.at(-1)?.state||branch(story).initialState,$:()=>fields.get(active.id),
    pending:null,assistantJob:null,recovering:false,lastSubmission:null,retryRequest:null,readerError:'',readerNotice:'',readingPage:null,db:{settings:{}},
    dynamic:{busy:()=>false,cancelPrepare(){}},readerInputCommand:()=>null,richInteractionRequest:()=>null,gameQuery:()=>null,localCommand:()=>null,detectIntent:()=> 'action',
    interaction:{run:()=>false,selection:()=>null},experience:{references:()=>[]},repository:{hasExternalChange:()=>false},save:()=>true,gameActionForInput:()=>null,clone:structuredClone,uid:()=>`request-${++sequence}`,selectContext:()=>({}),narrativeForBranch:()=>null,
    ensureLedger:async()=>{},record(){},toast:message=>toasts.push(message),installConfirmed(){assert.fail('these scenarios never return a new committed state');}
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

test('generation stage updates touch only pending output and never render or read saved story history',()=>{
 const s=makeStory('phase','下一条草稿'),host={innerHTML:''};
 Object.defineProperty(s.branches[0],'turns',{get(){assert.fail('phase updates must not read historical turns');}});
 const pending={sid:s.id,bid:s.activeBranch,input:'已提交的行动',status:'waiting',stage:'checking'};
 const context={sessionNow:()=>s,currentRoute:()=>({path:'story'}),getBranch:story=>story.branches[0],sessionWorld:()=>({}),$:()=>host,pending,lastSubmission:null,readerError:'',assistantJob:null,recovering:false,pendingRecord,demoReadOnly,reader:()=>assert.fail('phase updates must not render the complete reader')};
 vm.createContext(context);vm.runInContext(extract('function refreshReaderPending(','function refreshReaderLive('),context);
 context.refreshReaderPending();assert.match(host.innerHTML,/正在核对情节/);assert.match(host.innerHTML,/已提交的行动/);
 pending.stage='saving';context.refreshReaderPending();assert.match(host.innerHTML,/正在保存/);assert.equal(s.branches[0].draft,'下一条草稿');
});
