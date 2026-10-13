import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BranchClient} from '../src/branch-client.js';
import {createServer} from '../server.mjs';
import {createSession} from '../src/core.js';
import {ApiError} from '../src/server-model.mjs';

const storage={getItem:()=> 'stream-test-owner-012345678901234567890',setItem(){}};
test('generation emits real stages before a confirmed result, retries remain idempotent',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'generation-stream-'));let calls=0,release;
 const held=new Promise(r=>release=r);
 const server=createServer({env:{MODEL_PROVIDER:'codex'},ledgerDirectory:dir,narrate:async(body,config,signal,{onProgress})=>{calls++;onProgress('writing');await held;onProgress('checking');return {requestId:body.requestId,baseVersion:body.state.version,prose:'雨停了。',events:[]};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const client=new BranchClient(storage,(path,options)=>fetch(`http://127.0.0.1:${server.address().port}`+path,options));
 const world={id:'stream-world',version:1,title:'雨',location:'屋檐下',opening:'雨正在落下。',identity:'旅人',rules:[],characters:[]},session=createSession(world,{},'real');
 await client.register(session,[world]);const body={sessionId:session.id,branchId:session.activeBranch,baseVersion:0,requestId:'once',input:'等雨停'};
 const stages=[];let settled=false;
 const pending=client.generate(body,undefined,stage=>{stages.push(stage);if(stage==='writing'){assert.equal(settled,false);release();}}).then(v=>{settled=true;return v;});
 const result=await pending;assert.deepEqual(stages,['preparing','writing','checking','saving']);assert.equal(result.authoritativeBranch.turns.length,1);
 assert.deepEqual(await client.generate(body),result);assert.equal(calls,1);
});
test('client handles split multibyte chunks, rejects unfinished streams and structured failures',async()=>{
 const encoded=new TextEncoder().encode(JSON.stringify({type:'progress',stage:'writing'})+'\n'+JSON.stringify({type:'result',value:{prose:'雨停了'}})+'\n');
 const response=bytes=>new Response(new ReadableStream({start(c){for(const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}),{headers:{'content-type':'application/x-ndjson'}});
 const stages=[];const client=new BranchClient(storage,async()=>response(encoded));assert.deepEqual(await client.generate({},null,s=>stages.push(s)),{prose:'雨停了'});assert.deepEqual(stages,['writing']);
 const broken=new BranchClient(storage,async()=>response(new TextEncoder().encode('{"type":"progress","stage":"writing"}\n')));await assert.rejects(broken.generate({}),e=>e.code==='INCOMPLETE_RESPONSE');
 const failure=new BranchClient(storage,async()=>response(new TextEncoder().encode('{"type":"error","code":"STORY_INVALID","error":"故事没有改变"}\n')));await assert.rejects(failure.generate({}),e=>e.code==='STORY_INVALID');
});
test('server emits error without committing or exposing unconfirmed prose',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'generation-error-'));const server=createServer({env:{MODEL_PROVIDER:'codex'},ledgerDirectory:dir,narrate:async(body,config,signal,{onProgress})=>{onProgress('checking');throw new ApiError(502,'STORY_INVALID','正文未通过校验');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const client=new BranchClient(storage,(path,options)=>fetch(`http://127.0.0.1:${server.address().port}`+path,options));const world={id:'failure-world',version:1,title:'雨',location:'屋檐下',opening:'雨正在落下。',identity:'旅人',rules:[],characters:[]},session=createSession(world,{},'real');await client.register(session,[world]);
 await assert.rejects(client.generate({sessionId:session.id,branchId:session.activeBranch,baseVersion:0,requestId:'error',input:'等候'}),e=>e.code==='STORY_INVALID');assert.equal((await client.read(session)).branch.turns.length,0);
});
