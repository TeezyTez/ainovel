// Explicit live acceptance probe; consumes model allowance and never writes browser saves.
import {writeFile} from 'node:fs/promises';
import {ADDITIONAL_WORLDS} from '../src/situations.js';
import {createSession,currentState,getBranch,commitTurn,clone} from '../src/core.js';
import {selectContext} from '../src/experience.js';
import assert from 'node:assert/strict';
const stage=process.argv[2]||'after';
assert.ok(['before','after'].includes(stage));
const url='http://127.0.0.1:4173',world=ADDITIONAL_WORLDS[0],session=createSession(world,{},'real'),results=[];
session.preferences.participation='act';
async function call(input,kind){
  const request={requestId:crypto.randomUUID(),world,state:clone(currentState(session)),player:session.player,preferences:session.preferences,...selectContext(getBranch(session),input),input,...(kind?{kind}:{})};
  const started=Date.now();
  const response=await fetch(url+(kind?'/api/assist':'/api/generate'),{method:'POST',headers:{'content-type':'application/json',origin:url},body:JSON.stringify(request)});
  const result=await response.json();
  results.push({input,kind:kind||'story',status:response.status,elapsedMs:Date.now()-started,request,result});
  await writeFile(`test-results/momentum-${stage}.json`,JSON.stringify(results,null,2));
  assert.equal(response.status,200,JSON.stringify(result));
  if(!kind)commitTurn(session,world,input,result);
  console.log(JSON.stringify({stage,input,elapsedMs:Date.now()-started,events:result.events,prose:result.prose||result.text}));
}
await call('我暂时不说话，看看店里接下来会发生什么。');
if(stage==='after'){
  await call('让当前场景自然继续。');
  const before=JSON.stringify(session);
  await call('如果我拒绝帮忙会怎么样？只是问问，还没有拒绝。','ask');
  assert.equal(JSON.stringify(session),before);
}
