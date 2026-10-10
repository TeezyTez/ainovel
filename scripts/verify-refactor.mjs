// Live model acceptance checks. Run explicitly; uses the current Codex allowance.
import { writeFile, mkdir } from 'node:fs/promises';
import { ADDITIONAL_WORLDS } from '../src/situations.js';
import { createSession, currentState, getBranch, commitTurn, validateArchive, clone } from '../src/core.js';
import { applyPolish, applyRepair } from '../src/experience.js';
import assert from 'node:assert/strict';
const url='http://127.0.0.1:4173',results=[];
await mkdir('test-results',{recursive:true});
async function call(endpoint,data){
  const start=Date.now(),response=await fetch(url+endpoint,{method:'POST',headers:{'content-type':'application/json',origin:url},body:JSON.stringify(data)}),result=await response.json();
  results.push({kind:data.kind||'action',input:data.seed||data.input,status:response.status,elapsedMs:Date.now()-start,result});
  await writeFile('test-results/refactor-live.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify({kind:data.kind||'action',status:response.status,elapsedMs:Date.now()-start,preview:(result.text||result.prose||result.world?.opening||result.error||'').slice(0,180)}));
  assert.equal(response.status,200);return result;
}
const world=ADDITIONAL_WORLDS[0],session=createSession(world,{},'real');
const payload=(kind,input)=>({kind,requestId:crypto.randomUUID(),world,state:clone(currentState(session)),player:session.player,preferences:session.preferences,memory:[],recent:[],input});
const original=JSON.stringify(session);
await call('/api/assist',payload('ask','如果我问她礼物送给谁，她一定会告诉我吗？我还没有问她。'));
assert.equal(JSON.stringify(session),original);
await call('/api/assist',payload('phrase','帮我礼貌地问送礼的人喝不喝茶，不打听私事，不推最贵的，也不承诺代她道歉。'));
assert.equal(JSON.stringify(session),original);
const action=payload(undefined,'先问那个人喝不喝茶。不要打听私事，也别推最贵的。');
const generated=await call('/api/generate',action);commitTurn(session,world,action.input,generated);
const target=clone(getBranch(session).turns.at(-1)),state=clone(currentState(session));
const polished=await call('/api/assist',{...payload('polish','保留全部发生的事情，只把正文写得更简洁自然。'),target});
applyPolish(session,target.id,polished.text,state.version);assert.deepEqual(currentState(session),state);
assert.deepEqual(getBranch(session).turns.at(-1).events,target.events);
// Deliberately incorrect fixture tests correction, not a claim the model made this mistake.
const bad={...target,prose:'你已经把最贵的茶卖给了她，并答应亲自替她道歉。',events:[{type:'fact',value:'你答应替客人道歉',visibility:'player'}]};
const repaired=await call('/api/assist',{...payload('repair','原行动明确说不推最贵的，也没有授权替她道歉。请恢复只询问对方喝不喝茶、未成交和未承诺的状态。'),state:getBranch(session).initialState,target:bad});
if(repaired.proposal){applyRepair(session,world,repaired.proposal,'实测构造的越权错误',session.activeBranch,currentState(session).version);validateArchive({schemaVersion:1,worlds:[world],sessions:[session]});}
else console.log('Repair declined due to insufficient evidence; no mutation applied.');
const draft=await call('/api/assist',{requestId:crypto.randomUUID(),kind:'world',seed:'一座人们不能故意说假话但可以沉默的城市。我经营一家小小的茶铺，想过温和的日常。开门第一位客人想买礼物，不要替我决定成交、恋爱或卷入阴谋。'});
console.log(JSON.stringify({worldId:draft.world.id,title:draft.world.title,checks:'hypothetical untouched, phrase untouched, polish state unchanged, repair validated',records:'test-results/refactor-live.json'}));
