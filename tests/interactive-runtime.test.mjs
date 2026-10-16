import test from 'node:test';
import assert from 'node:assert/strict';
import {createArtifactRuntime} from '../src/interactive-runtime.js';

function fixture({initialState,stored,storageFails=false,react=false,bundle,state,artifact}={}){
  let listener;const drafts=[],repairs=[],states=[],storage=new Map(),timers=[],messages=[],frameListeners={};
  const win={addEventListener:(type,fn)=>{listener=fn;},removeEventListener:()=>{}};
  const active={session:{id:'s'},branch:{id:'b',dynamic:{digest:'digest',definition:{id:'view'}}},state:{version:1}};
  if(artifact)active.branch.dynamic.artifact=artifact;
  const frame={contentWindow:{postMessage:message=>messages.push(message)},style:{},addEventListener:(type,fn)=>{frameListeners[type]=fn;},remove(){this.removed=true;}};
  const status={textContent:'',hidden:false},repair={hidden:true,addEventListener(){}};
  const node={dataset:{interactiveId:'view-0',interactiveDefinition:JSON.stringify({type:'interactive',title:'分配',description:'试算',html:'<p>测试</p>',css:'',script:'',...(initialState!==undefined?{initialState}:{})})},isConnected:true,querySelector:s=>s==='iframe'?frame:s==='[data-artifact-status]'?status:repair};
  if(react)node.dataset.interactiveDefinition=JSON.stringify({type:'react',title:'分配',description:'试算',source:'export default ()=> <button>确定</button>',...(initialState!==undefined?{initialState}:{})});
  if(stored!==undefined)storage.set('elselife:artifact:'+JSON.stringify(['s','b',1])+':digest',JSON.stringify(stored));
  const runtime=createArtifactRuntime({active:()=>active,ready:()=>true,bundle,state,onState:(value,context)=>states.push({value,context}),storage:{getItem:k=>{if(storageFails)throw new Error('unavailable');return storage.get(k);},setItem:(k,v)=>storage.set(k,v)},draft:v=>drafts.push(v),repair:v=>repairs.push(v),window:win,schedule:fn=>{timers.push(fn);return timers.length;},clearSchedule(){}});
  const bind=()=>runtime.bind({querySelectorAll:()=>[node]});bind();
  const token=new URL(frame.src,'http://local').searchParams.get('token');
  const send=(kind,value,source=frame.contentWindow,override=new URL(frame.src,'http://local').searchParams.get('token'))=>listener({source,data:{channel:'story-artifact',token:override,kind,value}});
  return {runtime,active,node,frame,status,drafts,repairs,states,send,timers,messages,bind,load:()=>frameListeners.load?.()};
}
test('host accepts only current frame messages and bounded local state',()=>{
  const f=fixture();f.send('state',{quantity:4},{},'wrong');assert.equal(f.runtime.context().state.quantity,undefined);
  f.send('state',{quantity:4});assert.equal(f.runtime.context().state.quantity,4);
  f.send('state',{quantity:Infinity});assert.equal(f.runtime.context().state.quantity,4);
  f.send('execute',{action:'buy'});assert.equal(f.drafts.length,0);
  f.send('draft','我想比较北路');assert.deepEqual(f.drafts,['我想比较北路']);
  f.active.state.version++;f.send('draft','旧界面');assert.equal(f.drafts.length,1);
});

test('a revised view starts from its approved initial state and restores newer local changes',()=>{
  const f=fixture({initialState:{quantity:4}});f.load();
  assert.deepEqual(f.messages[0]?.state,{quantity:4});
  assert.deepEqual(f.runtime.context()?.state,{quantity:4});
  f.send('state',{quantity:6});assert.deepEqual(f.runtime.context().state,{quantity:6});
  const restored=fixture({initialState:{quantity:4},stored:{quantity:7}});restored.load();
  assert.deepEqual(restored.messages[0]?.state,{quantity:7});
  const reset=fixture({initialState:{quantity:4},stored:null});reset.load();
  assert.equal(reset.messages[0]?.state,null,'a deliberately saved null is not a missing entry');
});

test('initial state survives unavailable local storage without changing the definition',()=>{
  const f=fixture({initialState:{quantity:4},storageFails:true});f.load();
  assert.deepEqual(f.messages[0]?.state,{quantity:4});
  f.send('state',{quantity:9});
  assert.equal(JSON.parse(f.node.dataset.interactiveDefinition).initialState.quantity,4);
});
test('runtime failures expose recovery and allow one automatic repair per scope',()=>{
  const f=fixture();f.send('error','找不到控件');f.send('error','再次报错');
  assert.equal(f.repairs.length,1);assert.match(f.runtime.context().error,/找不到控件/);assert.match(f.status.textContent,/暂时/);
});
test('detached frames and a changed digest cannot affect the new presentation',()=>{
  const f=fixture();f.node.isConnected=false;f.send('state',{quantity:8});assert.equal(f.runtime.context()?.state.quantity,undefined);
  f.active.branch.dynamic.digest='new';f.send('draft','stale');assert.equal(f.drafts.length,0);assert.equal(f.runtime.context(),null);
});
const reactBundle={type:'interactive',renderer:'react-bundle',title:'分配',description:'试算',html:'<div id="story-react-root"></div>',css:'',script:'void 0;'};
test('React awaits host compilation and seeds server state then reports bounded changes',async()=>{
  let finish;const f=fixture({react:true,initialState:{quantity:1},stored:{quantity:2},state:()=>({quantity:7}),bundle:()=>new Promise(resolve=>{finish=resolve;})});
  assert.equal(f.frame.src,undefined);finish(reactBundle);await new Promise(resolve=>setImmediate(resolve));f.load();
  assert.equal(f.messages[0].node.renderer,'react-bundle');assert.deepEqual(f.messages[0].state,{quantity:7});
  f.send('state',{quantity:8});assert.deepEqual(f.states[0].value,{quantity:8});assert.equal(f.states[0].context.digest,'digest');
  f.send('state',{quantity:Infinity});assert.equal(f.states.length,1);
});
test('React compilation finishing after branch change cannot initialize an old frame',async()=>{
  let finish;const f=fixture({react:true,bundle:()=>new Promise(resolve=>{finish=resolve;})});
  f.active.branch.id='other';finish(reactBundle);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.frame.src,undefined);assert.equal(f.messages.length,0);
});
test('a stalled React bundle exposes recovery and cannot initialize after timing out',async()=>{
  let finish;const f=fixture({react:true,bundle:()=>new Promise(resolve=>{finish=resolve;})});
  assert.equal(f.timers.length,1);f.timers[0]();assert.equal(f.frame.removed,true);assert.equal(f.repairs.length,1);
  finish(reactBundle);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.frame.src,undefined);
});
test('restoring A after B with the same digest refreshes approved server state',()=>{
  let saved={quantity:3};const f=fixture({artifact:{head:'a',stateRevision:1},state:()=>saved});
  f.load();f.send('state',{quantity:4});
  f.active.branch.dynamic.artifact={head:'b',stateRevision:2};saved={quantity:6};
  f.send('state',{quantity:99});assert.equal(f.states.length,1,'old head cannot send');
  f.bind();f.load();assert.deepEqual(f.messages.at(-1).state,{quantity:6});
  f.active.branch.dynamic.artifact={head:'a',stateRevision:3};saved={quantity:7};f.bind();f.load();
  assert.deepEqual(f.messages.at(-1).state,{quantity:7});
});
