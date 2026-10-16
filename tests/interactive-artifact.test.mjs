import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {validateInteractiveView,artifactDocument,artifactShell,artifactFrame,cleanArtifactState} from '../src/interactive-artifact.js';

const sample={type:'interactive',title:'分配饮水',description:'拖动试算，不消耗饮水。',html:'<label>数量<input id="qty" type="range" min="0" max="12"></label><output id="remaining"></output>',css:'output{display:block}',script:'const q=document.querySelector("#qty");q.oninput=()=>{document.querySelector("#remaining").textContent=12-Number(q.value);ui.setState({quantity:Number(q.value)});};q.oninput();',height:320};
test('interactive definitions accept local controls and refuse oversized, executable host or network inputs',()=>{
  assert.equal(validateInteractiveView(sample),true);
  for(const script of ['fetch("https://bad.test")','parent.document.body.remove()','window.location="https://bad.test"','eval("1")'])assert.throws(()=>validateInteractiveView({...sample,script}));
  assert.throws(()=>validateInteractiveView({...sample,html:'x'.repeat(20001)}));
  assert.throws(()=>validateInteractiveView({...sample,extra:'unsupported'}));
});
test('generated code stays in an opaque iframe and cannot break out through document strings',()=>{
  const source=artifactDocument({...sample,html:'<script>parent.BAD=1</script><div>正常</div>',script:'const text="</script><img src=x onerror=bad()>";'}, {token:'abc-123',state:{quantity:4},theme:{ink:'#111'}});
  assert.match(source,/default-src 'none'/);assert.match(source,/connect-src 'none'/);assert.match(source,/form-action 'none'/);
  assert.doesNotMatch(source,/<img src=x onerror=bad\(\)>/);assert.doesNotMatch(source,/<script>parent.BAD/);
  const frame=artifactFrame(sample,{id:'test',historical:false});assert.match(frame,/sandbox="allow-scripts"/);assert.doesNotMatch(frame,/allow-same-origin|srcdoc=/);
  assert.match(frame,/分配饮水/);assert.match(artifactFrame(sample,{id:'old',historical:true}),/历史/);
});
test('artifact state is bounded JSON and cannot introduce prototype or object authority',()=>{
  assert.deepEqual(cleanArtifactState({quantity:4,selected:['north']}),{quantity:4,selected:['north']});
  assert.throws(()=>cleanArtifactState(JSON.parse('{"__proto__":{"x":1}}')));
  assert.throws(()=>cleanArtifactState({value:'x'.repeat(8001)}));
  assert.throws(()=>cleanArtifactState({value:Infinity}));
});

test('revised interactive views can declare bounded initial state without adding story authority',()=>{
  assert.equal(validateInteractiveView({...sample,initialState:{quantity:4,selected:['north']}}),true);
  for(const initialState of [{quantity:Infinity},{note:'x'.repeat(6001)},JSON.parse('{"__proto__":{}}')]){
    assert.throws(()=>validateInteractiveView({...sample,initialState}));
  }
});

test('artifact state rejects values that JSON would silently erase or change',()=>{
  for(const state of [[,1],{quantity:undefined},{[Symbol('hidden')]:1},Object.assign([1],{extra:2}),new Date()]){
    assert.throws(()=>cleanArtifactState(state));
  }
});

function runArtifact(entry){
  const sent=[],listeners=new Map(),root={append(){}};
  // State transitions use the real generated bootstrap; layout is irrelevant here.
  const document={getElementById:()=>root,createElement:tag=>tag==='template'?{content:{querySelectorAll:()=>[]}}:{},head:{append(){}},body:{append(){}},addEventListener(){}};
  const window={parent:{postMessage:message=>sent.push(JSON.parse(JSON.stringify(message)))},addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:type=>listeners.delete(type)};
  const node={...sample,script:'',initialState:{quantity:4}},token='artifact-test';
  const html=entry==='document'?artifactDocument(node,{token}):artifactShell(token);
  const context=vm.createContext({document,window,requestAnimationFrame(){},setTimeout(){}});
  vm.runInContext(html.match(/<script nonce="artifact-test">([\s\S]*?)<\/script>/)[1],context);
  if(entry==='shell')listeners.get('message')({source:window.parent,data:{channel:'story-artifact-init',token,node,state:{quantity:4}}});
  return {sent,run:source=>vm.runInContext(source,context)};
}

for(const entry of ['document','shell'])test(`${entry} state updates reject lossy JSON without replacing the previous state`,()=>{
  const f=runArtifact(entry);
  for(const value of ['{quantity:Infinity}','{quantity:undefined}','{items:[,1]}']){
    assert.throws(()=>f.run(`window.ui.setState(${value})`),/交互图状态/);
    assert.deepEqual(JSON.parse(f.run('JSON.stringify(window.ui.state)')),{quantity:4});
    assert.equal(f.sent.length,0,'invalid state must never be posted to the host');
  }
  f.run('window.ui.setState({quantity:0})');
  assert.deepEqual(JSON.parse(f.run('JSON.stringify(window.ui.state)')),{quantity:0});
  assert.deepEqual(f.sent,[{channel:'story-artifact',token:'artifact-test',kind:'state',value:{quantity:0}}]);
});
