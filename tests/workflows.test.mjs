import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.mjs';
import { modelConfig } from '../src/server-model.mjs';
import { assist, validateAssistRequest } from '../src/server-workflows.mjs';

const world={id:'harbor',version:1,title:'雾港',location:'码头',opening:'你走进雨里。',identity:'旅人',rules:['没有超自然现象'],characters:[{id:'lin',name:'林',public:'档案员',secret:'SECRET-NPC',goal:'SECRET-GOAL'}],mystery:{truth:'SECRET-TRUTH'}};
const payload=(kind='ask',requestId='assist-1')=>({requestId,kind,world,state:{version:0,step:0,location:'码头',time:'开篇',facts:['公开事实'],inventory:[],relations:{lin:'陌生'},flags:{'harbor:hidden':'SECRET-FLAG'},characters:{lin:{name:'林',secret:'SECRET-STATE'}},hiddenEvents:[{type:'fact',value:'SECRET-EVENT',visibility:'hidden'}]},player:{name:'旅人',identity:'旅人'},preferences:{},memory:[{sourceTurn:'old',branchId:'branch',summary:'公开回忆',facts:['公开事实']},{summary:'SECRET-MEMORY',visibility:'hidden'}],recent:[{id:'old',input:'你好',prose:'公开正文',events:[{type:'fact',value:'SECRET-RECENT',visibility:'hidden'}]}],input:'如果我问她这封信，会发生什么？'});
const proposal=body=>({requestId:body.requestId,baseVersion:body.state.version,prose:'雨仍在下，你没有交出信。',events:[],suggestions:[],ended:false});
async function listen(t,server){
  // Some Windows dynamic-port ranges include Fetch's forbidden ports (up to
  // 10080). A forbidden upstream port looks like a provider 502, not a timeout.
  do{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));if(server.address().port>10080)break;await new Promise(resolve=>server.close(resolve));}while(true);
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));return `http://127.0.0.1:${server.address().port}`;
}
async function setup(t,handler,extra={}){const upstream=await listen(t,http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const data=JSON.parse(raw);const result=await handler(JSON.parse(data.messages[1].content),data,res);if(result!==undefined){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]}));}}));return listen(t,createServer({env:{MODEL_API_KEY:'private-token',MODEL_NAME:'test',MODEL_BASE_URL:upstream,MODEL_NARRATIVE_ENGINE:'direct',...extra}}));}
const post=(url,body,path='/api/assist',signal)=>fetch(url+path,{method:'POST',headers:{'content-type':'application/json',origin:url},body:JSON.stringify(body),signal});

test('ask and phrase receive public context only and return text without state events',async t=>{
  const url=await setup(t,(body,data)=>{assert.ok(!data.messages[1].content.includes('SECRET-'));assert.deepEqual(body.world.characters,[]);assert.equal(body.state.facts[0],'公开事实');assert.ok(!data.tools);return {requestId:body.requestId,kind:body.kind,text:'她可能回答，也可能拒绝；这还没有发生。',events:[{type:'fact',value:'不应提交'}]};});
  for(const kind of ['ask','phrase']){const response=await post(url,payload(kind));assert.equal(response.status,200);assert.deepEqual(Object.keys(await response.json()).sort(),['kind','requestId','text']);}
});

test('world drafting sets server identity and validates playable generated content',async t=>{
  let valid=true;const url=await setup(t,body=>({requestId:body.requestId,kind:'world',world:{...world,title:valid?'雨天茶铺':'',identity:'新来的茶铺帮手',description:'雨天经营茶铺',narrative:{perspective:'第二人称',length:'适中',pace:'从容',style:'日常'},experience:{promise:'慢慢照顾客人',premise:'第一天来帮忙',pressure:'不赶时间',participation:'观察或照顾客人',possibilities:['沏茶','聊几句'],closure:'打烊时收束'},custom:false,demoCompatible:true,version:999}}));
  const response=await post(url,{requestId:'draft',kind:'world',seed:'我想开一家雨天茶铺'});assert.equal(response.status,200);const result=await response.json();assert.notEqual(result.world.id,world.id);assert.equal(result.world.version,1);assert.equal(result.world.custom,true);assert.equal(result.world.demoCompatible,false);assert.equal(result.world.seed,'我想开一家雨天茶铺');assert.equal(result.world.narrative.style,'日常');assert.equal(result.world.experience.closure,'打烊时收束');assert.deepEqual(result.world.experience.possibilities,['沏茶','聊几句']);
  valid=false;assert.equal((await post(url,{requestId:'bad-draft',kind:'world',seed:'茶铺'})).status,502);
});

test('polish returns prose only and keeps submitted target immutable',async t=>{
  const url=await setup(t,body=>({requestId:body.requestId,kind:'polish',text:'雨丝沿檐口落下。',events:[{type:'item-add',value:'财宝',visibility:'player'}]}));
  const body={...payload('polish'),target:{id:'last',input:'等雨停',...proposal(payload()),events:[]}};const before=structuredClone(body);const response=await post(url,body);assert.equal(response.status,200);const result=await response.json();assert.equal(result.text,'雨丝沿檐口落下。');assert.equal(result.events,undefined);assert.deepEqual(body,before);
});

test('repair validates its proposal against before-state and allows insufficient evidence',async t=>{
  let mode='valid';const url=await setup(t,body=>({requestId:body.requestId,kind:'repair',text:'原文把未交出的信写成了已经交出。',proposal:mode==='none'?null:{...proposal(body),...(mode==='bad'?{baseVersion:1}:{})}}));
  const body={...payload('repair'),input:'我没有把信交出去',target:{id:'last',input:'看看信封',...proposal(payload()),events:[{type:'item-remove',value:'信',visibility:'player'}]}};
  assert.equal((await post(url,body)).status,200);mode='bad';assert.equal((await post(url,{...body,requestId:'bad'})).status,502);mode='none';const result=await (await post(url,{...body,requestId:'none'})).json();assert.equal(result.proposal,null);
});

test('assistance dedupes by kind and request ID while generation has a separate namespace',async t=>{
  let calls=0;const url=await setup(t,async body=>{calls++;await new Promise(r=>setTimeout(r,20));return body.kind?{requestId:body.requestId,kind:body.kind,text:'尚未行动。'}:proposal(body);});
  const same=await Promise.all([post(url,payload()),post(url,payload())]);assert.equal(same[0].status,200);assert.deepEqual(await same[0].json(),await same[1].json());assert.equal(calls,1);
  assert.equal((await post(url,{...payload(),input:'另一问题'})).status,409);
  assert.equal((await post(url,payload('phrase'))).status,200);
  const generate=payload();delete generate.kind;assert.equal((await post(url,generate,'/api/generate')).status,200);assert.equal(calls,3);
});

test('assistance inherits origin, size, validation, and timeout boundaries',async t=>{
  const url=await setup(t,()=>undefined,{MODEL_TIMEOUT_MS:'60'});
  assert.equal((await post(url,{requestId:'empty',kind:'world',seed:''})).status,400);
  assert.equal((await post(url,{...payload(),kind:'tools'})).status,400);
  assert.equal((await post(url,{...payload(),extra:'x'.repeat(270000)})).status,413);
  assert.equal((await fetch(url+'/api/assist',{method:'POST',headers:{'content-type':'application/json',origin:'https://evil.example'},body:JSON.stringify(payload())})).status,403);
  const result=await post(url,payload()),resultBody=await result.json();assert.equal(result.status,504,JSON.stringify(resultBody));assert.equal(resultBody.code,'TIMEOUT');
});

test('public projection excludes nested private extensions and all flag events',async t=>{
  let captured;const url=await setup(t,body=>{captured=JSON.stringify(body);return {requestId:body.requestId,kind:body.kind,text:'公开回答'};});
  const body=payload();body.memory.push({summary:{secret:'SECRET-NESTED'},facts:[{secret:'SECRET-FACT'}]});body.recent[0].events.push({type:'flag',entity:'harbor:secret',value:'SECRET-FLAG-RECENT',visibility:'player'});body.preferences.style={secret:'SECRET-PREF'};
  assert.equal((await post(url,body)).status,200);assert.ok(!captured.includes('SECRET-'));
});

test('repair rejects malformed end state rather than coercing it into a valid proposal',async t=>{
  const url=await setup(t,body=>({requestId:body.requestId,kind:'repair',text:'修订',proposal:{...proposal(body),ended:'not-a-boolean'}}));
  const body={...payload('repair'),target:{id:'last',input:'等雨停',...proposal(payload())}};
  assert.equal((await post(url,body)).status,502);
});

test('Codex assistance supplies its own strict schema and continues disabling tools',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cijian-assist-test-')),path=join(dir,'cli.cjs');
  await writeFile(path,`const fs=require('node:fs');const args=process.argv.slice(2);let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));if(schema.properties.kind.enum[0]!=='ask'||schema.properties.events||!args.includes('shell_tool')||!args.includes('read-only'))process.exit(2);const body=JSON.parse(input);console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({requestId:body.requestId,kind:'ask',text:'还没有发生。'})}}));});`);
  t.after(async()=>{await unlink(path);await rmdir(dir);});
  const config={...modelConfig({MODEL_PROVIDER:'codex',CODEX_CLI_PATH:process.execPath,CODEX_AUTH_HOME:dir}),cliPrefix:[path]};
  const result=await assist(validateAssistRequest(payload()),config,new AbortController().signal);assert.equal(result.text,'还没有发生。');
});

test('cancelled assistance aborts provider work and a fresh retry can succeed',async t=>{
  let start,close,calls=0;const started=new Promise(resolve=>start=resolve),closed=new Promise(resolve=>close=resolve);
  const url=await setup(t,(body,data,res)=>{calls++;if(calls===1){res.once('close',close);start();return;}return {requestId:body.requestId,kind:body.kind,text:'重试成功'};});
  const controller=new AbortController();const pending=post(url,payload(),'/api/assist',controller.signal).catch(e=>e);await started;controller.abort();assert.equal((await pending).name,'AbortError');
  await Promise.race([closed,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('not aborted')),1000);timer.unref();})]);
  const response=await post(url,payload());assert.equal(response.status,200);assert.equal((await response.json()).text,'重试成功');
});
