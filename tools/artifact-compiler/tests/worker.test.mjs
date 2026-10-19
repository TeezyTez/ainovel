import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compileReactArtifact} from '../src/server-artifact-build.mjs';
import {validateReactBundle} from '../src/react-artifact.js';

const candidate={type:'react',title:'数量试算',description:'只修改本地试算状态',initialState:{count:3},source:"import React from 'react';import {useArtifactState,Button,Card,draft} from '@story/ui';export default function Counter(){const [state,setState]=useArtifactState();return <Card title='数量'><output>{state.count}</output><Button onClick={()=>setState({...state,count:state.count+1})}>增加</Button><Button onClick={()=>draft('数量 '+state.count)}>写入草稿</Button></Card>}"};
const worker=fileURLToPath(new URL('../worker.mjs',import.meta.url));
function run(input){return spawnSync(process.execPath,[worker],{input,encoding:'utf8',timeout:35000,maxBuffer:2*1024*1024});}
test('worker compiles the original bounded React format without changing source',()=>{
  const raw=JSON.stringify({node:candidate});const result=run(raw);
  assert.equal(result.status,0,result.stderr);
  const {bundle}=JSON.parse(result.stdout);assert.equal(validateReactBundle(bundle),true);
  assert.deepEqual(bundle.initialState,{count:3});assert.equal(JSON.stringify({node:candidate}),raw);
  assert.ok(bundle.script.length>1000);
});
test('candidate imports and access cannot reach host, network, or JS escape APIs',async()=>{
  for(const source of [
    "import x from 'node:fs';export default()=> <p/>",
    "import x from '../package.json';export default()=> <p/>",
    "export default()=>{fetch('https://invalid.test');return <p/>}",
    "export default()=>{const key='constructor';(()=>{})[key]('return this')();return <p/>}",
    "export default()=>{window.parent.postMessage({},'*');return <p/>}",
    "export default()=>{import('react');return <p/>}"
  ])await assert.rejects(compileReactArtifact({...candidate,source}));
});
test('worker errors never echo candidate source or imported host paths',()=>{
  const result=run(JSON.stringify({node:{...candidate,source:"import x from 'C:/private-unique-path';export default()=> <p/>"}}));
  assert.equal(result.status,65);assert.equal(result.stdout,'');
  assert.match(result.stderr,/artifact_compile_rejected/);assert.doesNotMatch(result.stderr,/private-unique-path|import x/);
});
test('malformed, additional-field and oversized requests are rejected before output',()=>{
  for(const raw of ['{',JSON.stringify({node:candidate,extra:true}),' '.repeat(256*1024+1)]){
    const result=run(raw);assert.equal(result.status,65);assert.equal(result.stdout,'');
  }
});
