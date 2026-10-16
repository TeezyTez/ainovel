import test from 'node:test';
import assert from 'node:assert/strict';
import {probeArtifact} from '../src/server-artifact-probe.mjs';
import {compileReactArtifact} from '../src/server-artifact-build.mjs';

const node={type:'interactive',title:'试算',description:'数量计算',html:'<label>数量<input id="n" type="number" value="3"></label><output id="sum">6</output><button>确定</button>',css:'',script:'document.getElementById("n").oninput = e => document.getElementById("sum").textContent=Number(e.target.value)*2;'};
test('independent browser checks actual content, controls, layout and runtime failures',async()=>{
  const result=await probeArtifact(node,{timeoutMs:20000,viewport:{width:390,height:780}});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.metrics.controls,2);assert.equal(result.metrics.overflow,false);
  const broken=await probeArtifact({...node,script:'throw new Error("broken candidate")'},{timeoutMs:20000});
  assert.equal(broken.ok,false);assert.match(broken.errors.join(' '),/broken candidate/);
});
test('an infinite generated loop is killed from outside the browser process',async()=>{
  const start=Date.now();const result=await probeArtifact({...node,script:'while(true){}'},{timeoutMs:1800});
  assert.equal(result.ok,false);assert.match(result.errors.join(' '),/timeout|超时/i);assert.ok(Date.now()-start<8000);
});
test('cancelled probe rejects candidate without launching or waiting for timeout',async()=>{
  const controller=new AbortController();controller.abort();const result=await probeArtifact(node,{signal:controller.signal});
  assert.equal(result.ok,false);assert.match(result.errors.join(' '),/cancel|取消|abort/i);
});
test('production smoke check exercises a control and rejects an interaction-time exception',async()=>{
 const result=await probeArtifact({...node,script:'document.querySelector("button").onclick=()=>{throw new Error("broken button")};'},{timeoutMs:20000,smoke:true});
 assert.equal(result.ok,false);assert.match(result.errors.join(' '),/broken button/);
});
test('compiled React mounts in the opaque sandbox and passes mobile checks',async()=>{
  const bundle=await compileReactArtifact({type:'react',title:'计数器',description:'本地参数',initialState:{n:4},source:`import React from 'react';import {useArtifactState,Button,Card} from '@story/ui';export default function App(){const [state,setState]=useArtifactState();return <Card title="计数器"><output>{state.n}</output><Button onClick={()=>setState({n:state.n+1})}>增加</Button></Card>}`});
  const result=await probeArtifact(bundle,{timeoutMs:20000,viewport:{width:390,height:780},tasks:[{action:'click',name:'增加'},{action:'expectState',value:{n:5}}]});assert.equal(result.ok,true,JSON.stringify(result));assert.match(result.metrics.text,/计数器/);assert.equal(result.metrics.controls,1);assert.deepEqual(result.metrics.state,{n:5});
});
test('React allocation recalculates and writes only a user initiated draft',async()=>{
  const bundle=await compileReactArtifact({type:'react',title:'分配',description:'总量十二',initialState:{people:3},source:`import React from 'react';import {useArtifactState,Field,Button,draft} from '@story/ui';export default function App(){const [state,setState]=useArtifactState();return <section><Field label="人数"><input type="number" value={state.people} onChange={event=>setState({people:Number(event.target.value)})}/></Field><output>每人 {12/state.people}</output><Button onClick={()=>draft('分配给 '+state.people+' 人')}>写入草稿</Button></section>}`});
  const result=await probeArtifact(bundle,{timeoutMs:20000,tasks:[{action:'fill',label:'人数',value:'4'},{action:'expectText',value:'每人 3'},{action:'click',name:'写入草稿'},{action:'expectDraft',value:'分配给 4 人'}]});
  assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.metrics.state,{people:4});assert.deepEqual(result.metrics.drafts,['分配给 4 人']);
});
test('saved state overrides React defaults during rendering and subsequent interaction',async()=>{
  const bundle=await compileReactArtifact({type:'react',title:'恢复计数',description:'恢复玩家实际输入',initialState:{n:4},source:`import React from 'react';import {useArtifactState,Button} from '@story/ui';export default function App(){const [state,setState]=useArtifactState();return <section><output>当前 {state.n}</output><Button onClick={()=>setState({n:state.n+1})}>增加</Button></section>}`});
  const result=await probeArtifact(bundle,{state:{n:0},timeoutMs:20000,tasks:[{action:'expectText',value:'当前 0'},{action:'click',name:'增加'},{action:'expectState',value:{n:1}},{action:'expectText',value:'当前 1'}]});
  assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.metrics.state,{n:1});assert.deepEqual(bundle.initialState,{n:4},'probe state never mutates the compiled definition');
});
test('an explicitly saved null reaches the browser without becoming the default object',async()=>{
  const candidate={...node,initialState:{n:4},html:'<output id="state"></output><button>设为false</button>',script:'document.querySelector("output").textContent=ui.state===null?"保存为空":"错误默认值";document.querySelector("button").onclick=()=>ui.setState(false);'};
  const result=await probeArtifact(candidate,{state:null,timeoutMs:20000,tasks:[{action:'expectText',value:'保存为空'},{action:'click',name:'设为false'},{action:'expectState',value:false}]});
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.metrics.state,false);
});
test('unsafe saved state fails validation before a browser is launched',async()=>{
  const result=await probeArtifact(node,{state:{n:Infinity},browserPath:'invalid-browser-must-not-launch'});
  assert.equal(result.ok,false);assert.match(result.errors.join(' '),/状态|数值/);
});
test('a generated notes textarea remains usable and preserves saved zero quantities',async()=>{
 const candidate={...node,initialState:{quantity:4,note:''},html:'<label for="note">试算备注</label><textarea id="note" rows="3" maxlength="1000"></textarea><output id="remaining"></output>',script:'const note=document.getElementById("note");note.value=ui.state.note;document.getElementById("remaining").textContent="剩余 "+(12-ui.state.quantity);note.addEventListener("input",()=>ui.setState({...ui.state,note:note.value}));'};
 const result=await probeArtifact(candidate,{state:{quantity:0,note:''},timeoutMs:20000,tasks:[{action:'expectText',value:'剩余 12'},{action:'fill',label:'试算备注',value:'先等阿青确认'},{action:'expectState',value:{quantity:0,note:'先等阿青确认'}},{action:'fill',label:'试算备注',value:'先等两人确认'},{action:'expectState',value:{quantity:0,note:'先等两人确认'}}]});
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.metrics.controls,1);
});
