import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {generateNarrative} from '../src/server-narrative.mjs';
import {createSession,currentState} from '../src/core.js';
test('narrative diagnostic is available to server instrumentation but never serialized by HTTP',async t=>{
 const world={id:'diagnostic-world',version:1,title:'测试',opening:'门是关着的。',location:'门前',identity:'旅人',characters:[],rules:[]},session=createSession(world);
 let diagnostic,calls=0;
 const server=createServer({env:{MODEL_PROVIDER:'codex'},narrate:async(body,config,signal)=>{try{return await generateNarrative(body,config,signal,{requestJSON:async()=>{calls++;if(calls===2)return {};const candidate=(id,payoff)=>({id,kind:'progress',methodId:'free',threadId:null,premise:'门是关着的',npcAction:'有人观察门',payoff,leaveOpen:'',sources:[{sourceId:'world',quote:world.opening}]});return {worldKey:'diagnostic-world@1',baseVersion:0,preferredCandidateId:'one',candidates:[candidate('one','了解门'),candidate('two','了解窗')]};}});}catch(error){diagnostic=error.diagnostic;throw error;}}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const url=`http://127.0.0.1:${server.address().port}`,response=await fetch(url+'/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:'http-diag',world,state:currentState(session),player:session.player,preferences:session.preferences,memory:[],recent:[],input:'查看门'})}),result=await response.json();
 assert.equal(response.status,502);assert.equal(result.code,'INVALID_MODEL_RESULT');assert.equal(diagnostic.stage,'write-schema');assert.equal(diagnostic.path,'$.requestId');assert.deepEqual(Object.keys(result).sort(),['code','error']);assert.equal(JSON.stringify(result).includes('write-schema'),false);
});
