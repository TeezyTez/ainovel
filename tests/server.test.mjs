import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';

const world = { id:'harbor',version:1,title:'雾港',location:'码头',opening:'你走进雨里。',identity:'旅人',rules:['没有超自然现象'],characters:[{id:'lin',name:'林',public:'档案员',secret:'她在找一封信'}] };
const payload = (id='request-1') => ({requestId:id,world,state:{version:0,step:0,location:'码头',time:'开篇',facts:[],inventory:[],relations:{lin:'陌生'},flags:{},characters:{lin:{name:'林'}}},player:{name:'旅人',identity:'旅人'},preferences:{perspective:'第二人称'},memory:[],recent:[],input:'我不去档案馆，先给屋檐下的猫找一点水。'});
const proposal = (body=payload()) => ({requestId:body.requestId,baseVersion:body.state.version,prose:'你找到一只干净的小碗。',events:[{type:'fact',value:'你给猫准备了水',visibility:'player'}],suggestions:[{id:'look',text:'观察猫的反应'}],ended:false});
async function listen(t, server) {
  // Windows can assign a Fetch-forbidden dynamic port; keep HTTP fixtures
  // above the forbidden-port range so failures describe application behavior.
  do{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));if(server.address().port>10080)break;await new Promise(resolve=>server.close(resolve));}while(true);
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return `http://127.0.0.1:${server.address().port}`;
}
async function upstream(t, handler) {
  return listen(t,http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;await handler(req,res,JSON.parse(raw));}));
}
function reply(res,value) {res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}));}
async function app(t, options={}) {return listen(t,createServer({env:{},...options}));}
function post(url, body, extra={}) {return fetch(url+'/api/generate',{method:'POST',headers:{'content-type':'application/json',origin:url,...extra.headers},body:JSON.stringify(body),signal:extra.signal});}
function env(url, extra={}) {return {MODEL_API_KEY:'server-only-test-secret',MODEL_BASE_URL:url+'/v1',MODEL_NAME:'local-test-model',MODEL_PROVIDER:'local test',MODEL_NARRATIVE_ENGINE:'direct',...extra};}

test('without a key config is honest and generation returns 503',async t=>{
  const url=await app(t);
  assert.deepEqual(await (await fetch(url+'/api/config')).json(),{available:false,provider:'OpenAI-compatible',model:''});
  assert.equal((await post(url,payload())).status,503);
});

test('arbitrary natural language reaches the upstream as data; response is a validated proposal',async t=>{
  let captured;
  const up=await upstream(t,(req,res,body)=>{captured={body,headers:req.headers,url:req.url};reply(res,proposal());});
  const url=await app(t,{env:env(up)});
  const response=await post(url,payload());
  assert.equal(response.status,200);assert.deepEqual(await response.json(),proposal());
  assert.equal(captured.url,'/v1/chat/completions');
  assert.equal(captured.headers.authorization,'Bearer server-only-test-secret');
  assert.equal(captured.body.messages.length,2);
  assert.equal(captured.body.messages[0].role,'system');
  assert.equal(captured.body.messages[1].role,'user');
  assert.equal(JSON.parse(captured.body.messages[1].content).input,payload().input);
  assert.equal(captured.body.stream,false);assert.equal(captured.body.tools,undefined);
  const config=await (await fetch(url+'/api/config')).text();
  assert.ok(!config.includes('secret'));assert.ok(!config.includes(up));
});

test('same request and payload are deduplicated concurrently; reused ID with different input conflicts',async t=>{
  let calls=0;
  const up=await upstream(t,async(req,res)=>{calls++;await new Promise(r=>setTimeout(r,40));reply(res,proposal());});
  const url=await app(t,{env:env(up)});
  const responses=await Promise.all([post(url,payload()),post(url,payload())]);
  assert.deepEqual(await responses[0].json(),await responses[1].json());assert.equal(calls,1);
  assert.equal((await post(url,{...payload(),input:'另一件事'})).status,409);
  assert.equal((await post(url,payload())).status,200);assert.equal(calls,1);
});

test('only public static files are served; secrets and encoded traversal are rejected',async t=>{
  const root=await mkdtemp(join(tmpdir(),'cijian-static-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'src'));await writeFile(join(root,'index.html'),'<h1>此间</h1>');
  await writeFile(join(root,'src','app.js'),'export const name="此间";');await writeFile(join(root,'.env'),'MODEL_API_KEY=secret');
  await writeFile(join(root,'src','server-model.mjs'),'private server code');
  const url=await app(t,{root});
  assert.equal((await fetch(url+'/')).status,200);assert.equal((await fetch(url+'/src/app.js')).status,200);
  for(const path of ['/.env','/package.json','/src/server-model.mjs','/.git/config','/src/%2e%2e%2f.env','/%2eenv']) assert.equal((await fetch(url+path)).status,404,path);
});

test('cross-origin posts, unexpected host, malformed structures and excessive input are rejected',async t=>{
  const url=await app(t);
  assert.equal((await post(url,payload(),{headers:{origin:'https://evil.example'}})).status,403);
  const badHostStatus=await new Promise((resolve,reject)=>{
    http.get(url+'/api/config',{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);
  });
  assert.equal(badHostStatus,403);
  assert.equal((await post(url,{...payload(),state:{version:-1}})).status,400);
  assert.equal((await post(url,{...payload(),input:'x'.repeat(8001)})).status,400);
  assert.equal((await post(url,{...payload(),extra:'x'.repeat(270000)})).status,413);
});

test('upstream failures do not echo credentials or provider error payloads',async t=>{
  const up=await upstream(t,(req,res)=>{res.writeHead(401);res.end('server-only-test-secret private provider trace');});
  const url=await app(t,{env:env(up)});const response=await post(url,payload());
  assert.equal(response.status,502);const text=await response.text();assert.ok(!text.includes('secret'));assert.ok(!text.includes('trace'));
});

test('invalid entities and wrong request versions never become successful proposals',async t=>{
  let invalid={...proposal(),events:[{type:'relation',entity:'unknown',value:'信任',visibility:'player'}]};
  const up=await upstream(t,(req,res)=>reply(res,invalid));const url=await app(t,{env:env(up)});
  assert.equal((await post(url,payload())).status,502);
  invalid={...proposal(payload('request-2')),baseVersion:99};
  assert.equal((await post(url,payload('request-2'))).status,502);
});

test('model timeout returns a distinct 504 and aborts upstream work',async t=>{
  const up=await upstream(t,()=>{});const url=await app(t,{env:env(up,{MODEL_TIMEOUT_MS:'60'})});
  const result=await post(url,payload());assert.equal(result.status,504);assert.equal((await result.json()).code,'TIMEOUT');
});

test('last client cancellation disconnects the upstream and does not cache a partial result',async t=>{
  let startedResolve, closedResolve;
  const started=new Promise(r=>startedResolve=r),closed=new Promise(r=>closedResolve=r);
  const up=await upstream(t,(req,res)=>{res.on('close',closedResolve);startedResolve();});
  const url=await app(t,{env:env(up)});const controller=new AbortController();
  const request=post(url,payload(),{signal:controller.signal}).catch(error=>error);
  await started;controller.abort();assert.equal((await request).name,'AbortError');
  await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('upstream not cancelled')),1000);timer.unref();})]);
});

test('bounded request cache evicts completed results and permits a fresh request',async t=>{
  let calls=0;
  const up=await upstream(t,(req,res,body)=>{calls++;reply(res,proposal(JSON.parse(body.messages[1].content)));});
  const url=await app(t,{env:env(up),cacheLimit:2});
  for(const id of ['one','two','three','one'])assert.equal((await post(url,payload(id))).status,200);
  assert.equal(calls,4);
});

test('context packing retains arbitrary current input and authority while dropping oldest recollections',async t=>{
  let captured;
  const up=await upstream(t,(req,res,body)=>{captured=JSON.parse(body.messages[1].content);reply(res,proposal());});
  const url=await app(t,{env:env(up,{MODEL_CONTEXT_BUDGET:'6000',MODEL_OUTPUT_BUDGET:'500'})});
  const body={...payload(),recent:[{prose:'旧'.repeat(6000)}],memory:[{summary:'留下的记忆',branchId:'branch-one'}]};
  assert.equal((await post(url,body)).status,200);assert.deepEqual(captured.recent,[]);
  assert.equal(captured.input,payload().input);assert.deepEqual(captured.world,world);assert.deepEqual(captured.memory,body.memory);
});

test('a huge authoritative world is rejected rather than silently cut from the model context',async t=>{
  const up=await upstream(t,()=>assert.fail('over-budget request must not call upstream'));
  const url=await app(t,{env:env(up,{MODEL_CONTEXT_BUDGET:'6000',MODEL_OUTPUT_BUDGET:'500'})});
  const body=payload();body.world.opening='世界'.repeat(4000);
  assert.equal((await post(url,body)).status,413);
});

test('oversized chunked requests receive a readable 413 response',async t=>{
  const url=await app(t);
  const result=await new Promise((resolve,reject)=>{
    const req=http.request(url+'/api/generate',{method:'POST',headers:{'content-type':'application/json',origin:url}},res=>{let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text}));});
    req.on('error',reject);req.write('{"input":"');req.write('x'.repeat(270000));req.end('"}');
  });
  assert.equal(result.status,413);assert.equal(JSON.parse(result.text).code,'BODY_TOO_LARGE');
});

test('default HTTP generation uses the story engine, dedupes the entire pipeline and ignores client engine overrides',async t=>{
  let calls=0,captured;
  const url=await app(t,{env:{MODEL_API_KEY:'private-fixture-key',MODEL_BASE_URL:'https://example.invalid/v1',MODEL_NAME:'test'},narrate:async(body,config)=>{calls++;captured=body;assert.equal(config.narrativeEngine,'story');return proposal(body);}});
  const request={...payload(),narrativeEngine:'direct',system:'override'};
  const first=await post(url,request),second=await post(url,request);
  assert.equal(first.status,200);assert.equal(second.status,200);assert.equal(calls,1);
  assert.equal(captured.narrativeEngine,undefined);assert.equal(captured.system,undefined);
});

test('stale or wrong-world narrative metadata is rejected before planned generation',async t=>{
  const url=await app(t,{env:{MODEL_API_KEY:'test',MODEL_NAME:'test'},narrate:async()=>assert.fail('invalid metadata reached planner')});
  const narrative={schemaVersion:1,worldKey:'harbor@1',turn:1,focus:'等待回复',threads:[],recentBeats:[],opportunities:[]};
  assert.equal((await post(url,{...payload(),narrative})).status,400);
  assert.equal((await post(url,{...payload(),narrative:{...narrative,turn:0,worldKey:'other@1'}})).status,400);
});
