import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelConfig, modelStatus, generate } from '../src/server-model.mjs';
import {runCodex} from '../src/server-codex.mjs';

async function fixture(t,behavior) {
  const dir=await mkdtemp(join(tmpdir(),'cijian-cli-test-')),path=join(dir,'cli.cjs');
  await writeFile(path,`const fs=require('node:fs'); const args=process.argv.slice(2); if(args.includes('login')) { console.error('Logged in using ChatGPT'); process.exit(0); } let input='';process.stdin.on('data',x=>input+=x);process.stdin.on('end',()=>{${behavior}});`);
  t.after(async()=>{await unlink(path);await rmdir(dir);});
  return {...modelConfig({MODEL_PROVIDER:'codex',CODEX_CLI_PATH:process.execPath,CODEX_AUTH_HOME:dir}),cliPrefix:[path]};
}
const body={requestId:'codex-test',world:{id:'harbor',version:1,title:'雾港',location:'码头',opening:'雨下起来。',identity:'旅人',rules:['现实世界'],characters:[{id:'lin',name:'林',public:'档案员',secret:'保密'}]},state:{version:0,step:0,location:'码头',time:'开篇',facts:[],inventory:[],relations:{lin:'陌生'},flags:{},characters:{lin:{name:'林'}}},player:{name:'旅人',identity:'旅人'},preferences:{},memory:[],recent:[],input:'我给猫倒水；$(不应作为命令执行)'};
const proposal={requestId:body.requestId,baseVersion:0,prose:'猫在雨棚下停住脚步，低头喝起了水。',events:[{type:'fact',entity:null,value:'你给猫倒水',visibility:'player'}],suggestions:[],ended:false};

test('Codex provider reports saved login without an API key and keeps local paths private',async t=>{
  const config=await fixture(t,'');
  assert.equal(config.key,'');
  const status=await modelStatus(config);
  assert.equal(status.available,true);assert.equal(status.provider,'Codex 本机授权');
  assert.ok(!JSON.stringify(status).includes(config.authHome));
});
test('Codex passes untrusted story through stdin, restricts tools and validates structured output',async t=>{
  const config=await fixture(t,`const data=JSON.parse(input);if(data.input!==${JSON.stringify(body.input)}||!args.includes('read-only')||!args.includes('--ignore-user-config')||!args.includes('shell_tool')||!args.includes('--output-schema'))process.exit(2);console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(${JSON.stringify(proposal)})}}));`);
  const result=await generate(body,config,new AbortController().signal);
  assert.equal(result.prose,proposal.prose);assert.equal(result.events[0].entity,undefined);
});
test('Codex invalid output and CLI errors remain safe failures',async t=>{
  for(const behavior of [`console.log('invalid');`,`console.error('private token or trace');process.exit(1);`]){
    const config=await fixture(t,behavior);
    await assert.rejects(generate(body,config,new AbortController().signal),e=>e.status===502&&!e.message.includes('private'));
  }
});
test('Codex permission failures identify the runtime problem without exposing CLI diagnostics',async t=>{
  const config=await fixture(t,`console.error('Error: failed to initialize in-process app-server client: 拒绝访问。 (os error 5) private-token secret-path');process.exit(1);`);
  await assert.rejects(generate(body,config,new AbortController().signal),error=>{
    assert.equal(error.code,'CODEX_PERMISSION_DENIED');
    assert.equal(error.status,503);
    assert.match(error.message,/正常用户/);
    assert.doesNotMatch(error.message,/private-token|secret-path/);
    return true;
  });
});
test('Codex executable and process failures are distinct from malformed model output',async t=>{
  const config=await fixture(t,`console.error('private runtime diagnostic');process.exit(1);`);
  await assert.rejects(generate(body,config,new AbortController().signal),error=>error.code==='CODEX_EXECUTION_FAILED'&&!error.message.includes('private'));
  config.cliPath=join(config.authHome,'missing-cli.exe');
  await assert.rejects(generate(body,config,new AbortController().signal),error=>error.code==='CODEX_UNAVAILABLE'&&!error.message.includes(config.authHome));
  const malformed=await fixture(t,`console.log('not JSON');`);
  await assert.rejects(generate(body,malformed,new AbortController().signal),error=>error.code==='INVALID_MODEL_RESULT');
});
test('Codex timeout and cancellation terminate the CLI without a proposal',async t=>{
  const config=await fixture(t,'setInterval(()=>{},1000);');config.timeoutMs=100;
  await assert.rejects(generate(body,config,new AbortController().signal),e=>e.code==='TIMEOUT');
  config.timeoutMs=5000;const abort=new AbortController();const pending=generate(body,config,abort.signal);setTimeout(()=>abort.abort(),100);
  await assert.rejects(pending,e=>e.code==='CANCELLED');
});
test('Codex reasoning effort accepts only low, medium, and high',async t=>{
  const config=await fixture(t,`const option=args.find(x=>x.startsWith('model_reasoning_effort='));console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({effort:option})}}));`);
  const schema={type:'object',properties:{effort:{type:'string'}},required:['effort']};
  for(const [requested,expected] of [[undefined,'low'],['medium','medium'],['high','high'],['xhigh','low']]){
    config.reasoningEffort=requested;
    const result=await runCodex(config,'system','input',new AbortController().signal,{schema});
    assert.equal(result.effort,`model_reasoning_effort="${expected}"`);
  }
});
