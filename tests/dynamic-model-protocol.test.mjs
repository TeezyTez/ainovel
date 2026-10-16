import test from 'node:test';
import assert from 'node:assert/strict';
import {dynamicModel,DYNAMIC_PROMPT_VERSION,DYNAMIC_SYSTEM} from '../src/server-dynamic-model.mjs';

const signal=new AbortController().signal;

for(const reasoningEffort of [undefined,'low','medium','high'])test(`preparation preserves configured reasoning and defaults to low: ${reasoningEffort??'unset'}`,async()=>{
  const config=Object.freeze({contextBudget:24000,outputBudget:2400,...(reasoningEffort?{reasoningEffort}:{})}),before=structuredClone(config),calls=[];
  const requestJSON=async(c,system,input,_signal,{validate})=>{calls.push({config:c,system,input});return validate({payload:JSON.stringify({decision:'none',reason:'普通阅读'})});};
  const result=await dynamicModel(config,'prepare',{scope:{baseVersion:0}},signal,{requestJSON});
  assert.equal(DYNAMIC_PROMPT_VERSION,'elselife-dynamic-7');
  assert.equal(calls[0].config.outputBudget,7000);
  assert.equal(calls[0].config.reasoningEffort,reasoningEffort??'low');
  assert.deepEqual(config,before);
  assert.deepEqual(result.value,{decision:'none',reason:'普通阅读'});
  const larger=Object.freeze({...config,outputBudget:9000});
  await dynamicModel(larger,'prepare',{},signal,{requestJSON});
  assert.equal(calls[1].config.outputBudget,9000);
  assert.equal(calls[1].config.reasoningEffort,reasoningEffort??'low');
  assert.deepEqual(larger,{...before,outputBudget:9000});
});

test('rule judging retains the caller budget and provided compact context',async()=>{
  const config=Object.freeze({contextBudget:24000,outputBudget:2400,reasoningEffort:'high'}),context={definition:{actions:[{mode:'rule'}]}},calls=[];
  const result=await dynamicModel(config,'judge',context,signal,{requestJSON:async(c,system,input,_signal,{validate})=>{
    calls.push({config:c,system,input});return validate({payload:JSON.stringify({approved:true,reason:'成本已覆盖'})});
  }});
  assert.deepEqual(calls[0].config,config);
  assert.deepEqual(JSON.parse(calls[0].input),context);
  assert.deepEqual(result.value,{approved:true,reason:'成本已覆盖'});
});

test('removed narration review cannot make a model request',async()=>{
  let calls=0;
  await assert.rejects(dynamicModel({},'narrationReview',{},signal,{requestJSON:async()=>{calls++;return {approved:true};}}),/不支持的交互模型阶段/);
  assert.equal(calls,0);
});

test('v7 protocol distinguishes keep, none, and sandboxed interactive drafts',()=>{
  for(const part of ['decision:\'keep\'','decision:\'none\'','needed:false','previousPresentation','uiArtifact','ui.setState','ui.draft','interactive','20000','12000','24000','6000','1000'])assert.ok(DYNAMIC_SYSTEM.includes(part),part);
  assert.match(DYNAMIC_SYSTEM,/多路线|多条路线/);
  assert.match(DYNAMIC_SYSTEM,/不.*虚构.*概率/);
});
