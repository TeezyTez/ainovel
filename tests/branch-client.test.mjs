import test from 'node:test';
import assert from 'node:assert/strict';
import {BranchClient,mergeConfirmedBranch,mergeConfirmedBranches} from '../src/branch-client.js';
test('editing a registered branch preserves unsent local forks and their drafts',()=>{
 const branch={id:'a',worldKey:'x@1',initialState:{version:0},turns:[],draft:'',name:'main'};
 const fork={...branch,id:'b',draft:'未发送的分支草稿',name:'alternative'};
 const merged=mergeConfirmedBranches([branch,fork],[{...branch,opening:'修订后的文字'}]);
 assert.equal(merged.length,2);assert.equal(merged[0].opening,'修订后的文字');assert.deepEqual(merged[1],fork);
});
test('browser fetch receives the global receiver rather than the client instance',async()=>{
 const storage={getItem:()=> 'test-owner-token',setItem:()=>{}};
 const client=new BranchClient(storage,async function(){assert.equal(this,globalThis);return {ok:true,json:async()=>({ok:true})};});
 assert.deepEqual(await client.request('/test',{}),{ok:true});
});
test('confirmation merge preserves draft and personal position while rejecting rollback and other branch',()=>{
 const local={id:'a',worldKey:'x@1',initialState:{version:0},turns:[],draft:'未发送的长草稿',readingPosition:290,personal:{notes:['my note']},name:'我的分支'};
 const server={...local,draft:'',readingPosition:0,personal:{},turns:[{id:'turn1',state:{version:1}}]};
 const merged=mergeConfirmedBranch(local,server);assert.equal(merged.draft,local.draft);assert.equal(merged.readingPosition,290);assert.deepEqual(merged.personal,local.personal);assert.equal(merged.turns[0].id,'turn1');
 assert.throws(()=>mergeConfirmedBranch(merged,local),/较旧/);assert.throws(()=>mergeConfirmedBranch(local,{...server,id:'b'}),/分支/);assert.equal(local.turns.length,0);
});
test('owner token and pending operation survive client recreation; server errors retain their code',async()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const c=new BranchClient(storage,async()=>({ok:false,json:async()=>({code:'VERSION_CONFLICT',error:'过期'})}));const token=c.owner();c.journal({sessionId:'s',requestId:'r'});const next=new BranchClient(storage);
 assert.equal(next.owner(),token);assert.equal(next.journal().requestId,'r');await assert.rejects(c.read({id:'s',activeBranch:'b'}),e=>e.code==='VERSION_CONFLICT');c.journal(null);assert.equal(next.journal(),null);
});
