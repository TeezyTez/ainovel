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
test('unfinished submissions survive switching stories and clearing another branch receipt',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const a={sessionId:'a',branchId:'main',requestId:'ra',body:{input:'A 的完整长输入'}},b={sessionId:'b',branchId:'main',requestId:'rb',body:{input:'B 的输入'}};
 const first=new BranchClient(storage);first.journal(a);first.journal(b);
 const next=new BranchClient(storage);assert.deepEqual(next.journal(undefined,a),a);assert.deepEqual(next.journal(undefined,b),b);
 next.journal(null,b);assert.equal(next.journal(undefined,b),null);assert.deepEqual(next.journal(undefined,a),a);
 next.journal({...a,branchId:'fork',requestId:'rf'});assert.deepEqual(next.journal(undefined,a),a);
});
test('legacy pending input remains readable only in its own branch and is removed after its receipt',()=>{
 const pending={sessionId:'old',branchId:'main',requestId:'once',body:{input:'升级前的输入'}};
 const map=new Map([['fangtang:pending:v1',JSON.stringify(pending)]]),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 const client=new BranchClient(storage);assert.equal(client.journal(undefined,{sessionId:'other',branchId:'main'}),null);assert.deepEqual(client.journal(undefined,pending),pending);
 client.journal({sessionId:'other',branchId:'main',requestId:'new'});assert.deepEqual(client.journal(undefined,pending),pending);
 client.journal(null,pending);assert.equal(client.journal(undefined,pending),null);assert.equal(client.journal(undefined,{sessionId:'other',branchId:'main'}).requestId,'new');
});

test('cancelling a branch read aborts its network request and prevents a late response',async()=>{
 const controller=new AbortController(),storage={getItem:()=> 'test-owner',setItem(){}};
 const client=new BranchClient(storage,async(_path,{signal})=>new Promise((resolve,reject)=>{
   signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});
 }));
 const read=client.read({id:'s',activeBranch:'b'},undefined,controller.signal);
 controller.abort();
 let failure;read.catch(error=>{failure=error;});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(failure?.name,'AbortError');
});

test('confirmed branch installation preserves recovered text independently from the current draft',()=>{
 const local={id:'b',worldKey:'w@1',initialState:{version:0},turns:[],draft:'新草稿',recoveredSubmission:{requestId:'old',baseVersion:0,input:'之前未执行的输入'}};
 const confirmed={id:'b',worldKey:'w@1',initialState:{version:0},turns:[],draft:''};
 const merged=mergeConfirmedBranch(local,confirmed);
 assert.equal(merged.draft,'新草稿');assert.deepEqual(merged.recoveredSubmission,local.recoveredSubmission);
});
