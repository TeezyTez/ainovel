import test from 'node:test';
import assert from 'node:assert/strict';
import {validateReactArtifact,validateReactBundle} from '../src/react-artifact.js';
import {compileReactArtifact} from '../src/server-artifact-build.mjs';
import {validateRichView} from '../src/rich-interaction.js';
import {renderRichView} from '../src/rich-interaction-view.js';

export const counter={type:'react',title:'数量',description:'本地试算',initialState:{count:3},source:`import React from 'react'; import {useArtifactState,Button,Card,draft} from '@story/ui'; export default function Counter(){const [state,setState]=useArtifactState();return <Card title="数量"><output>{state.count}</output><Button onClick={()=>setState({...state,count:state.count+1})}>增加</Button><Button onClick={()=>draft('数量 '+state.count)}>写入草稿</Button></Card>}`};
test('React TSX builds a bounded bundle while preserving model source and approved state',async()=>{
  const before=JSON.stringify(counter);assert.equal(validateReactArtifact(counter),true);
  const bundle=await compileReactArtifact(counter);assert.equal(validateReactBundle(bundle),true);
  assert.equal(bundle.type,'interactive');assert.equal(bundle.renderer,'react-bundle');assert.deepEqual(bundle.initialState,{count:3});assert.equal(JSON.stringify(counter),before);
  assert.ok(bundle.script.length>1000);
});
test('candidate imports cannot resolve host files, extra packages, require or dynamic imports',async()=>{
  for(const source of ["import x from '../package.json';export default ()=> <p>{x.name}</p>","import x from 'node:fs';export default ()=> <p/>","import x from 'react-dom';export default ()=> <p/>","export default ()=> {import('react');return <p/>}","const x=require('react');export default ()=> <p/>"]){
    await assert.rejects(compileReactArtifact({...counter,source}),/import|导入|require/i);
  }
});
test('invalid TSX reports candidate filename and location without evaluation',async()=>{
  await assert.rejects(compileReactArtifact({...counter,source:'export default function Broken(){return <button>'}),/artifact\.tsx.*\d|artifact\.tsx/s);
  await assert.rejects(compileReactArtifact({...counter,source:'throw new Error("server evaluated"); export const nothing=1;'}),/default|默认/i);
});
test('React validates through rich views and creates an opaque frame from original source',()=>{
  assert.equal(validateRichView(counter,{check:(v,m)=>assert.ok(v,m),verify:()=>{}}),true);
  const html=renderRichView(counter,{index:2});assert.match(html,/sandbox="allow-scripts"/);assert.match(html,/data-interactive-definition/);assert.match(html,/&quot;type&quot;:&quot;react&quot;/);
  assert.throws(()=>validateReactArtifact({...counter,css:'@import "https://evil.test"'}),/样式/);
  assert.throws(()=>validateReactArtifact({...counter,initialState:{count:Infinity}}),/状态/);
});
test('the trusted kit does not consume the model CSS allowance',async()=>{
  const css='/*'+'a'.repeat(11996)+'*/';assert.equal(css.length,12000);
  const result=await compileReactArtifact({...counter,css});assert.ok(result.css.includes(css));
});
test('candidate TSX cannot access host, network, storage or global execution APIs',async()=>{
  for(const code of [
    `window.parent.postMessage({kind:'draft'},'*')`,
    `document.querySelector('script').nonce`,
    `globalThis.postMessage({},'*')`,
    `self['parent'].postMessage({},'*')`,
    `fetch('https://example.test')`,
    `localStorage.setItem('x','y')`,
    `eval('1')`,
    `new Function('return this')()`,
    `(()=>{}).constructor('return this')()`,
    `(()=>{})['constructor']('return this')()`,
    `const key=['con','structor'].join('');(()=>{})[key]('return this')()`,
    `const {constructor:FunctionAlias}=()=>{};FunctionAlias('return this')()`,
    `const read=event=>event.target.ownerDocument.defaultView;read({})`,
    `const read=event=>event.nativeEvent.view;read({})`,
    `const x=Object.getPrototypeOf(()=>{});x.constructor('return this')()`,
    `const read=()=>this;read()`,
    `const read=event=>Object.values(event)[8];read({})`,
    `const O=Object;const read=event=>O.entries(event)[0][1];read({})`,
    `const read=event=>event.nativeEvent.composedPath()[5];read({})`,
  ])await assert.rejects(compileReactArtifact({...counter,source:`import React from 'react'; ${code};export default ()=> <button>测试</button>`}),/restricted|forbidden|访问|受限|constructor|动态/i,code);
});
